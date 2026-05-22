---
description: Synthesize DAX measures from business intent — YoY/MoM/QoQ deltas, YTD / period-to-date, rolling N-period averages, vs-target deltas, share-of-total, running totals, count-distinct, ratios, or any "create a measure that ..." request. Decides between a reusable model-level measure (via the modeling MCP) and a visual-scoped calc (via this plugin's MCP), picks a sensible name + formatString, and verifies the result. Use whenever the user asks to "create a measure", "make a measure for", "add a calc for", "show me YoY/MoM/QoQ", "delta vs prior year", "vs target", "% of total", "running total", "rolling N", "period-to-date", "growth rate", or asks for a metric the model doesn't already have.
allowed-tools: mcp__powerbi-modeling__connection_operations mcp__powerbi-modeling__measure_operations mcp__powerbi-modeling__table_operations mcp__powerbi-modeling__column_operations mcp__powerbi-modeling__relationship_operations mcp__powerbi-modeling__database_operations mcp__pbi-report__pbi_report_info mcp__pbi-report__pbi_visual_calc_add mcp__pbi-report__pbi_visual_calc_list mcp__pbi-report__pbi_visual_calc_delete mcp__pbi-report__pbi_visual_list
---

# Measure architect

Turns business intent into DAX. This is a **recipe** — the actual DAX is composed at runtime from the model + the user's request, not selected from a fixed library.

## ⚠️ The persistence rule

Microsoft's modeling MCP keeps `ConnectFolder` writes **in-memory only** — `measure_operations.Create` does NOT touch TMDL files on disk. If you skip the explicit persist step, the measure exists in the live TOM session but vanishes when Desktop reopens the .pbip, and every visual bound to it shows "This field was deleted from the model."

After ANY `measure_operations.Create` (or `Update` / `Delete`), you **must** call:

```
mcp__powerbi-modeling__database_operations({
  operation: "ExportToTmdlFolder",
  tmdlFolderPath: "<the same path you passed to ConnectFolder — must be the .SemanticModel/definition folder, NOT the .SemanticModel root>"
})
```

This flushes the TOM session back to TMDL files. Capture the folder path from `connection_operations.ConnectFolder`'s response (`data.folderPath`) so you can pass it verbatim. Symptom of skipping: the TMDL file's mtime stays in the past, `grep` doesn't find your new measure on disk, and Desktop sees only the pre-existing measures when it loads.

## Recipe

### 1. Auto-connect the semantic model

Call `pbi_report_info` → derive the sibling `.SemanticModel/definition` path → call `mcp__powerbi-modeling__connection_operations` with `{ operation: "ConnectFolder", folderPath: "<derived path>" }`. Treat "already connected" as success. If no model is reachable AND the user wants a model-level measure, stop and tell them — measures can't be written without a model. (Visual calcs do not require a model.)

### 2. Parse the intent

Classify the request along three axes. Don't ask the user — infer from their phrasing, and only ask back if the intent is genuinely ambiguous after step 3.

| Axis | Options | How to read it |
|---|---|---|
| Pattern | identity-aggregation / time-comparison / period-to-date / rolling-window / vs-target / share-of-total / running-total / ratio / count-distinct / custom | "YoY", "MoM", "QoQ", "vs prior year/month/quarter" → time-comparison. "YTD/MTD/QTD" or "year/month/quarter to date" → period-to-date. "rolling 3 month", "trailing 12" → rolling-window. "vs target/budget/plan/goal" → vs-target. "% of total / share of" → share-of-total. "running total / cumulative" → running-total. "ratio of A to B" → ratio. "distinct count / unique X" → count-distinct. "sum/avg/min/max of X" with no other qualifier → identity-aggregation. Anything else → custom. |
| Output kind | absolute-delta / percent-change / cumulative-value / aggregated-value / ratio-value | "YoY delta" without "%" → absolute-delta. "YoY", "growth", "% change" → percent-change. "YTD/rolling/running total" → cumulative-value. "share of" / "% of" → ratio-value (formatted as percent). Plain sum/avg/min/max → aggregated-value. |
| Scope | model-level / visual-scoped | Default is **model-level** unless the user said "for this visual", "just on this chart", "only on this table", or the calc references row context that only makes sense inside a single visual (e.g. "% of current row's total" inside a matrix). Model-level wins on tie — it's reusable. |

### 3. Resolve the base inputs from the model

For each input the pattern needs, decide kind via the modeling MCP — never guess from a name.

- `measure_operations({ operation: "List" })` → names that came back are **measures** (kind = `measure`).
- `table_operations({ operation: "GetSchema", references: [...] })` → names from `columns[]` are **columns** (kind = `column`); look at each column's `summarizeBy` to know the default aggregator.

If the base operand is a **column** with `summarizeBy != "None"`, the synthesized DAX must wrap it with the matching aggregator (`SUM`, `AVERAGE`, `COUNTROWS`/`COUNT`/`DISTINCTCOUNT`, `MIN`, `MAX`) — Power BI does not auto-aggregate inside DAX. If the base operand is already a **measure**, reference it bare in square brackets.

If the user named a base that doesn't exist on either list, stop and report which names are real — do not invent.

### 4. Detect the date dimension (only for time-comparison / period-to-date / rolling-window patterns)

Time intelligence needs a date column. Find one in this order:

1. **Marked date table.** `table_operations({ operation: "List" })` → look for a table flagged `isMarkedAsDateTable: true`. If present, use its primary date column.
2. **Explicit Date table by convention.** A non-hidden table whose name is `Date`, `Calendar`, `Dim Date`, `Dates`, etc. with a `dateTime`/`date` column. Prefer this over the fact table's own date column.
3. **Auto date hierarchy (`LocalDateTable_*`).** Skip these — they are hidden auto-generated tables and don't support `DATEADD` / `SAMEPERIODLASTYEAR` cleanly across measures. Surface a warning: "Model has only auto date hierarchy; time intelligence will use `<FactTable>[<DateCol>]` directly which may give incorrect results across non-contiguous dates. Recommend adding a proper Date table."
4. **Fact-table date column fallback.** If nothing else, use the most date-typed column on the main fact table — and surface the same warning as above.

Capture the resolved date reference as `<DateTable>[<DateCol>]` for use in templates.

### 5. Synthesize the DAX

Compose from the pattern + resolved inputs. The library below is illustrative — adapt names and references to what you actually resolved. Use VAR for readability when there are intermediate values. Reference columns as `Table[Column]` and measures as `[Measure]`.

#### Identity aggregation (no model measure exists yet)
```dax
TotalSales = SUM ( MyTable[SalesAmount] )
DistinctCustomers = DISTINCTCOUNT ( MyTable[CustomerKey] )
```

#### Time comparison — YoY / MoM / QoQ
```dax
-- absolute delta
[BaseMeasure]_YoY_Delta =
VAR _PY = CALCULATE ( [BaseMeasure], SAMEPERIODLASTYEAR ( MyDate[Date] ) )
RETURN [BaseMeasure] - _PY

-- percent change
[BaseMeasure]_YoY =
VAR _Curr = [BaseMeasure]
VAR _PY   = CALCULATE ( [BaseMeasure], SAMEPERIODLASTYEAR ( MyDate[Date] ) )
RETURN DIVIDE ( _Curr - _PY, _PY )
```

For MoM/QoQ swap `SAMEPERIODLASTYEAR` for `DATEADD ( MyDate[Date], -1, MONTH )` or `-1, QUARTER`.

#### Period-to-date — YTD / MTD / QTD
```dax
[BaseMeasure]_YTD = TOTALYTD ( [BaseMeasure], MyDate[Date] )
[BaseMeasure]_MTD = TOTALMTD ( [BaseMeasure], MyDate[Date] )
[BaseMeasure]_QTD = TOTALQTD ( [BaseMeasure], MyDate[Date] )
```

#### Rolling window — trailing N months / days
```dax
[BaseMeasure]_Rolling3M =
CALCULATE (
    [BaseMeasure],
    DATESINPERIOD ( MyDate[Date], LASTDATE ( MyDate[Date] ), -3, MONTH )
)
```
Swap unit (`DAY`/`MONTH`/`QUARTER`/`YEAR`) and count to match.

#### Vs target
```dax
[BaseMeasure]_VsTarget = [BaseMeasure] - [TargetMeasure]
[BaseMeasure]_AttainmentPct = DIVIDE ( [BaseMeasure], [TargetMeasure] )
[BaseMeasure]_VsTargetPct = DIVIDE ( [BaseMeasure] - [TargetMeasure], [TargetMeasure] )
```

#### Share of total
```dax
-- share of total within a specific dimension (filter context cleared on that one column)
[BaseMeasure]_PctOfTotal =
DIVIDE (
    [BaseMeasure],
    CALCULATE ( [BaseMeasure], REMOVEFILTERS ( MyDim[MyCol] ) )
)
-- share of grand total (filter context cleared on the whole table)
[BaseMeasure]_PctOfGrandTotal =
DIVIDE (
    [BaseMeasure],
    CALCULATE ( [BaseMeasure], REMOVEFILTERS ( MyDim ) )
)
```

#### Running total
```dax
[BaseMeasure]_RunningTotal =
CALCULATE (
    [BaseMeasure],
    FILTER (
        ALLSELECTED ( MyDate[Date] ),
        MyDate[Date] <= MAX ( MyDate[Date] )
    )
)
```

#### Ratio
```dax
[A_to_B_Ratio] = DIVIDE ( [MeasureA], [MeasureB] )
```

Use `DIVIDE(...)` rather than `/` everywhere — it returns BLANK on /0 instead of an error.

### 6. Pick a measure name

Convention: `<BaseMeasure>_<Suffix>` for time intelligence and ratios so they sort together with the base.

| Pattern | Suffix |
|---|---|
| YoY % | `_YoY` |
| YoY delta | `_YoY_Delta` |
| MoM % | `_MoM` |
| QoQ % | `_QoQ` |
| YTD/MTD/QTD | `_YTD` / `_MTD` / `_QTD` |
| Rolling N months | `_RollingNM` (e.g. `_Rolling3M`) |
| Vs Target absolute | `_VsTarget` |
| Vs Target % | `_VsTargetPct` |
| Attainment % | `_Attainment` |
| Share of total | `_PctOfTotal` (or `_ShareOfTotal`) |
| Running total | `_RunningTotal` |
| Distinct count | `<Plural>` (e.g. `DistinctCustomers`, `UniqueOrders`) |
| Identity sum | `Total<Singular>` (e.g. `TotalAmount`) |

If the user proposed a name, honor it.

### 7. Pick a format string (CRITICAL — wrong shape silently breaks every card)

DAX format strings get passed verbatim to `measure_operations.Create` as the `formatString` argument and end up in TMDL. **Microsoft's modeling MCP triple-quotes any value that contains special characters without proper backslash escaping**, which makes Power BI render the format string AS LITERAL TEXT in cards (e.g. you see `$#,0;($#,0);$#,0` on the card instead of `$2,326,534`). Use the **bare-token TMDL shape** below — every literal currency symbol or punctuation needs a backslash escape:

| Output kind | formatString to pass (string value) |
|---|---|
| Percent change / share / attainment | `0.0%;-0.0%;0.0%` |
| Currency, whole | `\$#,0;(\$#,0);\$#,0` |
| Currency with cents | `\$#,##0.00;(\$#,##0.00);\$#,##0.00` |
| Currency, max precision (matches Desktop's Currency.Type default) | `\$#,0.###############;(\$#,0.###############);\$#,0.###############` |
| Whole-number count | `#,##0` |
| Decimal | `#,##0.00` |
| Delta (signed) | inherit from base — if base is currency, use the matching currency format above |

**Rules:**
- Always `\$` (escaped dollar), never `$` or `"$"` — the modeling MCP wraps strings with raw `$` in triple quotes which corrupts the format on disk.
- Always semicolons between positive / negative / zero sections (3 sections), never just one section — Power BI's negative formatting needs all three.
- For percent, no `\` needed: `%` is bare-token-safe.
- For non-USD currency, swap `\$` for the right escape (`\€`, `\£`, `\¥`); same backslash rule applies.

**Sanity check after Create:** read the host table's `.tmdl` and grep your new measure. The line should look like the existing measures on the same table — bare tokens, no `"""triple quotes"""`. If you see triple quotes, the formatString was passed in the wrong shape and the card will display literal text. Fix by calling `measure_operations.Update` with a corrected formatString.

If the base measure already has a sensible `formatString`, reuse it verbatim unless the new output kind is a percent.

### 8. Call the right tool

**Model-level (default):**
```
mcp__powerbi-modeling__measure_operations({
  operation: "Create",
  table: "<HostTable>",                    // host table for the measure; usually the fact table the base lives on
  name: "<MeasureName>",
  expression: "<DAX>",
  formatString: "<format>",
  description: "<one-line intent — what the user asked for, in their words>"
})
```
Pick the host table by these rules in order:
1. If the user said "add it to <Table>" → that table.
2. Else if the base operand is a measure → its host table (from `measure_operations.List`).
3. Else if the base operand is a column → that column's table.
4. Else → the model's main fact table.

**Visual-scoped (only when the scope axis resolved to visual-scoped):**
```
mcp__pbi-report__pbi_visual_calc_add({
  page: "<pageId>",
  name: "<visualId>",
  calcName: "<MeasureName>",
  expression: "<DAX>"
})
```
Visual calcs don't take a `formatString` here — Desktop infers one. They live in the visual's `visualCalculations[]` block and only resolve inside that visual's row/filter context.

If you don't know which visual the user means, list candidates with `pbi_visual_list` and ask. If there are multiple plausible visuals AND the user didn't specify, **prefer model-level** so the measure is reusable.

### 9. Persist to disk (REQUIRED for model-level measures)

For every model-level `measure_operations.Create` you ran, call `database_operations({ operation: "ExportToTmdlFolder", tmdlFolderPath: "<connectFolder's folderPath, ending in /definition>" })` exactly once at the end of the batch (one export covers all writes in the session). For visual-scoped calcs (`pbi_visual_calc_add`), skip this — visual calcs live in the PBIR `.Report` JSON and are persisted by our own MCP tool synchronously.

If the export call fails, surface the error verbatim — the measure exists in the session but won't survive Desktop reload, so the user needs to know.

### 9.5. Run pbi-model-doctor — HARD GATE (zero errors required)

For every model-level measure batch, after export, before declaring done, this step is **non-optional and non-skippable**:

```
Agent(pbi-model-doctor) with:
  modelPath: "<connectFolder's data.folderPath — the definition/ subfolder>"
```

(No `bridgeIntent` needed unless you just wrote bridging measures.) This catches the silent-but-fatal failures that `measure_operations.Create` reports as success:
- **FMT002** — formatString was wrapped in triple quotes (Desktop will render the literal mask as text on every card).
- **NAM001** — measure name collides with a column on its host table (binding will be ambiguous).
- **DAX001** — measure uses `/` instead of `DIVIDE()` (divide-by-zero risk).
- **DAX005** — the synthesized DAX references a name that doesn't exist (you invented a column or measure).

**Hard-gate rule:**
- `summary.errors == 0` → proceed to step 10.
- `summary.errors > 0` AND the error is on a measure you just created → FIX it now. Re-run `measure_operations.Update`, re-export, re-run pbi-model-doctor. Loop until clean.
- `summary.errors > 0` AND the error is on a measure you did NOT create → surface to caller but do not block (it was pre-existing).

Do NOT declare success while errors on your own measures remain. The scaffold reading your output will start binding visuals; if your measure has FMT002 / NAM001 / DAX005, every bound visual will be silently wrong in Desktop.

For visual-scoped calcs (`pbi_visual_calc_add`), skip this step — visual calcs aren't in TMDL.

### 10. Verify and report

After `Create` + export, re-call `measure_operations({ operation: "List" })` and confirm the new name appears. For model-level measures, ALSO `grep` (or `Read`) the host table's `.tmdl` file under `<folderPath>/tables/` to confirm the measure landed on disk — the List call only confirms the session, not disk. For visual calcs, call `pbi_visual_calc_list(page, name)`. If the create returned a DAX error, surface the engine's exact message — don't paraphrase — and stop.

Output a tight summary:

```
Created measure: <Table>[<Name>]
Expression:
  <one-line DAX>
Format: <formatString>
Scope: model-level (reusable) | visual-scoped (this visual only)
Persisted: ExportToTmdlFolder ✓ (or "visual calc — no export needed")
```

If the new measure is the kind users typically want to bind to a card right away (e.g. they just asked "show me YoY"), offer the next step ("want me to add a card for it?") — don't bind silently.

## Boundaries

- **No measure soup.** If the user said "show me deltas" and 3 base measures are visible, ask which one(s) — don't auto-create 3 measures.
- **No silent renames.** If a measure with the chosen name already exists, ask before overwriting (`measure_operations.Update`) or pick a `_v2` suffix if the user said "just create it".
- **No invented columns / measures (HARD RULE — no exceptions).** Before `measure_operations.Create`, every `Table[Column]` and `[Measure]` reference in the synthesized DAX MUST be verified to exist via `column_operations.GetColumns({ table: "<table>" })` or `measure_operations.List`. If any referenced name does NOT exist, **STOP and surface the gap to the user with concrete options**:
  ```
  I can't create this measure as-stated. Your request implies a measure like:
    Outcome Goal = SUM(Plan[Outcome Goal])
  but Plan has no `Outcome Goal` column. Options:
    (a) skip this measure on this dashboard
    (b) you add an Outcome Goal column to Plan and reload
    (c) you give me an explicit formula (e.g. SUM(Plan[Planned Amount]) * 0.15) and I'll create the measure with description="Proxy — supplied by user. Replace when real data is available."
  Which would you like?
  ```
  NEVER invent a fudge factor (15%, 10%, "industry average") silently. NEVER bury the disclosure in a footnote of the final summary. The user must explicitly choose (c) AND supply the formula AND the resulting measure must have its `description` flag the proxy permanently in TMDL.
- **Use MCP tools, not shell.** All model reads/writes go through `mcp__powerbi-modeling__*` and `mcp__pbi-report__*`. Never `cat`/`grep`/`py`/`jq`/`sed` to inspect or mutate TMDL or PBIR — disk reads return stale or post-write content and lie to you. Bash is reserved for git, build, and operations outside the report/model surface.
- **Don't bind visuals here.** Creation only — binding lives in `pbi-visuals` or the scaffold skills.
- **Don't create relationships.** If the chosen date table has no relationship to the fact table the base lives on, surface that and stop — `pbi-data-architect` handles relationship synthesis.
