---
name: power-query
description: "Use when authoring or validating Power Query M expressions — query folding, fold-breaking operations, partition syntax, safe write order (filter→select→type→sort→non-foldable last), type mapping, incremental refresh RangeStart/RangeEnd, validation errors"
user-invocable: false
allowed-tools: Read
---

# Power Query for Semantic Models

Conceptual reference for Power Query M in semantic model import partitions: what good M looks like, query-folding concepts, partition syntax, and type mapping.

> **Modeling-only beta — M authoring/validation/execution is NOT available through plugin tools.** `pbi_table_create` accepts an `mExpression` partition for a new table's source, but there is no tool to execute, validate, or iteratively edit M. For M development use Power BI Desktop's Power Query Editor directly. The guidance below is reference material, not a callable tool workflow.

## When to Use

As conceptual reference when:

- Drafting a partition M expression for a new import table's source (supplied to `pbi_table_create` as `mExpression`)
- Understanding query folding issues or refresh timeouts
- Understanding what correct, foldable M looks like
- Understanding incremental refresh with `RangeStart`/`RangeEnd` parameters
- Understanding Lakehouse, SQL, or native query sources

Actual M authoring, validation, execution, and debugging happen in Power BI Desktop's Power Query Editor — not through plugin tools.

## When NOT to Use

- DAX measure authoring — use the `authoring-measures` skill instead
- Semantic model relationship or table design — use the `modeling-semantic-model` skill
- Report-layer work (dashboards, report pages, visuals, filters, slicers, themes, bookmarks, or PBIR files) — in the modeling beta, say report authoring is not available and offer modeling-only preparation instead

## Quick Reference

| Topic | Reference |
|-------|-----------|
| Query folding guide, fold-breaking catalog, type mappings, anti-patterns | `references/folding-guide.md` |
| Folding/validation concepts and common errors (reference, not a plugin workflow) | `references/validation-workflow.md` |

## Critical Rules

1. **Query folding is the most important performance concept.** The M engine translates compatible steps into native data source queries (SQL). When folding breaks, subsequent steps run in the mashup engine, pulling all data into memory first. For large tables, broken folding causes refresh timeouts or out-of-memory errors.

2. **Safe write order — foldable work first, non-foldable last:**
   1. Filter rows (`Table.SelectRows` → `WHERE`)
   2. Select / remove columns (`Table.SelectColumns` / `Table.RemoveColumns` → `SELECT`)
   3. Set types (`Table.TransformColumnTypes` → `CAST`)
   4. Sort if needed (`Table.Sort` → `ORDER BY`)
   5. Non-foldable transforms last (custom columns, text splitting, fill down, etc.)

3. **Quoted identifiers** — step names with spaces use `#"Step Name"` syntax. This is the standard Power Query convention.

4. **Parameters are PascalCase** — shared M parameters are `PascalCase` without spaces (e.g., `SqlEndpoint`, `DatabaseName`). Reference them without quotes when declared as `shared` in a section document.

## Partition Expression Structure

```
let
    Source = Sql.Database(#"SqlEndpoint", #"Database"),
    Data = Source{[Schema="dbo", Item="Orders"]}[Data],
    #"Removed Columns" = Table.RemoveColumns(Data, {"InternalId"}),
    #"Changed Type" = Table.TransformColumnTypes(#"Removed Columns", {{"Amount", Currency.Type}})
in
    #"Changed Type"
```

Key elements:
- **Parameters**: `#"SqlEndpoint"`, `#"Database"` are shared M parameters defined at the model level
- **Navigation**: `Source{[Schema="dbo", Item="Orders"]}[Data]` navigates to a specific table
- **Steps**: Each step is a named variable in the `let...in` chain
- **Quoted identifiers**: Step names with spaces use `#"Step Name"` syntax

## Common Patterns

### Incremental Refresh

Incremental refresh partitions use `RangeStart` and `RangeEnd` parameters. The filter **must fold** — place it immediately after navigation so it translates to a SQL `WHERE` clause:

```
let
    Source = Sql.Database(#"SqlEndpoint", #"Database"),
    Data = Source{[Schema="dbo", Item="Orders"]}[Data],
    #"Filtered" = Table.SelectRows(Data, each
        [OrderDate] >= #"RangeStart" and [OrderDate] < #"RangeEnd")
in
    #"Filtered"
```

When testing, inline concrete date values for `RangeStart` and `RangeEnd`.

### Lakehouse Sources

```
let
    Source = Lakehouse.Contents(null),
    Data = Source{[Id="lakehouse-guid"]}[Data],
    Table = Data{[Id="table-name", ItemKind="Table"]}[Data]
in
    Table
```

### Native Query with EnableFolding

For complex SQL that cannot be expressed in M:

```
let
    Source = Sql.Database("server", "db"),
    Data = Value.NativeQuery(Source,
        "SELECT Id, Date, Amount FROM dbo.Sales WHERE IsActive = 1",
        null, [EnableFolding=true])
in
    Data
```

`Value.NativeQuery` with `EnableFolding=true` allows subsequent M steps to fold on top of the native query result. Without `EnableFolding=true`, all downstream steps run locally.

## Fold-Breaking Operations — Quick Reference

See `references/folding-guide.md` for the full catalog. Key categories:

| Category | Examples |
|----------|---------|
| Table construction / materialization | `Table.Buffer`, `#table`, `Table.FromList`, `Table.StopFolding` |
| Row position / index | `Table.AddIndexColumn`, `Table.LastN`, `Table.ReverseRows`, `Table.AlternateRows` |
| Text functions (in row context) | `Text.Proper`, `Text.Split`, `Text.BeforeDelimiter`, `Text.PadStart` |
| Column splitting / combining | `Table.SplitColumn`, `Table.CombineColumns`, `Splitter.*` |
| Pivot / transpose / structure | `Table.Transpose`, `Table.DemoteHeaders`, `Table.PromoteHeaders` |
| Fill / imputation | `Table.FillDown`, `Table.FillUp` |
| Error handling | `Table.RemoveRowsWithErrors`, `try...otherwise` in row context |
| Custom functions / iteration | user-defined lambdas, `List.Generate`, `List.Accumulate` |
| Environmental | different data sources, privacy firewall, flat files, APIs |
