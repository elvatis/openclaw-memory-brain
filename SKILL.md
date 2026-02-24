---
name: openclaw-memory-brain
description: "OpenClaw plugin for personal memory: auto-capture with guardrails + local semantic-ish search with safe redaction."
---

# openclaw-memory-brain

This is an **OpenClaw Gateway plugin** that behaves like a lightweight personal brain:
- it listens to inbound messages
- captures likely valuable notes when certain triggers/topics occur
- allows semantic-ish recall via a search tool

Everything is stored locally (JSONL) with optional secret redaction.

## What it does

- Hook: `message_received` → optional capture
- Tool: **`brain_memory_search({ query, limit })`**

## Capture behavior

A message is captured when:
- it is long enough (`minChars`, default 80)
- AND it contains either:
  - explicit triggers (default: "merke dir", "notiere", "remember this", ...)
  - or configured topics (default: "entscheidung", "decision")

You can force explicit-only mode with `requireExplicit: true`.

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

Tool call example:

```json
{ "query": "Anthropic reset schedule", "limit": 5 }
```

## Configuration

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

## Safety

- The plugin redacts common secrets (tokens, keys, private key blocks) before storage.
- If you need strict control and explicit capture only, use `openclaw-memory-docs`.
