# DAX Performance — Pattern Catalog (DAX001–021)

Tier 1 DAX optimization patterns. Auto-apply freely — modify only measure definitions, never the EVALUATE clause or SUMMARIZECOLUMNS grouping columns.

**Source:** ruiromano powerbi-agentic-plugins · dg3-semantic-models (cross-check)

---

## Decision Guide — Where to Start

| Signal in trace / expression | Start With |
|---|---|
| `CallbackDataID` or `EncodeCallback` in xmSQL | DAX002, DAX007, DAX008, DAX018 (highest priority) |
| `ADDCOLUMNS` or `SUMMARIZE` in measure | DAX002, DAX006 |
| `SUMMARIZE` with complex/filtered table as first arg | DAX005 |
| `SUMX(VALUES(col), CALCULATE(...))` in measure | DAX006 |
| Same measure evaluated multiple times | DAX003 |
| Duplicate or redundant `CALCULATE` filter predicates | DAX004 |
| `FILTER(Table, ...)` as `CALCULATE` arg, or `&&` joining predicates | DAX001 |
| `ALL(table), VALUES(table[col])` in same `CALCULATE` | DAX012 |
| `TREATAS`/filter passed directly into `SUMMARIZECOLUMNS` | DAX009 |
| SE rows far exceed final result count | DAX010 |
| `DISTINCTCOUNT` in measure | DAX011, DAX014 |
| `IF`/`IIF` or `DIVIDE()` inside row iterator | DAX007, DAX018 |
| `SWITCH`/`IF` as primary expression body | DAX013 |
| Multiple SE queries hitting same fact table | DAX019 (vertical fusion), DAX020 (horizontal), DAX017 (boolean multiplier) |
| Near-identical SE queries differing only by column filter value / per-measure VAND tuple predicates | DAX017 |
| Bidirectional or M2M relationship + SE join expansion | DAX016 |
| High-cardinality iterator (low-cardinality attribute) | DAX015 |
| `TREATAS`/`IN` re-filtering same fact with computed key set | DAX021 |

---

## Engine Model (Key Concepts)

**Formula Engine (FE):** Single-threaded. Handles all DAX — branching, context transitions, measure evaluation. The bottleneck in poorly written queries.

**Storage Engine (SE):** Multi-threaded. Reads compressed columnar VertiPaq data. Supports only: four arithmetic operators, GROUP BY, LEFT OUTER JOINs, basic aggregations. Callbacks occur when the SE must evaluate an expression beyond its native capability — row-by-row FE evaluation, kills performance.

**Optimization goal:** Push as much work as possible into the SE, minimize SE scans, eliminate callbacks entirely.

**Vertical fusion:** Multiple measure aggregations on the same fact table under the same filter → merged into one SE scan. Blocked by: TI functions, per-measure filter predicates, SWITCH/IF between measures.

**Horizontal fusion:** N near-identical SE queries differing only by one column filter → merged into one scan. Blocked by: filtered column absent from groupby, table-valued per-measure filters, runtime-computed filter values.

---

## DAX001: Simple Column Filter Predicates in CALCULATE

FILTER with a table expression is an iterator — unnecessary when a simple boolean predicate works.

```dax
-- Anti-pattern: FILTER iterator
CALCULATE(SUM('Sales'[Amount]), FILTER('Product', 'Product'[Category] = "Electronics"))

-- Preferred: column predicate, no iterator
CALCULATE(SUM('Sales'[Amount]), KEEPFILTERS('Product'[Category] = "Electronics"))

-- Anti-pattern: && joins predicates into a single iterator
CALCULATETABLE('Sales', 'Sales'[Region] = "West" && 'Sales'[Amount] > 1000)

-- Preferred: separate predicates
CALCULATETABLE('Sales', 'Sales'[Region] = "West", 'Sales'[Amount] > 1000)
```

---

## DAX002: Replace ADDCOLUMNS/SUMMARIZE with SUMMARIZECOLUMNS

SUMMARIZECOLUMNS enables better SE fusion and is the preferred table expression for groupby + calculation.

```dax
-- Anti-patterns (all equivalent, all suboptimal)
SUMMARIZE('Sales', 'Sales'[ProductKey], "Profit", [Profit])
ADDCOLUMNS(SUMMARIZE('Sales', 'Sales'[ProductKey]), "Profit", [Profit])
ADDCOLUMNS(VALUES('Sales'[ProductKey]), "Profit", [Profit])

-- Preferred
SUMMARIZECOLUMNS('Sales'[ProductKey], "Profit", [Profit])
```

---

## DAX003: Cache Repeated and Context-Independent Expressions in Variables

Evaluating the same measure multiple times or placing context-independent expressions inside iterators causes redundant SE queries.

```dax
-- Anti-pattern: repeated measure reference
VAR TotalA = [Sales Amount] * 1.1
VAR TotalB = [Sales Amount] * 0.9

-- Preferred: cache once
VAR _SalesAmount = [Sales Amount]
VAR TotalA = _SalesAmount * 1.1
VAR TotalB = _SalesAmount * 0.9

-- Anti-pattern: context-independent expression inside iterator
SUMX('Sales', 'Sales'[Quantity] * [Average Price] * 1.1)  -- [Average Price] doesn't change per row

-- Preferred
VAR _AvgPrice = [Average Price]
RETURN SUMX('Sales', 'Sales'[Quantity] * _AvgPrice * 1.1)
```

---

## DAX004: Remove Duplicate and Redundant Filters

Applying the same predicate twice causes redundant SE evaluation.

```dax
-- Anti-pattern: same predicate in CALCULATE + FILTER
CALCULATE(SUM('Sales'[Amount]), 'Sales'[Year] = 2023, FILTER('Sales', 'Sales'[Year] = 2023))

-- Preferred: single filter
CALCULATE(SUM('Sales'[Amount]), 'Sales'[Year] = 2023)
```

---

## DAX005: SUMMARIZE with Complex Table Expression

Use CALCULATETABLE to wrap complex table expressions as the first argument instead of putting them directly in SUMMARIZE.

```dax
-- Anti-pattern
SUMMARIZE(
    CALCULATETABLE('Sales', 'Sales'[Year] = 2023, 'Sales'[CustomerKey] IN SellingPOCs),
    'Sales'[CustomerKey],
    "DistinctSKUs", DISTINCTCOUNT('Sales'[StoreKey])
)

-- Preferred
CALCULATETABLE(
    SUMMARIZECOLUMNS('Sales'[CustomerKey], "DistinctSKUs", DISTINCTCOUNT('Sales'[StoreKey])),
    'Sales'[Year] = 2023,
    'Sales'[CustomerKey] IN SellingPOCs
)
```

---

## DAX006: Pre-Materialize Context Transitions with SUMMARIZECOLUMNS

Materializing context-transition results in SUMMARIZECOLUMNS and iterating over pre-calculated values can improve query plan.

```dax
-- Anti-pattern
SUMX(VALUES('Product'[Attribute]), CALCULATE(SUM('Sales'[Amount])))

-- Preferred
SUMX(
    SUMMARIZECOLUMNS('Product'[Attribute], "@Amount", SUM('Sales'[Amount])),
    [@Amount]
)
```

---

## DAX007: Replace IF with INT for Boolean Conversion

INT with boolean expressions avoids conditional logic callbacks that IF statements trigger inside iterators.

```dax
-- Anti-pattern: IF inside iterator → callback
SUMX('Products', IF([Sales Amount] > 10000000, 1, 0))

-- Preferred: INT keeps expression SE-native
SUMX('Products', INT([Sales Amount] > 10000000))

-- Best when the result is a row count: eliminate the iterator entirely
CALCULATE(COUNTROWS('Sales'), 'Sales'[Amount] > 1000)
```

---

## DAX008: Context Transition in Iterator

Context transition is expensive. Three remedies in priority order:

```dax
-- Remove it completely: compute directly from columns
-- Instead of: SUMX('Sales', [Sales Amount])
-- Use:        SUMX('Sales', 'Sales'[Unit Price] * 'Sales'[Quantity])

-- Reduce columns scanned
-- Instead of: SUMX('Account', [Total Sales])
-- Use:        SUMX(VALUES('Account'[Account Key]), [Total Sales])

-- Reduce cardinality before iteration
-- Instead of: SUMX('Account', [Total Sales] * 'Account'[Corporate Discount])
-- Use:        SUMX(VALUES('Account'[Corporate Discount]), [Total Sales] * 'Account'[Corporate Discount])
```

---

## DAX009: Wrap SUMMARIZECOLUMNS Filters with CALCULATETABLE

Filters (including TREATAS) passed directly as SUMMARIZECOLUMNS arguments can produce unexpected results. Wrap in CALCULATETABLE.

```dax
-- Anti-pattern
SUMMARIZECOLUMNS('Table'[Column], TREATAS({"Value"}, 'Table'[FilterColumn]), "@Calc", [Measure])

-- Preferred
CALCULATETABLE(
    SUMMARIZECOLUMNS('Table'[Column], "@Calc", [Measure]),
    'Table'[FilterColumn] = "Value"
)
```

---

## DAX010: Apply Filters Using CALCULATETABLE Instead of FILTER

CALCULATETABLE modifies filter context directly; FILTER iterates the table first.

```dax
-- Anti-pattern
FILTER('Sales', 'Sales'[Year] = 2023)

-- Preferred
CALCULATETABLE('Sales', 'Sales'[Year] = 2023)
```

---

## DAX011: Distinct Count Alternatives

When DISTINCTCOUNT is SE-bound and slow, SUMX(VALUES(...), 1) can force FE evaluation which is sometimes faster.

```dax
-- SE-bound (default)
DISTINCTCOUNT('Sales'[CustomerKey])

-- FE-bound alternative (test both)
SUMX(VALUES('Sales'[CustomerKey]), 1)
```

---

## DAX012: Use ALLEXCEPT Instead of ALL + VALUES Restoration

```dax
-- Anti-pattern
CALCULATE([Total Sales], ALL('Sales'), VALUES('Sales'[Region]))

-- Preferred
CALCULATE([Total Sales], ALLEXCEPT('Sales', 'Sales'[Region]))
```

> Only valid when `'Sales'[Region]` is actively filtered. Without an active filter, `VALUES` returns all regions (no-op restore) while `ALLEXCEPT` still clears other filters — not equivalent.

---

## DAX013: SWITCH/IF Branch Optimization in SUMMARIZECOLUMNS

Three things break SWITCH/IF branch optimization (causing full cartesian product materialization):

1. **Multiple aggregations in one branch** → merge into single SUMX
2. **Mismatched data types across branches** → use explicit `CONVERT(expr, CURRENCY)`
3. **Context transition inside a branch iterator** → cache context-independent measure in a variable before the iterator: `VAR _UnitDiscount = [Unit Discount]`

---

## DAX014: COUNTROWS Instead of DISTINCTCOUNT on Key Columns

When a column is a primary key (one-side of a relationship), DISTINCTCOUNT is redundant.

```dax
-- Anti-pattern
DISTINCTCOUNT('Product'[ProductKey])

-- Preferred
COUNTROWS('Product')
```

---

## DAX015: Move Calculation to Lower Granularity

When an iterator scans a high-cardinality table but the calculation depends on a low-cardinality attribute, iterate over the attribute instead.

```dax
-- Anti-pattern: 100K customers, 5 distinct DiscountRate values → 100K context transitions
SUMX('Customer', CALCULATE(SUM('Sales'[Amount])) * 'Customer'[DiscountRate])

-- Preferred: 5 iterations
SUMX(VALUES('Customer'[DiscountRate]), CALCULATE(SUM('Sales'[Amount])) * 'Customer'[DiscountRate])
```

---

## DAX016: Experiment with Relationship Overrides via TREATAS and CROSSFILTER

Test relationship direction changes without model modifications:

```dax
CALCULATE(
    SUM('Sales'[Amount]),
    CROSSFILTER('Customer'[CustomerKey], 'SportBridge'[CustomerKey], NONE),
    TREATAS(VALUES('SportBridge'[CustomerKey]), 'Customer'[CustomerKey])
)
```

---

## DAX017: Apply Boolean Multiplier to Unblock Fusion

**Signal:** Near-identical SE queries on the same fact table differing only by a column filter value or per-measure `VAND` tuple predicates on the same column.

**Fix:** Move the filter from SE to FE using `SUMX(KEEPFILTERS(ALL(Column)), expr * boolean)` — makes SE queries structurally identical so the engine fuses them.

```dax
-- Anti-pattern: separate SE query per measure
CALCULATE(SUM('Sales'[Amount]), 'Product'[Category] = "Bikes")

-- Fix: boolean multiplier → structurally identical SE queries → engine fuses
SUMX(KEEPFILTERS(ALL('Product'[Category])), CALCULATE(SUM('Sales'[Amount])) * ('Product'[Category] = "Bikes"))
```

> BLANK → 0 caveat: the boolean pattern returns 0 instead of BLANK when no data exists. Wrap with `IF(_r = 0, BLANK(), _r)` if ISBLANK checks matter downstream.

---

## DAX018: Replace DIVIDE with Division Operator in Iterators

DIVIDE() includes divide-by-zero protection that forces FE callbacks inside iterators. Use `/` only when the denominator is guaranteed non-zero.

```dax
-- Anti-pattern: DIVIDE() inside SUMX → callback
SUMX('Fact', 'Fact'[Base] * DIVIDE(RELATED('Items'[Discount]), RELATED('Items'[Adj])))

-- Preferred: native division, SE-native
SUMX('Fact', 'Fact'[Base] * (RELATED('Items'[Discount]) / RELATED('Items'[Adj])))
```

Pre-filter to exclude zeros: `CALCULATETABLE('Items', 'Items'[Adj] <> 0)`.

---

## DAX019: Lift Time Intelligence to Outer CALCULATE for Vertical Fusion

TI functions (DATESYTD, DATEADD, etc.) break vertical fusion — each TI-modified measure gets its own SE query. Keep base measures TI-free; apply TI once in an outer wrapper.

```dax
-- Anti-pattern: fusion blocked (each measure has its own TI)
MEASURE 'Sales'[Revenue YTD] = CALCULATE([Revenue], DATESYTD('Date'[Date]))
MEASURE 'Sales'[Cost YTD]    = CALCULATE([Cost],    DATESYTD('Date'[Date]))
MEASURE 'Sales'[Margin YTD]  = [Revenue YTD] - [Cost YTD]

-- Preferred: base measures fuse; TI applied once
MEASURE 'Sales'[Margin YTD] = CALCULATE([Revenue] - [Cost], DATESYTD('Date'[Date]))
```

> For custom TI using `CALCULATE(expr, Column = _var)` instead of built-in TI functions, use DAX017 instead.

---

## DAX020: Unblock Horizontal Fusion by Lifting Filters

Keep only simple column-slice filters inside base measures; lift TI and dynamic filters to an outer CALCULATE.

```dax
-- Anti-pattern: TI inside each slice measure → no fusion
MEASURE 'Sales'[Bikes YTD] = CALCULATE(SUM('Sales'[Amount]), 'Product'[Category] = "Bikes", DATESYTD('Date'[Date]))

-- Preferred: slice measures fuse; TI applied once
MEASURE 'Sales'[Bikes]        = CALCULATE(SUM('Sales'[Amount]), 'Product'[Category] = "Bikes")
MEASURE 'Sales'[Combined YTD] = CALCULATE([Bikes] + [Accessories], DATESYTD('Date'[Date]))
```

---

## DAX021: Pre-Compute and Join Instead of Filter Round-Trip

**Signal:** `VertiPaqSEQueryEnd` with `DEFINE TABLE ... ININDEX` or `WHERE ... IN` containing hundreds of compound tuples.

**Fix:** Pre-compute both aggregations independently at the shared key grain, then join with NATURALINNERJOIN in the FE.

```dax
-- Anti-pattern: TREATAS pushes key set back to SE, compounded by outer groupby
VAR _FilteredAgg = CALCULATETABLE(ADDCOLUMNS(VALUES('Fact'[Key]), "@Agg1", [Measure]), 'Dim'[Filter] = "X")
VAR _Qualifying  = FILTER(_FilteredAgg, [@Agg1] > 1000000)
VAR _Result      = CALCULATE([Measure], TREATAS(SELECTCOLUMNS(_Qualifying, "K", 'Fact'[Key]), 'Fact'[Key]))

-- Preferred: both aggregations pre-computed, joined in FE via shared lineage column
VAR _FilteredAgg   = CALCULATETABLE(ADDCOLUMNS(VALUES('Fact'[Key]), "@Agg1", [Measure]), 'Dim'[Filter] = "X")
VAR _Qualifying    = FILTER(_FilteredAgg, [@Agg1] > 1000000)
VAR _UnfilteredAgg = ADDCOLUMNS(VALUES('Fact'[Key]), "@Agg2", [Measure])
VAR _Joined        = NATURALINNERJOIN(_Qualifying, _UnfilteredAgg)
VAR _Result        = SUMX(_Joined, [@Agg2])
```

> Why it works: each pre-computed table generates an independent SE scan with no tuple filter. NATURALINNERJOIN matches on the shared `'Fact'[Key]` lineage column in the FE.

---

## Tier Boundaries

| Tier | Scope | Autonomy |
|---|---|---|
| **Tier 1 — DAX001–021** | Rewrite measure/UDF definitions only | Auto-apply. Never change EVALUATE/grouping. |
| **Tier 2 — Query Structure** | Modify EVALUATE, grain, filters | User approval required before applying |
| **Tier 3 — Model Changes** | Relationships, columns, agg tables | High caution. Suggest model copy. |
| **Tier 4 — Direct Lake** | OneLake layout, V-ordering | Requires ETL/pipeline changes outside the model. |

**Success criteria — Tier 1:** ≥10% duration improvement AND semantic equivalence (same row count, same column count, same data values).

---

## Tier 2 — Query Structure Patterns (QRY001–QRY004)

> **STOP — Requires user approval before applying any change. Explain the impact on query output and wait for explicit confirmation.**

> **Scope: Desktop-Achievable Changes Only**
>
> Every Tier 2 recommendation must map to an action the report author can perform in Power BI Desktop's UI. The agent optimizes the *generated* DAX query, but the user implements changes through the Desktop interface — not by editing DAX directly in the query pane. Examples of valid changes:
> - **Changing the axis/groupby field** (e.g., swap `Calendar Date` for `Calendar Month` on a visual axis)
> - **Removing or adding visual-level filters** (e.g., drop an unneeded slicer selection)
> - **Changing filter values** (e.g., narrow a date range filter)
> - **Removing measure value filters** (e.g., remove a "Top N" or "> threshold" filter from a visual)
> - **Changing aggregation type** on a column (e.g., Sum → Average)

---

### QRY001: Remove Unneeded Filters

Every filter adds a `WHERE` clause in xmSQL and may force an extra SE join. Users often apply global slicer or visual-level filters that don't actually affect the calculation being optimized.

**Detection:** `WHERE` clauses on columns not used in the measure logic, or filter variables that restrict to a single value (e.g., `Currency[Code] = "USD"` in a USD-only model).

**Fix:** Experiment — remove filters one at a time and re-run. If the result doesn't change, the filter might be unnecessary. Global filters that are needed across all visuals should be pushed to the data source (model-level change).

```dax
-- Before: filter on Currency adds an SE join for no benefit
SUMMARIZECOLUMNS (
    'Product'[Category],
    KEEPFILTERS ( TREATAS ( {"USD"}, 'Currency'[Code] ) ),
    "Revenue", [Total Revenue]
)

-- After: filter removed, same result, one fewer SE join
SUMMARIZECOLUMNS ( 'Product'[Category], "Revenue", [Total Revenue] )
```

---

### QRY002: Eliminate Report Measure Filters (__ValueFilterDM)

When a visual filters on a measure value (e.g., "Revenue > 1M"), Power BI generates a `__ValueFilterDM` variable that evaluates the measure twice — once for the filter check, once for display. Roughly doubles execution time.

**Detection:** `__ValueFilterDM` in the generated query.

**Fix:** Move the threshold into the measure itself — return BLANK below the cutoff. SUMMARIZECOLUMNS auto-drops blank rows, achieving the same visual result in one pass:

```dax
MEASURE 'Sales'[Total Revenue Filtered] =
    VAR __Rev = [Total Revenue]
    RETURN IF ( __Rev > 1000000, __Rev )
```

---

### QRY003: Reduce Query Grain

Grouping by a high-cardinality column (e.g., `Calendar[Date]` → 365 rows) when the user only needs monthly data (12 rows) inflates SE row count ~30×.

**Detection:** Groupby on a date or high-cardinality column producing far more rows than the visual needs.

**Option A — coarser groupby:**

```dax
-- Daily → monthly
SUMMARIZECOLUMNS ( 'Calendar'[YearMonth], "Revenue", [Total Revenue] )
```

**Option B — period-end axis + measure pin** (show period-end snapshot instead of full-period aggregate):

Requires a period-end column in the date table (e.g., `Calendar[MonthEndDate]`). User changes the visual axis to it, then pins the measure to that date:

```dax
-- User changes axis from Calendar[Date] to Calendar[MonthEndDate]
-- Measure pins CALCULATE to the period-end date to return that day's value only
MEASURE 'Sales'[Active Customers] =
    CALCULATE (
        DISTINCTCOUNT ( 'Sales'[CustomerID] ),
        'Calendar'[Date] = MAX ( 'Calendar'[MonthEndDate] )
    )
```

> Without the pin, grouping by `MonthEndDate` aggregates all days in the month instead of returning the single-day value.

**Option C — return BLANK for non-boundary dates** (keeps all dates in groupby but only computes on end-of-month):

```dax
MEASURE 'Sales'[Revenue EOM] =
    IF ( MAX('Calendar'[Date]) = EOMONTH(MAX('Calendar'[Date]), 0), [Total Revenue] )
```

**Option D — daily additive measure approximated at coarser grain** (divide monthly total by days in month):

```dax
MEASURE 'Sales'[Daily Avg Revenue] =
    DIVIDE (
        [Total Revenue],
        DAY ( EOMONTH ( MAX('Calendar'[Date]), 0 ) )
    )
```

---

### QRY004: Remove BLANK Suppression (Changes Result Shape)

`+ 0`, `IF(ISBLANK([M]), 0, [M])`, or `COALESCE(..., 0)` force SUMMARIZECOLUMNS to evaluate every groupby combination — including rows with no data — inflating the result set.

**Detection:** `+ 0`, `IF(ISBLANK(...))`, or `COALESCE(..., 0)` appended to measures.

**Anti-pattern:**

```dax
MEASURE 'Sales'[Revenue] = SUM ( 'Sales'[SalesAmount] ) + 0
```

**Preferred:**

```dax
MEASURE 'Sales'[Revenue] = SUM ( 'Sales'[SalesAmount] )
```

**If zeros are required selectively**, conditionally add 0 where it makes sense:

```dax
MEASURE 'Sales'[Revenue] =
    VAR _ForceZero = NOT ISEMPTY ( 'Sales' )
    RETURN [Sales Amount] + IF ( _ForceZero, 0 )
```
