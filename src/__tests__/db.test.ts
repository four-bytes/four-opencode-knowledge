import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import KnowledgeDb, { type ProblemEntry } from "../db.js";
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
    expect(stats.total_problems).toBe(0);
  });

  // 2. addProblem - insert new entry
  test("addProblem inserts a new entry", () => {
    db.addProblem({
      problem_key: "config-not-loading",
      kind: "dev",
      problem: "Plugin config file is not loaded at startup",
      root_cause: "Hook order dependency",
      canonical_solution: "Use lazy-loading pattern for config",
      confidence: 0.85,
      review_state: "accepted",
      superseded_by: null,
      tags: "plugin,config,startup",
    });
    const entry = db.getProblem("config-not-loading", "dev");
    expect(entry).not.toBeNull();
    expect(entry!.problem).toBe("Plugin config file is not loaded at startup");
    expect(entry!.confidence).toBe(0.85);
    expect(entry!.review_state).toBe("accepted");
  });

  // 3. addProblem - confidence gate blocks lower confidence
  test("addProblem blocks lower confidence update", () => {
    db.addProblem({
      problem_key: "gate-test",
      kind: "dev",
      problem: "original",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.9,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    expect(() => {
      db.addProblem({
        problem_key: "gate-test",
        kind: "dev",
        problem: "weaker attempt",
        root_cause: null,
        canonical_solution: null,
        confidence: 0.5,
        review_state: "draft",
        superseded_by: null,
        tags: "",
      });
    }).toThrow("CONFIDENCE_GATE");
  });

  // 4. addProblem - higher confidence overwrites
  test("addProblem allows higher confidence update", () => {
    db.addProblem({
      problem_key: "upgrade-test",
      kind: "dev",
      problem: "old solution",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.6,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.addProblem({
      problem_key: "upgrade-test",
      kind: "dev",
      problem: "better solution",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.9,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    const entry = db.getProblem("upgrade-test", "dev");
    expect(entry!.problem).toBe("better solution");
    expect(entry!.confidence).toBe(0.9);
  });

  // 5. FTS5 search
  test("findProblems returns FTS5 matches", () => {
    db.addProblem({
      problem_key: "fts1",
      kind: "dev",
      problem: "TypeScript compilation fails with strict mode",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.8,
      review_state: "accepted",
      superseded_by: null,
      tags: "typescript,compiler",
    });
    db.addProblem({
      problem_key: "fts2",
      kind: "devops",
      problem: "Docker build fails on CI",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.7,
      review_state: "draft",
      superseded_by: null,
      tags: "docker,ci",
    });
    const results = db.findProblems({ query: "typescript compilation", limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].problem_key).toBe("fts1");
  });

  // 6. findProblems with kind filter
  test("findProblems filters by kind", () => {
    db.addProblem({
      problem_key: "kind-dev",
      kind: "dev",
      problem: "dev problem",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.addProblem({
      problem_key: "kind-devops",
      kind: "devops",
      problem: "devops problem",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    const results = db.findProblems({ kind: "devops", limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("devops");
  });

  // 7. findProblems with confidence_min filter
  test("findProblems filters by confidence_min", () => {
    db.addProblem({
      problem_key: "low-conf",
      kind: "dev",
      problem: "low confidence",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.3,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.addProblem({
      problem_key: "high-conf",
      kind: "dev",
      problem: "high confidence",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.9,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    const results = db.findProblems({ confidence_min: 0.8, limit: 10 });
    expect(results.length).toBe(1);
    expect(results[0].problem_key).toBe("high-conf");
  });

  // 8. Occurrence tracking
  test("addOccurrence and getOccurrences work", () => {
    db.addProblem({
      problem_key: "occ-test",
      kind: "dev",
      problem: "test",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.addOccurrence({
      problem_key: "occ-test",
      kind: "dev",
      outcome: "failed",
      observed_symptoms: "still crashes",
      project_ref: "test-project",
      repo_ref: null,
      issue_ref: null,
      commit_ref: null,
    });
    db.addOccurrence({
      problem_key: "occ-test",
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
    db.addProblem({
      problem_key: "rev-test",
      kind: "dev",
      problem: "v1",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.updateProblem("rev-test", "dev", { problem: "v2", confidence: 0.7 });
    const revs = db.getRevisionHistory("rev-test", "dev");
    expect(revs.length).toBeGreaterThan(0);
    const problemRev = revs.find((r) => r.field_name === "problem");
    expect(problemRev).toBeDefined();
    expect(problemRev!.old_value).toBe("v1");
    expect(problemRev!.new_value).toBe("v2");
  });

  // 10. getStats
  test("getStats returns correct counts", () => {
    db.addProblem({
      problem_key: "stats1",
      kind: "dev",
      problem: "a",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.8,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    db.addProblem({
      problem_key: "stats2",
      kind: "devops",
      problem: "b",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.4,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.addProblem({
      problem_key: "stats3",
      kind: "testing",
      problem: "c",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.6,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    const stats = db.getStats();
    expect(stats.total_problems).toBe(3);
    expect(stats.accepted_count).toBe(1);
    expect(stats.draft_count).toBe(2);
    expect(stats.avg_confidence).toBeCloseTo((0.8 + 0.4 + 0.6) / 3);
  });

  // 11. supersede marks entry as superseded
  test("supersede marks entry with superseded status", () => {
    db.addProblem({
      problem_key: "old-solution",
      kind: "dev",
      problem: "old way",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.8,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    db.supersede("old-solution", "dev", "new-solution");
    const entry = db.getProblem("old-solution", "dev");
    expect(entry!.review_state).toBe("superseded");
    expect(entry!.superseded_by).toBe("new-solution");
  });

  // 12. Review-state gate: cannot regress
  test("updateProblem blocks review state regression", () => {
    db.addProblem({
      problem_key: "review-gate",
      kind: "dev",
      problem: "test",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.8,
      review_state: "accepted",
      superseded_by: null,
      tags: "",
    });
    expect(() => {
      db.updateProblem("review-gate", "dev", { review_state: "draft" });
    }).toThrow("REVIEW_GATE");
  });
});
