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
| `build` passes | untested | - | - | |
| `test` passes | untested | - | - | |
| `lint` passes | untested | - | - | |
| `type-check` passes | untested | - | - | |

---

## Plugin Behaviour

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| Plugin registers correctly | untested | - | - | |
| memory-core dependency resolves | untested | - | - | |
| Commands work end-to-end | untested | - | - | |
| No PII leaks in output | untested | - | - | |

---

## Security

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| No secrets in source | assumed | - | - | Pre-commit hooks configured |
| No PII written to disk unredacted | untested | - | - | |
| Dependency audit clean | untested | - | - | |

---

## Update Rules (for agents)

- Change `untested` -> `verified` only after **running actual code/tests**
- Change `assumed` -> `verified` after direct confirmation
- Never downgrade `verified` without explaining why in `LOG.md`
- Add new rows when new system properties become critical

---

*Trust degrades over time. Re-verify periodically, especially after major refactors.*
