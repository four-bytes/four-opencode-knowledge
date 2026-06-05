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
interface KnowledgeEntry {
  entry_key: string;
  kind: string;
  title: string;
  description: string;
  root_cause: string | null;
  canonical_solution: string | null;
  entity_type: string;
  confidence: number;
  review_state: "draft" | "reviewed" | "accepted" | "rejected" | "superseded";
  superseded_by: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

interface OccurrenceEntry {
  id: string;
  entry_key: string;
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
  entry_key: string;
  kind: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  confidence_at_time: number | null;
  review_state_at_time: string | null;
  created_at: string;
}

interface FindEntriesFilter {
  query?: string;
  kind?: string;
  entity_type?: string;
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

  private _stmtGetEntry: Statement<KnowledgeEntry, [string, string]> | null = null;
  private get stmtGetEntry(): Statement<KnowledgeEntry, [string, string]> {
    if (!this._stmtGetEntry) {
      this._stmtGetEntry = this.db.query<KnowledgeEntry, [string, string]>(
        "SELECT * FROM entries WHERE entry_key = ?1 AND kind = ?2",
      );
    }
    return this._stmtGetEntry;
  }

  private _stmtInsertEntry: Statement<void, [string, string, string, string, string | null, string | null, string, number, string, string | null, string]> | null = null;
  private get stmtInsertEntry(): Statement<void, [string, string, string, string, string | null, string | null, string, number, string, string | null, string]> {
    if (!this._stmtInsertEntry) {
      this._stmtInsertEntry = this.db.query<void, [string, string, string, string, string | null, string | null, string, number, string, string | null, string]>(
        `INSERT INTO entries (entry_key, kind, title, description, root_cause, canonical_solution, entity_type, confidence, review_state, superseded_by, tags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      );
    }
    return this._stmtInsertEntry;
  }

  private _stmtUpdateEntry: Statement<void, [string, string, string, string, string | null, string | null, string, number, string, string | null, string]> | null = null;
  private get stmtUpdateEntry(): Statement<void, [string, string, string, string, string | null, string | null, string, number, string, string | null, string]> {
    if (!this._stmtUpdateEntry) {
      this._stmtUpdateEntry = this.db.query<void, [string, string, string, string, string | null, string | null, string, number, string, string | null, string]>(
        `UPDATE entries SET title = ?3, description = ?4, root_cause = ?5, canonical_solution = ?6, entity_type = ?7, confidence = ?8, review_state = ?9, superseded_by = ?10, tags = ?11, updated_at = datetime('now')
         WHERE entry_key = ?1 AND kind = ?2`,
      );
    }
    return this._stmtUpdateEntry;
  }

  private _stmtInsertOccurrence: Statement<void, [string, string, string, string | null, string | null, string | null, string | null, string | null, string | null]> | null = null;
  private get stmtInsertOccurrence(): Statement<void, [string, string, string, string | null, string | null, string | null, string | null, string | null, string | null]> {
    if (!this._stmtInsertOccurrence) {
      this._stmtInsertOccurrence = this.db.query<void, [string, string, string, string | null, string | null, string | null, string | null, string | null, string | null]>(
        `INSERT INTO occurrences (id, entry_key, kind, project_ref, repo_ref, issue_ref, commit_ref, observed_symptoms, outcome)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      );
    }
    return this._stmtInsertOccurrence;
  }

  private _stmtGetOccurrences: Statement<OccurrenceEntry, [string, string]> | null = null;
  private get stmtGetOccurrences(): Statement<OccurrenceEntry, [string, string]> {
    if (!this._stmtGetOccurrences) {
      this._stmtGetOccurrences = this.db.query<OccurrenceEntry, [string, string]>(
        "SELECT * FROM occurrences WHERE entry_key = ?1 AND kind = ?2 ORDER BY occurred_at DESC",
      );
    }
    return this._stmtGetOccurrences;
  }

  private _stmtInsertRevision: Statement<void, [string, string, string, string, string | null, string | null, number | null, string | null]> | null = null;
  private get stmtInsertRevision(): Statement<void, [string, string, string, string, string | null, string | null, number | null, string | null]> {
    if (!this._stmtInsertRevision) {
      this._stmtInsertRevision = this.db.query<void, [string, string, string, string, string | null, string | null, number | null, string | null]>(
        `INSERT INTO revisions (id, entry_key, kind, field_name, old_value, new_value, confidence_at_time, review_state_at_time)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      );
    }
    return this._stmtInsertRevision;
  }

  private _stmtGetRevisions: Statement<RevisionEntry, [string, string]> | null = null;
  private get stmtGetRevisions(): Statement<RevisionEntry, [string, string]> {
    if (!this._stmtGetRevisions) {
      this._stmtGetRevisions = this.db.query<RevisionEntry, [string, string]>(
        "SELECT * FROM revisions WHERE entry_key = ?1 AND kind = ?2 ORDER BY created_at DESC",
      );
    }
    return this._stmtGetRevisions;
  }

  private _stmtGetStats: Statement<{ total_entries: number; accepted_count: number; draft_count: number; avg_confidence: number }, []> | null = null;
  private get stmtGetStats(): Statement<{ total_entries: number; accepted_count: number; draft_count: number; avg_confidence: number }, []> {
    if (!this._stmtGetStats) {
      this._stmtGetStats = this.db.query<{ total_entries: number; accepted_count: number; draft_count: number; avg_confidence: number }, []>(
        `SELECT
           COUNT(*) AS total_entries,
           SUM(CASE WHEN review_state = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
           SUM(CASE WHEN review_state = 'draft' THEN 1 ELSE 0 END) AS draft_count,
           COALESCE(AVG(confidence), 0.0) AS avg_confidence
         FROM entries`,
      );
    }
    return this._stmtGetStats;
  }

  private _stmtSupersedeEntry: Statement<void, [string, string, string]> | null = null;
  private get stmtSupersedeEntry(): Statement<void, [string, string, string]> {
    if (!this._stmtSupersedeEntry) {
      this._stmtSupersedeEntry = this.db.query<void, [string, string, string]>(
        `UPDATE entries SET review_state = 'superseded', superseded_by = ?3, updated_at = datetime('now')
         WHERE entry_key = ?1 AND kind = ?2`,
      );
    }
    return this._stmtSupersedeEntry;
  }

  // -- factory ---------------------------------------------------------------

  static create(dbPath: string, options?: { autoSeed?: boolean }): KnowledgeDb {
    const db = new Database(dbPath);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA busy_timeout = 5000");
    KnowledgeDb.createSchema(db);
    const instance = new KnowledgeDb(db);
    if (options?.autoSeed !== false && instance.getStats().total_entries === 0) {
      instance.seedInitialEntries();
    }
    return instance;
  }

  private seedInitialEntries(): void {
    const entries = [
      {
        entry_key: "dist-missing-after-clone",
        kind: "build",
        title: "dist-missing-after-clone",
        description: "After cloning any four-opencode-* plugin repo, dist/ is gitignored and absent. bun run build is required before the plugin can be loaded by opencode.",
        root_cause: ".gitignore includes dist/. Plugin loader reads from dist/, not src/. No post-clone hook exists.",
        canonical_solution: "Always run bun run build after cloning. Consider a Makefile or justfile with a setup target: bun install && bun run build.",
        entity_type: "pattern" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "source-file-naming",
        kind: "convention",
        title: "source-file-naming",
        description: "All four-opencode-* plugins use src/four-opencode-<pluginname>.ts as the entry point. New agents default to src/index.ts which doesn't exist.",
        root_cause: "Convention inherited from monorepo structure. No AGENTS.md enforcement.",
        canonical_solution: "Entry point is always src/four-opencode-<name>.ts. AGENTS.md should state this explicitly.",
        entity_type: "convention" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "phantom-event-hook",
        kind: "api-misunderstanding",
        title: "phantom-event-hook",
        description: "Agents attempt to register an event hook on the opencode Plugin-System. This hook does not exist (API supports tool, command, chat, provider).",
        root_cause: "Agents infer or hallucinate hook names. Plugin docs don't list available hooks prominently.",
        canonical_solution: "Available hooks: tool, command, chat, provider. No event hook exists.",
        entity_type: "pattern" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "compaction-signal-false-positive",
        kind: "bug",
        title: "compaction-signal-false-positive",
        description: "Compaction signal detector triggers on legitimate LLM output, producing 570+ false triggers in some sessions.",
        root_cause: "Regex detection without position awareness. Pattern appears in LLM reasoning text.",
        canonical_solution: "Gate detection on position (end-of-response), require exact block format, or use XML/tag delimiters.",
        entity_type: "fix" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "empty-assistant-message-after-strip",
        kind: "bug",
        title: "empty-assistant-message-after-strip",
        description: "After stripping compaction signal from an assistant message, resulting text can be empty. Empty messages sent to LLM API are rejected.",
        root_cause: "Compaction signal can occupy entire assistant message. Post-strip validation missing.",
        canonical_solution: "After signal removal, check if remaining text is empty. If so, remove turn or replace with [compaction applied].",
        entity_type: "fix" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "vec0-so-missing-after-clone",
        kind: "build",
        title: "vec0-so-missing-after-clone",
        description: "sqlite-vec extension (vec0.so) is absent after clone. Vector search silently degrades to FTS-only without error.",
        root_cause: "Native extensions not in git. Build process compiles them but no validation step.",
        canonical_solution: "Run full build after clone. Add startup check that logs warning if vec0.so missing.",
        entity_type: "pattern" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "rpc-timeout-too-short-ingest",
        kind: "config",
        title: "rpc-timeout-too-short-ingest",
        description: "RPC timeout for RAG ingest hardcoded to 120s. Large projects take longer, causing false timeouts.",
        root_cause: "Hardcoded timeout without considering project size.",
        canonical_solution: "Make ingest timeout configurable (default 300s). Consider async ingestion for >500 files.",
        entity_type: "fix" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "foreign-request-rejection-masquerade",
        kind: "config",
        title: "foreign-request-rejection-masquerade",
        description: "Claude provider sends requests with incorrect USER_AGENT header. Anthropic returns generic 'foreign request' rejection, misleading debugging.",
        root_cause: "Provider doesn't set expected USER_AGENT format for partner integrations.",
        canonical_solution: "Ensure USER_AGENT header matches Anthropic's expected format.",
        entity_type: "problem" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "local-plugin-pickup-delay",
        kind: "opencode-behavior",
        title: "local-plugin-pickup-delay",
        description: "After rebuilding a local plugin (bun run build), opencode continues to use old cached dist/. Full process restart required.",
        root_cause: "opencode caches plugin modules in memory, doesn't watch dist/ for changes.",
        canonical_solution: "After plugin rebuild, fully restart the opencode process. No hot-reload exists.",
        entity_type: "observation" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "argocd-ksops-outofsync",
        kind: "argocd",
        title: "argocd-ksops-outofsync",
        description: "ArgoCD apps using ksops show perpetual OutOfSync. Most common causes: missing .ksops.yaml or wrong kustomization pattern.",
        root_cause: "Kustomize overlay structure doesn't match ksops expectations.",
        canonical_solution: "Ensure .ksops.yaml exists in kustomization root. Use kustomize build . | kubectl diff -f - to validate.",
        entity_type: "problem" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "hostport-deadlock",
        kind: "kubernetes",
        title: "hostport-deadlock",
        description: "Two deadlock scenarios: hostPort+RollingUpdate, RWO PVC+maxSurge. Circular dependencies prevent rollout.",
        root_cause: "Kubernetes scheduling constraints create circular dependencies. hostPort and RWO PVCs are exclusive per node.",
        canonical_solution: "hostPort: use hostNetwork or Service/Ingress instead. RWO PVC: use maxSurge:0, Recreate strategy, or RWX storage.",
        entity_type: "problem" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "reloader-arm-arch-tag",
        kind: "container",
        title: "reloader-arm-arch-tag",
        description: "Stakater Reloader -ubi image tag is x86_64 only. On ARM64 clusters (Hetzner CAX), pod fails with exec format error.",
        root_cause: "-ubi variant doesn't include ARM64 builds. Standard tag supports multi-arch.",
        canonical_solution: "Remove -ubi suffix. Use stakater/reloader:version tag which supports both architectures.",
        entity_type: "fix" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "dagu-ssl-client-zombies",
        kind: "process",
        title: "dagu-ssl-client-zombies",
        description: "Dagu scheduler runs BusyBox ssl_client as child of PID-1. After completion, it becomes zombie (~96/day).",
        root_cause: "BusyBox ssl_client doesn't handle lifecycle as PID-1 child. Init process must wait() on children.",
        canonical_solution: "Add tini or dumb-init as container ENTRYPOINT to reap zombie processes.",
        entity_type: "fix" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "argocd-ignoreDifferences-empty-list",
        kind: "argocd",
        title: "argocd-ignoreDifferences-empty-list",
        description: "ArgoCD's ignoreDifferences with empty list [] is normalized to null, disabling all difference ignoring.",
        root_cause: "Kubernetes API normalization: empty arrays become null. ArgoCD interprets null as no ignore rules.",
        canonical_solution: "Never use ignoreDifferences: []. Either omit or populate with at least one entry.",
        entity_type: "problem" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
      {
        entry_key: "hetzner-gateway-dot-one",
        kind: "networking",
        title: "hetzner-gateway-dot-one",
        description: "Hetzner reserves .1 address in each subnet as gateway. Assigning .1 to server causes routing failures.",
        root_cause: "Hetzner Cloud convention: first IP in subnet is always gateway. Not prominently documented.",
        canonical_solution: "Never assign x.x.x.1. Start server IPs at .2 or higher.",
        entity_type: "convention" as const,
        confidence: 0.0,
        review_state: "draft" as const,
        superseded_by: null,
        tags: "seed,v1",
      },
    ];
    let seeded = 0;
    for (const entry of entries) {
      try {
        this.addEntry(entry);
        seeded++;
      } catch {
        // skip duplicates
      }
    }
    console.error(`[four-opencode-knowledge] auto-seeded ${seeded} entries`);
  }

  private static createFts(db: Database): void {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        entry_key,
        kind,
        title,
        description,
        root_cause,
        canonical_solution,
        entity_type,
        tags,
        content='entries',
        content_rowid='rowid'
      );
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid, entry_key, kind, title, description, root_cause, canonical_solution, entity_type, tags)
        VALUES (new.rowid, new.entry_key, new.kind, new.title, new.description, new.root_cause, new.canonical_solution, new.entity_type, new.tags);
      END;
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, entry_key, kind, title, description, root_cause, canonical_solution, entity_type, tags)
        VALUES ('delete', old.rowid, old.entry_key, old.kind, old.title, old.description, old.root_cause, old.canonical_solution, old.entity_type, old.tags);
      END;
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, entry_key, kind, title, description, root_cause, canonical_solution, entity_type, tags)
        VALUES ('delete', old.rowid, old.entry_key, old.kind, old.title, old.description, old.root_cause, old.canonical_solution, old.entity_type, old.tags);
        INSERT INTO entries_fts(rowid, entry_key, kind, title, description, root_cause, canonical_solution, entity_type, tags)
        VALUES (new.rowid, new.entry_key, new.kind, new.title, new.description, new.root_cause, new.canonical_solution, new.entity_type, new.tags);
      END;
    `);
  }

  private static migrateFromProblems(db: Database): void {
    db.run("PRAGMA foreign_keys = OFF");

    const tx = db.transaction(() => {
    db.run(`
      CREATE TABLE entries (
        entry_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        root_cause TEXT,
        canonical_solution TEXT,
        entity_type TEXT NOT NULL DEFAULT 'problem' CHECK(entity_type IN ('problem','pattern','convention','decision','observation','fix','summary')),
        confidence REAL NOT NULL DEFAULT 0.0 CHECK(confidence >= 0.0 AND confidence <= 1.0),
        review_state TEXT NOT NULL DEFAULT 'draft' CHECK(review_state IN ('draft','reviewed','accepted','rejected','superseded')),
        superseded_by TEXT,
        tags TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (entry_key, kind)
      ) STRICT;
    `);

    db.run(`
      INSERT INTO entries (entry_key, kind, title, description, root_cause, canonical_solution, entity_type, confidence, review_state, superseded_by, tags, created_at, updated_at)
      SELECT problem_key, kind, problem, '', root_cause, canonical_solution, 'problem', confidence, review_state, superseded_by, tags, created_at, updated_at
      FROM problems;
    `);

    // Recreate occurrences with entry_key and corrected FK
    db.run("ALTER TABLE occurrences RENAME TO occurrences_old");
    db.run(`
      CREATE TABLE occurrences (
        id TEXT PRIMARY KEY,
        entry_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        project_ref TEXT,
        repo_ref TEXT,
        issue_ref TEXT,
        commit_ref TEXT,
        observed_symptoms TEXT,
        outcome TEXT CHECK(outcome IN ('fixed','failed','workaround','observed')),
        occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (entry_key, kind) REFERENCES entries(entry_key, kind)
      ) STRICT;
    `);
    db.run(`
      INSERT INTO occurrences (id, entry_key, kind, project_ref, repo_ref, issue_ref, commit_ref, observed_symptoms, outcome, occurred_at)
      SELECT id, problem_key, kind, project_ref, repo_ref, issue_ref, commit_ref, observed_symptoms, outcome, occurred_at
      FROM occurrences_old;
    `);
    db.run("DROP TABLE occurrences_old");

    // Recreate revisions with entry_key and corrected FK
    db.run("ALTER TABLE revisions RENAME TO revisions_old");
    db.run(`
      CREATE TABLE revisions (
        id TEXT PRIMARY KEY,
        entry_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        field_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        confidence_at_time REAL,
        review_state_at_time TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (entry_key, kind) REFERENCES entries(entry_key, kind)
      ) STRICT;
    `);
    db.run(`
      INSERT INTO revisions (id, entry_key, kind, field_name, old_value, new_value, confidence_at_time, review_state_at_time, created_at)
      SELECT id, problem_key, kind, field_name, old_value, new_value, confidence_at_time, review_state_at_time, created_at
      FROM revisions_old;
    `);
    db.run("DROP TABLE revisions_old");

    // Drop old FTS and triggers
    db.run("DROP TRIGGER IF EXISTS problems_ai");
    db.run("DROP TRIGGER IF EXISTS problems_ad");
    db.run("DROP TRIGGER IF EXISTS problems_au");
    db.run("DROP TABLE IF EXISTS problems_fts");
    db.run("DROP TABLE problems");

    // Create new FTS
    KnowledgeDb.createFts(db);

    // Populate FTS from existing data
    db.run("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild')");
    });
    tx();

    db.run("PRAGMA foreign_keys = ON");
  }

  private static createSchema(db: Database): void {
    const problemsExists = (db.query<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='problems'",
    ).get()?.count ?? 0) > 0;

    if (problemsExists) {
      KnowledgeDb.migrateFromProblems(db);
      return;
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS entries (
        entry_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        root_cause TEXT,
        canonical_solution TEXT,
        entity_type TEXT NOT NULL DEFAULT 'problem' CHECK(entity_type IN ('problem','pattern','convention','decision','observation','fix','summary')),
        confidence REAL NOT NULL DEFAULT 0.0 CHECK(confidence >= 0.0 AND confidence <= 1.0),
        review_state TEXT NOT NULL DEFAULT 'draft' CHECK(review_state IN ('draft','reviewed','accepted','rejected','superseded')),
        superseded_by TEXT,
        tags TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (entry_key, kind)
      ) STRICT;
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS occurrences (
        id TEXT PRIMARY KEY,
        entry_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        project_ref TEXT,
        repo_ref TEXT,
        issue_ref TEXT,
        commit_ref TEXT,
        observed_symptoms TEXT,
        outcome TEXT CHECK(outcome IN ('fixed','failed','workaround','observed')),
        occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (entry_key, kind) REFERENCES entries(entry_key, kind)
      ) STRICT;
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS revisions (
        id TEXT PRIMARY KEY,
        entry_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        field_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        confidence_at_time REAL,
        review_state_at_time TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (entry_key, kind) REFERENCES entries(entry_key, kind)
      ) STRICT;
    `);

    KnowledgeDb.createFts(db);
  }

  // -- public methods --------------------------------------------------------

  findEntries(filter: FindEntriesFilter): KnowledgeEntry[] {
    const { sql, params } = this.buildFindSQL(filter);
    return this.db.query<KnowledgeEntry, string[]>(sql).all(...params);
  }

  getEntry(entry_key: string, kind: string): KnowledgeEntry | null {
    return this.stmtGetEntry.get(entry_key, kind) ?? null;
  }

  addEntry(entry: Omit<KnowledgeEntry, "created_at" | "updated_at">): void {
    const tx = this.db.transaction(() => {
      const existing = this.stmtGetEntry.get(entry.entry_key, entry.kind);

      if (existing) {
        if (entry.confidence < existing.confidence) {
          throw new Error(
            `CONFIDENCE_GATE: existing entry has higher confidence (${existing.confidence} > ${entry.confidence})`,
          );
        }
        this.recordRevision(entry.entry_key, entry.kind, "title", existing.title, entry.title, existing.confidence, existing.review_state);
        this.recordRevision(entry.entry_key, entry.kind, "description", existing.description, entry.description, existing.confidence, existing.review_state);
        this.recordRevision(entry.entry_key, entry.kind, "root_cause", existing.root_cause, entry.root_cause, existing.confidence, existing.review_state);
        this.recordRevision(entry.entry_key, entry.kind, "canonical_solution", existing.canonical_solution, entry.canonical_solution, existing.confidence, existing.review_state);
        this.recordRevision(entry.entry_key, entry.kind, "confidence", String(existing.confidence), String(entry.confidence), existing.confidence, existing.review_state);
        this.recordRevision(entry.entry_key, entry.kind, "review_state", existing.review_state, entry.review_state, existing.confidence, existing.review_state);
        this.recordRevision(entry.entry_key, entry.kind, "tags", existing.tags, entry.tags, existing.confidence, existing.review_state);

        this.stmtUpdateEntry.run(
          entry.entry_key,
          entry.kind,
          entry.title,
          entry.description,
          entry.root_cause,
          entry.canonical_solution,
          entry.entity_type,
          entry.confidence,
          entry.review_state,
          entry.superseded_by,
          entry.tags,
        );
      } else {
        this.stmtInsertEntry.run(
          entry.entry_key,
          entry.kind,
          entry.title,
          entry.description,
          entry.root_cause,
          entry.canonical_solution,
          entry.entity_type,
          entry.confidence,
          entry.review_state,
          entry.superseded_by,
          entry.tags,
        );
      }
    });
    tx();
  }

  updateEntry(
    entry_key: string,
    kind: string,
    fields: Partial<Pick<KnowledgeEntry, "title" | "description" | "root_cause" | "canonical_solution" | "entity_type" | "confidence" | "review_state" | "tags">>,
  ): void {
    const tx = this.db.transaction(() => {
      const existing = this.stmtGetEntry.get(entry_key, kind);
      if (!existing) {
        throw new Error(`Entry not found: ${entry_key}/${kind}`);
      }

      const newConfidence = fields.confidence ?? existing.confidence;
      const newReviewState = fields.review_state ?? existing.review_state;

      if (fields.confidence !== undefined && fields.confidence < existing.confidence) {
        throw new Error(
          `CONFIDENCE_GATE: existing entry has higher confidence (${existing.confidence} > ${fields.confidence})`,
        );
      }

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

      const setClauses: string[] = [];
      const params: (string | number | null)[] = [];

      if (fields.title !== undefined) {
        setClauses.push("title = ?");
        params.push(fields.title);
        this.recordRevision(entry_key, kind, "title", existing.title, fields.title, newConfidence, newReviewState);
      }
      if (fields.description !== undefined) {
        setClauses.push("description = ?");
        params.push(fields.description);
        this.recordRevision(entry_key, kind, "description", existing.description, fields.description, newConfidence, newReviewState);
      }
      if (fields.root_cause !== undefined) {
        setClauses.push("root_cause = ?");
        params.push(fields.root_cause);
        this.recordRevision(entry_key, kind, "root_cause", existing.root_cause, fields.root_cause, newConfidence, newReviewState);
      }
      if (fields.canonical_solution !== undefined) {
        setClauses.push("canonical_solution = ?");
        params.push(fields.canonical_solution);
        this.recordRevision(entry_key, kind, "canonical_solution", existing.canonical_solution, fields.canonical_solution, newConfidence, newReviewState);
      }
      if (fields.entity_type !== undefined) {
        setClauses.push("entity_type = ?");
        params.push(fields.entity_type);
        this.recordRevision(entry_key, kind, "entity_type", existing.entity_type, fields.entity_type, newConfidence, newReviewState);
      }
      if (fields.confidence !== undefined) {
        setClauses.push("confidence = ?");
        params.push(fields.confidence);
        this.recordRevision(entry_key, kind, "confidence", String(existing.confidence), String(fields.confidence), existing.confidence, existing.review_state);
      }
      if (fields.review_state !== undefined) {
        setClauses.push("review_state = ?");
        params.push(fields.review_state);
        this.recordRevision(entry_key, kind, "review_state", existing.review_state, fields.review_state, newConfidence, existing.review_state);
      }
      if (fields.tags !== undefined) {
        setClauses.push("tags = ?");
        params.push(fields.tags);
        this.recordRevision(entry_key, kind, "tags", existing.tags, fields.tags, newConfidence, newReviewState);
      }

      if (setClauses.length === 0) return;

      setClauses.push("updated_at = datetime('now')");
      params.push(entry_key, kind);

      const sql = `UPDATE entries SET ${setClauses.join(", ")} WHERE entry_key = ? AND kind = ?`;
      this.db.query(sql).run(...params);
    });
    tx();
  }

  supersedeEntry(entry_key: string, kind: string, superseded_by_key: string): void {
    const tx = this.db.transaction(() => {
      const existing = this.stmtGetEntry.get(entry_key, kind);
      if (!existing) {
        throw new Error(`Entry not found: ${entry_key}/${kind}`);
      }
      this.recordRevision(entry_key, kind, "review_state", existing.review_state, "superseded", existing.confidence, existing.review_state);
      this.recordRevision(entry_key, kind, "superseded_by", existing.superseded_by, superseded_by_key, existing.confidence, existing.review_state);
      this.stmtSupersedeEntry.run(entry_key, kind, superseded_by_key);
    });
    tx();
  }

  addOccurrence(entry: Omit<OccurrenceEntry, "id" | "occurred_at">): void {
    const id = uuid7();
    this.stmtInsertOccurrence.run(
      id,
      entry.entry_key,
      entry.kind,
      entry.project_ref ?? null,
      entry.repo_ref ?? null,
      entry.issue_ref ?? null,
      entry.commit_ref ?? null,
      entry.observed_symptoms ?? null,
      entry.outcome ?? null,
    );
  }

  getOccurrences(entry_key: string, kind: string): OccurrenceEntry[] {
    return this.stmtGetOccurrences.all(entry_key, kind);
  }

  getRevisionHistory(entry_key: string, kind: string): RevisionEntry[] {
    return this.stmtGetRevisions.all(entry_key, kind);
  }

  getStats(): { total_entries: number; accepted_count: number; draft_count: number; avg_confidence: number; by_entity_type: Record<string, number> } {
    const row = this.stmtGetStats.get();
    const entityRows = this.db.query<{ entity_type: string; count: number }, []>(
      "SELECT entity_type, COUNT(*) as count FROM entries GROUP BY entity_type",
    ).all();
    const by_entity_type: Record<string, number> = {};
    for (const r of entityRows) {
      by_entity_type[r.entity_type] = r.count;
    }
    return {
      total_entries: row?.total_entries ?? 0,
      accepted_count: row?.accepted_count ?? 0,
      draft_count: row?.draft_count ?? 0,
      avg_confidence: row?.avg_confidence ?? 0.0,
      by_entity_type,
    };
  }

  close(): void {
    this.db.close();
  }

  // -- internal helpers ------------------------------------------------------

  private recordRevision(
    entry_key: string,
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
      entry_key,
      kind,
      field_name,
      old_value,
      new_value,
      confidence_at_time,
      review_state_at_time,
    );
  }

  private buildFindSQL(filter: FindEntriesFilter): { sql: string; params: string[] } {
    const params: string[] = [];
    const whereClauses: string[] = [];

    if (filter.query) {
      whereClauses.push("entries.rowid IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)");
      params.push(filter.query);
    }
    if (filter.kind) {
      whereClauses.push("entries.kind = ?");
      params.push(filter.kind);
    }
    if (filter.entity_type) {
      whereClauses.push("entries.entity_type = ?");
      params.push(filter.entity_type);
    }
    if (filter.confidence_min !== undefined) {
      whereClauses.push("entries.confidence >= ?");
      params.push(String(filter.confidence_min));
    }
    if (filter.review_state) {
      whereClauses.push("entries.review_state = ?");
      params.push(filter.review_state);
    }

    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    let orderBy: string;
    switch (filter.orderBy ?? "relevance") {
      case "confidence":
        orderBy = "entries.confidence DESC";
        break;
      case "updated_at":
        orderBy = "entries.updated_at DESC";
        break;
      case "relevance":
      default:
        if (filter.query) {
          orderBy = "rank";
        } else {
          orderBy = "entries.updated_at DESC";
        }
        break;
    }

    const limit = filter.limit ?? 10;
    const offset = filter.offset ?? 0;

    let fromClause = "entries";
    if (filter.query) {
      fromClause = "entries JOIN entries_fts ON entries.rowid = entries_fts.rowid";
    }

    const sql = `SELECT entries.* FROM ${fromClause} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    params.push(String(limit), String(offset));

    return { sql, params };
  }
}

export { KnowledgeDb, type KnowledgeEntry, type OccurrenceEntry, type RevisionEntry, type FindEntriesFilter };
export default KnowledgeDb;
