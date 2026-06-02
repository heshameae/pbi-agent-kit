# IRL Test Checklist — v6 five-agent roster (Phase 1–3)

Run in a **fresh Claude Code session** with **Power BI Desktop open (Parallels)** on a real `.pbip`.
Prereq: restart Claude Code after the consolidation commit so the plugin cache reloads.

## 0. Roster sanity (no Desktop needed)
- [ ] Exactly 5 agents offered: `data-analyst`, `model-builder`, `model-reviewer`, `report-reviewer`, `report-builder`
- [ ] None of these appear anymore: `pbi-data-architect`, `pbi-model-doctor`, `pbi-report-reviewer`, `pbi-bind-doctor`, `pbi-report-validator`, `pbi-bulk-operator`, `pbi-designer`
- [ ] Scaffold skills gone from completions: `pbi-scaffold`, `pbi-scaffold-{drill,kpi-grid,overview}`

## 1. Model side (plan → build → review)
- [ ] "analyse my model and plan a dashboard for actuals vs targets by category" → routes to **data-analyst**; returns a DashboardSpec; **no writes attempted** (status `ready` or `needs-user-input`)
- [ ] "now build the measures from that spec" → routes to **model-builder**; calls `pbi_spec_validate` first; measures appear in the Fields pane **without restart**; Ctrl+S → reload persists
- [ ] "review the model quality" / "review my model" → routes to **model-reviewer** (NOT model-doctor); runs `pbi_model_check`; **zero writes**
- [ ] **Gate test:** ask model-builder to create a measure referencing a non-existent column → **refused** (in-code DAX-reference gate), nothing written

## 2. Report side (build → review)
- [ ] "lay out a KPI row showing [3 measures] on the Overview page" → routes to **report-builder**; adds 3 cards, binds via `pbi_visual_bind`, `pbi_report_validate` after each write; cards render in Desktop
- [ ] "add a trend chart below showing [measure] by month" → line chart added + bound; validate passes
- [ ] **Bulk gate:** "resize all charts to 400×300" → report-builder previews the match set with `pbi_visual_where` and **waits for confirmation** before the bulk write
- [ ] "review my report" / "check before publishing" → routes to **report-reviewer**; runs `pbi_report_validate` + `pbi_visual_bind_check`; **zero writes**; leads with errors then design/a11y observations

## 3. Routing / skill activation
- [ ] data-analyst & model-reviewer & report-reviewer fire **proactively** where appropriate (read-only, safe)
- [ ] report-builder does **not** fire speculatively — needs an explicit build request
- [ ] Skills load on demand: `authoring-measures`, `modeling-semantic-model`, `reviewing-models`, `reviewing-reports`, `designing-reports`, `planning-dashboards`, `power-query`, `lineage-analysis`

## Known gaps to watch (not blockers)
- **Structural model writes** (relationships/tables/bridges) are NOT in the wrapped server yet — only measure writes. Cross-fact / shared-dim restructuring has no agent home post-pbi-data-architect.
- Tool-prefix split (`mcp__plugin_pbi-mcp-ts_pbi-report__*`) — confirm the new agents' tools actually resolve in the live Windows plugin install.

## Capture results
Note pass/fail per line + any mis-routing (which agent actually fired). Feed failures back as the next session's worklist.
