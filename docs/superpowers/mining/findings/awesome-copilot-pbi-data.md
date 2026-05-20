# Mining findings: awesome-copilot — Power BI / data slice
Source: awesome-copilot-pbi-data.xml

## Relevance summary
This slice is highly relevant to our shared-knowledge skills and reviewer agents: it contains six dense Microsoft-aligned **instruction** files (DAX, data-modeling, report-design, RLS, custom-visuals, DevOps/ALM), four **agents** (DAX / data-modeling / performance / visualization expert), and seven **skills**. The single most architecturally aligned artifact is the `powerbi-modeling` skill — a Claude-format SKILL.md with five reference files that is **driven by an MCP modeling server** (`measure_operations`, `relationship_operations`, `security_role_operations`, etc.), nearly a mirror of our design; its references (STAR-SCHEMA, RELATIONSHIPS, MEASURES-DAX, PERFORMANCE, RLS) are tight, checklist-bearing, and adopt-quality. The instruction files are broad and excellent for dax-patterns / rls-patterns / tmdl-conventions / table+kpi design, but use AdventureWorks example names (must be de-hardcoded). The "ai-readiness" content here is repo-AI-readiness (AgentRC maturity scoring of CLAUDE.md/AGENTS.md) and does NOT match our semantic-model `ai-readiness` skill — discarded. All examples are dataset-specific (Sales/Customer/Product) and must be treated as templates, never adopted as literal field references.

## High-value extractions

### `powerbi-modeling` skill — MCP-driven modeling skill with 5 references → maps to powerbi-modeling agent + tmdl-conventions, dax-patterns, rls-patterns, bi-pattern-library
- **What it is / why valuable**: The closest analog in the whole corpus to our architecture: a SKILL.md whose workflow is "connect to live model via MCP → assess health → guide using reference docs," with an explicit MCP-operations table. This is exactly how our model-builder/model-reviewer agents + MCP tools should be wired. The five reference files are the best concise, checklist-ended knowledge in the slice.
- **Key content**:
  - Workflow gate: "**Before providing any modeling guidance, always examine the current model state**" → list connections, model_operations(Get), table/relationship/measure List. Mirror this "analyze-first" gate in our model agents.
  - Model Quality Checklist table (adopt as our model-reviewer rubric): clear dim/fact classification; human-readable names (`Customer Name` not `CUST_NM`); all tables/columns/measures documented; explicit DAX measures; one-to-many dim→fact; single-direction cross-filter unless needed; hide technical keys/IDs; dedicated marked date table.
  - MCP operation categories: `connection_operations | model_operations(Get,GetStats,ExportTMDL) | table_operations | column_operations | measure_operations(List,Get,Create,Update,Move) | relationship_operations(...Activate,Deactivate) | dax_query_operations(Execute,Validate) | calculation_group_operations | security_role_operations(...GetEffectivePermissions)`. Useful as a checklist for our MCP tool surface coverage.
- **Source path**: `skills/powerbi-modeling/SKILL.md` (+ `references/*.md`)
- **Quality**: 5 — directly architecture-aligned, generalized except example names.
- **Recommendation**: adapt (port the analyze-first workflow + quality checklist; map operation names to our MCP tools).

### STAR-SCHEMA.md reference → maps to tmdl-conventions, bi-pattern-library, model-reviewer
- **What it is / why valuable**: Crisp star-schema rules with a special-dimensions catalog and an anti-pattern table — ideal grain/relationship checks for model-reviewer BPA.
- **Key content** (reusable verbatim, generalized):
  - Dimension = descriptive attributes, unique key, one row/entity, singular-noun name; Fact = quantitative, FKs, consistent grain, business-process noun.
  - Special dims: **Role-playing** (duplicate table OR inactive rel + USERELATIONSHIP); **SCD Type 2** (StartDate/EndDate + IsCurrent); **Junk** (combine low-cardinality flags into one table); **Degenerate** (keep OrderNumber/InvoiceID in fact).
  - Anti-pattern table: wide denormalized → split; snowflake → flatten; M2M without bridge → add bridge; mixed-grain facts → separate tables per grain.
  - Validation checklist: each table clearly dim/fact; facts have FKs to all related dims; dims have unique keys; date table exists & marked; no circular paths; consistent naming.
- **Source path**: `skills/powerbi-modeling/references/STAR-SCHEMA.md`
- **Quality**: 5. **Recommendation**: adapt.

### RELATIONSHIPS.md reference → maps to tmdl-conventions, model-reviewer (relationship checks)
- **What it is / why valuable**: Cardinality + cross-filter decision tables, the CROSSFILTER-instead-of-bidirectional pattern, role-playing via USERELATIONSHIP, and a relationship-troubleshooting matrix.
- **Key content**:
  - Prefer one-to-many; single-direction default. **Avoid bidirectional; prefer `CROSSFILTER(...BOTH)` in a measure** over a bidirectional relationship: e.g. `Countries Sold = CALCULATE(DISTINCTCOUNT(Customer[Country]), CROSSFILTER(Customer[CustomerKey], Sales[CustomerKey], BOTH))`.
  - Only one active path between two tables; role-playing → `CALCULATE([Total Sales], USERELATIONSHIP(Sales[ShipDate], Date[Date]))`.
  - Troubleshooting: "Ambiguous Path" = multiple active paths (deactivate redundant); "Relationship Not Detected" = mismatched data types / trailing spaces in text keys.
- **Source path**: `skills/powerbi-modeling/references/RELATIONSHIPS.md`
- **Quality**: 5. **Recommendation**: adapt.

### RLS.md reference → maps directly to rls-patterns skill + model-reviewer
- **What it is / why valuable**: The single best-organized RLS knowledge in the slice — static vs dynamic, four implementation patterns, common-mistakes list, OLS, and a validation checklist. Generalized (only generic Region/Email columns).
- **Key content** (reusable):
  - Principles: **filter dimensions not facts** (smaller tables, propagation); minimal roles (each role = separate cache; **roles are additive/UNION, not intersection**); prefer dynamic RLS via `USERPRINCIPALNAME()`.
  - Patterns: (1) direct user mapping `[CustomerEmail]=USERPRINCIPALNAME()`; (2) security table + `[Region] IN SELECTCOLUMNS(FILTER(SecurityMapping,[UserEmail]=USERPRINCIPALNAME()),"Region",[Region])`; (3) manager hierarchy via `PATHCONTAINS`; (4) combined `||` with IsGlobal flag.
  - Defensive default pattern: `IF(USERPRINCIPALNAME() IN VALUES(SecurityMapping[UserEmail]), [Region] IN SELECTCOLUMNS(...), FALSE())`.
  - Common mistakes: RLS on fact tables only (perf); using LOOKUPVALUE instead of relationships; expecting intersection; forgetting DirectQuery (filters → WHERE); not testing edge cases.
  - OLS for column/table hiding (XMLA/TMSL only). Admins bypass RLS.
- **Source path**: `skills/powerbi-modeling/references/RLS.md`
- **Quality**: 5. **Recommendation**: adopt-as-is (de-hardcode example column names).

### MEASURES-DAX.md reference → maps to dax-patterns, tmdl-conventions, kpi-design-rules
- **What it is / why valuable**: Naming-convention tables + measure-organization (display folders, format strings) + patterns. The naming tables and display-folder structure are excellent for tmdl-conventions & our gate-measure-create hook.
- **Key content**:
  - Naming tables — Tables: dim=singular noun, fact=business process, bridge=combined names, measure table=underscore prefix (`_Measures`). Columns: keys→`Key`/`ID` suffix, dates→`Date` suffix, flags→`Is`/`Has` prefix. Measures: aggregations=Verb+Noun, ratios=`X per Y`/`X Rate`, time-intel=Period+Metric (`YTD Sales`,`PY Sales`), comparisons=`Metric vs Baseline`.
  - Explicit-measure rules: always create for key metrics, filter-manipulating calcs, MDX/Excel use, controlled aggregation. Implicit OK only for simple exploration with correct SummarizeBy (amounts=Sum, keys=None, rates=None/Average).
  - Format-string table: Currency `$#,##0.00`, Percentage `0.0%`, Whole `#,##0`, Decimal `#,##0.00`.
  - Display-folder convention with `\\` nesting (`Time Intelligence\\Year`); folder tree example.
  - Qualify columns, never qualify measures; use variables.
- **Source path**: `skills/powerbi-modeling/references/MEASURES-DAX.md`
- **Quality**: 5. **Recommendation**: adopt-as-is (naming/format tables generalize cleanly).

### PERFORMANCE.md reference → maps to dax-patterns, m-query-patterns, model-reviewer (perf BPA)
- **What it is / why valuable**: Compact data-reduction + DAX + DirectQuery optimization with concrete from→to data-type tables and a perf validation checklist. Strong source for BPA-style perf rules.
- **Key content**:
  - Data-type optimization table: DateTime→Date (8→4 bytes), Decimal→Fixed Decimal, Text-with-numbers→Whole Number, long→short text.
  - Cardinality reduction table: split DateTime; round decimals; extract text prefix/suffix; surrogate integer keys.
  - **Prefer Power Query (M) columns over DAX calculated columns** (load faster, compress better); avoid calc columns on relationship keys (no indexes, complex DirectQuery SQL); `COMBINEVALUES(",", [Country],[City])` for composite keys.
  - DAX: use variables; **avoid `FILTER(entireTable,...)`** → use column predicate `CALCULATE([m], Sales[Amount]>1000)`; `KEEPFILTERS`; `DIVIDE` over `/`.
  - DirectQuery: disable auto date/time; keep measures simple; minimize transforms (become subqueries).
- **Source path**: `skills/powerbi-modeling/references/PERFORMANCE.md`
- **Quality**: 5. **Recommendation**: adapt (turn the from→to tables and "avoid FILTER on whole table" into BPA rules).

### power-bi-dax-best-practices.instructions.md → maps to dax-patterns (PRIME), svg/time-intelligence
- **What it is / why valuable**: The largest DAX pattern catalog in the slice — variables, reference syntax, error-handling, time-intel, ABC/Pareto, ranking, cohort, market-basket, debugging, doc/version-history comment blocks, unit-test measures. Massive reusable template library for dax-patterns.
- **Key content** (high-value patterns, all need de-hardcoding):
  - Core rules: always variables; **fully qualify columns, never qualify measures**; **avoid IFERROR/ISERROR — use `DIVIDE` and defensive model design**; don't convert BLANK→0.
  - Anti-patterns: nested CALCULATE → single CALCULATE with multiple filters; `FILTER` as filter arg → direct predicate.
  - Time intel: `DATESYTD`/`DATESMTD`/`SAMEPERIODLASTYEAR`; 3-month moving avg via `EDATE(MAX,-2)`+`DATESBETWEEN`; QoQ via `DATEADD(...,-1,QUARTER)`; fiscal-YTD pattern computing fiscal-year start.
  - Advanced: ABC classification via running-total SWITCH; `RANKX(ALL(...),[m],,DESC,DENSE)`; Top-N-with-ties via `MIN` over `TOPN`; `Dynamic Measure Selector` via `SELECTEDVALUE` + `SWITCH` (field-parameter pattern → calc-group-patterns).
  - Naming/folder prefixes: `KPI - `, `Calc - `, `Base - `; hierarchical measure dependencies (Base→Derived→Advanced).
  - Calc-group time-intel pattern: `CALCULATE(SELECTEDMEASURE(), 'Time Intelligence'[Time Calculation]="YTD")` → calc-group-patterns.
- **Source path**: `instructions/power-bi-dax-best-practices.instructions.md` (overlaps DAX expert agent `agents/power-bi-dax-expert.agent.md`)
- **Quality**: 5 for breadth, 3 for hardcoding. **Recommendation**: adapt (extract patterns as parameterized templates).

### power-bi-data-modeling-best-practices.instructions.md → maps to tmdl-conventions, m-query-patterns, bi-pattern-library
- **What it is / why valuable**: Comprehensive star-schema + storage-mode + advanced-pattern doc with DO/DON'T blocks, a concrete date-table column spec, SCD/role-play/bridge patterns, and TMSL/M partition + incremental-refresh examples (M-query gold for m-query-patterns).
- **Key content**:
  - Date-table attribute spec: continuous range, mark as date table, Year>Quarter>Month>Day hierarchy, `IsWorkingDay`/`FiscalYear`/`FiscalQuarter`, DateKey as `YYYYMMDD` integer.
  - Storage modes: Import (data reduction), DirectQuery (index source, simple measures), Composite, **Dual** for dims relating to both Import & DirectQuery facts.
  - Incremental refresh M pattern with **query folding** using `RangeStart`/`RangeEnd` + `Int32.From(DateTime.ToText(...,"yyyyMMdd"))`; note: `Value.NativeQuery(...,[EnableFolding=false])` disables folding.
  - SCD Type 1 hash-change-detection in M (`Binary.ToText(Text.ToBinary(Text.Combine(...,"|")))` + NestedJoin anti-join).
  - Anti-pattern blocks for schema & relationships (snowflake, single-table, M2M-without-justification, bidirectional-everywhere, circular).
- **Source path**: `instructions/power-bi-data-modeling-best-practices.instructions.md` (overlaps `agents/power-bi-data-modeling-expert.agent.md`)
- **Quality**: 5 / 3 hardcoding. **Recommendation**: adapt.

### power-bi-security-rls-best-practices.instructions.md → maps to rls-patterns
- **What it is / why valuable**: Extends RLS.md with **dynamic security via `CUSTOMDATA()`**, time-based security, partial RLS, principle-of-least-privilege + explicit-role-validation patterns, and security-test/audit DAX measures. (Embedded C#/SQL/JSON parts are non-Node, reference-only.)
- **Key content** (DAX, reusable):
  - `CUSTOMDATA()` dynamic filtering via SWITCH with `FALSE()` default-deny.
  - Time-based: `CutoffDate = SWITCH(UserRole, "Executive", DATE(1900,1,1), "Manager", TODAY()-365, "Analyst", TODAY()-90, TODAY())` then `[Date]>=CutoffDate`.
  - **Least-privilege default**: count user permissions; if none → `FALSE()` (no access unless explicitly granted).
  - Anti-patterns: overly-permissive `TRUE()` default; overly-complex time-of-day/weekday security that's unauditable.
  - Security-test measure (`HASONEVALUE` + `VALUES` role check) and data-exposure audit measure (`COUNTROWS(accessible)/COUNTROWS(ALL)`).
  - SQL Server / Fabric Warehouse `CREATE SECURITY POLICY ... ADD FILTER PREDICATE` — non-Node, reference-only (relevant only if source-side RLS).
- **Source path**: `instructions/power-bi-security-rls-best-practices.instructions.md`
- **Quality**: 5 / 3. **Recommendation**: adapt (DAX patterns); reference-only for C#/SQL/embedded JSON.

### power-bi-report-design-best-practices.instructions.md + report-design-consultation skill → maps to layout-patterns, audience-styles, table-design-rules, kpi-design-rules, report-reviewer
- **What it is / why valuable**: The deepest report-UX knowledge: chart-selection-by-data-relationship matrix, page-layout ASCII templates, audience-specific patterns (executive/analytical/operational), color semantics, typography hierarchy (with pt sizes), accessibility rules, conditional-formatting thresholds, and functional/UX test checklists. Direct fuel for layout-patterns, audience-styles, kpi/table design rules and report-reviewer.
- **Key content**:
  - Chart-selection matrix: comparison→bar/column/bullet/dot; trend→line/area/stepped/sparkline; composition→stacked/donut(≤5-7)/treemap/waterfall; distribution→histogram/box/scatter/heatmap. Plus pie limitations (use stacked bar instead).
  - **Visual hierarchy / layout**: primary top-left & header, secondary main body, tertiary (filters/nav) sidebars/footer; Z-pattern; 8/16/24px spacing grid; **max 6-8 visuals/page**.
  - Audience styles (→ audience-styles): Executive = high-level KPIs + R/Y/G exception + trend arrows + minimal text + whitespace; Analytical = multi-level + drill-down + period-over-period; Operational = real-time + status indicators + mobile + action-oriented.
  - Color semantics: green=positive, red=negative, blue=neutral, orange=warning, gray=inactive; min 4.5:1 contrast; never color-only; colorblind-safe.
  - Typography hierarchy with sizes (titles 18-24pt bold … data labels 9-11pt … captions 8-10pt); max 2 font families; ≥10pt for viz.
  - Conditional formatting thresholds (table-design-rules / kpi): green >110% target, yellow 90-110%, red <90%; data bars consistent scale.
  - Tooltip/drillthrough/cross-filter best practices: report-page tooltip optimal 320×240; clear drillthrough cues + hide drillthrough pages; edit interactions thoughtfully.
  - Visual-perf-by-type ranking (kpi/table rules): fast=Card/KPI/Gauge; moderate=Bar/Column/Line; slower=Scatter/Map/Custom; slowest=Matrix/Table-many-columns.
- **Source paths**: `instructions/power-bi-report-design-best-practices.instructions.md`, `skills/power-bi-report-design-consultation/SKILL.md`, `agents/power-bi-visualization-expert.agent.md`
- **Quality**: 5. **Recommendation**: adapt (split across layout-patterns / audience-styles / table+kpi rules).

### Reviewer/consultation skill prompts (model-design-review, dax-optimization, performance-troubleshooting) → maps to model-reviewer, report-reviewer, pbi-audit, pbi-fix-model
- **What it is / why valuable**: These are structured *prompt* skills (not MCP-wired) but their review frameworks, tiered checklists, and output templates are excellent blueprints for our reviewer agents' prompts and pbi-audit output format.
- **Key content**:
  - `power-bi-model-design-review`: phased review (architecture → perf/scalability → governance/security); a **30-min Quick Assessment Checklist** and a **4-8h Comprehensive Checklist**; Executive-Summary output template with High/Medium/Low priority + implementation roadmap (quick wins / short / long term). Adopt the priority-bucketing + checklist structure for model-reviewer & pbi-audit.
  - `power-bi-performance-troubleshooting`: issue-classification → baseline metrics (page <10s, interaction <3s, query <30s) → diagnosis by Model/DAX/Report/Infra → Quick-Win (30min) / Comprehensive (2-4h) / Strategic (1-2wk) workflows; before/after DAX optimization example.
  - `power-bi-dax-optimization`: 4-step analyze→strategy→optimized→justify framework + output format with an ANALYSIS comment block. Good template for a DAX-fix verb / model-builder self-review.
- **Source paths**: `skills/power-bi-model-design-review/SKILL.md`, `skills/power-bi-performance-troubleshooting/SKILL.md`, `skills/power-bi-dax-optimization/SKILL.md`
- **Quality**: 4 (verbose, prompt-only, no tool wiring). **Recommendation**: adapt (mine checklists + output templates; drop the consulting fluff).

### Agent frontmatter / prompt design comparison → informs our model/report agents
- **What it is / why valuable**: All four expert agents share a reusable design we can compare against: a fixed "Core Responsibilities → Expertise Areas → Framework → Anti-Patterns → Response Structure (numbered) → Key Focus Areas" skeleton, and a hard rule to **consult `microsoft.docs.mcp` first** before answering. The numbered "Response Structure" (Documentation Lookup → Analysis → Best-Practice Application → Perf → Testing → Alternatives) is a clean reusable agent-output contract.
- **Key content**: frontmatter fields `description / name / model / tools[]`; consistent "Always search Microsoft documentation first" gate. Their weakness vs ours: **no live-model tool wiring** (advice-only) except the separate powerbi-modeling skill — reinforces that our MCP-tool-driven agents are the better pattern, but their checklist/anti-pattern depth is worth importing.
- **Source paths**: `agents/power-bi-{dax,data-modeling,performance,visualization}-expert.agent.md`
- **Quality**: 4 (design), reference for prompt structure. **Recommendation**: reference-only / adapt the Response-Structure contract and the "consult docs MCP first" gate (we can point at Context7/MS Learn).

### power-bi-custom-visuals-development.instructions.md → maps (partially) to svg-dax-patterns / report-builder, mostly reference-only
- **What it is / why valuable**: TS/React/D3 patterns for building **pbiviz custom-visual packages** (IVisual lifecycle, DataView parsing, D3 scales/enter-merge-exit, selection manager). It IS Node/TS, but it targets compiling separate `.pbiviz` artifacts — out of scope for our PBIR/TMDL authoring. Tangential value: the DataView→render mental model and SVG generation thinking could inform svg-dax-patterns (SVG-measure visuals), but the code itself doesn't map.
- **Source path**: `instructions/power-bi-custom-visuals-development.instructions.md`
- **Quality**: 4 (well-written) but low relevance. **Recommendation**: reference-only (note for svg-dax-patterns mental model; do not import code).

### power-bi-devops-alm-best-practices.instructions.md → maps to PBIP repo layout, pbi-build/CI conventions (light)
- **What it is / why valuable**: Mostly PowerShell/Azure-DevOps/Fabric-REST (non-Node, reference-only), BUT two bits are useful: the **PBIP folder-structure** convention and a CI **project-validation** step.
- **Key content**:
  - PBIP layout: `Model/model.tmdl`, `Model/tables/*.tmdl`, `Model/relationships/`, `Model/measures/`, `Report/report.json`, `Report/pages/<Section>/page.json` + `visuals/`, `Report/bookmarks/`. Useful sanity-check vs our PBIR/TMDL writer's expected paths.
  - Validation gate: assert `Model/model.tmdl`, `Report/report.json`, `Model/tables` exist before deploy — a cheap structural check our pbi-build/validator could mirror.
  - Data-quality test via `executeQueries` DAX (row-count/freshness PASS/FAIL) — concept reusable for a TS validation tool; PowerShell impl is reference-only.
- **Source path**: `instructions/power-bi-devops-alm-best-practices.instructions.md`
- **Quality**: 3 (mostly out-of-runtime). **Recommendation**: reference-only (adopt PBIP-path expectations + structural-validation idea only).

## Cross-source overlap flags
- **DAX best practices** heavily overlap between `instructions/power-bi-dax-best-practices`, `agents/power-bi-dax-expert`, `skills/powerbi-modeling/references/MEASURES-DAX.md`, and `skills/power-bi-dax-optimization` — same canon (variables, qualify-columns/never-measures, DIVIDE-over-/, no-IFERROR, no-BLANK→0, single-vs-nested CALCULATE, FILTER-as-arg anti-pattern). Expect strong overlap with data-goblin DAX findings (dg3-semantic-models). Consolidate into one dax-patterns rule set; this slice adds the richest *advanced-pattern* templates (ABC/Pareto, cohort, Top-N-ties, fiscal-YTD).
- **RLS** triple-covered (`instructions/...security-rls`, `references/RLS.md`, modeling-expert agent snippet). RLS.md is cleanest; the instructions file adds CUSTOMDATA/time-based/least-privilege. Likely overlaps dg semantic-model RLS — RLS.md's "roles are additive/UNION", "filter dims not facts", "USERPRINCIPALNAME over LOOKUPVALUE" are the canonical points to dedupe on.
- **Star schema / relationships / storage modes**: overlap between `references/STAR-SCHEMA.md` + `references/RELATIONSHIPS.md` + `instructions/...data-modeling` + modeling-expert agent. The reference files are the distilled version; the instruction file is the expanded version with M/TMSL examples.
- **Report design** overlaps between `instructions/...report-design`, `skills/...report-design-consultation`, and `agents/...visualization-expert` — same chart-matrix, color semantics, 6-8 visuals/page, typography sizes, accessibility 4.5:1. Will overlap any other report-design source (dg2-reports).
- **Performance** overlaps `references/PERFORMANCE.md` + `agents/...performance-expert` + `skills/...performance-troubleshooting` + perf sections of other files; metrics targets (page<10s/interaction<3s/query<30s) repeat across all three perf artifacts.

## Discarded / not relevant
- **All `dataverse-python-*.instructions.md` (16 files)** — Python Dataverse SDK; non-Node, wrong product. Discarded.
- **`ai-readiness-reporter.agent.md`, `acreadiness-assess`, `acreadiness-generate-instructions`, `acreadiness-policy` skills, `acreadiness-cockpit` plugin** — these are **AgentRC repo-AI-readiness** tools (score a repo's CLAUDE.md/AGENTS.md/CI maturity 1-5, generate copilot-instructions). This is NOT Power BI semantic-model AI-readiness (our `ai-readiness` skill = making *models* LLM/Q&A-friendly: synonyms, descriptions, linguistic schema). Completely different domain → discarded for ai-readiness, but the **maturity-model + Fix-First/Fix-Next/Plan severity bucketing** is a minor reusable output-format idea for our audit reports.
- **`ms-sql-dba`, `postgresql-dba` agents; `postgresql-code-review`, `postgresql-optimization`, `sql-code-review`, `sql-optimization`, `sql-sp-generation`, `ms-sql-dba.instructions`, `sql-server-table-reconciliation` (incl. reconcile.py)** — generic SQL/DBA, not PBI authoring; reconcile.py is Python. Discarded (source-DB tuning only tangentially helps DirectQuery, already covered by PERFORMANCE.md).
- **`convert-cassandra/jpa-to-spring-data-cosmos.instructions.md`** — Java/Cosmos migration; irrelevant. Discarded.
- **`fabric-lakehouse` skill + references (getdata.md, pyspark.md)** — PySpark/lakehouse ingestion; non-Node, upstream of modeling. Discarded.
- **`semantic-kernel` skill (dotnet.md, python.md)** — agent-framework SDK, unrelated to PBI authoring. Discarded.
- **`snowflake-semanticview` skill** — Snowflake semantic views (different platform). Discarded (only conceptually adjacent to TMDL).
- **`database-data-management` / `power-bi-development` / `acreadiness-cockpit` plugin.json + READMEs** — packaging manifests; the `power-bi-development/plugin.json` is a minor reference for how to bundle agents+skills into a plugin (we already have our own plugin structure). Low value, otherwise discarded.
- **`use-cliche-data-in-docs.instructions.md`** — doc style guide for sample data; irrelevant. Discarded.
- **Embedded-analytics C#/JSON + PowerShell deployment code** (in RLS + DevOps + visualization-expert files) — non-Node, reference-only at best (embed-token RLS identity shape, PBIP paths). Not adopted.
