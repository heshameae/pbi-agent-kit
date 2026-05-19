---
description: Reference library of time-comparison DAX patterns for Power BI — YoY, MoM, QoQ, WoW, period-to-date (YTD/MTD/QTD), rolling N-period averages, period-over-period absolute deltas, growth %, and CAGR. Knows which patterns require a marked Date table vs work with auto-generated `LocalDateTable_*` vs need the fact table's own date column, and adapts the DAX accordingly. Use when the user asks for any "vs last year/month/quarter/week", "year-to-date", "rolling 12", "trailing 90 days", "growth rate", or any other time-shifted comparison.
allowed-tools: mcp__powerbi-modeling__connection_operations mcp__powerbi-modeling__table_operations mcp__powerbi-modeling__column_operations mcp__powerbi-modeling__measure_operations
---

# Date intelligence patterns

A **reference and detector**. The detector picks the right date source for the model in front of you; the reference shows the DAX patterns. Pair with `pbi-measure-architect` — this skill provides the templates, the architect creates the measure.

## Step 1 — Detect the date source

Run this once per session and cache the answer.

### a. Marked Date table

Call `table_operations({ operation: "List" })`. Look for a table where `isMarkedAsDateTable: true` (the modeling MCP returns this flag). If present:
- Capture `<DateTable>`, then `column_operations({ operation: "GetColumns", table: "<DateTable>" })` and pick the column flagged as the date key (usually `dataType: "dateTime"` and the lone non-derived date column).
- This is the **best** source. All patterns below work as written.

### b. Conventional Date table (not marked)

If no marked table exists, look for a non-hidden user-created table whose name matches `Date`, `Calendar`, `Dim Date`, `Dates`, `dimDate` and contains a continuous `dateTime` column. Use that table's date column.
- Patterns work, but `TOTALYTD` / `SAMEPERIODLASTYEAR` rely on Power BI inferring contiguous dates; usually fine.

### c. Auto-generated date hierarchy (`LocalDateTable_*`)

These are hidden tables Power BI creates per fact-table date column when "Auto date/time" is on. They aren't usable directly in DAX from a measure (anonymous names, generated relationships). If only these exist:
- Use the **fact table's own date column** directly. Warn the user: "Model has only auto date hierarchy — recommend a proper Date table for full time intelligence."
- `TOTALYTD([M], MyFact[OrderDate])` works against the raw column but only across dates that appear in the fact data; gaps will silently break running calculations.

### d. No date column at all

Stop. Time intelligence is impossible. Tell the user the model needs a date dimension first.

## Step 2 — Pattern reference

Replace `MyDate[Date]` with the date reference you resolved in step 1, and `[BaseMeasure]` with the user's base. Names in `<...>` are placeholders.

### Year-over-year

```dax
-- YoY % change
<Base>_YoY =
VAR _Curr = [<Base>]
VAR _PY   = CALCULATE ( [<Base>], SAMEPERIODLASTYEAR ( MyDate[Date] ) )
RETURN DIVIDE ( _Curr - _PY, _PY )

-- YoY absolute delta
<Base>_YoY_Delta =
[<Base>] - CALCULATE ( [<Base>], SAMEPERIODLASTYEAR ( MyDate[Date] ) )

-- Same as YoY but explicit on the parallel-period function (works when SAMEPERIODLASTYEAR can't infer)
<Base>_PY =
CALCULATE ( [<Base>], PARALLELPERIOD ( MyDate[Date], -12, MONTH ) )
```

### Month-over-month / Quarter-over-quarter / Week-over-week

```dax
<Base>_MoM =
VAR _PM = CALCULATE ( [<Base>], DATEADD ( MyDate[Date], -1, MONTH ) )
RETURN DIVIDE ( [<Base>] - _PM, _PM )

<Base>_QoQ =
VAR _PQ = CALCULATE ( [<Base>], DATEADD ( MyDate[Date], -1, QUARTER ) )
RETURN DIVIDE ( [<Base>] - _PQ, _PQ )

-- WoW (DATEADD doesn't support WEEK; use DATESINPERIOD or arithmetic)
<Base>_WoW =
VAR _PW = CALCULATE ( [<Base>], DATEADD ( MyDate[Date], -7, DAY ) )
RETURN DIVIDE ( [<Base>] - _PW, _PW )
```

Swap `DIVIDE(... - ..., ...)` for `[<Base>] - _PM` to get the absolute delta version.

### Period-to-date

```dax
<Base>_YTD = TOTALYTD ( [<Base>], MyDate[Date] )
<Base>_MTD = TOTALMTD ( [<Base>], MyDate[Date] )
<Base>_QTD = TOTALQTD ( [<Base>], MyDate[Date] )
```

For non-calendar fiscal years, pass the year-end as the third arg:
```dax
<Base>_FYTD = TOTALYTD ( [<Base>], MyDate[Date], "06/30" )   -- fiscal year ending June 30
```

### Rolling N-period window

```dax
-- Trailing N months including current
<Base>_Rolling3M =
CALCULATE (
    [<Base>],
    DATESINPERIOD ( MyDate[Date], LASTDATE ( MyDate[Date] ), -3, MONTH )
)

-- Trailing 12 months — a.k.a. R12 / TTM
<Base>_R12 =
CALCULATE (
    [<Base>],
    DATESINPERIOD ( MyDate[Date], LASTDATE ( MyDate[Date] ), -12, MONTH )
)

-- Trailing N days
<Base>_Rolling30D =
CALCULATE (
    [<Base>],
    DATESINPERIOD ( MyDate[Date], LASTDATE ( MyDate[Date] ), -30, DAY )
)
```

For a **moving average** (mean across the window), wrap with AVERAGE-style math:
```dax
<Base>_MovAvg3M =
DIVIDE (
    CALCULATE (
        [<Base>],
        DATESINPERIOD ( MyDate[Date], LASTDATE ( MyDate[Date] ), -3, MONTH )
    ),
    3
)
```

### Running totals (cumulative within a selected range)

```dax
<Base>_RunningTotal =
CALCULATE (
    [<Base>],
    FILTER (
        ALLSELECTED ( MyDate[Date] ),
        MyDate[Date] <= MAX ( MyDate[Date] )
    )
)
```

### CAGR (compound annual growth rate)

```dax
<Base>_CAGR =
VAR _Start    = CALCULATE ( [<Base>], FIRSTDATE ( MyDate[Date] ) )
VAR _End      = CALCULATE ( [<Base>], LASTDATE  ( MyDate[Date] ) )
VAR _Years    = DATEDIFF ( FIRSTDATE ( MyDate[Date] ), LASTDATE ( MyDate[Date] ), YEAR )
RETURN IF ( _Start > 0 && _Years > 0, ( _End / _Start ) ^ DIVIDE ( 1, _Years ) - 1 )
```

## Step 3 — Hand off to `pbi-measure-architect`

This skill produces templates; `pbi-measure-architect` is the one that actually creates the measure. The hand-off is:

1. Pick the template that matches the user's intent.
2. Substitute the resolved date reference + base measure name.
3. Pass the resulting DAX and a suggested name to `pbi-measure-architect` (which handles `formatString`, the `measure_operations.Create` call, and verification).

## Format strings by output kind

`pbi-measure-architect` will pick these; documented here so the chosen template + format match.

| Pattern | formatString |
|---|---|
| YoY/MoM/QoQ/WoW %, growth, CAGR | `"0.0%;-0.0%;0.0%"` |
| YoY/MoM/QoQ delta (absolute, currency base) | inherit base currency format |
| YTD/MTD/QTD/Rolling sum (currency base) | inherit base currency format |
| Running total (count base) | `"#,##0"` |
| Moving average (currency base) | `"\"$\"#,##0.00;-\"$\"#,##0.00;\"$\"#,##0.00"` |

## Common pitfalls

- **`SAMEPERIODLASTYEAR` silently returns blank** if the date column isn't continuous or isn't from a marked date table. If the result looks wrong, switch to `DATEADD ( MyDate[Date], -1, YEAR )` as a fallback.
- **`DATEADD` requires the column to have all dates** in the range. A fact table's date column with gaps (no row for Sundays) will produce wrong shifts. Marked date tables avoid this.
- **`TOTALYTD` against a fiscal year** needs the third argument; otherwise it assumes calendar year.
- **`DIVIDE` vs `/`** — always `DIVIDE` for percent/ratio output. `_PY` is BLANK on first period of data → `/0` errors otherwise.
- **Auto date hierarchy ambiguity** — when a fact table has multiple date columns and "Auto date/time" is on, every one gets its own `LocalDateTable_*`. Filter context can be unpredictable; recommend a single proper Date table.

## What this skill does NOT do

- Create measures (that's `pbi-measure-architect`).
- Bind to visuals (that's `pbi-visuals` / scaffolds).
- Create or mark Date tables — surface the problem; the user does the modeling fix in Desktop or via the modeling MCP's `table_operations`.
