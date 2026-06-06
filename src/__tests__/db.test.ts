import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import KnowledgeDb, { type KnowledgeEntry } from "../db.js";
import { unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

describe("KnowledgeDb", () => {
  let db: KnowledgeDb;
  const dbPath = "/tmp/knowledge-test.db";

  beforeEach(() => {
    db = KnowledgeDb.create(dbPath, { autoSeed: false });
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
    // auto-seeded db
    const seededDb = KnowledgeDb.create('/tmp/knowledge-test-seeded.db');
    const stats = seededDb.getStats();
    expect(stats.total_entries).toBe(15);
    seededDb.close();
    try { unlinkSync('/tmp/knowledge-test-seeded.db'); } catch {}
    try { unlinkSync('/tmp/knowledge-test-seeded.db-wal'); } catch {}
    try { unlinkSync('/tmp/knowledge-test-seeded.db-shm'); } catch {}
    // verify our clean db has 0
    expect(db.getStats().total_entries).toBe(0);
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

  // 13. addEntry with all 7 entity_types
  test("addEntry supports all 7 entity_types", () => {
    const entityTypes = ["problem", "pattern", "convention", "decision", "observation", "fix", "summary"];
    const tmpDir2 = mkdtempSync(join(tmpdir(), "knowledge-et-"));
    const tmpDb = KnowledgeDb.create(join(tmpDir2, "test.db"), { autoSeed: false });

    for (const et of entityTypes) {
      tmpDb.addEntry({
        entry_key: `et-${et}`,
        kind: "dev",
        title: `${et} entry`,
        description: "",
        root_cause: null,
        canonical_solution: null,
        entity_type: et,
        confidence: 0.5,
        review_state: "draft",
        superseded_by: null,
        tags: "",
      });
    }

    const stats = tmpDb.getStats();
    expect(stats.total_entries).toBe(7);
    expect(stats.by_entity_type["problem"]).toBe(1);
    expect(stats.by_entity_type["pattern"]).toBe(1);
    expect(stats.by_entity_type["convention"]).toBe(1);
    expect(stats.by_entity_type["decision"]).toBe(1);
    expect(stats.by_entity_type["observation"]).toBe(1);
    expect(stats.by_entity_type["fix"]).toBe(1);
    expect(stats.by_entity_type["summary"]).toBe(1);

    const fixResults = tmpDb.findEntries({ entity_type: "fix" });
    expect(fixResults.length).toBe(1);
    expect(fixResults[0].entity_type).toBe("fix");

    tmpDb.close();
    rmSync(tmpDir2, { recursive: true, force: true });
  });

  // 14. findEntries filters by entity_type
  test("findEntries filters by entity_type", () => {
    db.addEntry({ entry_key: "et-pattern", kind: "dev", title: "pattern entry", description: "", root_cause: null, canonical_solution: null, entity_type: "pattern", confidence: 0.5, review_state: "draft", superseded_by: null, tags: "" });
    db.addEntry({ entry_key: "et-fix", kind: "dev", title: "fix entry", description: "", root_cause: null, canonical_solution: null, entity_type: "fix", confidence: 0.5, review_state: "draft", superseded_by: null, tags: "" });
    db.addEntry({ entry_key: "et-convention", kind: "dev", title: "convention entry", description: "", root_cause: null, canonical_solution: null, entity_type: "convention", confidence: 0.5, review_state: "draft", superseded_by: null, tags: "" });

    const results = db.findEntries({ entity_type: "pattern" });
    expect(results.length).toBe(1);
    expect(results[0].entity_type).toBe("pattern");

    const all = db.findEntries({});
    expect(all.length).toBe(3);
  });

  // 15. findEntries entity_type filter returns empty for no match
  test("findEntries returns empty when entity_type has no entries", () => {
    db.addEntry({ entry_key: "only-problem", kind: "dev", title: "a problem", description: "", root_cause: null, canonical_solution: null, entity_type: "problem", confidence: 0.5, review_state: "draft", superseded_by: null, tags: "" });
    const results = db.findEntries({ entity_type: "fix" });
    expect(results.length).toBe(0);
  });

  // 16. Schema migration from old problems table
  test("schema migration from old problems table preserves data", () => {
    const migDir = mkdtempSync(join(tmpdir(), "knowledge-migration-"));
    const migPath = join(migDir, "legacy.db");

    const rawDb = new Database(migPath);
    rawDb.run("PRAGMA journal_mode = WAL");
    rawDb.run(`CREATE TABLE problems (
      problem_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      problem TEXT NOT NULL,
      root_cause TEXT,
      canonical_solution TEXT,
      confidence REAL NOT NULL DEFAULT 0.0,
      review_state TEXT NOT NULL DEFAULT 'draft',
      superseded_by TEXT,
      tags TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (problem_key, kind)
    )`);
    rawDb.run(`CREATE TABLE occurrences (
      id TEXT PRIMARY KEY,
      problem_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      project_ref TEXT,
      repo_ref TEXT,
      issue_ref TEXT,
      commit_ref TEXT,
      observed_symptoms TEXT,
      outcome TEXT,
      occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    rawDb.run(`CREATE TABLE revisions (
      id TEXT PRIMARY KEY,
      problem_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      confidence_at_time REAL,
      review_state_at_time TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    rawDb.run("INSERT INTO problems (problem_key, kind, problem, confidence, review_state) VALUES ('old-key', 'dev', 'Legacy problem title', 0.7, 'draft')");
    rawDb.close();

    const migratedDb = KnowledgeDb.create(migPath);
    const entry = migratedDb.getEntry("old-key", "dev");
    expect(entry).not.toBeNull();
    expect(entry!.entry_key).toBe("old-key");
    expect(entry!.title).toBe("Legacy problem title");
    expect(entry!.entity_type).toBe("problem");

    // Idempotency: second create() must not throw or duplicate
    migratedDb.close();
    const db2 = KnowledgeDb.create(migPath);
    const entry2 = db2.getEntry("old-key", "dev");
    expect(entry2).not.toBeNull();
    expect(db2.getStats().total_entries).toBe(1);
    db2.close();

    rmSync(migDir, { recursive: true, force: true });
  });

  // 17. auto_capture flow: stores fix entry with initial draft/0.0 values
  test("auto_capture flow: stores fix entry with draft state and zero confidence", () => {
    db.addEntry({
      entry_key: "bun-circular-import-hang",
      kind: "dev",
      title: "Bun test runner hangs on circular imports",
      description: "",
      root_cause: null,
      canonical_solution: null,
      entity_type: "fix",
      confidence: 0.0,
      review_state: "draft",
      superseded_by: null,
      tags: "",
    });
    const entry = db.getEntry("bun-circular-import-hang", "dev");
    expect(entry).not.toBeNull();
    expect(entry!.entity_type).toBe("fix");
    expect(entry!.confidence).toBe(0.0);
    expect(entry!.review_state).toBe("draft");
    expect(entry!.root_cause).toBeNull();
    expect(entry!.canonical_solution).toBeNull();
  });

  // 18. getStats by_entity_type counts accurately
  test("getStats by_entity_type counts accurately", () => {
    for (let i = 1; i <= 2; i++) {
      db.addEntry({ entry_key: `pattern-${i}`, kind: "dev", title: `pattern ${i}`, description: "", root_cause: null, canonical_solution: null, entity_type: "pattern", confidence: 0.5, review_state: "draft", superseded_by: null, tags: "" });
    }
    for (let i = 1; i <= 3; i++) {
      db.addEntry({ entry_key: `fix-${i}`, kind: "dev", title: `fix ${i}`, description: "", root_cause: null, canonical_solution: null, entity_type: "fix", confidence: 0.5, review_state: "draft", superseded_by: null, tags: "" });
    }
    db.addEntry({ entry_key: "prob-1", kind: "dev", title: "problem 1", description: "", root_cause: null, canonical_solution: null, entity_type: "problem", confidence: 0.5, review_state: "draft", superseded_by: null, tags: "" });

    const stats = db.getStats();
    expect(stats.by_entity_type["pattern"]).toBe(2);
    expect(stats.by_entity_type["fix"]).toBe(3);
    expect(stats.by_entity_type["problem"]).toBe(1);
    expect(stats.total_entries).toBe(6);
  });

  // 19. Backward compat: findEntries filters by free-text kind values
  test("findEntries filters by free-text kind (build, argocd)", () => {
    db.addEntry({ entry_key: "build-issue-1", kind: "build", title: "build issue", description: "", root_cause: null, canonical_solution: null, entity_type: "problem", confidence: 0.5, review_state: "draft", superseded_by: null, tags: "" });
    db.addEntry({ entry_key: "argocd-issue-1", kind: "argocd", title: "argocd issue", description: "", root_cause: null, canonical_solution: null, entity_type: "problem", confidence: 0.5, review_state: "draft", superseded_by: null, tags: "" });

    const buildResults = db.findEntries({ kind: "build" });
    expect(buildResults.length).toBe(1);
    expect(buildResults[0].kind).toBe("build");

    const argocdResults = db.findEntries({ kind: "argocd" });
    expect(argocdResults.length).toBe(1);
    expect(argocdResults[0].kind).toBe("argocd");
  });
});
