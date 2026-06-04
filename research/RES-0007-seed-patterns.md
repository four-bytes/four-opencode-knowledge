# RES-0007: Seed Knowledge Candidates

**Date:** 2026-06-04
**Source:** Cross-repo analysis of four-opencode-*, four-infrastructure, dev-playground
**Status:** 15 candidates identified → ready for seed-initial.ts

---

## Universal (across all plugin repos)

### 1. dist-missing-after-clone

- **problem_key:** `dist-missing-after-clone`
- **kind:** `build`
- **problem:** After cloning any four-opencode-* plugin repo, `dist/` is gitignored and absent. `bun run build` is required before the plugin can be loaded by opencode. Agents (and humans) frequently waste time debugging "plugin not found" errors when the fix is simply `bun run build`.
- **root_cause:** `.gitignore` includes `dist/` to keep repos clean. The plugin loader reads from `dist/`, not `src/`. No post-clone hook or Makefile提醒 exists.
- **canonical_solution:** Always run `bun run build` after cloning. Consider a `Makefile` or `justfile` with a `setup` target: `bun install && bun run build`.

---

### 2. source-file-naming

- **problem_key:** `source-file-naming`
- **kind:** `convention`
- **problem:** All four-opencode-* plugins use `src/four-opencode-<pluginname>.ts` as the entry point. New agents (and developers) instinctively default to `src/index.ts`, which doesn't exist. This causes confusion and wasted tool calls.
- **root_cause:** Convention inherited from the monorepo structure. No AGENTS.md enforcement at plugin level for entry point naming.
- **canonical_solution:** Entry point is always `src/four-opencode-<name>.ts`. AGENTS.md in each plugin should state this explicitly. The `package.json` `main` field points to the compiled output.

---

## opencode Plugin API

### 3. phantom-event-hook

- **problem_key:** `phantom-event-hook`
- **kind:** `api-misunderstanding`
- **problem:** Agents attempt to register an `event` hook on the opencode Plugin-System. This hook does not exist. The plugin API supports `tool`, `command`, `chat`, and `provider` — but not `event`.
- **root_cause:** Agents infer hook names from context or hallucinate them. The opencode plugin docs don't list all available hooks prominently enough.
- **canonical_solution:** Available hooks: `tool` (intercept/extend tools), `command` (register slash commands), `chat` (modify chat messages), `provider` (extend LLM providers). No `event` hook exists.

---

### 4. compaction-signal-false-positive

- **problem_key:** `compaction-signal-false-positive`
- **kind:** `bug`
- **problem:** The compaction signal detector (`compaction_advice:` / `compaction_soon` / `compaction_now`) triggers on legitimate LLM output. When an LLM echoes system rules or discusses compaction strategies, the regex matches mid-text, producing 570+ false triggers in some sessions.
- **root_cause:** Regex-based detection without position awareness. The pattern `compaction_advice:` appears in LLM reasoning text, not just in structured signal blocks.
- **canonical_solution:** Gate detection on position (end-of-response only), require exact block format, or use XML/tag delimiters that LLMs won't echo. The signal block is defined in AGENTS.md as a structured comment at response end.

---

### 5. empty-assistant-message-after-strip

- **problem_key:** `empty-assistant-message-after-strip`
- **kind:** `bug`
- **problem:** After stripping/processing a compaction signal from an assistant message, the resulting text can be empty or whitespace-only. This empty message is then sent to the LLM API, which rejects it (most APIs require non-empty assistant turns).
- **root_cause:** The compaction signal can occupy the entire assistant message (especially when the LLM produces only the signal). Post-strip validation was missing.
- **canonical_solution:** After signal removal, check if the remaining text is empty/whitespace. If so, either: (a) remove the entire assistant turn from history, or (b) replace with a minimal placeholder like `[compaction applied]`.

---

## RAG Plugin

### 6. vec0-so-missing-after-clone

- **problem_key:** `vec0-so-missing-after-clone`
- **kind:** `build`
- **problem:** The `sqlite-vec` extension (`vec0.so`) is a native binary that must be compiled for the target platform. After cloning the RAG plugin repo, this binary is absent. Vector search silently degrades to FTS-only mode without error, leading agents to believe vector search is working when it's not.
- **root_cause:** Native extensions aren't committed to git. The `bun install` or build process compiles them, but there's no validation step that checks vec0.so exists.
- **canonical_solution:** Run the full build after clone. Add a startup check in the RAG plugin that logs a warning if `vec0.so` is missing. The plugin should explicitly state it's running in FTS-only mode.

---

### 7. rpc-timeout-too-short-ingest

- **problem_key:** `rpc-timeout-too-short-ingest`
- **kind:** `config`
- **problem:** The RPC timeout for the RAG ingest operation was hardcoded to 120 seconds. On large projects (100+ files), ingestion takes longer, causing false timeouts. The plugin reports failure even though the operation is still running server-side.
- **root_cause:** Hardcoded timeout value without considering project size. No adaptive or configurable timeout mechanism.
- **canonical_solution:** Make the ingest timeout configurable (default 300s). For very large projects (>500 files), consider async ingestion with progress callbacks. The timeout should scale with document count.

---

## Claude Provider

### 8. foreign-request-rejection-masquerade

- **problem_key:** `foreign-request-rejection-masquerade`
- **kind:** `config`
- **problem:** When the Claude provider plugin sends requests with an incorrect or missing `USER_AGENT` header, Anthropic's API returns a generic "foreign request" rejection. The error message doesn't clearly indicate the real cause (header mismatch), leading agents down the wrong debugging path.
- **root_cause:** The opencode Claude provider doesn't set the expected `USER_AGENT` format that Anthropic requires for partner integrations.
- **canonical_solution:** Ensure the `USER_AGENT` header matches Anthropic's expected format for the integration. The correct format is documented in Anthropic's partner integration guide.

---

### 9. local-plugin-pickup-delay

- **problem_key:** `local-plugin-pickup-delay`
- **kind:** `opencode-behavior`
- **problem:** After rebuilding a local plugin (`bun run build`), opencode continues to use the old cached version of `dist/`. A full restart of the opencode process is required — reloading the conversation or restarting the LSP is not sufficient.
- **root_cause:** opencode caches plugin modules in memory and doesn't watch `dist/` for changes. Module caching at the Bun/Node level means stale imports persist.
- **canonical_solution:** After plugin rebuild, fully restart the opencode process (kill + relaunch). There's no hot-reload for plugins. Document this clearly in plugin development guides.

---

## Infrastructure (four-infrastructure)

### 10. argocd-ksops-outofsync

- **problem_key:** `argocd-ksops-outofsync`
- **kind:** `argocd`
- **problem:** ArgoCD applications using ksops for secret decryption show perpetual `OutOfSync` status. The most common causes: missing `.ksops.yaml` configuration file or wrong kustomization pattern that doesn't reference the ksops generator correctly.
- **root_cause:** Kustomize overlay structure doesn't match ksops expectations. The `.ksops.yaml` file must be in the same directory as the `kustomization.yaml` that references secrets.
- **canonical_solution:** Ensure `.ksops.yaml` exists in the kustomization root. Verify `kustomization.yaml` includes the correct generators section. Use `kustomize build . | kubectl diff -f -` locally to validate before pushing.

---

### 11. hostport-deadlock

- **problem_key:** `hostport-deadlock`
- **kind:** `kubernetes`
- **problem:** Two distinct deadlock scenarios:
  1. `hostPort` + `RollingUpdate` strategy = deadlock during rollout (new pod can't bind the port until old pod releases it, but RollingUpdate waits for new pod to be ready)
  2. RWO (ReadWriteOnce) PersistentVolumeClaim + `maxSurge: 1` = deadlock (new pod needs the PVC but it's attached to the old pod, and RollingUpdate won't terminate old pod until new is ready)
- **root_cause:** Kubernetes scheduling constraints create circular dependencies. hostPort is exclusive per node; RWO PVCs are exclusive per node.
- **canonical_solution:**
  - **hostPort:** Use `hostNetwork: true` instead, or use a Service/Ingress to route traffic. Avoid hostPort in multi-replica deployments.
  - **RWO PVC:** Use `maxSurge: 0, maxUnavailable: 1` (RollingUpdate with delete-first), or switch to `Recreate` strategy, or use ReadWriteMany (RWX) storage.

---

### 12. reloader-arm-arch-tag

- **problem_key:** `reloader-arm-arch-tag`
- **kind:** `container`
- **problem:** The Stakater Reloader deployment uses a `-ubi` image tag which is built only for x86_64 architecture. On ARM64 clusters (Hetzner CAX nodes), the pod fails to start with `exec format error`.
- **root_cause:** The `-ubi` (Red Hat Universal Base Image) variant doesn't include ARM64 builds. The standard tag (without `-ubi`) supports multi-arch.
- **canonical_solution:** Remove the `-ubi` suffix from the reloader image tag. Use the default `stakater/reloader:<version>` tag which supports both amd64 and arm64.

---

### 13. dagu-ssl-client-zombies

- **problem_key:** `dagu-ssl-client-zombies`
- **kind:** `process`
- **problem:** Dagu scheduler runs commands that invoke BusyBox `ssl_client` (used by `wget`/`curl` for HTTPS). When `ssl_client` is spawned as a child of PID-1 in a container, it becomes a zombie process after completion because PID-1 doesn't reap children. Rate: ~96 zombies/day.
- **root_cause:** BusyBox's `ssl_client` doesn't properly handle its own lifecycle when run as a direct child of PID-1. The container's init process (PID-1) must explicitly wait() on children.
- **canonical_solution:** Add `tini` or `dumb-init` as the container's ENTRYPOINT to properly reap zombie processes. Alternatively, use `--init` flag if running with Docker Compose. For Kubernetes, ensure the pod uses `shareProcessNamespace: true` with a proper init container.

---

### 14. argocd-ignoreDifferences-empty-list

- **problem_key:** `argocd-ignoreDifferences-empty-list`
- **kind:** `argocd`
- **problem:** ArgoCD's `ignoreDifferences` configuration with an empty list `[]` is normalized to `null` by the API server. This effectively disables all difference ignoring, causing perpetual `OutOfSync` for resources where differences should be ignored.
- **root_cause:** Kubernetes API normalization: empty arrays `[]` become `null` in JSON round-trips. ArgoCD interprets `null` as "no ignore rules configured" rather than "empty ignore rules."
- **canonical_solution:** Never use `ignoreDifferences: []`. Either omit the field entirely (defaults to no ignore rules, same as `null`) or populate it with at least one entry. If you need to explicitly disable, use `ignoreDifferences: [{}]` or remove the field.

---

### 15. hetzner-gateway-dot-one

- **problem_key:** `hetzner-gateway-dot-one`
- **kind:** `networking`
- **problem:** Hetzner reserves the `.1` address (first usable IP) in each subnet as the gateway address. Assigning `.1` to a server or service causes routing failures and connectivity loss.
- **root_cause:** Hetzner Cloud networking convention: the first IP in each subnet's usable range is always the gateway. This isn't always documented prominently.
- **canonical_solution:** Never assign `x.x.x.1` to any resource. Start server IPs at `.2` or higher. Example: subnet `10.0.0.0/24` → gateway `10.0.0.1`, first usable `10.0.0.2`.

---

## Implementation Plan

| Step | Action |
|------|--------|
| 1 | Create `scripts/seed-initial.ts` importing `KnowledgeDb` from `@four-bytes/four-opencode-knowledge` |
| 2 | For each of the 15 entries above, call `kb_add_entry()` with full problem_key, kind, problem, root_cause, canonical_solution |
| 3 | All entries start as `review_state: 'draft'`, `confidence: 0.0` |
| 4 | Tags: `["seed", "v1"]` |
| 5 | Run: `bun run scripts/seed-initial.ts` |
| 6 | Verify: `kb_find_problem("dist-missing-after-clone")` returns the entry |
| 7 | Promote after manual review: `kb_review_entry("...", "accepted", 0.8)` |
| 8 | Issue: #7 |
