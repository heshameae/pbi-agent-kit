---
name: authoring-measures
description: "Use when writing or reviewing any DAX measure — slow queries, CallbackDataID traces, SUMMARIZECOLUMNS/CALCULATE anti-patterns, IFERROR/DIVIDE errors, time intelligence (YTD/MTD/PY/YoY%/R12M), DATESINPERIOD off-by-one, calculation groups, formatString, VAR naming"
user-invocable: false
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

- Visual binding or report page layout → `designing-reports`
- Table/column/relationship structure → `modeling-semantic-model`
- Dashboard planning, KPI definition → `planning-dashboards`

## Quick Reference

| Topic | Reference |
|---|---|
| DAX001–021 perf patterns + QRY001–004 query structure, Decision Guide, FE/SE engine model | `references/dax-performance.md` |
| Phase 1–4 optimization workflow, baseline protocol, semantic equivalence | `references/dax-performance-optimization.md` |
| FE/SE architecture, xmSQL, segment parallelism, fusion theory, trace analysis | `references/engine-internals.md` |
| MDL001–010 model patterns, DL001–002 Direct Lake patterns | `references/model-optimization.md` |
| Valid-query rules (SUMMARIZECOLUMNS, CALCULATE filters, ORDER BY) | `references/dax-query-rules.md` |
| Time intelligence items, standalone TI measures, off-by-one rules | `references/time-intelligence.md` |
| Calculation group TMDL, TI item library, precedence | `references/calc-groups.md` |

## Critical Rules

- **Connect LIVE by default** — call measure tools (`pbi_measure_create`/`_update`/`_delete`) WITHOUT `folderPath` first. With Power BI Desktop open this writes to the live model and the measure appears immediately (the user presses Ctrl+S to persist). Pass `folderPath` (a `.SemanticModel/definition` folder) only when there is no live Desktop instance — offline/CI — or when a tool's error explicitly says no live instance was found. If a write fails with a ConnectFolder / "needs a live instance" error while Desktop is open, retry once WITHOUT `folderPath`; if it still fails, report the exact error and stop — never silently fall back to hand-writing TMDL.
- **DIVIDE() over `/`** — except inside iterators where the denominator is guaranteed non-zero (use `/` there for SE-native evaluation, see DAX018)
- **Never IFERROR** — wraps entire expression in FE callback; use explicit `IF(ISERROR(...), ...)` or restructure
- **KEEPFILTERS in CALCULATE** — default CALCULATE overwrites filter context; use KEEPFILTERS when intersection is intended
- **VAR prefix with `_`** — all variable names must start with `_` (e.g., `VAR _Total`, `VAR _PriorYear`)
- **formatString required on every measure** — bare TMDL form: `\$#,##0.00` not `"$#,##0.00"` (triple-quote = BPA FMT002 error)
- **TOTALYTD/TOTALQTD/TOTALMTD for standalone measures** — use DATES* variants only inside calculation group items
- **Date table must have `dataCategory: Time`** — missing this causes TI functions to return BLANK silently

## Format String Quick Reference

| Type | Correct formatString |
|---|---|
| Currency | `\$#,##0.00` |
| Integer count | `#,##0` |
| Percentage | `0.0%;-0.0%;0.0%` |
| Decimal (2dp) | `#,##0.00` |
| Large currency | `\$#,##0,,\" M\"` |
| Dynamic (e.g. YoY%) | Use `formatStringDefinition` block with DAX |
