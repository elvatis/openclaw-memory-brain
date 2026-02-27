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
  it("registers all eight commands and one tool", () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    expect(api._commands.has("remember-brain")).toBe(true);
    expect(api._commands.has("search-brain")).toBe(true);
    expect(api._commands.has("list-brain")).toBe(true);
    expect(api._commands.has("forget-brain")).toBe(true);
    expect(api._commands.has("tags-brain")).toBe(true);
    expect(api._commands.has("export-brain")).toBe(true);
    expect(api._commands.has("import-brain")).toBe(true);
    expect(api._commands.has("purge-brain")).toBe(true);
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
    expect(api._commands.size).toBe(8);
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
    expect(result.text).toContain("--tags");
  });

  it("returns usage text when args are empty string", async () => {
    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({ args: "   " });
    expect(result.text).toContain("Usage");
  });

  it("returns usage text when only --tags is provided without text", async () => {
    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({ args: "--tags project,work" });
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

  it("has correct inputSchema definition including tags", () => {
    const tool = api._tools.get("brain_memory_search")!;
    const schema = tool.inputSchema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("query");
    expect(props).toHaveProperty("limit");
    expect(props).toHaveProperty("tags");
    const required = schema.required as string[];
    expect(required).toContain("query");
    expect(required).not.toContain("tags");
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
    expect(cmd.usage).toContain("--tags");
    expect(cmd.requireAuth).toBe(false);
    expect(cmd.acceptsArgs).toBe(true);
  });

  it("/search-brain has correct metadata", () => {
    const cmd = api._commands.get("search-brain")!;
    expect(cmd.name).toBe("search-brain");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/search-brain");
    expect(cmd.usage).toContain("--tags");
    expect(cmd.requireAuth).toBe(false);
    expect(cmd.acceptsArgs).toBe(true);
  });

  it("/list-brain has correct metadata", () => {
    const cmd = api._commands.get("list-brain")!;
    expect(cmd.name).toBe("list-brain");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/list-brain");
    expect(cmd.usage).toContain("--tags");
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

  it("/tags-brain has correct metadata", () => {
    const cmd = api._commands.get("tags-brain")!;
    expect(cmd.name).toBe("tags-brain");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/tags-brain");
    expect(cmd.requireAuth).toBe(false);
    expect(cmd.acceptsArgs).toBe(false);
  });

  it("/export-brain has correct metadata", () => {
    const cmd = api._commands.get("export-brain")!;
    expect(cmd.name).toBe("export-brain");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/export-brain");
    expect(cmd.usage).toContain("--tags");
    expect(cmd.requireAuth).toBe(false);
    expect(cmd.acceptsArgs).toBe(true);
  });

  it("/import-brain has correct metadata", () => {
    const cmd = api._commands.get("import-brain")!;
    expect(cmd.name).toBe("import-brain");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/import-brain");
    expect(cmd.requireAuth).toBe(true);
    expect(cmd.acceptsArgs).toBe(true);
  });
});

describe("tag-based filtering - /remember-brain --tags", () => {
  let api: MockApi;

  beforeEach(() => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);
  });

  it("stores a memory with custom tags merged with defaults", async () => {
    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "Architecture decision about caching --tags arch,caching" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "Architecture caching" } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[]; text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.tags).toContain("brain");
    expect(data.hits[0]!.tags).toContain("arch");
    expect(data.hits[0]!.tags).toContain("caching");
  });

  it("does not duplicate default tags when specified in --tags", async () => {
    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "Note about brain patterns --tags brain,extra" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "brain patterns" } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[] }> };
    expect(data.hits.length).toBeGreaterThan(0);
    const tags = data.hits[0]!.tags;
    expect(tags.filter((t) => t === "brain").length).toBe(1);
    expect(tags).toContain("extra");
  });

  it("stores only default tags when --tags is not provided", async () => {
    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "Simple note without extra tags" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "Simple note" } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[] }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.tags).toEqual(["brain"]);
  });

  it("strips the --tags flag from the stored text", async () => {
    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "Important API decision --tags api,decisions" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "Important API" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.text).not.toContain("--tags");
    expect(data.hits[0]!.text).toContain("Important API decision");
  });
});

describe("tag-based filtering - /search-brain --tags", () => {
  let api: MockApi;

  beforeEach(async () => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "TypeScript project setup for team --tags typescript,setup" });
    await cmd.handler({ args: "Decision about database choice for project --tags database,decisions" });
    await cmd.handler({ args: "TypeScript coding standards reference --tags typescript,standards" });
  });

  it("filters search results by a single tag", async () => {
    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "project --tags database" });
    expect(result.text).toContain("Brain memory results");
    expect(result.text).toContain("database");
    expect(result.text).not.toContain("setup");
  });

  it("filters search results by multiple tags (AND logic)", async () => {
    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "TypeScript --tags typescript,setup" });
    expect(result.text).toContain("Brain memory results");
    expect(result.text).toContain("setup");
  });

  it("returns no results when tag does not match any items", async () => {
    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "TypeScript --tags nonexistent" });
    expect(result.text).toContain("No brain memories found");
  });

  it("searches without filtering when --tags is not provided", async () => {
    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "TypeScript" });
    expect(result.text).toContain("Brain memory results");
  });
});

describe("tag-based filtering - /list-brain --tags", () => {
  let api: MockApi;

  beforeEach(async () => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "First note about APIs --tags api" });
    await cmd.handler({ args: "Second note about databases --tags database" });
    await cmd.handler({ args: "Third note about API design --tags api,design" });
  });

  it("filters list by a single tag", async () => {
    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({ args: "--tags api" });
    expect(result.text).toContain("Brain memories (2)");
    expect(result.text).toContain("APIs");
    expect(result.text).toContain("API design");
  });

  it("filters list by multiple tags (AND logic)", async () => {
    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({ args: "--tags api,design" });
    expect(result.text).toContain("Brain memories (1)");
    expect(result.text).toContain("API design");
  });

  it("returns empty message when no items match the tag filter", async () => {
    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({ args: "--tags nonexistent" });
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("lists all items when --tags is not provided", async () => {
    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Brain memories (3)");
  });

  it("combines --tags with a limit argument", async () => {
    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({ args: "--tags api 1" });
    expect(result.text).toContain("Brain memories (1)");
  });
});

describe("tag-based filtering - brain_memory_search tool with tags", () => {
  let api: MockApi;

  beforeEach(async () => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "Microservices architecture overview --tags arch,microservices" });
    await cmd.handler({ args: "Monolith architecture patterns --tags arch,monolith" });
    await cmd.handler({ args: "Database migration guide --tags database,guide" });
  });

  it("filters tool results by tags", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "architecture", tags: ["arch", "microservices"] } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[]; text: string }> };
    expect(data.hits.length).toBe(1);
    expect(data.hits[0]!.text).toContain("Microservices");
  });

  it("returns all matching items when tags is an empty array", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "architecture", tags: [] } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThanOrEqual(2);
  });

  it("returns all matching items when tags is not provided", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "architecture" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThanOrEqual(2);
  });

  it("returns no hits when tags do not match any item", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "architecture", tags: ["nonexistent"] } as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits.length).toBe(0);
  });
});

describe("/tags-brain command", () => {
  it("returns no-tags message when store is empty", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("tags-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("No tags found");
  });

  it("lists all unique tags sorted alphabetically", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Note one --tags zebra,alpha" });
    await rememberCmd.handler({ args: "Note two --tags beta,alpha" });

    const cmd = api._commands.get("tags-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Tags (4)");
    expect(result.text).toContain("alpha");
    expect(result.text).toContain("beta");
    expect(result.text).toContain("brain");
    expect(result.text).toContain("zebra");
    // Verify alphabetical order
    const tagsPart = result.text.split(": ").slice(1).join(": ");
    const tagList = tagsPart.split(", ");
    expect(tagList).toEqual([...tagList].sort());
  });

  it("includes default tags in the listing", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Simple note without extra tags" });

    const cmd = api._commands.get("tags-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Tags (1)");
    expect(result.text).toContain("brain");
  });

  it("deduplicates tags across multiple items", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Note A --tags shared" });
    await rememberCmd.handler({ args: "Note B --tags shared" });
    await rememberCmd.handler({ args: "Note C --tags shared,unique" });

    const cmd = api._commands.get("tags-brain")!;
    const result = await cmd.handler({});
    // brain (default) + shared + unique = 3 unique tags
    expect(result.text).toContain("Tags (3)");
  });
});

// ---------------------------------------------------------------------------
// /export-brain command
// ---------------------------------------------------------------------------

describe("/export-brain command", () => {
  it("returns empty message when store has no items", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("export-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toBe("No brain memories to export.");
  });

  it("exports items as JSON with version envelope", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "First important memory to export" });
    await rememberCmd.handler({ args: "Second important memory to export" });

    const cmd = api._commands.get("export-brain")!;
    const result = await cmd.handler({});
    const payload = JSON.parse(result.text);

    expect(payload.version).toBe(1);
    expect(typeof payload.exportedAt).toBe("string");
    expect(payload.count).toBe(2);
    expect(payload.items).toHaveLength(2);
  });

  it("exported items contain required MemoryItem fields", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "A memory with all fields present" });

    const cmd = api._commands.get("export-brain")!;
    const result = await cmd.handler({});
    const payload = JSON.parse(result.text);
    const item = payload.items[0];

    expect(typeof item.id).toBe("string");
    expect(item.kind).toBe("note");
    expect(typeof item.text).toBe("string");
    expect(typeof item.createdAt).toBe("string");
    expect(Array.isArray(item.tags)).toBe(true);
  });

  it("filters export by --tags flag", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Work related note for export testing --tags work" });
    await rememberCmd.handler({ args: "Personal note should not appear in filtered export --tags personal" });

    const cmd = api._commands.get("export-brain")!;
    const result = await cmd.handler({ args: "--tags work" });
    const payload = JSON.parse(result.text);

    expect(payload.count).toBe(1);
    expect(payload.items[0].text).toContain("Work related");
  });

  it("returns empty message when tag filter matches nothing", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Some memory item for export" });

    const cmd = api._commands.get("export-brain")!;
    const result = await cmd.handler({ args: "--tags nonexistent" });
    expect(result.text).toBe("No brain memories to export.");
  });

  it("produces valid JSON that can be parsed back", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Memory with special chars: quotes \"hello\" and backslash \\" });

    const cmd = api._commands.get("export-brain")!;
    const result = await cmd.handler({});
    expect(() => JSON.parse(result.text)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// /import-brain command
// ---------------------------------------------------------------------------

describe("/import-brain command", () => {
  it("returns usage text when no args are provided", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("import-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Usage");
  });

  it("returns error on invalid JSON", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("import-brain")!;
    const result = await cmd.handler({ args: "not valid json {{{" });
    expect(result.text).toBe("Invalid JSON input.");
  });

  it("returns error when JSON is not an array or object with items", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("import-brain")!;
    const result = await cmd.handler({ args: '"just a string"' });
    expect(result.text).toContain("Expected a JSON array");
  });

  it("returns message when items array is empty", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("import-brain")!;
    const result = await cmd.handler({ args: "[]" });
    expect(result.text).toBe("No items to import.");
  });

  it("returns message for empty envelope format", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("import-brain")!;
    const result = await cmd.handler({ args: '{"version":1,"items":[]}' });
    expect(result.text).toBe("No items to import.");
  });

  it("imports items from a bare JSON array", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      { id: "imp-001", kind: "note", text: "Imported note one", createdAt: "2026-01-01T00:00:00Z", tags: ["imported"] },
      { id: "imp-002", kind: "fact", text: "Imported fact two", createdAt: "2026-01-02T00:00:00Z", tags: ["imported"] },
    ];
    const cmd = api._commands.get("import-brain")!;
    const result = await cmd.handler({ args: JSON.stringify(items) });
    expect(result.text).toContain("Imported 2 items.");

    // Verify they appear in list
    const listCmd = api._commands.get("list-brain")!;
    const listResult = await listCmd.handler({});
    expect(listResult.text).toContain("Imported note one");
    expect(listResult.text).toContain("Imported fact two");
  });

  it("imports items from an envelope object with version and items", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const payload = {
      version: 1,
      exportedAt: "2026-01-15T00:00:00Z",
      count: 1,
      items: [
        { id: "env-001", kind: "decision", text: "Use TypeScript for all projects", createdAt: "2026-01-15T00:00:00Z", tags: ["dev"] },
      ],
    };
    const cmd = api._commands.get("import-brain")!;
    const result = await cmd.handler({ args: JSON.stringify(payload) });
    expect(result.text).toContain("Imported 1 item.");
  });

  it("skips items that already exist by ID", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      { id: "dup-001", kind: "note", text: "Original item for dedup test", createdAt: "2026-01-01T00:00:00Z" },
    ];

    const cmd = api._commands.get("import-brain")!;
    // First import
    await cmd.handler({ args: JSON.stringify(items) });
    // Second import - same ID should be skipped
    const result = await cmd.handler({ args: JSON.stringify(items) });
    expect(result.text).toContain("Imported 0 items.");
    expect(result.text).toContain("1 skipped (already exist)");
  });

  it("skips invalid entries and reports count", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      { id: "val-001", kind: "note", text: "Valid item for import", createdAt: "2026-01-01T00:00:00Z" },
      { id: "val-002", kind: "note", text: "", createdAt: "2026-01-01T00:00:00Z" }, // empty text
      null, // null entry
      { id: "val-003", kind: "note", text: "Missing date" }, // no createdAt
      42, // not an object
    ];

    const cmd = api._commands.get("import-brain")!;
    const result = await cmd.handler({ args: JSON.stringify(items) });
    expect(result.text).toContain("Imported 1 item.");
    expect(result.text).toContain("4 skipped (invalid format)");
  });

  it("assigns default tags when imported items have no tags", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      { id: "tag-001", kind: "note", text: "Item without tags for import test", createdAt: "2026-01-01T00:00:00Z" },
    ];

    const cmd = api._commands.get("import-brain")!;
    await cmd.handler({ args: JSON.stringify(items) });

    // Search for the item and verify default tags
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "without tags" } as ToolCallParams);
    const hits = (result as { hits: Array<{ tags: string[] }> }).hits;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.tags).toContain("brain");
  });

  it("preserves kind field from imported items", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      { id: "kind-001", kind: "decision", text: "A decision item for kind test", createdAt: "2026-01-01T00:00:00Z", tags: ["test"] },
    ];

    const cmd = api._commands.get("import-brain")!;
    await cmd.handler({ args: JSON.stringify(items) });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.handler({ query: "decision item kind" } as ToolCallParams);
    const hits = (result as { hits: Array<{ id: string }> }).hits;
    expect(hits.some((h) => h.id === "kind-001")).toBe(true);
  });

  it("defaults kind to 'note' for invalid kind values", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      { id: "kindinv-001", kind: "invalid_kind", text: "Item with invalid kind value", createdAt: "2026-01-01T00:00:00Z", tags: ["test"] },
    ];

    const cmd = api._commands.get("import-brain")!;
    const result = await cmd.handler({ args: JSON.stringify(items) });
    expect(result.text).toContain("Imported 1 item.");
  });

  it("generates a UUID for items without an id field", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      { kind: "note", text: "Item missing id field for import", createdAt: "2026-01-01T00:00:00Z", tags: ["noid"] },
    ];

    const cmd = api._commands.get("import-brain")!;
    const result = await cmd.handler({ args: JSON.stringify(items) });
    expect(result.text).toContain("Imported 1 item.");

    const listCmd = api._commands.get("list-brain")!;
    const listResult = await listCmd.handler({});
    expect(listResult.text).toContain("Item missing id");
  });

  it("requires auth (requireAuth is true)", () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("import-brain")!;
    expect(cmd.requireAuth).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Export/import round-trip
// ---------------------------------------------------------------------------

describe("export/import round-trip", () => {
  it("exports then imports items into a fresh store without data loss", async () => {
    // Source store: create items
    const sourceApi = createMockApi({ storePath: tempStorePath() });
    register(sourceApi);

    const rememberCmd = sourceApi._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Round-trip memory alpha --tags roundtrip,alpha" });
    await rememberCmd.handler({ args: "Round-trip memory beta --tags roundtrip,beta" });

    // Export from source
    const exportCmd = sourceApi._commands.get("export-brain")!;
    const exportResult = await exportCmd.handler({});
    const exportedJson = exportResult.text;

    // Target store: import the exported data
    const targetApi = createMockApi({ storePath: tempStorePath() });
    register(targetApi);

    const importCmd = targetApi._commands.get("import-brain")!;
    const importResult = await importCmd.handler({ args: exportedJson });
    expect(importResult.text).toContain("Imported 2 items.");

    // Verify items exist in target
    const listCmd = targetApi._commands.get("list-brain")!;
    const listResult = await listCmd.handler({});
    expect(listResult.text).toContain("Round-trip memory alpha");
    expect(listResult.text).toContain("Round-trip memory beta");
  });

  it("re-importing the same export is idempotent (all skipped)", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Idempotent round-trip test memory" });

    const exportCmd = api._commands.get("export-brain")!;
    const exportResult = await exportCmd.handler({});
    const exportedJson = exportResult.text;

    // Import back into same store - should skip all
    const importCmd = api._commands.get("import-brain")!;
    const importResult = await importCmd.handler({ args: exportedJson });
    expect(importResult.text).toContain("Imported 0 items.");
    expect(importResult.text).toContain("1 skipped (already exist)");
  });
});

// ---------------------------------------------------------------------------
// Retention policy - /purge-brain command
// ---------------------------------------------------------------------------

describe("/purge-brain command", () => {
  it("returns not-configured message when maxAgeDays is 0 (default)", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("purge-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Retention policy is not configured");
  });

  it("returns not-configured message when retention is not set", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("purge-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Set retention.maxAgeDays");
  });

  it("deletes items older than maxAgeDays", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: 30 },
    });
    register(api);

    // Import items with old and recent dates
    const importCmd = api._commands.get("import-brain")!;
    const now = new Date();
    const oldDate = new Date(now.getTime() - 60 * 86_400_000).toISOString(); // 60 days ago
    const recentDate = new Date(now.getTime() - 5 * 86_400_000).toISOString(); // 5 days ago

    const items = [
      { id: "old-001", kind: "note", text: "Old item that should be purged", createdAt: oldDate, tags: ["brain"] },
      { id: "old-002", kind: "note", text: "Another old item to purge", createdAt: oldDate, tags: ["brain"] },
      { id: "recent-001", kind: "note", text: "Recent item that should survive", createdAt: recentDate, tags: ["brain"] },
    ];
    await importCmd.handler({ args: JSON.stringify(items) });

    // Verify all 3 items exist
    const listCmd = api._commands.get("list-brain")!;
    const beforeResult = await listCmd.handler({});
    expect(beforeResult.text).toContain("Brain memories (3)");

    // Run purge
    const purgeCmd = api._commands.get("purge-brain")!;
    const purgeResult = await purgeCmd.handler({});
    expect(purgeResult.text).toContain("Purged 2 item(s)");
    expect(purgeResult.text).toContain("older than 30 day(s)");
    expect(purgeResult.text).toContain("1 item(s) remaining");

    // Verify only recent item remains
    const afterResult = await listCmd.handler({});
    expect(afterResult.text).toContain("Brain memories (1)");
    expect(afterResult.text).toContain("Recent item");
  });

  it("reports no items to purge when all items are recent", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: 30 },
    });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "A fresh note added today" });

    const cmd = api._commands.get("purge-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("No items older than 30 day(s)");
    expect(result.text).toContain("1 item(s) in store");
  });

  it("supports --dry-run to preview without deleting", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: 10 },
    });
    register(api);

    const importCmd = api._commands.get("import-brain")!;
    const oldDate = new Date(Date.now() - 20 * 86_400_000).toISOString();
    await importCmd.handler({
      args: JSON.stringify([
        { id: "dry-001", kind: "note", text: "Old item for dry run test", createdAt: oldDate, tags: ["brain"] },
      ]),
    });

    const cmd = api._commands.get("purge-brain")!;
    const result = await cmd.handler({ args: "--dry-run" });
    expect(result.text).toContain("Dry run");
    expect(result.text).toContain("1 of 1 item(s) would be deleted");

    // Verify item was NOT actually deleted
    const listCmd = api._commands.get("list-brain")!;
    const listResult = await listCmd.handler({});
    expect(listResult.text).toContain("Brain memories (1)");
  });

  it("has requireAuth set to true", () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("purge-brain")!;
    expect(cmd.requireAuth).toBe(true);
  });

  it("has correct metadata", () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("purge-brain")!;
    expect(cmd.name).toBe("purge-brain");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/purge-brain");
    expect(cmd.usage).toContain("--dry-run");
    expect(cmd.requireAuth).toBe(true);
    expect(cmd.acceptsArgs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retention policy - startup auto-cleanup
// ---------------------------------------------------------------------------

describe("retention policy - startup cleanup", () => {
  it("deletes expired items on startup when maxAgeDays is configured", async () => {
    const storePath = tempStorePath();

    // First, create items with old dates in the store (no retention)
    const setupApi = createMockApi({ storePath });
    register(setupApi);

    const importCmd = setupApi._commands.get("import-brain")!;
    const oldDate = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const recentDate = new Date().toISOString();
    await importCmd.handler({
      args: JSON.stringify([
        { id: "startup-old", kind: "note", text: "Old startup item", createdAt: oldDate, tags: ["brain"] },
        { id: "startup-new", kind: "note", text: "New startup item", createdAt: recentDate, tags: ["brain"] },
      ]),
    });

    // Now register with retention enabled - it should auto-purge on startup
    const retentionApi = createMockApi({
      storePath,
      retention: { maxAgeDays: 30 },
    });
    register(retentionApi);

    // Wait for the async startup retention to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the old item was deleted
    const listCmd = retentionApi._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
    expect(result.text).toContain("New startup item");
    expect(result.text).not.toContain("Old startup item");
  });

  it("logs retention info on startup when items are deleted", async () => {
    const storePath = tempStorePath();

    // Pre-seed the store with old items
    const setupApi = createMockApi({ storePath });
    register(setupApi);

    const importCmd = setupApi._commands.get("import-brain")!;
    const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
    await importCmd.handler({
      args: JSON.stringify([
        { id: "log-old-001", kind: "note", text: "Old item for log test", createdAt: oldDate, tags: ["brain"] },
      ]),
    });

    // Register with retention
    const retentionApi = createMockApi({
      storePath,
      retention: { maxAgeDays: 7 },
    });
    register(retentionApi);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(retentionApi.logger?.info).toHaveBeenCalledWith(
      expect.stringContaining("[memory-brain] retention: deleted 1 expired item(s)"),
    );
  });

  it("does not run startup retention when maxAgeDays is 0", async () => {
    const storePath = tempStorePath();

    // Pre-seed
    const setupApi = createMockApi({ storePath });
    register(setupApi);

    const importCmd = setupApi._commands.get("import-brain")!;
    const oldDate = new Date(Date.now() - 365 * 86_400_000).toISOString();
    await importCmd.handler({
      args: JSON.stringify([
        { id: "nopurge-001", kind: "note", text: "Very old item but no retention", createdAt: oldDate, tags: ["brain"] },
      ]),
    });

    // Register without retention config
    const noRetentionApi = createMockApi({ storePath });
    register(noRetentionApi);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Old item should still exist
    const listCmd = noRetentionApi._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Very old item");
  });

  it("does not log when no items are expired on startup", async () => {
    const storePath = tempStorePath();

    // Pre-seed with a recent item
    const setupApi = createMockApi({ storePath });
    register(setupApi);

    const rememberCmd = setupApi._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Fresh item for startup test" });

    // Register with retention
    const retentionApi = createMockApi({
      storePath,
      retention: { maxAgeDays: 30 },
    });
    register(retentionApi);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should NOT have logged a retention deletion message (only the startup enabled message)
    const infoCalls = (retentionApi.logger?.info as ReturnType<typeof vi.fn>).mock.calls;
    const retentionLogs = infoCalls.filter((call: unknown[]) =>
      typeof call[0] === "string" && call[0].includes("retention: deleted"),
    );
    expect(retentionLogs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Retention policy - edge cases
// ---------------------------------------------------------------------------

describe("retention policy - edge cases", () => {
  it("handles items with invalid createdAt gracefully (does not purge them)", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: 30 },
    });
    register(api);

    const importCmd = api._commands.get("import-brain")!;
    await importCmd.handler({
      args: JSON.stringify([
        { id: "bad-date-001", kind: "note", text: "Item with bad date", createdAt: "not-a-date", tags: ["brain"] },
      ]),
    });

    const purgeCmd = api._commands.get("purge-brain")!;
    const result = await purgeCmd.handler({});
    expect(result.text).toContain("No items older than 30 day(s)");

    // Item should still exist
    const listCmd = api._commands.get("list-brain")!;
    const listResult = await listCmd.handler({});
    expect(listResult.text).toContain("Item with bad date");
  });

  it("purge on an empty store reports no items", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: 30 },
    });
    register(api);

    const cmd = api._commands.get("purge-brain")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("No items older than 30 day(s)");
    expect(result.text).toContain("0 item(s) in store");
  });

  it("purges all items when all are older than maxAgeDays", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: 1 },
    });
    register(api);

    const importCmd = api._commands.get("import-brain")!;
    const oldDate = new Date(Date.now() - 5 * 86_400_000).toISOString();
    await importCmd.handler({
      args: JSON.stringify([
        { id: "allold-001", kind: "note", text: "All old item one", createdAt: oldDate, tags: ["brain"] },
        { id: "allold-002", kind: "note", text: "All old item two", createdAt: oldDate, tags: ["brain"] },
      ]),
    });

    const purgeCmd = api._commands.get("purge-brain")!;
    const result = await purgeCmd.handler({});
    expect(result.text).toContain("Purged 2 item(s)");
    expect(result.text).toContain("0 item(s) remaining");

    // Store should be empty
    const listCmd = api._commands.get("list-brain")!;
    const listResult = await listCmd.handler({});
    expect(listResult.text).toContain("No brain memories stored yet");
  });
});
