---
name: modeling-semantic-model
description: "Use when authoring or reading TMDL — tab indentation, triple-slash descriptions, measures-before-columns ordering, formatString, summarizeBy none, lineageTag errors, relationship direction, naming conventions (no Fact/Dim prefix), RLS, calculated tables, calculation groups, Direct Lake partition syntax"
user-invocable: false
---

# Modeling Semantic Models

Ground rules and conventions for authoring Power BI semantic models: TMDL syntax, naming, columns, relationships, and Power Query M.

## When to Use

- Before writing or modifying any TMDL file (measures, columns, tables, relationships, RLS roles)
- When naming tables, columns, or measures
- When designing relationships or adding Power Query M transformations
- When preparing a model for AI / Copilot readiness
- When emitting TMDL from a code path (e.g., `pbi_model_export`)

## When NOT to Use

- DAX performance optimization → load `authoring-measures`
- Report PBIR file authoring → load `designing-reports`
- Running or interpreting model quality checks → load `reviewing-models`
- SVG visual measures → load `authoring-svg-visuals`

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
- **Tab-only indentation** — spaces trigger `TmdlFormatException`; 1 tab per nesting level
- **`///` sets Description** — must be immediately above the declaration; no blank line between `///` and the object
- **`//` comments not supported in TMDL** — use only inside M or DAX blocks
- **No hand-written `lineageTag`** — auto-generated; adding by hand causes collisions
- **Measures before columns** — in every table definition, always
- **No `dataType` on measures** — inferred from DAX
- **Every visible measure needs a `formatString` (ERROR)** — a visible measure with an empty format string is a BPA **error** (FMT001), not a nicety; see the Format String Quick Reference below and never leave a numeric measure unformatted (`dg4:30625`)
- **Numeric KEY/ID columns must be `summarizeBy: none` (ERROR)** — a *visible numeric* column that is a key/ID (also postal code, year, month number) defaulting to `sum`/etc. silently aggregates in visuals; set `summarizeBy: none` (or hide it + expose a measure). This is a BPA **error** (MOD014), distinct from the broader string/attribute `none` guidance in `references/columns-relationships.md` (`dg4:30635`)
- **`DIVIDE` over `/`** — safe zero-protection for general use; exception: `/` inside row iterators (SUMX/AVERAGEX) where the denominator is guaranteed non-zero, to avoid an FE callback (DAX018) → `references/dax-query-rules.md`
- **Leave `PBI_*` annotations** — Power BI internal metadata; do not add or remove them
- **No `Fact`/`Dim` prefixes** — tables use business-friendly names: plural facts (`Sales`), singular dims (`Product`)
- **Mark the date table** — the model needs a date/calendar table marked as a date table for time intelligence to work (`DATEADD`/`SAMEPERIODLASTYEAR`/`TOTALYTD` return BLANK otherwise). Mark it with `pbi_table_mark_as_date(tableName, dateColumn)`, or equivalently set `dataCategory: Time` on the table **and** `isKey` on its date column. An unmarked date/calendar table is BPA MODB2; no date table at all is MODB1 (`dg4:30095`, `dg4:30105`)
- **A relationship between two fact tables is an ERROR** — never relate fact→fact directly; route both facts through a shared (conformed) dimension instead (`references/columns-relationships.md` has the build recipe). This is BPA MOD009 (`awesome-copilot-pbi-data.xml:11851`)
- **`isAvailableInMdx: false` on hidden columns** not used as a `sortByColumn`, hierarchy level, or variation → `references/columns-relationships.md`
- **Avoid `double`** — use `decimal` or `int64`; floating point causes roundoff errors and degraded performance → `references/columns-relationships.md`

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
