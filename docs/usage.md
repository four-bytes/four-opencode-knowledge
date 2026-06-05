# Knowledge Plugin — Usage Guide

## Overview
General-purpose knowledge base for OpenCode agents. Captures problems, patterns, conventions, decisions, observations, fixes, and summaries from daily work.

## Entity Types
| Type | Description | Example |
|------|-------------|---------|
| problem | Recurring issue with root cause + solution | argocd-ksops-outofsync |
| pattern | Reusable pattern discovered in code/infra | dist-missing-after-clone |
| convention | Naming, structural, or process rule | source-file-naming |
| decision | Architectural or design decision | use-bun-instead-of-node |
| observation | Non-obvious behavior worth remembering | local-plugin-pickup-delay |
| fix | Specific fix applied to a bug | reloader-arm-arch-tag |
| summary | Key takeaways from a completed task | refactored-auth-module |

## Tools

### kb_search
Universal search across all entity types. Filters: entity_type, kind, confidence_min, review_state.
```
kb_search "argocd out of sync" entity_type:problem
```

### kb_get
Get full entry + occurrence history + revisions.
```
kb_get "argocd-ksops-outofsync" kind:"argocd"
```

### kb_auto_capture
Quick-add after completing work. Simplified — no root_cause needed.
```
kb_auto_capture entity_type:"fix" title:"fixed timeout bug" description:"Changed hardcoded 120s to configurable 300s" tags:"timeout,config"
```

### kb_add_entry
Full knowledge entry with root_cause and canonical_solution.
```
kb_add_entry entry_key:"my-problem" kind:"dev" title:"My Problem" description:"..." root_cause:"..." canonical_solution:"..." entity_type:"problem"
```

### kb_record_occurrence
Record outcome of a fix attempt.
```
kb_record_occurrence problem_key:"my-problem" kind:"dev" outcome:"fixed" commit_ref:"abc123"
```

### kb_review_entry
Promote or reject entries.
```
kb_review_entry problem_key:"my-problem" kind:"dev" review_state:"accepted" confidence:0.8
```

### kb_stats
Store overview.
```
kb_stats
```

## Auto-Capture Triggers
Agents automatically call kb_auto_capture after:
1. Fixing a bug → entity_type='fix'
2. Making an architectural decision → entity_type='decision'
3. Discovering a reusable pattern → entity_type='pattern'
4. Completing a significant task (>5 tool calls) → entity_type='summary'
5. Observing non-obvious behavior → entity_type='observation'

## Confidence & Review Flow
- All new entries start as draft (confidence=0.0)
- Promote after verification: draft→reviewed→accepted
- Trusted solutions: accepted + confidence>=0.7
- Confidence gate: higher-confidence entries override lower ones
- Bad attempts (outcome='failed') are auto-tracked to prevent repetition

## Seed Data
Run `bun run scripts/seed-initial.ts` to bootstrap with 15 initial entries.
