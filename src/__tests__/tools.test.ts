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
    db = KnowledgeDb.create(dbPath);
  });

  afterEach(() => {
    if (db) db.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // 1. kb_find_problem with FTS5 query
  test("findProblems returns ranked FTS5 results", () => {
    db.addProblem({
      problem_key: "search-test",
      kind: "dev",
      problem: "SQLite connection timeout",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.8,
      review_state: "accepted",
      superseded_by: null,
      tags: "database,sqlite",
    });
    const results = db.findProblems({ query: "sqlite connection", limit: 5 });
    expect(results.length).toBe(1);
    expect(results[0].problem_key).toBe("search-test");
  });

  // 2. kb_find_problem returns empty for no matches
  test("findProblems returns empty for no matches", () => {
    db.addProblem({
      problem_key: "only-entry",
      kind: "dev",
      problem: "something",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    const results = db.findProblems({ query: "nonexistent GIJIOGJSIOG", limit: 5 });
    expect(results.length).toBe(0);
  });

  // 3. kb_find_solution returns problem + occurrences
  test("getProblem returns full entry with occurrences", () => {
    db.addProblem({
      problem_key: "full-entry",
      kind: "dev",
      problem: "A full problem description",
      root_cause: "Missing config",
      canonical_solution: "Add config validation",
      confidence: 0.9,
      review_state: "accepted",
      superseded_by: null,
      tags: "config",
    });
    db.addOccurrence({
      problem_key: "full-entry",
      kind: "dev",
      outcome: "fixed",
      observed_symptoms: null,
      project_ref: null,
      repo_ref: null,
      issue_ref: null,
      commit_ref: null,
    });
    const entry = db.getProblem("full-entry", "dev");
    expect(entry).not.toBeNull();
    expect(entry!.canonical_solution).toBe("Add config validation");
    const occs = db.getOccurrences("full-entry", "dev");
    expect(occs.length).toBe(1);
    expect(occs[0].outcome).toBe("fixed");
  });

  // 4. kb_record_occurrence validates outcome
  test("addOccurrence records failed attempts", () => {
    db.addProblem({
      problem_key: "fail-record",
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
      problem_key: "fail-record",
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
  test("addProblem creates draft entry with default confidence", () => {
    db.addProblem({
      problem_key: "new-draft",
      kind: "devops",
      problem: "Docker build cache miss",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.0,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    const entry = db.getProblem("new-draft", "devops");
    expect(entry!.review_state).toBe("draft");
    expect(entry!.confidence).toBe(0.0);
  });

  // 6. kb_review_entry promotes from draft to accepted
  test("updateProblem can promote review state", () => {
    db.addProblem({
      problem_key: "promote-me",
      kind: "testing",
      problem: "test",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.5,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    db.updateProblem("promote-me", "testing", { review_state: "accepted", confidence: 0.9 });
    const entry = db.getProblem("promote-me", "testing");
    expect(entry!.review_state).toBe("accepted");
    expect(entry!.confidence).toBe(0.9);
  });

  // 7. Terminal state: rejected cannot be changed
  test("updateProblem blocks changes on rejected entries", () => {
    db.addProblem({
      problem_key: "rejected-forever",
      kind: "dev",
      problem: "bad idea",
      root_cause: null,
      canonical_solution: null,
      confidence: 0.1,
      review_state: "rejected",
      superseded_by: null,
      tags: "",
    });
    expect(() => {
      db.updateProblem("rejected-forever", "dev", { review_state: "accepted" });
    }).toThrow("REVIEW_GATE");
  });
});
