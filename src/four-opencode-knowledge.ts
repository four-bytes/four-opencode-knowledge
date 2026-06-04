import { tool } from "@opencode-ai/plugin";
import type { Plugin } from "@opencode-ai/plugin";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import KnowledgeDb, { type FindEntriesFilter, type KnowledgeEntry } from "./db.js";
import { logDebugEvent } from "./debug-logger.js";
import pkg from "../package.json";

export const FourOpenCodeKnowledgePlugin: Plugin = async (_ctx) => {
  console.error(`[four-opencode-knowledge] v${pkg.version} loading…`);

  const dataDir =
    process.env.FOUR_KNOWLEDGE_DATA_DIR ??
    join(homedir(), ".local", "share", "four-opencode-knowledge");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = join(dataDir, "knowledge.db");
  const db = KnowledgeDb.create(dbPath);
  console.error(`[four-opencode-knowledge] DB at ${dbPath}`);
  logDebugEvent("plugin.load", { dbPath, version: pkg.version });

  const kbSearch = tool({
    description:
      "Universal search across all entity types (problem, pattern, convention, decision, observation, fix, summary). " +
      "Returns ranked results. Filter by entity_type, kind, confidence, review_state. " +
      "PREFER entries with review_state='accepted' AND confidence>=0.7 as trusted solutions. " +
      "AVOID entries with review_state='rejected' or 'superseded'. " +
      "Check occurrences with outcome='failed' as bad_attempts to avoid repeating them.",
    args: {
      query: tool.schema.string(),
      entity_type: tool.schema.string().optional(),
      kind: tool.schema.string().optional(),
      confidence_min: tool.schema.number().optional(),
      review_state: tool.schema.string().optional(),
      limit: tool.schema.number().optional(),
      offset: tool.schema.number().optional(),
      orderBy: tool.schema.string().optional(),
    },
    async execute(args, _toolCtx) {
      return JSON.stringify(
        db.findEntries({
          query: args.query as string,
          entity_type: args.entity_type as string | undefined,
          kind: args.kind as string | undefined,
          confidence_min: args.confidence_min as number | undefined,
          review_state: args.review_state as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
          orderBy: (args.orderBy as FindEntriesFilter["orderBy"]) ?? "relevance",
        }),
        null,
        2,
      );
    },
  });

  const kbFindProblemAlias = tool({
    description:
      "Lookup known problems in the knowledge store. ALWAYS call this before attempting a fix on a known issue. " +
      "Returns ranked results with problem descriptions, root causes, canonical solutions, confidence scores, and review states. " +
      "Use filters to narrow by kind, confidence, and review state. " +
      "PREFER entries with review_state='accepted' AND confidence>=0.7 as trusted solutions. " +
      "AVOID entries with review_state='rejected' or 'superseded'. " +
      "Check occurrences with outcome='failed' as bad_attempts to avoid repeating them.",
    args: {
      query: tool.schema.string(),
      kind: tool.schema.string().optional(),
      confidence_min: tool.schema.number().optional(),
      review_state: tool.schema.string().optional(),
      limit: tool.schema.number().optional(),
      offset: tool.schema.number().optional(),
      orderBy: tool.schema.string().optional(),
    },
    async execute(args, _toolCtx) {
      return JSON.stringify(
        db.findEntries({
          query: args.query as string,
          entity_type: "problem",
          kind: args.kind as string | undefined,
          confidence_min: args.confidence_min as number | undefined,
          review_state: args.review_state as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
          orderBy: (args.orderBy as FindEntriesFilter["orderBy"]) ?? "relevance",
        }),
        null,
        2,
      );
    },
  });

  const kbGet = tool({
    description:
      "Get full entry + occurrence history + revisions for a specific entry_key+kind. " +
      "Use after kb_search for detailed context.",
    args: {
      entry_key: tool.schema.string(),
      kind: tool.schema.string(),
    },
    async execute(args, _toolCtx) {
      const entry = db.getEntry(args.entry_key as string, args.kind as string);
      const occurrences = db.getOccurrences(args.entry_key as string, args.kind as string);
      const revisions = db.getRevisionHistory(args.entry_key as string, args.kind as string);
      return JSON.stringify({ entry, occurrences, revisions }, null, 2);
    },
  });

  const kbFindSolutionAlias = tool({
    description:
      "Get the canonical solution and occurrence history for a specific problem_key. " +
      "Returns the full problem entry plus all recorded occurrences (with outcomes: fixed, failed, workaround, observed). " +
      "Use this AFTER kb_search to get detailed context before implementing a fix.",
    args: {
      problem_key: tool.schema.string(),
      kind: tool.schema.string(),
    },
    async execute(args, _toolCtx) {
      const entry = db.getEntry(args.problem_key as string, args.kind as string);
      const occurrences = db.getOccurrences(args.problem_key as string, args.kind as string);
      const revisions = db.getRevisionHistory(args.problem_key as string, args.kind as string);
      return JSON.stringify({ entry, occurrences, revisions }, null, 2);
    },
  });

  const kbRecordOccurrence = tool({
    description:
      "Record a new occurrence of a known problem. Use this after a fix attempt to document the outcome. " +
      "CRITICAL: Always record outcome='failed' when a fix attempt does NOT work — this creates a bad_attempt record " +
      "that prevents the agent from repeating the same failed approach. " +
      "Record outcome='fixed' when a fix is confirmed working, and outcome='workaround' for temporary mitigations. " +
      "Include symptoms, project_ref, and commit_ref for traceability.",
    args: {
      problem_key: tool.schema.string(),
      kind: tool.schema.string(),
      project_ref: tool.schema.string().optional(),
      repo_ref: tool.schema.string().optional(),
      issue_ref: tool.schema.string().optional(),
      commit_ref: tool.schema.string().optional(),
      observed_symptoms: tool.schema.string().optional(),
      outcome: tool.schema.string().optional(),
    },
    async execute(args, _toolCtx) {
      const outcome = args.outcome as string | undefined;
      const validOutcomes = ["fixed", "failed", "workaround", "observed"];
      if (outcome && !validOutcomes.includes(outcome)) {
        return `Error: outcome must be one of: ${validOutcomes.join(", ")}`;
      }
      db.addOccurrence({
        entry_key: args.problem_key as string,
        kind: args.kind as string,
        project_ref: (args.project_ref as string) ?? null,
        repo_ref: (args.repo_ref as string) ?? null,
        issue_ref: (args.issue_ref as string) ?? null,
        commit_ref: (args.commit_ref as string) ?? null,
        observed_symptoms: (args.observed_symptoms as string) ?? null,
        outcome: outcome as
          | "fixed"
          | "failed"
          | "workaround"
          | "observed"
          | null,
      });
      logDebugEvent("plugin.record_occurrence", {
        problem_key: args.problem_key,
        kind: args.kind,
        outcome,
      });
      return `Occurrence recorded for ${args.problem_key}/${args.kind} (outcome: ${outcome ?? "observed"})`;
    },
  });

  const kbAddEntry = tool({
    description:
      "Add new knowledge entry. Supports all entity types. " +
      "CRITICAL: new entries always draft. " +
      "Provide entity_type for non-problem entries (pattern, convention, decision, observation, fix, summary). " +
      "If an entry with same entry_key+kind exists, overwrites only if new confidence is HIGHER (CONFIDENCE_GATE).",
    args: {
      entry_key: tool.schema.string(),
      kind: tool.schema.string(),
      title: tool.schema.string(),
      description: tool.schema.string().optional(),
      entity_type: tool.schema.string().optional(),
      root_cause: tool.schema.string().optional(),
      canonical_solution: tool.schema.string().optional(),
      tags: tool.schema.string().optional(),
      confidence: tool.schema.number().optional(),
      review_state: tool.schema.string().optional(),
      superseded_by: tool.schema.string().optional(),
    },
    async execute(args, _toolCtx) {
      try {
        db.addEntry({
          entry_key: args.entry_key as string,
          kind: args.kind as string,
          title: args.title as string,
          description: (args.description as string) ?? "",
          root_cause: (args.root_cause as string) ?? null,
          canonical_solution: (args.canonical_solution as string) ?? null,
          entity_type: ((args.entity_type as string) ?? "problem") as 'problem'|'pattern'|'convention'|'decision'|'observation'|'fix'|'summary',
          confidence: (args.confidence as number) ?? 0.0,
          review_state:
            ((args.review_state as string) as
              | "draft"
              | "reviewed"
              | "accepted"
              | "rejected"
              | "superseded") ?? "draft",
          superseded_by: (args.superseded_by as string) ?? null,
          tags: (args.tags as string) ?? "",
        });
        logDebugEvent("plugin.add_entry", {
          entry_key: args.entry_key,
          kind: args.kind,
          entity_type: args.entity_type ?? "problem",
        });
        return `Knowledge entry added: ${args.entry_key}/${args.kind}`;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error adding entry: ${msg}`;
      }
    },
  });

  const kbReviewEntry = tool({
    description:
      "Promote or reject a knowledge entry. Use this to change an entry's review_state. " +
      "Only promote entries that have been verified (CI green, smoke tests passed). " +
      "Allowed transitions: draft→reviewed, reviewed→accepted, any→rejected. " +
      "Terminal states (rejected, superseded) CANNOT be changed. " +
      "REGATE: cannot move backwards in review state (e.g., accepted→draft is blocked).",
    args: {
      problem_key: tool.schema.string(),
      kind: tool.schema.string(),
      review_state: tool.schema.string(),
      confidence: tool.schema.number().optional(),
    },
    async execute(args, _toolCtx) {
      try {
        const fields: Partial<
          Pick<
            KnowledgeEntry,
            | "confidence"
            | "title"
            | "root_cause"
            | "canonical_solution"
            | "review_state"
            | "tags"
          >
        > = {
          review_state: args.review_state as
            | "draft"
            | "reviewed"
            | "accepted"
            | "rejected"
            | "superseded",
        };
        if (args.confidence !== undefined) {
          fields.confidence = args.confidence as number;
        }
        db.updateEntry(
          args.problem_key as string,
          args.kind as string,
          fields,
        );
        logDebugEvent("plugin.review_entry", {
          problem_key: args.problem_key,
          kind: args.kind,
          new_state: args.review_state,
        });
        return `Knowledge entry ${args.problem_key}/${args.kind} → ${args.review_state}`;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error reviewing entry: ${msg}`;
      }
    },
  });

  const kbAutoCapture = tool({
    description:
      "Quick-add after completing work. Simplified kb_add_entry — no root_cause or canonical_solution needed. " +
      "AUTO-CAPTURE TRIGGERS: after fix→entity_type=fix, after decision→entity_type=decision, " +
      "after discovering pattern→entity_type=pattern, after major task→entity_type=summary, " +
      "after observation→entity_type=observation.",
    args: {
      entity_type: tool.schema.string(),
      title: tool.schema.string(),
      description: tool.schema.string(),
      kind: tool.schema.string().optional(),
      tags: tool.schema.string().optional(),
    },
    async execute(args, _toolCtx) {
      const entryKey = (args.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const entityType = args.entity_type as string;
      db.addEntry({
        entry_key: entryKey,
        kind: (args.kind as string) ?? '',
        title: args.title as string,
        description: (args.description as string) ?? '',
        root_cause: null,
        canonical_solution: null,
        entity_type: entityType as 'problem'|'pattern'|'convention'|'decision'|'observation'|'fix'|'summary',
        confidence: 0.0,
        review_state: 'draft',
        superseded_by: null,
        tags: (args.tags as string) ?? '',
      });
      return 'Captured: ' + entryKey + '/' + ((args.kind as string) ?? '') + ' (' + entityType + ')';
    },
  });

  const kbStats = tool({
    description:
      "Get knowledge store overview: total entries, by entity_type breakdown, accepted/draft counts, avg confidence.",
    args: {},
    async execute(_args, _toolCtx) {
      return JSON.stringify(db.getStats(), null, 2);
    },
  });

  const systemPrompt = (_ctx: any) => {
    return [
      "KNOWLEDGE PLUGIN — Structured Problem-Solution Store",
      "- kb_search: Universal search across all entity types (ALWAYS call this first)",
      "- kb_find_problem: Alias for kb_search filtered to problems (backward compat)",
      "- kb_get: Get full entry + occurrence history + revisions for a specific entry",
      "- kb_find_solution: Alias for kb_get (backward compat)",
      "- kb_record_occurrence: Record fix outcome (failed/fixed/workaround) — CRITICAL for avoiding repeated failures",
      "- kb_add_entry: Add new knowledge entry (ALWAYS as draft first)",
      "- kb_review_entry: Promote or reject knowledge entries",
      "- kb_auto_capture: Quick-add after completing work",
      "- kb_stats: Store overview",
      "RULES:",
      "  - Only use entries with review_state='accepted' AND confidence>=0.7 as trusted solutions",
      "  - Check bad_attempts (occurrences with outcome='failed') before attempting a fix",
      "  - New entries → draft only. Promoted after CI-green + smoke>=+2",
      "  - Confidence gate: higher-confidence entries can override lower ones",
    ].join("\n");
  };

  console.error(`[four-opencode-knowledge] ready`);
  logDebugEvent("plugin.ready", {});

  return {
    tool: {
      kb_search: kbSearch,
      kb_find_problem: kbFindProblemAlias,
      kb_get: kbGet,
      kb_find_solution: kbFindSolutionAlias,
      kb_record_occurrence: kbRecordOccurrence,
      kb_add_entry: kbAddEntry,
      kb_review_entry: kbReviewEntry,
      kb_auto_capture: kbAutoCapture,
      kb_stats: kbStats,
    },
    systemPrompt,
  };
};

export default FourOpenCodeKnowledgePlugin;
