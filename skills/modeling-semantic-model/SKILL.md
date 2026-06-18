---
name: modeling-semantic-model
description: "Use when interpreting tool-emitted TMDL or offline CI generation — tab indentation, triple-slash descriptions, measures-before-columns ordering, formatString, summarizeBy none, lineageTag errors, relationship direction, naming conventions (no Fact/Dim prefix), RLS, calculated tables, calculation groups, Direct Lake partition syntax"
user-invocable: false
allowed-tools: Read, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_model_export, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_date_table_create_governed, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_model_plan_date_table, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_model_plan_date_grain, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_model_plan_actuals_targets_join, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_model_plan_star_schema_join, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_model_apply_star_schema_join, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_table_mark_as_date, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_model_refresh
---

# Modeling Semantic Models

Ground rules and conventions for Power BI semantic models: TMDL syntax, naming, columns, relationships, and Power Query M. Production/live model changes must go through supported MCP model tools; never hand-edit TMDL while Desktop is open and never use Python/file-surgery fallbacks for pbi-agent-kit operations.

## When to Use

- When interpreting tool-emitted TMDL or generating offline CI artifacts
- When naming tables, columns, or measures
- When designing relationships or adding Power Query M transformations
- When preparing a model for AI / Copilot readiness
- When emitting TMDL from a code path (e.g., `pbi_model_export`)

Do not use this skill as permission for manual production edits. If no supported MCP model tool exists for a requested live change, report it as unsupported/manual instead of editing TMDL files.

## When NOT to Use

- DAX performance optimization → load `authoring-measures`
- Report PBIR file authoring → in the modeling-only beta, say report/PBIR authoring is unavailable and offer modeling-only preparation.
- Running or interpreting model quality checks → load `reviewing-models`
- SVG visual measures → load `authoring-measures`

## Quick Reference

| Topic | Reference |
|---|---|
| TMDL syntax, indentation depth table, enum values, file layout | `references/tmdl-grammar.md` |
| Column properties, relationship rules, cardinality, keys, conformed-dimension build recipe | `references/columns-relationships.md` |
| Fact grain, one-grain-per-fact (G1), target-vs-actual grain-mismatch remediation (G2 options A–D) | `references/grain.md` |
| Naming conventions — human-readable names, no Fact/Dim prefix, measure construction order, detection patterns, rename impact | `references/naming.md` |
| Power Query M folding catalog, safe write order, recipes | load the `power-query` skill |
| RLS patterns, filter library, TMDL role syntax, OLS | `references/rls.md` |
| AI-readiness, Copilot 7-section checklist, before-investing gate, AI instructions guide, data schema scoping | `references/ai-readiness.md` |
| Performance tools matrix, cache states (Cold/Warm/Hot), testing methodology, common DAX performance issues | `references/performance.md` |

## Critical Rules (no exceptions)

- **Connect LIVE by default** — call model tools WITHOUT `folderPath` first. With Power BI Desktop open this edits the live model and changes appear immediately (the user presses Ctrl+S to persist). Pass `folderPath` (a `.SemanticModel/definition` folder) only when there is no live Desktop instance — offline/CI — or when a tool's error explicitly says no live instance was found. If a write fails with a ConnectFolder / "needs a live instance" error while Desktop is open, retry once WITHOUT `folderPath`; if it still fails, report the exact error and stop — do not silently fall back to hand-editing TMDL.
- **Modeling beta scope** — in the modeling-only beta, dashboard/report/page/visual/PBIR authoring is unavailable. If a user asks to build, edit, lay out, format, or publish a dashboard or report, do not attempt report work and do not suggest raw PBIR edits. Say report authoring is not available in this beta, then offer modeling-only support: live model analysis, KPI/spec preparation, DAX measures, governed Date tables, relationships, model checks, refresh, and regulated readiness.
- **No Python/file-surgery fallback** — never use `python`, `python3`, `pip`, Python one-liners, shell byte patches, or CRLF rewrite scripts to inspect data ranges, parse files, or mutate `.SemanticModel`, `.Report`, `.tmdl`, `.pbip`, CSV, or other Power BI project artifacts. Use MCP tools, deterministic planners, and repo-native Node/TypeScript tooling; if no supported tool can perform the operation, stop and report it as unsupported.
- **Tab-only indentation** — spaces trigger `TmdlFormatException`; 1 tab per nesting level
- **`///` sets Description** — must be immediately above the declaration; no blank line between `///` and the object
- **`//` comments not supported in TMDL** — use only inside M or DAX blocks
- **No hand-written `lineageTag`** — auto-generated; adding by hand causes collisions
- **Measures before columns** — in every table definition, always
- **No `dataType` on measures** — inferred from DAX
- **Every visible measure needs a `formatString` (ERROR)** — a visible measure with an empty format string is a BPA **error** (FMT001), not a nicety; see the Format String Quick Reference below and never leave a numeric measure unformatted (`dg4:30625`)
- **Numeric KEY/ID columns must be `summarizeBy: none` (ERROR)** — a *visible numeric* column that is a key/ID (also postal code, year, month number) defaulting to `sum`/etc. silently aggregates in visuals; set `summarizeBy: none` (or hide it + expose a measure). This is a BPA **error** (MOD014), distinct from the broader string/attribute `none` guidance in `references/columns-relationships.md` (`dg4:30635`)
- **`DIVIDE` over `/`** — safe zero-protection for general use; exception: `/` inside row iterators (SUMX/AVERAGEX) where the denominator is guaranteed non-zero, to avoid an FE callback (PERF018) → `../authoring-measures/references/dax-query-rules.md`
- **Leave `PBI_*` annotations** — Power BI internal metadata; do not add or remove them
- **No `Fact`/`Dim` prefixes** — tables use business-friendly names: plural fact/event names (`<BusinessProcessPlural>`), singular dimension/entity names (`<BusinessEntity>`)
- **Create/prove the Date table through governed tools** — for a new Date/Calendar table, use `pbi_date_table_create_governed`. It must ask when Date policy or refresh-before-probe policy is ambiguous, prove fact-date evidence before writing, generate dynamic fact-anchored bounds from observed fact min/max evidence, write explicit generated-column metadata, mark the table as Date, and create the Date relationships when requested. For multiple date roles on one fact table, the tool creates one active Date relationship and additional inactive role-playing relationships. Import models may reject the date-column `isKey` write; a successful table `dataCategory: Time` mark plus live unique/continuous Date-key proof is enough. Do not send users through manual mark-as-date, relationship dragging, or Auto Date/Time cleanup loops to make the governed Date table filter facts. For an existing Date table, call `pbi_model_plan_date_table` before editing calendar bounds, marking, disabling Auto Date/Time, or diagnosing Date-table blank rows. The governed Date table must have a continuous unique daily key and cover observed fact min/max dates. Do not use literal guessed dates or `TODAY()`/`NOW()` as the default calendar anchor; future padding requires explicit `futureHorizonDays`, and refresh before probing requires explicit approval. If a no-refresh proof fails for a freshness/materialization blocker, stop and ask whether to run the MCP `pbi_model_refresh` path; do not retry with refresh or ask the user to click Desktop Refresh on your own. If the blocker/status is `proof-parse-shape-unrecognized`, `parse-shape-unrecognized`, or `evidenceRows: 0`, do not request refresh/model processing. If any governed Date proof is blocked or incomplete, do not use `pbi_dax_query` as a fallback, do not provide manual DAX, and do not switch to primitive `pbi_table_create` / `pbi_table_mark_as_date` Date writes; report the structured blocker. Then mark existing proven Date tables with `pbi_table_mark_as_date(tableName, dateColumn, facts)` when needed. Do not set Date-table `dataCategory: Time` or date-key metadata through primitive table/column update tools; those writes bypass proof and are refused. An unmarked date/calendar table is BPA MODB2; no date table at all is MODB1 (`dg4:30095`, `dg4:30105`)
- **Date range policy: default to `observed-min-max` for historical analysis** — the calendar should END at the last real fact date so default-context (no date slicer) time-intelligence (TOTALYTD/QTD/MTD) returns values. Choose `observed-full-years` when whole-year buckets are wanted. Choose a `*-plus-future-horizon` policy ONLY when explicitly modeling future/budget/forecast dates — extending the calendar past the last fact date with no forecasting intent silently makes default-context period-to-date measures BLANK. `pbi_date_table_create_governed` surfaces a `futureHorizonWarning` when a future-horizon policy is used; relay it rather than later "patching" empty measures.
- **Marking a Date table is a SUPPORTED operation on Import models, and a no-op mark is NON-BLOCKING** — `pbi_table_mark_as_date` attempts the `dataCategory: "Time"` mark and verifies it with a fresh live re-read. If the re-read does not reflect the mark (a known Import-mode metadata no-op — the user sees the same unobservable read-back even after marking in Desktop), the tool returns `marked: true` with `markObservable: false` + a `warning`, NOT a hard error and NOT `marked: false` — because the gate ALREADY proved the date KEY clean from data, so the mark IS done for relationships and explicit-column time intelligence (`TOTALYTD([m], 'Date'[Key])`); only the cosmetic `dataCategory="Time"` read-back is unobservable. Treat `marked: true` + `markObservable: false` as SUCCESS and proceed; do NOT re-mark, delete, recreate, or refresh the table to chase the read-back. **Relationship creation no longer requires the mark**: `pbi_relationship_create`/`pbi_date_table_create_governed` gate Date relationships on the live data proof (continuous/unique/non-blank daily key covering every fact), not on the read-back mark, so a no-op mark cannot deadlock the join. Relay the `warning`/`markWarning` (built-in/implicit time intelligence and the Date-hierarchy UX stay off until the user marks the table in Desktop) and PROCEED — do NOT invent an "Import tables cannot be marked" rule, do NOT treat the table as unusable, and do NOT default to asking the user to mark the table or hide columns manually unless implicit time intelligence is specifically required. The same applies to `isHidden`/property updates: a hide write whose read-back does not reflect it is tolerated (cosmetic, Import false-negative), so never ask the user to hide fields that are already hidden.
- **Never deactivate a fact's only active date relationship before its replacement exists** — create the governed `fact → Date` relationship as ACTIVE first (it is a different table pair, so it does not trip `ambiguous-active-path`), THEN deactivate the auto LocalDateTable relationship. `pbi_relationship_deactivate` refuses with `date-relationship-orphan` if deactivating would leave the fact with no active date relationship; obey it rather than leaving the model with no date axis.
- **PROOF FAILURE = STOP** — for blocked, incomplete, `proof-incomplete`, `evidenceRows: 0`, `proof-parse-shape-unrecognized`, or `parse-shape-unrecognized` Date proof, report the structured payload and stop. A ROW()-based proof with raw rows but zero/partial parsed evidence (e.g. a non-ISO date serialization the parser cannot read) is a tool/parse/serialization defect, not evidence that the model is empty. Do not request Desktop restart/model processing, do not run `pbi_dax_query` or `pbi_model_refresh`, do not retry with `probeData:false`, do not paste manual DAX, and do not reconstruct Date/table/relationship writes with primitives.
- **BLOCKER = STOP, even when `probeStatus: "succeeded"`** — if any planner/gate returns a non-empty `blockers[]`, `markReadiness.ready: false`, or `markReadiness.dataProvenKey: false`, STOP after that one call and report the blockers verbatim. A `succeeded` probe with persistent blockers, or `dataProvenKey: false` on a Date table you can see is clean, is a TOOL/EVIDENCE-BINDING DEFECT to report — never a license to mutate the model to work around it. **NEVER delete or recreate an existing Date/Calendar table to clear a gate** (`pbi_date_table_create_governed` is for tables that do not yet exist, not an escape hatch); recreation is allowed only when a blocker positively names a structural defect (`date-column-not-temporal-key`, `date-table-is-auto`, or a probe positively showing blanks/dups/gaps/non-midnight on the key). **Do not re-issue a gate after it returned the same blocker code once** — a deterministic gate cannot change its answer on retry.
- **Refresh is live tooling, not a user chore** — use `pbi_model_refresh` when Import tables or calculated tables need materialization and refresh is explicitly approved. If approval is missing, ask for refresh authorization and stop. Ctrl+S persists metadata; it does not refresh/process data. Ask the user to refresh only if the live refresh tool is unavailable or returns a concrete unsupported-operation error.
- **A relationship between two fact tables is an ERROR** — never relate fact→fact directly; route both facts through a shared (conformed) dimension instead (`references/columns-relationships.md` has the build recipe). This is BPA MOD009 (`awesome-copilot-pbi-data.xml:11851`)
- **Start actuals/targets joins with the combined planner** — for actuals-vs-targets, budget-vs-actuals, forecast, or planning comparisons, call `pbi_model_plan_actuals_targets_join` first. It routes non-temporal shared axes to star-schema planning and temporal axes to date-grain proof before asking any grain question. A temporal actuals/targets axis is complete only when `dateAxisRequirement` shows one governed Date table shared by every participating fact; `LocalDateTable_*` relationships are not sufficient and `governed-date-table-required` means call `pbi_date_table_create_governed`. Ask only for unobservable business policy after proof, such as allocation or missing-target behavior.
- **Apply shared dimensions through the batch tool** — for live cross-fact categorical/shared-axis joins, call `pbi_model_plan_star_schema_join` to inspect, then `pbi_model_apply_star_schema_join` with explicit axes to dry-run or write. Generic star-schema plan/apply also returns `dateAxisRequirement` when the participating tables expose shared temporal axes. If it is `governed-date-table-required`, categorical dimensions may be planned/applied but the date-aware model is incomplete until `pbi_date_table_create_governed` creates/proves one shared governed Date table and relationships. Do not manually replay table-create/key/relationship/hide-FK primitives; if the apply tool is unavailable or unsupported, stop and report the operation as unsupported.
- **Prove target/actual date grain before rewriting or asking** — before activating date relationships, removing date-related `TREATAS`/`USERELATIONSHIP`, or before asking the user to choose target grain/day/month/year in target, budget, forecast, or planning workflows, call `pbi_model_plan_date_table` for Date coverage and `pbi_model_plan_date_grain` for observable fact grain. Do not infer daily/monthly grain from names or existing DAX. Ask only for unobservable business policy after proof, such as allocation or missing-target behavior.
- **`isAvailableInMdx: false` on hidden columns** not used as a `sortByColumn`, hierarchy level, or variation → `references/columns-relationships.md`
- **Avoid `double`** — use `decimal` or `int64`; floating point causes roundoff errors and degraded performance → `references/columns-relationships.md`

## Observable Facts Vs Business Semantics

Tool-provable facts are not user questions: column type families, date-table coverage, date grain, relationship paths, and shared-axis eligibility must come from MCP inventory/planner/proof output. If the proof blocks or returns `proof-parse-shape-unrecognized`, report it and stop.

Business semantics that cannot be observed from metadata still require user confirmation: allocation policy, missing-target behavior, fiscal/calendar policy, source-of-truth field choice, and metric intent. Ask only these after deterministic proof has run.

Use `pbi_model_apply_star_schema_join` as the single batch path for live shared-dimension builds. If batch apply blocks, report the blocker; never reconstruct it from `pbi_table_create`, `pbi_relationship_create`, or `pbi_column_create` primitives. If the response says `shared-dimensions-*-date-axis-incomplete`, do not report the whole modeling request as done; finish the governed Date axis through `pbi_date_table_create_governed`.

## Format String Quick Reference

| Type | TMDL `formatString` | Example output |
|---|---|---|
| Currency | `\$#,##0.00` | $1,234.56 |
| Integer | `#,##0` | 1,234 |
| Percentage (2dp) | `0.00%` | 45.67% |
| Percentage (0dp) | `0%` | 46% |
| Decimal (2dp) | `#,##0.00` | 1,234.56 |
| Thousands | `#,##0,K` | 1,234K |
| Millions | `#,##0,,M` | 1M |
