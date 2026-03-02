# openclaw-memory-brain: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Each item should be self-contained, the agent must be able to start without asking questions.
> Blocked tasks go to the bottom. Completed tasks move to "Recently Completed".

---

## Status Summary

| State | Count |
|-------|-------|
| Done | 11 |
| Ready | 3 |
| Blocked | 0 |

v0.3 in progress. T-011 (confidence scoring) complete. 3 tasks remaining.

---

## Ready - Work These Next

### T-012 [medium] - Track lastAccessedAt and boost recently-accessed memories in search
- **Goal:** Record when each memory is last accessed and apply a recency boost to search ranking.
- **Context:** Search results are ranked purely by semantic similarity. Stale memories surface alongside frequently used ones with equal weight. No record of when an item was last retrieved.
- **What to do:**
  - Add optional `lastAccessedAt?: string` field to MemoryItem (ISO timestamp)
  - Update `/search-brain` and `brain_memory_search` tool to set `lastAccessedAt` on returned items
  - Apply recency boost: `adjustedScore = semanticScore * (1 + recencyBoost * accessRecencyFactor)`
  - Add `recencyBoost` config option (default 0.1, range 0..1)
  - `accessRecencyFactor` = days since last access (capped at 90), normalized 0..1 inverted
  - Add `--stale` flag to `/list-brain`: `/list-brain --stale [days]` lists items not accessed in N days
- **Files:** `index.ts`, `tests/plugin.test.ts`, `README.md`, `openclaw.plugin.json`
- **Definition of done:** `lastAccessedAt` is set on search/list hit items; recency boost applied; `/list-brain --stale 30` works; backwards compatible; tests pass.
- **GitHub Issue:** #11

### T-013 [medium] - Add Markdown export format to /export-brain
- **Goal:** Add `--format md` to `/export-brain` for human-readable Markdown output grouped by tags.
- **Context:** The `/export-brain` command currently only exports JSON. Users who want to review brain memory in a text editor, Obsidian, or Notion have no human-friendly option.
- **What to do:**
  - Add `--format md` flag to `/export-brain`
  - When `--format md` is specified, output a Markdown document:
    - Title: `# Brain Memory Export - <date>`
    - Grouped by tags (alphabetical), with `## <tag>` headings
    - Items under each heading: `- [<date>] <text>`
    - Items with multiple tags appear under each relevant tag heading
    - Items with no tags appear under `## (untagged)`
  - Default format remains JSON (no breaking change)
  - `--tags` filter is compatible with `--format md`
- **Files:** `index.ts`, `tests/plugin.test.ts`, `README.md`
- **Definition of done:** `/export-brain --format md` returns valid Markdown; tags sorted alphabetically; `--tags` + `--format md` works; tests cover Markdown output; README updated.
- **GitHub Issue:** #12

### T-014 [low] - Add /dedupe-brain command for near-duplicate memory cleanup
- **Goal:** Find and delete older near-duplicate memories from the store, keeping the most recent in each cluster.
- **Context:** Over time, similar memories accumulate. The existing `dedupeThreshold` config prevents new duplicates at capture time but does not clean up existing duplicates.
- **What to do:**
  - Add `/dedupe-brain [--dry-run] [--threshold 0.9]` command
  - Algorithm: load all items, cluster by similarity >= threshold, keep newest in each cluster, delete rest
  - Default threshold: `dedupeThreshold` config value, or 0.85 if not set
  - `--dry-run` flag: report what would be deleted without deleting
  - `--threshold <value>` flag: override threshold for this run
  - Output summary: `Found N duplicate clusters. Deleted M items. (X kept)`
- **Files:** `index.ts`, `tests/plugin.test.ts`, `README.md`
- **Definition of done:** `--dry-run` previews; deletion removes older duplicates; `--threshold` overrides config; tests cover all paths; README updated.
- **GitHub Issue:** #13

---

## Blocked

(No blocked tasks)

---

## Recently Completed

| Task | Date |
|------|------|
| T-011: Add confidence-scored auto-capture (#10) - scoreCapture function, captureThreshold config, meta.capture.score, avg score in /brain-status, 225 tests | 2026-03-02 |
| T-001: Define v0.2 roadmap items as issues and prioritize (#9) - 8 issues created, all implemented and closed | 2026-03-01 |
| T-010: v0.2: per-channel capture policy (#1) - allow/deny lists, default policy, 15 tests | 2026-03-01 |
| T-009: v0.2: dedupe + TTL (#2) - fixed test race conditions, verified feature complete | 2026-03-01 |
| T-008: v0.2: explicit capture UX (#3) - trigger prefix stripping, --tags, id in confirmation | 2026-03-01 |

---

## Reference: Key File Locations

| What | Where |
|------|-------|
| Plugin entry | `index.ts` |
| Core dependency | `../openclaw-memory-core/src/` |
| Plugin manifest | `openclaw.plugin.json` |
| Package config | `package.json` |
| Test suite | `tests/plugin.test.ts` (225 tests) |
