# knowledge — AGENTS.md

Pointer to central standards: `~/.personal-config/ai-shared/AGENTS.md` and Meta-Repo `four-bytes/opencode-plugins` AGENTS.md.

## Convention
- Source file: `src/four-opencode-knowledge.ts` (NOT `src/index.ts`)
- npm name: `@four-bytes/four-opencode-knowledge`
- License: Apache-2.0
- ESM, Bun-targeted, strict TypeScript

## Build Discipline (MANDATORY)
- EVERY code change ends with: version bump in `package.json` + `bun run build`
- No merge without current `dist/`
- `dist/` is gitignored, rebuilt fresh during `npm publish`

## Standards
`~/.personal-config/ai-shared/AGENTS.md`

## This Plugin
- Plugin name: knowledge
- Description: Structured Problem-Solution Knowledge Store with SQLite+FTS5 and Confidence-Gating for OpenCode agents
- Status: Sprint X

## Workflow
Issues → Branch → PR → Merge (Feature Workflow)
