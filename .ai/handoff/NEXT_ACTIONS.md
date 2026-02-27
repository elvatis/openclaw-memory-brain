# openclaw-memory-brain: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Each item should be self-contained, the agent must be able to start without asking questions.
> Blocked tasks go to the bottom. Completed tasks move to "Recently Completed".

---

## T-002: Implement unit test suite (GitHub #4)

**Goal:** Create a comprehensive unit test suite for all commands, the search tool, and auto-capture logic.

**Context:**
- v0.1.2 is in place with 5 commands and auto-capture
- Zero tests exist currently
- CONVENTIONS.md requires tests before every commit
- This unblocks all other v0.2 work

**What to do:**
1. Add vitest as a dev dependency
2. Create `index.test.ts` with mocks for PluginApi, JsonlMemoryStore, DefaultRedactor, HashEmbedder
3. Test brain_memory_search tool (happy path, empty query, limit clamping)
4. Test /remember-brain (save, redaction, empty args)
5. Test /search-brain (query parsing, trailing limit, empty results)
6. Test /list-brain (default limit, custom limit, empty store)
7. Test /forget-brain (success, nonexistent ID)
8. Test message_received auto-capture (explicit triggers, topic triggers, minChars, requireExplicit, error handling)
9. Test config edge cases (enabled=false, invalid storePath)
10. Aim for >80% line coverage

**Definition of done:**
- [ ] `index.test.ts` exists with tests for all commands and auto-capture
- [ ] `vitest` configured and passing
- [ ] Coverage >80% on index.ts

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

## T-004: Add tag-based filtering (GitHub #5) [blocked by T-002]

**Goal:** Allow filtering search and list results by tag.

**Blocked by:** T-002 (need tests in place before adding features)

---

## T-005: Add export/import commands (GitHub #6) [blocked by T-002]

**Goal:** Add /export-brain and /import-brain for backup and portability.

**Blocked by:** T-002 (need tests in place before adding features)

---

## T-006: Add retention policy (GitHub #7) [blocked by T-002]

**Goal:** Add time-based cleanup with configurable maxAgeDays.

**Blocked by:** T-002 (need tests in place before adding features)

---

## Recently Completed

| Item | Resolution |
|------|-----------|
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
