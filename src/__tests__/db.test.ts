import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import KnowledgeDb, { type KnowledgeEntry } from "../db.js";
import { unlinkSync } from "node:fs";

describe("KnowledgeDb", () => {
  let db: KnowledgeDb;
  const dbPath = "/tmp/knowledge-test.db";

  beforeEach(() => {
    db = KnowledgeDb.create(dbPath);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
    // Also clean up WAL/SHM files
    try { unlinkSync(dbPath + "-wal"); } catch {}
    try { unlinkSync(dbPath + "-shm"); } catch {}
  });

  // 1. Schema creation
  test("creates all tables on init", () => {
    const stats = db.getStats();
    expect(stats.total_entries).toBe(0);
  });

  // 2. addEntry - insert new entry
  test("addEntry inserts a new entry", () => {
    db.addEntry({
      entry_key: "config-not-loading",
      kind: "dev",
      title: "Plugin config file is not loaded at startup",
      description: "",
      root_cause: "Hook order dependency",
      canonical_solution: "Use lazy-loading pattern for config",
      entity_type: "problem",
      confidence: 0.85,
      review_state: "accepted",
      superseded_by: null,
      tags: "plugin,config,startup",
    });
    const entry = db.getEntry("config-not-loading", "dev");
    expect(entry).not.toBeNull();
    expect(entry!.title).toBe("Plugin config file is not loaded at startup");
    expect(entry!.confidence).toBe(0.85);
    expect(entry!.review_state).toBe("accepted");
  });

  // 3. addEntry - confidence gate blocks lower confidence
  test("addEntry blocks lower confidence update", () => {
    db.addEntry({
      entry_key: "gate-test",
      kind: "dev",
      title: "original",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.9,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    expect(() => {
      db.addEntry({
        entry_key: "gate-test",
        kind: "dev",
        title: "weaker attempt",
        description: "",
        root_cause: null,
        canonical_solution: null,
        entity_type: "problem",
        confidence: 0.5,
        review_state: "draft",
        superseded_by: null,
        tags: "",
      });
    }).toThrow("CONFIDENCE_GATE");
  });

  // 4. addEntry - higher confidence overwrites
  test("addEntry allows higher confidence update", () => {
    db.addEntry({
      entry_key: "upgrade-test",
      kind: "dev",
      title: "old solution",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.6,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.addEntry({
      entry_key: "upgrade-test",
      kind: "dev",
      title: "better solution",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.9,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    const entry = db.getEntry("upgrade-test", "dev");
    expect(entry!.title).toBe("better solution");
    expect(entry!.confidence).toBe(0.9);
  });

  // 5. FTS5 search
  test("findEntries returns FTS5 matches", () => {
    db.addEntry({
      entry_key: "fts1",
      kind: "dev",
      title: "TypeScript compilation fails with strict mode",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.8,
      review_state: "accepted",
      superseded_by: null,
      tags: "typescript,compiler",
    });
    db.addEntry({
      entry_key: "fts2",
      kind: "devops",
      title: "Docker build fails on CI",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.7,
      review_state: "draft",
      superseded_by: null,
      tags: "docker,ci",
    });
    const results = db.findEntries({ query: "typescript compilation", limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry_key).toBe("fts1");
  });

  // 6. findEntries with kind filter
  test("findEntries filters by kind", () => {
    db.addEntry({
      entry_key: "kind-dev",
      kind: "dev",
      title: "dev problem",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.addEntry({
      entry_key: "kind-devops",
      kind: "devops",
      title: "devops problem",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    const results = db.findEntries({ kind: "devops", limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("devops");
  });

  // 7. findEntries with confidence_min filter
  test("findEntries filters by confidence_min", () => {
    db.addEntry({
      entry_key: "low-conf",
      kind: "dev",
      title: "low confidence",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.3,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.addEntry({
      entry_key: "high-conf",
      kind: "dev",
      title: "high confidence",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.9,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    const results = db.findEntries({ confidence_min: 0.8, limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].entry_key).toBe("high-conf");
  });

  // 8. Occurrence tracking
  test("addOccurrence and getOccurrences work", () => {
    db.addEntry({
      entry_key: "occ-test",
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
      entry_key: "occ-test",
      kind: "dev",
      outcome: "failed",
      observed_symptoms: "still crashes",
      project_ref: "test-project",
      repo_ref: null,
      issue_ref: null,
      commit_ref: null,
    });
    db.addOccurrence({
      entry_key: "occ-test",
      kind: "dev",
      outcome: "fixed",
      observed_symptoms: null,
      project_ref: null,
      repo_ref: null,
      issue_ref: null,
      commit_ref: null,
    });
    const occs = db.getOccurrences("occ-test", "dev");
    expect(occs.length).toBe(2);
    const outcomes = occs.map((o) => o.outcome).sort();
    expect(outcomes).toEqual(["failed", "fixed"]);
  });

  // 9. Revision history
  test("revisions are recorded on update", () => {
    db.addEntry({
      entry_key: "rev-test",
      kind: "dev",
      title: "v1",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.updateEntry("rev-test", "dev", { title: "v2", confidence: 0.7 });
    const revs = db.getRevisionHistory("rev-test", "dev");
    expect(revs.length).toBeGreaterThan(0);
    const titleRev = revs.find((r) => r.field_name === "title");
    expect(titleRev).toBeDefined();
    expect(titleRev!.old_value).toBe("v1");
    expect(titleRev!.new_value).toBe("v2");
  });

  // 10. getStats
  test("getStats returns correct counts", () => {
    db.addEntry({
      entry_key: "stats1",
      kind: "dev",
      title: "a",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.8,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    db.addEntry({
      entry_key: "stats2",
      kind: "devops",
      title: "b",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.4,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.addEntry({
      entry_key: "stats3",
      kind: "testing",
      title: "c",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.6,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    const stats = db.getStats();
    expect(stats.total_entries).toBe(3);
    expect(stats.accepted_count).toBe(1);
    expect(stats.draft_count).toBe(2);
    expect(stats.avg_confidence).toBeCloseTo((0.8 + 0.4 + 0.6) / 3);
    expect(stats.by_entity_type["problem"]).toBe(3);
  });

  // 11. supersedeEntry marks entry as superseded
  test("supersedeEntry marks entry with superseded status", () => {
    db.addEntry({
      entry_key: "old-solution",
      kind: "dev",
      title: "old way",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.8,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    db.supersedeEntry("old-solution", "dev", "new-solution");
    const entry = db.getEntry("old-solution", "dev");
    expect(entry!.review_state).toBe("superseded");
    expect(entry!.superseded_by).toBe("new-solution");
  });

  // 12. Review-state gate: cannot regress
  test("updateEntry blocks review state regression", () => {
    db.addEntry({
      entry_key: "review-gate",
      kind: "dev",
      title: "test",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "problem",
      confidence: 0.8,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    expect(() => {
      db.updateEntry("review-gate", "dev", { review_state: "draft" });
    }).toThrow("REVIEW_GATE");
  });
});
