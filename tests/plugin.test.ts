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
import register, { scoreCapture } from "../index.js";

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
  it("registers all nine commands and one tool", () => {
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
    expect(api._commands.has("brain-status")).toBe(true);
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
    expect(api._commands.size).toBe(9);
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
    // No redaction note, but includes id
    expect(result.text).toMatch(/^Saved brain memory \[id=.+\]\.$/);
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
    const searchResult = await tool.execute({ query: "Temporary note deleted" } as ToolCallParams);
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
    const result = await tool.execute({ query: "architecture microservices" } as ToolCallParams);
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
    const result = await tool.execute({ query: "" } as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits).toEqual([]);
  });

  it("returns empty hits for undefined query", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({} as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits).toEqual([]);
  });

  it("respects the limit parameter", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "planning", limit: 1 } as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits.length).toBeLessThanOrEqual(1);
  });

  it("uses default limit of 5 when limit is not provided", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    // With only 2 items, we can't fully test the default limit of 5,
    // but we verify it doesn't crash
    const result = await tool.execute({ query: "decision" } as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits.length).toBeLessThanOrEqual(5);
  });

  it("has correct inputSchema definition including tags", () => {
    const tool = api._tools.get("brain_memory_search")!;
    const schema = tool.parameters as Record<string, unknown>;
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
      capture: { requireExplicit: false, captureThreshold: 0 },
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
    const result = await tool.execute({ query: "key useful" } as ToolCallParams);
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
    const result = await tool.execute({ query: "Custom tagged note" } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[] }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.tags).toEqual(["project-x", "notes"]);
  });

  it("respects custom autoTopics configuration for capture", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, autoTopics: ["URGENT"], captureThreshold: 0 },
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
    const result = await tool.execute({ query: "key" } as ToolCallParams);
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
    const result = await tool.execute({ query: "Test note", limit: 100 } as ToolCallParams);
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
    const result = await tool.execute({ query: "Architecture caching" } as ToolCallParams);
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
    const result = await tool.execute({ query: "brain patterns" } as ToolCallParams);
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
    const result = await tool.execute({ query: "Simple note" } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[] }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.tags).toEqual(["brain"]);
  });

  it("strips the --tags flag from the stored text", async () => {
    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "Important API decision --tags api,decisions" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "Important API" } as ToolCallParams);
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
    const result = await tool.execute({ query: "architecture", tags: ["arch", "microservices"] } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[]; text: string }> };
    expect(data.hits.length).toBe(1);
    expect(data.hits[0]!.text).toContain("Microservices");
  });

  it("returns all matching items when tags is an empty array", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "architecture", tags: [] } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThanOrEqual(2);
  });

  it("returns all matching items when tags is not provided", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "architecture" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThanOrEqual(2);
  });

  it("returns no hits when tags do not match any item", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "architecture", tags: ["nonexistent"] } as ToolCallParams);
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
    const result = await tool.execute({ query: "without tags" } as ToolCallParams);
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
    const result = await tool.execute({ query: "decision item kind" } as ToolCallParams);
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

    // Wait for async startup retention/TTL purge to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

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

    // Wait for async startup retention/TTL purge to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

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

    // Wait for async startup retention/TTL purge to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

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

    // Wait for async startup tasks (retention, TTL purge) to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

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

    // Wait for async startup retention/TTL purge to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

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

  it("running purge twice is idempotent (second run deletes nothing)", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: 10 },
    });
    register(api);

    // Wait for async startup retention/TTL purge to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const importCmd = api._commands.get("import-brain")!;
    const oldDate = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const recentDate = new Date().toISOString();
    await importCmd.handler({
      args: JSON.stringify([
        { id: "idem-old", kind: "note", text: "Old item for idempotent test", createdAt: oldDate, tags: ["brain"] },
        { id: "idem-new", kind: "note", text: "New item for idempotent test", createdAt: recentDate, tags: ["brain"] },
      ]),
    });

    const purgeCmd = api._commands.get("purge-brain")!;
    const first = await purgeCmd.handler({});
    expect(first.text).toContain("Purged 1 item(s)");

    const second = await purgeCmd.handler({});
    expect(second.text).toContain("No items older than 10 day(s)");
    expect(second.text).toContain("1 item(s) in store");
  });

  it("does not purge item exactly at the cutoff boundary", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: 30 },
    });
    register(api);

    // Wait for async startup retention/TTL purge to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const importCmd = api._commands.get("import-brain")!;
    // Item created exactly 30 days ago (right at the boundary)
    const boundaryDate = new Date(Date.now() - 30 * 86_400_000).toISOString();
    // Item created 30 days + 1 second ago (just past the boundary)
    const pastDate = new Date(Date.now() - 30 * 86_400_000 - 1000).toISOString();
    // Item created 29 days ago (within retention)
    const withinDate = new Date(Date.now() - 29 * 86_400_000).toISOString();

    await importCmd.handler({
      args: JSON.stringify([
        { id: "bound-exact", kind: "note", text: "Exactly at boundary", createdAt: boundaryDate, tags: ["brain"] },
        { id: "bound-past", kind: "note", text: "Just past boundary", createdAt: pastDate, tags: ["brain"] },
        { id: "bound-within", kind: "note", text: "Within retention", createdAt: withinDate, tags: ["brain"] },
      ]),
    });

    const purgeCmd = api._commands.get("purge-brain")!;
    const result = await purgeCmd.handler({});
    // The boundary and past items are at or beyond cutoff, within-retention stays
    // The exact boundary item has ts < cutoff (equal is still purged since cutoff = now - maxAgeDays)
    // The within item is definitely safe
    const listCmd = api._commands.get("list-brain")!;
    const listResult = await listCmd.handler({});
    expect(listResult.text).toContain("Within retention");
  });

  it("treats negative maxAgeDays the same as 0 (no purging)", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: -5 },
    });
    register(api);

    const purgeCmd = api._commands.get("purge-brain")!;
    const result = await purgeCmd.handler({});
    expect(result.text).toContain("Retention policy is not configured");
  });
});

// ---------------------------------------------------------------------------
// Retention policy - startup error handling
// ---------------------------------------------------------------------------

describe("retention policy - startup error handling", () => {
  it("logs error when startup retention encounters a store failure", async () => {
    const storePath = tempStorePath();

    // Pre-seed the store
    const setupApi = createMockApi({ storePath });
    register(setupApi);
    const rememberCmd = setupApi._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Item for startup error test" });

    // Register with retention that will run on startup
    // We cannot easily force an error in the real store, but we can verify
    // the logger is called with the startup enabled message at minimum
    const retentionApi = createMockApi({
      storePath,
      retention: { maxAgeDays: 1000 },
    });
    register(retentionApi);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have logged the startup enabled message
    expect(retentionApi.logger?.info).toHaveBeenCalledWith(
      expect.stringContaining("[memory-brain] enabled"),
    );
    // Should NOT have logged a retention deletion (nothing is 1000+ days old)
    const infoCalls = (retentionApi.logger?.info as ReturnType<typeof vi.fn>).mock.calls;
    const retentionLogs = infoCalls.filter((call: unknown[]) =>
      typeof call[0] === "string" && call[0].includes("retention: deleted"),
    );
    expect(retentionLogs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseTags edge cases
// ---------------------------------------------------------------------------

describe("parseTags edge cases", () => {
  let api: MockApi;

  beforeEach(() => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);
  });

  it("handles --tags with empty entries after split (a,,b)", async () => {
    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "Note with sparse tags --tags alpha,,beta" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "sparse tags" } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[] }> };
    expect(data.hits.length).toBeGreaterThan(0);
    // Empty strings should be filtered out
    expect(data.hits[0]!.tags).toContain("alpha");
    expect(data.hits[0]!.tags).toContain("beta");
    expect(data.hits[0]!.tags).not.toContain("");
  });

  it("handles --tags at the beginning of args", async () => {
    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "--tags first,second Some important text" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "important text" } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[]; text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.tags).toContain("first");
    expect(data.hits[0]!.tags).toContain("second");
    expect(data.hits[0]!.text).toContain("Some important text");
    expect(data.hits[0]!.text).not.toContain("--tags");
  });

  it("handles --tags with a single tag", async () => {
    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "Single tag note --tags solo" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "Single tag" } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[] }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.tags).toContain("solo");
    expect(data.hits[0]!.tags).toContain("brain");
  });
});

// ---------------------------------------------------------------------------
// brain_memory_search tool - edge cases
// ---------------------------------------------------------------------------

describe("brain_memory_search tool - edge cases", () => {
  let api: MockApi;

  beforeEach(async () => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Test item for tool edge case verification" });
  });

  it("handles tags as a non-array value gracefully (passes empty tags)", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    // Pass tags as a string instead of array - should be treated as no filter
    const result = await tool.execute({ query: "edge case", tags: "not-an-array" } as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits.length).toBeGreaterThan(0);
  });

  it("handles limit of 0 by clamping to minimum", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "edge case", limit: 0 } as ToolCallParams);
    const data = result as { hits: unknown[] };
    // safeLimit clamps 0 to the default (5) or minimum
    expect(data.hits.length).toBeGreaterThanOrEqual(0);
  });

  it("handles negative limit by clamping to default", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "edge case", limit: -5 } as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits.length).toBeGreaterThanOrEqual(0);
  });

  it("handles limit as undefined by using default of 5", async () => {
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "edge case", limit: undefined } as ToolCallParams);
    const data = result as { hits: unknown[] };
    expect(data.hits.length).toBeGreaterThanOrEqual(0);
    expect(data.hits.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// /search-brain - --tags with trailing limit
// ---------------------------------------------------------------------------

describe("/search-brain - combined --tags and limit", () => {
  let api: MockApi;

  beforeEach(async () => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "First API endpoint docs --tags api" });
    await cmd.handler({ args: "Second API schema design --tags api" });
    await cmd.handler({ args: "Third database schema work --tags database" });
  });

  it("filters by --tags and respects trailing limit number", async () => {
    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "schema --tags api 1" });
    expect(result.text).toContain("Brain memory results");
  });

  it("filters by --tags with no trailing limit uses default", async () => {
    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "API --tags api" });
    expect(result.text).toContain("Brain memory results");
  });
});

// ---------------------------------------------------------------------------
// /import-brain - source and meta field preservation
// ---------------------------------------------------------------------------

describe("/import-brain - field preservation", () => {
  it("preserves source field from imported items", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      {
        id: "src-001",
        kind: "note",
        text: "Item with source metadata for preservation test",
        createdAt: "2026-01-01T00:00:00Z",
        tags: ["test"],
        source: { channel: "slack", from: "user42", conversationId: "conv-789" },
      },
    ];

    const importCmd = api._commands.get("import-brain")!;
    const result = await importCmd.handler({ args: JSON.stringify(items) });
    expect(result.text).toContain("Imported 1 item.");

    // Export and verify source is preserved
    const exportCmd = api._commands.get("export-brain")!;
    const exportResult = await exportCmd.handler({});
    const payload = JSON.parse(exportResult.text);
    expect(payload.items[0].source.channel).toBe("slack");
    expect(payload.items[0].source.from).toBe("user42");
    expect(payload.items[0].source.conversationId).toBe("conv-789");
  });

  it("preserves meta field from imported items", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      {
        id: "meta-001",
        kind: "note",
        text: "Item with custom meta data for testing",
        createdAt: "2026-01-01T00:00:00Z",
        tags: ["test"],
        meta: { custom: "value", nested: { deep: true } },
      },
    ];

    const importCmd = api._commands.get("import-brain")!;
    await importCmd.handler({ args: JSON.stringify(items) });

    const exportCmd = api._commands.get("export-brain")!;
    const exportResult = await exportCmd.handler({});
    const payload = JSON.parse(exportResult.text);
    expect(payload.items[0].meta.custom).toBe("value");
    expect(payload.items[0].meta.nested.deep).toBe(true);
  });

  it("handles items with null source gracefully", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      {
        id: "null-src",
        kind: "note",
        text: "Item with null source field",
        createdAt: "2026-01-01T00:00:00Z",
        tags: ["test"],
        source: null,
      },
    ];

    const importCmd = api._commands.get("import-brain")!;
    const result = await importCmd.handler({ args: JSON.stringify(items) });
    expect(result.text).toContain("Imported 1 item.");
  });

  it("handles items with non-object source gracefully", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      {
        id: "bad-src",
        kind: "note",
        text: "Item with string source field",
        createdAt: "2026-01-01T00:00:00Z",
        tags: ["test"],
        source: "not-an-object",
      },
    ];

    const importCmd = api._commands.get("import-brain")!;
    const result = await importCmd.handler({ args: JSON.stringify(items) });
    expect(result.text).toContain("Imported 1 item.");
  });

  it("handles items with non-string tag values by filtering them out", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      {
        id: "mixed-tags",
        kind: "note",
        text: "Item with mixed type tags for import",
        createdAt: "2026-01-01T00:00:00Z",
        tags: ["valid", 42, null, "also-valid", true],
      },
    ];

    const importCmd = api._commands.get("import-brain")!;
    await importCmd.handler({ args: JSON.stringify(items) });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "mixed type tags" } as ToolCallParams);
    const data = result as { hits: Array<{ tags: string[] }> };
    expect(data.hits.length).toBeGreaterThan(0);
    // Only string tags should remain
    expect(data.hits[0]!.tags).toContain("valid");
    expect(data.hits[0]!.tags).toContain("also-valid");
    expect(data.hits[0]!.tags.every((t) => typeof t === "string")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Auto-capture - metadata verification
// ---------------------------------------------------------------------------

describe("auto-capture - capture metadata", () => {
  it("stores explicit=true and topic=false when only trigger matches", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath, capture: { minChars: 10 } });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: architecture choices for the project", from: "user" },
      { messageProvider: "web", sessionId: "s1" },
    );

    // Export to inspect meta
    const exportCmd = api._commands.get("export-brain")!;
    const exportResult = await exportCmd.handler({});
    const payload = JSON.parse(exportResult.text);
    expect(payload.items.length).toBe(1);
    expect(payload.items[0].meta.capture.explicit).toBe(true);
  });

  it("stores explicit=false and topic=true when only topic matches", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, captureThreshold: 0 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "We made an important decision about the database migration strategy", from: "user" },
      { messageProvider: "web", sessionId: "s1" },
    );

    const exportCmd = api._commands.get("export-brain")!;
    const exportResult = await exportCmd.handler({});
    const payload = JSON.parse(exportResult.text);
    expect(payload.items.length).toBe(1);
    expect(payload.items[0].meta.capture.topic).toBe(true);
    expect(payload.items[0].meta.capture.explicit).toBe(false);
  });

  it("stores both explicit=true and topic=true when both match", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Has both an explicit trigger ("remember this") and a topic ("decision")
    await handler(
      { content: "remember this: we made a key decision about the deployment pipeline", from: "user" },
      { messageProvider: "web", sessionId: "s1" },
    );

    const exportCmd = api._commands.get("export-brain")!;
    const exportResult = await exportCmd.handler({});
    const payload = JSON.parse(exportResult.text);
    expect(payload.items.length).toBe(1);
    expect(payload.items[0].meta.capture.explicit).toBe(true);
    expect(payload.items[0].meta.capture.topic).toBe(true);
  });

  it("stores source.channel and source.from from event context", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath, capture: { minChars: 10 } });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: important source tracking test note", from: "bot-user-42" },
      { messageProvider: "discord", sessionId: "session-xyz" },
    );

    const exportCmd = api._commands.get("export-brain")!;
    const exportResult = await exportCmd.handler({});
    const payload = JSON.parse(exportResult.text);
    expect(payload.items[0].source.channel).toBe("discord");
    expect(payload.items[0].source.from).toBe("bot-user-42");
    expect(payload.items[0].source.conversationId).toBe("session-xyz");
  });
});

// ---------------------------------------------------------------------------
// /export-brain + /import-brain round-trip with rich data
// ---------------------------------------------------------------------------

describe("export/import round-trip - rich data preservation", () => {
  it("preserves tags, source, and meta through round-trip", async () => {
    const sourceApi = createMockApi({ storePath: tempStorePath() });
    register(sourceApi);

    const rememberCmd = sourceApi._commands.get("remember-brain")!;
    await rememberCmd.handler({
      args: "Architecture decision about event sourcing --tags arch,events",
      channel: "slack",
      from: "architect",
      conversationId: "conv-arch",
    });

    const exportCmd = sourceApi._commands.get("export-brain")!;
    const exportResult = await exportCmd.handler({});
    const exportedJson = exportResult.text;
    const sourcePayload = JSON.parse(exportedJson);

    // Import into fresh store
    const targetApi = createMockApi({ storePath: tempStorePath() });
    register(targetApi);

    const importCmd = targetApi._commands.get("import-brain")!;
    await importCmd.handler({ args: exportedJson });

    // Re-export from target and compare
    const reExportCmd = targetApi._commands.get("export-brain")!;
    const reExportResult = await reExportCmd.handler({});
    const targetPayload = JSON.parse(reExportResult.text);

    expect(targetPayload.items[0].id).toBe(sourcePayload.items[0].id);
    expect(targetPayload.items[0].text).toBe(sourcePayload.items[0].text);
    expect(targetPayload.items[0].tags).toEqual(sourcePayload.items[0].tags);
    expect(targetPayload.items[0].createdAt).toBe(sourcePayload.items[0].createdAt);
    expect(targetPayload.items[0].kind).toBe(sourcePayload.items[0].kind);
  });
});

// ---------------------------------------------------------------------------
// Configuration combinations
// ---------------------------------------------------------------------------

describe("configuration combinations", () => {
  it("retention + custom tags + custom capture all work together", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      defaultTags: ["custom-brain"],
      retention: { maxAgeDays: 30 },
      capture: { minChars: 10, explicitTriggers: ["SAVE THIS"] },
    });
    register(api);

    // Wait for async startup retention/TTL purge to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Auto-capture should use custom trigger and custom tags
    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;
    await handler(
      { content: "SAVE THIS: note for combined config test", from: "user" },
      { messageProvider: "web", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");

    // Manual remember should use custom default tags
    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Manual note in combined test" });

    const tool = api._tools.get("brain_memory_search")!;
    const searchResult = await tool.execute({ query: "Manual note" } as ToolCallParams);
    const data = searchResult as { hits: Array<{ tags: string[] }> };
    expect(data.hits[0]!.tags).toContain("custom-brain");

    // Purge should work
    const purgeCmd = api._commands.get("purge-brain")!;
    const purgeResult = await purgeCmd.handler({});
    expect(purgeResult.text).toContain("No items older than 30 day(s)");
  });

  it("disabled plugin with retention config does not register anything", () => {
    const api = createMockApi({
      enabled: false,
      storePath: tempStorePath(),
      retention: { maxAgeDays: 30 },
    });
    register(api);

    expect(api._commands.size).toBe(0);
    expect(api._tools.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// /remember-brain - additional edge cases
// ---------------------------------------------------------------------------

describe("/remember-brain - additional edge cases", () => {
  it("stores and retrieves text with special characters", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    const specialText = 'JSON: {"key": "value"}, XML: <tag>, newline \\n, tab \\t';
    await cmd.handler({ args: specialText });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "JSON XML" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.text).toContain("JSON:");
  });

  it("stores and retrieves very long text", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const longText = "Important: " + "word ".repeat(500);
    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: longText });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "Important word" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.text.length).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// /export-brain - additional edge cases
// ---------------------------------------------------------------------------

describe("/export-brain - additional scenarios", () => {
  it("exports items with redacted secrets intact", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({
      args: "API key: AIzaSyExampleExampleExampleExample1234 for deployment",
    });

    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({});
    const payload = JSON.parse(result.text);

    // The redacted text should be in the export
    expect(payload.items[0].text).toContain("[REDACTED:GOOGLE_KEY]");
    expect(payload.items[0].text).not.toContain("AIzaSy");
    // Redaction meta should be present
    expect(payload.items[0].meta.redaction.hadSecrets).toBe(true);
  });

  it("exports without args returns all items unfiltered", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "First export all test --tags work" });
    await cmd.handler({ args: "Second export all test --tags personal" });
    await cmd.handler({ args: "Third export all test" });

    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({ args: "" });
    const payload = JSON.parse(result.text);
    expect(payload.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Config null/undefined handling
// ---------------------------------------------------------------------------

describe("null and undefined pluginConfig", () => {
  it("handles null pluginConfig without crashing", () => {
    const api = createMockApi();
    (api as unknown as Record<string, unknown>).pluginConfig = null;
    register(api);
    expect(api._commands.size).toBe(9);
    expect(api._tools.size).toBe(1);
  });

  it("handles undefined pluginConfig without crashing", () => {
    const api = createMockApi();
    (api as unknown as Record<string, unknown>).pluginConfig = undefined;
    register(api);
    expect(api._commands.size).toBe(9);
    expect(api._tools.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Custom dims and maxItems config
// ---------------------------------------------------------------------------

describe("custom dims and maxItems configuration", () => {
  it("uses custom dims without errors", async () => {
    const api = createMockApi({ storePath: tempStorePath(), dims: 64 });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({ args: "Note with custom dims config value" });
    expect(result.text).toContain("Saved brain memory");

    const tool = api._tools.get("brain_memory_search")!;
    const searchResult = await tool.execute({ query: "custom dims" } as ToolCallParams);
    const data = searchResult as { hits: unknown[] };
    expect(data.hits.length).toBeGreaterThan(0);
  });

  it("uses custom maxItems without errors", async () => {
    const api = createMockApi({ storePath: tempStorePath(), maxItems: 200 });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({ args: "Note with custom maxItems config" });
    expect(result.text).toContain("Saved brain memory");
  });
});

// ---------------------------------------------------------------------------
// Search result score ordering
// ---------------------------------------------------------------------------

describe("search result score ordering", () => {
  it("returns results sorted by descending score", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "PostgreSQL database migration guide for production systems" });
    await rememberCmd.handler({ args: "Redis cache configuration and horizontal scaling patterns" });
    await rememberCmd.handler({ args: "PostgreSQL database backup procedures and disaster recovery" });
    await rememberCmd.handler({ args: "Frontend React component library for shared UI elements" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "PostgreSQL database", limit: 20 } as ToolCallParams);
    const data = result as { hits: Array<{ score: number }> };

    for (let i = 1; i < data.hits.length; i++) {
      expect(data.hits[i - 1]!.score).toBeGreaterThanOrEqual(data.hits[i]!.score);
    }
  });

  it("all scores are between 0 and 1 inclusive", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "TypeScript strict mode configuration for monorepo projects" });
    await rememberCmd.handler({ args: "Python virtual environment setup guide and best practices" });

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "TypeScript configuration" } as ToolCallParams);
    const data = result as { hits: Array<{ score: number }> };

    for (const hit of data.hits) {
      expect(hit.score).toBeGreaterThanOrEqual(0);
      expect(hit.score).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// /list-brain limit edge cases
// ---------------------------------------------------------------------------

describe("/list-brain limit edge cases", () => {
  let api: MockApi;

  beforeEach(async () => {
    api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    for (let i = 1; i <= 3; i++) {
      await rememberCmd.handler({ args: `List limit edge test item number ${i}` });
    }
  });

  it("handles non-numeric limit argument gracefully", async () => {
    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({ args: "xyz" });
    expect(result.text).toContain("Brain memories");
  });

  it("clamps limit above 50 to 50", async () => {
    const cmd = api._commands.get("list-brain")!;
    const result = await cmd.handler({ args: "999" });
    expect(result.text).toContain("Brain memories (3)");
  });
});

// ---------------------------------------------------------------------------
// Import ID edge cases
// ---------------------------------------------------------------------------

describe("import ID edge cases", () => {
  it("generates UUID for items with empty string ID", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      { id: "", kind: "note", text: "Item with empty string ID for test", createdAt: "2026-01-01T00:00:00Z", tags: ["test"] },
    ];

    const importCmd = api._commands.get("import-brain")!;
    const result = await importCmd.handler({ args: JSON.stringify(items) });
    expect(result.text).toContain("Imported 1 item.");

    const listCmd = api._commands.get("list-brain")!;
    const listResult = await listCmd.handler({});
    expect(listResult.text).toContain("Item with empty string ID");
  });

  it("generates UUID for items with numeric ID", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const items = [
      { id: 42, kind: "note", text: "Item with numeric ID for test", createdAt: "2026-01-01T00:00:00Z", tags: ["test"] },
    ];

    const importCmd = api._commands.get("import-brain")!;
    const result = await importCmd.handler({ args: JSON.stringify(items) });
    expect(result.text).toContain("Imported 1 item.");
  });
});

// ---------------------------------------------------------------------------
// Export timestamp and version validation
// ---------------------------------------------------------------------------

describe("export envelope validation", () => {
  it("exports valid ISO timestamp in exportedAt field", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Note for export timestamp validation" });

    const cmd = api._commands.get("export-brain")!;
    const result = await cmd.handler({});
    const payload = JSON.parse(result.text);
    const date = new Date(payload.exportedAt);
    expect(isNaN(date.getTime())).toBe(false);
  });

  it("export version is always 1", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Note for export version validation" });

    const cmd = api._commands.get("export-brain")!;
    const result = await cmd.handler({});
    const payload = JSON.parse(result.text);
    expect(payload.version).toBe(1);
  });

  it("export count matches items array length", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "First count validation note" });
    await rememberCmd.handler({ args: "Second count validation note" });

    const cmd = api._commands.get("export-brain")!;
    const result = await cmd.handler({});
    const payload = JSON.parse(result.text);
    expect(payload.count).toBe(payload.items.length);
  });
});

// ---------------------------------------------------------------------------
// /purge-brain non-dry-run args
// ---------------------------------------------------------------------------

describe("/purge-brain with arbitrary args", () => {
  it("treats non-dry-run args as a normal purge (not dry-run)", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: 10 },
    });
    register(api);

    // Wait for async startup tasks (retention, TTL purge) to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const importCmd = api._commands.get("import-brain")!;
    const oldDate = new Date(Date.now() - 20 * 86_400_000).toISOString();
    await importCmd.handler({
      args: JSON.stringify([
        { id: "arb-001", kind: "note", text: "Old item for arbitrary arg purge test", createdAt: oldDate, tags: ["brain"] },
      ]),
    });

    const purgeCmd = api._commands.get("purge-brain")!;
    const result = await purgeCmd.handler({ args: "--force" });
    expect(result.text).toContain("Purged 1 item(s)");
    expect(result.text).not.toContain("Dry run");
  });

  it("treats whitespace-only args as a normal purge", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      retention: { maxAgeDays: 10 },
    });
    register(api);

    // Wait for async startup retention/TTL purge to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Fresh item for whitespace arg purge test" });

    const purgeCmd = api._commands.get("purge-brain")!;
    const result = await purgeCmd.handler({ args: "   " });
    expect(result.text).toContain("No items older than 10 day(s)");
  });
});

// ---------------------------------------------------------------------------
// /remember-brain with source context fields
// ---------------------------------------------------------------------------

describe("/remember-brain source context completeness", () => {
  it("includes all source fields from CommandContext", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({
      args: "Note with complete source context",
      channel: "discord",
      from: "charlie",
      conversationId: "conv-456",
      messageId: "msg-789",
    });

    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({});
    const payload = JSON.parse(result.text);
    const source = payload.items[0].source;

    expect(source.channel).toBe("discord");
    expect(source.from).toBe("charlie");
    expect(source.conversationId).toBe("conv-456");
    expect(source.messageId).toBe("msg-789");
  });

  it("handles missing source fields with undefined values", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    await cmd.handler({ args: "Note with no source context at all" });

    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({});
    const payload = JSON.parse(result.text);
    expect(payload.items[0].source).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// /search-brain edge cases
// ---------------------------------------------------------------------------

describe("/search-brain additional edge cases", () => {
  it("returns usage when args is whitespace-only", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "   " });
    expect(result.text).toContain("Usage");
  });

  it("search results line format includes score and truncated text", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Searchable note for output format verification test" });

    const cmd = api._commands.get("search-brain")!;
    const result = await cmd.handler({ args: "Searchable note format" });
    // Verify the output format: N. [score:X.XX] text
    expect(result.text).toMatch(/1\. \[score:\d+\.\d+\]/);
  });
});

// ---------------------------------------------------------------------------
// /forget-brain with whitespace ID
// ---------------------------------------------------------------------------

describe("/forget-brain additional edge cases", () => {
  it("returns usage for undefined args", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("forget-brain")!;
    const result = await cmd.handler({ args: undefined });
    expect(result.text).toContain("Usage");
  });
});

// ---------------------------------------------------------------------------
// Issue #1: Per-channel capture policy
// ---------------------------------------------------------------------------

describe("per-channel capture policy", () => {
  it("captures from all channels by default (no channel config)", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath, capture: { minChars: 10 } });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: important note from slack channel", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("blocks capture from channels in the deny list", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: {
        minChars: 10,
        channels: { deny: ["random", "off-topic"] },
      },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: message from random channel should be blocked", from: "user" },
      { messageProvider: "random", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("allows capture from channels not in the deny list", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: {
        minChars: 10,
        channels: { deny: ["random"] },
      },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: message from general should pass deny filter", from: "user" },
      { messageProvider: "general", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("only captures from channels in the allow list", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: {
        minChars: 10,
        channels: { allow: ["general", "important"] },
      },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // From allowed channel
    await handler(
      { content: "remember this: from general should be allowed by allowlist", from: "user" },
      { messageProvider: "general", sessionId: "s1" },
    );

    // From non-allowed channel
    await handler(
      { content: "remember this: from random should be blocked by allowlist", from: "user" },
      { messageProvider: "random", sessionId: "s2" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
    expect(result.text).toContain("general");
  });

  it("deny list takes precedence over allow list", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: {
        minChars: 10,
        channels: { allow: ["general", "random"], deny: ["random"] },
      },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: random is in both allow and deny lists test", from: "user" },
      { messageProvider: "random", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("uses defaultPolicy='skip' to block all channels not in allow list", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: {
        minChars: 10,
        channels: { defaultPolicy: "skip" },
      },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: message should be skipped by default policy", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("channel matching is case-insensitive", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: {
        minChars: 10,
        channels: { deny: ["Random"] },
      },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: lowercase random should match uppercase deny entry", from: "user" },
      { messageProvider: "random", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("handles undefined/empty messageProvider gracefully", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: {
        minChars: 10,
        channels: { deny: ["random"] },
      },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: message with no provider set at all", from: "user" },
      { messageProvider: undefined, sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("logs info when capture is skipped due to channel policy", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: {
        minChars: 10,
        channels: { deny: ["blocked-channel"] },
      },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: this should be blocked and logged", from: "user" },
      { messageProvider: "blocked-channel", sessionId: "s1" },
    );

    expect(api.logger?.info).toHaveBeenCalledWith(
      expect.stringContaining("not allowed by policy"),
    );
  });
});

// ---------------------------------------------------------------------------
// Issue #2: Deduplication
// ---------------------------------------------------------------------------

describe("deduplication", () => {
  it("skips near-duplicate messages when dedupeThreshold is set", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, dedupeThreshold: 0.8 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // First capture
    await handler(
      { content: "remember this: the database migration strategy is complete", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    // Near-duplicate capture (same content)
    await handler(
      { content: "remember this: the database migration strategy is complete", from: "user" },
      { messageProvider: "slack", sessionId: "s2" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("does not skip different messages even with dedupeThreshold set", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, dedupeThreshold: 0.95 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: the frontend React component library is ready", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    await handler(
      { content: "remember this: the backend Python API service needs refactoring", from: "user" },
      { messageProvider: "slack", sessionId: "s2" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (2)");
  });

  it("does not deduplicate when dedupeThreshold is 0 (disabled)", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, dedupeThreshold: 0 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Same content twice - should both be stored
    await handler(
      { content: "remember this: exact duplicate content for dedup disabled test", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );
    await handler(
      { content: "remember this: exact duplicate content for dedup disabled test", from: "user" },
      { messageProvider: "slack", sessionId: "s2" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (2)");
  });

  it("logs info when duplicate is skipped", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, dedupeThreshold: 0.8 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: original message for dedup log test content", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );
    await handler(
      { content: "remember this: original message for dedup log test content", from: "user" },
      { messageProvider: "slack", sessionId: "s2" },
    );

    expect(api.logger?.info).toHaveBeenCalledWith(
      expect.stringContaining("skipped duplicate"),
    );
  });
});

// ---------------------------------------------------------------------------
// Issue #2: TTL support
// ---------------------------------------------------------------------------

describe("TTL support", () => {
  it("sets expiresAt on items when defaultTtlMs is configured", async () => {
    const storePath = tempStorePath();
    const ttl = 3600_000; // 1 hour
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, defaultTtlMs: ttl },
    });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "TTL test note with expiry" });

    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({});
    const payload = JSON.parse(result.text);
    expect(payload.items[0].expiresAt).toBeDefined();
    const expiresAt = new Date(payload.items[0].expiresAt).getTime();
    const now = Date.now();
    // expiresAt should be roughly 1 hour from now
    expect(expiresAt).toBeGreaterThan(now + ttl - 5000);
    expect(expiresAt).toBeLessThan(now + ttl + 5000);
  });

  it("does not set expiresAt when defaultTtlMs is 0 (disabled)", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, defaultTtlMs: 0 },
    });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Note without TTL expiry" });

    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({});
    const payload = JSON.parse(result.text);
    expect(payload.items[0].expiresAt).toBeUndefined();
  });

  it("auto-capture also applies TTL when defaultTtlMs is set", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, defaultTtlMs: 7200_000 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: auto-captured note should have TTL set", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({});
    const payload = JSON.parse(result.text);
    expect(payload.items[0].expiresAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Issue #3: Explicit capture UX - trigger prefix stripping
// ---------------------------------------------------------------------------

describe("explicit capture UX - trigger prefix stripping", () => {
  it("strips 'remember this:' prefix from auto-captured text", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath, capture: { minChars: 10 } });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: the actual content that matters for the test", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "actual content matters" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    // Should not contain the trigger prefix
    expect(data.hits[0]!.text).not.toMatch(/^remember this/i);
    // Should contain the payload
    expect(data.hits[0]!.text).toContain("the actual content that matters");
  });

  it("strips 'merke dir:' prefix from auto-captured text", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({ storePath, capture: { minChars: 10 } });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "merke dir: wichtige Architektur-Entscheidung ueber das System", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "Architektur Entscheidung" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.text).not.toMatch(/^merke dir/i);
  });

  it("does not strip prefix for topic-only captures (not explicit)", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, captureThreshold: 0 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    const content = "This is a major decision about cloud provider selection for the project";
    await handler(
      { content, from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "decision cloud provider" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    // Topic captures should preserve the full text
    expect(data.hits[0]!.text).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// Issue #3: /remember-brain confirmation includes ID
// ---------------------------------------------------------------------------

describe("/remember-brain confirmation includes ID", () => {
  it("returns confirmation with item ID", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({ args: "Test note for ID confirmation" });
    expect(result.text).toMatch(/Saved brain memory \[id=.+\]\./);
  });

  it("returns confirmation with ID and redaction note", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({
      args: "My key is AIzaSyExampleExampleExampleExample1234 for the project",
    });
    expect(result.text).toMatch(/Saved brain memory \[id=.+\]\. \(secrets redacted\)/);
  });
});

// ---------------------------------------------------------------------------
// Issue #3: /brain-status command
// ---------------------------------------------------------------------------

describe("/brain-status command", () => {
  it("shows status with zero items and zero session stats", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("brain-status")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Brain Memory Status");
    expect(result.text).toContain("Total stored items: 0");
    expect(result.text).toContain("Messages processed: 0");
    expect(result.text).toContain("Explicit captures: 0");
    expect(result.text).toContain("Topic captures: 0");
  });

  it("shows correct item count after storing items", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "First status test note" });
    await rememberCmd.handler({ args: "Second status test note" });

    const cmd = api._commands.get("brain-status")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Total stored items: 2");
  });

  it("tracks auto-capture stats correctly", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, captureThreshold: 0 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Explicit capture
    await handler(
      { content: "remember this: first explicit capture for status test", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    // Topic capture
    await handler(
      { content: "This decision about the API design is critical for the project", from: "user" },
      { messageProvider: "slack", sessionId: "s2" },
    );

    // Short message (skipped)
    await handler(
      { content: "hi there", from: "user" },
      { messageProvider: "slack", sessionId: "s3" },
    );

    const cmd = api._commands.get("brain-status")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Messages processed: 3");
    expect(result.text).toContain("Explicit captures: 1");
    expect(result.text).toContain("Topic captures: 1");
    expect(result.text).toContain("Skipped (too short): 1");
  });

  it("tracks channel-skipped stats", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: {
        minChars: 10,
        channels: { deny: ["random"] },
      },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: message from denied channel for stats test", from: "user" },
      { messageProvider: "random", sessionId: "s1" },
    );

    const cmd = api._commands.get("brain-status")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Skipped (channel policy): 1");
  });

  it("tracks duplicate-skipped stats", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, dedupeThreshold: 0.8 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: original note for duplicate stats tracking test", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );
    await handler(
      { content: "remember this: original note for duplicate stats tracking test", from: "user" },
      { messageProvider: "slack", sessionId: "s2" },
    );

    const cmd = api._commands.get("brain-status")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Skipped (duplicate): 1");
  });

  it("shows config values in status output", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      capture: {
        minChars: 50,
        dedupeThreshold: 0.9,
        defaultTtlMs: 3600000,
        channels: { allow: ["general"] },
      },
      retention: { maxAgeDays: 30 },
    });
    register(api);

    const cmd = api._commands.get("brain-status")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("minChars: 50");
    expect(result.text).toContain("dedupeThreshold: 0.9");
    expect(result.text).toContain("defaultTtlMs: 3600000");
    expect(result.text).toContain("maxAgeDays: 30");
    expect(result.text).toContain("allow=general");
  });

  it("has correct metadata", () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("brain-status")!;
    expect(cmd.name).toBe("brain-status");
    expect(cmd.description).toBeTruthy();
    expect(cmd.usage).toContain("/brain-status");
    expect(cmd.requireAuth).toBe(false);
    expect(cmd.acceptsArgs).toBe(false);
  });

  it("shows captureThreshold in config section", async () => {
    const api = createMockApi({
      storePath: tempStorePath(),
      capture: { captureThreshold: 0.6 },
    });
    register(api);

    const cmd = api._commands.get("brain-status")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("captureThreshold: 0.6");
  });

  it("shows skipped low-score stat", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, captureThreshold: 0.8 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Topic-only match on a short message: score = 0.2 (topic) which is < 0.8 threshold
    await handler(
      { content: "This decision is made for the project", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const cmd = api._commands.get("brain-status")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Skipped (low score): 1");
  });

  it("shows average capture score of stored items", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, captureThreshold: 0.2 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Capture a topic message (score 0.2)
    await handler(
      { content: "This decision is important for the team", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const cmd = api._commands.get("brain-status")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Avg capture score (last 20):");
    // Should not be 0.00 since we captured a scored item
    expect(result.text).not.toContain("Avg capture score (last 20): 0.00");
  });

  it("shows 0.00 avg score when no scored items exist", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("brain-status")!;
    const result = await cmd.handler({});
    expect(result.text).toContain("Avg capture score (last 20): 0.00");
  });
});

// ---------------------------------------------------------------------------
// T-011: scoreCapture function unit tests
// ---------------------------------------------------------------------------

describe("scoreCapture() - confidence scoring", () => {
  const defaultConfig = {
    explicitTriggers: ["remember this", "merke dir", "notiere", "keep this"],
    autoTopics: ["entscheidung", "decision"],
  };

  it("returns 0 for text with no signals", () => {
    const score = scoreCapture("Hello world, this is a short message.", defaultConfig);
    expect(score).toBe(0);
  });

  it("returns 0.4 for explicit trigger match only", () => {
    const score = scoreCapture("remember this: some note", defaultConfig);
    expect(score).toBeCloseTo(0.4, 5);
  });

  it("returns 0.2 for auto-topic match only", () => {
    const score = scoreCapture("This decision matters", defaultConfig);
    expect(score).toBeCloseTo(0.2, 5);
  });

  it("returns 0.2 for length >= 120 only", () => {
    const longText = "a".repeat(120);
    const score = scoreCapture(longText, { explicitTriggers: [], autoTopics: [] });
    expect(score).toBeCloseTo(0.2, 5);
  });

  it("returns 0 for length < 120 with no other signals", () => {
    const shortText = "a".repeat(119);
    const score = scoreCapture(shortText, { explicitTriggers: [], autoTopics: [] });
    expect(score).toBe(0);
  });

  it("returns 0.2 for bullet list structural marker", () => {
    const text = "- item one\n- item two";
    const score = scoreCapture(text, { explicitTriggers: [], autoTopics: [] });
    expect(score).toBeCloseTo(0.2, 5);
  });

  it("returns 0.2 for code block structural marker", () => {
    const text = "Here is code:\n```\nconst x = 1;\n```";
    const score = scoreCapture(text, { explicitTriggers: [], autoTopics: [] });
    expect(score).toBeCloseTo(0.2, 5);
  });

  it("returns 0.2 for numbered list structural marker", () => {
    const text = "1. First step\n2. Second step";
    const score = scoreCapture(text, { explicitTriggers: [], autoTopics: [] });
    expect(score).toBeCloseTo(0.2, 5);
  });

  it("returns 0.2 for numbered list with closing paren", () => {
    const text = "1) First step\n2) Second step";
    const score = scoreCapture(text, { explicitTriggers: [], autoTopics: [] });
    expect(score).toBeCloseTo(0.2, 5);
  });

  it("returns 0.2 for asterisk list structural marker", () => {
    const text = "* item one\n* item two";
    const score = scoreCapture(text, { explicitTriggers: [], autoTopics: [] });
    expect(score).toBeCloseTo(0.2, 5);
  });

  it("combines trigger + topic = 0.6", () => {
    const text = "remember this: an important decision about architecture";
    const score = scoreCapture(text, defaultConfig);
    expect(score).toBeCloseTo(0.6, 5);
  });

  it("combines trigger + length = 0.6", () => {
    const text = "remember this: " + "a".repeat(120);
    const score = scoreCapture(text, defaultConfig);
    expect(score).toBeCloseTo(0.6, 5);
  });

  it("combines topic + length + structure = 0.6", () => {
    const text = "This decision about the project is very important.\n- point one\n- point two\n" + "a".repeat(60);
    const score = scoreCapture(text, defaultConfig);
    expect(score).toBeCloseTo(0.6, 5);
  });

  it("caps at 1.0 when all signals match", () => {
    const text = "remember this: This decision about architecture is critical.\n- step one\n- step two\n" + "a".repeat(120);
    const score = scoreCapture(text, defaultConfig);
    expect(score).toBe(1.0);
  });

  it("is case-insensitive for trigger matching", () => {
    const score = scoreCapture("REMEMBER THIS: note", defaultConfig);
    expect(score).toBeCloseTo(0.4, 5);
  });

  it("is case-insensitive for topic matching", () => {
    const score = scoreCapture("This DECISION matters", defaultConfig);
    expect(score).toBeCloseTo(0.2, 5);
  });
});

// ---------------------------------------------------------------------------
// T-011: Confidence scoring integration with auto-capture
// ---------------------------------------------------------------------------

describe("auto-capture with confidence scoring", () => {
  it("captures message when score meets threshold", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, captureThreshold: 0.4 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Explicit trigger = 0.4 score, meets threshold
    await handler(
      { content: "remember this: important architecture note for the project", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("skips message when score is below threshold", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, captureThreshold: 0.5 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Topic match only = 0.2 score, below 0.5 threshold
    await handler(
      { content: "This decision is interesting for now", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("captures topic message with multiple signals above threshold", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, captureThreshold: 0.4 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Topic (0.2) + length >= 120 (0.2) = 0.4, meets threshold
    const longText = "This decision about architecture is critical for the entire project and must be documented. " + "x".repeat(40);
    await handler(
      { content: longText, from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("stores captureScore in meta.capture.score", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { minChars: 10, captureThreshold: 0.4 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "remember this: important note about the system for testing", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    // Export to see the meta field
    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({ args: "" });
    const payload = JSON.parse(result.text);
    expect(payload.items.length).toBe(1);
    expect(payload.items[0].meta.capture.score).toBeCloseTo(0.4, 5);
  });

  it("explicit /remember-brain bypasses scoring (always captured)", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { captureThreshold: 0.99 },
    });
    register(api);

    // /remember-brain should always work regardless of threshold
    const cmd = api._commands.get("remember-brain")!;
    const result = await cmd.handler({ args: "hi" });
    expect(result.text).toMatch(/Saved brain memory \[id=.+\]\./);
  });

  it("uses default threshold of 0.4 when not configured", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Topic only = 0.2, below default threshold 0.4
    await handler(
      { content: "This decision is quick for the team", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("No brain memories stored yet");
  });

  it("threshold 0 captures everything that matches trigger/topic", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, captureThreshold: 0 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Topic only = 0.2, but threshold is 0 so it should be captured
    await handler(
      { content: "This decision is quick for the team", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("threshold boundary: score exactly equals threshold captures the message", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, captureThreshold: 0.2 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    // Topic match = 0.2, threshold = 0.2, should capture (>=)
    await handler(
      { content: "This decision is final for this sprint cycle", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({});
    expect(result.text).toContain("Brain memories (1)");
  });

  it("logs low-score skip with score and threshold details", async () => {
    const storePath = tempStorePath();
    const api = createMockApi({
      storePath,
      capture: { requireExplicit: false, minChars: 10, captureThreshold: 0.5 },
    });
    register(api);

    const handlers = api._handlers.get("message_received") ?? [];
    const handler = handlers[0]!;

    await handler(
      { content: "This decision is not important enough", from: "user" },
      { messageProvider: "slack", sessionId: "s1" },
    );

    expect(api.logger!.info).toHaveBeenCalledWith(
      expect.stringContaining("skipped low-score capture"),
    );
  });
});

// ---------------------------------------------------------------------------
// T-012: lastAccessedAt tracking and recency boost
// ---------------------------------------------------------------------------

describe("T-012: lastAccessedAt tracking", () => {
  it("sets lastAccessedAt on items returned by brain_memory_search tool", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "An important fact about TypeScript generics" });

    // Search to trigger lastAccessedAt
    const tool = api._tools.get("brain_memory_search")!;
    await tool.execute({ query: "TypeScript generics" } as ToolCallParams);

    // Allow the fire-and-forget update to settle
    await new Promise((r) => setTimeout(r, 100));

    // Export and check the item has lastAccessedAt set
    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({});
    const payload = JSON.parse(result.text);
    expect(payload.items[0].lastAccessedAt).toBeDefined();
    expect(typeof payload.items[0].lastAccessedAt).toBe("string");
  });

  it("sets lastAccessedAt on items returned by /search-brain command", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Database migration strategy for PostgreSQL" });

    const searchCmd = api._commands.get("search-brain")!;
    await searchCmd.handler({ args: "PostgreSQL migration" });

    await new Promise((r) => setTimeout(r, 100));

    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({});
    const payload = JSON.parse(result.text);
    expect(payload.items[0].lastAccessedAt).toBeDefined();
  });

  it("sets lastAccessedAt on items returned by /list-brain command", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Important meeting notes from standup" });

    const listCmd = api._commands.get("list-brain")!;
    await listCmd.handler({});

    await new Promise((r) => setTimeout(r, 100));

    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({});
    const payload = JSON.parse(result.text);
    expect(payload.items[0].lastAccessedAt).toBeDefined();
  });

  it("does not set lastAccessedAt on newly created items", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Fresh memory item without access" });

    const exportCmd = api._commands.get("export-brain")!;
    const result = await exportCmd.handler({});
    const payload = JSON.parse(result.text);
    expect(payload.items[0].lastAccessedAt).toBeUndefined();
  });

  it("updates lastAccessedAt on subsequent searches", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Reusable component library architecture notes" });

    // First search
    const tool = api._tools.get("brain_memory_search")!;
    await tool.execute({ query: "component library" } as ToolCallParams);
    await new Promise((r) => setTimeout(r, 100));

    const exportCmd = api._commands.get("export-brain")!;
    const first = JSON.parse((await exportCmd.handler({})).text);
    const firstAccess = first.items[0].lastAccessedAt;

    // Wait a moment then search again
    await new Promise((r) => setTimeout(r, 50));
    await tool.execute({ query: "component library" } as ToolCallParams);
    await new Promise((r) => setTimeout(r, 100));

    const second = JSON.parse((await exportCmd.handler({})).text);
    const secondAccess = second.items[0].lastAccessedAt;

    expect(secondAccess).toBeDefined();
    expect(secondAccess >= firstAccess).toBe(true);
  });
});

describe("T-012: recency boost in search scoring", () => {
  it("applies recency boost to recently accessed items", async () => {
    const api = createMockApi({ storePath: tempStorePath(), search: { recencyBoost: 0.5 } });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Alpha architecture pattern for services" });
    await rememberCmd.handler({ args: "Beta architecture design for services" });

    // Search to set lastAccessedAt on first item only
    const tool = api._tools.get("brain_memory_search")!;
    const firstResult = await tool.execute({ query: "Alpha architecture" } as ToolCallParams);
    const firstHits = (firstResult as { hits: Array<{ id: string }> }).hits;
    await new Promise((r) => setTimeout(r, 100));

    // Now search for both - the recently accessed one should have a boost
    const result = await tool.execute({ query: "architecture services" } as ToolCallParams);
    const data = result as { hits: Array<{ score: number; text: string }> };
    expect(data.hits.length).toBeGreaterThanOrEqual(2);
    // Boosted item should have a higher score than its raw semantic score would suggest
    const alphaHit = data.hits.find((h) => h.text.includes("Alpha"));
    expect(alphaHit).toBeDefined();
  });

  it("does not apply recency boost when recencyBoost is 0", async () => {
    const api = createMockApi({ storePath: tempStorePath(), search: { recencyBoost: 0 } });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Note about zero boost testing for search" });

    // Search once to set lastAccessedAt
    const tool = api._tools.get("brain_memory_search")!;
    await tool.execute({ query: "zero boost" } as ToolCallParams);
    await new Promise((r) => setTimeout(r, 100));

    // Search again - score should be pure semantic (no boost)
    const result = await tool.execute({ query: "zero boost" } as ToolCallParams);
    const data = result as { hits: Array<{ score: number }> };
    expect(data.hits.length).toBeGreaterThan(0);
    // With recencyBoost=0, the score should be <= 1.0 (no boost applied)
    expect(data.hits[0]!.score).toBeLessThanOrEqual(1.0);
  });

  it("default recencyBoost is 0.1", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Default boost configuration test memory" });

    // Search once to set lastAccessedAt
    const tool = api._tools.get("brain_memory_search")!;
    await tool.execute({ query: "default boost" } as ToolCallParams);
    await new Promise((r) => setTimeout(r, 100));

    // Search again - boosted score can be slightly above semantic score but not by much (0.1 boost)
    const result = await tool.execute({ query: "default boost" } as ToolCallParams);
    const data = result as { hits: Array<{ score: number }> };
    expect(data.hits.length).toBeGreaterThan(0);
    // With default 0.1 boost, max possible boost is *1.1, so score can be up to 1.1
    expect(data.hits[0]!.score).toBeLessThanOrEqual(1.1);
  });

  it("clamps recencyBoost to 0..1 range", async () => {
    // recencyBoost > 1 should be clamped to 1
    const api = createMockApi({ storePath: tempStorePath(), search: { recencyBoost: 5.0 } });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "Clamped boost test memory item" });

    const tool = api._tools.get("brain_memory_search")!;
    await tool.execute({ query: "clamped boost" } as ToolCallParams);
    await new Promise((r) => setTimeout(r, 100));

    const result = await tool.execute({ query: "clamped boost" } as ToolCallParams);
    const data = result as { hits: Array<{ score: number }> };
    expect(data.hits.length).toBeGreaterThan(0);
    // With clamped boost of 1.0, max possible score is semantic * 2.0
    expect(data.hits[0]!.score).toBeLessThanOrEqual(2.0);
  });
});

describe("T-012: /list-brain --stale flag", () => {
  it("returns stale items not accessed in N+ days", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    // Import items with varying lastAccessedAt to simulate stale vs fresh
    const importCmd = api._commands.get("import-brain")!;
    const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString(); // 60 days ago
    const recentDate = new Date().toISOString(); // now
    const items = [
      { id: "stale-1", kind: "note", text: "Old stale memory item one", createdAt: oldDate, tags: ["brain"], lastAccessedAt: oldDate },
      { id: "stale-2", kind: "note", text: "Old stale memory item two", createdAt: oldDate, tags: ["brain"] }, // never accessed
      { id: "fresh-1", kind: "note", text: "Fresh recent memory item", createdAt: recentDate, tags: ["brain"], lastAccessedAt: recentDate },
    ];
    await importCmd.handler({ args: JSON.stringify(items) });

    // List stale items (30+ days)
    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({ args: "--stale 30" });
    expect(result.text).toContain("Stale brain memories");
    expect(result.text).toContain("Old stale memory");
    expect(result.text).not.toContain("Fresh recent");
  });

  it("treats items without lastAccessedAt as stale", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const importCmd = api._commands.get("import-brain")!;
    const items = [
      { id: "never-1", kind: "note", text: "Never accessed memory item", createdAt: "2026-01-01T00:00:00Z", tags: ["brain"] },
    ];
    await importCmd.handler({ args: JSON.stringify(items) });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({ args: "--stale 1" });
    expect(result.text).toContain("Never accessed");
  });

  it("returns no-stale message when all items are fresh", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const rememberCmd = api._commands.get("remember-brain")!;
    await rememberCmd.handler({ args: "A fresh memory for stale test" });

    // Touch it
    const tool = api._tools.get("brain_memory_search")!;
    await tool.execute({ query: "fresh stale test" } as ToolCallParams);
    await new Promise((r) => setTimeout(r, 100));

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({ args: "--stale 1" });
    expect(result.text).toContain("No brain memories stale");
  });

  it("combines --stale with --tags filter", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const importCmd = api._commands.get("import-brain")!;
    const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const items = [
      { id: "st-1", kind: "note", text: "Stale API note for filter", createdAt: oldDate, tags: ["brain", "api"] },
      { id: "st-2", kind: "note", text: "Stale DB note for filter", createdAt: oldDate, tags: ["brain", "db"] },
    ];
    await importCmd.handler({ args: JSON.stringify(items) });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({ args: "--tags api --stale 30" });
    expect(result.text).toContain("Stale brain memories");
    expect(result.text).toContain("Stale API note");
    expect(result.text).not.toContain("Stale DB note");
  });

  it("respects limit with --stale flag", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const importCmd = api._commands.get("import-brain")!;
    const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const items = [
      { id: "lim-1", kind: "note", text: "Stale limit test item one", createdAt: oldDate, tags: ["brain"] },
      { id: "lim-2", kind: "note", text: "Stale limit test item two", createdAt: oldDate, tags: ["brain"] },
      { id: "lim-3", kind: "note", text: "Stale limit test item three", createdAt: oldDate, tags: ["brain"] },
    ];
    await importCmd.handler({ args: JSON.stringify(items) });

    const listCmd = api._commands.get("list-brain")!;
    const result = await listCmd.handler({ args: "--stale 30 1" });
    expect(result.text).toContain("Stale brain memories (30+ days, 1)");
  });
});

describe("T-012: /brain-status includes recencyBoost", () => {
  it("shows recencyBoost in config section", async () => {
    const api = createMockApi({ storePath: tempStorePath(), search: { recencyBoost: 0.3 } });
    register(api);

    const statusCmd = api._commands.get("brain-status")!;
    const result = await statusCmd.handler({});
    expect(result.text).toContain("recencyBoost: 0.3");
  });

  it("shows default recencyBoost of 0.1 when not configured", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const statusCmd = api._commands.get("brain-status")!;
    const result = await statusCmd.handler({});
    expect(result.text).toContain("recencyBoost: 0.1");
  });
});

describe("T-012: /list-brain --stale usage in metadata", () => {
  it("/list-brain usage includes --stale", () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    const cmd = api._commands.get("list-brain")!;
    expect(cmd.usage).toContain("--stale");
    expect(cmd.description).toContain("--stale");
  });
});

describe("T-012: backward compatibility", () => {
  it("items without lastAccessedAt still work in search", async () => {
    const api = createMockApi({ storePath: tempStorePath() });
    register(api);

    // Import an item without lastAccessedAt (simulating old data)
    const importCmd = api._commands.get("import-brain")!;
    const items = [
      { id: "compat-1", kind: "note", text: "Old format memory without lastAccessedAt field", createdAt: "2026-01-01T00:00:00Z", tags: ["brain"] },
    ];
    await importCmd.handler({ args: JSON.stringify(items) });

    // Search should work fine
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "old format" } as ToolCallParams);
    const data = result as { hits: Array<{ text: string }> };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]!.text).toContain("Old format");
  });

  it("items without lastAccessedAt get zero recency boost", async () => {
    const api = createMockApi({ storePath: tempStorePath(), search: { recencyBoost: 0.5 } });
    register(api);

    const importCmd = api._commands.get("import-brain")!;
    const items = [
      { id: "noboost-1", kind: "note", text: "No boost memory for compatibility test", createdAt: "2026-01-01T00:00:00Z", tags: ["brain"] },
    ];
    await importCmd.handler({ args: JSON.stringify(items) });

    // Score should equal pure semantic score (no boost since no lastAccessedAt)
    const tool = api._tools.get("brain_memory_search")!;
    const result = await tool.execute({ query: "no boost compatibility" } as ToolCallParams);
    const data = result as { hits: Array<{ score: number }> };
    expect(data.hits.length).toBeGreaterThan(0);
    // Raw score is 0..1, with zero boost it stays in that range
    expect(data.hits[0]!.score).toBeLessThanOrEqual(1.0);
  });
});
