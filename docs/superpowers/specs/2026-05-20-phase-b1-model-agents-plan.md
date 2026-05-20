# Execution Plan — Phase B1: Model-side agents on a wrapped Microsoft-MCP architecture

> Companion to `2026-05-18-pbi-architecture-design.md` (the v6 design). Supersedes the earlier hook-based B1 draft. This is the approved plan (2026-05-20).

## Context

The v6 redesign splits the model side into three focused workers — **plan / write / review**. The original B1 plan gated them with PreToolUse **hooks + prompt protocols**, because we believed (Codex review #2) that an MCP server cannot call another MCP's tools, so a checked-write wrapper was infeasible.

**That assumption was wrong.** A working reference repo proves the Microsoft modeling MCP can be **wrapped**: spawn it as our server's **own child subprocess** (`@modelcontextprotocol/sdk` stdio Client) and call it from code. It is not a peer Claude routes to — it's an internal dependency. We committed to this architecture because it makes the gates **real (in-code)** instead of hook/prompt-level, which is the entire point of this sprint.

Foundation (Phase A) is implemented but uncommitted on branch `architecture` (last commit "phase 8"). Wrapping **supersedes** Phase A's modeling hooks + sidecars (they were workarounds); the reusable engine bits stay.

## What wrapping changes (vs the hook-based plan)

| Concern | Hook-based (old) | Wrapped (new) |
|---|---|---|
| MS MCP access | Registered as a **peer** in `.mcp.json`; agents call it directly | Spawned as **our server's child subprocess**; agents never see it |
| DAX-ref gate | `gate-measure-create` PreToolUse hook | **In code** inside our `pbi_measure_create` tool — refuses before calling MS MCP |
| Analyst read-only | `gate-data-analyst-readonly` hook (agent_type allowlist) | **Tool-surface restriction** — analyst's frontmatter lists read tools only; it has no write tool to call |
| In-batch deps | `uncommitted-measures.json` sidecar (hook can't see live model) | **Query the live MS MCP session directly** (`measure_operations List`) — our tool runs in-process and holds the connection |
| Connection state | `connection.json` sidecar | **In-process** connection state in the model-driver |
| Request shaping | Agent constructs `{request:{operation,…}}` (fragile) | **Our code** constructs it (deterministic) |
| Connection logic | Agent runs a "connect recipe" (LLM-driven) | **In code** (`ensureConnection`: discover → connect → reconnect) |

Net: the read-only hook and the gate-measure-create hook **go away**, replaced by code. The two sidecars **go away**. Fewer moving parts, stronger guarantees.

## Proven facts from the reference repo (grounding the build)

- **Connect:** `connection_operations` op `"Connect"` with a `connectionString` (`Data Source=localhost:<port>;…`); discover via `ListLocalInstances`. Port is **dynamic per Desktop launch** → discover the single instance or pin via env `PBI_..._CONNECTION_STRING`. (`GetLastUsed` is the lean-mode fallback.)
- **Create measure:** `measure_operations` op `"Create"`, `{ definitions: [{ tableName, name, expression, formatString, description? }] }`. Update→`{definitions}`, Rename→`{renameDefinitions}`, Move→`{moveDefinitions}`, Delete→`{references, shouldCascadeDelete}`.
- **Request envelope:** every call is `{ request: { operation, ...params } }`; for `List`, params go under `request.filter`. Discriminator is `request.operation`.
- **Reads we need:** `table_operations/List`, `column_operations/List`, `measure_operations/List`, `relationship_operations/List`, `dax_query_operations/Execute`.
- **Persistence:** the reference repo has **no commit call** — live edits sit in the in-memory model; **Ctrl+S in Desktop persists** (must verify MS doesn't auto-commit via a save+reload test). Folder mode persists via `database_operations/ExportToTmdlFolder`.
- **No restart needed** — live edits are visible immediately through the same connection.
- **Platform/bridge:** MS MCP is a **Windows `.exe`**. From Mac, spawn it into the VM: a bash script runs `prlctl exec "$VM" --current-user "C:\\…\\powerbi-modeling-mcp.exe" --start --skipconfirmation`; our server's spawn config points at that script. On Windows-native, spawn `npx -y @microsoft/powerbi-modeling-mcp --start` directly.
- **Lifecycle:** lazy singleton subprocess + one Client, reused across calls; re-spawn on transport close; reconnect-on-reachability-error fallback (stale port / Desktop closed mid-session). Connection-string secrets redacted from errors.

## Constraints

- `pbi-` prefix on all agents/skills.
- Dataset-agnostic in committed artifacts: `FactPrimary`, `FactSecondary`, `DimShared`, `ValueMetric`, `PlanMetric`, `SharedAxis`. Live manual testing may use real field names.
- Shadow purity: do not edit existing agents (`pbi-data-architect`, `pbi-model-doctor`, …) or existing skills.
- Pin the Microsoft MCP package version in our config (reference repo didn't — we will).

## Defaulted sub-decisions (flag if you disagree)

1. **Auto-detect mode:** live (single discovered instance) → folder fallback (`ConnectFolder`) when no Desktop.
2. **Single gated `pbi_measure_create`** (in-code DAX gate), builder loops — batch variant deferred.
3. **`pbi_model_check` reads the live model** (via the driver's List ops) when connected live, not stale disk TMDL.
4. **Wrapper lives in `packages/core/src/model-bridge/`**, surfaced through `packages/mcp`.

---

## Sub-phases

### B-1 — Commit Phase A, triage stray files
Commit the Phase A foundation as history (tests + coherent). Triage `AGENTS.md`, `CLAUDE.md`, `docs/progress-updates/`, `docs/superpowers/` as separate "docs:" commits. Note in the commit body that the modeling hooks + sidecars will be superseded by the wrapper (W5). Clean tree. Branch `feat/v6-b1-wrapped-model`.

### B0 — Manifest (5 min)
`.claude-plugin/plugin.json`: clean description (no rotting counts); bump `version` → `0.4.0`. Keep `"hooks": "./hooks/hooks.json"` (report-side validate hook still lives there; modeling hooks removed in W5).

### W1 — MS MCP client (spawn + connect + lifecycle)
`packages/core/src/model-bridge/ms-mcp-client.ts` (new) — adapt the reference `ms-mcp-client.ts`: lazy singleton spawning the MS MCP via `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport`; spawn config from env (default `npx -y @microsoft/powerbi-modeling-mcp@<pinned> --start`; bridge override for Parallels `prlctl`); re-spawn on `transport.onclose/onerror`. Unit tests with a mock child.

`scripts/pbi-mcp-bridge.sh` (new) — `prlctl exec "$PBI_VM_NAME" --current-user "$EXE_PATH" --start --skipconfirmation`. Env: `PBI_VM_NAME`, `EXE_PATH`. Windows-native skips the bridge.

### W2 — Model driver (connection + reads + measure writes)
`packages/core/src/model-bridge/model-driver.ts` (new) — focused subset of the reference `model-driver.ts`:
- `callOperation(client, tool, operation, params)` → `{ request: { operation, ...(operation==="List" ? {filter:params} : params) } }`.
- `ensureConnection()` (auto-detect): env `PBI_..._CONNECTION_STRING` pin → else `ListLocalInstances` (require exactly one, else throw clear "set the env var") → else `ConnectFolder(path)` headless. Cache; invalidate on env change; reconnect on reachability error. Redact connection-string secrets from errors.
- Reads: `listTables/Columns/Measures/Relationships`, `daxQuery(Execute)`.
- Writes: `createMeasure`, `updateMeasure`, `deleteMeasure` (Rename/Move deferred).
- Persistence: `exportToTmdlFolder()` (folder); live returns a "persist via Ctrl+S" signal.
- Unit tests with mocked MS MCP responses (loose-key connection-string extraction; log the real `ListLocalInstances` payload once on Windows and tighten).

### W3 — Expose our model tools; drop the peer MCP
`packages/mcp/src/server.ts` (edit) — register inline via the `tool()` helper (line 86):
- **Read tools:** `pbi_model_list_tables`, `pbi_model_list_columns`, `pbi_model_list_measures`, `pbi_model_list_relationships`, `pbi_dax_query`, `pbi_model_check`, `pbi_dax_reference_check`, `pbi_spec_validate`.
- **Write tools (builder only):** `pbi_measure_create`, `pbi_measure_update`, `pbi_measure_delete`, `pbi_model_export`.
- `pbi_model_check` consumes the driver's live List output when live; falls back to TMDL-parser-on-disk in folder mode.

`.mcp.json` (edit) — **remove** the `powerbi-modeling` peer entry; add the spawn-config env (`PBI_..._MS_MCP_COMMAND/_ARGS`, pinned version) to our server's entry.

### W4 — In-code gates
- **`pbi_measure_create` gate (HARD, in code):** before creating, run `daxReferenceCheck` (Phase A lib) against the **current live model** (driver `listMeasures/listColumns`) + the proposed expression. Missing/ambiguous → structured error, **no MS MCP call**. Real replacement for `gate-measure-create`.
- **Bridge annotations:** if the MS MCP measure definition can't carry custom annotations (verify), fall back to folder-mode TMDL on export; document the gap.
- **`pbi_spec_validate`** stays the builder's required first step. Future: `pbi_measures_apply(spec)` batch tool = true producer/consumer gate (deferred).

### W5 — Retire obsolete hooks + sidecars
Remove `gate-measure-create.mjs`, the three sidecar PostToolUse hooks, and `sidecar/*.json` machinery — superseded by the wrapper. Keep the report-side PostToolUse validate hook. Update `hooks/hooks.json`. Keep `daxReferenceCheck` + TMDL-parser libs (now in-code). One "superseded by wrapper" commit.

### B1a — Spec schemas
`packages/core/src/types/spec.ts` + zod (`^3.23.8`) + `pbi_spec_validate`. Guards: measure-FieldRef rejects `aggregation`; bridge all-or-none + `bridgeCovers` columns-only; `QuestionSpec.axis: FieldRef`, `measures: measure-kind FieldRef[]`; `needs-user-input` requires clarifyingQuestions, `blocked` requires blockers. Sub-types hand-defined from v6 build trace — **pause for user review** before agents. Synthetic tests only.

### B1b — Two contract skills (before agents)
`skills/pbi-modeling-contracts/SKILL.md` + `skills/pbi-tmdl-conventions/SKILL.md` — document the **wrapped tool surface** (read vs write), connect/auto-detect behavior, live-vs-folder persistence, bridge metadata rules, spec contract. Reuse `pbi-date-intelligence`. Synthetic names only.

### B1c — Three model-side agents (read/write tool-surface split)
- `pbi-data-analyst` (read-only **by tool surface**): Read + read tools only. No write tool → cannot write. Returns a `DashboardSpec`.
- `pbi-model-builder` (writes): read + write tools. Required protocol: `pbi_spec_validate` first; refuse on invalid. Measure-only (`missingDims` → hand-off note). Mode-aware persistence.
- `pbi-model-reviewer` (read-only): Read + `pbi_model_check`.

`skills:` preload `pbi-modeling-contracts`, `pbi-tmdl-conventions`, `pbi-date-intelligence` on analyst + builder.

### B1d — Manifest registration + verification
Append the three agents to `.claude-plugin/plugin.json`. Run verification.

---

## Verification

**Mac (unit, no Desktop):**
1. `pnpm -r build` clean.
2. `pnpm -F pbi-core test` — `ms-mcp-client` (mock child), `model-driver` (mock responses), in-code DAX gate (bad ref → refuse), spec schemas (all branches). Synthetic fixtures.
3. `pnpm biome check` new files.
4. `claude plugin validate <repo>`.
5. Dataset-agnostic audit (broadened terms) → zero domain leaks.

**Parallels Windows (integration, Desktop open):**
6. **Connect:** dev `.pbip` open → discover single instance + connect; `pbi_model_list_tables` returns the real model.
7. **In-code gate:** `pbi_measure_create` with `[NonExistentMeasure]*2` → refused in code, no MS MCP call.
8. **Live create:** valid measure → appears in Desktop Fields pane **without restart**; Ctrl+S → reload confirms persistence (and whether MS auto-committed).
9. **In-batch dep:** create B referencing A same batch → gate sees A via live List, no false-block.
10. **Analyst can't write:** no write tool available in a `pbi-data-analyst` session.
11. **Routing:** "plan a dashboard…" → analyst returns spec; "create the measures" → builder validates + creates + persists per mode.
12. **Reconnect:** close Desktop mid-session → clear error + recovery.

---

## Boundary classification (now mostly hard, in code)

| Mechanism | Type | Enforced by |
|---|---|---|
| Analyst cannot write | **Hard** | tool surface — no write tool in frontmatter |
| No measure with missing/ambiguous DAX refs | **Hard (code)** | in-code `daxReferenceCheck` inside `pbi_measure_create` |
| Builder is measure-only | **Hard** | tool surface — no table/relationship write tools |
| Connection / instance selection | **Hard (code)** | `ensureConnection` in the driver |
| Spec invariants (bridge/aggregation/status) | **Hard (at validation)** | `DashboardSpecSchema` via `pbi_spec_validate` |
| Builder validates spec before writing | **Required protocol (prompt)** | builder body — until a `pbi_measures_apply(spec)` batch tool (deferred) |
| Live persistence | **User action** | Ctrl+S (live) / `pbi_model_export` (folder) |

---

## Out of scope (deferred)
- `pbi_measures_apply(spec)` batch tool (hard producer gate).
- `RelationshipSpec` + table/relationship/dim building.
- Report-side consolidation, pipeline skills, routing fixtures, decommission of old agents.
- `pbi-dax-patterns` skill.
- Full reconnect/error-redaction parity beyond B1 needs.

## Open items to confirm on Windows
- Exact `ListLocalInstances` payload shape (log once, tighten).
- Whether the MS MCP measure definition accepts **custom annotations** (bridge metadata) — else via folder TMDL on export.
- Whether the MS MCP **auto-commits** to the .pbip or Ctrl+S is required.

## Effort

| Sub-phase | Effort |
|---|---|
| B-1 commit + triage | 20 min |
| B0 manifest | 5 min |
| W1 MS MCP client + tests | 0.5 day |
| W2 model driver + tests | 1.5 day |
| W3 tools + drop peer + bridge | 0.5 day |
| W4 in-code gates | 0.5 day |
| W5 retire hooks/sidecars | 0.25 day |
| B1a spec schemas + review | 0.5 day |
| B1b two skills | 0.5 day |
| B1c three agents | 0.5 day |
| B1d manifest + verification | 0.5 day |
| **Total** | **~5.5–6 days** |

## First step
B-1 (commit Phase A on Mac, clean tree) → B0 → **W1→W5 (the wrapper)** → B1a (pause for sub-type review) → B1b → B1c → B1d. Wrapper built/unit-tested on Mac; live integration (Steps 6–12) in Parallels with Desktop open.
