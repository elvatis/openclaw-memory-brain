import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type {
  PluginApi,
  CommandDefinition,
  ToolDefinition,
  CommandContext,
  ToolCallParams,
  MessageEvent,
  MessageEventContext,
} from "@elvatis_com/openclaw-memory-core";
import register from "../index.js";

// ---------------------------------------------------------------------------
// Mock PluginApi factory
// ---------------------------------------------------------------------------

type MessageHandler = (event: MessageEvent, ctx: MessageEventContext) => Promise<void>;

interface MockApi extends PluginApi {
  _commands: Map<string, CommandDefinition>;
  _tools: Map<string, ToolDefinition>;
  _handlers: Map<string, MessageHandler[]>;
}

function createMockApi(config: Record<string, unknown> = {}): MockApi {
  const commands = new Map<string, CommandDefinition>();
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, MessageHandler[]>();

  return {
    pluginConfig: config,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    registerCommand(def: CommandDefinition) {
      commands.set(def.name, def);
    },
    registerTool(def: ToolDefinition) {
      tools.set(def.name, def);
    },
    on(event: string, handler: MessageHandler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    _commands: commands,
    _tools: tools,
    _handlers: handlers,
  } as MockApi;
}

// ---------------------------------------------------------------------------
// Helpers - since the plugin constructs a JsonlMemoryStore internally,
// we rely on the real store backed by a temp file. The tests are integration-
// style but still fast because the store uses a temp directory.
// ---------------------------------------------------------------------------

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, rmSync } from "node:fs";

const TEST_DIR = join(homedir(), ".openclaw", "test-brain");

let counter = 0;
function tempStorePath(): string {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  return join(TEST_DIR, `brain-${Date.now()}-${counter++}.jsonl`);
}

afterAll(() => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
});

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("register() - plugin setup", () => {
  it("registers all four commands and one tool", () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    expect(api._commands.has("remember-brain")).toBe(true);
    expect(api._commands.has("search-brain")).toBe(true);
    expect(api._commands.has("list-brain")).toBe(true);
    expect(api._commands.has("forget-brain")).toBe(true);
    expect(api._tools.has("brain_memory_search")).toBe(true);
  });

  it("registers the message_received event handler", () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    expect(handlers.length).toBe(1);
  });

  it("does not register anything when enabled is false", () => {
    const api = createMockApi({ enabled: false });
    register(api);

    expect(api._commands.size).toBe(0);
    expect(api._tools.size).toBe(0);
    expect(api._handlers.size).toBe(0);
  });

  it("logs an error and exits when storePath is outside home directory", () => {
    const api = createMockApi({ storePath: "/etc/passwd" });
    register(api);

    expect(api._commands.size).toBe(0);
    expect(api.logger?.error).toHaveBeenCalled();
  });

  it("uses default config values when no config is provided", () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    // Plugin should still register everything with defaults
    expect(api._commands.size).toBe(4);
    expect(api._tools.size).toBe(1);
  });
});

describe("/remember-brain command", () => {
  let api: MockApi;

  beforeEach(() => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);
  });

  it("saves a memory item and returns confirmation", async () => {
    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({ args: "This is an important fact to remember" });
    expect(result.text).toContain("Saved brain memory");
  });

  it("returns usage text when no args are provided", async () => {
    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Usage");
  });

  it("returns usage text when args are empty string", async () => {
    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({ args: "   " });
    expect(result.text).toContain("Usage");
  });

  it("redacts secrets by default and indicates so in response", async () => {
    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({
      args: "My API key is AIzaSyExampleExampleExampleExample1234 for the project",
    });
    expect(result.text).toContain("secrets redacted");
  });

  it("does not redact when redactSecrets is false", async () => {
    const api2 = createMockApi({
      storePath: tempStorePath(),
      redactSecrets: false,
    });
    register(api2);

    const cmd = api2._commands.get("remember-brain")!;
    const result = await cmd.handler({
      args: "My API key is AIzaSyExampleExampleExampleExample1234 for the project",
    });
    // No redaction note
    expect(result.text).toBe("Saved brain memory.");
  });

  it("passes source context from CommandContext", async () => {
    const cmd = api._commands.get("remember-brain")!;
    const ctx: CommandContext = {
      args: "Important note from Slack",
      channel: "slack",
      from: "user123",
      conversationId: "conv-abc",
      messageId: "msg-456",
    };
    const result = await cmd.handler(ctx);
    expect(result.text).toContain("Saved brain memory");
  });
});

describe("/search-brain command", () => {
  let api: MockApi;

  beforeEach(async () => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);

    // Seed some data
    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "TypeScript project setup checklist for new developers" });
    await rememberCmd.handler({ args: "Decision: use vitest instead of jest for all new test suites" });
    await rememberCmd.handler({ args: "Remember to always review pull requests before merging" });
  });

  it("returns matching results for a query", async () => {
    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "TypeScript project" });
    expect(result.text).toContain("Brain memory results");
    expect(result.text).toContain("score:");
  });

  it("returns usage text when no query is provided", async () => {
    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Usage");
  });

  it("returns no-match message when nothing matches well", async () => {
    // Use a totally unrelated query on a fresh store with no data
    const api2 = createMockApi({ storePath: tempStorePath() });
    register(api2);

    const cmd = api2._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "zzzznonexistent" });
    expect(result.text).toContain("No brain memories found");
  });

  it("accepts an optional limit as trailing number", async () => {
    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "TypeScript 2" });
    expect(result.text).toContain("Brain memory results");
  });
});

describe("/list-brain command", () => {
  let api: MockApi;

  beforeEach(async () => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);
  });

  it("returns empty message when no memories exist", async () => {
    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("lists stored memories after adding some", async () => {
    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "First note about architecture decisions" });
    await rememberCmd.handler({ args: "Second note about deployment process" });

    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Brain memories (2)");
    expect(result.text).toContain("First note");
    expect(result.text).toContain("Second note");
  });

  it("respects a limit argument", async () => {
    const rememberCmd = api._commands.get("remember-brain")!;
    for (let i = 1; i <= 5; i++) {
      await rememberCmd.handler({ args: `Note number ${i} with enough text` });
    }

    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({ args: "2" });
    // Should list only 2 items
    expect(result.text).toContain("Brain memories (2)");
  });

  it("uses default limit when args is empty", async () => {
    const rememberCmd = api._commands.get("remember-brain")!;
    for (let i = 1; i <= 3; i++) {
      await rememberCmd.handler({ args: `Memory item ${i} with sufficient length` });
    }

    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({ args: "" });
    expect(result.text).toContain("Brain memories (3)");
  });
});

describe("/forget-brain command", () => {
  let api: MockApi;

  beforeEach(async () => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);
  });

  it("returns usage text when no id is provided", async () => {
    const cmd = api._commands.get("forget-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Usage");
  });

  it("returns not-found message for non-existent id", async () => {
    const cmd = api._commands.get("forget-brain")!;
    const result = await cmd.handler({ args: "non-existent-id-12345" });
    expect(result.text).toContain("No memory found");
  });

  it("deletes a memory that was previously stored", async () => {
    // First, add a memory and find its ID via the search tool
    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Temporary note to be deleted later" });

    // Use the tool to search and get the id
    const tool = api._tools.get("brain_memory_search")!;
    const searchResult = await tool.handler({ query: "Temporary note deleted" } as ToolCallParams);
    const hits = (searchResult as { hits: Array<{ id: string }> }).hits;
    expect(hits.length).toBeGreaterThan(0);
    const itemId = hits[0]!.id;

    // Now delete it
    const cmd = api._commands.get("forget-brain")!;
    const result = await cmd.handler({ args: itemId });
    expect(result.text).toContain("Deleted brain memory");

    // Verify it's gone
    const listCmd = api._commands.get("list-brain")!;
    const listResult = await listCmd.handler({});
    expect(listResult.text).toContain("No brain memories stored yet");
  });

  it("has requireAuth set to true", () => {
    const cmd = api._commands.get("forget-brain")!;
    expect(cmd.requireAuth).toBe(true);
  });
});

describe("brain_memory_search tool", () => {
  let api: MockApi;

  beforeEach(async () => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Architecture decision: use microservices for scalability" });
    await rememberCmd.handler({ args: "Meeting notes: quarterly planning for Q3 product roadmap" });
  });

  it("returns hits with score, id, createdAt, tags, and text", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "architecture microservices" } as ToolCallParams);
    const data = result as { hits: Array<{ score: number; id: string; createdAt: string; tags: string[]; text: string }> };

    expect(data.hits.length).toBeGreaterThan(0);
    const hit = data.hits[0]!;
    expect(hit).toHaveProperty("score");
    expect(hit).toHaveProperty("id");
    expect(hit).toHaveProperty("createdAt");
    expect(hit).toHaveProperty("tags");
    expect(hit).toHaveProperty("text");
    expect(typeof hit.score).toBe("number");
    expect(hit.score).toBeGreaterThanOrEqual(0);
    expect(hit.score).toBeLessThanOrEqual(1);
  });

  it("returns empty hits for empty query", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "" } as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits).toEqual([]);
  });

  it("returns empty hits for undefined query", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({} as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits).toEqual([]);
  });

  it("respects the limit parameter", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "planning", limit: 1 } as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits.length).toBeLessThanOrEqual(1);
  });

  it("uses default limit of 5 when limit is not provided", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    // With only 2 items, we can't fully test the default limit of 5,
    // but we verify it doesn't crash
    const result = await tool.handler({ query: "decision" } as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits.length).toBeLessThanOrEqual(5);
  });

  it("has correct inputSchema definition", () => {
    const tool = api._tools.get("brain_memory_search")!;
    const schema = tool.inputSchema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("query");
    expect(props).toHaveProperty("limit");
    const required = schema.required as string[];
    expect(required).toContain("query");
  });
});

describe("auto-capture (message_received hook)", () => {
  it("captures message containing an explicit trigger", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    expect(handlers.length).toBe(1);
    const handler = handlers[0]!;

    // Message must be >= minChars (80) and contain a trigger
    const longText = "remember this: " + "a".repeat(80);
    await handler({ content: longText, from: "testuser" }, { messageProvider: "slack", sessionId: "s1" });

    // Verify capture happened by listing
    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("captures message containing an auto-topic when requireExplicit is false", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Message with a topic keyword "decision" that is >= 80 chars
    const longText = "This is a major decision about the system architecture. " + "x".repeat(40);
    await handler({ content: longText, from: "user2" }, { messageProvider: "web", sessionId: "s2" });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("does NOT capture short messages even with a trigger", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Short message under minChars (80)
    await handler({ content: "remember this: hi", from: "user" }, { messageProvider: "slack", sessionId: "s1" });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("does NOT capture messages without trigger or topic (requireExplicit=true, default)", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Long message but no trigger keyword
    const longText = "This is a very long message about nothing in particular. " + "x".repeat(80);
    await handler({ content: longText, from: "user" }, { messageProvider: "web", sessionId: "s1" });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("does NOT capture messages without trigger when requireExplicit is true, even if topic matches", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: true },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Has a topic "decision" but no explicit trigger, and requireExplicit is true
    const longText = "We made a decision about the infrastructure. " + "x".repeat(60);
    await handler({ content: longText, from: "user" }, { messageProvider: "web", sessionId: "s1" });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("does NOT capture empty content", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler({ content: "", from: "user" }, { messageProvider: "web", sessionId: "s1" });
    await handler({ content: undefined, from: "user" } as MessageEvent, { messageProvider: "web", sessionId: "s1" });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("is case-insensitive for trigger matching", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Uppercase trigger
    const longText = "REMEMBER THIS: important architecture note. " + "x".repeat(60);
    await handler({ content: longText, from: "user" }, { messageProvider: "web", sessionId: "s1" });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("redacts secrets in captured messages", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Long message with a trigger and a secret
    const longText = "remember this: my key is AIzaSyExampleExampleExampleExample1234 which is useful. " + "x".repeat(20);
    await handler({ content: longText, from: "user" }, { messageProvider: "web", sessionId: "s1" });

    // Search for the stored item to verify redaction
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "key useful" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.text).toContain("[REDACTED:GOOGLE_KEY]");
    expect(data.hits[0]!.text).not.toContain("AIzaSy");
  });

  it("logs errors instead of throwing on handler failure", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Passing null event should not throw - it should catch and log
    await expect(
      handler(null as unknown as MessageEvent, { messageProvider: "web", sessionId: "s1" })
    ).resolves.toBeUndefined();
  });

  it("respects custom minChars configuration", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Short message that is >= 10 chars with a trigger
    await handler({ content: "remember this: short note" }, { messageProvider: "web", sessionId: "s1" });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("respects custom explicitTriggers configuration", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, explicitTriggers: ["SAVE THIS"] },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Custom trigger
    await handler({ content: "SAVE THIS: my important note about things" }, { messageProvider: "web", sessionId: "s1" });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });
});

describe("custom configuration", () => {
  it("applies custom defaultTags to stored items", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      defaultTags: ["project-x", "notes"],
    });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Custom tagged note for the project" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "Custom tagged note" } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[] }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.tags).toEqual(["project-x", "notes"]);
  });

  it("respects custom autoTopics configuration for capture", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, autoTopics: ["URGENT"] },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "This is URGENT and must be addressed immediately", from: "user" },
      { messageProvider: "web", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("does not capture with custom autoTopics when default topics are used", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, autoTopics: ["URGENT"] },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // "decision" is a default topic but not in the custom list
    await handler(
      { content: "This is a decision about system architecture changes", from: "user" },
      { messageProvider: "web", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("does not redact secrets in auto-capture when redactSecrets is false", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      redactSecrets: false,
      capture: { minChars: 10 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    const secret = "AIzaSyExampleExampleExampleExample1234";
    await handler(
      { content: `remember this: my key is ${secret} ok`, from: "user" },
      { messageProvider: "web", sessionId: "s1" },
    );

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "key" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    // Secret should NOT be redacted
    expect(data.hits[0]!.text).toContain("AIzaSy");
  });
});

describe("output formatting", () => {
  it("/list-brain truncates text longer than 120 chars", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const longNote = "A".repeat(200);
    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: longNote });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    // Should contain the truncation ellipsis
    expect(result.text).toContain("\u2026");
    // Should not contain the full 200-char string
    expect(result.text).not.toContain(longNote);
  });

  it("/search-brain truncates text longer than 120 chars", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const longNote = "B".repeat(200);
    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: longNote });

    const searchCmd = api._commands.get("search-brain")!;
    const result = await searchCmd.handler({ args: "BBBBB" });
    expect(result.text).toContain("\u2026");
    expect(result.text).not.toContain(longNote);
  });

  it("/list-brain does not add ellipsis for short text", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Short note" });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).not.toContain("\u2026");
    expect(result.text).toContain("Short note");
  });
});

describe("edge cases", () => {
  it("/search-brain treats a sole numeric arg as the query, not a limit", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const searchCmd = api._commands.get("search-brain")!;
    // Single arg "5" - since args.length is 1, it should be treated as query, not limit
    const result = await searchCmd.handler({ args: "5" });
    expect(result.text).toContain("No brain memories found for: 5");
  });

  it("/forget-brain returns usage for whitespace-only arg", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("forget-brain")!;
    const result = await cmd.handler({ args: "   " });
    expect(result.text).toContain("Usage");
  });

  it("brain_memory_search tool clamps limit above 20", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Test note for limit clamping verification" });

    const tool = api._tools.get("brain_memory_search")!;
    // Passing limit of 100 - should be clamped to 20
    const result = await tool.handler({ query: "Test note", limit: 100 } as ToolCallParams);
    const data = result as { hits: unknown[] };
    // Should still work (clamped to 20, but we only have 1 item)
    expect(data.hits.length).toBeLessThanOrEqual(20);
  });

  it("multiple auto-captures are counted correctly", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath, capture: { minChars: 10 } });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    for (let i = 1; i <= 3; i++) {
      await handler(
        { content: `remember this: note number ${i} about things`, from: "user" },
        { messageProvider: "web", sessionId: "s1" },
      );
    }

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (3)");
  });
});

describe("logger verification", () => {
  it("logs info message on startup", () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);
    expect(api.logger?.info).toHaveBeenCalledWith(
      expect.stringContaining("[memory-brain] enabled"),
    );
  });

  it("logs info on successful auto-capture", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath, capture: { minChars: 10 } });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: important note for logging test", from: "user" },
      { messageProvider: "web", sessionId: "s1" },
    );

    expect(api.logger?.info).toHaveBeenCalledWith(
      expect.stringContaining("[memory-brain] captured memory"),
    );
  });

  it("logs error on invalid storePath rejection", () => {
    const api = createMockApi({ storePath: "/etc/passwd" });
    register(api);
    expect(api.logger?.error).toHaveBeenCalledWith(
      expect.stringContaining("[memory-brain]"),
    );
  });
});

describe("command metadata", () => {
  let api: MockApi;

  beforeEach(() => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);
  });

  it("/remember-brain has correct metadata", () => {
    const cmd = api._commands.get("remember-brain")!;
    expect(cmd.name).toBe("remember-brain");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/remember-brain");
    expect(cmd.requireAuth).toBe(false);
    expect(cmd.acceptsArgs).toBe(true);
  });

  it("/search-brain has correct metadata", () => {
    const cmd = api._commands.get("search-brain")!;
    expect(cmd.name).toBe("search-brain");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/search-brain");
    expect(cmd.requireAuth).toBe(false);
    expect(cmd.acceptsArgs).toBe(true);
  });

  it("/list-brain has correct metadata", () => {
    const cmd = api._commands.get("list-brain")!;
    expect(cmd.name).toBe("list-brain");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/list-brain");
    expect(cmd.requireAuth).toBe(false);
    expect(cmd.acceptsArgs).toBe(true);
  });

  it("/forget-brain has correct metadata", () => {
    const cmd = api._commands.get("forget-brain")!;
    expect(cmd.name).toBe("forget-brain");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/forget-brain");
    expect(cmd.requireAuth).toBe(true);
    expect(cmd.acceptsArgs).toBe(true);
  });
});
