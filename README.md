# four-opencode-knowledge — General-Purpose Knowledge Base

SQLite+FTS5 knowledge base with confidence-gating for OpenCode agents. Captures **7 entity types**: problems, patterns, conventions, decisions, observations, fixes, and summaries. Agents auto-capture knowledge after completing work; entries are promoted through a draft→reviewed→accepted flow with configurable confidence thresholds.

## Installation

```bash
bun install @four-bytes/four-opencode-knowledge
```

## Configuration

```typescript
// opencode.config.ts
export default {
  plugins: [
    require("@four-bytes/four-opencode-knowledge"),
  ],
};
```

## Quick Start

Seed the store with 15 initial entries:

```bash
bun run scripts/seed-initial.ts
```

## Tools

| Tool | Purpose |
|------|---------|
| `kb_search` | Universal search across all entity types |
| `kb_get` | Full entry + occurrence history + revisions |
| `kb_auto_capture` | Quick-add after completing work |
| `kb_add_entry` | Full entry with root_cause and canonical_solution |
| `kb_record_occurrence` | Record outcome of a fix attempt |
| `kb_review_entry` | Promote or reject entries |
| `kb_stats` | Store overview |

See [docs/usage.md](docs/usage.md) for full tool reference and auto-capture triggers.

## License

Apache-2.0 — see [LICENSE](../LICENSE)
