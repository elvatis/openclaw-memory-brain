# openclaw-memory-brain: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Each item should be self-contained, the agent must be able to start without asking questions.
> Blocked tasks go to the bottom. Completed tasks move to "Recently Completed".

---

## T-003: Update README and SKILL.md (GitHub #8)

**Goal:** Document all v0.1.2 commands and configuration options.

**Context:**
- README only documents /remember-brain and brain_memory_search
- /search-brain, /list-brain, /forget-brain are undocumented
- maxItems config is undocumented

**What to do:**
1. Add Commands section to README.md with all 5 commands and usage
2. Update Config section with maxItems
3. Update SKILL.md with complete feature list
4. No em dashes

**Definition of done:**
- [ ] All commands documented in README.md
- [ ] SKILL.md updated
- [ ] Config section reflects current schema

---

## T-004: Add tag-based filtering (GitHub #5)

**Goal:** Allow filtering search and list results by tag.

**Context:**
- Tests are now in place (T-002 complete, 58 tests)
- Add `tags` filter parameter to /search-brain and /list-brain
- Add tests for the new filtering logic

---

## T-005: Add export/import commands (GitHub #6)

**Goal:** Add /export-brain and /import-brain for backup and portability.

**Context:**
- Tests are now in place (T-002 complete, 58 tests)
- Add tests for the new commands

---

## T-006: Add retention policy (GitHub #7)

**Goal:** Add time-based cleanup with configurable maxAgeDays.

**Context:**
- Tests are now in place (T-002 complete, 58 tests)
- Add tests for the retention logic

---

## Recently Completed

| Item | Resolution |
|------|-----------|
| T-002: Implement unit test suite (#4) | 58 tests covering all commands, tool, auto-capture, config, edge cases (2026-02-27) |
| T-001: Define v0.2 roadmap | 5 GitHub issues created (#4-#8), DASHBOARD updated (2026-02-27) |
| Initial scaffold | Created 2026-02-24 |

---

## Reference: Key File Locations

| What | Where |
|------|-------|
| Plugin entry | `index.ts` |
| Core dependency | `../openclaw-memory-core/src/` |
| Plugin manifest | `openclaw.plugin.json` |
| Package config | `package.json` |
