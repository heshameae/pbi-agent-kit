# Validating Power Query Expressions

> **Modeling-only beta — Power Query M authoring/validation/execution is NOT available through plugin tools.** `pbi_table_create` accepts an `mExpression` partition for a new table's source, but there is no tool to execute, validate, or iteratively edit M. For M development, validation, and debugging use Power BI Desktop's Power Query Editor directly. The material below is conceptual reference for what M validation involves and the kinds of errors to expect — it is not a callable plugin workflow.

## What M Validation Involves (Conceptual)

Validating an M expression generally means checking it on two levels:

| Level | What it confirms |
|-------|------------------|
| Syntax / structure | `let`/`in` blocks balanced, defined step references, valid M function names, valid type names |
| Data | Correct columns and types, no unexpected nulls, correct row counts, sensible sample values |

Syntax checks catch malformed `let`/`in`, undefined step references (e.g. referencing `#"Step3"` that doesn't exist), invalid M function names, missing commas or unbalanced brackets, and invalid type names in `TransformColumnTypes`. They do **not** catch wrong column names that happen to be syntactically valid, data source connectivity issues, runtime errors (type conversion failures on actual data), or broken query folding. Those only surface when the expression actually runs against the source.

In Power BI Desktop's Power Query Editor, malformed expressions surface errors such as `Token Eof expected.` or `Expression.SyntaxError: Token Literal expected.`.

## Partition Expression Structure (Conceptual)

A partition expression typically wraps source navigation and transforms in a `let...in` chain, optionally referencing shared M parameters. When inspecting behavior step by step in the Power Query Editor, point the `in` clause at an earlier step to preview intermediate results:

```
let
    Source = Sql.Database(SqlEndpoint, Database),
    Data = Source{[Schema="dbo",Item="Orders"]}[Data],
    #"Filtered" = Table.SelectRows(Data, each [Status] <> "Cancelled"),
    #"Selected" = Table.SelectColumns(#"Filtered", {"OrderId", "Amount"})
in #"Selected"  -- point at an earlier step to inspect it
```

| `in` target | What it shows |
|-------------|---------------|
| `in Source` | Table listing from the database |
| `in Data` | All columns from the source table |
| `in #"Filtered"` | After row filtering |
| `in #"Selected"` | After column selection (final) |

For each step, conceptually check: column names and count, row count, data types, null counts, and sample values. For incremental refresh, inline `RangeStart` and `RangeEnd` with concrete date values when testing in Desktop.

## Common Errors and Likely Causes (Reference)

| Error message | Likely cause |
|---------------|--------------|
| `Expression.Error: The column '...' was not found` | Column name mismatch between the M expression and the actual source table schema |
| `DataSource.Error: ... could not be reached` | Server unreachable or wrong endpoint |
| `Credentials are required to connect to the SQL source` | Connection/credentials not configured for the source |
| Refresh timeout | Query too expensive — often broken query folding pulling all rows; review `folding-guide.md` |

For folding concepts and the fold-breaking catalog, see `folding-guide.md`.
