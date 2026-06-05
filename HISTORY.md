# Changelog

## 0.2.0 — 2026-06-05
- Schema migration: problems→entries with 7 entity_types
- Tool renames: kb_find_problem→kb_search, kb_find_solution→kb_get (aliases kept)
- New tools: kb_auto_capture, kb_stats
- System prompt with auto-capture triggers
- Seed: 15 initial knowledge entries
- Docs: README + usage.md + HISTORY.md

## 0.1.0 — 2026-06-03
- Initial release: SQLite+FTS5 problem-solution store
- 5 MCP tools: kb_find_problem, kb_find_solution, kb_add_entry, kb_record_occurrence, kb_review_entry
- Confidence gating and review-state flow
