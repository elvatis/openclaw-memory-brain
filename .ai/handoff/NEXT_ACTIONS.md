# openclaw-memory-brain: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Each item should be self-contained, the agent must be able to start without asking questions.
> Blocked tasks go to the bottom. Completed tasks move to "Recently Completed".

---

## Status Summary

| State | Count |
|-------|-------|
| Done | 10 |
| Ready | 4 |
| Blocked | 0 |

All v0.2 tasks are complete. v0.3 roadmap is ready.

---

## Ready - Work These Next

### T-011 [high] - Add confidence-scored auto-capture to reduce low-quality captures
- **Goal:** Replace boolean trigger matching with a weighted 0..1 confidence score, only capturing when score >= threshold.
- **Scope:** Export `scoreCapture(text, config) -> number`. Signals: trigger match (+0.4), topic match (+0.2), length >= 120 (+0.2), structural markers (+0.2). Add `captureThreshold` config (default 0.4). Expose `captureScore` in item `meta`. Update `/brain-status`.
- **Definition of done:** `scoreCapture` exported and tested; threshold config documented; `/brain-status` shows avg score of last 20 items.
- **Files:** `index.ts`, `tests/plugin.test.ts`, `README.md`
- **GitHub Issue:** #10

### T-012 [medium] - Track lastAccessedAt and boost recently-accessed memories in search
- **Goal:** Record when each memory is last accessed and apply a recency boost to search ranking.
- **Scope:** Add optional `lastAccessedAt` to `MemoryItem`. Update `/search-brain` and `brain_memory_search` to set it. Apply recency boost: `adjustedScore = semanticScore * (1 + recencyBoost * accessRecencyFactor)`. Add `--stale [days]` to `/list-brain`.
- **Definition of done:** `lastAccessedAt` set on hits; recency boost applied; `/list-brain --stale 30` works; backwards compatible.
- **Files:** `index.ts`, `tests/plugin.test.ts`, `README.md`
- **GitHub Issue:** #11

### T-013 [medium] - Add Markdown export format to /export-brain
- **Goal:** Add `--format md` to `/export-brain` for human-readable Markdown output grouped by tags.
- **Scope:** Markdown document with tag headings (alphabetical), items as `- [date] text`. Items with multiple tags appear under each. Items with no tags under `(untagged)`. Compatible with `--tags` filter. Default format remains JSON.
- **Definition of done:** `--format md` returns valid Markdown; tag grouping tested; README updated.
- **Files:** `index.ts`, `tests/plugin.test.ts`, `README.md`
- **GitHub Issue:** #12

### T-014 [low] - Add /dedupe-brain command for near-duplicate memory cleanup
- **Goal:** Find and delete older near-duplicate memories from the store, keeping the most recent in each cluster.
- **Scope:** `/dedupe-brain [--dry-run] [--threshold 0.85]`. Load all items, cluster by similarity >= threshold, keep newest, delete rest. `--dry-run` reports without deleting. Output: `Found N clusters. Deleted M items.`
- **Definition of done:** `--dry-run` previews; deletion removes older duplicates; `--threshold` overrides config; tests cover all paths.
- **Files:** `index.ts`, `tests/plugin.test.ts`, `README.md`
- **GitHub Issue:** #13

---

## Blocked

(No blocked tasks)

---

## Recently Completed

| Task | Date |
|------|------|
| T-001: Define v0.2 roadmap items as issues and prioritize (#9) - 8 issues created, all implemented and closed | 2026-03-01 |
| T-010: v0.2: per-channel capture policy (#1) - allow/deny lists, default policy, 15 tests | 2026-03-01 |
| T-009: v0.2: dedupe + TTL (#2) - fixed test race conditions, verified feature complete | 2026-03-01 |
| T-008: v0.2: explicit capture UX (#3) - trigger prefix stripping, --tags, id in confirmation | 2026-03-01 |
| T-007: Add time-based retention policy with automatic cleanup (#7) | 2026-02-27 |

---

## Reference: Key File Locations

| What | Where |
|------|-------|
| Plugin entry | `index.ts` |
| Core dependency | `../openclaw-memory-core/src/` |
| Plugin manifest | `openclaw.plugin.json` |
| Package config | `package.json` |
| Test suite | `tests/plugin.test.ts` (196 tests) |
