---
name: openclaw-memory-brain
description: "OpenClaw plugin for personal memory: auto-capture with guardrails + local semantic-ish search with safe redaction."
---

# openclaw-memory-brain

This is an **OpenClaw Gateway plugin** that behaves like a lightweight personal brain:
- It listens to inbound messages and captures likely-valuable notes when certain triggers or topics occur.
- It allows semantic-ish recall via a search tool and slash commands.
- Everything is stored locally (JSONL) with optional secret redaction.

## Commands

### `/remember-brain <text>`

Explicitly save a personal brain memory item.

- **Auth required:** No
- **Arguments:** The text to remember (required)

```
/remember-brain TypeScript 5.5 requires explicit return types on exported functions
```

Response: `Saved brain memory.` (or `Saved brain memory. (secrets redacted)` when secrets are detected and redacted).

### `/search-brain <query> [limit]`

Search brain memory items by semantic similarity.

- **Auth required:** No
- **Arguments:** Search query (required), optional trailing number for limit (default 5, max 20)

```
/search-brain architecture decisions
/search-brain deployment process 10
```

Response: Numbered list of results with similarity scores and text previews, or `No brain memories found for: <query>` when empty.

### `/list-brain [limit]`

List the most recent brain memory items.

- **Auth required:** No
- **Arguments:** Optional limit number (default 10, max 50)

```
/list-brain
/list-brain 20
```

Response: Numbered list with dates and text previews, or `No brain memories stored yet.` when empty.

### `/forget-brain <id>`

Delete a brain memory item by its unique ID.

- **Auth required:** Yes
- **Arguments:** The memory item UUID (required)

```
/forget-brain 550e8400-e29b-41d4-a716-446655440000
```

Response: `Deleted brain memory: <id>` or `No memory found with id: <id>`.

## Tool: `brain_memory_search`

An AI-callable tool for searching personal brain memory items from the local JSONL store.

### Input schema

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | - | The search text |
| `limit` | number | no | 5 | Max results to return (1-20) |

### Example tool call

```json
{ "query": "Anthropic reset schedule", "limit": 5 }
```

### Response format

```json
{
  "hits": [
    {
      "score": 0.87,
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "createdAt": "2026-02-27T10:30:00.000Z",
      "tags": ["brain"],
      "text": "Remember: Anthropic resets usage limits on the 1st of each month."
    }
  ]
}
```

Returns `{ "hits": [] }` when no results match or the query is empty.

## Auto-capture behavior

The plugin hooks into the `message_received` event for automatic memory capture.

### Capture logic

A message is captured when **all** of these conditions are met:

1. The message content is not empty
2. Message length >= `minChars` (default 80)
3. At least one of:
   - Contains an **explicit trigger** phrase (e.g. "remember this:", "keep this")
   - `requireExplicit` is `false` AND the message contains an **auto-topic** keyword (e.g. "decision")

### Trigger matching

- Case-insensitive substring matching
- Default explicit triggers: `merke dir`, `merke dir:`, `remember this`, `remember this:`, `notiere`, `keep this`
- Default auto-topics: `entscheidung`, `decision`

### Convention

Brain-memory should **not** silently store large amounts of chat. The recommended default is `requireExplicit: true`.

If you want more aggressive capture, set `requireExplicit: false` in config (not recommended for OPSEC).

## Configuration

Full configuration reference via `openclaw.plugin.json`:

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
          "maxItems": 5000,
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

### Configuration options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable or disable the plugin entirely |
| `storePath` | string | `~/.openclaw/workspace/memory/brain-memory.jsonl` | JSONL file path (must be inside home directory) |
| `dims` | number | `256` | Embedding vector dimensions (32-2048) |
| `redactSecrets` | boolean | `true` | Redact detected secrets before storage |
| `maxItems` | number | `5000` | Maximum stored items before eviction (100-100000) |
| `defaultTags` | string[] | `["brain"]` | Default tags for all captured items |
| `capture.minChars` | number | `80` | Minimum message length for auto-capture (10+) |
| `capture.requireExplicit` | boolean | `true` | Require explicit trigger phrases for capture |
| `capture.explicitTriggers` | string[] | see config block | Trigger phrases for explicit capture |
| `capture.autoTopics` | string[] | `["entscheidung", "decision"]` | Topic keywords for auto-capture |

## Safety

- Secrets (API keys, tokens, passwords, private keys, JWTs, DB connection strings) are redacted before storage.
- Only rule names and match counts are stored - never the matched secret text.
- Store path is validated to stay inside the user's home directory.
- Local storage only - no external data transmission.

## Install

### ClawHub

```bash
clawhub install openclaw-memory-brain
```

### Local development

```bash
openclaw plugins install -l ~/.openclaw/workspace/openclaw-memory-brain
openclaw gateway restart
```
