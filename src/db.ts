import { Database, type Statement } from "bun:sqlite";

// ---------------------------------------------------------------------------
// UUID7 helper (timestamp-sortable)
// ---------------------------------------------------------------------------
function uuid7(): string {
  const timestamp = Date.now();
  const random = crypto.getRandomValues(new Uint8Array(10));
  const ts_ms = BigInt(timestamp);
  const ts_hex = ts_ms.toString(16).padStart(12, "0");
  const rand_hex = Array.from(random).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${ts_hex.slice(0, 8)}-${ts_hex.slice(8, 12)}-7${rand_hex.slice(0, 3)}-${(0x80 | (parseInt(rand_hex[3], 16) & 0x3f)).toString(16)}${rand_hex.slice(5, 8)}-${rand_hex.slice(8)}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ProblemEntry {
  problem_key: string;
  kind: "dev" | "devops" | "planning" | "testing" | "architecture" | "release";
  problem: string;
  root_cause: string | null;
  canonical_solution: string | null;
  confidence: number;
  review_state: "draft" | "reviewed" | "accepted" | "rejected" | "superseded";
  superseded_by: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

interface OccurrenceEntry {
  id: string;
  problem_key: string;
  kind: string;
  project_ref: string | null;
  repo_ref: string | null;
  issue_ref: string | null;
  commit_ref: string | null;
  observed_symptoms: string | null;
  outcome: "fixed" | "failed" | "workaround" | "observed" | null;
  occurred_at: string;
}

interface RevisionEntry {
  id: string;
  problem_key: string;
  kind: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  confidence_at_time: number | null;
  review_state_at_time: string | null;
  created_at: string;
}

interface FindProblemsFilter {
  query?: string;
  kind?: string;
  confidence_min?: number;
  review_state?: string;
  limit?: number;
  offset?: number;
  orderBy?: "relevance" | "confidence" | "updated_at";
}

// ---------------------------------------------------------------------------
// Review-state rank for gating (lower = earlier in lifecycle)
// ---------------------------------------------------------------------------
const REVIEW_RANK: Record<string, number> = {
  draft: 0,
  reviewed: 1,
  accepted: 2,
  rejected: 3,
  superseded: 3,
};

function reviewStateRank(state: string): number {
  return REVIEW_RANK[state] ?? -1;
}

// ---------------------------------------------------------------------------
// KnowledgeDb
// ---------------------------------------------------------------------------
class KnowledgeDb {
  private db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  // -- prepared statements (lazy getters) -----------------------------------

  private _stmtGetProblem: Statement<ProblemEntry, [string, string]> | null = null;
  private get stmtGetProblem(): Statement<ProblemEntry, [string, string]> {
    if (!this._stmtGetProblem) {
      this._stmtGetProblem = this.db.query<ProblemEntry, [string, string]>(
        "SELECT * FROM problems WHERE problem_key = ?1 AND kind = ?2",
      );
    }
    return this._stmtGetProblem;
  }

  private _stmtInsertProblem: Statement<void, [string, string, string, string | null, string | null, number, string, string | null, string]> | null = null;
  private get stmtInsertProblem(): Statement<void, [string, string, string, string | null, string | null, number, string, string | null, string]> {
    if (!this._stmtInsertProblem) {
      this._stmtInsertProblem = this.db.query<void, [string, string, string, string | null, string | null, number, string, string | null, string]>(
        `INSERT INTO problems (problem_key, kind, problem, root_cause, canonical_solution, confidence, review_state, superseded_by, tags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      );
    }
    return this._stmtInsertProblem;
  }

  private _stmtUpdateProblem: Statement<void, [string, string, string, string | null, string | null, number, string, string | null, string]> | null = null;
  private get stmtUpdateProblem(): Statement<void, [string, string, string, string | null, string | null, number, string, string | null, string]> {
    if (!this._stmtUpdateProblem) {
      this._stmtUpdateProblem = this.db.query<void, [string, string, string, string | null, string | null, number, string, string | null, string]>(
        `UPDATE problems SET problem = ?3, root_cause = ?4, canonical_solution = ?5, confidence = ?6, review_state = ?7, superseded_by = ?8, tags = ?9, updated_at = datetime('now')
         WHERE problem_key = ?1 AND kind = ?2`,
      );
    }
    return this._stmtUpdateProblem;
  }

  private _stmtInsertOccurrence: Statement<void, [string, string, string, string | null, string | null, string | null, string | null, string | null, string | null]> | null = null;
  private get stmtInsertOccurrence(): Statement<void, [string, string, string, string | null, string | null, string | null, string | null, string | null, string | null]> {
    if (!this._stmtInsertOccurrence) {
      this._stmtInsertOccurrence = this.db.query<void, [string, string, string, string | null, string | null, string | null, string | null, string | null, string | null]>(
        `INSERT INTO occurrences (id, problem_key, kind, project_ref, repo_ref, issue_ref, commit_ref, observed_symptoms, outcome)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      );
    }
    return this._stmtInsertOccurrence;
  }

  private _stmtGetOccurrences: Statement<OccurrenceEntry, [string, string]> | null = null;
  private get stmtGetOccurrences(): Statement<OccurrenceEntry, [string, string]> {
    if (!this._stmtGetOccurrences) {
      this._stmtGetOccurrences = this.db.query<OccurrenceEntry, [string, string]>(
        "SELECT * FROM occurrences WHERE problem_key = ?1 AND kind = ?2 ORDER BY occurred_at DESC",
      );
    }
    return this._stmtGetOccurrences;
  }

  private _stmtInsertRevision: Statement<void, [string, string, string, string, string | null, string | null, number | null, string | null]> | null = null;
  private get stmtInsertRevision(): Statement<void, [string, string, string, string, string | null, string | null, number | null, string | null]> {
    if (!this._stmtInsertRevision) {
      this._stmtInsertRevision = this.db.query<void, [string, string, string, string, string | null, string | null, number | null, string | null]>(
        `INSERT INTO revisions (id, problem_key, kind, field_name, old_value, new_value, confidence_at_time, review_state_at_time)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      );
    }
    return this._stmtInsertRevision;
  }

  private _stmtGetRevisions: Statement<RevisionEntry, [string, string]> | null = null;
  private get stmtGetRevisions(): Statement<RevisionEntry, [string, string]> {
    if (!this._stmtGetRevisions) {
      this._stmtGetRevisions = this.db.query<RevisionEntry, [string, string]>(
        "SELECT * FROM revisions WHERE problem_key = ?1 AND kind = ?2 ORDER BY created_at DESC",
      );
    }
    return this._stmtGetRevisions;
  }

  private _stmtGetStats: Statement<{ total_problems: number; accepted_count: number; draft_count: number; avg_confidence: number }, []> | null = null;
  private get stmtGetStats(): Statement<{ total_problems: number; accepted_count: number; draft_count: number; avg_confidence: number }, []> {
    if (!this._stmtGetStats) {
      this._stmtGetStats = this.db.query<{ total_problems: number; accepted_count: number; draft_count: number; avg_confidence: number }, []>(
        `SELECT
           COUNT(*) AS total_problems,
           SUM(CASE WHEN review_state = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
           SUM(CASE WHEN review_state = 'draft' THEN 1 ELSE 0 END) AS draft_count,
           COALESCE(AVG(confidence), 0.0) AS avg_confidence
         FROM problems`,
      );
    }
    return this._stmtGetStats;
  }

  private _stmtSupersede: Statement<void, [string, string, string]> | null = null;
  private get stmtSupersede(): Statement<void, [string, string, string]> {
    if (!this._stmtSupersede) {
      this._stmtSupersede = this.db.query<void, [string, string, string]>(
        `UPDATE problems SET review_state = 'superseded', superseded_by = ?3, updated_at = datetime('now')
         WHERE problem_key = ?1 AND kind = ?2`,
      );
    }
    return this._stmtSupersede;
  }

  // -- factory ---------------------------------------------------------------

  static create(dbPath: string): KnowledgeDb {
    const db = new Database(dbPath);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA busy_timeout = 5000");
    KnowledgeDb.createSchema(db);
    return new KnowledgeDb(db);
  }

  private static createSchema(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS problems (
        problem_key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('dev','devops','planning','testing','architecture','release')),
        problem TEXT NOT NULL,
        root_cause TEXT,
        canonical_solution TEXT,
        confidence REAL NOT NULL DEFAULT 0.0 CHECK(confidence >= 0.0 AND confidence <= 1.0),
        review_state TEXT NOT NULL DEFAULT 'draft' CHECK(review_state IN ('draft','reviewed','accepted','rejected','superseded')),
        superseded_by TEXT REFERENCES problems(problem_key),
        tags TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (problem_key, kind)
      ) STRICT;
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS occurrences (
        id TEXT PRIMARY KEY,
        problem_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        project_ref TEXT,
        repo_ref TEXT,
        issue_ref TEXT,
        commit_ref TEXT,
        observed_symptoms TEXT,
        outcome TEXT CHECK(outcome IN ('fixed','failed','workaround','observed')),
        occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (problem_key, kind) REFERENCES problems(problem_key, kind)
      ) STRICT;
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS revisions (
        id TEXT PRIMARY KEY,
        problem_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        field_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        confidence_at_time REAL,
        review_state_at_time TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (problem_key, kind) REFERENCES problems(problem_key, kind)
      ) STRICT;
    `);

    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS problems_fts USING fts5(
        problem_key,
        kind,
        problem,
        root_cause,
        canonical_solution,
        tags,
        content='problems',
        content_rowid='rowid'
      );
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS problems_ai AFTER INSERT ON problems BEGIN
        INSERT INTO problems_fts(rowid, problem_key, kind, problem, root_cause, canonical_solution, tags)
        VALUES (new.rowid, new.problem_key, new.kind, new.problem, new.root_cause, new.canonical_solution, new.tags);
      END;
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS problems_ad AFTER DELETE ON problems BEGIN
        INSERT INTO problems_fts(problems_fts, rowid, problem_key, kind, problem, root_cause, canonical_solution, tags)
        VALUES ('delete', old.rowid, old.problem_key, old.kind, old.problem, old.root_cause, old.canonical_solution, old.tags);
      END;
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS problems_au AFTER UPDATE ON problems BEGIN
        INSERT INTO problems_fts(problems_fts, rowid, problem_key, kind, problem, root_cause, canonical_solution, tags)
        VALUES ('delete', old.rowid, old.problem_key, old.kind, old.problem, old.root_cause, old.canonical_solution, old.tags);
        INSERT INTO problems_fts(rowid, problem_key, kind, problem, root_cause, canonical_solution, tags)
        VALUES (new.rowid, new.problem_key, new.kind, new.problem, new.root_cause, new.canonical_solution, new.tags);
      END;
    `);
  }

  // -- public methods --------------------------------------------------------

  findProblems(filter: FindProblemsFilter): ProblemEntry[] {
    const { sql, params } = this.buildFindSQL(filter);
    return this.db.query<ProblemEntry, string[]>(sql).all(...params);
  }

  getProblem(problem_key: string, kind: string): ProblemEntry | null {
    return this.stmtGetProblem.get(problem_key, kind) ?? null;
  }

  addProblem(entry: Omit<ProblemEntry, "created_at" | "updated_at">): void {
    const tx = this.db.transaction(() => {
      const existing = this.stmtGetProblem.get(entry.problem_key, entry.kind);

      if (existing) {
        if (entry.confidence < existing.confidence) {
          throw new Error(
            `CONFIDENCE_GATE: existing entry has higher confidence (${existing.confidence} > ${entry.confidence})`,
          );
        }
        // Record revision for each changed field
        this.recordRevision(entry.problem_key, entry.kind, "problem", existing.problem, entry.problem, existing.confidence, existing.review_state);
        this.recordRevision(entry.problem_key, entry.kind, "root_cause", existing.root_cause, entry.root_cause, existing.confidence, existing.review_state);
        this.recordRevision(entry.problem_key, entry.kind, "canonical_solution", existing.canonical_solution, entry.canonical_solution, existing.confidence, existing.review_state);
        this.recordRevision(entry.problem_key, entry.kind, "confidence", String(existing.confidence), String(entry.confidence), existing.confidence, existing.review_state);
        this.recordRevision(entry.problem_key, entry.kind, "review_state", existing.review_state, entry.review_state, existing.confidence, existing.review_state);
        this.recordRevision(entry.problem_key, entry.kind, "tags", existing.tags, entry.tags, existing.confidence, existing.review_state);

        this.stmtUpdateProblem.run(
          entry.problem_key,
          entry.kind,
          entry.problem,
          entry.root_cause,
          entry.canonical_solution,
          entry.confidence,
          entry.review_state,
          entry.superseded_by,
          entry.tags,
        );
      } else {
        this.stmtInsertProblem.run(
          entry.problem_key,
          entry.kind,
          entry.problem,
          entry.root_cause,
          entry.canonical_solution,
          entry.confidence,
          entry.review_state,
          entry.superseded_by,
          entry.tags,
        );
      }
    });
    tx();
  }

  updateProblem(
    problem_key: string,
    kind: string,
    fields: Partial<Pick<ProblemEntry, "problem" | "root_cause" | "canonical_solution" | "confidence" | "review_state" | "tags">>,
  ): void {
    const tx = this.db.transaction(() => {
      const existing = this.stmtGetProblem.get(problem_key, kind);
      if (!existing) {
        throw new Error(`Problem not found: ${problem_key}/${kind}`);
      }

      const newConfidence = fields.confidence ?? existing.confidence;
      const newReviewState = fields.review_state ?? existing.review_state;

      // Confidence gate
      if (fields.confidence !== undefined && fields.confidence < existing.confidence) {
        throw new Error(
          `CONFIDENCE_GATE: existing entry has higher confidence (${existing.confidence} > ${fields.confidence})`,
        );
      }

      // Review-state gate
      if (fields.review_state !== undefined) {
        const oldRank = reviewStateRank(existing.review_state);
        const newRank = reviewStateRank(fields.review_state);
        if (newRank < oldRank) {
          throw new Error(
            `REVIEW_GATE: cannot move from '${existing.review_state}' to '${fields.review_state}' (regression)`,
          );
        }
        if ((existing.review_state === "rejected" || existing.review_state === "superseded") && fields.review_state !== existing.review_state) {
          throw new Error(
            `REVIEW_GATE: '${existing.review_state}' is a terminal state, cannot transition to '${fields.review_state}'`,
          );
        }
      }

      // Build SET clauses dynamically
      const setClauses: string[] = [];
      const params: (string | number | null)[] = [];

      if (fields.problem !== undefined) {
        setClauses.push("problem = ?");
        params.push(fields.problem);
        this.recordRevision(problem_key, kind, "problem", existing.problem, fields.problem, newConfidence, newReviewState);
      }
      if (fields.root_cause !== undefined) {
        setClauses.push("root_cause = ?");
        params.push(fields.root_cause);
        this.recordRevision(problem_key, kind, "root_cause", existing.root_cause, fields.root_cause, newConfidence, newReviewState);
      }
      if (fields.canonical_solution !== undefined) {
        setClauses.push("canonical_solution = ?");
        params.push(fields.canonical_solution);
        this.recordRevision(problem_key, kind, "canonical_solution", existing.canonical_solution, fields.canonical_solution, newConfidence, newReviewState);
      }
      if (fields.confidence !== undefined) {
        setClauses.push("confidence = ?");
        params.push(fields.confidence);
        this.recordRevision(problem_key, kind, "confidence", String(existing.confidence), String(fields.confidence), existing.confidence, existing.review_state);
      }
      if (fields.review_state !== undefined) {
        setClauses.push("review_state = ?");
        params.push(fields.review_state);
        this.recordRevision(problem_key, kind, "review_state", existing.review_state, fields.review_state, newConfidence, existing.review_state);
      }
      if (fields.tags !== undefined) {
        setClauses.push("tags = ?");
        params.push(fields.tags);
        this.recordRevision(problem_key, kind, "tags", existing.tags, fields.tags, newConfidence, newReviewState);
      }

      if (setClauses.length === 0) return;

      setClauses.push("updated_at = datetime('now')");
      params.push(problem_key, kind);

      const sql = `UPDATE problems SET ${setClauses.join(", ")} WHERE problem_key = ? AND kind = ?`;
      this.db.query(sql).run(...params);
    });
    tx();
  }

  supersede(problem_key: string, kind: string, superseded_by_key: string): void {
    const tx = this.db.transaction(() => {
      const existing = this.stmtGetProblem.get(problem_key, kind);
      if (!existing) {
        throw new Error(`Problem not found: ${problem_key}/${kind}`);
      }
      this.recordRevision(problem_key, kind, "review_state", existing.review_state, "superseded", existing.confidence, existing.review_state);
      this.recordRevision(problem_key, kind, "superseded_by", existing.superseded_by, superseded_by_key, existing.confidence, existing.review_state);
      this.stmtSupersede.run(problem_key, kind, superseded_by_key);
    });
    tx();
  }

  addOccurrence(entry: Omit<OccurrenceEntry, "id" | "occurred_at">): void {
    const id = uuid7();
    this.stmtInsertOccurrence.run(
      id,
      entry.problem_key,
      entry.kind,
      entry.project_ref ?? null,
      entry.repo_ref ?? null,
      entry.issue_ref ?? null,
      entry.commit_ref ?? null,
      entry.observed_symptoms ?? null,
      entry.outcome ?? null,
    );
  }

  getOccurrences(problem_key: string, kind: string): OccurrenceEntry[] {
    return this.stmtGetOccurrences.all(problem_key, kind);
  }

  getRevisionHistory(problem_key: string, kind: string): RevisionEntry[] {
    return this.stmtGetRevisions.all(problem_key, kind);
  }

  getStats(): { total_problems: number; accepted_count: number; draft_count: number; avg_confidence: number } {
    const row = this.stmtGetStats.get();
    return {
      total_problems: row?.total_problems ?? 0,
      accepted_count: row?.accepted_count ?? 0,
      draft_count: row?.draft_count ?? 0,
      avg_confidence: row?.avg_confidence ?? 0.0,
    };
  }

  close(): void {
    this.db.close();
  }

  // -- internal helpers ------------------------------------------------------

  private recordRevision(
    problem_key: string,
    kind: string,
    field_name: string,
    old_value: string | null,
    new_value: string | null,
    confidence_at_time: number | null,
    review_state_at_time: string | null,
  ): void {
    if (old_value === new_value) return;
    this.stmtInsertRevision.run(
      uuid7(),
      problem_key,
      kind,
      field_name,
      old_value,
      new_value,
      confidence_at_time,
      review_state_at_time,
    );
  }

  private buildFindSQL(filter: FindProblemsFilter): { sql: string; params: string[] } {
    const params: string[] = [];
    const whereClauses: string[] = [];

    if (filter.query) {
      whereClauses.push("problems.rowid IN (SELECT rowid FROM problems_fts WHERE problems_fts MATCH ?)");
      params.push(filter.query);
    }
    if (filter.kind) {
      whereClauses.push("problems.kind = ?");
      params.push(filter.kind);
    }
    if (filter.confidence_min !== undefined) {
      whereClauses.push("problems.confidence >= ?");
      params.push(String(filter.confidence_min));
    }
    if (filter.review_state) {
      whereClauses.push("problems.review_state = ?");
      params.push(filter.review_state);
    }

    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    let orderBy: string;
    switch (filter.orderBy ?? "relevance") {
      case "confidence":
        orderBy = "problems.confidence DESC";
        break;
      case "updated_at":
        orderBy = "problems.updated_at DESC";
        break;
      case "relevance":
      default:
        if (filter.query) {
          orderBy = "rank";
        } else {
          orderBy = "problems.updated_at DESC";
        }
        break;
    }

    const limit = filter.limit ?? 10;
    const offset = filter.offset ?? 0;

    let fromClause = "problems";
    if (filter.query) {
      fromClause = "problems JOIN problems_fts ON problems.rowid = problems_fts.rowid";
    }

    const sql = `SELECT problems.* FROM ${fromClause} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    params.push(String(limit), String(offset));

    return { sql, params };
  }
}

export { KnowledgeDb, type ProblemEntry, type OccurrenceEntry, type RevisionEntry, type FindProblemsFilter };
export default KnowledgeDb;
