---
description: Scaffold an "overview" or executive-summary dashboard page. Composes a band of KPI cards on top, one or more charts in the middle, and a wide table at the bottom — but the exact count of KPIs, the chart types, and the proportions are decided at runtime based on what's in the connected semantic model. Use when the user asks for an "overview page", "executive summary", "dashboard overview", "make a sales overview", "scaffold a [name] dashboard", or any composite landing page with KPIs + charts + a table.
arguments: [page-name]
argument-hint: <page-display-name>
allowed-tools: mcp__pbi-report__pbi_page_add mcp__pbi-report__pbi_page_get mcp__pbi-report__pbi_visual_add mcp__pbi-report__pbi_visual_bind mcp__pbi-report__pbi_visual_set_container mcp__pbi-report__pbi_layout_row mcp__pbi-report__pbi_report_validate mcp__pbi-report__pbi_report_info mcp__powerbi-modeling__connection_operations mcp__powerbi-modeling__table_operations mcp__powerbi-modeling__measure_operations mcp__powerbi-modeling__column_operations mcp__powerbi-modeling__relationship_operations
---

# Overview dashboard scaffold

This skill is a **recipe**, not a fixed template. You decide the visual count and types at runtime based on the model. The shape below is a recommended default — adapt it.

## ⚠️ Rules (read both before doing anything else)

### ⚠️ Rule 1 — multi-fact OR comparative-intent models REQUIRE the data architect

You **must** invoke the `pbi-data-architect` subagent in step 2.5 BEFORE doing any discovery, intent detection, or visual binding when **either** of these triggers fires:

**Trigger A — multi-fact count.** The connected model has >1 non-hidden, non-`LocalDateTable_*`, non-`DateTableTemplate_*` table that looks like a fact (numeric `summarizeBy != "None"` columns + foreign-key-shaped columns).

**Trigger B — comparative intent in the user's request.** Even on a single-fact model, the architect is mandatory when the user's verbatim request contains any of:
- explicit comparison: "vs", "compared to", "versus", "compare X to Y"
- target/budget/plan language: "actual vs target", "vs budget", "vs plan", "vs forecast", "vs quota", "variance", "over/under target"
- time comparison: "YoY", "MoM", "QoQ", "WoW", "year over year", "month over month", "vs last year", "vs prior period", "this year vs last year"
- variance/delta: "delta", "difference", "variance", "underperforming", "outperforming", "above/below", "growth"
- comparative aggregation: "share of", "% of total", "ratio of X to Y"

The architect interview will (a) verify the request against the model's actual contents (catches "you asked for Outcome Goal but the model has no such column" before the dashboard is built), (b) propose conformed-dim restructure as the default fix for cross-fact comparisons, and (c) fall back to TREATAS only if you explicitly decline structural change.

You may not skip this step on the grounds of "I already know what to build." Without the architect's working set:
- You won't know which fact is primary and which is secondary.
- You won't know whether dims are shared or duplicated across facts.
- You won't know whether the user's request asks for a metric the model can't deliver.
- **Power BI is a star-schema product.** Two facts with parallel dim columns (e.g. Date, Category in both an Orders table and a Targets table) and no shared dim table is the #1 root cause of broken cross-fact visuals. The architect's default proposal is to extract conformed dim tables; TREATAS bridging is the fallback only when structural change isn't allowed.

Symptom of skipping this rule: slicers don't filter both facts simultaneously, comparison visuals show one fact's values × the cross-join of the other's, the agent invents fudge-factor measures (e.g. `Outcome Goal = Planned Amount × 0.15`) to paper over missing data, and Desktop renders semantically wrong numbers under a "validation passed" sticker.

### ⚠️ Rule 2 — kind map is authoritative

You may NEVER call `pbi_visual_bind` with a `field` whose name isn't in the kind map you built in step 3 (after any measure-architect additions in step 3.5).

If you plan a binding like `<Table>[Total Amount]` but `Total Amount` isn't in the kind map, you have two — and only two — options:
- (A) Call `pbi-measure-architect` to actually CREATE the measure, then re-call `measure_operations({ operation: "List" })`, then re-confirm the new name is in the kind map. Only THEN bind.
- (B) Substitute a name that IS in the kind map (e.g. bind to `[Base Amount]` instead of inventing `[Total Amount]`).

**Symptom if you skip this rule:** Power BI Desktop opens every visual showing "Something's wrong with one or more fields. This field was deleted from the model and can't be used in this visual." The report-side bindings will have written successfully, the validator will pass, but the visuals are broken because the names don't exist in the `.SemanticModel` TMDL on disk.

Do not assume the measures you'd LIKE to exist will be created later, and do not paraphrase a kind-map name into something cleaner. The model on disk is the source of truth.

## Recipe

1. **Determine the page name.** If `$page-name` was passed via slash command, use it. Otherwise extract one from the user's request ("sales overview" → "Sales") or ask if unclear.

2. **Auto-connect the semantic model.** Call `pbi_report_info` to get the `.Report` folder path. Derive the sibling `.SemanticModel/definition` path. Call `mcp__powerbi-modeling__connection_operations` with `{ operation: "ConnectFolder", folderPath: "<derived path>" }`. Treat "already connected" responses as success. **Capture and remember `data.folderPath` from the response** — every downstream skill that writes to the model (`pbi-measure-architect`, `pbi-data-architect`) needs it to call `database_operations.ExportToTmdlFolder` for persistence. If no `.SemanticModel` exists, tell the user the page will be scaffolded with empty placeholders and skip data binding (continue with steps 3, 4, 5, 7, 8 but skip 6).

2.5. **Architect gate — REQUIRED, NOT OPTIONAL when Trigger A or Trigger B fires (see Rule 1).** Call `table_operations({ operation: "List" })`. Count non-hidden, non-`LocalDateTable_*`, non-`DateTableTemplate_*` tables that look like facts (have ≥1 numeric `summarizeBy != "None"` column AND ≥1 foreign-key-shaped column).

Decide if the gate fires:
- **Trigger A** — fact count ≥ 2.
- **Trigger B** — fact count = 1 BUT the user's verbatim request contains any comparative keyword from Rule 1 (vs / compared to / actual vs target / YoY / variance / etc.).
- **No-op** — fact count = 1 AND the request is non-comparative ("just show me sales totals by region"). Skip the architect; proceed to step 3.
- **Empty** — fact count = 0. Scaffold empty placeholders and stop.

If the gate fires, you **MUST** invoke the `pbi-data-architect` subagent (via the Task tool, `subagent_type: pbi-data-architect`) and pass: the user's verbatim request, the list of candidate fact tables, and the page id (if step 4 has run). Wait for its full response — do not proceed without it.

The architect's response will include EITHER:

**Path B — conformed-dim restructure (the architect's default proposal):**
- `shared_dims_created: ["dim_Category", "dim_Segment", "dim_Date", ...]`
- `cross_fact_axes: ["Category", "Segment", "Order Date", ...]` — these axes have a single dim that filters BOTH facts. Slicers / chart axes / legends MUST bind to `dim_<Axis>[<Col>]`, not to the fact column (which is now hidden).
- `actuals_only_axes: ["Fine Grain Attribute", "Region", ...]` — these axes only have data on the actuals side. Visuals on these axes show Actuals measures only; do NOT bind Target / Variance measures here.
- No `bridge_*` fields.

**OR Path C — TREATAS bridge (fallback, only when user declined Path B):**
- `bridge_covers: [<dims>]` — WHITELIST of axes where bridged measures work correctly.
- `bridge_uncovered: [<dims>]` — dims the user named but Targets lacks.
- `bridge_blocked_axes: [<full list>]` — EXHAUSTIVE BLACKLIST of every actuals dim column that's NOT in the bridge.

Capture whichever the architect returns. Use the working set as the AUTHORITATIVE basis for step 3.

**Binding rules per path:**

**If Path B was applied:**
1. Slicers / chart axes / legends for cross-fact comparisons bind to `dim_<Axis>[<Col>]`. Never to the fact's hidden source column.
2. Visuals on axes in `actuals_only_axes` show Actuals measures only — drop Target / Variance / vs-Target-% projections.
3. No coverage-blocked-axis check needed; conformed dims propagate everywhere.

**If Path C was applied (TREATAS fallback):**
Before every `pbi_visual_bind` call that includes a bridged measure (planned metric / variance / attainment % / any architect-created TREATAS measure):
1. Identify the visual's Category / Axis / Legend column (call it `axisCol`).
2. If `axisCol` is in `bridge_blocked_axes` → STOP. Drop the bridged-measure projections from this visual. Bind only the actuals counterpart (Actual Amount / Actual Count / etc.). If the visual was specifically meant for variance (e.g. "Top 10 Fine Grain Attributes by Variance"), the visual is INVALID for this model — skip it entirely and surface it in the final report as "deferred: needs shared dim table for Fine Grain Attribute before variance analysis is possible at this grain."
3. If `axisCol` is in `bridge_covers` → safe to bind bridged measures.

**Symptom if you skip this rule:** Power BI Desktop renders the dashboard with no error, but the bridged-measure values are mathematically nonsense — each row shows the parent dim's target filtered by the wrong cross-section. The user sees individual rows all heavily negative but the total row positive (or vice versa). Validators pass; the user catches it visually when totals don't reconcile.

This rule extends Rule 2 (kind map authoritative): bridged measures have not just a name but a **coverage scope**. A bridged measure's "kind map entry" includes `validAxes: bridge_covers`, and binding outside those axes is the same kind of violation as binding a column as a measure.

3. **Discover the model AND build a kind map.**
   - `measure_operations({ operation: "List" })` → list of measures. **Every name returned here has kind = "measure".**
   - `table_operations({ operation: "GetSchema", references: [{name: "<main fact table>"}, ...] })` → columns per table. **Every column returned here has kind = "column"**, regardless of its `summarizeBy` value. A column with `summarizeBy: "Sum"` is still a COLUMN, not a measure.
   - Keep a mental map: `fieldName → { kind, table, summarizeBy? }` covering every name you might bind. Don't assume; if a name didn't come from `measure_operations.List`, it's a column.
   - Pick **3-6 KPI fields** (prefer measures; if fewer measures exist than KPI slots, fall back to numeric columns with `summarizeBy != "None"` — they'll auto-aggregate when bound).
   - Pick **1 categorical column** for the main chart's Category axis (low-medium cardinality; avoid hidden columns and the auto-generated `LocalDateTable_*` ones).
   - Pick **1 date column** for the secondary chart's X axis.
   - Pick **4-7 columns** for the table — usually a key dimension + 2-3 descriptors + 1-2 numeric facts.

3.5. **Detect intent and synthesize missing measures** (only if the user's request implies comparison or derived metrics — otherwise skip).

   Scan the original user request for these intent phrases:
   - **time-comparison** — "YoY", "MoM", "QoQ", "year-over-year", "vs last year/month/quarter", "growth", "deltas over time"
   - **period-to-date** — "YTD", "MTD", "QTD", "year to date", "this year so far"
   - **rolling window** — "rolling 3-month", "trailing 12", "moving average"
   - **vs target** — "vs target", "vs budget", "vs plan", "vs goal", "attainment"
   - **share of total** — "% of total", "share of", "contribution"

   For every detected pattern, route to the **`pbi-measure-architect` skill** to create the needed measure(s):
   1. Pick the right base measure (prefer the headline KPI the user named, e.g. "Metric YoY" → base = the corresponding amount/count measure). If ambiguous, ask which one — don't create three variants.
   2. Invoke `pbi-measure-architect` (the skill auto-activates on those phrases) so it synthesizes the DAX, calls `measure_operations.Create`, and sets a sensible `formatString`.
   3. Re-call `measure_operations({ operation: "List" })` to pick up the new measures.
   4. Add each new measure to the kind map as `kind = "measure"`.
   5. Insert the new measures into the KPI list **before** any fallback columns — they're the answer to what the user asked for.

   If a synthesis call fails (e.g. no date table for time intelligence), surface the warning and continue with whatever measures DID get created. Don't abort the whole scaffold.

4. **Add the page.** `pbi_page_add({ displayName: <page-name> })`. Capture the returned page id and the page width/height. Default page is 1280×720.

4.5. **Pre-bind reconciliation — list everything you'll bind, then verify against the kind map.** Before creating any visual, write out the full binding plan as a list:
   ```
   card_metric            → Values   "<FactTable>[Base Amount]"   kind=measure
   chart_main Category    → Category "<FactTable>[Region]"    kind=column (no aggregation)
   chart_main Y           → Y        "<FactTable>[Sales]"     kind=column (aggregation=sum)
   ...
   ```
   For each row in this plan, confirm the `<Table>[<Name>]` reference is in your kind map (after step 3.5 additions). If ANY row references a name that isn't in the kind map:
   - STOP. Do not proceed to step 5.
   - Either invoke `pbi-measure-architect` to actually create the missing name as a real measure (then re-list and re-verify) OR replace the row with a name that IS in the kind map.
   - Re-run the reconciliation before continuing.

   **This step is non-negotiable. If the kind map is empty (no model), you can scaffold with placeholder visuals but skip ALL binding steps below.**

5. **Create + position the visuals.** No hardcoded geometry — derive from the page dimensions. Recommended composition (you can deviate if data suggests otherwise):

   - **KPI band (top ~18% of page height):** Create one `card` visual per KPI you picked in step 3. Then `pbi_layout_row({ visuals: [<names>], y: <margin>, height: <kpiBandHeight>, x: <margin>, width: <pageWidth - 2*margin>, gap: <gap> })`.
   - **Chart band (middle ~42% of page height):** Create the main chart (default `barChart` for a category-based comparison; pick `donutChart` if it's a small-cardinality share-of-total story; pick `lineChart` if the user's intent is over-time). Create the secondary chart (default `lineChart` for trend; pick something else if the data suggests). Place them side-by-side using two `pbi_visual_add` calls with explicit `x`/`y`/`width`/`height`. A 60/40 split usually looks balanced; adjust if the data is unbalanced.
   - **Table (remaining bottom space):** Create one `tableEx` visual occupying the full inner width below the chart band.

   Use a 16px outer margin and 8px gap between visuals unless the user asked for a denser/looser layout.

6. **Bind data** (skip if no model is connected). Three projection shapes exist — pick the right one per binding:

   | Field kind | Role family | Pass | Resulting shape |
   |---|---|---|---|
   | Measure | any | `measure: true` | `{ Measure: { ... } }` |
   | Column with `summarizeBy != "None"` | measure-style (Values, Y, Indicator, Size) | `measure: false, aggregation: "<map>"` | `{ Aggregation: { Column, Function } }` |
   | Column (any) | categorical/identity (Category, Legend, Rows, Columns, table cells) | `measure: false` (no aggregation) | `{ Column: { ... }, active: true }` |

   Map column `summarizeBy` → `aggregation`: `Sum`→`"sum"`, `Average`→`"avg"`, `Count`→`"count"`, `Min`→`"min"`, `Max`→`"max"`. **Skipping the aggregation on a summable column bound to Values/Y is the #1 cause of "Something's wrong with one or more fields" in Desktop.**

   - Each KPI card → `pbi_visual_bind({ role: "Values", field: "<Table>[<Name>]", measure: <from kind map>, aggregation: <from summarizeBy if it's a column> })`.
   - Main chart Category → bind the categorical column to `Category` with `measure: false` (no aggregation).
   - Main chart Y → bind the value with `measure: <from map>` AND `aggregation: <from summarizeBy>` if it's a column.
   - Secondary chart Category → bind the date column to `Category` with `measure: false` (no aggregation — dates are identity, not aggregated).
   - Secondary chart Y → same as main chart Y.
   - Table cells (all roles `Values` here for `tableEx`) → bind each chosen column with `measure: false`. Add `aggregation: "sum"` for numeric columns with summarizeBy != "None"; omit aggregation for text/identity columns (Region, Customer Name, Order ID, etc.) — those should remain as identity Columns.

7. **Add readable titles** via `pbi_visual_set_container({ title: <human-readable label> })` for each visual.

8. **Validate (structural).** Call `pbi_report_validate` and surface any errors.

8.5. **Validate (model cross-check) — REQUIRED whenever a model is connected.** `pbi_report_validate` is structural only; it does NOT check that bound measure/column names exist in the `.SemanticModel` TMDL on disk. To catch the "field deleted from model" failure mode, delegate to the **`pbi-bind-doctor`** subagent with the page name. The doctor reads the TMDL and reports any binding whose `queryRef` references a name the model doesn't contain. If the doctor reports any missing fields, do NOT claim success — surface the missing names and either (a) call `pbi-measure-architect` to create them now, or (b) tell the user clearly which visuals are broken and why.

9. **Report.** Tight summary: page name + id, count of each visual type created, count of bindings, structural validator status, and model cross-check status (e.g. "all 21 bindings resolve to real fields in the .SemanticModel" or "3 bindings reference missing fields: …"). Do not paste a table of "measures created" unless you actually called `measure_operations.Create` for each — never hallucinate measure creation in the summary.

## Failure modes

- **No `.SemanticModel` reachable** → scaffold the page with empty visuals, tell the user.
- **No measures AND no aggregatable columns** → create 3 placeholder cards without bindings.
- **A `pbi_visual_bind` call errors** → report which visual + field; leave it empty and continue.

## Boundaries

- You decide visual count, types, and exact proportions — they're not hardcoded.
- Do not apply themes or conditional formatting (out of scope for this skill).
- Do not invent field names. Only bind references that the modeling MCP confirmed exist.
