# openclaw-memory-brain: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Each item should be self-contained, the agent must be able to start without asking questions.
> Blocked tasks go to the bottom. Completed tasks move to "Recently Completed".

---

## Status Summary

| State | Count |
|-------|-------|
| Done | 8 |
| Ready | 2 |
| Blocked | 0 |

---

## Ready - Work These Next

### T-009: v0.2: dedupe + TTL (GitHub #2)

**Goal:** Add deduplication and optional TTL/retention.

**Context:**
- Deduplication (`dedupeThreshold`) and TTL (`defaultTtlMs`) are already implemented in `index.ts`
- `isDuplicate()` function checks for near-duplicates before capture
- TTL is applied via `ttlMs()` and `store.purgeExpired()` on startup
- Need to verify if all acceptance criteria are met: config + tests

**What to do:**
1. Review existing dedupe and TTL implementation in `index.ts` (lines 82-83, 136-141, 245-247, 516-519)
2. Verify tests cover `dedupeThreshold` and `defaultTtlMs` configuration
3. If tests are missing, add them; if implementation is complete, mark as done
4. Close GitHub issue #2

**Files:** `index.ts`, `tests/plugin.test.ts`

**Definition of done:**
- Config schema supports `dedupeThreshold` and `defaultTtlMs`
- Near-duplicate messages are skipped during auto-capture
- TTL-expired items are purged on startup
- Tests cover dedupe and TTL behavior

---

### T-010: v0.2: per-channel capture policy (GitHub #1)

**Goal:** Add allowlist/denylist for capture by channel/provider.

**Context:**
- Per-channel capture policy is already implemented in `index.ts`
- `isChannelAllowed()` function (lines 109-117) handles allow/deny lists
- Config supports `capture.channels.allow`, `capture.channels.deny`, `capture.channels.defaultPolicy`
- Need to verify if all acceptance criteria are met: config schema + tests

**What to do:**
1. Review existing channel policy implementation in `index.ts` (lines 76-79, 109-117, 497-503)
2. Verify tests cover channel allow/deny/default policy configurations
3. If tests are missing, add them; if implementation is complete, mark as done
4. Close GitHub issue #1

**Files:** `index.ts`, `tests/plugin.test.ts`

**Definition of done:**
- Config schema supports `capture.channels.allow`, `capture.channels.deny`, `capture.channels.defaultPolicy`
- Messages from denied channels are skipped
- Messages from non-allowed channels are skipped when allow list is set
- Tests cover channel policy behavior

---

## Blocked

(No blocked tasks)

---

## Recently Completed

| Task | Date |
|------|------|
| T-008: v0.2: explicit capture UX (#3) - trigger prefix stripping, --tags, id in confirmation | 2026-03-01 |
| T-007: Add time-based retention policy with automatic cleanup (#7) | 2026-02-27 |
| T-006: Add retention policy (#7) | 2026-02-27 |
| T-005: Add export/import commands (#6) | 2026-02-27 |
| T-004: Add tag-based filtering (#5) | 2026-02-27 |

---

## Reference: Key File Locations

| What | Where |
|------|-------|
| Plugin entry | `index.ts` |
| Core dependency | `../openclaw-memory-core/src/` |
| Plugin manifest | `openclaw.plugin.json` |
| Package config | `package.json` |
| Test suite | `tests/plugin.test.ts` (196 tests) |
