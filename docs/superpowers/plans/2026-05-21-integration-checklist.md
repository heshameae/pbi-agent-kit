# Integration Checklist — v6 Skills & Agents (2026-05-21)

## Architecture baseline

- Wrapped MS MCP: our `pbi-report` server spawns Microsoft's modeling MCP as an internal child subprocess. No peer entry in `.mcp.json`.
- Live tool namespace (plugin-loaded): `mcp__plugin_pbi-mcp-ts_pbi-report__pbi_*`
- Write gate: `pbi_measure_create` / `pbi_measure_update` run `daxReferenceCheck` in-code before any write.
- Builder is measure-only. No `pbi_table_*` / `pbi_column_*` / `pbi_relationship_*` write tools exist.
- DashboardSpec contract: `packages/core/src/types/spec.ts` — zod schemas, validated by `pbi_spec_validate`.

## 5-agent v6 target

| Agent | Status | Role |
|---|---|---|
| pbi-data-analyst | NEW (Phase 1) | Read-only, returns DashboardSpec |
| pbi-model-builder | NEW (Phase 1) | Measure-only writes, validates spec first |
| pbi-model-reviewer | NEW (Phase 1) | Read-only model quality checks |
| pbi-report-builder | NEW (Phase 3) | Report-side layout + visuals |
| pbi-report-reviewer | EXISTS ✓ | Report review — keep as-is |

---

## Phase 0 — Archival & manifest cleanup ✅ DONE

### What was done

- `skills/pbi-measure-architect/` → `archive/skills/pbi-measure-architect/` (dead: `mcp__powerbi-modeling__*`)
- `skills/pbi-date-intelligence/` → `archive/skills/pbi-date-intelligence/` (dead: `mcp__powerbi-modeling__*`)
- `pbi-data-architect` removed from `.claude-plugin/plugin.json` agents array (file left in `agents/` for reference)
- Deferred: scaffold sub-skills (`pbi-scaffold-drill`, `pbi-scaffold-kpi-grid`, `pbi-scaffold-overview`) → Phase 3

### Deferred (still in place, broken but harmless)

- `agents/pbi-data-architect.md` — file on disk, not registered
- `skills/pbi-scaffold-{drill,kpi-grid,overview}/` — depend on data-architect; archive with pbi-report-builder in Phase 3
- `agents/pbi-model-doctor.md` — still registered; archive when pbi-model-reviewer lands (Phase 2)

### IRL test (Phase 0)

In a Claude Code session with Desktop open:
1. `"create a measure [Total Sales] = SUM(FactPrimary[Sales])"` → should still work end-to-end
2. `"create a measure [Bad Measure] = [NonExistentMeasure] * 2"` → should be refused in-code with a clear error
3. Ask for `/pbi-data-architect` or reference it by name → agent should not appear in completions

---

## Phase 1 — Two contract skills + three model agents

**Goal:** establish the spec contract skills, then build the three model-side agents with correct tool surface.

### 1a — Two contract skills

Create in `skills/`:

**`skills/pbi-modeling-contracts/SKILL.md`**
- Documents: wrapped tool surface (read vs write tools), connect/auto-detect behavior, live-vs-folder persistence, DashboardSpec handoff contract, spec invariants
- Tools: none (knowledge skill, `user-invocable: false`)
- Dataset-agnostic: use `FactPrimary`, `DimShared`, `ValueMetric`, `PlanMetric`, `SharedAxis`

**`skills/pbi-tmdl-conventions/SKILL.md`**
- Documents: TMDL formatting rules, measure expression conventions, bridge metadata rules, BPA violation patterns
- Tools: none (knowledge skill, `user-invocable: false`)
- Dataset-agnostic

### 1b — Three model-side agents

All agents use `mcp__plugin_pbi-mcp-ts_pbi-report__pbi_*` tool prefix.

**`agents/pbi-data-analyst.md`**
- `tools:` = Read + read tools only: `mcp__plugin_pbi-mcp-ts_pbi-report__pbi_model_list_tables`, `pbi_model_list_columns`, `pbi_model_list_measures`, `pbi_model_list_relationships`, `pbi_dax_query`, `pbi_model_check`, `pbi_dax_reference_check`, `pbi_spec_validate`
- No write tools → cannot write (enforced by tool surface)
- Returns a `DashboardSpec` (validated via `pbi_spec_validate`)
- `skills:` preload: `pbi-modeling-contracts`, `pbi-tmdl-conventions`
- Description: given a business question, explores the live model and produces a DashboardSpec

**`agents/pbi-model-builder.md`**
- `tools:` = read tools above + write tools: `pbi_measure_create`, `pbi_measure_update`, `pbi_measure_delete`, `pbi_model_export`
- Required protocol: call `pbi_spec_validate` first; refuse on invalid spec or `blocked` status
- Measure-only: surfaces `missingDims` and structural blockers to user as terminal recommendations, never auto-builds tables/relationships
- Mode-aware persistence: live → "Ctrl+S to persist"; folder → call `pbi_model_export`
- `skills:` preload: `pbi-modeling-contracts`, `pbi-tmdl-conventions`

**`agents/pbi-model-reviewer.md`**
- `tools:` = Read + `mcp__plugin_pbi-mcp-ts_pbi-report__pbi_model_check`
- No write tools
- Returns structured BPA/relationship/grain report; recommends fixes but does not execute them
- `skills:` preload: `pbi-tmdl-conventions`

### 1c — Register in plugin.json

Add all three to `.claude-plugin/plugin.json` `agents` array:
```json
"./agents/pbi-data-analyst.md",
"./agents/pbi-model-builder.md",
"./agents/pbi-model-reviewer.md"
```

### IRL test (Phase 1)

In a Claude Code session with Desktop open (Parallels):
1. `"analyse my model and plan a dashboard showing actuals vs targets by category"` → pbi-data-analyst explores the live model and returns a DashboardSpec JSON. Verify: no writes attempted, spec status is `ready` or `needs-user-input` with clarifyingQuestions.
2. `"now build the measures from that spec"` → pbi-model-builder calls `pbi_spec_validate` first, then creates each measure. Verify: measures appear in Desktop Fields pane without restart. Ctrl+S → reload confirms persistence.
3. `"review the model quality"` → pbi-model-reviewer calls `pbi_model_check` and returns BPA/relationship findings. Verify: no writes. If the model is clean, it says so.
4. **Read-only gate:** confirm pbi-data-analyst has no write tool in its `tools:` list → it literally cannot call `pbi_measure_create`.

---

## Phase 2 — Reviewing-knowledge skills + retire pbi-model-doctor

**Goal:** add knowledge skills that document review patterns; replace pbi-model-doctor with pbi-model-reviewer.

### 2a — Two knowledge skills

**`skills/pbi-reviewing-models/SKILL.md`** — BPA patterns, grain analysis, relationship pre-flight, TREATAS bridge coverage checks. Knowledge only.

**`skills/pbi-reviewing-reports/SKILL.md`** — PBIR structural validity, visual binding rules, filter/slicer hygiene, design review patterns. Knowledge only.

### 2b — Archive pbi-model-doctor

- Move `agents/pbi-model-doctor.md` → `archive/agents/pbi-model-doctor.md`
- Remove from `.claude-plugin/plugin.json` agents array
- pbi-model-reviewer (Phase 1) covers its function with the plugin-namespaced tool prefix

### IRL test (Phase 2)

1. `"review my model"` → routes to pbi-model-reviewer (NOT pbi-model-doctor). Zero writes.
2. Verify pbi-model-doctor no longer appears in agent completions.

---

## Phase 3 — pbi-report-builder + scaffold archival

**Goal:** replace broken scaffold sub-skills with a proper report-builder agent backed by the plugin tools.

### 3a — New report-builder agent

**`agents/pbi-report-builder.md`**
- `tools:` = `mcp__plugin_pbi-mcp-ts_pbi-report__pbi_*` report write tools: `pbi_visual_add`, `pbi_visual_bind`, `pbi_visual_update`, `pbi_visual_delete`, `pbi_layout_grid`, `pbi_layout_row`, `pbi_layout_column`, `pbi_page_add`, `pbi_filter_add_*`, `pbi_theme_set`, `pbi_report_validate`
- Required: call `pbi_report_validate` after each write
- `skills:` preload: `pbi-reviewing-reports` (Phase 2)

### 3b — New designing-reports skill

**`skills/pbi-designing-reports/SKILL.md`** — layout grid conventions, visual type selection, KPI card / trend / matrix patterns, theme hygiene. Knowledge only.

### 3c — Archive scaffold sub-skills

Move to `archive/skills/`:
- `skills/pbi-scaffold/` (base)
- `skills/pbi-scaffold-drill/`
- `skills/pbi-scaffold-kpi-grid/`
- `skills/pbi-scaffold-overview/`

Also archive `agents/pbi-data-architect.md` (already deregistered, now move file).

### IRL test (Phase 3)

1. `"lay out a KPI row at the top showing [Total Sales], [Total Budget], [Attainment %]"` → pbi-report-builder adds 3 KPI cards, binds the measures, validates. Verify: Desktop shows the visuals on the page.
2. `"add a trend chart below showing [Total Sales] by month"` → line chart added and bound. Validate passes.
3. Confirm scaffold skills no longer appear in completions.

---

## Phase 4 — BPA expansion + authoring skills

**Goal:** increase model quality coverage; add knowledge skills that absorb measure-architect and date-intelligence domain knowledge (reimplemented cleanly).

### 4a — Expand BPA rules

- Target: 40 rules (from current ~15)
- New categories: date intelligence patterns, format string conventions, measure naming standards

### 4b — New authoring skills (clean reimplementation — no GPL copy)

**`skills/pbi-authoring-measures/SKILL.md`** — measure authoring conventions, time intelligence patterns (YTD, MTD, rolling), CALCULATE/FILTER semantics, variable best practices. Knowledge only.

**`skills/pbi-authoring-semantic-model/SKILL.md`** — star-schema design, grain reasoning, relationship types, hidden columns, key/sort column conventions. Knowledge only.

### IRL test (Phase 4)

1. `"audit this dashboard"` → pbi-model-reviewer + pbi-report-reviewer both fire; combined findings surface BPA violations, binding issues, layout problems.
2. BPA reports at least 30 rule categories with no false positives on a known-clean model.

---

## Phase 5 (deferred)

- `pbi-authoring-svg-visuals` skill
- Pipeline skills: `pbi-build`, `pbi-modify`, `pbi-fix`, `pbi-audit` (auto-trigger via hooks)
- Packaging / marketplace

---

## Cross-cutting rules (all phases)

- Dataset-agnostic in ALL committed artifacts: use `FactPrimary`, `DimShared`, `ValueMetric`, `PlanMetric`, `SharedAxis`, `FactSecondary` — NEVER Demo.pbip, Superstore, real client names
- `pbi-` prefix on ALL new agents and skills
- Shadow purity: build NEW alongside existing; flip old off in manifest when replacement lands
- Tool prefix for all new agent `tools:` lines: `mcp__plugin_pbi-mcp-ts_pbi-report__pbi_*`
- plugin.json `agents` array is explicit — every new agent must be hand-added
- `skills/` dir-glob auto-registers new skills (no manual step needed)
- GPL contamination: never copy from data-goblin or proprietary repos
- All writes need `pbi_report_validate` (report side) or DAX gate (model side) after execution
