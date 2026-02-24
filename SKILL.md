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
- Command: **`/remember-brain <text>`** (explicit save)

## Capture behavior (Convention)

By default this plugin uses **explicit capture only**.

A message is captured when:
- it is long enough (`minChars`, default 80)
- AND it contains an explicit trigger, recommended format: **"Merke dir:"**

If you want more aggressive capture, set `requireExplicit: false` in config (not recommended for OPSEC).

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
