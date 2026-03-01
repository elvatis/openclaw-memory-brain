# openclaw-memory-brain: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Each item should be self-contained, the agent must be able to start without asking questions.
> Blocked tasks go to the bottom. Completed tasks move to "Recently Completed".

---

## Status Summary

| State | Count |
|-------|-------|
| Done | 10 |
| Ready | 0 |
| Blocked | 0 |

All v0.2 tasks are complete. The project is ready for v0.3 planning.

---

## Ready - Work These Next

(No ready tasks - all v0.2 work is complete)

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
