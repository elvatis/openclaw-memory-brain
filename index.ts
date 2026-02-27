import {
  DefaultRedactor,
  HashEmbedder,
  JsonlMemoryStore,
  uuid,
  expandHome,
  safePath,
  safeLimit,
  type MemoryItem,
  type PluginApi,
  type CommandContext,
  type ToolCallParams,
  type MessageEvent,
  type MessageEventContext,
} from "@elvatis_com/openclaw-memory-core";

export default function register(api: PluginApi) {
  const cfg = (api.pluginConfig ?? {}) as {
    enabled?: boolean;
    storePath?: string;
    dims?: number;
    redactSecrets?: boolean;
    defaultTags?: string[];
    maxItems?: number;
    capture?: {
      minChars?: number;
      requireExplicit?: boolean;
      explicitTriggers?: string[];
      autoTopics?: string[];
    };
  };
  if (cfg.enabled === false) return;

  let storePath: string;
  try {
    storePath = safePath(expandHome(cfg.storePath ?? "~/.openclaw/workspace/memory/brain-memory.jsonl"), "[memory-brain] storePath");
  } catch (err: unknown) {
    api.logger?.error?.(`[memory-brain] ${(err as Error).message}`);
    return;
  }

  const embedder = new HashEmbedder(cfg.dims ?? 256);
  const store = new JsonlMemoryStore({ filePath: storePath, embedder, maxItems: cfg.maxItems ?? 5000 });
  const redactor = new DefaultRedactor();

  const captureCfg = cfg.capture ?? {};
  const minChars: number = captureCfg.minChars ?? 80;
  const requireExplicit: boolean = captureCfg.requireExplicit === true;
  const explicitTriggers: string[] = captureCfg.explicitTriggers ?? ["merke dir", "remember this", "notiere", "keep this"];
  const autoTopics: string[] = captureCfg.autoTopics ?? ["entscheidung", "decision"];
  const defaultTags: string[] = cfg.defaultTags ?? ["brain"];
  const redactSecrets: boolean = cfg.redactSecrets !== false;

  function includesAny(hay: string, needles: string[]): boolean {
    const s = hay.toLowerCase();
    return needles.some((n) => s.includes(n.toLowerCase()));
  }

  api.logger?.info?.(`[memory-brain] enabled. store=${storePath}`);

  // Tool: brain_memory_search
  api.registerTool({
    name: "brain_memory_search",
    description: "Search personal brain memory items (local JSONL store)",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 20, default: 5 }
      },
      required: ["query"]
    },
    handler: async (params: ToolCallParams) => {
      const q = String(params['query'] ?? "").trim();
      const limit = safeLimit(params['limit'], 5, 20);
      if (!q) return { hits: [] };
      const hits = await store.search(q, { limit });
      return {
        hits: hits.map((h) => ({
          score: h.score,
          id: h.item.id,
          createdAt: h.item.createdAt,
          tags: h.item.tags,
          text: h.item.text
        }))
      };
    }
  });

  // Command: /remember-brain <text>
  api.registerCommand({
    name: "remember-brain",
    description: "Save a personal brain memory item (explicit capture)",
    usage: "/remember-brain <text>",
    requireAuth: false,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      const text = String(ctx?.args ?? "").trim();
      if (!text) return { text: "Usage: /remember-brain <text>" };

      const r = redactSecrets ? redactor.redact(text) : { redactedText: text, hadSecrets: false, matches: [] };
      const item: MemoryItem = {
        id: uuid(),
        kind: "note",
        text: r.redactedText,
        createdAt: new Date().toISOString(),
        tags: defaultTags,
        source: {
          channel: ctx?.channel,
          from: ctx?.from,
          conversationId: ctx?.conversationId,
          messageId: ctx?.messageId,
        },
        meta: r.hadSecrets ? { redaction: { hadSecrets: true, matches: r.matches } } : undefined,
      };

      await store.add(item);
      const note = r.hadSecrets ? " (secrets redacted)" : "";
      return { text: `Saved brain memory.${note}` };
    },
  });

  // Command: /search-brain <query>
  api.registerCommand({
    name: "search-brain",
    description: "Search brain memory items by query",
    usage: "/search-brain <query> [limit]",
    requireAuth: false,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      const args = String(ctx?.args ?? "").trim().split(/\s+/);
      // Support optional trailing --limit N or just a bare number as last arg.
      const lastArg = args[args.length - 1] ?? "";
      const maybeLimit = Number(lastArg);
      let query: string;
      let limit: number;
      if (!isNaN(maybeLimit) && maybeLimit >= 1 && args.length > 1) {
        limit = safeLimit(maybeLimit, 5, 20);
        query = args.slice(0, -1).join(" ");
      } else {
        limit = 5;
        query = args.join(" ");
      }
      if (!query) return { text: "Usage: /search-brain <query> [limit]" };
      const hits = await store.search(query, { limit });
      if (hits.length === 0) return { text: `No brain memories found for: ${query}` };
      const lines = hits.map((h, n) =>
        `${n + 1}. [score:${h.score.toFixed(2)}] ${h.item.text.slice(0, 120)}${h.item.text.length > 120 ? "…" : ""}`
      );
      return { text: `Brain memory results for "${query}":\n${lines.join("\n")}` };
    },
  });

  // Command: /list-brain [limit]
  api.registerCommand({
    name: "list-brain",
    description: "List the most recent brain memory items",
    usage: "/list-brain [limit]",
    requireAuth: false,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      const limit = safeLimit(String(ctx?.args ?? "").trim(), 10, 50);
      const items = await store.list({ limit });
      if (items.length === 0) return { text: "No brain memories stored yet." };
      const lines = items.map((i, n) =>
        `${n + 1}. [${i.createdAt.slice(0, 10)}] ${i.text.slice(0, 120)}${i.text.length > 120 ? "…" : ""}`
      );
      return { text: `Brain memories (${items.length}):\n${lines.join("\n")}` };
    },
  });

  // Command: /forget-brain <id>
  api.registerCommand({
    name: "forget-brain",
    description: "Delete a brain memory item by ID",
    usage: "/forget-brain <id>",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      const id = String(ctx?.args ?? "").trim();
      if (!id) return { text: "Usage: /forget-brain <id>" };
      const deleted = await store.delete(id);
      return { text: deleted ? `Deleted brain memory: ${id}` : `No memory found with id: ${id}` };
    },
  });

  // Auto-capture from inbound messages.
  api.on("message_received", async (event: MessageEvent, ctx: MessageEventContext) => {
    try {
      const content = String(event?.content ?? "").trim();
      if (!content) return;
      if (content.length < minChars) return;

      const isExplicit = includesAny(content, explicitTriggers);
      const isTopic = includesAny(content, autoTopics);

      if (requireExplicit && !isExplicit) return;
      if (!requireExplicit && !isExplicit && !isTopic) return;

      const r = redactSecrets ? redactor.redact(content) : { redactedText: content, hadSecrets: false, matches: [] as Array<{rule: string; count: number}> };
      const item: MemoryItem = {
        id: uuid(),
        kind: "note",
        text: r.redactedText,
        createdAt: new Date().toISOString(),
        tags: defaultTags,
        source: {
          channel: ctx?.messageProvider,
          from: event?.from,
          conversationId: ctx?.sessionId,
        },
        meta: {
          capture: { explicit: isExplicit, topic: isTopic },
          ...(r.hadSecrets ? { redaction: { hadSecrets: true, matches: r.matches } } : {})
        }
      };

      await store.add(item);
      api.logger?.info?.(`[memory-brain] captured memory (explicit=${isExplicit} topic=${isTopic}) id=${item.id}`);
    } catch (err: unknown) {
      api.logger?.error?.(`[memory-brain] failed to capture message: ${(err as Error).message}`);
    }
  });
}
