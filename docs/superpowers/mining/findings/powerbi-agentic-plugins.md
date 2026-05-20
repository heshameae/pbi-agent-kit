# Mining findings: ruiromano/powerbi-agentic-plugins
Source: powerbi-agentic-plugins.xml

## Relevance summary
This is a top-tier source. Microsoft/Rui Romano's official `powerbi` Claude Code plugin ships exactly the components we are building: a `powerbi-semantic-model-authoring` skill (with `dax-performance-optimization.md`, `dax-query-guidelines.md`, `modeling-guidelines.md`, `TMDL.md`, `dax-udf-functions-guidelines.md`, `direct-lake-guidelines.md`, plus a 60-rule `bpa-rules-semanticmodel.json`) and a `powerbi-report-authoring` skill (with a JSON-Logic `bpa-rules-report.json`). The DAX performance guide (DAX001–DAX021 + QRY/MDL/DL tiers with FE/SE engine internals) and the two BPA rule sets are the single richest, most directly-portable assets across all sources mined so far. Everything here is TMDL/PBIR/DAX text-format and dataset-agnostic; nothing hardcodes dataset specifics. The fabric-cli plugin is out of scope (workspace admin) and discarded.

## High-value extractions

### DAX Performance Optimization framework (DAX001–DAX021, QRY/MDL/DL tiers) → maps to dax-patterns + time-intelligence skills, model-reviewer agent, pbi_model_check/BPA
- **What it is / why valuable:** A complete, agent-oriented DAX optimization methodology: 4 autonomy tiers, a baseline/iterate workflow, FE-vs-SE engine internals, xmSQL/trace diagnostics, and a 33-pattern catalog. Tier 1 (DAX001–DAX021) are auto-applyable measure rewrites — directly portable as dax-patterns knowledge and as detectable anti-patterns for our BPA/model-reviewer. This is the most valuable single artifact for our DAX work; far deeper than typical "use DIVIDE" lists.
- **Key content (reusable bits):**

  **Tier model & autonomy (adopt as model-reviewer/optimizer policy):**
  - Tier 1 DAX Patterns — rewrite measure/UDF defs, auto-apply, keep EVALUATE/grouping identical.
  - Tier 2 Query Structure — modify EVALUATE/grain/filters, requires user approval.
  - Tier 3 Model Changes — relationships/columns/agg tables/data types, high caution + model copy.
  - Tier 4 Direct Lake — OneLake layout/V-ordering/rowgroups, requires ETL changes.
  - Success criteria: Tier 1 = ≥10% duration improvement AND semantic equivalence (same row/col count + values); Tier 2/3/4 = ≥10% + explicit approval.

  **Engine model (adopt as dax-patterns "why" section):** FE = single-threaded, handles all DAX branching/context transition, the usual bottleneck. SE = multi-threaded VertiPaq scan, only supports +−×÷, GROUP BY, LEFT OUTER JOIN, SUM/COUNT/MIN/MAX/DISTINCTCOUNT. Core principle: push work into SE, minimize SE scans, eliminate **callbacks** (`CallbackDataID`/`EncodeCallback` in xmSQL = SE calling FE row-by-row). Fusion: *vertical* (merge measures sharing filter context into one scan; blocked by time-intelligence, per-measure filter predicates, SWITCH/IF between measures, calc-group items) and *horizontal* (merge scans differing only by one column-slice value; blocked when sliced column not in groupby, table-valued/runtime filters).

  **Trace metrics (adopt for any future timing tooling):** TotalDuration, FormulaEngineDuration, StorageEngineDuration, StorageEngineQueryCount (fewer better), SE Parallelism Factor = CpuTime÷Duration (near 1.0 = single-threaded → data-layout problem, not DAX). Diagnostic signal: "Many SE queries + high FE% + short SE scans → DAX problem (fix DAX)"; "Few SE queries + low FE + high SE duration + low parallelism → data-layout problem (DAX won't help)."

  **Tier-1 pattern catalog (each is a detectable anti-pattern + rewrite — adopt as dax-patterns entries; several map to BPA rules):**
  - DAX001 Simple column predicates as CALCULATE args, split `&&` into separate filters; avoid `FILTER(Table,…)`. *(= BPA FILTER_COLUMN_VALUES)*
  - DAX002 Replace `ADDCOLUMNS`/`SUMMARIZE`+measure with `SUMMARIZECOLUMNS`.
  - DAX003 Cache repeated/context-independent expressions in `VAR` (incl. materialize-once with SUMMARIZECOLUMNS then iterate).
  - DAX004 Remove duplicate/redundant CALCULATE filter predicates.
  - DAX005 Wrap complex first-arg of SUMMARIZE in CALCULATETABLE instead.
  - DAX006 Pre-materialize context transitions via SUMMARIZECOLUMNS before iterating.
  - DAX007 Replace `IF(cond,1,0)` with `INT(cond)` in iterators (kills callback); better, `CALCULATE(COUNTROWS, predicate)`.
  - DAX008 Reduce context transition in iterators: remove it, reduce columns (`VALUES(key)`), or reduce cardinality before iterating.
  - DAX009 Wrap SUMMARIZECOLUMNS filters in CALCULATETABLE (don't pass TREATAS/filter directly).
  - DAX010 Use CALCULATETABLE instead of FILTER to set filter context.
  - DAX011 DISTINCTCOUNT → `SUMX(VALUES(col),1)` when FE-bound is faster.
  - DAX012 `ALL(t)+VALUES(t[c])` → `ALLEXCEPT(t,t[c])` (only when column is actively filtered).
  - DAX013 SWITCH/IF branch optimization in SUMMARIZECOLUMNS (merge aggs, explicit CONVERT for type match, cache context-independent measures).
  - DAX014 `DISTINCTCOUNT(key)` on a PK → `COUNTROWS(table)`.
  - DAX015 Move iteration to lower granularity (iterate `VALUES(low-card attr)` not high-card table).
  - DAX016 Experiment with TREATAS/CROSSFILTER to override relationship direction without model change.
  - DAX017 Boolean multiplier `SUMX(KEEPFILTERS(ALL(col)), expr*(col=val))` to unblock fusion (BLANK→0 caveat).
  - DAX018 Replace `DIVIDE()` with `/` *inside iterators* when denominator guaranteed non-zero (DIVIDE forces FE callback in iterators). *(Note: opposite of the general BPA "use DIVIDE" rule — context-specific.)*
  - DAX019 Lift time intelligence to an outer CALCULATE so base measures fuse (keep base measures TI-free).
  - DAX020 Unblock horizontal fusion by lifting TI/dynamic filters out of per-slice measures.
  - DAX021 Pre-compute both aggregations at shared key grain + `NATURALINNERJOIN` instead of TREATAS/IN key round-trip.

  **Tier-2 QRY (report-author guidance, approval-gated):** QRY001 remove unneeded filters; QRY002 eliminate `__ValueFilterDM` by pushing threshold into measure (`IF(rev>x, rev)`); QRY003 reduce query grain (coarser groupby / period-end axis+pin / BLANK non-boundary dates); QRY004 remove BLANK suppression (`+0`/COALESCE inflate result).
  **Tier-3 MDL (model-reviewer):** star-schema conformance, M2M layout options A–D, cardinality/data-type reduction, agg tables, pre-computed period columns (MDL005 = pre-store `SalesLY` to avoid SAMEPERIODLASTYEAR scan), row-based TI table (MDL006), fix RI violations (MDL007), SEARCH/FIND → boolean column (MDL008), `IsAvailableInMDX=true` on disconnected slicer tables (MDL010).
- **Source path:** `plugins/powerbi/skills/powerbi-semantic-model-authoring/references/dax-performance-optimization.md`
- **Quality:** 5 — exceptional depth, agent-tuned, dataset-agnostic, examples are illustrative only.
- **Recommendation:** adapt (port Tier-1 catalog + engine/fusion explainer into our dax-patterns skill; lift DAX007/014/018/MDL005/006 into time-intelligence; turn the detectable anti-patterns DAX001/002/004/009/010 into model-reviewer/BPA heuristics; the trace/MCP-execution machinery is reference-only since we have no live-model timing tool).

### DAX Query Language Guide → maps to dax-patterns + pbi_dax_reference_check tool, model-builder agent
- **What it is / why valuable:** Rules + 13 worked examples for writing *valid* DAX queries (EVALUATE/DEFINE) for validation/analysis. Directly useful for how our model-builder validates a new measure (`EVALUATE { [Measure] }`) and for pbi_dax_reference_check semantics.
- **Key content:**
  - DAX comments use `//` not `--`; one DEFINE block; separate defs by newline (no commas).
  - **When defining a measure, fully qualify** `'Table'[Measure]`; **when using, unqualified** `[Measure]`. (Matches BPA DAX_COLUMNS_FULLY_QUALIFIED / DAX_MEASURES_UNQUALIFIED and our existing engine intent.)
  - Always `ORDER BY` when returning multiple rows; don't use ORDERBY() to sort final result.
  - CALCULATE boolean-filter restrictions: cannot use a measure/CALCULATE directly (store in VAR first); cannot reference columns from two tables; `IN` operand must be a table variable; don't assign a boolean filter to a VAR.
  - Function selection: SUMMARIZECOLUMNS for measures (returns only non-BLANK rows; no boolean filters — wrap in CALCULATETABLE), SUMMARIZE for distinct columns only (never with measure expressions), GROUPBY for table variables (`CURRENTGROUP()` only valid inside), SELECTCOLUMNS to preserve dups/rename (ORDER BY must use new names).
  - TI: DATESINPERIOD offset must match window exactly (12-month = −12 not −11); establish date context via date groupby column or date filter; with ROW(), supply external filters via CALCULATETABLE; determine "last year" from `MAX('Sales'[OrderDate])` not the Calendar max (avoids future empty dates).
- **Source path:** `plugins/powerbi/skills/powerbi-semantic-model-authoring/references/dax-query-guidelines.md`
- **Quality:** 5 — canonical, generalizable.
- **Recommendation:** adapt (fold rules into dax-patterns + a "validate measure with EVALUATE" step in model-builder; off-by-one TI rule and "MAX of fact date" belong in time-intelligence).

### bpa-rules-semanticmodel.json — 60 BPA rules → maps directly to our BPA engine (packages/core/src/modeling/bpa.ts) + pbi_model_check
- **What it is / why valuable:** Tabular Editor BPA rule set (the de-facto industry standard, same lineage as data-goblin/elegantbi rules). Each rule has ID, Name, Category (Performance / DAX Expressions / Error Prevention / Maintenance / Naming Conventions / Formatting), Severity (1=info,2=warning,3=error), Scope, a C#-style `Expression`, and sometimes `FixExpression`. Our engine already implements a handful (DAX001/FMT001/FMT002/MOD001…) as TS predicates with the *same* category/severity vocabulary — this JSON is the backlog of rules to port. Many are computable purely from parsed TMDL (no Vertipaq annotations) and are the ones to adopt first.
- **Key content — rules portable to TS now (no external Vertipaq annotations needed):**
  - `AVOID_FLOATING_POINT_DATA_TYPES` (Perf, sev2): `DataType="Double"` on column → suggest Decimal/Int64. Fix: DataType=Decimal.
  - `DAX_COLUMNS_FULLY_QUALIFIED` (sev2) / `DAX_MEASURES_UNQUALIFIED` (sev3): qualify columns, unqualify measures in DAX.
  - `USE_THE_DIVIDE_FUNCTION_FOR_DIVISION` (sev2): regex `\]\s*/` or `\)\s*/` → use DIVIDE. *(our DAX001)*
  - `AVOID_USING_THE_IFERROR_FUNCTION` (sev2): regex IFERROR → use DIVIDE/IF. *(our DAX003)*
  - `USE_THE_TREATAS_FUNCTION_INSTEAD_OF_INTERSECT` (sev2): regex INTERSECT.
  - `AVOID_USING_'1-(X/Y)'_SYNTAX` (sev2): regex `[0-9]+[-+].*SUM(…)/` → rewrite with DIVIDE+VAR.
  - `AVOID_DUPLICATE_MEASURES` (sev2): two measures with identical whitespace-stripped expression.
  - `MEASURES_SHOULD_NOT_BE_DIRECT_REFERENCES_OF_OTHER_MEASURES` (sev2): `[B] := [A]`.
  - `FILTER_COLUMN_VALUES` (sev2) + `FILTER_MEASURE_VALUES_BY_COLUMNS` (sev2): regex `CALCULATE(…, FILTER('T','T'[c]=…))` → use KEEPFILTERS / column predicate / FILTER(VALUES()). *(= DAX001/DAX010)*
  - `EVALUATEANDLOG_SHOULD_NOT_BE_USED_IN_PRODUCTION_MODELS` (sev1): regex EVALUATEANDLOG.
  - `INACTIVE_RELATIONSHIPS_THAT_ARE_NEVER_ACTIVATED` (sev2): inactive rel not referenced by any USERELATIONSHIP (per-from/to-column regex over all measures/calc items).
  - `RELATIONSHIP_COLUMNS_SAME_DATA_TYPE` (Error Prevention sev2): FromColumn.DataType != ToColumn.DataType.
  - `MANY-TO-MANY_RELATIONSHIPS_SHOULD_BE_SINGLE-DIRECTION` (sev2) + `CHECK_IF_BI-DIRECTIONAL_AND_MANY-TO-MANY…` (sev1) + `AVOID_EXCESSIVE_BI-DIRECTIONAL_OR_MANY-TO-MANY_RELATIONSHIPS` (Model sev2: >30% of relationships are bidi or M2M).
  - `MODEL_SHOULD_HAVE_A_DATE_TABLE` (sev2) + `DATE/CALENDAR_TABLES_SHOULD_BE_MARKED_AS_A_DATE_TABLE` (sev2: name contains DATE/CALENDAR but DataCategory≠"Time") + `REMOVE_AUTO-DATE_TABLE` (sev2: calc table named `DateTableTemplate_`/`LocalDateTable_`). *(our MOD001)*
  - `SNOWFLAKE_SCHEMA_ARCHITECTURE` (sev2): a table is on both the From and To side of relationships (dimension-to-dimension).
  - `REDUCE_NUMBER_OF_CALCULATED_COLUMNS` (Model sev2: >5 calculated columns) + `REDUCE_USAGE_OF_CALCULATED_COLUMNS_THAT_USE_THE_RELATED_FUNCTION` (sev2: regex RELATED in calc column).
  - `LIMIT_ROW_LEVEL_SECURITY_(RLS)_LOGIC` (sev2: RIGHT/LEFT/UPPER/LOWER/FIND in RLS) + `AVOID_USING_MANY-TO-MANY…DYNAMIC_RLS` (sev3) + `AVOID_THE_USERELATIONSHIP…AND_RLS_AGAINST_THE_SAME_TABLE` (sev3) + `CHECK_IF_DYNAMIC_RLS_IS_NECESSARY` (sev1: USERNAME/USERPRINCIPALNAME).
  - `MEASURES_USING_TIME_INTELLIGENCE_AND_MODEL_IS_USING_DIRECT_QUERY` (sev2): big regex list of ~35 TI functions — reusable as a canonical "TI function" detector for our time-intelligence skill.
  - Error Prevention: `DATA_COLUMNS_MUST_HAVE_A_SOURCE_COLUMN` (sev3), `EXPRESSION_RELIANT_OBJECTS_MUST_HAVE_AN_EXPRESSION` (sev3), `AVOID_INVALID_NAME_CHARACTERS`/`…DESCRIPTION_CHARACTERS` (sev3, with fix), `SET_ISAVAILABLEINMDX_TO_TRUE_ON_NECESSARY_COLUMNS` (sev2).
  - Maintenance: `UNNECESSARY_COLUMNS` (hidden + 0 refs + not in rel/sortby/hierarchy/RLS → Delete), `UNNECESSARY_MEASURES` (hidden + 0 refs → Delete), `ENSURE_TABLES_HAVE_RELATIONSHIPS` (sev1), `CALCULATION_GROUPS_WITH_NO_CALCULATION_ITEMS` (sev2), `PERSPECTIVES_WITH_NO_OBJECTS` (sev1).
  - Naming: `PARTITION_NAME_SHOULD_MATCH_TABLE_NAME_FOR_SINGLE_PARTITION_TABLES` (sev1, fix), `SPECIAL_CHARS_IN_OBJECT_NAMES` (tabs/CR/LF, sev2), `TRIM_OBJECT_NAMES` / `OBJECTS_SHOULD_NOT_START_OR_END_WITH_A_SPACE` (sev1/sev3).
  - Formatting: `PROVIDE_FORMAT_STRING_FOR_MEASURES` (sev3: visible measure, blank FormatString) *(our FMT001)*, `HIDE_FOREIGN_KEYS` (sev2, fix IsHidden=true: column is many-side FK and visible), `MARK_PRIMARY_KEYS` (sev1, fix IsKey=true: one-side rel target, not Time table), `HIDE_FACT_TABLE_COLUMNS` (sev2: numeric column aggregated by SUM/COUNT/AVG/etc in a measure and still visible), `FORMAT_FLAG_COLUMNS_AS_YES/NO` (sev1: name starts "Is"/ends " Flag" + numeric), `MONTH_(AS_A_STRING)_MUST_BE_SORTED` (sev2: name~MONTH, String, SortByColumn=null), `ADD_DATA_CATEGORY_FOR_COLUMNS` (sev1: country/city/continent/lat/long).
  - Rules requiring Vertipaq annotations (mark reference-only / future): bi-di vs high-cardinality (`Vertipaq_Cardinality`), long-length columns (`LongLengthRowCount`), split date/time (`DateTimeWithHourMinSec`), large-table partitioning (`Vertipaq_RowCount`), fix RI violations (`Vertipaq_RIViolationInvalidRows`).
- **Source path:** `plugins/powerbi/skills/powerbi-semantic-model-authoring/scripts/bpa-rules-semanticmodel.json`
- **Quality:** 5 — industry-standard, complete, severity+category align with our existing engine.
- **Recommendation:** adapt (port the ~40 annotation-free rules as TS predicate rules into `bpa.ts`, reusing our `BPARule`/`Severity`/category types; keep stable IDs as cross-references; the C# `Expression`/`FixExpression` are reference-only since our engine is TS predicates, but they're precise specs of each rule's logic).

### bpa-rules-report.json — report BPA (JSON-Logic) → maps to our report-reviewer agent / report-side BPA + layout skill
- **What it is / why valuable:** Report-definition best-practice rules expressed as JSON-Logic over `Report`/`Pages`/`Visuals` parts, with tunable params. We have no report-BPA engine yet; these define exactly what a report-reviewer should check on PBIR.
- **Key content (each = a portable report check + default threshold):**
  - `REMOVE_UNUSED_CUSTOM_VISUALS` — flag custom visuals registered but not used.
  - `REDUCE_VISUALS_ON_PAGE` — ≤20 visible visuals/page (excludes shape/slicer/actionButton/textbox).
  - `REDUCE_OBJECTS_WITHIN_VISUALS` — ≤6 field projections per visual (`$..projections[*]`).
  - `REDUCE_TOPN_FILTERS` — ≤4 visuals using TopN filter per page; `REDUCE_ADVANCED_FILTERS` — ≤4 Advanced filters per page.
  - `REDUCE_PAGES` — ≤10 pages/report.
  - `AVOID_SHOW_ITEMS_WITH_NO_DATA` — flag `queryState.Category.showAll==true`.
  - `HIDE_TOOLTIP_DRILLTHROUGH_PAGES` — Tooltip/Drillthrough pages must be `HiddenInViewMode`.
  - `ENSURE_THEME_COLOURS` — non-textbox visuals must not contain hardcoded `#RRGGBB`; use theme colors.
  - `ENSURE_PAGES_DO_NOT_SCROLL_VERTICALLY` — visible page height ≤720px.
  - `ENSURE_ALTTEXT` — every non-shape visual needs alt-text (disabled by default; accessibility).
- **Source path:** `plugins/powerbi/skills/powerbi-report-authoring/scripts/bpa-rules-report.json`
- **Quality:** 4 — solid checks; JSON-Logic encoding is reference-only (we'd re-implement as TS over our PBIR model).
- **Recommendation:** adapt (implement these as report-reviewer/report-BPA checks against our parsed PBIR; carry IDs + default thresholds; ENSURE_THEME_COLOURS and ALTTEXT also reinforce our theme/layout skills).

### modeling-guidelines.md → maps to tmdl-conventions, model-builder agent, model-reviewer
- **What it is / why valuable:** The prose "DO/DON'T" companion to the BPA rules — star-schema principles, naming conventions, column/measure/relationship/date-table/RLS/calc-group rules, and a format-string reference table. This is essentially our tmdl-conventions skill content, dataset-agnostic.
- **Key content:**
  - Core: Consistency Over Perfection (match existing model patterns first); default star schema (single fact, denormalized dims, single-column keys, 1:M); explicit measures (hide aggregatable columns); lean models.
  - Naming: tables plural for facts / singular for dims, no "Fact"/"Dim" prefixes; columns with spaces; dimension's main column named same as the dimension (`Product` not `Product Name`); measure TI variant convention `[m]`, `[m (ly)]`, `[m (ytd)]`.
  - Data types (case-sensitive): Int64 keys, Decimal currency (4 dp max), String, DateTime, Boolean; avoid Double. SummarizeBy=None for IDs/postal/year/month-number; isAvailableInMdx=false on hidden non-sort/non-hierarchy columns; dataCategory for geo; sortByColumn for month names.
  - Measures: distribute across tables (no single "Measures" table); always formatString; description for business logic; displayFolder; VAR with `_` prefix; DIVIDE over `/`; KEEPFILTERS/column predicate over FILTER(table); TREATAS over INTERSECT; don't set dataType on measures; no IFERROR; no `1-(x/y)`; no duplicate or pass-through measures.
  - **Format String Reference table** (currency `"\\$#,##0.00"` — note double backslash, percent `"0.00%"`, integer `"#,##0"`, thousands `"#,##0,K"`, millions `"#,##0,,M"`, etc.) — directly reusable for our format/measure tooling.
  - Relationships: single-direction default; integer keys; matching data types; isKey on dim PK (exactly one); hide FKs; no composite keys; no surrogate keys on facts; keep bidi+M2M <30%.
  - Date table required for TI: prefer source date table; dataCategory="Time"; contiguous; sort month-name by month-number; disable auto-date.
  - RLS: keep simple, push complexity upstream; no string fns; no M2M+dynamic RLS; no USERELATIONSHIP+RLS same table.
  - Calc groups for TI variations to avoid measure explosion; clear item names (Current/YTD/PY/PY YTD).
  - Parameters: centralize data-source via M parameters (`expression Server = "…" meta [IsParameterQuery=true,…]`).
- **Source path:** `plugins/powerbi/skills/powerbi-semantic-model-authoring/references/modeling-guidelines.md`
- **Quality:** 5 — comprehensive, dataset-agnostic, directly maps to our skill set.
- **Recommendation:** adopt-as-is (lift into tmdl-conventions + model-builder/model-reviewer guidance; format-string table feeds our format backend).

### TMDL.md — TMDL syntax/authoring conventions → maps to tmdl-conventions skill, model-builder agent (TMDL export)
- **What it is / why valuable:** Concrete TMDL authoring rules our model-builder must follow when exporting TMDL — several are non-obvious gotchas.
- **Key content:**
  - Object names in single quotes if they contain spaces/special chars.
  - **Don't add `lineageTag` when creating new objects.** **Don't add `//` comments in TMDL** (only inside M/DAX blocks).
  - Descriptions use `/// line` triple-slash above the object, NOT the `description:` property; don't change other properties when inserting descriptions.
  - Measures go at the **top** of the table, before columns; single-line DAX after `=`; multi-line wrapped in triple backticks; always include formatString + a `///` description.
  - Don't create measures for non-aggregatable columns (keys/descriptions) unless summarizeBy≠none.
  - `createOrReplace` is the only TMDL script command.
  - Import vs Direct Lake partition examples (m/import vs entity/directLake).
  - RLS roles: never include `PBI_Id` annotation when creating.
  - M/Power Query step-name conventions (past-tense verb, `#"Quoted Step"`, ≤50 chars; comment ≤225 chars, above the step).
- **Source path:** `plugins/powerbi/skills/powerbi-semantic-model-authoring/references/TMDL.md`
- **Quality:** 5 — exactly the conventions needed for safe TMDL emission.
- **Recommendation:** adopt-as-is (these become hard rules in tmdl-conventions; the "no lineageTag / `///` description / measures-before-columns" rules are must-haves for our model-builder exporter and could even back a TMDL-lint hook).

### dax-udf-functions-guidelines.md → maps to dax-patterns / calc reuse, model-builder agent
- **What it is / why valuable:** Reference for DAX User-Defined Functions (centralize/reuse business logic) — relevant to model-builder refactoring duplicated measure logic. Newer DAX feature, useful generalizable patterns.
- **Key content:** Syntax `(param [: Type [Subtype] [Val|Expr]], …) => body`; types Scalar (subtypes Int64/Decimal/Double/String/DateTime/Boolean/Numeric/Variant; BLANK valid for any) / Table / AnyRef (column/table/measure/calendar refs for passing into CALCULATE/TREATAS/SAMEPERIODLASTYEAR); parameter modes Val (default, evaluated at call site) vs Expr (substituted, re-evaluated in inner context — needed for TI like `PriorYearValue(expr: Scalar Variant Expr, dateColumn: AnyRef) => CALCULATE(expr, SAMEPERIODLASTYEAR(dateColumn))`). Best practices: type hints, AnyRef for references, focused single-purpose functions.
- **Source path:** `plugins/powerbi/skills/powerbi-semantic-model-authoring/references/dax-udf-functions-guidelines.md`
- **Quality:** 4 — clean reference; UDFs are a niche/newer feature so medium-high priority.
- **Recommendation:** adapt (include as an advanced section in dax-patterns; model-builder "refactor duplicated logic into UDF" workflow).

### powerbi-semantic-model-authoring SKILL.md — skill structure & workflow → maps to model-builder agent + overall plugin/skill structure
- **What it is / why valuable:** The orchestration skill — frontmatter auto-trigger description, reference manifest, tool-selection priority, and step-by-step Create/Edit/Validate/Deploy/BPA workflows. A direct template for our model-builder agent's procedure and for skill auto-trigger wording.
- **Key content:**
  - Frontmatter `description` (auto-trigger pattern enumerating numbered capabilities 1–9 incl. "Troubleshooting DAX performance", "Creating/editing TMDL", with an explicit "Does NOT handle report layout (use fabric-cli/report skill)" boundary) — excellent model for our skill descriptions.
  - **Pre-development discovery** (always before changes): list tables+storage modes → list relationships (star schema map) → list measures (avoid dup) → check naming conventions → identify storage mode.
  - Create-model workflow: requirements → storage mode → create DB (compat level 1702+) → M parameters → analyze source → design star schema → tables (partition→columns) → relationships **before** measures → explicit measures → save/deploy.
  - **Post-development validation:** check PBIP structure → test each new measure with `EVALUATE { [Measure] }` → verify relationship cardinality/direction/types → verify column sourceColumn/dataType → check duplicates/orphans; re-run until all pass.
  - Tool-selection priority: MCP server > edit TMDL files > fabric-cli export/edit/redeploy > guide user to PBIP. (Our analog: MCP tools > direct PBIR/TMDL read/write.)
  - BPA task: run rules, report by severity (Critical/High/Medium/Info).
  - Save/Export to PBIP: serialize to `[Name].SemanticModel/definition`; if no report folder, create minimal `definition.pbir` with `byPath`.
- **Source path:** `plugins/powerbi/skills/powerbi-semantic-model-authoring/SKILL.md`
- **Quality:** 5 — directly mirrors our pipeline; adopt the discovery→change→validate loop.
- **Recommendation:** adapt (model the model-builder agent and pipeline skills on these workflows; reuse the frontmatter description style and the "pre-dev discovery / post-dev validate" gates).

### powerbi-report-authoring SKILL.md + template-report-kb.md → maps to report-builder agent, bi-pattern-library/layout skills
- **What it is / why valuable:** PBIR file-format model, visual `name`/`position` schema, create/edit/align/rebind/deploy workflows, and a template-driven "adapt template visuals to this model" knowledge file with exact `visual.json` field-binding JSON shapes (Measure vs Column projection with Entity/Property/queryRef/nativeQueryRef).
- **Key content:**
  - PBIR folder structure (`definition/` + `pages/<id>/visuals/<id>/visual.json`, `bookmarks/`, `report.json`, `version.json`, `StaticResources/RegisteredResources/`, `definition.pbir`).
  - Visual schema: `$schema` URL, `name`, `position{x,y,z,height,width,tabOrder}`, `visual.visualType`.
  - **Align-visuals algorithm** (reusable for our layout skill): read positions → build wireframe → infer row/column grid by similar y/x → distribute evenly, single visual fills row, same-row visuals share height/width → write back positions; default page 1280×720.
  - Rebind: local `byPath` vs workspace `byConnection` (`connectionString:"semanticmodelid=…"`) in `definition.pbir`; deploy requires `byConnection`.
  - template-report-kb binding shapes for title/topCard(≤4 measures)/dateSlicer/barChart(category+Y)/timeSeries — exact JSON projection structure (`field.Measure.Expression.SourceRef.Entity` + `Property`, `queryRef`, `nativeQueryRef`) is directly reusable for our PBIR write/bind tooling.
  - Validation: validate against `$schema`; check Entity/Property field refs against model; verify page index + positions.
- **Source path:** `plugins/powerbi/skills/powerbi-report-authoring/SKILL.md` + `…/assets/templateReport/template-report-kb.md`
- **Quality:** 4 — strong PBIR mechanics; the visual JSON shapes are load-bearing for binding.
- **Recommendation:** adapt (report-builder workflows + bind-validator/layout skills; carry the projection JSON shapes and the align algorithm; the specific template asset files are reference-only).

### Plugin/agent structure & auto-trigger descriptions → maps to our subagents + plugin packaging
- **What it is / why valuable:** Shows how to split a Power BI agent system: 2 thin agents (architect = spec-only, developer = implement) over skills, plus marketplace/MCP wiring. Useful template for our worker-subagent + skill split and auto-trigger descriptions.
- **Key content:**
  - `powerbi-architect.agent.md` (model Opus): research-first, produces `specs/[Name].spec.md` only (EARS acceptance criteria, Mermaid arch diagram, phased Tasks); reads optional `team-standards.md`. Strong **spec template** reusable for our data-analyst/architect flow.
  - `powerbi-developer.agent.md` (model Sonnet): implements specs via skills; `/implement [path]` → locate → review → task plan → execute → ExecutionSummary. "Tool-First, not Efficiency-First" (always call tools even for known ops).
  - `marketplace.json`: two plugins (powerbi, fabric) with name/description/source/version/keywords — packaging template.
  - `.mcp.json`: single `powerbi-modeling-mcp` (npx `@microsoft/powerbi-modeling-mcp`) — note: that MCP needs a *live* Power BI Desktop/AS endpoint; our MCP is file-format (PBIR+TMDL) based, a deliberate divergence to flag.
- **Source path:** `plugins/powerbi/agents/*.agent.md`, `.claude-plugin/marketplace.json`, `plugins/powerbi/.mcp.json`, `plugins/powerbi/README.md`
- **Quality:** 4 — clean architecture template; the architect spec template is the standout.
- **Recommendation:** adapt (architect spec template → our data-analyst/spec output; agent frontmatter description style; note our MCP is file-based vs their live-AS MCP — different tool surface, so their MCP tool names are reference-only).

### direct-lake-guidelines.md → maps to tmdl-conventions (Direct Lake section), model-builder
- **What it is / why valuable:** Direct Lake specifics for TMDL emission (a storage mode our model-builder must handle correctly).
- **Key content:** All DL partitions use `EntityPartitionSource` (mode `directLake`, `entityName`/`schemaName`/`expressionSource`) — never M/Power Query; require a shared named expression via `AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/[WORKSPACE_ID]/[LAKEHOUSE_ID]", [HierarchicalNavigation=true])` (not `Sql.Database`); columns still declared with `sourceColumn`; `binary` columns unsupported (drop them). Includes a full TMDL DL table example.
- **Source path:** `plugins/powerbi/skills/powerbi-semantic-model-authoring/references/direct-lake-guidelines.md`
- **Quality:** 4 — focused, generalizable.
- **Recommendation:** adapt (Direct Lake subsection of tmdl-conventions; model-builder DL partition emitter).

## Cross-source overlap flags
- **BPA rules:** This `bpa-rules-semanticmodel.json` is the same Tabular Editor/elegantbi lineage as the rule sets in data-goblin and likely awesome-copilot. Consolidate into ONE canonical TS rule set (stable IDs), don't triple-implement. Our existing `bpa.ts` already uses matching category/severity vocabulary — this JSON is the authoritative superset to grow it toward. The report BPA JSON-Logic set is unique here (no semantic-model overlap) and has no equivalent in our engine yet.
- **DAX perf guidance:** Overlaps with data-goblin/SQLBI-derived DAX advice (DIVIDE, KEEPFILTERS over FILTER, TREATAS over INTERSECT, ALLEXCEPT, COUNTROWS over DISTINCTCOUNT-on-PK). This source is **deeper** (DAX001–DAX021 + fusion + FE/SE + trace tiers) — treat it as the primary for dax-patterns and reconcile shorter lists into it rather than vice versa.
- **Conflict to reconcile:** General rule "use DIVIDE not /" (BPA `USE_THE_DIVIDE_FUNCTION_FOR_DIVISION`, our DAX001, modeling-guidelines) vs perf rule DAX018 "use / not DIVIDE *inside iterators* (when denom non-zero)". Both are correct in context; our dax-patterns must state the iterator exception so model-reviewer doesn't false-flag.
- **TI function list:** The ~35-function regex in `MEASURES_USING_TIME_INTELLIGENCE_AND_MODEL_IS_USING_DIRECT_QUERY` is a reusable canonical TI-function detector — share it across time-intelligence skill, the DQ-TI BPA rule, and DAX019/020 detection.
- **Naming/format conventions:** modeling-guidelines naming + format-string table overlaps other sources' convention docs; pick this one as canonical for tmdl-conventions (it's the official Microsoft set).

## Discarded / not relevant
- **Entire `plugins/fabric/` tree** (fabric-cli SKILL.md, references admin/workspaces/notebooks/lakehouse/dataflow/querying-data, semantic-model-definition assets, `fabric/.mcp.json`, README) — workspace/pipeline administration and `fab` CLI runtime; out of scope per HARD RULES (CLI/admin, not authoring patterns). Note only: fabric uses a `.mcp.json` too.
- **Report template binary/JSON asset files** — `templateReport/report/definition/pages/mainPage/visuals/{barChart,dateSlicer,logo,timeSeries,title,topCard}/visual.json`, `page.json`, `pages.json`, `report.json`, `version.json`, `theme.json`, `.platform`, `definition.pbir`, `report.dummyModel/*` (database.tmdl, model.tmdl, daxQueries.json, editorSettings/localSettings), `templateReport.pbip` — sample template instances; the generalizable binding shapes are already captured from template-report-kb.md, so the raw files add no portable pattern.
- **`bpa.ps1` (both copies)** — PowerShell wrapper invoking Tabular Editor 2.0; reference-only (we run BPA natively in TS), no logic to port beyond "runs the JSON rules."
- **`pbip.md`** — PBIP folder-structure reference; lightly useful but redundant with PBIR/TMDL structure already captured in the two SKILL.md files; skim-level only, nothing uniquely portable.
- **Repo meta** — `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, root `README.md`, LICENSE — boilerplate.
