---
description: Scaffold a "drill" or "filter-and-table" Power BI page — a slicer on the left, a few KPI cards on the right (count chosen at runtime), and a wide detail table below. The slicer column, KPI measures, and table columns are picked at runtime based on the connected semantic model. Use when the user asks for a "drill page", "drillthrough page", "filterable detail page", "transactions list page", or "a page where I can filter to a region and see the rows".
arguments: [page-name]
argument-hint: <page-display-name>
allowed-tools: mcp__pbi-report__pbi_page_add mcp__pbi-report__pbi_page_get mcp__pbi-report__pbi_visual_add mcp__pbi-report__pbi_visual_bind mcp__pbi-report__pbi_visual_set_container mcp__pbi-report__pbi_layout_row mcp__pbi-report__pbi_report_validate mcp__pbi-report__pbi_report_info mcp__powerbi-modeling__connection_operations mcp__powerbi-modeling__measure_operations mcp__powerbi-modeling__table_operations mcp__powerbi-modeling__column_operations mcp__powerbi-modeling__relationship_operations
---

# Drill page scaffold

A **recipe**. Composition is decided from the model at runtime.

## ⚠️ Rules (both apply, both required)

### Rule 1 — multi-fact OR comparative-intent models REQUIRE the data architect

You MUST invoke the `pbi-data-architect` subagent (Task tool, `subagent_type: pbi-data-architect`) before discovery when **either** trigger fires:

**Trigger A** — the model has ≥2 non-hidden, non-`LocalDateTable_*`/`DateTableTemplate_*` fact-shaped tables.

**Trigger B** — the user's verbatim request contains comparative intent: "vs", "compared to", "actual vs target", "YoY", "variance", "delta", "above/below", "share of".

Drill pages especially need this — if your slicer filters one fact but the table reads from another, with no relationship between them, the slicer does nothing visible. The architect's default proposal is conformed dim tables that filter every fact uniformly; TREATAS bridging is the fallback when the user declines structural change. Either path is mandatory before binding visuals.

### Rule 2 — kind map is authoritative

You may NEVER call `pbi_visual_bind` with a `field` whose name isn't in the kind map built in step 3 (after any `pbi-measure-architect` additions in 3.5). Two options if a name you want isn't there: actually create the measure via `pbi-measure-architect` (then re-list), or substitute a name that IS in the kind map. Symptom of breaking this rule: every card / table cell shows "Something's wrong with one or more fields. This field was deleted from the model" in Power BI Desktop. The model on disk is the source of truth; do not paraphrase.

## Recipe

1. **Determine page name** (from slash arg, user prompt, or ask if unclear).

2. **Auto-connect the model.** Call `pbi_report_info` → derive `.SemanticModel/definition` path → call `mcp__powerbi-modeling__connection_operations` with `{ operation: "ConnectFolder", folderPath: "<derived path>" }`. Treat "already connected" as success. **Capture `data.folderPath` from the response** so downstream skills can persist via `database_operations.ExportToTmdlFolder`. If no model is reachable, scaffold the empty layout and stop.

2.5. **Architect gate — REQUIRED when Trigger A or Trigger B fires (Rule 1).** Call `table_operations({ operation: "List" })`. Count fact-shaped tables. Scan the user's verbatim request for comparative keywords. If either trigger fires, invoke `pbi-data-architect` (Task tool, `subagent_type: pbi-data-architect`) and pass the user's verbatim request. Wait for its full response. The architect returns EITHER `shared_dims_created` + `cross_fact_axes` + `actuals_only_axes` (Path B, conformed-dim default) OR `bridge_covers` + `bridge_uncovered` + `bridge_blocked_axes` (Path C, TREATAS fallback). Use the primary fact + dims to drive the slicer column, KPI fields, and table columns in step 3. Slicer columns under Path B bind to `dim_<Axis>[<Col>]`, not to fact columns.

3. **Discover the model AND build a kind map.**
   - `measure_operations({ operation: "List" })` → every name here has `kind = "measure"`.
   - `table_operations({ operation: "GetSchema", references: [...] })` → every column has `kind = "column"`, regardless of `summarizeBy`.
   - Map `fieldName → { kind, table }`.
   - **Slicer column:** pick a low-cardinality categorical column (ideally <50 distinct values; avoid hidden columns and `LocalDateTable_*`). Common picks: Region, Category, Segment, Status. If multiple candidates, pick the one whose name appears in the user's request, or the smallest cardinality.
   - **KPI fields:** pick 1-3. Prefer measures; fall back to numeric columns with `summarizeBy != "None"`.
   - **Table columns:** pick 5-8 useful columns — a key/id, 2-3 dimensions, 1-2 facts. Skip hidden columns and obvious technical ones (`Row ID`, `*ID` if a more descriptive name exists).

3.5. **Detect intent and synthesize missing measures** (only if the user's request implies derived metrics — otherwise skip).

   Scan the original user request for: "YoY/MoM/QoQ", "vs last year/month/quarter", "growth", "YTD/MTD/QTD", "rolling N", "vs target/budget/plan", "% of total / share of". For each detected pattern, route to the **`pbi-measure-architect` skill** to synthesize the measure(s):
   1. Pick the base measure (the headline KPI the user named; if ambiguous, ask).
   2. Invoke `pbi-measure-architect` so it composes DAX, calls `measure_operations.Create`, and sets a `formatString`.
   3. Re-call `measure_operations({ operation: "List" })`; add new measures to the kind map.
   4. Insert the new measures into the **KPI list** before any fallback columns. The detail table at the bottom stays as identity columns + facts — synthesized comparison measures belong on the KPI cards, not in the row-level table.

   If synthesis fails, continue with whatever did get created; don't abort.

4. **Add the page** with `pbi_page_add({ displayName: <name> })`. Capture page dimensions.

5. **Create the header band:**
   - One `slicer` visual.
   - One `card` visual per KPI measure.
   - Position the slicer on the left (~30% width) and the KPI cards in a row to the right of it. Use explicit `x`/`y`/`width`/`height` for the slicer, then `pbi_layout_row` for the KPI cards constrained to the right portion of the page.

6. **Create a wide table** (`tableEx`) below the header band, full-width minus margins.

6.5. **Pre-bind reconciliation.** Write out the bind plan as a list (`visual_name role "<Table>[<FieldName>]" kind=<measure|column>`). Confirm each `<FieldName>` is in the kind map. If any name isn't there: STOP. Either call `pbi-measure-architect` to create it (then re-list and re-verify) or replace with a name that exists. Do not proceed to step 7 with unresolved names.

7. **Bind data** (skip if no model). Three projection shapes apply:

   - **Slicer** (categorical Column role): `pbi_visual_bind({ role: "Category", field: "<Table>[<Column>]", measure: false })`. No aggregation.
   - **KPI cards** (measure-style Values role):
     - If field is a Measure: `{ measure: true }`.
     - If field is a Column with `summarizeBy != "None"`: `{ measure: false, aggregation: "<sum|avg|count|min|max from summarizeBy>" }`. Required — without aggregation, Desktop shows "Something's wrong".
   - **Table** (mixed): for each column, bind to `Values` with `measure: false`. Add `aggregation: "<map>"` for numeric columns with summarizeBy != "None"; omit aggregation for text/identity columns (id, name, dimension labels) — those should stay as identity Columns.

8. **Set titles** for each visual via `pbi_visual_set_container({ title: <human-readable label> })`.

9. **Validate (structural)** with `pbi_report_validate`.

10. **Validate (model cross-check) — REQUIRED whenever a model is connected.** Delegate to the **`pbi-bind-doctor`** subagent for the page. It cross-checks every binding's queryRef against the `.SemanticModel` TMDL on disk and reports any non-existent fields. If anything is missing, surface it and fix via `pbi-measure-architect` or report which visuals are broken. Never write a "measures created" summary unless `measure_operations.Create` was actually called for each.

## Boundaries

- You pick the slicer column, KPI count, and table columns based on the model — not hardcoded.
- Do not invent fields; only bind references the modeling MCP confirmed exist.
- Do not theme or format.
