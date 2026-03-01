# openclaw-memory-brain: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Each item should be self-contained, the agent must be able to start without asking questions.
> Blocked tasks go to the bottom. Completed tasks move to "Recently Completed".

---

## Status Summary

| State | Count |
|-------|-------|
| Done | 9 |
| Ready | 1 |
| Blocked | 0 |

---

## Ready - Work These Next

### T-010: v0.2: per-channel capture policy (GitHub #1)

**Goal:** Add allowlist/denylist for capture by channel/provider.

**Context:**
- Per-channel capture policy is already fully implemented in `index.ts`
- `isChannelAllowed()` function (lines 109-117) handles allow/deny lists with case-insensitive matching
- Config supports `capture.channels.allow`, `capture.channels.deny`, `capture.channels.defaultPolicy`
- 15 dedicated tests already exist in `tests/plugin.test.ts` covering all policy combinations
- Stats tracking for skipped channels (`stats.skippedChannel`) is in place
- This task likely just needs verification and marking as done

**What to do:**
1. Review existing channel policy implementation in `index.ts` (lines 76-79, 109-117, 497-503)
2. Verify tests cover channel allow/deny/default policy configurations (they do - 15 tests)
3. If all acceptance criteria are met, mark as done in MANIFEST.json
4. Close GitHub issue #1

**Files:** `index.ts`, `tests/plugin.test.ts`, `.ai/handoff/MANIFEST.json`

**Definition of done:**
- Config schema supports `capture.channels.allow`, `capture.channels.deny`, `capture.channels.defaultPolicy`
- Messages from denied channels are skipped
- Messages from non-allowed channels are skipped when allow list is set
- Default policy fallback works correctly
- Tests cover channel policy behavior

---

## Blocked

(No blocked tasks)

---

## Recently Completed

| Task | Date |
|------|------|
| T-009: v0.2: dedupe + TTL (#2) - fixed test race conditions, verified feature complete | 2026-03-01 |
| T-008: v0.2: explicit capture UX (#3) - trigger prefix stripping, --tags, id in confirmation | 2026-03-01 |
| T-007: Add time-based retention policy with automatic cleanup (#7) | 2026-02-27 |
| T-006: Add retention policy (#7) | 2026-02-27 |
| T-005: Add export/import commands (#6) | 2026-02-27 |

---

## Reference: Key File Locations

| What | Where |
|------|-------|
| Plugin entry | `index.ts` |
| Core dependency | `../openclaw-memory-core/src/` |
| Plugin manifest | `openclaw.plugin.json` |
| Package config | `package.json` |
| Test suite | `tests/plugin.test.ts` (196 tests) |
