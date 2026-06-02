# Grain & Grain-Mismatch Remediation

How to reason about fact-table grain, and how to fix the most common modeling failure it produces: a measure that goes BLANK (or wrong) when sliced at a finer grain than its source data supports.

For the relationship/star-schema rules that grain interacts with (conformed dimensions, fact-to-fact), see `references/columns-relationships.md`. For the DAX mechanics of the remediation patterns, the same recipe lives in `../authoring-measures/references/dax-performance.md` (QRY003) — load `authoring-measures` when writing the measure.

---

## G1 — One consistent grain per fact table

Every row in a fact table must represent the same kind of event at the same level of detail — order-line, daily aggregate, or monthly summary — and **never mix grains in one table** (`awesome-copilot-pbi-data.xml:18856`). A single "Sales" table that holds both per-line transaction rows *and* pre-aggregated monthly summary rows will double-count under any measure that sums it. If you have two grains, you have two facts: split them into separate tables (e.g. `Sales` at line grain and `Sales Monthly Summary` at month grain), each related to the shared dimensions at its own grain.

---

## G2 — Target-vs-actual grain mismatch (the BLANK-on-daily bug class)

**The problem.** A very common dashboard pairs a fine-grained actual with a coarse-grained target — e.g. an actuals fact recorded **daily** and a target fact set **monthly** (one row per month). The target measure (call it `[Sales Target]`) is correct at month level, but the moment a visual slices it by a *daily* date axis it returns **BLANK on every non-month-boundary date**, because there is no target row for those days. The actual line shows 30 daily points; the target line shows one point per month (or nothing). Source: `dg3:1037-1076`.

This is a **grain mismatch**, not a DAX bug. The two facts live at different grains and a single daily axis cannot serve both. There are four mined remediation options — pick by what the visual must show.

### Option A — aggregate the actual at the coarser (target) grain

Make the visual group by the *coarse* key both facts share — a `YearMonth` (or month-end) column on the Date dimension — so the actual is summed to month grain and lines up 1:1 with the monthly target.

```dax
-- Daily actual rolled up to the month grain the target uses
SUMMARIZECOLUMNS ( 'Date'[YearMonth], "Sales", [Total Sales], "Target", [Sales Target] )
```

Best when the consumer genuinely wants a monthly comparison; the daily detail is dropped from this visual.

### Option B — period-end date axis column + pin the measure to the boundary

Add a **period-end column** to the Date dimension (e.g. `Date[MonthEndDate]`) and put *that* on the axis. Pin the measure to the period-end date so each month resolves to a single point that aligns with the monthly target:

```dax
-- Axis is Date[MonthEndDate]; the measure pins to that boundary date
MEASURE 'Sales'[Active Customers] =
    CALCULATE (
        DISTINCTCOUNT ( 'Sales'[CustomerID] ),
        'Date'[Date] = MAX ( 'Date'[MonthEndDate] )
    )
```

> Without the pin, grouping by `MonthEndDate` aggregates *all* days in the month instead of returning the single boundary value. The period-end column is the reusable axis; see the same recipe (with the column requirement) in `../authoring-measures/references/dax-performance.md` (QRY003 Option B).

### Option C — return BLANK on non-boundary dates via EOMONTH

Keep the daily axis but make the measure compute **only on the month-end date**, returning BLANK elsewhere — so the target plots as one clean point per month against the daily actual:

```dax
MEASURE 'Sales'[Sales Target EOM] =
    IF ( MAX ( 'Date'[Date] ) = EOMONTH ( MAX ( 'Date'[Date] ), 0 ), [Sales Target] )
```

Best when you want to overlay a monthly target marker on a daily actual chart without changing the axis.

### Option D — daily-additive approximation via DIVIDE-by-days-in-month

When the target is *additive* and the consumer wants a smooth daily line, spread the monthly target evenly across the days of the month so it sums back to the monthly figure:

```dax
MEASURE 'Sales'[Daily Sales Target] =
    DIVIDE (
        [Sales Target],
        DAY ( EOMONTH ( MAX ( 'Date'[Date] ), 0 ) )
    )
```

This is an **approximation** (it assumes a flat daily distribution) — use only when an even spread is an acceptable business assumption.

### Choosing

| Need | Option |
|---|---|
| Monthly comparison, daily detail not required | A — coarser groupby |
| Reusable monthly axis across many visuals | B — period-end axis + pin |
| Monthly target marker on a daily actual chart | C — BLANK non-boundary via EOMONTH |
| Smooth additive daily target line | D — DIVIDE by days-in-month |

The structural cure underneath all four is to make the **shared grain explicit on the Date dimension** (a `YearMonth` / `MonthEndDate` column) so both facts can be sliced consistently — the same principle as a conformed dimension, applied to time.
