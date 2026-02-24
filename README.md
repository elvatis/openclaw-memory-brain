# openclaw-memory-brain

OpenClaw plugin: **Personal Brain Memory**.

This plugin is more automatic than `openclaw-memory-docs`:
- It listens for inbound messages and captures likely-valuable notes.
- It stores locally in a JSONL file and supports semantic-ish search.

## Install

### ClawHub

```bash
clawhub install openclaw-memory-brain
```

### Dev

```bash
openclaw plugins install -l ~/.openclaw/workspace/openclaw-memory-brain
openclaw gateway restart
```

## Search

Tool: `brain_memory_search({ query, limit })`

## Capture Rules (default)

Captures a message when:
- length >= `minChars` (default 80)
- AND either:
  - contains explicit triggers ("merke dir", "notiere", ...)
  - OR contains configured topics ("entscheidung", "decision", ...)

## Config

```json
{
  "plugins": {
    "entries": {
      "openclaw-memory-brain": {
        "enabled": true,
        "config": {
          "storePath": "~/.openclaw/workspace/memory/brain-memory.jsonl",
          "dims": 256,
          "redactSecrets": true,
          "capture": {
            "minChars": 80,
            "requireExplicit": false,
            "explicitTriggers": ["merke dir", "remember this", "notiere", "keep this"],
            "autoTopics": ["entscheidung", "decision"]
          },
          "defaultTags": ["brain"]
        }
      }
    }
  }
}
```
