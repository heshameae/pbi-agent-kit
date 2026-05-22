---
description: Scaffold a Power BI page that's a grid of KPI cards, one per measure. The grid shape (rows × cols) and the number of cards are decided at runtime based on how many measures the connected semantic model has. Use when the user asks for a "KPI page", "metrics grid", "scorecard page", "executive KPIs", "card view of my measures", or similar.
arguments: [page-name]
argument-hint: <page-display-name>
allowed-tools: mcp__pbi-report__pbi_page_add mcp__pbi-report__pbi_page_get mcp__pbi-report__pbi_visual_add mcp__pbi-report__pbi_visual_bind mcp__pbi-report__pbi_visual_set_container mcp__pbi-report__pbi_layout_grid mcp__pbi-report__pbi_report_validate mcp__pbi-report__pbi_report_info mcp__powerbi-modeling__connection_operations mcp__powerbi-modeling__measure_operations mcp__powerbi-modeling__table_operations mcp__powerbi-modeling__relationship_operations mcp__powerbi-modeling__column_operations
---

# KPI grid scaffold

A **recipe** — you decide the grid shape at runtime from the measure count.

## ⚠️ Rules (both apply, both required)

### Rule 1 — multi-fact OR comparative-intent models REQUIRE the data architect

You MUST invoke the `pbi-data-architect` subagent (via the Task tool, `subagent_type: pbi-data-architect`) before discovery when **either** trigger fires:

**Trigger A** — the model has ≥2 non-hidden, non-`LocalDateTable_*`/`DateTableTemplate_*` fact-shaped tables.

**Trigger B** — the user's verbatim request contains comparative intent: "vs", "compared to", "actual vs target", "YoY", "MoM", "QoQ", "variance", "above/below target", "vs last year", "delta", "share of", "% of total".

Power BI is a star-schema product; cross-fact comparisons need either shared dim tables (the architect's default proposal) OR explicit TREATAS bridging measures (the fallback). KPI grids that pull measures from multiple facts (e.g. actuals AND targets) silently produce wrong numbers if dims aren't reconciled, AND the agent will invent fudge-factor measures (e.g. `Outcome Goal = Planned Amount × 0.15`) to fill gaps in the source data if the architect's anti-fabrication firewall doesn't run first.

### Rule 2 — kind map is authoritative

You may NEVER call `pbi_visual_bind` with a `field` whose name isn't in the kind map built in step 3 (after any `pbi-measure-architect` additions in 3.5). If you want a card for a metric the model doesn't have, you must EITHER actually create it via `pbi-measure-architect` (re-list afterwards) OR substitute a name that's already in the kind map. Symptom of breaking this rule: every card shows "Something's wrong with one or more fields. This field was deleted from the model" in Power BI Desktop. Do not paraphrase names; the model on disk is the source of truth.

## Recipe

1. **Determine page name** (from slash arg, user prompt, or ask if unclear; default "KPIs").

2. **Auto-connect the model.** Call `pbi_report_info` → derive `.SemanticModel/definition` path → call `mcp__powerbi-modeling__connection_operations` with `{ operation: "ConnectFolder", folderPath: "<derived path>" }`. Ignore "already connected" errors. **Capture `data.folderPath` from the response** so downstream skills can persist via `database_operations.ExportToTmdlFolder`. If no model is reachable, fall through and scaffold empty cards.

2.5. **Architect gate — REQUIRED when Trigger A or Trigger B fires (Rule 1).** Call `table_operations({ operation: "List" })`. Count fact-shaped tables (≥1 numeric `summarizeBy != "None"` column + FK-shaped column). Scan the user's verbatim request for comparative keywords. If either trigger fires, invoke `pbi-data-architect` (Task tool, `subagent_type: pbi-data-architect`) and pass the user's verbatim request. Wait for its full response. The architect returns EITHER `shared_dims_created` + `cross_fact_axes` + `actuals_only_axes` (Path B, default) OR `bridge_covers` + `bridge_uncovered` + `bridge_blocked_axes` (Path C, fallback). Use the primary fact + dims + axis-binding guidance as the basis for step 3. If exactly 1 fact AND request is non-comparative, skip this step.

3. **Discover measures + summarizable columns AND build a kind map.**
   - `measure_operations({ operation: "List" })` → every name here has `kind = "measure"`.
   - If you'll need fallback columns (because there are fewer measures than KPI slots), call `table_operations({ operation: "GetSchema", references: [...] })` and pick numeric columns with `summarizeBy != "None"`. **These are still columns** (kind = "column"), not measures.
   - Keep a map: `fieldName → { kind, table }`. Don't assume kind from name or summarizeBy — it comes from which tool returned the name.

3.5. **Detect intent and synthesize missing measures** (only if the user's request implies derived metrics — otherwise skip).

   Scan the original user request for: "YoY/MoM/QoQ", "vs last year/month/quarter", "growth", "YTD/MTD/QTD", "rolling N", "vs target/budget/plan", "% of total / share of". For each detected pattern, route to the **`pbi-measure-architect` skill** to synthesize the measure(s):
   1. Pick the base measure from the discovery list (if ambiguous, ask — don't create variants for every base).
   2. Invoke `pbi-measure-architect` so it composes DAX, calls `measure_operations.Create`, and sets a `formatString`.
   3. Re-call `measure_operations({ operation: "List" })`; add new measures to the kind map.
   4. The new synthesized measures go to the **front** of the KPI list — they're the ones the user actually asked for. Recompute the grid shape (step 4) against the new measure count.

   If synthesis fails, continue with whatever did get created; don't abort.

4. **Decide the grid shape.** Pick `rows × cols` such that `rows*cols >= measureCount` AND the layout is balanced. Reasonable defaults:
   - 1-2 measures → 1 row, N cols
   - 3-4 measures → 2×2 or 1×4
   - 5-6 measures → 2×3
   - 7-9 measures → 3×3
   - 10+ measures → 4×N (split into multiple pages if it gets unwieldy)
   - 0 measures → 1×3 placeholder cards; tell the user no measures were found

5. **Add the page** with `pbi_page_add({ displayName: <name> })`. Note the page width/height (default 1280×720).

6. **Create one card per measure** (or per placeholder slot). `pbi_visual_add({ visualType: "card" })` for each. Capture the returned names.

7. **Lay them out** with `pbi_layout_grid({ visuals: <names>, rows, cols, x: 16, y: 16, width: <pageW - 32>, height: <pageH - 32>, gap: 8 })`.

7.5. **Pre-bind reconciliation.** Before binding, write out the bind plan as a list (`card_name → "<Table>[<FieldName>]" kind=<measure|column>`). For each row, confirm the `<FieldName>` is in your kind map. If any row references a name not in the kind map: STOP, either call `pbi-measure-architect` to actually create it (then re-list and re-verify) or replace the row with a name that exists. Do not proceed to step 8 with unresolved names.

8. **Bind each card** (skip if no model). Pick the shape from the kind map:

   - **Measure:** `pbi_visual_bind({ role: "Values", field: "<Table>[<Name>]", measure: true })`.
   - **Column with `summarizeBy != "None"`:** `pbi_visual_bind({ role: "Values", field: "<Table>[<Name>]", measure: false, aggregation: "<map>" })` where the aggregation comes from the column's `summarizeBy`: `Sum`→`"sum"`, `Average`→`"avg"`, `Count`→`"count"`, `Min`→`"min"`, `Max`→`"max"`. **Required** — a card bound to a raw column without aggregation renders "Something's wrong with one or more fields" in Desktop.

   Match fields to cards in priority order: measures first, then summarizable columns.

9. **Set readable titles** via `pbi_visual_set_container({ title: <measure display name> })` for each card.

10. **Validate (structural)** with `pbi_report_validate`.

11. **Validate (model cross-check) — REQUIRED whenever a model is connected.** Delegate to the **`pbi-bind-doctor`** subagent for the page. It cross-checks every binding's queryRef against the `.SemanticModel` TMDL on disk and reports any that reference a non-existent field. If anything is missing, do not claim success — call `pbi-measure-architect` to fix or report which cards are broken and why. Never paste a "measures created" summary unless `measure_operations.Create` was actually called for each.

## Boundaries

- You pick the grid shape; it isn't hardcoded.
- Do not apply themes, formatting, or filters.
- Do not invent measure names — bind only what `measure_operations.List` returned.
