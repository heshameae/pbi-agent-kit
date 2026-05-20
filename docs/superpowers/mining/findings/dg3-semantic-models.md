# Mining findings: data-goblin semantic-models plugin (DAX/M/review/naming)
Source: dg3-semantic-models.xml

## Relevance summary
This is the single richest source for DAX authoring/optimization, Power Query (M) folding, model-review heuristics, and naming standards we have mined. It maps almost 1:1 onto our dax-patterns, time-intelligence, m-query-patterns, tmdl-conventions skills, the model-reviewer agent, and the BPA / pbi_model_check tooling. Nearly all content is dataset-agnostic (uses generic `'Sales'`, `'Product'`, `'Date'` placeholders). The Python scripts (refresh, lineage, executeQuery, model-info) are non-Node and reference-only — extract their *patterns* (refresh types, lineage edges, executeQuery validation flow) not the code. Discarded almost nothing of substance.

## High-value extractions

### 1. Tier 1 DAX optimization patterns DAX001–DAX021 → maps to dax-patterns skill + BPA rules engine + pbi_model_check
- **What it is:** 21 numbered, auto-applicable DAX rewrite patterns, each with a labeled anti-pattern → preferred pair. These are the gold standard for a DAX anti-pattern detector/linter and for our `dax-patterns` shared-knowledge skill. Every one is dataset-agnostic. Each maps cleanly to a regex/AST BPA rule.
- **Source path:** `plugins/semantic-models/skills/dax/references/dax-patterns.md` (Section 3)
- **Autonomy note (verbatim):** "Auto-apply freely. Modify only measure/UDF definitions in the DEFINE block. Keep EVALUATE and SUMMARIZECOLUMNS grouping identical." Success criteria: "≥10% duration improvement AND semantic equivalence (same row count, column count, data values)."
- **Key content (reusable templates):**

  - **DAX001 — Simple column predicates over FILTER(table); split `&&`:**
    ```dax
    -- Anti: CALCULATE( SUM('Sales'[Amount]), FILTER('Product', 'Product'[Category]="Electronics") )
    -- Pref: CALCULATE( SUM('Sales'[Amount]), KEEPFILTERS('Product'[Category]="Electronics") )
    -- Anti: CALCULATETABLE('Sales', 'Sales'[Region]="West" && 'Sales'[Amount]>1000 )
    -- Pref: CALCULATETABLE('Sales', 'Sales'[Region]="West", 'Sales'[Amount]>1000 )  -- separate predicates
    ```
  - **DAX002 — Replace ADDCOLUMNS/SUMMARIZE with SUMMARIZECOLUMNS** (better SE fusion). Anti forms: `SUMMARIZE('Sales','Sales'[ProductKey],"Total Profit",[Profit])`, `ADDCOLUMNS(SUMMARIZE(...),...)`, `ADDCOLUMNS(VALUES('Sales'[ProductKey]),...)`. Pref: `SUMMARIZECOLUMNS('Sales'[ProductKey],"Total Profit",[Profit])`. NOTE: "SUMMARIZECOLUMNS fully supported inside measure definitions — earlier restrictions no longer apply."
  - **DAX003 — Cache repeated/context-independent expressions in VAR.** Pull a repeated `[Sales Amount]` into `VAR _SalesAmount = [Sales Amount]`; materialize once with SUMMARIZECOLUMNS when the same measure is iterated twice; lift context-independent `[Average Price]` out of `SUMX`.
  - **DAX004 — Remove duplicate/redundant filters** (same predicate in CALCULATE + FILTER, or restated in a VAR).
  - **DAX005 — SUMMARIZE with complex table expr → wrap SUMMARIZECOLUMNS in CALCULATETABLE.**
  - **DAX006 — Pre-materialize context transitions:** `SUMX(VALUES('Product'[Attribute]), CALCULATE(SUM('Sales'[Amount])))` → `SUMX(SUMMARIZECOLUMNS('Product'[Attribute],"@Amount",SUM('Sales'[Amount])),[@Amount])`.
  - **DAX007 — Replace IF with INT for boolean conversion** (avoids callback): `SUMX('Products', IF([x]>1e7,1,0))` → `SUMX('Products', INT([x]>1e7))`. Even better when counting rows: `CALCULATE(COUNTROWS('Sales'),'Sales'[Amount]>1000)`.
  - **DAX008 — Context transition in iterator:** (1) remove it (`SUMX('Sales','Sales'[Unit Price]*'Sales'[Quantity])`); (2) reduce columns (`SUMX(VALUES('Account'[Account Key]),[Total Sales])`); (3) reduce cardinality before iteration.
  - **DAX009 — Wrap SUMMARIZECOLUMNS filters with CALCULATETABLE** (direct TREATAS/filter args inside SUMMARIZECOLUMNS in a measure produce unexpected results).
  - **DAX010 — Apply filters via CALCULATETABLE instead of FILTER:** `FILTER('Sales','Sales'[Year]=2023)` → `CALCULATETABLE('Sales','Sales'[Year]=2023)`.
  - **DAX011 — Distinct count alternatives:** `DISTINCTCOUNT('Sales'[CustomerKey])` (SE-bound) vs `SUMX(VALUES('Sales'[CustomerKey]),1)` (FE-bound, sometimes faster).
  - **DAX012 — ALLEXCEPT instead of ALL + VALUES restoration:** `CALCULATE([x],ALL('Sales'),VALUES('Sales'[Region]))` → `CALCULATE([x],ALLEXCEPT('Sales','Sales'[Region]))`. CAVEAT: only equivalent when `[Region]` is actively filtered.
  - **DAX013 — SWITCH/IF branch optimization in SUMMARIZECOLUMNS** breaks on: (1) multiple aggregations in one branch (merge into one SUMX); (2) mismatched data types across branches (use CONVERT); (3) context transition inside a branch iterator (cache measure first).
  - **DAX014 — COUNTROWS over DISTINCTCOUNT on key columns:** `DISTINCTCOUNT('Product'[ProductKey])` → `COUNTROWS('Product')` (when column is the one-side PK).
  - **DAX015 — Move calculation to lower granularity:** iterate the low-cardinality attribute (`VALUES('Customer'[DiscountRate])`) instead of the 100K-row table.
  - **DAX016 — Relationship overrides via TREATAS + CROSSFILTER** to experiment without model changes (replace bidir bridge with explicit `CROSSFILTER(...,NONE)` + `TREATAS`).
  - **DAX017 — Boolean multiplier to unblock fusion:** replace per-measure filter with `SUMX(KEEPFILTERS(ALL(Column)), expr * (Column = value))` so SE queries become structurally identical and fuse. BLANK→0 caveat: wrap with `IF(_r=0,BLANK(),_r)` if ISBLANK matters downstream.
  - **DAX018 — Replace DIVIDE with `/` inside iterators** (DIVIDE's divide-by-zero guard forces FE callback). Only when denominator is guaranteed non-zero; else pre-filter `<>0`.
  - **DAX019 — Lift time-intelligence to outer CALCULATE for vertical fusion:** keep base measures TI-free, apply TI once: `CALCULATE([Revenue]-[Cost], DATESYTD('Date'[Date]))` instead of separate `Revenue YTD`/`Cost YTD`. (Directly relevant to time-intelligence skill.)
  - **DAX020 — Unblock horizontal fusion by lifting filters:** keep only simple column-slice filters in base measures; apply TI/dynamic vars in an outer CALCULATE.
  - **DAX021 — Pre-compute and join instead of filter round-trip:** replace TREATAS/IN key-set re-filtering with `NATURALINNERJOIN` of two independently pre-computed aggregations sharing a key lineage column.
- **Quality:** 5/5 — concise, verbatim-usable, dataset-agnostic, every pattern has a detection signal.
- **Recommendation:** adopt-as-is (as the core content of dax-patterns skill + seed for BPA/anti-pattern rules).

### 2. Decision Guide: SE/xmSQL signal → pattern mapping → maps to model-reviewer agent + dax-patterns + (future) trace-diagnostic tool
- **What it is:** A lookup table mapping a detectable signal (in xmSQL/trace or in the measure text) to which DAX pattern to apply. The text-detectable rows are directly usable as lint heuristics even without a trace.
- **Source path:** `plugins/semantic-models/skills/dax/references/dax-performance-optimization.md` (Decision Guide)
- **Key content (text-detectable subset — usable for static lint):**
  - `ADDCOLUMNS`/`SUMMARIZE` in measure expr → DAX002, DAX006
  - `SUMMARIZE` with complex/filtered first arg → DAX005
  - `SUMX(VALUES(col), CALCULATE(...))` → DAX006
  - Same measure evaluated multiple times → DAX003
  - Duplicate/redundant CALCULATE filter predicates → DAX004
  - `FILTER(Table,...)` as CALCULATE arg, or `&&` joining predicates → DAX001
  - `ALL(table), VALUES(table[col])` in same CALCULATE → DAX012
  - filter/`TREATAS` passed directly to SUMMARIZECOLUMNS (not wrapped) → DAX009
  - `DISTINCTCOUNT` in measure → DAX011, DAX014
  - `IF`/`IIF`/`DIVIDE()` inside row iterator → DAX007, DAX018
  - `SWITCH`/`IF` as primary measure body → DAX013
  - Trace-only signals: `CallbackDataID`/`EncodeCallback` → DAX002/007/008/018; `__ValueFilterDM` → QRY002; high-cardinality groupby → QRY003.
- **Quality:** 5/5.
- **Recommendation:** adapt (split into "static-detectable" rules for our linter vs "trace-required" rules gated behind future trace tooling).

### 3. Tier 2 query-structure patterns QRY001–QRY004 → maps to model-reviewer agent (report-author guidance), reference-only for authoring
- **What it is:** Query-level (not measure-level) optimizations requiring user approval; "Desktop-Achievable Changes Only" — change axis/groupby field, remove/add visual filters, change aggregation type.
- **Source path:** `plugins/semantic-models/skills/dax/references/dax-patterns.md` (Section 4)
- **Key content:**
  - **QRY001 — Remove unneeded filters** (detect WHERE on columns not in measure logic; single-value filters in single-value models).
  - **QRY002 — Eliminate `__ValueFilterDM`** (visual filtering on a measure value evaluates it twice): push threshold into the measure — `VAR __Rev=[Total Revenue] RETURN IF(__Rev>1000000,__Rev)`.
  - **QRY003 — Reduce query grain** (daily→monthly groupby; period-end axis + measure pin; BLANK for non-boundary dates via `EOMONTH`).
  - **QRY004 — Remove BLANK suppression** (`+0`, `IF(ISBLANK(...))`, `COALESCE(...,0)` force SUMMARIZECOLUMNS to evaluate every combination).
- **Quality:** 4/5 (4 is report-side, less central to model authoring).
- **Recommendation:** adapt (QRY002/QRY004 are good measure-authoring anti-patterns for dax-patterns; QRY001/QRY003 are reviewer advisories).

### 4. DAX engine internals (FE/SE, xmSQL, fusion, segments) → maps to dax-patterns skill background + model-reviewer rationale
- **What it is:** Compact explanation of *why* the patterns work: FE (single-threaded, the usual bottleneck) vs SE (multi-threaded VertiPaq, limited ops), datacaches, callbacks, xmSQL, segments/parallelism, vertical vs horizontal fusion and what blocks each.
- **Source path:** `plugins/semantic-models/skills/dax/references/engine-internals.md`
- **Key reusable facts:**
  - Core principle: "push as much work as possible into the SE, minimize SE scans, and eliminate callbacks entirely."
  - SE supports only: 4 arithmetic operators, GROUP BY, LEFT OUTER JOINs, basic aggs (SUM/COUNT/MIN/MAX/DISTINCTCOUNT). Anything else = callback (row-by-row in FE).
  - **Blocks vertical fusion:** time-intelligence funcs; per-measure filter predicates (VAND tuples); SWITCH/IF selecting between measures; calc-group items applying different filters.
  - **Blocks horizontal fusion:** filtered column not in groupby; table-valued filter per measure (TI); filter value computed at runtime (variable).
  - **SE Parallelism Factor** = StorageEngineCpuTime ÷ StorageEngineDuration; ≈1.0 means single-threaded (data-layout problem, not DAX).
  - **DAX vs data-layout signal:** "Many SE queries + high FE time + short SE scans → DAX problem. Few SE queries + low FE + high SE duration + low parallelism → data-layout problem."
- **Quality:** 5/5.
- **Recommendation:** reference-only / adapt (condense into a "why" appendix for dax-patterns; the trace-metric derivations are only actionable once we have trace capture).

### 5. Tier 3/4 model + Direct Lake patterns MDL001–MDL010, DL001–DL002 → maps to model-reviewer agent + tmdl-conventions + pbi_model_check
- **What it is:** Model-design optimizations (relationships, cardinality, data types, agg tables, RI) and Direct Lake (V-Order, segment sizing). Several map directly to BPA/review rules.
- **Source path:** `plugins/semantic-models/skills/dax/references/model-optimization.md`
- **Key content:**
  - **General data-layout best practices:** remove unused columns + filter rows at source; drop all-null/all-zero fact rows; move low-cardinality strings off facts into dims with integer keys; partition on high-filter columns (DateKey/TenantKey); presort on most-filtered column; optimal data types.
  - **MDL001 — Many-to-many bridge layouts (4 options A–D):** canonical bidir bridge; M2M bridge-to-fact; **optimized hybrid (best general-purpose): `User 1─* UserCustomer *─M2M─* Fact *─1 Customer`** (no bidir); pre-computed combination key.
  - **MDL002 — Star-schema conformance:** flatten snowflake `Sales─*Product─*Subcategory─*Category` into one wide Product dim.
  - **MDL003 — Cardinality/data-type:** integer keys over string keys; DateTime→Date; bin continuous values; split high-cardinality columns.
  - **MDL004 — Aggregation tables** (`GROUP BY [FKs], SUM([Metrics])` → Import → Manage Aggregations; facts must be DQ); filtered hot/cold aggs.
  - **MDL005 — Pre-compute period-comparison columns** (`SUM('Fact'[SalesLY])` instead of SAMEPERIODLASTYEAR — one scan).
  - **MDL006 — Row-based time-intelligence table** (pre-materialize periods so all period measures fuse).
  - **MDL007 — Eliminate RI violations** (detect via `$SYSTEM.DISCOVER_STORAGE_TABLES [RIVIOLATION_COUNT]>0`; add "Unknown" dim row).
  - **MDL008 — Replace SEARCH/FIND filters with pre-computed boolean columns** (cardinality 2, ~1 bit/row).
  - **MDL009 — Cardinality reduction via historical value substitution** (collapse old keys to a placeholder beyond retention window).
  - **MDL010 — IsAvailableInMDX on disconnected slicer tables** (lets engine statically resolve unfiltered SELECTEDVALUE, killing the dead branch).
  - **DL001 — V-Order for Direct Lake** (Import is auto-V-ordered; Direct Lake is NOT — enable via Spark `spark.microsoft.delta.vorder.enabled` + OPTIMIZE, or `readHeavyForPBI` resource profile).
  - **DL002 — Segment/rowgroup sizing:** target 1–16M rows per rowgroup; OPTIMIZE regularly.
- **Quality:** 5/5 (the M2M layout taxonomy is especially valuable and hard to find elsewhere).
- **Recommendation:** adapt — MDL002/MDL003/MDL007/MDL010 become reviewer/BPA rules; MDL001/MDL004/MDL005/MDL006 become bi-pattern-library / model-builder guidance. Mark trace/$SYSTEM detection as reference-only until tooling exists.

### 6. Power Query M best-practices + query-folding catalog → maps to m-query-patterns skill (PRIME)
- **What it is:** The most complete query-folding reference in our corpus: the "safe order" template, an exhaustive folds/breaks-folding/sometimes-folds function catalog, environmental fold-breakers, anti-patterns, type mappings, naming, error handling. Entirely dataset-agnostic.
- **Source path:** `plugins/semantic-models/skills/power-query/references/best-practices.md` (+ `SKILL.md`)
- **Key content (reusable):**
  - **Safe write order (maximizes folding):** 1) filter rows (→WHERE) 2) select columns (→SELECT) 3) set types (→CAST) 4) sort (→ORDER BY) 5) non-foldable transforms LAST. Rule: "Do all foldable work first, then non-foldable work."
  - **Native query escape hatch:** `Value.NativeQuery(Source, "SELECT ...", null, [EnableFolding=true])` lets later M steps fold on top.
  - **Folds (SQL):** `Table.SelectColumns/RemoveColumns`(SELECT), `Table.SelectRows`(WHERE), `Table.Sort`(ORDER BY), `Table.FirstN`(TOP), `Table.Group`(GROUP BY), `Table.TransformColumnTypes`(CAST), `Table.RenameColumns`(AS), `Table.ExpandTableColumn`/`Table.NestedJoin`(JOIN), `Table.Distinct`(DISTINCT), `Table.Skip`(OFFSET).
  - **Breaks folding (full list captured):** `Table.Buffer`/`List.Buffer`/`Table.StopFolding`; `#table`/`Table.FromList/FromRecords/FromRows/FromValue/FromColumns`; index/position ops (`Table.AddIndexColumn`, `Table.LastN`, `Table.Range`, `Table.ReverseRows`, positional Insert/Remove); most `Text.*` (Proper, Combine, Insert, Split/SplitAny, Before/After/BetweenDelimiters, Pad*, Reverse, Format, ToList, Clean); `Table.SplitColumn`/`CombineColumns`/`Splitter.*`; `Table.Transpose`/`Promote/DemoteHeaders`; `Table.FillDown/FillUp`; error handling (`Table.RemoveRowsWithErrors`, `try...otherwise` in row context); schema/metadata (`Table.Schema`, `Table.ColumnNames`, `Value.Type`); custom `(x)=>` lambdas, `Table.TransformRows`, `List.Generate/Accumulate`; `Record.*`/`Table.ToRecords/ToRows/ToList/Column`; locale date-to-text and relative-date funcs.
  - **Sometimes folds:** `Table.AddColumn`/`TransformColumns` (only SQL-translatable funcs: Text.Upper/Lower/Trim, Number.Round); `Table.Pivot/Unpivot` (SQL Server only); `Table.NestedJoin`/`Combine` (same SQL source); `Table.SelectRows`+`Text.Contains`(→LIKE); `Date.Year/Month/Day`(→YEAR/MONTH/DAY); `Date.AddDays/AddMonths`(→DATEADD); `Text.Start/End`(→LEFT/RIGHT, but Text.Middle usually not).
  - **Environmental fold-breakers:** different data sources merged; incompatible privacy levels (firewall); flat-file/Web.Contents sources; custom SQL without EnableFolding; any step after a fold-breaker.
  - **Type mappings:** `Int64.Type`, `type text/date/datetime/datetimezone/logical`, `Currency.Type` (financial), `Percentage.Type`.
  - **Anti-patterns:** filter-after-transform; unnecessary `Table.Buffer`; cross-query references; excessive step count (batch renames in one `Table.RenameColumns`).
  - **Naming:** descriptive `#"Quoted Step Names"`; PascalCase parameters (`SqlEndpoint`).
  - **Error handling:** avoid silent `try...otherwise` in production partitions (a failed refresh beats silently wrong data).
  - **Common partition patterns:** incremental-refresh `RangeStart`/`RangeEnd` filter; Lakehouse navigation; `Value.NativeQuery`.
- **Quality:** 5/5 — directly usable as the m-query-patterns knowledge base.
- **Recommendation:** adopt-as-is.

### 7. M expression validation workflow → maps to m-query-patterns skill + (future) M validation tool; method reference-only
- **What it is:** Two-tier validation: (A) execute via Fabric `executeQuery` API against real data (catches column/type/source errors); (B) save partition via XMLA/TOM (AS validates M *syntax* only). Includes a "what XMLA catches vs misses" matrix and a step-debugging technique (change the `in` clause to inspect intermediate steps).
- **Source path:** `plugins/semantic-models/skills/power-query/references/validation.md`
- **Key content:**
  - **XMLA save catches:** missing/mismatched `let`/`in`; undefined step refs; invalid function names; syntax errors; invalid type names in `TransformColumnTypes`. **Misses:** wrong column names; connectivity; runtime errors; broken folding.
  - **Step debugging:** `in Source` (table list) / `in Data` (all cols) / `in #"Filtered"` (after filter) / `in #"Selected"` (final) — wrap with `Table.FirstN(step,100)` to limit.
  - **Common errors table:** credentials not bound; queryName mismatch; column not found; datasource unreachable; 90s timeout.
  - **Validation checklist:** syntax (XMLA) → data (API + FirstN) → types (dtypes) → nulls → row count → folding (completes <90s).
- **Quality:** 4/5 (Fabric/Python-specific execution is non-Node reference-only; the *concepts* — syntax-vs-data validation tiers, step-debugging, error catalog — are reusable).
- **Recommendation:** reference-only (the "XMLA validates M syntax on save" idea is a useful cheap-check pattern for any future M tool).

### 8. Naming convention rules (11 categories) + measure-name construction grammar → maps to tmdl-conventions skill + naming BPA rules (PRIME)
- **What it is:** A complete, dataset-agnostic naming standard for TMDL objects with anti-pattern→correct tables AND **TMDL regex detection patterns** — directly usable as BPA naming rules. Plus a measure-name construction grammar.
- **Source path:** `plugins/semantic-models/skills/standardize-naming-conventions/references/naming-rules.md` (+ `SKILL.md`)
- **Core principle (verbatim):** "Names must align with the business terminology used by people in the organization. Never assume terminology -- always confirm with the user or infer from existing patterns." (This is the dataset-agnostic guardrail — the rules are about *form*, business terms are confirmed not hardcoded.)
- **Key content (rules + detection regex):**
  - **R1 Human-readable (no programming case):** detect `measure [a-z]+_[a-z]+` (snake), `measure [A-Z][a-z]+[A-Z]` (Camel), `measure [A-Z_]{4,}` (UPPER); same for `column`.
  - **R2 No abbreviations/acronyms** (exceptions: MTD/YTD/QTD or acronyms defined in description). Detect: names <5 chars not common words; `\w+\.\s` (abbrev dots); 3+ consecutive consonants; lone 1–2 letter non-articles.
  - **R3 No technical prefixes:** detect `table (DIM|FACT|dim|fact|STG|stg|RAW|raw)_`. Exception: `FP_` field params, `CG_` calc groups, `__Measures`/`__Formatting` when hidden.
  - **R4 No excessive symbols** (detect `$`, `#` except `# Customers`, emoji ranges, repeated specials).
  - **R5 Consistent aggregation syntax** (suffix MTD/QTD/YTD; `Turnover MTD`).
  - **R6 Consistent unit syntax** (parentheses: `(%)`, `(EUR)`, `(Quantity)`, `(Value)`, `(Units)`).
  - **R7 Consistent period syntax** (`nYP` = n-Year Prior: `1YP`, `2YP`, `1MP`).
  - **R8 Consistent comparison syntax** (`Base vs. Target (Unit)`, e.g. `Turnover vs 1YP (%)`; consistent `(delta)` vs symbol, `vs.` vs `vs`).
  - **R9 Display-folder organization** (numbered prefixes for sort order; example fact hierarchy `0. Measures\1. Value\i. Total/ii. 1YP...`).
  - **R10 Descriptions** (TMDL `///` on all visible measures/columns: what it calculates, business context, usage, acronym definitions).
  - **R11 Synonyms** (only real org synonyms; multilingual for international; primarily AI benefit).
  - **Measure name construction grammar:** `[Aggregation] [Base Name] [Period] ([Unit])` → e.g. `MTD Turnover vs 1YP (%)`.
  - **Column rules:** full human-readable names, standard casing, no abbreviations, hidden keys use `[Table Name] Key`, group by display folder (Hierarchy/Attributes/Keys/Facts).
  - **Rename safety (from SKILL.md):** when renaming a measure/column, update ALL internal DAX refs `[Old]`→`[New]` and `'Table'[Old Col]`→`'Table'[New Col]` across every TMDL file + relationships.tmdl; warn that downstream report visuals break and need rebinding.
- **Quality:** 5/5 — the detection regexes make this immediately actionable for our naming BPA rules.
- **Recommendation:** adopt-as-is (rules + regexes), with our CLAUDE.md guardrail noted: form-rules are universal; business terms must be confirmed, never hardcoded.

### 9. Semantic-model-auditor agent: 28 numbered audit checks → maps to model-reviewer agent (PRIME) + BPA rules engine + pbi_model_check
- **What it is:** A severity-categorized audit checklist (Critical / Memory&Size / DAX anti-pattern / Documentation / Design / Data-reduction / Direct Lake / AI-readiness) with for each: Problem, **Check** (often a concrete TMDL property or regex), Recommendation. This is essentially a ready-made BPA rule set and the backbone of our model-reviewer agent. Plus a structured audit-report output template.
- **Source path:** `plugins/semantic-models/agents/semantic-model-auditor.agent.md`
- **Key content (checks with concrete TMDL detections):**
  - Bidirectional rels: detect `crossFilteringBehavior: bothDirections` in relationships.tmdl.
  - Missing data types: columns lacking explicit `dataType:`.
  - Circular measure deps: build dependency graph, flag cycles.
  - High-cardinality dictionary columns; **unsplit DateTime** (`dataType: dateTime` used at date grain → split, ~90% memory cut).
  - Attribute hierarchies: hidden/high-card columns missing `isAvailableInMDX: false`.
  - Auto Date/Time: detect hidden `LocalDateTable_*` / `DateTableTemplate_*` tables.
  - Inappropriate types: `dataType: double` for currency; numeric stored as `string`.
  - Calculated columns (`expression:` in column def) → prefer measures / Power Query.
  - Unused columns: cross-ref column names vs measure DAX, relationships, hierarchies, report bindings.
  - DISTINCTCOUNT on high cardinality.
  - **Nested CALCULATE:** regex `CALCULATE\s*\([^)]*CALCULATE`.
  - **Division without error handling:** `/` without DIVIDE()/IFERROR → `DIVIDE(num,den,0)`.
  - Iterators over large tables w/o filter; `ALL()` vs `REMOVEFILTERS()`.
  - Missing descriptions / displayFolder; inconsistent naming.
  - Star-schema violations: dims with outgoing rels (snowflake), fact-to-fact rels.
  - >threshold columns/table; missing date table (`dataCategory: Time`).
  - Unfiltered fact history (no date filter / incremental refresh in expressions.tmdl).
  - PQ computed columns preferred over DAX calc columns.
  - Direct Lake: parquet file count (>10k guardrail), DirectQuery fallback risk (RLS in roles.tmdl, SQL endpoint views).
  - **AI-readiness:** duplicate field names across tables (excluding rel keys); NOTE — disconnected tables / M2M / inactive rels are *valid* patterns, report as informational not as defects ("if AI features matter and the model uses these, the issue isn't the design — AI may not be the right tool for that part").
- **Output template:** severity-count summary table + per-finding (Location / Problem / Recommendation) + prioritized action list.
- **Quality:** 5/5 — directly seeds our model-reviewer agent and pbi_model_check rule catalog.
- **Recommendation:** adopt-as-is (port checks to TS BPA rules; keep the "valid-but-AI-hard patterns are informational" nuance).

### 10. review-semantic-model SKILL: audit categories + date-table correctness + performance/AI-readiness references → maps to model-reviewer agent + ai-readiness skill
- **What it is:** A higher-level review workflow that overlaps the auditor agent but adds several sharper rules and the AI-readiness + performance reference content.
- **Source path:** `plugins/semantic-models/skills/review-semantic-model/SKILL.md` + `references/ai-readiness.md` + `references/performance.md`
- **Key additional content (beyond #9):**
  - **Date-table correctness (excellent, verbatim-worthy):** must be marked `dataCategory: Time` with a key Date column, have continuous daily dates (no gaps), span the full fact range, relate via a single-column relationship. Missing any → TI funcs (DATEADD, SAMEPERIODLASTYEAR, TOTALYTD) return BLANK. → maps to time-intelligence + model-reviewer.
  - Multiple facts → same dim via different keys without a conformed dim (slicer on one fact won't filter the other).
  - Inactive relationships without matching USERELATIONSHIP (incomplete modeling).
  - Missing KEEPFILTERS around non-equality predicates in CALCULATE.
  - **AI-readiness checklist (ai-readiness.md):** star schema; explicit measures (implicit/extension measures invisible to data agents); human-readable names (no CamelCase/snake/UPPER); synonyms; row labels on dims; correct default summarization (don't sum IDs); descriptions that *disambiguate* for AI vs *explain calc* for humans; AI instructions (business terms, date-field disambiguation, metric preferences). Pragmatic notes: "AI readiness can double dev time — confirm conversational BI will actually be used first"; "probably not worth investing in Verified Answers — Power BI visuals too poor."
  - **Performance reference:** tool table (VertiPaq Analyzer, BPA, DAX Studio, Performance Analyzer, Workspace Monitoring); cache states (cold/warm/hot + how to achieve); testing methodology (3–10+ runs, measure in service not local, separate SE/FE); common-DAX-issues table mirroring the patterns above.
- **Quality:** 4/5 (the date-table rule and AI-readiness checklist are 5/5; rest overlaps #9).
- **Recommendation:** adapt — pull the date-table correctness rule into time-intelligence + reviewer; AI-readiness checklist seeds our ai-readiness skill.

### 11. Refresh types + commit modes + two-phase refresh + troubleshooting matrices → maps to (peripheral) model-builder/ops knowledge; reference-only
- **What it is:** Refresh-type semantics (full/automatic/dataOnly/calculate/clearValues/add/defragment), commit modes (transactional vs partialBatch), two-phase refresh pattern, and large troubleshooting tables (credential/gateway/type/timeout/incremental/capacity/calc-table errors).
- **Source path:** `plugins/semantic-models/skills/refresh-semantic-model/references/{refresh-types,troubleshooting}.md`
- **Why partially relevant:** Mostly operational (outside our authoring focus), but two items touch our skills: (a) the `calculate` refresh "useful when only DAX logic changed" — relevant after model-builder adds measures; (b) troubleshooting note: "circular dependency on refresh — SummarizeColumns inside CalculateTable introduced new deps (Sept 2024); fix: add grouped tables as explicit filters inside SummarizeColumns" — a real DAX correctness gotcha worth a dax-patterns note.
- **Quality:** 3/5 for our focus (5/5 for an ops/refresh skill we don't have).
- **Recommendation:** reference-only (capture the SummarizeColumns-in-CalculateTable circular-dep gotcha for dax-patterns; rest is out of scope).

## Cross-source overlap flags
- **DAX anti-patterns (DIVIDE/0, nested CALCULATE, ALL vs REMOVEFILTERS, FILTER-table-vs-column, iterators):** appear in THREE places within this repo alone (auditor agent §13–16, review SKILL "DAX Anti-Patterns", performance.md table) and will overlap heavily with any other PBI repo's DAX guidance. Consolidate to a single canonical dax-patterns list (use the DAX001–021 numbering as the spine).
- **Naming rules** likely overlap with any "BPA rules" or "best practices" repo (esp. Tabular Editor BPA rule sets). The detection regexes here are more concrete than most — prefer these.
- **Star-schema / M2M / bidir / date-table heuristics** will overlap with model-review content from other PBI sources; the M2M 4-layout taxonomy (MDL001) and the explicit date-table correctness criteria here are the most detailed — treat as canonical.
- **Query folding** (folds/breaks list) is the canonical version; expect thinner duplicates elsewhere.
- **isAvailableInMDX / Auto Date-Time / DateTime-split / data-type** memory rules repeat across the auditor agent, review SKILL, and performance.md within this repo — dedupe.

## Discarded / not relevant
- **All Python scripts** — `get-downstream-reports.py`, `execute_m.py`, `preview_partition.py`, `refresh_model.py`, `get_model_info.py`: non-Node (Python + azure-identity/pyarrow/fab CLI). Marked reference-only; extracted the *patterns* (lineage = scan workspaces and match `datasetId`; executeQuery validation flow; refresh-type semantics) but discarded the code. Our stack is TS/Node.
- **`fab` CLI / Fabric REST / XMLA / TMSL command invocations** (export, api, refresh endpoints) — environment-specific operational tooling, not authoring knowledge. Discarded except where they reveal a detectable TMDL property.
- **plugin.json** — metadata only (name, version 26.20, GPL-3.0, author Kurt Buhler). Discarded.
- **Refresh status/extendedStatus value tables, Enhanced-vs-Standard refresh feature matrix, MaxParallelism/scale-out/hybrid-table ops** — operational refresh details outside DAX/M/review/naming scope. Discarded (we have no refresh skill).
- **Trace-event mechanics** (VertiPaqSEQueryEnd parsing, FE-gap waterfall, $SYSTEM DMV queries, DAX Studio/Tabular Editor tool specifics) — only actionable with live trace capture we don't have; kept the conceptual signal→pattern mapping, discarded the trace-plumbing detail as reference-only.
- **External tool/repo links** (microsoft/fabric-toolbox SemanticModelAudit, DAXPerformanceTesting, DAXPerformanceTunerMCPServer, semantic-link-labs) — noted as external references, no extractable content.
- No hardcoded dataset-specific fields found to flag — all examples use generic placeholders (`'Sales'`, `'Product'`, `'Date'`, `'Customer'`); naming examples (Turnover, COGS, Selling Margin) are illustrative anti-pattern→correct pairs, not hardcoded model assumptions.
