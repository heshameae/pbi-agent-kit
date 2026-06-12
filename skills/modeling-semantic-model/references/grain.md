# Grain & Grain-Mismatch Remediation

How to reason about fact-table grain, and how to fix the most common modeling failure it produces: a measure that goes BLANK (or wrong) when sliced at a finer grain than its source data supports.

For the relationship/star-schema rules that grain interacts with (conformed dimensions, fact-to-fact), see `references/columns-relationships.md`. For the DAX mechanics of the remediation patterns, the same recipe lives in `../authoring-measures/references/dax-performance.md` (QRY003) — load `authoring-measures` when writing the measure.

---

## G1 — One consistent grain per fact table

Every row in a fact table must represent the same kind of event at the same level of detail — transaction-line, daily aggregate, or monthly summary — and **never mix grains in one table** (`awesome-copilot-pbi-data.xml:18856`). A single fact table that holds both per-line transaction rows *and* pre-aggregated monthly summary rows will double-count under any additive measure. If you have two grains, you have two facts: split them into separate business-named tables such as `<Process> Detail` and `<Process> Monthly Summary`, each related to the shared dimensions at its own grain.

---

## G2 — Target-vs-actual grain mismatch (the BLANK-on-daily bug class)

Before changing calendar bounds, Date-table markings, relationships, or DAX for any target/budget/forecast/planning fact, call `pbi_model_plan_date_table` with the governed Date table/key plus the relevant fact date columns, then call `pbi_model_plan_date_grain` with the same fact date columns batched in one request. Treat `status`, `factCoverage`, `observedGrain`, and `writePlan` as the source of truth. Leave `scanMeasures` omitted unless you are planning a measure rewrite and need date-truncating `TREATAS` candidates. Do not infer date ranges or daily/monthly grain from table names, column names, existing `TREATAS`, `TODAY()`, or a file sample.

If `pbi_model_plan_date_table` returns `status: "blocked"` or a non-succeeded proof, stop before editing calendar DAX or using the Date table as the authoritative axis. If a Date proof returns `parse-shape-unrecognized`, `proof-parse-shape-unrecognized`, or `evidenceRows:0` from a ROW-based proof, report the structured blocker/status verbatim and stop; do not use `pbi_dax_query`, manual DAX, `probeData:false`, `pbi_model_refresh`, model processing, Desktop restart, or primitive Date/relationship writes as a fallback. Common blockers are a Date table that starts after fact min date, ends before fact max date, contains gaps/duplicates/blanks, points at auto-date tables, or uses `TODAY()`/`NOW()` as the default calendar bound. Use observed fact min/max dates plus an explicit user-approved future horizon policy; never silently anchor to the current system date.

**The problem.** A very common dashboard pairs a fine-grained actual with a coarse-grained target — e.g. an actuals fact recorded **daily** and a target fact set **monthly** (one row per month). The target measure (call it `[<TargetMeasure>]`) is correct at month level, but the moment a visual slices it by a *daily* date axis it returns **BLANK on every non-month-boundary date**, because there is no target row for those days. The actual line shows 30 daily points; the target line shows one point per month (or nothing). Source: `dg3:1037-1076`.

If `pbi_model_plan_date_grain` returns `observedGrain: "day"` with `safeVisualDateGrain: "day-or-above"`, the target/forecast/planning fact has date-only day-level evidence. Sparse fact dates are normal: they are safe for day-or-above visual axes, Date relationships, and plain additive measures when `writePlan` / `plainSumSafe` explicitly allow them. Do **not** add month-start truncation (`DATE(YEAR(...), MONTH(...), 1)`) or month-key `TREATAS` for that case. The Date table key must be continuous; fact dates do not need every day between min/max to exist.

If it returns `observedGrain: "month-start"` or `"month-single-date"`, the fact has one distinct date value per month. Use one of the grain-alignment options below. Do not repeat the monthly value across every day unless the business explicitly requested an allocation measure.

If it returns `observedGrain: "submonthly"`, there is more than one date in at least one month but not enough evidence to prove daily grain. Treat it as blocked for relationship activation and target-measure simplification until deterministic planner proof succeeds. A user-approved allocation policy can define a separate allocation measure, but it does not unlock Date relationship writes or plain-SUM rewrites.

This is a **grain mismatch**, not a DAX bug. The two facts live at different grains and a single daily axis cannot serve both. There are four mined remediation options — pick by what the visual must show.

### Option A — aggregate the actual at the coarser (target) grain

Make the visual group by the *coarse* key both facts share — a `YearMonth` (or month-end) column on the Date dimension — so the actual is summed to month grain and lines up 1:1 with the monthly target.

The DAX below is illustrative only. Replace every table, column, and measure placeholder from `pbi_model_plan_date_table`, `pbi_model_plan_date_grain`, and the validated user spec; do not copy these names into production.

```dax
-- Fine-grain actual rolled up to the coarse grain the target uses.
SUMMARIZECOLUMNS (
    '<DateTable>'[<CoarsePeriodKeyColumn>],
    "<ActualLabel>", [<ActualMeasure>],
    "<TargetLabel>", [<TargetMeasure>]
)
```

Best when the consumer genuinely wants a monthly comparison; the daily detail is dropped from this visual.

### Option B — period-end date axis column + pin the measure to the boundary

Add a **period-end column** to the Date dimension (e.g. `Date[MonthEndDate]`) and put *that* on the axis. Pin the measure to the period-end date so each month resolves to a single point that aligns with the monthly target:

```dax
-- Axis is <DateTable>[<PeriodEndDateColumn>]; the measure pins to that boundary date.
MEASURE '<MeasureTable>'[<BoundaryPinnedMeasure>] =
    CALCULATE (
        <BaseExpression>,
        '<DateTable>'[<DateKeyColumn>] = MAX ( '<DateTable>'[<PeriodEndDateColumn>] )
    )
```

> Without the pin, grouping by `MonthEndDate` aggregates *all* days in the month instead of returning the single boundary value. The period-end column is the reusable axis; see the same recipe (with the column requirement) in `../authoring-measures/references/dax-performance.md` (QRY003 Option B).

### Option C — return BLANK on non-boundary dates via EOMONTH

Keep the daily axis but make the measure compute **only on the month-end date**, returning BLANK elsewhere — so the target plots as one clean point per month against the daily actual:

```dax
MEASURE '<MeasureTable>'[<BoundaryOnlyTargetMeasure>] =
    IF (
        MAX ( '<DateTable>'[<DateKeyColumn>] )
            = EOMONTH ( MAX ( '<DateTable>'[<DateKeyColumn>] ), 0 ),
        [<TargetMeasure>]
    )
```

Best when you want to overlay a monthly target marker on a daily actual chart without changing the axis.

### Option D — daily-additive approximation via DIVIDE-by-days-in-month

When the target is *additive* and the consumer wants a smooth daily line, spread the monthly target evenly across the days of the month so it sums back to the monthly figure:

```dax
MEASURE '<MeasureTable>'[<DailyAllocatedTargetMeasure>] =
    DIVIDE (
        [<TargetMeasure>],
        DAY ( EOMONTH ( MAX ( '<DateTable>'[<DateKeyColumn>] ), 0 ) )
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
