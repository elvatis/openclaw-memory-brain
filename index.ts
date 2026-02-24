import path from "node:path";
import os from "node:os";

import {
  DefaultRedactor,
  HashEmbedder,
  JsonlMemoryStore,
  uuid,
  type MemoryItem,
} from "@elvatis_com/openclaw-memory-core";

function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function includesAny(hay: string, needles: string[]): boolean {
  const s = hay.toLowerCase();
  return needles.some((n) => s.includes(n.toLowerCase()));
}

export default function register(api: any) {
  const cfg = (api.pluginConfig ?? {}) as any;
  if (cfg.enabled === false) return;

  const storePath = expandHome(cfg.storePath ?? "~/.openclaw/workspace/memory/brain-memory.jsonl");
  const embedder = new HashEmbedder(cfg.dims ?? 256);
  const store = new JsonlMemoryStore({ filePath: storePath, embedder });
  const redactor = new DefaultRedactor();

  const captureCfg = cfg.capture ?? {};
  const minChars: number = captureCfg.minChars ?? 80;
  const requireExplicit: boolean = captureCfg.requireExplicit === true;
  const explicitTriggers: string[] = captureCfg.explicitTriggers ?? ["merke dir", "remember this", "notiere", "keep this"];
  const autoTopics: string[] = captureCfg.autoTopics ?? ["entscheidung", "decision"];
  const defaultTags: string[] = cfg.defaultTags ?? ["brain"];
  const redactSecrets: boolean = cfg.redactSecrets !== false;

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
    handler: async (params: any) => {
      const q = String(params.query ?? "").trim();
      const limit = Number(params.limit ?? 5);
      if (!q) return { hits: [] };
      const hits = await store.search(q, { limit });
      return {
        storePath,
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
    handler: async (ctx: any) => {
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

  // Auto-capture from inbound messages.
  api.on("message_received", async (event: any, ctx: any) => {
    const content = String(event?.content ?? "").trim();
    if (!content) return;
    if (content.length < minChars) return;

    const isExplicit = includesAny(content, explicitTriggers);
    const isTopic = includesAny(content, autoTopics);

    if (requireExplicit && !isExplicit) return;
    if (!requireExplicit && !isExplicit && !isTopic) return;

    const r = redactSecrets ? redactor.redact(content) : { redactedText: content, hadSecrets: false, matches: [] };
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
  });
}
