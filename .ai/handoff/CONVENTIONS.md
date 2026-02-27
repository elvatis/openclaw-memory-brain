# openclaw-memory-brain: Agent Conventions

> Every agent working on this project must read and follow these conventions.
> Update this file whenever a new standard is established.

---

## Language

- All code, comments, commits, and documentation in **English only**
- i18n/translation keys in camelCase English

## Code Style

- **TypeScript:** strict mode, Zod for I/O validation, Prettier formatting
- **Runtime:** Node.js ESM (`"type": "module"`)
- Depends on `@elvatis_com/openclaw-memory-core` - use its public API only

## Branching & Commits

```
feat/<scope>-<short-name>    -> new feature
fix/<scope>-<short-name>     -> bug fix
docs/<scope>-<name>          -> documentation only
refactor/<scope>-<name>      -> no behaviour change

Commit format:
  feat(scope): add description [AAHP-auto]
  fix(scope): resolve issue [AAHP-auto]
```

## Architecture Principles

- **Zero-Persistence**: memory contents processed in RAM only
- **No PII in logs**: redaction must happen before any data is logged
- **Plugin-first**: this is an OpenClaw plugin; register via `api.on()` / `api.registerCommand()`

## Testing

- All new code must have unit tests
- Tests must pass before every commit
- Type-check must pass before every commit

## Formatting

- **No em dashes (`-`)**: Never use Unicode em dashes in any file. Use a regular hyphen (`-`) instead.

## What Agents Must NOT Do

- Push directly to `main`
- Install new dependencies without documenting the reason
- Write secrets or credentials into source files
- Delete existing tests (fix or replace instead)
- Use em dashes (`-`) anywhere in the codebase

---

*This file is maintained by agents and humans together. Update it when conventions evolve.*
