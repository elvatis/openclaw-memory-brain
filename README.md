# openclaw-memory-brain

OpenClaw plugin: **Personal Brain Memory** (v0.1.2).

A lightweight OpenClaw Gateway plugin that acts as a personal brain:
- Listens for inbound messages and captures likely-valuable notes based on configurable triggers.
- Stores everything locally in a JSONL file with optional secret redaction.
- Supports semantic-ish search via hash-based embeddings.
- Provides slash commands for manual CRUD operations.
- Enforces a configurable item cap (`maxItems`) with oldest-first eviction.

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

## Commands

### `/remember-brain <text>`

Explicitly save a personal brain memory item.

```
/remember-brain TypeScript 5.5 requires explicit return types on exported functions
```

Returns a confirmation message. If `redactSecrets` is enabled (default), any detected secrets are automatically redacted before storage and the response notes it.

### `/search-brain <query> [limit]`

Search brain memory items by semantic similarity.

```
/search-brain TypeScript configuration
/search-brain architecture decisions 10
```

- `query` - the search text (required)
- `limit` - maximum number of results (optional, default 5, max 20)

The trailing argument is interpreted as a limit if it is a bare number and more than one argument is present. A sole numeric argument is treated as the query itself. Returns scored results sorted by relevance.

### `/list-brain [limit]`

List the most recent brain memory items.

```
/list-brain
/list-brain 20
```

- `limit` - maximum number of items to return (optional, default 10, max 50)

Returns items in insertion order (oldest first), showing date and a truncated preview.

### `/forget-brain <id>`

Delete a brain memory item by its unique ID. Requires authentication.

```
/forget-brain 550e8400-e29b-41d4-a716-446655440000
```

Returns a confirmation or a not-found message.

## Tool: `brain_memory_search`

An AI-callable tool for searching brain memories programmatically.

### Input schema

```json
{
  "query": "string (required) - the search text",
  "limit": "number (optional, 1-20, default 5)"
}
```

### Example call

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

Returns an empty `hits` array when no results match.

## Auto-capture (message_received hook)

The plugin listens on the `message_received` event and conditionally captures inbound messages as memory items.

### Capture rules (defaults)

A message is captured when **all** of the following are true:

1. Message content is not empty
2. Message length >= `minChars` (default: 80 characters)
3. At least one of:
   - The message contains an **explicit trigger** (e.g. "remember this", "keep this")
   - `requireExplicit` is `false` AND the message contains an **auto-topic** keyword (e.g. "decision")

Convention: brain-memory should **not** silently store large amounts of chat. The recommended default is `requireExplicit: true`.

### Trigger matching

- Case-insensitive substring matching (e.g. "merke dir" also matches "Merke dir:" naturally)
- Default explicit triggers: `merke dir`, `remember this`, `notiere`, `keep this`
- Default auto-topics: `entscheidung`, `decision`

## Configuration

All configuration is provided via `openclaw.plugin.json` or the plugin config block.

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

### Configuration options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable or disable the plugin entirely |
| `storePath` | string | `~/.openclaw/workspace/memory/brain-memory.jsonl` | Path to the JSONL storage file (must be inside home directory) |
| `dims` | number | `256` | Embedding vector dimensions (32-2048) |
| `redactSecrets` | boolean | `true` | Redact detected secrets (API keys, tokens, passwords) before storage |
| `maxItems` | number | `5000` | Maximum number of memory items to keep (oldest are evicted, 100-100000) |
| `defaultTags` | string[] | `["brain"]` | Default tags applied to all captured items |
| `capture.minChars` | number | `80` | Minimum message length for auto-capture (10+) |
| `capture.requireExplicit` | boolean | `true` | When true, only explicit triggers cause capture (recommended) |
| `capture.explicitTriggers` | string[] | see above | Phrases that trigger explicit capture (substring match, case-insensitive) |
| `capture.autoTopics` | string[] | `["entscheidung", "decision"]` | Topic keywords that trigger capture when `requireExplicit` is false |

## Safety

- The plugin redacts common secrets (API keys, tokens, passwords, private key blocks, JWTs, connection strings) before storage.
- Redaction uses pattern-based detection and never stores matched secret values - only the rule name and count.
- The store path is validated to stay inside the user's home directory (path traversal guard).
- PII is only stored locally on disk in the JSONL file - no external transmission.

## Development

```bash
npm install
npm run build       # TypeScript type-check (noEmit, strict mode)
npm test            # Run vitest test suite (58 tests)
npm run test:watch  # Watch mode
```

### Test coverage

The test suite covers all plugin functionality:

- Plugin registration (commands, tool, event handler, disabled state, invalid config)
- `/remember-brain` (save, usage, empty args, secret redaction, source context)
- `/search-brain` (query, usage, no-match, trailing limit, sole numeric arg)
- `/list-brain` (empty store, populated listing, limit argument, default limit)
- `/forget-brain` (usage, not-found, delete + verify, requireAuth)
- `brain_memory_search` tool (result shape, empty/undefined query, limit, schema)
- Auto-capture (explicit trigger, auto-topic, short message rejection, no-trigger rejection, requireExplicit enforcement, empty content, case-insensitivity, secret redaction, error handling, custom minChars, custom triggers)
- Custom configuration (defaultTags, custom autoTopics, redactSecrets toggle)
- Output formatting (text truncation at 120 chars, ellipsis behavior)
- Edge cases (sole numeric arg, whitespace-only arg, limit clamping, multiple captures)
- Logger verification (startup info, capture info, error on invalid path)
- Command metadata (name, description, usage, requireAuth, acceptsArgs)

### Dependencies

- **Runtime**: `@elvatis_com/openclaw-memory-core` (local linked package)
- **Dev**: `typescript`, `vitest`, `@types/node`

## License

MIT
