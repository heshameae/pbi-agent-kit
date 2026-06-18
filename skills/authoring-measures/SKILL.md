---
name: authoring-measures
description: "Use when writing or reviewing any DAX measure — slow queries, CallbackDataID traces, SUMMARIZECOLUMNS/CALCULATE anti-patterns, IFERROR/DIVIDE errors, time intelligence (YTD/MTD/PY/YoY%/R12M), DATESINPERIOD off-by-one, calculation groups, formatString, VAR naming"
user-invocable: false
allowed-tools: Read, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_measure_create, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_measure_update, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_measure_delete, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_dax_reference_check, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_dax_query, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_model_plan_date_table, mcp__plugin_pbi-agent-kit_pbi-modeling-beta__pbi_table_mark_as_date
---

# Authoring Measures

DAX authoring rules, performance patterns, and time-intelligence guidance for writing correct and fast measures.

## When to Use

- Authoring or reviewing any DAX measure expression
- Time intelligence measures (YTD, MTD, PY, YoY%, R12M)
- Calculation group authoring in TMDL
- DAX performance investigation (`CallbackDataID`, slow SE scans, fusion issues)
- Format string and naming conventions for measures

## When NOT to Use

- Visual binding or report page layout → in the modeling-only beta, say report/PBIR authoring is unavailable and offer modeling-only preparation.
- Table/column/relationship structure → `modeling-semantic-model`
- Dashboard/report planning or KPI-page definition → in the modeling-only beta, say report/PBIR authoring is unavailable and offer modeling-only KPI/measure preparation instead

## Quick Reference

| Topic | Reference |
|---|---|
| PERF001–021 perf patterns + QRY001–004 query structure, Decision Guide, FE/SE engine model | `references/dax-performance.md` |
| Phase 1–4 optimization workflow, baseline protocol, semantic equivalence | `references/dax-performance-optimization.md` |
| FE/SE architecture, xmSQL, segment parallelism, fusion theory, trace analysis | `references/engine-internals.md` |
| MDL001–010 model patterns, DL001–002 Direct Lake patterns | `references/model-optimization.md` |
| Valid-query rules (SUMMARIZECOLUMNS, CALCULATE filters, ORDER BY) | `references/dax-query-rules.md` |
| Time intelligence items, standalone TI measures, off-by-one rules | `references/time-intelligence.md` |
| Calculation group TMDL, TI item library, precedence | `references/calc-groups.md` |
| Confirmed measure intent, data dictionary/glossary evidence, draft vs confirmed gate | `references/measure-intent-contract.md` |

## Critical Rules

- **Connect LIVE by default** — call measure tools (`pbi_measure_create`/`_update`/`_delete`) WITHOUT `folderPath` first. With Power BI Desktop open this writes to the live model and the measure appears immediately (the user presses Ctrl+S to persist). Pass `folderPath` (a `.SemanticModel/definition` folder) only when there is no live Desktop instance — offline/CI — or when a tool's error explicitly says no live instance was found. If a write fails with a ConnectFolder / "needs a live instance" error while Desktop is open, retry once WITHOUT `folderPath`; if it still fails, report the exact error and stop — never silently fall back to hand-writing TMDL.
- **DIVIDE() over `/`** — except inside iterators where the denominator is guaranteed non-zero (use `/` there for SE-native evaluation, see PERF018)
- **Never IFERROR** — wraps entire expression in FE callback; use explicit `IF(ISERROR(...), ...)` or restructure
- **KEEPFILTERS in CALCULATE** — default CALCULATE overwrites filter context; use KEEPFILTERS when intersection is intended
- **VAR prefix with `_`** — all variable names must start with `_` (e.g., `VAR _Total`, `VAR _PriorYear`)
- **formatString required on every measure** — bare TMDL form: `\$#,##0.00` not `"$#,##0.00"` (triple-quote = BPA FMT002 error)
- **TOTALYTD/TOTALQTD/TOTALMTD for standalone measures** — use DATES* variants only inside calculation group items. **The Date table must END at the last real fact date for default-context (no-slicer) period-to-date measures to return values.** If the governed Date table was created with a future-horizon policy (calendar extends past the last fact date), plain `TOTALYTD` returns BLANK without a date selection — this is the EXPECTED consequence of that range policy, not a measure bug. For historical YTD/QTD/MTD with no forecasting need, the Date table should use `observed-min-max` (or `observed-full-years`) so the calendar ends at real data and plain `TOTAL*TD([<Measure>], '<Date>'[<Key>])` is correct in default, slicer, AND drill-down contexts. **Never hand-author a "clamp to the max fact year" guard inside a measure** — it over-clamps filtered contexts, breaks drill-down, and uses the wrong granularity. If a "default to the last data period" behavior is genuinely required over a deliberately-longer calendar, use the canonical, dataset-agnostic pattern (cap the UPPER bound only, at DAY granularity, derived PER MEASURE from that measure's own fact date column, without `REMOVEFILTERS` on the user's date slicer): `VAR _LastData = CALCULATE(MAX('<Fact>'[<FactDate>]), REMOVEFILTERS('<Date>')) VAR _AsOf = MIN(MAX('<Date>'[<Key>]), _LastData) RETURN CALCULATE(TOTALYTD([<Measure>], '<Date>'[<Key>]), '<Date>'[<Key>] <= _AsOf)`. This is generated by `buildTimeIntelligenceMeasureExpression` in pbi-core (`packages/core/src/modeling/time-intelligence-plan.ts`) — mirror it exactly; do not invent a variant. **The write tool enforces this deterministically:** `pbi_measure_create`/`pbi_measure_update` run a live max-vs-max probe (the Date table's max date vs THIS measure's own fact max date, from the intent's `timeIntelligence.dateRefs`) and, if the calendar outruns the fact, REFUSE a bare `TOTAL*TD` with `reason: "time-intelligence-default-context-blank-risk"` and return the correct capped expression in `correctedExpression`. When you get that refusal, resubmit with the `correctedExpression` verbatim — do not argue with it, hand-roll a different guard, or strip the cap. This is the multi-fact case (one shared Date table spanning the union of fact max-dates) that `observed-min-max` alone cannot fix, because the calendar must still cover the longer fact.
- **Date table must be proven and marked through the model tools** — before creating time-intelligence measures, call `pbi_model_plan_date_table` for the governed date table/key and all relevant fact date columns. If marking is needed, use `pbi_table_mark_as_date(tableName, dateColumn, facts)`; do not set `dataCategory: Time` or date-key metadata directly. If Date proof is blocked, incomplete, or returns `parse-shape-unrecognized`/`evidenceRows:0` from a ROW-based proof, report the structured blocker and stop; do not use `pbi_dax_query`, manual DAX, `probeData:false`, `pbi_model_refresh`, model processing, Desktop restart, or primitive Date/relationship writes as a fallback.
- **Validate drafted DAX with `pbi_dax_reference_check` before finalizing** — for any DAX you draft offline or before writing (especially calculation-group items authored before the write), run `pbi_dax_reference_check` to confirm every table/column/measure reference resolves. (`pbi_measure_create`/`pbi_measure_update` already run this internally, so this rule is for offline/pre-write drafts that have not yet hit a write tool.)
- **Fast path for pure measure-add batches (narrowly scoped)** — a PURE measure-add is an ADD-ONLY of a NEW measure whose expression introduces NO `USERELATIONSHIP`, NO `TREATAS`, NO date-truncation, and NO new grain-sensitive cross-fact reference; it changes no table, column, relationship, calculated column, Date table/mark, or grain. A measure REWRITE/EDIT, or a new measure that removes/adds `USERELATIONSHIP`/`TREATAS`/date-truncation or could change grain semantics, is NOT eligible: it must run `pbi_model_plan_date_grain` first (and `pbi_model_plan_star_schema_join` for `TREATAS`-bridge removal) per the time-intelligence/grain discipline above. Authoring or editing calculation-group items is a STRUCTURAL write, not a pure measure-add. A task that mixes ANY structural write with measures is a structural task and takes the full path. For eligible pure measure-adds (including batches): (1) **Skip the structural `pbi_model_check`** — a pure additive measure changes zero structure, so model-check surfaces no NEW STRUCTURAL finding. Run `pbi_model_check` after STRUCTURAL writes (new tables including calculation groups/calculated tables, columns, calculated columns, relationships, conformed-dimension builds). BPA still has MEASURE-level rules that fire on a new measure — FMT001/FMT002 (formatString, error-severity) plus the DAX-operator rules (`/` instead of `DIVIDE`; `IFERROR`) — and the write path does NOT run BPA, so satisfy the authoring conventions at author time (formatString on every measure; `DIVIDE` over `/`; never `IFERROR`); optionally run ONE post-batch `pbi_model_check` if formatString/DAX-operator risk is present. (2) **Do not run a standalone `pbi_dax_reference_check`** before each write — the write tools already run the lexical reference check internally and refuse bad writes; reserve the standalone tool for DAX drafted offline before it hits a write tool (per the rule above). (3) **Inventory ONCE per task, then reuse** — run `list_tables`/`list_columns`/`list_measures` a single time up front and reuse the session-confirmed metadata for every measure in the batch; do NOT re-inventory before/after each measure. Optionally run ONE post-batch `list_measures` diff — not a per-measure re-read. STRUCTURAL writes keep full pre-build inventory plus a post-build `pbi_model_check`. The measure intent gate, the semantic clarification gate, the Date & time-intelligence discipline (including the live blank-risk probe and the `time-intelligence-default-context-blank-risk` capped-expression resubmit), and `pbi_spec_validate` STILL APPLY to fast-path writes. (The live time-intelligence blank-risk probe inside the write tools is correctness-critical and always runs when the expression uses `TOTAL*TD` etc. — it is NOT skipped by this fast path.)
- **Measure intent must be confirmed before writes** — load `references/measure-intent-contract.md` before authoring. A `draft` measure intent, missing confirmed business evidence, or inferred formula means stop with `needs-user-input`; do not guess source refs, filters, grain, additivity, targets, or RAG semantics. Direct user/domain-owner confirmation, a governed spec, or a supplied dictionary/glossary can confirm business meaning; the dictionary file is recommended context, not mandatory. Time-intelligence measure writes require confirmed Date policy, Date table proof, grain proof where relevant, fiscal/calendar policy, and incomplete-period behavior.

## Format String Quick Reference

| Type | Correct formatString |
|---|---|
| Currency | `\$#,##0.00` |
| Integer count | `#,##0` |
| Percentage | `0.0%;-0.0%;0.0%` |
| Decimal (2dp) | `#,##0.00` |
| Large currency | `\$#,##0,,\" M\"` |
| Dynamic (e.g. YoY%) | Use `formatStringDefinition` block with DAX |
