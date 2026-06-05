import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import KnowledgeDb from "../db.js";

describe("Knowledge Plugin Tools (via DB)", () => {
  let db: KnowledgeDb;
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "knowledge-tools-"));
    const dbPath = join(tmpDir, "test.db");
    db = KnowledgeDb.create(dbPath, { autoSeed: false });
  });

  afterEach(() => {
    if (db) db.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // 1. kb_find_problem with FTS5 query
  test("findEntries returns ranked FTS5 results", () => {
    db.addEntry({
      entry_key: "search-test",
      kind: "dev",
      title: "SQLite connection timeout",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.8,
      review_state: "accepted",
      superseded_by: null,
      tags: "database,sqlite",
    });
    const results = db.findEntries({ query: "sqlite connection", limit: 5 });
    expect(results.length).toBe(1);
    expect(results[0].entry_key).toBe("search-test");
  });

  // 2. kb_find_problem returns empty for no matches
  test("findEntries returns empty for no matches", () => {
    db.addEntry({
      entry_key: "only-entry",
      kind: "dev",
      title: "something",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    const results = db.findEntries({ query: "nonexistent GIJIOGJSIOG", limit: 5 });
    expect(results.length).toBe(0);
  });

  // 3. kb_find_solution returns entry + occurrences
  test("getEntry returns full entry with occurrences", () => {
    db.addEntry({
      entry_key: "full-entry",
      kind: "dev",
      title: "A full problem description",
      description: "",
      root_cause: "Missing config",
      canonical_solution: "Add config validation",
      entity_type: "problem",
      confidence: 0.9,
      review_state: "accepted",
      superseded_by: null,
      tags: "config",
    });
    db.addOccurrence({
      entry_key: "full-entry",
      kind: "dev",
      outcome: "fixed",
      observed_symptoms: null,
      project_ref: null,
      repo_ref: null,
      issue_ref: null,
      commit_ref: null,
    });
    const entry = db.getEntry("full-entry", "dev");
    expect(entry).not.toBeNull();
    expect(entry!.canonical_solution).toBe("Add config validation");
    const occs = db.getOccurrences("full-entry", "dev");
    expect(occs.length).toBe(1);
    expect(occs[0].outcome).toBe("fixed");
  });

  // 4. kb_record_occurrence validates outcome
  test("addOccurrence records failed attempts", () => {
    db.addEntry({
      entry_key: "fail-record",
      kind: "dev",
      title: "test",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.addOccurrence({
      entry_key: "fail-record",
      kind: "dev",
      outcome: "failed",
      observed_symptoms: "error persisted after patch",
      project_ref: "my-project",
      repo_ref: null,
      issue_ref: null,
      commit_ref: null,
    });
    const occs = db.getOccurrences("fail-record", "dev");
    expect(occs.length).toBe(1);
    expect(occs[0].outcome).toBe("failed");
    expect(occs[0].project_ref).toBe("my-project");
  });

  // 5. kb_add_entry creates draft by default
  test("addEntry creates draft entry with default confidence", () => {
    db.addEntry({
      entry_key: "new-draft",
      kind: "devops",
      title: "Docker build cache miss",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.0,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    const entry = db.getEntry("new-draft", "devops");
    expect(entry!.review_state).toBe("draft");
    expect(entry!.confidence).toBe(0.0);
  });

  // 6. kb_review_entry promotes from draft to accepted
  test("updateEntry can promote review state", () => {
    db.addEntry({
      entry_key: "promote-me",
      kind: "testing",
      title: "test",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.updateEntry("promote-me", "testing", { review_state: "accepted", confidence: 0.9 });
    const entry = db.getEntry("promote-me", "testing");
    expect(entry!.review_state).toBe("accepted");
    expect(entry!.confidence).toBe(0.9);
  });

  // 7. Terminal state: rejected cannot be changed
  test("updateEntry blocks changes on rejected entries", () => {
    db.addEntry({
      entry_key: "rejected-forever",
      kind: "dev",
      title: "bad idea",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.1,
      review_state: "rejected",
      superseded_by: null,
      tags: "",
    });
    expect(() => {
      db.updateEntry("rejected-forever", "dev", { review_state: "accepted" });
    }).toThrow("REVIEW_GATE");
  });

  // 8. kb_auto_capture equivalent: entry_key derived from title slug, stored as fix
  test("kb_auto_capture equivalent: stores entry with derived key and fix entity_type", () => {
    const title = "SQLite WAL mode causes test isolation issues";
    const entry_key = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    db.addEntry({
      entry_key,
      kind: "dev",
      title,
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "fix",
      confidence: 0.0,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });

    const entry = db.getEntry(entry_key, "dev");
    expect(entry).not.toBeNull();
    expect(entry!.title).toBe(title);
    expect(entry!.entity_type).toBe("fix");
    expect(entry!.confidence).toBe(0.0);
    expect(entry!.review_state).toBe("draft");
  });

  // 9. kb_stats equivalent: getStats returns correct by_entity_type breakdown
  test("kb_stats equivalent: getStats returns correct by_entity_type breakdown", () => {
    const entries = [
      { entry_key: "s-pattern-1", entity_type: "pattern" },
      { entry_key: "s-pattern-2", entity_type: "pattern" },
      { entry_key: "s-fix-1", entity_type: "fix" },
    ];

    for (const e of entries) {
      db.addEntry({
        entry_key: e.entry_key,
        kind: "dev",
        title: `${e.entity_type} entry`,
        description: "",
        root_cause: null,
        canonical_solution: null,
        entity_type: e.entity_type,
        confidence: 0.5,
        review_state: "draft",
        superseded_by: null,
        tags: "",
      });
    }

    const stats = db.getStats();
    expect(stats.by_entity_type["pattern"]).toBe(2);
    expect(stats.by_entity_type["fix"]).toBe(1);
    expect(stats.total_entries).toBe(3);
  });
});
