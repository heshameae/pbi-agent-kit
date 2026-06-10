# DAX Query Rules

Valid-query authoring rules: syntax, SUMMARIZECOLUMNS vs SUMMARIZE, CALCULATE filter constraints, ORDER BY, and common anti-patterns.

**Source:** ruiromano powerbi-agentic-plugins dax-query-guidelines.md

**Identifier guard:** Concrete table, column, and measure names in examples are illustrative only. Production DAX must resolve identifiers from live model metadata, deterministic planner output, the validated user spec, or explicit user confirmation; never copy example names into a user model.

---

## Comments

Use `//` for DAX comments. `--` is SQL syntax and is NOT valid in DAX.

```dax
// This is a valid DAX comment
-- This is NOT valid DAX
```

---

## Query Structure

### DEFINE Block

- Use `DEFINE` at the beginning only if the query includes `VAR`, `MEASURE`, `COLUMN`, or `TABLE` definitions
- Only one `DEFINE` block per query
- Separate definitions with new lines — no commas or semicolons between them

### Measure Definitions in DEFINE

When defining a measure in a query's `DEFINE` block, always fully qualify the name including its host table:

```dax
-- Correct definition
DEFINE MEASURE 'TableName'[MeasureName] = SUM('TableName'[Column])

-- When using: reference by name only (no table qualifier)
EVALUATE
SUMMARIZECOLUMNS('Product'[Category], "Total", [MeasureName])
```

### ORDER BY

Always include an `ORDER BY` clause when `EVALUATE` returns multiple rows. Do not use the `ORDERBY` function to sort the final query result.

---

## SUMMARIZECOLUMNS

The default for any query that combines groupby columns with measure-like calculations.

**Parameter order** (all optional, but must follow this order if used):
1. Groupby columns (from one or multiple tables)
2. Filters
3. Measure-like calculations (named with `"ColumnAlias", expr`)

**Key rules:**
- Returns only rows where at least one measure value is not BLANK
- Do NOT use boolean filters directly with SUMMARIZECOLUMNS — wrap them in CALCULATETABLE (see DAX009 in `dax-performance.md`)
- Do not use SUMMARIZECOLUMNS without at least one measure-like extension column

---

## SUMMARIZE

Use only to extract distinct combinations of columns. **Never use SUMMARIZE with measure-like expressions.**

```dax
-- Correct: distinct combinations only
SUMMARIZE('Sales', 'Sales'[Year], 'Sales'[Region])

-- Wrong: measure-like expression in SUMMARIZE
SUMMARIZE('Sales', 'Sales'[ProductKey], "TotalProfit", [Profit])  -- use SUMMARIZECOLUMNS instead

-- Shortcut: single column
VALUES('Sales'[Region])  -- equivalent to SUMMARIZE('Sales', 'Sales'[Region])

-- From a table variable: must use SUMMARIZE, not direct column reference
SUMMARIZE(_TableVar, [Column])  -- NOT _TableVar[Column] (invalid syntax)
```

---

## GROUPBY

Use only with a table-valued variable as the first argument.

```dax
-- Correct: table variable as first argument
VAR _Base = SUMMARIZECOLUMNS('Product'[Category], "@Revenue", SUM('Sales'[Amount]))
RETURN GROUPBY(_Base, [Category], "MaxRevenue", MAXX(CURRENTGROUP(), [@Revenue]))
```

**Rules:**
- `CURRENTGROUP()` is valid ONLY within `GROUPBY`
- Do not use `CURRENTGROUP` anywhere else

---

## SELECTCOLUMNS

Use to project columns while preserving duplicate rows, or to rename columns.

```dax
EVALUATE
SELECTCOLUMNS(
    'Sales',
    "Order ID", 'Sales'[OrderID],
    "Amount",   'Sales'[Amount]
)
ORDER BY [Amount] DESC
```

**Important:** When you rename columns via `SELECTCOLUMNS`, all subsequent operations (`ORDER BY`, `FILTER`, `TOPN`) must use the **new** column names, not the original ones.

---

## CALCULATE and CALCULATETABLE Filter Rules

Boolean filters in `CALCULATE` or `CALCULATETABLE` have these restrictions:

- Cannot directly use a measure or another `CALCULATE` as a filter argument — use a variable instead
- Cannot reference columns from two different tables in a single boolean filter argument
- When using the `IN` operator, the table operand must be a **table variable**, not an inline table expression
- Do not assign a boolean filter to a `VAR` definition

```dax
-- Wrong: measure reference as boolean filter
CALCULATE([Total Revenue], [Profit Margin] > 0.3)

-- Correct: materialize to variable first
VAR _Margin = [Profit Margin]
RETURN CALCULATE([Total Revenue], _Margin > 0.3)

-- Wrong: cross-table predicate in one filter argument
CALCULATE([Revenue], 'Date'[Year] = 2023 && 'Product'[Category] = "Bikes")

-- Correct: separate filter arguments
CALCULATE([Revenue], 'Date'[Year] = 2023, 'Product'[Category] = "Bikes")
```

---

## Set Functions (INTERSECT, UNION, EXCEPT)

Both input tables must produce an identical number of columns.

```dax
-- Both sides must have same column count
UNION(
    SELECTCOLUMNS('Table1', "Key", [KeyCol]),
    SELECTCOLUMNS('Table2', "Key", [KeyCol])
)
```

---

## Time Intelligence in Queries

### Date Context

Always establish a valid date context before calling time intelligence functions:

```dax
-- Correct: date column in groupby provides date context
EVALUATE
SUMMARIZECOLUMNS('Date'[Year], "Revenue YTD", [Revenue YTD])

-- Correct: external filter via CALCULATETABLE when using ROW
EVALUATE
CALCULATETABLE(
    ROW("Revenue YTD", [Revenue YTD]),
    'Date'[Year] = 2024
)

-- Wrong: no date context — TI functions return BLANK
EVALUATE
ROW("Revenue YTD", [Revenue YTD])
```

### DATESINPERIOD Off-by-One

The negative period offset must exactly match the window size required — no shortcut:

```dax
-- Correct: 12-month rolling window
DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -12, MONTH)

-- Wrong: -11 gives only 11 months
DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -11, MONTH)
```

---

## Variable Naming

All variable names must start with `_`:

```dax
VAR _Total    = SUM('Sales'[Amount])
VAR _Prior    = CALCULATE([Total Revenue], SAMEPERIODLASTYEAR('Date'[Date]))
VAR _Ratio    = DIVIDE(_Total, _Prior)
RETURN _Ratio
```

---

## DIVIDE vs. Division Operator

| Context | Rule |
|---|---|
| General use, denominator may be zero | `DIVIDE(numerator, denominator)` — safe zero protection |
| Inside row iterators (SUMX, AVERAGEX), denominator guaranteed non-zero | `/` operator — avoids FE callback (see DAX018) |
| Never use `IFERROR(expr / denom, 0)` | Wraps entire expression in FE callback — use `DIVIDE()` instead |
