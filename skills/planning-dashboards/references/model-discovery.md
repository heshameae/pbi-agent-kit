# Model Discovery Queries

Read-only DAX queries for live semantic model exploration using `INFO.VIEW.*` and `INFO.*` rowsets.

**Source:** skills-for-fabric powerbi-consumption-cli · ruiromano powerbi-semantic-model-authoring

---

## Anti-Fabrication Invariant

**Never guess or infer table names, column names, measure names, or relationships.** Always discover them from the live model using the queries below. A name invented from intuition will produce a `"Referenced field not found"` error in Desktop that is invisible until a user opens the report.

---

## Scope Estimation — Run First

Probe object counts before deep discovery to calibrate how many queries you will need:

```dax
EVALUATE
ROW(
    "TableCount",        COUNTROWS(INFO.VIEW.TABLES()),
    "ColumnCount",       COUNTROWS(INFO.VIEW.COLUMNS()),
    "MeasureCount",      COUNTROWS(INFO.VIEW.MEASURES()),
    "RelationshipCount", COUNTROWS(INFO.VIEW.RELATIONSHIPS())
)
```

Rule of thumb: if MeasureCount > 50 or ColumnCount > 200, project into named columns rather than returning all columns.

---

## INFO.VIEW.* — Preferred First-Pass Metadata

| Function | High-value columns | Use for |
|---|---|---|
| `INFO.VIEW.TABLES()` | `Name`, `DataCategory`, `StorageMode`, `IsHidden`, `Expression`, `CalculationGroupPrecedence`, `LineageTag` | Table inventory, calculated-table detection, storage-mode audits |
| `INFO.VIEW.COLUMNS()` | `Table`, `Name`, `DataType`, `DataCategory`, `IsHidden`, `SummarizeBy`, `Expression`, `SortByColumn`, `FormatString` | Column dictionary, semantic typing, sort/summarization checks |
| `INFO.VIEW.MEASURES()` | `Table`, `Name`, `Expression`, `FormatString`, `State`, `DisplayFolder`, `KPIID` | Measure inventory, formula review, formatting/state validation |
| `INFO.VIEW.RELATIONSHIPS()` | `Relationship`, `IsActive`, `FromTable`, `FromColumn`, `ToTable`, `ToColumn`, `FromCardinality`, `ToCardinality`, `CrossFilteringBehavior` | Join topology, cardinality validation, filter-direction checks |

---

## Progressive Discovery Protocol

### Step 1 — Table inventory

```dax
EVALUATE
SELECTCOLUMNS(
    INFO.VIEW.TABLES(),
    "Table",       [Name],
    "Mode",        [StorageMode],
    "IsCalc",      IF(NOT ISBLANK([Expression]), "Y", "N"),
    "IsCalcGroup", IF(NOT ISBLANK([CalculationGroupPrecedence]), "Y", "N")
)
ORDER BY [Table] ASC
```

### Step 2 — Measure inventory (with expressions)

```dax
EVALUATE
SELECTCOLUMNS(
    INFO.VIEW.MEASURES(),
    "Table",   [Table],
    "Measure", [Name],
    "DAX",     [Expression],
    "Format",  [FormatString],
    "Folder",  [DisplayFolder]
)
ORDER BY [Table], [Measure] ASC
```

### Step 3 — Column dictionary for a specific table

```dax
EVALUATE
SELECTCOLUMNS(
    FILTER(INFO.VIEW.COLUMNS(), [Table] = "TargetTableName"),
    "Column",      [Name],
    "DataType",    [DataType],
    "SummarizeBy", [SummarizeBy],
    "IsHidden",    [IsHidden],
    "Format",      [FormatString]
)
ORDER BY [Column] ASC
```

### Step 4 — Relationship topology

```dax
EVALUATE
SELECTCOLUMNS(
    INFO.VIEW.RELATIONSHIPS(),
    "From",   [FromTable] & "[" & [FromColumn] & "]",
    "To",     [ToTable]   & "[" & [ToColumn]   & "]",
    "Active", [IsActive],
    "Cardinality", [FromCardinality] & ":1",
    "CrossFilter", [CrossFilteringBehavior]
)
ORDER BY [From] ASC
```

---

## Probe Schema of an INFO Function

When you are unsure which columns an `INFO.*` function returns (they vary by engine version):

```dax
EVALUATE
TOPN(0, INFO.VIEW.COLUMNS())
```

Returns column names and types with zero data rows — safe to run against any model.

---

## Dependency Discovery

### Dependency graph for a specific measure

```dax
EVALUATE
FILTER(
    INFO.DEPENDENCIES(),
    [OBJECT_TYPE] = "MEASURE"
        && [TABLE] = "Sales"
        && [OBJECT] = "Total Revenue"
)
```

### Reverse dependencies — what references a measure

```dax
EVALUATE
FILTER(
    INFO.DEPENDENCIES(),
    [REFERENCED_OBJECT_TYPE] = "MEASURE"
        && [REFERENCED_TABLE] = "Sales"
        && [REFERENCED_OBJECT] = "Total Revenue"
)
```

> Dependency rowset column names may vary by engine/version. Probe with `TOPN(0, INFO.DEPENDENCIES())` first to confirm available fields.

---

## Critical INFO.* Deep Metadata

| Function | Use for |
|---|---|
| `INFO.MODEL()` | Model policy/config — default mode, culture, collation, version, DirectLakeBehavior |
| `INFO.DEPENDENCIES()` | Dependency graph for a DAX query or object |
| `INFO.EXPRESSIONS()` | Partition-bound M queries (underlying Power Query) |

```dax
-- List all exposed INFO.* functions in this engine version
EVALUATE
SELECTCOLUMNS(
    FILTER(INFO.FUNCTIONS(), LEFT([FUNCTION_NAME], 5) = "INFO."),
    [FUNCTION_NAME]
)
```

---

## Structural Gap Detection Queries

### Identify many-to-many or bidirectional relationships

```dax
EVALUATE
FILTER(
    INFO.VIEW.RELATIONSHIPS(),
    [ToCardinality] = "Many"
        || [CrossFilteringBehavior] = "BothDirections"
)
```

### Find columns missing `summarizeBy: none` on non-additive numerics

```dax
EVALUATE
FILTER(
    INFO.VIEW.COLUMNS(),
    [DataType] = "Double"
        && [SummarizeBy] <> "None"
        && [IsHidden] = FALSE
)
```

### Check for measures with missing formatString

```dax
EVALUATE
FILTER(
    INFO.VIEW.MEASURES(),
    ISBLANK([FormatString])
)
```
