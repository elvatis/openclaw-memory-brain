# openclaw-memory-brain: Trust Register

> Tracks verification status of critical system properties.
> In multi-agent pipelines, hallucinations and drift are real risks.
> Every claim here has a confidence level tied to how it was verified.

---

## Confidence Levels

| Level | Meaning |
|-------|---------|
| **verified** | An agent executed code, ran tests, or observed output to confirm this |
| **assumed** | Derived from docs, config files, or chat, not directly tested |
| **untested** | Status unknown; needs verification |

---

## Build System

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| `build` passes | verified | 2026-02-27 | claude-opus-4.6 | `tsc --noEmit` clean |
| `test` passes | verified | 2026-02-27 | claude-opus-4.6 | 58 tests, all passing |
| `lint` passes | untested | - | - | No linter configured |
| `type-check` passes | verified | 2026-02-27 | claude-opus-4.6 | Strict mode, zero errors |

---

## Plugin Behaviour

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| Plugin registers correctly | verified | 2026-02-27 | claude-opus-4.6 | 5 tests in "register()" suite |
| memory-core dependency resolves | verified | 2026-02-27 | claude-opus-4.6 | All 58 tests import and use it |
| Commands work end-to-end | verified | 2026-02-27 | claude-opus-4.6 | All 4 commands tested with real store |
| No PII leaks in output | verified | 2026-02-27 | claude-opus-4.6 | Redaction tested in commands and auto-capture |

---

## Security

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| No secrets in source | assumed | - | - | Pre-commit hooks configured |
| No PII written to disk unredacted | verified | 2026-02-27 | claude-opus-4.6 | DefaultRedactor tested, redaction confirmed |
| Dependency audit clean | untested | - | - | |

---

## Update Rules (for agents)

- Change `untested` -> `verified` only after **running actual code/tests**
- Change `assumed` -> `verified` after direct confirmation
- Never downgrade `verified` without explaining why in `LOG.md`
- Add new rows when new system properties become critical

---

*Trust degrades over time. Re-verify periodically, especially after major refactors.*
