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

Explicit save command: `/remember-brain <text>`

## Capture Rules (default)

Convention: brain-memory should **not** silently store lots of chat.

Captures a message when:
- length >= `minChars` (default 80)
- AND it contains an explicit trigger (recommended format: **"Merke dir:"**)

If you want more aggressive capture, set `requireExplicit: false` (not recommended for OPSEC).

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
            "requireExplicit": true,
            "explicitTriggers": ["merke dir", "merke dir:", "remember this", "remember this:", "notiere", "keep this"],
            "autoTopics": ["entscheidung", "decision"]
          },
          "defaultTags": ["brain"]
        }
      }
    }
  }
}
```
