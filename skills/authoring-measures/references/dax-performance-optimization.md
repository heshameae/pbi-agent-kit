# DAX Performance Optimization — Workflow

Complete framework for optimizing DAX query performance: tier model, workflow phases, baseline protocol, semantic equivalence rules, error handling, and requirements.

> **Related references:** [`references/dax-performance.md`](./dax-performance.md) — DAX001–021 pattern catalog + QRY001–004 · [`references/engine-internals.md`](./engine-internals.md) — FE/SE architecture, xmSQL, trace diagnostics · [`references/model-optimization.md`](./model-optimization.md) — MDL001–010, DL001–002

**Identifier guard:** Concrete table, column, and measure names in examples are illustrative only. Production DAX must resolve identifiers from live model metadata, deterministic planner output, the validated user spec, or explicit user confirmation; never copy example names into a user model.

---

## Reading Guide

### Must Read — Every Optimization

Always read these sections fully before starting any optimization session:

- **[Optimization Framework](#optimization-framework)** — tiers, autonomy rules, tool requirements
- **[Phase 1: Establish Baseline](#phase-1-establish-baseline)** — measure resolution, model context, run protocol
- **[Phase 2: Optimization Iterations](#phase-2-optimization-iterations)** — apply, test, compare, iterate
- **FE/SE architecture and xmSQL** — `references/engine-internals.md` (Section 1)
- **Trace Diagnostics** — `references/engine-internals.md` (Section 2)
- **Tier 1 DAX Patterns DAX001–021** — `references/dax-performance.md`

### Consult When Needed

Read these only when directed by the Decision Guide or after Tier 1 is exhausted:

- **Tier 2 — Query Structure (QRY001–QRY004)** — `references/dax-performance.md` — requires user approval before applying
- **Tier 3 — Model Changes (MDL001–MDL010)** — `references/model-optimization.md` — high caution, user approval, suggest model copy
- **Tier 4 — Direct Lake (DL001–DL002)** — `references/model-optimization.md` — high caution, user approval, requires ETL/pipeline changes

---

## Decision Guide

Use to prioritize *where to start* within sections, not to skip them. The Tier 1 DAX pattern catalog is always read in full — these signals tell you which patterns to try first. Tier 2–4 signals are escalation triggers; consult those references only when the signal appears.

### Tier 1 — Where to Start (read all DAX001–021)

| Signal | Start With |
|--------|------------|
| `CallbackDataID` or `EncodeCallback` in xmSQL | DAX002, DAX007, DAX008, DAX018 (highest priority) |
| `ADDCOLUMNS` or `SUMMARIZE` in measure expression | DAX002, DAX006 |
| `SUMMARIZE` with complex or filtered table as first argument | DAX005 |
| `SUMX(VALUES(col), CALCULATE(...))` pattern in measure | DAX006 |
| Same measure evaluated multiple times | DAX003 |
| Duplicate or redundant `CALCULATE` filter predicates | DAX004 |
| `FILTER(Table, ...)` as `CALCULATE` argument, or `&&` joining predicates in single filter | DAX001 |
| `ALL(table), VALUES(table[col])` in same `CALCULATE` | DAX012 |
| Filter or `TREATAS` passed directly as `SUMMARIZECOLUMNS` argument (not wrapped in `CALCULATETABLE`) | DAX009 |
| SE rows far exceed final result count | DAX010 |
| `DISTINCTCOUNT` in measure expression | DAX011, DAX014 |
| Conditional logic (`IF`, `IIF`) or `DIVIDE()` inside row iterator | DAX007, DAX018 |
| `SWITCH` or `IF` as primary expression body in measure | DAX013 |
| Multiple SE queries hitting same fact table | DAX019 (vertical fusion), DAX020 (horizontal), DAX017 (boolean multiplier) |
| Near-identical SE queries on same fact table differing only by a column filter value or by per-measure `VAND` tuple predicates | DAX017 |
| Bidirectional or M2M relationship causing unexpected SE join expansion, or existing `TREATAS`/`CROSSFILTER` in measure | DAX016 |
| High-cardinality iterator (many distinct rows, low-cardinality attribute) | DAX015 |
| `TREATAS` or `IN` re-filtering same fact with a computed key set; or large compound-tuple semi-join in xmSQL | DAX021 |

> No signal matches? Read all DAX001–021 — patterns cover the full range.

### Tiers 2–4 — Escalation Triggers

Only consult these when the corresponding signal is present. All require user approval before applying changes.

| Signal | Escalate To |
|--------|-------------|
| `__ValueFilterDM` in generated query | Tier 2 → QRY002 |
| Groupby column is high-cardinality (e.g., `Calendar[Date]`) | Tier 2 → QRY003 |
| Tier 1 patterns exhausted; output change acceptable | Tier 2 → QRY001–QRY004 |
| Few SE queries, low parallelism, clean xmSQL, high SE duration | Tier 3/4 → data layout (model-optimization.md) |
| Many-to-many or bidirectional relationship overhead | Tier 3 → MDL001 |
| Direct Lake model + low parallelism or cold cache | Tier 4 → DL001–DL002 |

---

## Optimization Framework

### Tiers and Autonomy

| Tier | Scope | Autonomy |
|------|-------|----------|
| **Tier 1 — DAX Patterns** | Rewrite measure/UDF definitions | Auto-apply only when identifiers are resolved and semantic equivalence can be verified. Keep EVALUATE/grouping identical. |
| **Tier 2 — Query Structure** | Modify EVALUATE, grain, filters | Present recommendation. Wait for explicit user approval. |
| **Tier 3 — Model Changes** | Relationships, columns, agg tables, data types | High caution. Discuss trade-offs. Suggest model copy. Warn downstream risk. |
| **Tier 4 — Direct Lake** | OneLake layout, V-ordering, rowgroup sizing | High caution. Requires ETL/pipeline changes outside the model. |

**Success criteria — Tier 1:** ≥10% duration improvement AND semantic equivalence (same row count, column count, data values).
**Success criteria — Tier 2/3/4:** ≥10% improvement AND explicit user approval of output or structural changes.

### Requirements

- **Semantic model connection** — Connect to the target semantic model before starting using this plugin's model tools or an equivalent XMLA-capable connection.
- **Trace capture** — Requires the ability to execute DAX queries with server timing trace capture. See [Trace Capture Methods](#trace-capture-methods) below.
- **Model metadata** — Requires the ability to read measure definitions, function definitions, calculation group expressions, table metadata, and relationship metadata from the model.
- **Tier 2:** Present the change and its output impact, wait for user approval.
- **Tier 3/4:** Explain trade-offs, warn about downstream report risk, suggest working on a model copy, identify upstream changes (Lakehouse, Warehouse, Power Query) that may require changes beyond the semantic model itself.

### Trace Capture Methods

All methods use the same Analysis Services Trace API and produce identical trace events.

| Method | Scope | Notes |
|--------|-------|-------|
| **This plugin's DAX/model MCP tools** | Local Power BI Desktop / supported semantic-model connections | Preferred when available; keep query, trace, and metadata evidence attached to the optimization record. |
| **External XMLA/trace-capable tooling** | Local + remote (XMLA) | Acceptable when explicitly available in the user's environment; record the tool and raw timing evidence. |
| **DAX Studio** | Local + remote | Server Timings pane. Manual, not scriptable. |
| **Fabric Workspace Monitoring** | Fabric workspaces | Built-in workspace-level query monitoring. |

---

## Phase 1: Establish Baseline

### Step 1: Resolve All Measure and Function Definitions

Before optimizing, fully resolve every DAX expression in the query. Partial visibility leads to incorrect or incomplete optimizations.

1. **Identify measure references** in the user's query — any `[MeasureName]` pattern.
2. **Retrieve each measure's expression** — read the measure definition (name, table, DAX expression) from the model.
3. **Recursively resolve dependencies** — read each expression, find nested `[OtherMeasure]` calls, fetch those too.
4. **Retrieve user-defined functions** if referenced.
5. **Build a DEFINE block** that explicitly inlines all resolved measures and functions.
6. **Check for active calculation groups** — list all calculation groups in the model, retrieve their calculation item expressions. Note any that may be active in the query context as they affect query plans for every intercepted measure.

**Example:** If `[Profit Margin]` = `DIVIDE([Total Profit], [Total Revenue])`, retrieve all three definitions and build:

```dax
DEFINE
	MEASURE 'Sales'[Total Revenue] = SUM('Sales'[Revenue])
	MEASURE 'Sales'[Total Profit]  = SUM('Sales'[Revenue]) - SUM('Sales'[Cost])
	MEASURE 'Sales'[Profit Margin] = DIVIDE([Total Profit], [Total Revenue])

EVALUATE
SUMMARIZECOLUMNS ( 'Product'[Category], "Profit Margin", [Profit Margin] )
```

### Step 2: Gather Model Context

1. List all tables — understand table structure and storage modes (Import, DirectQuery, Direct Lake).
2. List all relationships — understand join paths and filter propagation.

This context helps distinguish model design issues (missing star schema, bidirectional relationships) from DAX expression problems.

### Step 3: Execute Baseline (1 warm-up + 3 measured runs)

For each run:

1. **Clear cache** — clear the model's VertiPaq cache to ensure cold-cache timing.
2. **Execute with trace capture** — run the DAX query with server timing trace enabled.
3. **Derive key metrics** — Total Duration, FE/SE split, SE query count, peak memory, and result row count. See `references/engine-internals.md` for derivation from trace events.
4. Record all metrics, save the full trace events, and save the baseline result data for semantic equivalence checks.

After all runs: discard warm-up, take the **median** of the 3 measured runs as the baseline. If results are inconsistent (>20% spread), run up to 5 more iterations to isolate platform noise from actual query performance. Record the baseline's full metrics, trace events, and CSV result.

**Isolating measures:** When a query has many measures and the trace is noisy, comment out all but one (or a small group), re-run, and compare. Repeat in groups to isolate which measures drive the majority of total duration.

### Step 4: Analyze Baseline

Apply trace diagnostics from `references/engine-internals.md` to interpret the metrics and events. Use the **Decision Guide** above to identify which Tier 1 patterns to try first.

---

## Phase 2: Optimization Iterations

### Step 1: Select and Apply Optimizations

Using the Tier 1 pattern catalog (`references/dax-performance.md`), identify DAX patterns present in the baseline measures. Apply one or more of DAX001–DAX021.

**CRITICAL:** Modify only the **measure definitions in the DEFINE block**. Do NOT change the EVALUATE clause or SUMMARIZECOLUMNS grouping columns. Query structure must stay identical to preserve semantic equivalence.

```dax
-- BASELINE measure
DEFINE
	MEASURE Products[HighValueCount] = SUMX('Products', IF([Sales Amount] > 10000000, 1, 0))

-- OPTIMIZED measure (DAX007: IF → INT)
DEFINE
	MEASURE Products[HighValueCount] = SUMX('Products', INT([Sales Amount] > 10000000))
```

### Step 2: Execute and Compare

1. Clear the model cache.
2. Execute the query with trace capture enabled.

**During iteration:** 1 run is sufficient — columns are already resident from baseline. Reserve the full protocol (1 warm-up + 3 measured, take median) for the **final confirmation** against the original baseline.

**Evaluate:**
- **Improvement = (BaselineDuration − OptimizedDuration) / BaselineDuration × 100**
- **Semantic equivalence:** Compare the CSV result from this run against the baseline CSV — same row count, same columns, same data values. If results differ, the change modified calculation semantics — revert it. Check this **immediately** after each iteration, not after multiple changes.

### Step 3: Iterate and Escalate

- **≥10% improvement + semantically equivalent** → Success. Present optimized query and improvement to user. Offer to use it as new baseline for further rounds (compound improvements are common).
- **Further rounds:** When the user opts to continue, re-run Phase 1 Steps 3–4 on the new baseline. The optimized query has different structure — re-analyze against the Decision Guide and full pattern catalog. Patterns that didn't apply before (e.g., fusion opportunities, materialization candidates) may now be relevant.
- **<10% improvement** → Try another Tier 1 pattern. Re-examine trace for additional bottlenecks.
- **Results differ** → Revert. The optimization changed calculation semantics. Try a different approach.
- **Tier 1 exhausted** → Move to Phase 3 (Tier 2) with user approval.

---

## Phase 3: Query Structure Changes (Tier 2 — User Approval Required)

> **STOP — Do not modify the query structure without explicit user approval.**

Consult **Tier 2 — Query Structure Patterns (QRY001–QRY004)** in `references/dax-performance.md`.

Before applying any change:

1. Explain the specific change (e.g., "Group by YearMonth instead of Date reduces result rows from 365K to 12K").
2. Explain what changes in the output and what the user gains in performance.
3. Wait for explicit approval.
4. If approved, modify query structure, run the full baseline cycle, present results.

---

## Phase 4: Model and Data Layout Changes (Tier 3/4 — High Caution, User Approval Required)

> **STOP — Do not modify the model without explicit user approval.**

Consult **MDL001–MDL010** and **DL001–DL002** in `references/model-optimization.md`.

Before proceeding:

1. Present the specific diagnosis and proposed model change.
2. Explain why the model design is causing the performance bottleneck.
3. Warn that model changes can break downstream reports and visuals.
4. Suggest creating a copy of the semantic model to experiment on.
5. Identify if upstream changes are required (Lakehouse tables, Warehouse views, Power Query transformations) — these cannot be done through semantic model tooling alone.
6. If approved, coordinate with the user's CI/CD process.
7. After applying changes, re-run the full baseline optimization workflow to measure impact.

---

## Error Handling

- **Connection failure** — Verify dataset name, workspace name, or XMLA endpoint. For Desktop, ensure Power BI Desktop is running and note the local port. For Service, verify XMLA read/write is enabled on the capacity.
- **Query syntax error** — Validate DAX syntax before executing.
- **Semantic equivalence failure** — Optimization changed calculation semantics. Review filter context, aggregation granularity, and CALCULATE filter arguments. Revert and try differently.
- **No improvement found** — Some queries are already well-optimized at the DAX level. Check whether the bottleneck is data layout (Phase 4) or query structure (Phase 3).
- **Trace events empty** — Ensure server timing / trace capture is enabled before executing the query. Verify the trace is subscribed to the correct event types (`QueryEnd`, `VertiPaqSEQueryEnd`, `VertiPaqSEQueryCacheMatch`).
