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
| Column properties, relationship rules, cardinality, keys | `references/columns-relationships.md` |
| Naming conventions — human-readable names, no Fact/Dim prefix, measure construction order, detection patterns, rename impact | `references/naming.md` |
| Power Query M folding catalog, safe write order, recipes | `references/power-query-m.md` |
| RLS patterns, filter library, TMDL role syntax, OLS | `references/rls.md` |
| AI-readiness, Copilot 7-section checklist, before-investing gate, AI instructions guide, data schema scoping | `references/ai-readiness.md` |
| Performance tools matrix, cache states (Cold/Warm/Hot), testing methodology, common DAX performance issues | `references/performance.md` |

## Critical Rules (no exceptions)

- **Tab-only indentation** — spaces trigger `TmdlFormatException`; 1 tab per nesting level
- **`///` sets Description** — must be immediately above the declaration; no blank line between `///` and the object
- **`//` comments not supported in TMDL** — use only inside M or DAX blocks
- **No hand-written `lineageTag`** — auto-generated; adding by hand causes collisions
- **Measures before columns** — in every table definition, always
- **No `dataType` on measures** — inferred from DAX
- **Leave `PBI_*` annotations** — Power BI internal metadata; do not add or remove them
- **No `Fact`/`Dim` prefixes** — tables use business-friendly names: plural facts (`Sales`), singular dims (`Product`)

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
