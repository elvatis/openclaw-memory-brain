import {
  DefaultRedactor,
  HashEmbedder,
  JsonlMemoryStore,
  uuid,
  expandHome,
  safePath,
  safeLimit,
  ttlMs,
  type MemoryItem,
  type PluginApi,
  type CommandContext,
  type ToolCallParams,
  type MessageEvent,
  type MessageEventContext,
} from "@elvatis_com/openclaw-memory-core";

/**
 * Normalize text for similarity comparison.
 * Lower-cases, strips punctuation, collapses whitespace.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute Jaccard similarity between two strings using word sets.
 * Returns a value in [0, 1] where 1 = identical word sets.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeText(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

/** Internal counters for /brain-status. */
interface CaptureStats {
  explicitCaptures: number;
  topicCaptures: number;
  skippedShort: number;
  skippedChannel: number;
  skippedDuplicate: number;
  skippedLowScore: number;
  totalMessages: number;
}

/** Configuration passed to scoreCapture. */
export interface ScoreCaptureConfig {
  explicitTriggers: string[];
  autoTopics: string[];
}

/**
 * Compute a 0..1 confidence score for auto-capture eligibility.
 *
 * Signals:
 *   +0.4 if an explicit trigger keyword is matched
 *   +0.2 if an auto-topic keyword is matched
 *   +0.2 if message length >= 120 chars (likely substantive)
 *   +0.2 if message contains structural markers (lists, code blocks, numbered items)
 */
export function scoreCapture(text: string, config: ScoreCaptureConfig): number {
  let score = 0;
  const lower = text.toLowerCase();

  // +0.4 for explicit trigger match
  if (config.explicitTriggers.some((t) => lower.includes(t.toLowerCase()))) {
    score += 0.4;
  }

  // +0.2 for auto-topic match
  if (config.autoTopics.some((t) => lower.includes(t.toLowerCase()))) {
    score += 0.2;
  }

  // +0.2 for substantive length
  if (text.length >= 120) {
    score += 0.2;
  }

  // +0.2 for structural markers (code blocks, bullet lists, numbered lists)
  if (/```/.test(text) || /^[\s]*[-*]\s/m.test(text) || /^\s*\d+[.)]\s/m.test(text)) {
    score += 0.2;
  }

  return Math.min(score, 1);
}

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
      channels?: {
        allow?: string[];
        deny?: string[];
        defaultPolicy?: "capture" | "skip";
      };
      dedupeThreshold?: number;
      defaultTtlMs?: number;
      captureThreshold?: number;
    };
    search?: {
      recencyBoost?: number;
    };
    retention?: {
      maxAgeDays?: number;
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

  // Issue #1: Per-channel capture policy
  const channelsCfg = captureCfg.channels ?? {};
  const channelAllow: string[] = channelsCfg.allow ?? [];
  const channelDeny: string[] = channelsCfg.deny ?? [];
  const channelDefaultPolicy: "capture" | "skip" = channelsCfg.defaultPolicy ?? "capture";

  // Issue #2: Dedupe + TTL
  const dedupeThreshold: number = captureCfg.dedupeThreshold ?? 0;
  const defaultTtlMs: number = captureCfg.defaultTtlMs ?? 0;

  // T-011: Confidence-scored auto-capture threshold
  const captureThreshold: number = captureCfg.captureThreshold ?? 0.4;

  // T-012: Recency boost for search scoring
  const recencyBoost: number = Math.max(0, Math.min(1, cfg.search?.recencyBoost ?? 0.1));

  // Issue #3: Capture stats for /brain-status
  const stats: CaptureStats = {
    explicitCaptures: 0,
    topicCaptures: 0,
    skippedShort: 0,
    skippedChannel: 0,
    skippedDuplicate: 0,
    skippedLowScore: 0,
    totalMessages: 0,
  };

  function includesAny(hay: string, needles: string[]): boolean {
    const s = hay.toLowerCase();
    return needles.some((n) => s.includes(n.toLowerCase()));
  }

  function parseTags(raw: string): { tags: string[]; rest: string } {
    const match = raw.match(/--tags\s+(\S+)/);
    if (!match) return { tags: [], rest: raw };
    const tags = match[1]!.split(",").map((t) => t.trim()).filter(Boolean);
    const rest = raw.replace(/--tags\s+\S+/, "").replace(/\s+/g, " ").trim();
    return { tags, rest };
  }

  function parseFormat(raw: string): { format: string; rest: string } {
    const match = raw.match(/--format\s+(\S+)/);
    if (!match) return { format: "json", rest: raw };
    const format = match[1]!.trim().toLowerCase();
    const rest = raw.replace(/--format\s+\S+/, "").replace(/\s+/g, " ").trim();
    return { format, rest };
  }

  /** T-013: Convert memory items to a Markdown document grouped by tags. */
  function toMarkdown(items: MemoryItem[], exportDate: string): string {
    const lines: string[] = [];
    lines.push(`# Brain Memory Export - ${exportDate}`);
    lines.push("");

    // Group items by tag
    const groups = new Map<string, MemoryItem[]>();
    for (const item of items) {
      const tags = item.tags && item.tags.length > 0 ? item.tags : ["(untagged)"];
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag)!.push(item);
      }
    }

    // Sort tags alphabetically, but put (untagged) last
    const sortedTags = [...groups.keys()].sort((a, b) => {
      if (a === "(untagged)") return 1;
      if (b === "(untagged)") return -1;
      return a.localeCompare(b);
    });

    for (const tag of sortedTags) {
      lines.push(`## ${tag}`);
      lines.push("");
      for (const item of groups.get(tag)!) {
        const date = item.createdAt.split("T")[0] ?? item.createdAt;
        lines.push(`- [${date}] ${item.text}`);
      }
      lines.push("");
    }

    return lines.join("\n").trimEnd() + "\n";
  }

  /** Issue #1: Check if capture is allowed for the given channel/provider. */
  function isChannelAllowed(channel: string | undefined): boolean {
    const ch = (channel ?? "").toLowerCase();
    // If the deny list contains this channel, block it
    if (channelDeny.length > 0 && channelDeny.some((d) => d.toLowerCase() === ch)) return false;
    // If an allow list is set, only allow listed channels
    if (channelAllow.length > 0) return channelAllow.some((a) => a.toLowerCase() === ch);
    // Fall back to default policy
    return channelDefaultPolicy === "capture";
  }

  /** Issue #3: Strip explicit trigger prefixes from captured text. */
  function stripTriggerPrefix(text: string): string {
    const lower = text.toLowerCase();
    for (const trigger of explicitTriggers) {
      const tLower = trigger.toLowerCase();
      const idx = lower.indexOf(tLower);
      if (idx !== -1) {
        // Remove the trigger and any following colon/whitespace
        let stripped = text.slice(0, idx) + text.slice(idx + trigger.length);
        stripped = stripped.replace(/^\s*[:]\s*/, "").trim();
        if (stripped) return stripped;
      }
    }
    return text;
  }

  /** Issue #2: Check if content is a near-duplicate of an existing memory. */
  async function isDuplicate(text: string): Promise<boolean> {
    if (dedupeThreshold <= 0) return false;
    const hits = await store.search(text, { limit: 1 });
    if (hits.length === 0) return false;
    return hits[0]!.score >= dedupeThreshold;
  }

  const maxAgeDays: number = cfg.retention?.maxAgeDays ?? 0;

  async function runRetention(dryRun = false): Promise<{ deleted: number; total: number }> {
    if (maxAgeDays <= 0) return { deleted: 0, total: 0 };
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const items = await store.list({ limit: 5000 });
    let deleted = 0;
    for (const item of items) {
      const ts = new Date(item.createdAt).getTime();
      if (!isNaN(ts) && ts < cutoff) {
        if (!dryRun) await store.delete(item.id);
        deleted++;
      }
    }
    return { deleted, total: items.length };
  }

  api.logger?.info?.(`[memory-brain] enabled. store=${storePath}`);

  // Run retention on startup if configured
  if (maxAgeDays > 0) {
    runRetention().then((r) => {
      if (r.deleted > 0) {
        api.logger?.info?.(`[memory-brain] retention: deleted ${r.deleted} expired item(s) older than ${maxAgeDays} day(s)`);
      }
    }).catch((err: unknown) => {
      api.logger?.error?.(`[memory-brain] retention startup error: ${(err as Error).message}`);
    });
  }

  // Purge TTL-expired items on startup
  store.purgeExpired().then((n) => {
    if (n > 0) api.logger?.info?.(`[memory-brain] TTL purge: removed ${n} expired item(s) on startup`);
  }).catch((err: unknown) => {
    api.logger?.error?.(`[memory-brain] TTL purge startup error: ${(err as Error).message}`);
  });

  /**
   * T-012: Compute access-recency factor for search ranking boost.
   * Returns a value in 0..1 where 1 = just accessed, 0 = not accessed or >= 90 days ago.
   */
  function accessRecencyFactor(item: MemoryItem): number {
    if (!item.lastAccessedAt) return 0;
    const daysSince = (Date.now() - new Date(item.lastAccessedAt).getTime()) / 86_400_000;
    if (daysSince < 0 || isNaN(daysSince)) return 0;
    return Math.max(0, 1 - Math.min(daysSince, 90) / 90);
  }

  /** T-012: Set lastAccessedAt on retrieved items (fire-and-forget). */
  function touchAccess(ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    for (const id of ids) {
      store.update(id, { lastAccessedAt: now }).catch(() => {});
    }
  }

  // Tool: brain_memory_search
  api.registerTool({
    name: "brain_memory_search",
    description: "Search personal brain memory items (local JSONL store). Optionally filter by tags (AND logic).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 20, default: 5 },
        tags: { type: "array", items: { type: "string" }, description: "Filter results to items that have ALL of these tags" }
      },
      required: ["query"]
    },
    async execute(params: ToolCallParams) {
      const q = String(params['query'] ?? "").trim();
      const limit = safeLimit(params['limit'], 5, 20);
      const tags = Array.isArray(params['tags']) ? (params['tags'] as string[]).filter(Boolean) : [];
      if (!q) return { hits: [] };
      // T-012: Fetch extra candidates so recency re-ranking can surface boosted items
      const fetchLimit = recencyBoost > 0 ? Math.min(limit * 3, 60) : limit;
      const hits = await store.search(q, { limit: fetchLimit, ...(tags.length > 0 ? { tags } : {}) });
      // T-012: Apply recency boost and re-sort
      const boosted = hits.map((h) => ({
        ...h,
        score: h.score * (1 + recencyBoost * accessRecencyFactor(h.item)),
      }));
      boosted.sort((a, b) => b.score - a.score);
      const topHits = boosted.slice(0, limit);
      // T-012: Touch lastAccessedAt on returned items
      touchAccess(topHits.map((h) => h.item.id));
      return {
        hits: topHits.map((h) => ({
          score: h.score,
          id: h.item.id,
          createdAt: h.item.createdAt,
          tags: h.item.tags,
          text: h.item.text
        }))
      };
    }
  });

  // Command: /remember-brain <text> [--tags tag1,tag2]
  api.registerCommand({
    name: "remember-brain",
    description: "Save a personal brain memory item (explicit capture). Use --tags tag1,tag2 to add custom tags.",
    usage: "/remember-brain <text> [--tags tag1,tag2]",
    requireAuth: false,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      const raw = String(ctx?.args ?? "").trim();
      if (!raw) return { text: "Usage: /remember-brain <text> [--tags tag1,tag2]" };

      const { tags: extraTags, rest: text } = parseTags(raw);
      if (!text) return { text: "Usage: /remember-brain <text> [--tags tag1,tag2]" };

      const mergedTags = [...defaultTags, ...extraTags.filter((t) => !defaultTags.includes(t))];
      const r = redactSecrets ? redactor.redact(text) : { redactedText: text, hadSecrets: false, matches: [] };
      const id = uuid();
      const item: MemoryItem = {
        id,
        kind: "note",
        text: r.redactedText,
        createdAt: new Date().toISOString(),
        tags: mergedTags,
        source: {
          channel: ctx?.channel,
          from: ctx?.from,
          conversationId: ctx?.conversationId,
          messageId: ctx?.messageId,
        },
        meta: r.hadSecrets ? { redaction: { hadSecrets: true, matches: r.matches } } : undefined,
      };

      // Issue #2: Apply TTL if configured
      if (defaultTtlMs > 0) {
        item.expiresAt = ttlMs(defaultTtlMs);
      }

      await store.add(item);
      const note = r.hadSecrets ? " (secrets redacted)" : "";
      // Issue #3: Include id in confirmation
      return { text: `Saved brain memory [id=${id}].${note}` };
    },
  });

  // Command: /search-brain <query> [--tags tag1,tag2] [limit]
  api.registerCommand({
    name: "search-brain",
    description: "Search brain memory items by query. Use --tags tag1,tag2 to filter by tags (AND logic).",
    usage: "/search-brain <query> [--tags tag1,tag2] [limit]",
    requireAuth: false,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      const raw = String(ctx?.args ?? "").trim();
      const { tags, rest } = parseTags(raw);
      const args = rest.split(/\s+/).filter(Boolean);
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
      if (!query) return { text: "Usage: /search-brain <query> [--tags tag1,tag2] [limit]" };
      // T-012: Fetch extra candidates for recency re-ranking
      const fetchLimit = recencyBoost > 0 ? Math.min(limit * 3, 60) : limit;
      const hits = await store.search(query, { limit: fetchLimit, ...(tags.length > 0 ? { tags } : {}) });
      if (hits.length === 0) return { text: `No brain memories found for: ${query}` };
      // T-012: Apply recency boost and re-sort
      const boosted = hits.map((h) => ({
        ...h,
        score: h.score * (1 + recencyBoost * accessRecencyFactor(h.item)),
      }));
      boosted.sort((a, b) => b.score - a.score);
      const topHits = boosted.slice(0, limit);
      // T-012: Touch lastAccessedAt on returned items
      touchAccess(topHits.map((h) => h.item.id));
      const lines = topHits.map((h, n) =>
        `${n + 1}. [score:${h.score.toFixed(2)}] ${h.item.text.slice(0, 120)}${h.item.text.length > 120 ? "\u2026" : ""}`
      );
      return { text: `Brain memory results for "${query}":\n${lines.join("\n")}` };
    },
  });

  // Command: /list-brain [--tags tag1,tag2] [--stale days] [limit]
  api.registerCommand({
    name: "list-brain",
    description: "List the most recent brain memory items. Use --tags tag1,tag2 to filter by tags (AND logic). Use --stale N to list items not accessed in N+ days.",
    usage: "/list-brain [--tags tag1,tag2] [--stale days] [limit]",
    requireAuth: false,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      const raw = String(ctx?.args ?? "").trim();
      const { tags, rest } = parseTags(raw);

      // T-012: Parse --stale flag
      const staleMatch = rest.match(/--stale\s+(\d+)/);
      const staleDays = staleMatch ? Number(staleMatch[1]) : 0;
      const afterStale = rest.replace(/--stale\s+\d+/, "").replace(/\s+/g, " ").trim();

      const limit = safeLimit(afterStale, 10, 50);
      const items = await store.list({ limit: staleDays > 0 ? 5000 : limit, ...(tags.length > 0 ? { tags } : {}) });

      let filtered = items;
      if (staleDays > 0) {
        const cutoff = Date.now() - staleDays * 86_400_000;
        filtered = items.filter((i) => {
          if (!i.lastAccessedAt) return true; // never accessed counts as stale
          const ts = new Date(i.lastAccessedAt).getTime();
          return !isNaN(ts) && ts < cutoff;
        });
        filtered = filtered.slice(-limit);
      }

      if (filtered.length === 0) {
        return { text: staleDays > 0 ? `No brain memories stale for ${staleDays}+ day(s).` : "No brain memories stored yet." };
      }

      // T-012: Touch lastAccessedAt on returned items
      touchAccess(filtered.map((i) => i.id));

      const lines = filtered.map((i, n) =>
        `${n + 1}. [${i.createdAt.slice(0, 10)}] ${i.text.slice(0, 120)}${i.text.length > 120 ? "\u2026" : ""}`
      );
      const label = staleDays > 0 ? `Stale brain memories (${staleDays}+ days, ${filtered.length})` : `Brain memories (${filtered.length})`;
      return { text: `${label}:\n${lines.join("\n")}` };
    },
  });

  // Command: /tags-brain
  api.registerCommand({
    name: "tags-brain",
    description: "List all unique tags across all brain memory items",
    usage: "/tags-brain",
    requireAuth: false,
    acceptsArgs: false,
    handler: async () => {
      const items = await store.list({ limit: 5000 });
      const tagSet = new Set<string>();
      for (const item of items) {
        for (const tag of item.tags ?? []) tagSet.add(tag);
      }
      if (tagSet.size === 0) return { text: "No tags found." };
      const sorted = [...tagSet].sort();
      return { text: `Tags (${sorted.length}): ${sorted.join(", ")}` };
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

  // Command: /export-brain [--tags tag1,tag2] [--format json|md]
  api.registerCommand({
    name: "export-brain",
    description: "Export brain memory items as JSON or Markdown. Use --tags tag1,tag2 to filter, --format md for Markdown output.",
    usage: "/export-brain [--tags tag1,tag2] [--format json|md]",
    requireAuth: false,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      const raw = String(ctx?.args ?? "").trim();
      const { tags } = parseTags(raw);
      const { format } = parseFormat(raw);
      const items = await store.list({ limit: 5000, ...(tags.length > 0 ? { tags } : {}) });
      if (items.length === 0) return { text: "No brain memories to export." };

      if (format === "md") {
        const exportDate = new Date().toISOString().split("T")[0]!;
        return { text: toMarkdown(items, exportDate) };
      }

      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        count: items.length,
        items,
      };
      return { text: JSON.stringify(payload, null, 2) };
    },
  });

  // Command: /purge-brain [--dry-run]
  api.registerCommand({
    name: "purge-brain",
    description: "Delete brain memory items older than the configured retention period (maxAgeDays). Use --dry-run to preview without deleting.",
    usage: "/purge-brain [--dry-run]",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      if (maxAgeDays <= 0) return { text: "Retention policy is not configured. Set retention.maxAgeDays in plugin config." };
      const raw = String(ctx?.args ?? "").trim();
      const dryRun = raw === "--dry-run";
      const result = await runRetention(dryRun);
      if (result.deleted === 0) return { text: `No items older than ${maxAgeDays} day(s). ${result.total} item(s) in store.` };
      if (dryRun) return { text: `Dry run: ${result.deleted} of ${result.total} item(s) would be deleted (older than ${maxAgeDays} day(s)).` };
      return { text: `Purged ${result.deleted} item(s) older than ${maxAgeDays} day(s). ${result.total - result.deleted} item(s) remaining.` };
    },
  });

  // Command: /import-brain <json>
  api.registerCommand({
    name: "import-brain",
    description: "Import brain memory items from a JSON export. Skips items that already exist.",
    usage: "/import-brain <json>",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      const raw = String(ctx?.args ?? "").trim();
      if (!raw) return { text: "Usage: /import-brain <json>" };

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return { text: "Invalid JSON input." };
      }

      let items: unknown[];
      if (Array.isArray(payload)) {
        items = payload;
      } else if (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).items)) {
        items = (payload as Record<string, unknown>).items as unknown[];
      } else {
        return { text: "Expected a JSON array or an object with an \"items\" array." };
      }

      if (items.length === 0) return { text: "No items to import." };

      let imported = 0;
      let skipped = 0;
      let invalid = 0;

      for (const entry of items) {
        if (!entry || typeof entry !== "object") { invalid++; continue; }
        const obj = entry as Record<string, unknown>;
        if (typeof obj.text !== "string" || !obj.text) { invalid++; continue; }
        if (typeof obj.createdAt !== "string") { invalid++; continue; }

        const id = typeof obj.id === "string" && obj.id ? obj.id : uuid();
        const existing = await store.get(id);
        if (existing) { skipped++; continue; }

        const kind = (["fact", "decision", "doc", "note"].includes(obj.kind as string)
          ? obj.kind : "note") as MemoryItem["kind"];
        const item: MemoryItem = {
          id,
          kind,
          text: obj.text as string,
          createdAt: obj.createdAt as string,
          tags: Array.isArray(obj.tags)
            ? (obj.tags as unknown[]).filter((t): t is string => typeof t === "string")
            : defaultTags,
          source: obj.source && typeof obj.source === "object"
            ? obj.source as MemoryItem["source"] : undefined,
          meta: obj.meta && typeof obj.meta === "object"
            ? obj.meta as Record<string, unknown> : undefined,
        };
        // T-012: Preserve optional timestamp fields from import data
        if (typeof obj.expiresAt === "string") item.expiresAt = obj.expiresAt;
        if (typeof obj.lastAccessedAt === "string") item.lastAccessedAt = obj.lastAccessedAt;

        await store.add(item);
        imported++;
      }

      const parts: string[] = [`Imported ${imported} item${imported !== 1 ? "s" : ""}.`];
      if (skipped > 0) parts.push(`${skipped} skipped (already exist).`);
      if (invalid > 0) parts.push(`${invalid} skipped (invalid format).`);
      return { text: parts.join(" ") };
    },
  });

  // Issue #3: Command: /brain-status - show capture stats and config
  api.registerCommand({
    name: "brain-status",
    description: "Show brain memory capture statistics and current configuration.",
    usage: "/brain-status",
    requireAuth: false,
    acceptsArgs: false,
    handler: async () => {
      const items = await store.list({ limit: 5000 });

      // T-011: Compute average capture score of the last 20 items that have a score
      const scoredItems = items
        .filter((i) => {
          const meta = i.meta as Record<string, unknown> | undefined;
          const capture = meta?.capture as Record<string, unknown> | undefined;
          return typeof capture?.score === "number";
        })
        .slice(-20);
      const avgScore = scoredItems.length > 0
        ? scoredItems.reduce((sum, i) => {
            const meta = i.meta as Record<string, unknown>;
            const capture = meta.capture as Record<string, unknown>;
            return sum + (capture.score as number);
          }, 0) / scoredItems.length
        : 0;

      const lines: string[] = [
        `Brain Memory Status`,
        `---`,
        `Total stored items: ${items.length}`,
        `Session stats:`,
        `  Messages processed: ${stats.totalMessages}`,
        `  Explicit captures: ${stats.explicitCaptures}`,
        `  Topic captures: ${stats.topicCaptures}`,
        `  Skipped (too short): ${stats.skippedShort}`,
        `  Skipped (channel policy): ${stats.skippedChannel}`,
        `  Skipped (duplicate): ${stats.skippedDuplicate}`,
        `  Skipped (low score): ${stats.skippedLowScore}`,
        `  Avg capture score (last 20): ${avgScore.toFixed(2)}`,
        `Config:`,
        `  requireExplicit: ${requireExplicit}`,
        `  minChars: ${minChars}`,
        `  captureThreshold: ${captureThreshold}`,
        `  dedupeThreshold: ${dedupeThreshold || "disabled"}`,
        `  defaultTtlMs: ${defaultTtlMs || "disabled"}`,
        `  channelPolicy: ${channelAllow.length > 0 ? "allow=" + channelAllow.join(",") : channelDeny.length > 0 ? "deny=" + channelDeny.join(",") : "default=" + channelDefaultPolicy}`,
        `  recencyBoost: ${recencyBoost}`,
        `  maxAgeDays: ${maxAgeDays || "disabled"}`,
      ];
      return { text: lines.join("\n") };
    },
  });

  // Command: /dedupe-brain [--threshold <0-1>] [--dry-run] [--delete]
  api.registerCommand({
    name: "dedupe-brain",
    description: "Find near-duplicate brain memory entries using Jaccard word-set similarity. Defaults to --dry-run. Use --delete to remove duplicates (keeps the oldest copy).",
    usage: "/dedupe-brain [--threshold <0.0-1.0>] [--dry-run] [--delete]",
    requireAuth: true,
    acceptsArgs: true,
    handler: async (ctx: CommandContext) => {
      const raw = String(ctx?.args ?? "").trim();

      // Parse --threshold N (accepts negative for clamping; rejects non-numeric)
      const thresholdMatch = raw.match(/--threshold\s+(-?[\d.]+)/);
      let threshold = 0.85;
      if (thresholdMatch) {
        const parsed = parseFloat(thresholdMatch[1]!);
        if (isNaN(parsed)) return { text: "Invalid --threshold value. Use a number between 0.0 and 1.0." };
        threshold = Math.min(1, Math.max(0, parsed));
      } else if (/--threshold\s+\S/.test(raw)) {
        // --threshold was given but with a non-numeric value
        return { text: "Invalid --threshold value. Use a number between 0.0 and 1.0." };
      }

      // Parse --delete flag (explicit deletion mode)
      const doDelete = /--delete\b/.test(raw);
      // Default is dry-run unless --delete is explicitly given
      const dryRun = !doDelete;

      const items = await store.list({ limit: 5000 });
      if (items.length === 0) return { text: "No brain memories stored yet." };

      // Find duplicate pairs: O(n^2) but acceptable for reasonable store sizes (<= 5000 items).
      // For each pair (i, j) with j > i, compute Jaccard similarity.
      // Track which items are already flagged as duplicates (to avoid cascading).
      const duplicateIds = new Set<string>();
      const pairs: Array<{ original: MemoryItem; duplicate: MemoryItem; score: number }> = [];

      for (let i = 0; i < items.length; i++) {
        if (duplicateIds.has(items[i]!.id)) continue;
        for (let j = i + 1; j < items.length; j++) {
          if (duplicateIds.has(items[j]!.id)) continue;
          const sim = jaccardSimilarity(items[i]!.text, items[j]!.text);
          if (sim >= threshold) {
            // Keep the older item (lower createdAt), mark newer as duplicate
            const older = items[i]!.createdAt <= items[j]!.createdAt ? items[i]! : items[j]!;
            const newer = older === items[i] ? items[j]! : items[i]!;
            duplicateIds.add(newer.id);
            pairs.push({ original: older, duplicate: newer, score: sim });
          }
        }
      }

      if (pairs.length === 0) {
        return { text: `No near-duplicates found (threshold=${threshold.toFixed(2)}, ${items.length} item(s) scanned).` };
      }

      // Build report
      const lines: string[] = [
        dryRun
          ? `Dry run: found ${pairs.length} near-duplicate pair(s) (threshold=${threshold.toFixed(2)}).`
          : `Deleting ${pairs.length} near-duplicate(s) (threshold=${threshold.toFixed(2)}).`,
        "",
      ];

      for (const { original, duplicate, score } of pairs) {
        const origDate = original.createdAt.slice(0, 10);
        const dupDate = duplicate.createdAt.slice(0, 10);
        const origPreview = original.text.slice(0, 80) + (original.text.length > 80 ? "\u2026" : "");
        const dupPreview = duplicate.text.slice(0, 80) + (duplicate.text.length > 80 ? "\u2026" : "");
        lines.push(`sim=${score.toFixed(2)}`);
        lines.push(`  KEEP [${origDate}] ${origPreview}`);
        lines.push(`  ${dryRun ? "WOULD DELETE" : "DELETED"} [${dupDate}] ${dupPreview}`);
        if (!dryRun) {
          await store.delete(duplicate.id);
        }
      }

      if (dryRun) {
        lines.push("");
        lines.push(`Run /dedupe-brain --delete to remove the ${pairs.length} duplicate(s).`);
      } else {
        lines.push("");
        lines.push(`Removed ${pairs.length} duplicate(s). ${items.length - pairs.length} item(s) remaining.`);
      }

      return { text: lines.join("\n") };
    },
  });

  // Auto-capture from inbound messages.
  api.on("message_received", async (event: MessageEvent, ctx: MessageEventContext) => {
    try {
      stats.totalMessages++;
      const content = String(event?.content ?? "").trim();
      if (!content) return;

      if (content.length < minChars) {
        stats.skippedShort++;
        return;
      }

      // Issue #1: Per-channel capture policy
      const channel = ctx?.messageProvider;
      if (!isChannelAllowed(channel)) {
        stats.skippedChannel++;
        api.logger?.info?.(`[memory-brain] skipped capture: channel "${channel}" not allowed by policy`);
        return;
      }

      const isExplicit = includesAny(content, explicitTriggers);
      const isTopic = includesAny(content, autoTopics);

      // T-011: Compute confidence score and apply threshold
      const captureScore = scoreCapture(content, { explicitTriggers, autoTopics });

      if (requireExplicit && !isExplicit) return;
      if (!requireExplicit && !isExplicit && !isTopic) return;

      if (captureScore < captureThreshold) {
        stats.skippedLowScore++;
        api.logger?.info?.(`[memory-brain] skipped low-score capture (score=${captureScore.toFixed(2)}, threshold=${captureThreshold})`);
        return;
      }

      // Issue #3: Strip trigger prefix from captured text
      const cleanedContent = isExplicit ? stripTriggerPrefix(content) : content;
      const textToStore = cleanedContent || content; // fallback if stripping removes everything

      // Issue #2: Dedupe check
      if (await isDuplicate(textToStore)) {
        stats.skippedDuplicate++;
        api.logger?.info?.(`[memory-brain] skipped duplicate capture`);
        return;
      }

      const r = redactSecrets ? redactor.redact(textToStore) : { redactedText: textToStore, hadSecrets: false, matches: [] as Array<{rule: string; count: number}> };
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
          capture: { explicit: isExplicit, topic: isTopic, score: captureScore },
          ...(r.hadSecrets ? { redaction: { hadSecrets: true, matches: r.matches } } : {})
        }
      };

      // Issue #2: Apply TTL if configured
      if (defaultTtlMs > 0) {
        item.expiresAt = ttlMs(defaultTtlMs);
      }

      await store.add(item);

      if (isExplicit) stats.explicitCaptures++;
      if (isTopic && !isExplicit) stats.topicCaptures++;

      api.logger?.info?.(`[memory-brain] captured memory (explicit=${isExplicit} topic=${isTopic}) id=${item.id}`);
    } catch (err: unknown) {
      api.logger?.error?.(`[memory-brain] failed to capture message: ${(err as Error).message}`);
    }
  });
}
