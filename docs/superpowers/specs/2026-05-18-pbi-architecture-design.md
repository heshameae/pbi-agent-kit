# pbi-mcp-ts Architecture Redesign

**Status:** Draft (v6 — third Codex review applied; hook schema + sidecar registry) · **Date:** 2026-05-18 · **Owner:** Hesham Eissa

Plugin-first Claude Code design: 5 worker agents + 4 pipeline skills + 13 shared-knowledge skills (small contracts + `references/*.md`) + 10 thin CRUD skills. Real determinism via PreToolUse hooks that read a sidecar connection registry and validate input against disk + in-batch state — not via MCP-to-MCP proxies (which Claude Code doesn't support) and not via input-filtered permission rules (which the schema doesn't allow).

---

## Layer ownership

| Layer | Job | What we put here |
|---|---|---|
| **Skills** | Routing (auto-trigger by description) + pipeline recipes | 4 pipeline skills + 13 shared-knowledge skills + 10 thin CRUD skills |
| **Agents** | Specialist reasoning in isolated context | 5 worker agents (data-analyst + 2×2 grid) |
| **MCP tools** | Deterministic read/write/validate actions | 47 existing tools + `pbi_dax_reference_check` (new) + `pbi_visual_bind` annotation-aware (modified) |
| **Hooks** | Enforcement around tool use; refusal at the Claude Code layer | PreToolUse `gate-measure-create` + PostToolUse sidecar updaters + PostToolUse PBIR validator + 3 safety hooks |
| **Sidecar registry** | In-batch state the hook needs to validate against | `~/.pbi-mcp-ts/sidecar/{connection,uncommitted-measures}.json` |

If a behaviour MUST be true, it lives in MCP tools or hooks. Skills/agents handle reasoning and recipe.

---

## Components

### Worker agents (5)

```
                  PLANNER          BUILDER          REVIEWER
              ┌─────────────┬───────────────┬──────────────────┐
   MODEL      │             │ model-builder │ model-reviewer   │
              │ data-analyst├───────────────┼──────────────────┤
   REPORT     │ (cross-cut) │ report-builder│ report-reviewer  │
              └─────────────┴───────────────┴──────────────────┘
```

`data-analyst` (planning) · `model-builder` (model writes; calls Microsoft MCP directly — hook gates the dangerous tool) · `model-reviewer` (BPA + grain + relationships, read-only) · `report-builder` (one invocation per page, sequential) · `report-reviewer` (categorized findings, read-only).

### Pipeline skills (4)

`pbi-build` · `pbi-modify` · `pbi-fix-model` · `pbi-audit`. Each has a crafted `description:` for auto-trigger and creates a `/pbi-build` etc. invocation path automatically.

### Shared-knowledge skills (13 — tiny contracts + `references/*.md`)

`tmdl-conventions` · `dax-patterns` · `bi-pattern-library` · `audience-styles` · `layout-patterns` · `theme-cascade` · `kpi-design-rules` · `table-design-rules` · `svg-dax-patterns` · `m-query-patterns` · `rls-patterns` · `calc-group-patterns` · `ai-readiness`

### Thin CRUD skills (10)

`pbi-report` · `pbi-pages` · `pbi-visuals` · `pbi-themes` · `pbi-filters` · `pbi-bookmarks` · `pbi-layout` · `pbi-setup` · `pbi-status` · `pbi-validate`

### MCP tools

**New in v1:**

| Tool | Behavior |
|---|---|
| `pbi_dax_reference_check` | Extracts model references lexically from a DAX expression: token-level scan for `'Table'[Column]` and `[Measure]` patterns, ignores content inside comments / string literals. Verifies each reference against a passed-in `TMDLModel` snapshot. **Fails closed** on unsupported / ambiguous cases (bare `[X]` where multiple measures share the name). Returns `{ valid, missing[], ambiguous[] }`. The hook (below) imports this function from `pbi-core` directly. |

**Modified in v1:**

| Tool | Change |
|---|---|
| `pbi_visual_bind` | Reads `pbi_bridge_from`, `pbi_bridge_to`, `pbi_bridge_via`, `pbi_bridge_covers` annotations from the bound measure's TMDL. Refuses bind when: visual axis FieldRef not in `pbi_bridge_covers` OR no active filter path from visual scope to `pbi_bridge_from`. |
| `pbi_model_check` | Strict mode that throws on errors. |

**Not built:**

- No `pbi_measure_create_safe` MCP wrapper — MCP servers cannot invoke peer MCP tools.

---

## Sidecar registry

Tiny JSON files under `~/.pbi-mcp-ts/sidecar/` (or `${CLAUDE_PROJECT_DIR}/.pbi-mcp-ts/sidecar/` if project-scoped is preferred):

### `connection.json` — current modeling connection

```json
{
  "connectionName": "Demo",
  "folderPath": "/Users/.../Demo.SemanticModel/definition",
  "connectedAt": "2026-05-19T10:30:00Z"
}
```

Written by PostToolUse hook on `connection_operations(operation=ConnectFolder)`. The hook reads the tool's input + result, resolves the folder path, writes this file.

### `uncommitted-measures.json` — in-batch state

```json
{
  "measures": [
    { "table": "Orders", "name": "Sales YoY%", "createdAt": "..." }
  ]
}
```

Written by PostToolUse hook on `measure_operations(operation=Create)` when the Create succeeds. **Cleared** by PostToolUse hook on `database_operations(operation=ExportToTmdlFolder)` (after Export, disk reflects all measures, sidecar no longer needed).

Why we need this: Microsoft's modeling MCP writes are session/in-memory until Export. If measure B references measure A created earlier in the same batch, disk doesn't have A yet. The PreToolUse hook merges disk TMDL + this sidecar to know what exists in the working set.

---

## Hooks (the actual enforcement boundary)

### `gate-measure-create` — PreToolUse, the most important new hook

Full `hooks/hooks.json` shape (event wrapper required):

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__powerbi-modeling__measure_operations",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/gate-measure-create.mjs\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "mcp__powerbi-modeling__connection_operations",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/update-connection-sidecar.mjs\"" }]
      },
      {
        "matcher": "mcp__powerbi-modeling__measure_operations",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/track-uncommitted-measure.mjs\"" }]
      },
      {
        "matcher": "mcp__powerbi-modeling__database_operations",
        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/clear-uncommitted-on-export.mjs\"" }]
      }
    ]
  }
}
```

**No `"blocking": true`** (not a valid field). Refusal mechanics:
- **Exit code 2 + stderr** → Claude Code blocks the tool call and surfaces stderr to the user.
- **Or exit 0 + JSON to stdout** with `{ "permissionDecision": "deny", "permissionDecisionReason": "..." }`.

Hook script (`hooks/scripts/gate-measure-create.mjs`):

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseTMDLFolder, daxReferenceCheck } from "pbi-core";

const input = JSON.parse(readFileSync(0, "utf8"));
const args = input.tool_input ?? {};
if (args.operation !== "Create") process.exit(0);          // only gate Create

const sidecarRoot = process.env.HOME + "/.pbi-mcp-ts/sidecar";
const conn = JSON.parse(readFileSync(`${sidecarRoot}/connection.json`, "utf8"));
const uncommitted = JSON.parse(readFileSync(`${sidecarRoot}/uncommitted-measures.json`, "utf8"));

const model = parseTMDLFolder(conn.folderPath);             // imports pbi-core directly
const augmented = { ...model, measures: [...model.measures, ...uncommitted.measures] };

const result = daxReferenceCheck(args.expression, augmented);
if (!result.valid) {
  process.stderr.write(JSON.stringify({
    decision: "deny",
    reason: `Missing references: ${result.missing.map(r => `${r.table}[${r.column}]`).join(", ")}`,
    ambiguous: result.ambiguous,
  }, null, 2));
  process.exit(2);
}
process.exit(0);
```

Key points:
- **Imports `pbi-core` library directly** (not via MCP). Same reference-check logic as the MCP tool; one source of truth.
- **Reads sidecar registry** for connection path and in-batch measures. No assumption that `measure_operations` input carries a folder path (it doesn't — it carries `connectionName`).
- **Fails closed**: missing sidecar files mean we cannot verify → refuse.

### Other hooks

| Hook | Type | Purpose |
|---|---|---|
| `update-connection-sidecar` | PostToolUse on `connection_operations(ConnectFolder)` | Writes `connection.json` |
| `track-uncommitted-measure` | PostToolUse on `measure_operations(Create)` | Appends to `uncommitted-measures.json` |
| `clear-uncommitted-on-export` | PostToolUse on `database_operations(ExportToTmdlFolder)` | Clears `uncommitted-measures.json` |
| `pbir-validator` (existing) | PostToolUse on PBIR writes | Unchanged |
| `block-destructive-commands` | PreToolUse on Bash | `rm -rf`, `git push --force`, etc. |
| `block-secrets-exposure` | PreToolUse on Bash + Read | `.env`, `printenv`, `az account get-access-token` |
| `block-pnpm-discipline` | PreToolUse on Bash | `npm install`, `yarn add` |

Plus `hooks/config.yaml` with master kill-switch + per-check toggles.

**`plugin.json` declaration (Codex finding 6):**

```jsonc
{
  "name": "pbi-mcp-ts",
  "skills": "./skills/",
  "agents": [ ... ],
  "hooks": "./hooks/hooks.json",                 // ← add this
  "mcpServers": "./.mcp.json"
}
```

---

## BPA expansion in v1 (3 net-new rules)

Unchanged from v5: `DAX_FILTER_TABLE_COLUMN_EQUALITY`, `DAX_EVALUATEANDLOG_IN_PRODUCTION`, `DAX_AVOID_1_MINUS_X_OVER_Y`. Total v1 BPA: 18 rules.

5 parser-requiring rules deferred to v1.1.

---

## Spec contract

```ts
interface DashboardSpec {
  status: "ready" | "needs-user-input" | "blocked";
  intent: string;
  audience: "exec" | "analyst" | "ops" | "unspecified";
  dateRange: string;
  modelPath: string;
  reportPath: string;
  pages: PageSpec[];
  missingMeasures: MeasureSpec[];
  missingDims: DimSpec[];
  userDecisions: UserDecision[];
  clarifyingQuestions?: ClarifyingQuestion[];
  blockers?: Blocker[];
}

interface FieldRef {
  table: string;
  column: string;
  kind: "measure" | "column";
  aggregation?: "sum" | "avg" | "count" | "min" | "max";
  isHidden: boolean;
}

interface MeasureSpec {
  table: string;
  name: string;
  expression: string;
  formatString: string;
  description?: string;
  // Bridge metadata — written as TMDL annotations on the measure
  bridgeFrom?: string;          // filter source table — must match visual axis context
  bridgeTo?: string;            // value source table — what the CALCULATE sums
  bridgeVia?: "TREATAS" | "USERELATIONSHIP";
  bridgeCovers?: FieldRef[];    // FieldRefs (table-qualified) that propagate the filter
}

interface DimSpec {
  name: string;
  keyColumn: string;
  sourceColumns: FieldRef[];
  attributeColumns?: FieldRef[];
}

// (PageSpec, QuestionSpec, ClarifyingQuestion, UserDecision, Blocker unchanged from v5)
```

Validated at agent boundaries via zod.

---

## Bridge metadata in TMDL

Bridged measures carry **four annotations** (Codex finding 5 — `bridge_from` + `bridge_to` is correct, replaces single `bridge_source`):

```tmdl
measure 'Sales Target' = CALCULATE ( SUM ( Targets[Sales Target] ), TREATAS (...) )
    formatString: \$#,0;(\$#,0);\$#,0
    annotation pbi_bridge_from = Actuals
    annotation pbi_bridge_to = Targets
    annotation pbi_bridge_via = TREATAS
    annotation pbi_bridge_covers = "[\"Actuals[Category]\",\"Actuals[Segment]\",\"Actuals[Order Date]\"]"
```

`pbi_visual_bind` enforces:
1. Visual axis FieldRef must be in `pbi_bridge_covers`.
2. The visual axis must either be a column on `pbi_bridge_from` directly, OR be related to `pbi_bridge_from` via an active relationship path on a column in `pbi_bridge_covers`. (TREATAS reads `VALUES(<bridge_from>[<col>])` — if the visual axis can't filter `bridge_from`, TREATAS picks up nothing and the bridged measure returns the unfiltered total.) **No filter path to `pbi_bridge_to` is required or expected** — that's the whole point of TREATAS, it bypasses physical relationships to the target.

**Phase 1 must add annotation extraction to `packages/core/src/modeling/tmdl-parser.ts`** — current parser skips annotation lines.

---

## Build pipeline trace

**Input:** "make me a sales dashboard with YoY by region"

1. **Routing.** Skill auto-trigger picks `pbi-build`.
2. **Plan.** `data-analyst` returns `{ status: "needs-user-input", clarifyingQuestions: [...] }`. Main Claude asks user. Re-invokes with `userDecisions[]`. Analyst returns `{ status: "ready" }`.
3. **Model work.** `model-builder` invoked. For each measure in `spec.missingMeasures`:
   - `model-builder` calls `mcp__powerbi-modeling__measure_operations(operation=Create, ...)`.
   - **PreToolUse `gate-measure-create` hook fires.** Reads sidecar `connection.json` + `uncommitted-measures.json`. Builds augmented model snapshot. Runs `daxReferenceCheck` from `pbi-core`. If invalid → exit 2 with structured error. If valid → exit 0, modeling MCP creates the measure.
   - **PostToolUse `track-uncommitted-measure` hook fires.** Appends the new measure to `uncommitted-measures.json` for the rest of the batch.
   - At batch end, `model-builder` calls `database_operations(operation=ExportToTmdlFolder)`. **PostToolUse `clear-uncommitted-on-export` hook fires** and empties the sidecar.
   - Bridged measures get `pbi_bridge_from`, `pbi_bridge_to`, `pbi_bridge_via`, `pbi_bridge_covers` annotations.
4. **Report work** (sequential per page). Each `pbi_visual_bind` checks bridge annotations + filter-path validity.
5. **Review** (parallel). `model-reviewer` ∥ `report-reviewer`.
6. **Summary.**

---

## Hard gates (real ones — code refuses)

- **`gate-measure-create` PreToolUse hook** intercepts `mcp__powerbi-modeling__measure_operations` Create calls. Imports `pbi-core` library directly (not MCP-to-MCP). Reads sidecar registry for connection + in-batch state. Refuses via exit 2 + stderr on missing/ambiguous references.
- **`pbi_visual_bind` refuses unsafe binds.** Reads TMDL annotations (`pbi_bridge_from`/`_to`/`_via`/`_covers`). Refuses on axis not in covers OR no active filter path to `pbi_bridge_from`.
- **`pbi_model_check` strict mode throws on errors.**
- **PreToolUse safety hooks** block destructive shell + secrets.

Soft (recipe-level):

- `data-analyst` returns `status: "needs-user-input"` to halt. Contract enforced by zod at agent boundary, not by tool refusal.

---

## Migration

### Renamed / absorbed

(Unchanged from v5: `pbi-data-architect` → `model-builder` + `data-analyst`; `pbi-model-doctor` → `model-reviewer`; `pbi-bind-doctor` + `pbi-report-validator` + `pbi-report-reviewer` → `report-reviewer`; `pbi-designer` split; `pbi-bulk-operator` → `report-builder`; 4 scaffolds → internal recipes; `pbi-init-config` → `pbi-setup`.)

### New

`data-analyst` agent · 4 pipeline skills · 13 shared knowledge skills · `pbi_dax_reference_check` MCP tool · **`gate-measure-create` PreToolUse hook** + script · **3 sidecar-management PostToolUse hooks** + scripts · **`packages/core/src/modeling/tmdl-parser.ts` annotation extraction** · 3 new BPA rules · 3 safety hooks + config.yaml · **`plugin.json` `hooks` declaration**

### Unchanged

47 existing MCP tools · `packages/core/` engine (plus annotation parsing) · existing PostToolUse PBIR validator · Microsoft modeling MCP integration · 500+ existing tests · 15 existing BPA rules

### Phase order

1. **Hard gates first.** 
   - Add annotation parsing to TMDL parser (without this, downstream gates can't read bridge annotations).
   - Add `pbi_dax_reference_check` MCP tool + export the same function from `pbi-core` so the hook can import it.
   - Build `gate-measure-create.mjs` + sidecar reader/writers.
   - Build 3 sidecar-management PostToolUse hook scripts.
   - Modify `pbi_visual_bind` to read TMDL annotations + verify filter path.
   - Update `plugin.json` to declare `"hooks": "./hooks/hooks.json"`.
   - Tests: every hook gets a fixture-based test (mock the tool input shape, verify exit code).
2. **Foundation.** Create new agents (with `skills:` frontmatter) + 13 small shared SKILL.md files + their `references/` folders. Old agents stay active in parallel — **safe because the hook is in place globally**.
3. **Pipelines.** 4 skills with crafted descriptions. ~50-prompt routing fixture.
4. **BPA expansion.** 3 new rules.
5. **Safety hooks.** 3 hooks + config.yaml + README.
6. **Decommission.** Remove old agents + scaffolds.
7. **Verify.** Corrupted-dashboard scenario; dataset-agnostic audit; full test suite.

---

## Deferred to v1.1 / Phase 9+

- TMDL parser expansion + 5 parser-requiring BPA rules.
- DAX dependency graph + 5 graph-requiring rules.
- Desktop integration (`desktop-runner` subagent + 3 MCP tools).
- Fabric integration (Phase 9+).
- 3-plugin split.

---

## Open questions for `writing-plans`

1. Sidecar registry location — `~/.pbi-mcp-ts/sidecar/` (global) vs `${CLAUDE_PROJECT_DIR}/.pbi-mcp-ts/sidecar/` (project-scoped)? Project-scoped wins for isolation; global wins if user works across multiple .pbip simultaneously. Lean project-scoped.
2. Per-Create-then-Export vs lazy-Export-once-at-batch-end? The sidecar makes lazy possible. Default lazy; document that any agent that wants real disk persistence calls Export explicitly.
3. Hook concurrency — what if two `measure_operations` Create calls fire in parallel (unlikely in current flow, possible in future parallel pipelines)? File-lock the sidecar writes.
4. Pipeline skill description specificity — calibrate against ~50-prompt fixture.
5. Modify pipeline's "light analyst" — when to skip clarifying questions.
6. Audit pipeline default scope — current page vs full report.

---

## Success criteria

- Corrupted-dashboard scenario produces correct output: no fabricated `Profit Target`; bridged measures never bound on blocked axes; data-analyst returns `status: "needs-user-input"`.
- `gate-measure-create` hook refuses 100% of fabricated-reference Create attempts in fixtures.
- `pbi_visual_bind` refuses 100% of binds where axis not in covers OR filter path missing.
- Sidecar registry correctly tracks in-batch measures (validated by a multi-measure batch test: B references A, both created before Export, hook validates B against augmented snapshot).
- Pipeline skill descriptions auto-trigger correctly on 90%+ of a 50-phrase fixture.
- 18 BPA rules pass test fixtures.
- 3 safety hooks block targets in fixtures.
- TMDL parser correctly extracts `pbi_bridge_*` annotations.
- All 500+ existing tests pass; new tests cover the MCP tool, hook scripts (exit-code mocking), sidecar reader/writer, annotation parsing, 3 new BPA rules.

---

## References

- `feedback_pbi_shared_dim_first.md` · `feedback_pbi_dashboard_three_silent_failures.md` · `feedback_no_dataset_hardcoding.md` · `feedback_claude_code_mcp_constraints.md` · `feedback_claude_code_plugin_manifest.md`
- [Anthropic hooks](https://code.claude.com/docs/en/hooks) · [plugins reference](https://code.claude.com/docs/en/plugins-reference) · [permissions](https://code.claude.com/docs/en/permissions) · [settings](https://code.claude.com/docs/en/settings) · [skills](https://code.claude.com/docs/en/skills) · [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Microsoft repo mining 2026-05-18
- Codex external reviews #1, #2, #3 — applied to this v6 draft
