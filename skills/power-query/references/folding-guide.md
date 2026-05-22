# Query Folding Guide

Practical reference for writing M expressions that maximize query folding in import partitions.

## Safe Pattern Ordering

Do all foldable work first, then do non-foldable work. Every step after a fold-breaking step also runs locally — the chain cannot re-fold.

```
let
    Source = Sql.Database(SqlEndpoint, Database),
    Data = Source{[Schema="dbo", Item="Orders"]}[Data],

    -- FOLDABLE: These translate to SQL
    #"Filtered Rows" = Table.SelectRows(Data, each [Year] >= 2023),
    #"Selected Columns" = Table.SelectColumns(#"Filtered Rows",
        {"OrderId", "Date", "Amount", "CustomerId", "Status"}),
    #"Set Types" = Table.TransformColumnTypes(#"Selected Columns", {
        {"Amount", Currency.Type}, {"Date", type date}}),

    -- NON-FOLDABLE: These run in the mashup engine
    #"Added Category" = Table.AddColumn(#"Set Types", "AmountBucket",
        each if [Amount] > 10000 then "Large" else "Small", type text)
in
    #"Added Category"
```

**Order:** Filter rows → Select/remove columns → Set types → Sort → Non-foldable transforms last.

If transform logic is too complex for M, use `Value.NativeQuery` to pass native SQL directly:

```
let
    Source = Sql.Database(SqlEndpoint, Database),
    Data = Value.NativeQuery(Source,
        "SELECT Id, Date, Amount FROM dbo.Sales WHERE IsActive = 1",
        null, [EnableFolding=true])
in
    Data
```

`EnableFolding=true` allows subsequent M steps to fold on top of the native query result.

## Steps That Always Fold (SQL Sources)

| M Function | SQL Equivalent |
|------------|----------------|
| `Table.SelectColumns` | `SELECT col1, col2` |
| `Table.RemoveColumns` | `SELECT` (excluding columns) |
| `Table.SelectRows` | `WHERE` |
| `Table.Sort` | `ORDER BY` |
| `Table.FirstN` | `TOP N` |
| `Table.Group` | `GROUP BY` |
| `Table.TransformColumnTypes` | `CAST` |
| `Table.RenameColumns` | `AS` alias |
| `Table.ExpandTableColumn` | `JOIN` |
| `Table.NestedJoin` | `JOIN` |
| `Table.Distinct` | `DISTINCT` |
| `Table.Skip` | `OFFSET` |

## Steps That Always Break Folding

Once folding breaks, all subsequent steps also run locally. This catalog applies primarily to SQL Server via `Sql.Database`; other sources may differ.

### Table Construction / Materialization

- `Table.Buffer` — forces full data load to memory
- `List.Buffer` — forces full list load to memory
- `Table.StopFolding` — explicitly stops folding
- `#table` constructor
- `Table.FromList`, `Table.FromRecords`, `Table.FromRows`, `Table.FromValue`, `Table.FromColumns` — creates table locally

### Row Position / Index Operations

- `Table.AddIndexColumn` — no SQL row index equivalent
- `Table.LastN` / `Table.RemoveLastN` — no SQL BOTTOM N
- `Table.Range` (mid-range) — no SQL equivalent
- `Table.Repeat` — no SQL equivalent
- `Table.AlternateRows` — no SQL equivalent
- `Table.InsertRows`, `Table.RemoveRows` (by position) — positional, not predicate-based
- `Table.ReverseRows` — no SQL row-reverse
- `Table.FindText` — full-text search not translatable

### Text Functions (Inside `Table.TransformColumns` or `Table.AddColumn`)

- `Text.Proper` / "Capitalize Each Word"
- `Text.Combine` (multi-column merge)
- `Text.Insert`, `Text.Remove`, `Text.RemoveRange`
- `Text.Select`, `Text.Split`, `Text.SplitAny`
- `Text.BeforeDelimiter`, `Text.AfterDelimiter`, `Text.BetweenDelimiters`
- `Text.PadStart`, `Text.PadEnd`
- `Text.Reverse`, `Text.Format`
- `Text.ToList`, `Text.Clean`
- `Text.From` with format/culture arguments

### Column Splitting / Combining

- `Table.SplitColumn`
- `Table.CombineColumns`
- All `Splitter.*` functions

### Pivot / Transpose / Structure

- `Table.Transpose`
- `Table.DemoteHeaders`
- `Table.PromoteHeaders`

### Fill / Imputation

- `Table.FillDown` — requires stateful row scanning
- `Table.FillUp` — requires stateful row scanning

### Error Handling

- `Table.RemoveRowsWithErrors`
- `Table.SelectRowsWithErrors`
- `try...otherwise` in row context

### Schema / Metadata

- `Table.Schema`
- `Table.ColumnNames`
- `Value.Type`
- `Type.Is`

### Custom Functions / Iteration

- User-defined `(x) => ...` lambdas in row context
- `Table.TransformRows` — arbitrary M function per row
- `List.Generate` — iterative; no SQL equivalent
- `List.Accumulate` — iterative; no SQL equivalent
- `List.Transform` with complex logic

### Record / List / Structured Columns

- `Table.ExpandListColumn`
- `Table.ExpandRecordColumn` (except after same-source `NestedJoin`)
- `Record.*` functions
- `Table.ToRecords`, `Table.ToRows`, `Table.ToList`, `Table.Column`

### Date/Time in Row Context

- `Date.ToText` / `DateTime.ToText` / `Duration.ToText` with format strings
- `Date.IsInCurrentMonth`, `Date.IsInCurrentWeek` and similar relative date filters
- `Date.DayOfWeekName`, `Date.MonthName` — locale-dependent

### Miscellaneous

- `Table.Profile` — statistical summary; local only
- `Table.Max`, `Table.Min` (returning row) — returns record not table
- `Table.Contains`, `Table.ContainsAll`, `Table.ContainsAny`, `Table.IsDistinct` — returns boolean

## Steps That Sometimes Fold

These fold under certain conditions:

| Function | Folds when | Breaks when |
|----------|-----------|-------------|
| `Table.AddColumn` | Expression uses only SQL-translatable functions (arithmetic, `Text.Upper`) | Complex M logic |
| `Table.TransformColumns` | `Text.Upper`, `Text.Lower`, `Text.Trim`, `Number.Round` | `Text.Proper`, complex lambdas |
| `Table.TransformColumnTypes` | Compatible casts (int to decimal) | Locale-specific or M-only types |
| `Table.ReplaceValue` | Simple literal replacement | Pattern-based replacement |
| `Table.Pivot` / `Table.Unpivot` | SQL Server (PIVOT/UNPIVOT support) | Other sources |
| `Table.NestedJoin` | Both sources are the same SQL connection | Across different sources |
| `Table.Combine` / append | All inputs are same SQL source (folds as `UNION ALL`) | Mixed sources |
| `Table.SelectRows` with `Text.Contains` | SQL Server (folds as `LIKE '%value%'`) | Other sources |
| `Table.Group` | Standard aggregations (`List.Sum`, `List.Count`, `List.Average`) | Custom functions |
| `Value.NativeQuery` | `EnableFolding=true` is set | `EnableFolding` omitted or false |
| `Text.Start` / `Text.End` | Often fold as `LEFT()` / `RIGHT()` | — |
| `Text.Middle` | — | Often does not fold |
| `Date.Year`, `Date.Month`, `Date.Day` | Fold as `YEAR()`, `MONTH()`, `DAY()` | — |
| `Date.AddDays` / `Date.AddMonths` | Fold as `DATEADD()` | — |

## Environmental Fold-Breakers

Conditions (not functions) that prevent folding regardless of the M steps used:

- Merging or appending queries from **different data sources**
- Incompatible **data privacy levels** between sources (Data Privacy Firewall intervenes)
- Source is a **flat file** (CSV, Excel, JSON, XML) — no query engine
- Source is **`Web.Contents`** / API — no SQL engine
- **Custom SQL without `EnableFolding=true`** — subsequent steps run locally
- **Any step after a fold-breaking step** — chain is broken; cannot re-fold

## Type Mapping Table

| M Type | Use for |
|--------|---------|
| `Int64.Type` | Integer keys, counts |
| `type text` | Strings |
| `type date` | Date-only columns |
| `type datetime` | DateTime columns |
| `type datetimezone` | DateTime with timezone |
| `Currency.Type` | Financial amounts (fixed decimal) |
| `type logical` | Boolean flags |
| `Percentage.Type` | Rates, percentages |

Apply `Table.TransformColumnTypes` early — it folds to `CAST` in SQL. Avoid implicit type inference on large datasets.

```
#"Selected" = Table.SelectColumns(Data, {"OrderId", "Date", "Amount"}),
#"Typed" = Table.TransformColumnTypes(#"Selected", {
    {"OrderId", Int64.Type},
    {"Date", type date},
    {"Amount", Currency.Type}
}),
```

Never use `Table.TransformColumnTypes` with `Replacer.ReplaceValue` or locale-dependent conversions on large datasets — these don't fold and can introduce unexpected nulls.

## Anti-Patterns

### Pulling Entire Tables Then Filtering

```
-- Anti-pattern: filter after all transforms (filter runs locally on ALL rows)
Data = Source{[Schema="dbo", Item="BigTable"]}[Data],
#"Added Column" = Table.AddColumn(Data, ...),  -- breaks folding
#"Filtered" = Table.SelectRows(#"Added Column", each [Year] >= 2023)
```

**Fix:** Place `Table.SelectRows` immediately after navigation, before any transforms.

### Using `Table.Buffer` Unnecessarily

`Table.Buffer` forces the entire table into memory. Only use when the same table is referenced multiple times and re-evaluation would be expensive.

### Referencing Other Queries

Cross-query references (accessing a column from a different query) break folding and can cause cascading performance issues.

### Excessive Step Count

Combine related operations where natural. Do not create a separate step for each individual column rename when `Table.RenameColumns` handles multiples:

```
-- Good: one step for all renames
#"Renamed" = Table.RenameColumns(Data, {
    {"OldName1", "NewName1"},
    {"OldName2", "NewName2"}
})

-- Bad: separate step per rename
#"Renamed1" = Table.RenameColumns(Data, {{"OldName1", "NewName1"}}),
#"Renamed2" = Table.RenameColumns(#"Renamed1", {{"OldName2", "NewName2"}})
```

### Removing Columns at the End

Every column not removed travels through every subsequent step. Remove columns immediately after navigation:

```
-- Good: remove columns immediately after navigation
Data = Source{[Schema="dbo", Item="Orders"]}[Data],
#"Selected" = Table.SelectColumns(Data, {"OrderId", "Date", "Amount"}),

-- Bad: remove columns at the end after all transforms
...
#"Final" = Table.RemoveColumns(#"Transformed", {"Col1", "Col2", "Col3", ...})
```

## Verifying Folding

**In Power Query Online or Desktop:** Right-click a step and choose "View Native Query". If the option is greyed out, the step does not fold.

**Programmatically via MCP tools:** Execute the partition expression using the `pbi_dax_query` or equivalent tool. If a query against a large table completes well within the timeout, folding is likely working. If it times out or runs slowly, folding may be broken.

The most reliable signal is the presence of a native query — if the step produces one, folding is active. If not, all data is being pulled to the mashup engine.
