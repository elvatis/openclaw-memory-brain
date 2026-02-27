# openclaw-memory-brain: Build Dashboard

> Single source of truth for build health, test coverage, and pipeline state.
> Updated by agents at the end of every completed task.

---

## Components

| Name | Version | Build | Tests | Status | Notes |
|------|---------|-------|-------|--------|-------|
| openclaw-memory-brain | 0.1.2 | Unknown | - | Active | OpenClaw memory plugin (brain) |

**Legend:** OK passing - FAIL failing - stub/mock - pending - blocked

---

## Test Coverage

| Suite | Tests | Status | Last Run |
|-------|-------|--------|----------|
| unit | 0 | Not yet created | - |

---

## Pipeline State

| Field | Value |
|-------|-------|
| Current task | v0.2 roadmap defined - ready for implementation |
| Phase | planning-complete |
| Last completed | T-001: Define v0.2 roadmap (2026-02-27) |
| Rate limit | None |

---

## v0.2 Roadmap (GitHub Issues)

| ID | Issue | Priority | Labels | Status |
|----|-------|----------|--------|--------|
| #4 | [Add unit test suite for all commands and auto-capture](https://github.com/homeofe/openclaw-memory-brain/issues/4) | HIGH | enhancement, v0.2 | Open |
| #5 | [Add tag-based filtering to search and list commands](https://github.com/homeofe/openclaw-memory-brain/issues/5) | MEDIUM | enhancement, v0.2 | Open |
| #6 | [Add memory export and import commands for backup and portability](https://github.com/homeofe/openclaw-memory-brain/issues/6) | MEDIUM | enhancement, v0.2 | Open |
| #7 | [Add time-based retention policy with automatic cleanup](https://github.com/homeofe/openclaw-memory-brain/issues/7) | LOW | enhancement, v0.2 | Open |
| #8 | [Update README and SKILL.md to document all v0.1.2 commands](https://github.com/homeofe/openclaw-memory-brain/issues/8) | HIGH | documentation, v0.2 | Open |

### Recommended Implementation Order

1. #4 - Unit tests (unblocks confident iteration on all other issues)
2. #8 - Documentation update (quick win, no code risk)
3. #5 - Tag-based filtering (core UX improvement)
4. #6 - Export/import (portability feature)
5. #7 - Retention policy (nice-to-have, lowest urgency)

---

## Open Tasks (strategic priority)

| ID | Task | Priority | Blocked by | Ready? |
|----|------|----------|-----------|--------|
| T-002 | Implement unit test suite (#4) | HIGH | - | OK Ready |
| T-003 | Update README and SKILL.md (#8) | HIGH | - | OK Ready |
| T-004 | Add tag-based filtering (#5) | MEDIUM | T-002 | Blocked (needs tests first) |
| T-005 | Add export/import commands (#6) | MEDIUM | T-002 | Blocked (needs tests first) |
| T-006 | Add retention policy (#7) | LOW | T-002 | Blocked (needs tests first) |

---

## Completed Tasks

| ID | Task | Completed |
|----|------|-----------|
| T-001 | Define v0.2 roadmap items as issues and prioritize | 2026-02-27 |

---

## Update Instructions (for agents)

After completing any task:

1. Update the relevant row to OK with current date
2. Update test counts
3. Update "Pipeline State"
4. Move completed task out of "Open Tasks"
5. Add newly discovered tasks with correct priority
