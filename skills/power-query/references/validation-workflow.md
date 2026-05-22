# Validating Power Query Expressions

Two complementary approaches: execute against real data (comprehensive validation) or save to the model (quick syntax check).

## The Two Approaches

| Need | Use |
|------|-----|
| Full data validation (correct columns, types, values) | Execute via API |
| Quick syntax check | Save to model via XMLA/TOM |
| Step-by-step debugging | Execute with truncated `in` clause |
| Performance testing (check folding) | Execute with full data, observe timing |

---

## Approach 1: Execute via Power Query API (Recommended)

Full validation that runs the expression and returns actual data. Catches syntax errors, missing columns, data source issues, and type problems in one step.

### What It Catches

- Syntax errors (malformed `let`/`in`, bad function calls)
- Missing or mismatched column names
- Data source connectivity issues
- Runtime errors (type conversion failures on actual data)
- Performance issues (broken query folding, via timing)

### What It Misses

Nothing significant — this is the comprehensive path. Add `Table.FirstN` to limit rows for large tables during development.

### How It Works (Summary)

1. Extract the partition expression and shared M parameters from the model
2. Wrap the expression in a section document, inlining parameter values as `shared` declarations
3. Execute via the Fabric `executeQuery` API endpoint
4. Parse the Arrow response to verify data, types, and nulls

**Building the Mashup Document:**

Wrap the expression in a section document, inlining parameter values:

```
section Section1;
shared SqlEndpoint = "myserver.database.windows.net";
shared Database = "MyDatabase";
shared Result = let
    Source = Sql.Database(SqlEndpoint, Database),
    Data = Source{[Schema="dbo",Item="Orders"]}[Data],
    #"Select Columns" = Table.SelectColumns(Data, {"OrderId", "Amount"}),
    Limited = Table.FirstN(#"Select Columns", 100)
in Limited;
```

Key points:
- Replace `#"SqlEndpoint"` references with `SqlEndpoint` (the shared declaration removes the need for quoted identifiers)
- The `shared Result = ...` name must match the `queryName` in the API call
- Add `Table.FirstN` to limit rows for large tables during testing
- For incremental refresh, inline `RangeStart` and `RangeEnd` with concrete date values

---

## Approach 2: Save to Model via XMLA/TOM

Analysis Services validates M syntax when a partition expression is saved. Faster than executing but only catches structural errors — does not detect wrong column names or data source issues.

### What XMLA Validation Catches

- Missing or mismatched `let`/`in` blocks
- Undefined step references (e.g., referencing `#"Step3"` that doesn't exist)
- Invalid M function names
- Syntax errors (missing commas, unbalanced brackets)
- Invalid type names in `TransformColumnTypes`

### What XMLA Validation Misses

- Wrong column names (expression is syntactically valid but the column doesn't exist at the source)
- Data source connectivity issues
- Runtime errors (division by zero, type conversion failures on actual data)
- Performance issues (broken query folding)

In this project, use MCP model tools (`pbi_measure_update`, TMDL export tools) to write expressions back to the model. Analysis Services returns errors like `Token Eof expected.` or `Expression.SyntaxError: Token Literal expected.` if the expression is malformed.

---

## Step-by-Step Debugging (Partition Stepping Technique)

When an expression fails or produces unexpected results, preview intermediate steps by changing the `in` clause to point at an earlier step:

```
section Section1;
shared SqlEndpoint = "myserver.database.windows.net";
shared Database = "MyDB";
shared Result = let
    Source = Sql.Database(SqlEndpoint, Database),
    Data = Source{[Schema="dbo",Item="Orders"]}[Data],
    #"Filtered" = Table.SelectRows(Data, each [Status] <> "Cancelled"),
    #"Selected" = Table.SelectColumns(#"Filtered", {"OrderId", "Amount"})
in Data;  -- Change this to inspect different steps
```

| `in` target | What it shows |
|-------------|---------------|
| `in Source` | Table listing from the database |
| `in Data` | All columns from the source table |
| `in #"Filtered"` | After row filtering |
| `in #"Selected"` | After column selection (final) |

For each step, check:
- Column names and count (did a rename/select work?)
- Row count (did a filter apply correctly?)
- Data types
- Null counts (unexpected nulls from type casting?)
- Sample values (do they look right?)

Add `Table.FirstN(stepName, 100)` before the `in` clause to limit rows when inspecting large tables.

---

## Common Error Resolution

| Error message | Cause | Fix |
|---------------|-------|-----|
| `Credentials are required to connect to the SQL source` | Connection not bound to the runner dataflow | Bind the connection via `updateDefinition` |
| `Query name not found` | `queryName` in API call doesn't match `shared` name in mashup document | Ensure both are `Result` (or the same name) |
| `Expression.Error: The column '...' was not found` | Column name mismatch between M expression and actual source table schema | Check source table schema; step through to `in Data` to see actual column names |
| `DataSource.Error: ... could not be reached` | Server unreachable or wrong endpoint | Verify connection details (`SqlEndpoint`, `Database`) |
| Timeout (90 seconds) | Query too expensive — likely broken query folding pulling all rows | Add `Table.FirstN` to limit rows; check fold-breaking operations in `folding-guide.md` |

---

## Validation Checklist

Before deploying a new or modified partition expression:

1. **Syntax** — Save to model (XMLA/TOM) to catch structural errors (`let`/`in` mismatches, undefined steps, invalid function names)
2. **Data** — Execute with `Table.FirstN(_, 100)` to verify correct columns and sample values
3. **Types** — Verify column types match expected semantic model column types; check for unexpected type coercions
4. **Nulls** — Check for unexpected nulls introduced by type casting or column selection
5. **Row count** — Execute without `Table.FirstN` (or with a large limit) to verify filter logic is correct
6. **Folding** — For large tables, verify the query completes within 90 seconds; if slow or timing out, suspect broken folding — review `folding-guide.md`
