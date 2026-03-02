# openclaw-memory-brain: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Each item should be self-contained, the agent must be able to start without asking questions.
> Blocked tasks go to the bottom. Completed tasks move to "Recently Completed".

---

## Status Summary

| State | Count |
|-------|-------|
| Done | 12 |
| Ready | 2 |
| Blocked | 0 |

v0.3 in progress. T-011 (confidence scoring) and T-012 (lastAccessedAt + recency) complete. 2 tasks remaining.

---

## Ready - Work These Next

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
| T-012: Track lastAccessedAt and boost recently-accessed memories (#11) - lastAccessedAt field, recency boost (search.recencyBoost), /list-brain --stale, 244 tests | 2026-03-02 |
| T-011: Add confidence-scored auto-capture (#10) - scoreCapture function, captureThreshold config, meta.capture.score, avg score in /brain-status | 2026-03-02 |
| T-001: Define v0.2 roadmap items as issues and prioritize (#9) - 8 issues created, all implemented and closed | 2026-03-01 |
| T-010: v0.2: per-channel capture policy (#1) - allow/deny lists, default policy | 2026-03-01 |
| T-009: v0.2: dedupe + TTL (#2) - fixed test race conditions, verified feature complete | 2026-03-01 |

---

## Reference: Key File Locations

| What | Where |
|------|-------|
| Plugin entry | `index.ts` |
| Core dependency | `../openclaw-memory-core/src/` |
| Plugin manifest | `openclaw.plugin.json` |
| Package config | `package.json` |
| Test suite | `tests/plugin.test.ts` (244 tests) |
