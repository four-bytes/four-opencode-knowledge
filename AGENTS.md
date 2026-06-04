# knowledge — AGENTS.md

Pointer auf zentrale Standards: `~/.personal-config/ai-shared/AGENTS.md` und Meta-Repo `four-bytes/opencode-plugins` AGENTS.md.

## Convention
- Source-Datei: `src/four-opencode-knowledge.ts` (NICHT `src/index.ts`)
- npm-Name: `@four-bytes/four-opencode-knowledge`
- License: Apache-2.0
- ESM, Bun-targeted, strict TypeScript

## Build-Disziplin (PFLICHT)
- JEDER Code-Change endet mit: Version-Bump in `package.json` + `bun run build`
- Kein Merge ohne aktuellen `dist/`
- `dist/` ist gitignored, wird bei `npm publish` frisch gebaut

## Standards
`~/.personal-config/ai-shared/AGENTS.md`

## Dieser Plugin
- Plugin-Name: knowledge
- Beschreibung: Structured Problem-Solution Knowledge Store with SQLite+FTS5 and Confidence-Gating for OpenCode agents
- Status: Sprint X

## Workflow
Issues → Branch → PR → Merge (Feature-Workflow)
