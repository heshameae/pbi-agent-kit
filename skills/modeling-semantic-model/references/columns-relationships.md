# Column Properties & Relationships Reference

Rules for column properties and relationship/star-schema design in Power BI semantic models (TMDL format). For canonical TMDL syntax, indentation, property-ordering, and enum value sets, see `references/tmdl-grammar.md` — this file covers the *meaning* and *correct values* of column and relationship properties, not the grammar.

Concrete table/column names in this reference are illustrative syntax only. For production writes, replace every identifier with fields returned by the deterministic planner, validated spec, or live model inventory. Do not copy sample names into a user model.

---

## Column Properties

### dataType (required for data columns)

Specifies the column's data type. Required on every data column (the exception is calculated-table columns, where the type can be inferred from the DAX expression).

| Value | Description | When to Use |
|-------|-------------|-------------|
| `string` | Text values | Names, codes, descriptions, categories |
| `int64` | 64-bit integer | Keys and identifiers, counts, year numbers, integer quantities |
| `double` | Double-precision floating point | Avoid — causes roundoff errors and degraded performance |
| `decimal` | Fixed-point decimal (max 4 decimal digits) | Currency amounts, precise financial values |
| `dateTime` | Date and time | Date columns, timestamps |
| `boolean` | True/False | Flag columns, indicators |
| `binary` | Binary data | Rarely used in analytical models |

```tmdl
column 'Product Name'
	dataType: string
```

**Avoid `double`.** Use `decimal` or `int64` instead — floating point causes roundoff errors and degraded performance.

For flag/boolean columns (names starting with "Is" or ending with "Flag"), prefer `string` type with "Yes"/"No" values for readability, or keep as `boolean`.

### sourceColumn

References the Power Query output column (the partition source expression) that feeds this column. Every data column must have a `sourceColumn`, and it must map to a column in the partition source in **both name and data type**.

```tmdl
// When column name matches source name
column 'Product Name'
	sourceColumn: Product Name

// When column is name-inferred (auto-generated from source)
column '<InferredColumnName>'
	isNameInferred
	sourceColumn: [<SourceColumnName>]
```

`isNameInferred` indicates the column name was automatically derived from the source. A `sourceColumn` value in square brackets is the M expression format.

### summarizeBy

Controls the default aggregation when the column is dragged into a visual without an explicit measure. This is a UI metadata property — it does **not** affect DAX calculations.

| Value | When to Use |
|-------|-------------|
| `none` | Keys, attributes, dates, text columns, non-additive numbers, sort-key numerics |
| `sum` | Additive numeric facts (amounts, quantities, line totals) |
| `count` / `min` / `max` / `average` / `distinctCount` | Rarely used; prefer explicit measures |

**Use `none` for** (this is the safe default — when in doubt, use `none`):

- All key columns (surrogate keys, natural keys, foreign keys)
- All text/string columns (names, codes, types, descriptions)
- All date/dateTime columns
- All boolean columns
- Non-additive numerics (rates, percentages, ratios, rankings)
- Numerics that serve as sort keys (e.g., month number used to sort month name)
- Year-number columns

A year number must never be summed — it is an attribute, not a fact:

```tmdl
// Anti-pattern: year number set to sum
column 'Calendar Year Number'
	summarizeBy: sum

// Correct
column 'Calendar Year Number'
	summarizeBy: none
```

> **This is an ERROR, not a preference, for numeric KEY/ID columns.** A *visible numeric* column that is a key/identifier (also postal code, year, month number) with `summarizeBy != none` silently aggregates when dropped on a visual. The model checker flags it as **MOD014 (error)** (`dg4:30635`). Either set `summarizeBy: none` or hide the column and expose a measure. This is the numeric-key-specific escalation of the general "use `none` when in doubt" guidance above.

**Use `sum` only** for additive fact columns where implicit SUM makes business sense — and even then, prefer creating an explicit measure and hiding the column.

### isHidden

A flag property (no value) that hides the column from report authors. Written on its own line.

```tmdl
column 'Product Key'
	dataType: int64
	isHidden
	summarizeBy: none
	sourceColumn: Product Key
```

**When to hide:**

- Surrogate / foreign key columns (used only in relationships)
- Aggregatable fact columns that are exposed through a measure (the measure is the user-facing interface)
- Technical / system columns not relevant to report authors
- Columns superseded by a hierarchy

### isAvailableInMdx

Set `isAvailableInMdx: false` on **hidden** columns that are:

- not used as a `sortByColumn`,
- not referenced in user hierarchies, and
- not used in variations.

This saves memory and processing time. Do not disable it on a column that another column sorts by — that breaks the sort.

### dataCategory

Tags a column with a semantic category. Set it for:

- Geographic columns — e.g. `City`, `Country`, `Continent` map to `dataCategory: City`, `Country`, etc., plus latitude / longitude columns.
- The Date table — mark it with `pbi_table_mark_as_date(tableName, dateColumn, facts)` after `pbi_model_plan_date_table` proves continuity and fact coverage. Primitive `dataCategory: Time` writes are refused because they bypass the Date-table proof gate.

**Marking the date table (mechanism).** A model needs its date/calendar table marked as a date table or time intelligence (`DATEADD`/`SAMEPERIODLASTYEAR`/`TOTALYTD`) returns BLANK. Agents must use `pbi_table_mark_as_date(tableName, dateColumn, facts)` or `pbi_date_table_create_governed` so the live continuity and fact-coverage gate runs. Direct `pbi_table_update(dataCategory:"Time")` and date-key/category column writes are refused. Import models may reject the date-column `isKey` write; a table `dataCategory: Time` mark plus live proof that the date column is unique, nonblank, gap-free, and covered is accepted as governed. An unmarked date/calendar table is flagged as **MODB2**; a model with no date table at all as **MODB1** (`dg4:30105`, `dg4:30095`).

### sortByColumn

Specifies another column to sort this column by — typically a text column sorted by a numeric companion (the classic case: month name sorted by month number, so it orders chronologically instead of alphabetically).

```tmdl
column 'Calendar Month'
	summarizeBy: none
	sourceColumn: [Calendar Month]
	sortByColumn: 'Calendar Month Number'
```

**Rules:**

- The sort column must be in the **same table**.
- It should have a one-to-one or many-to-one relationship with the sorted column.
- It must exist in the model, and its `isAvailableInMdx` must not be `false`.

### isKey

A flag property marking the column as the table's primary key.

```tmdl
column '<DimensionKeyColumn>'
	isKey
	summarizeBy: none
	sourceColumn: [<DimensionKeySourceColumn>]
```

- Only **one** column per table may have `isKey`.
- It enables certain DAX optimizations.
- On the Date table, `dataCategory: Time` and the date-key metadata attempt are applied only through `pbi_table_mark_as_date(tableName, dateColumn, facts)` or `pbi_date_table_create_governed` after coverage proof succeeds. Do not write Date-table key/category metadata through primitive update tools. If Import mode rejects `isKey`, rely on the governed tool output and live Date-key proof instead of asking for manual metadata repair.
- On a dimension table, mark the unique key column with `isKey` (see Relationships below).

> Property ordering within a column block (`dataType` → `formatString` → `lineageTag` → `displayFolder` → `summarizeBy` → `isHidden` → `isKey` → `sortByColumn` → `sourceColumn` → `annotation`), `lineageTag`, `displayFolder`, and annotation rules live in `references/tmdl-grammar.md`.

---

## Relationships & Star-Schema Design

### Default to a star schema

When modeling data, **always default to a star schema**: a single fact table surrounded by denormalized dimension tables, with clear one-column relationship keys and one-to-many relationships. Only deviate when there is a strong, explicit requirement a star schema cannot satisfy.

- Avoid snowflake dimensions and dimension-to-dimension relationships.
- Ensure every table has at least one relationship to another table (except utility tables) — don't leave orphan tables disconnected without a clear reason.

### Conformed (shared) dimensions

When **two or more fact tables share the same categorical attribute**, do **not** relate the facts to each other and do **not** duplicate the dimension. Extract **one** conformed dimension table for each shared attribute returned by `pbi_model_plan_star_schema_join`, and relate **both** facts to it. Shared dimensions are how separate facts are sliced and compared consistently.

> **A relationship whose both endpoints are fact tables is an ERROR, not just a smell** — route both facts through a shared dimension instead. The model checker flags fact-to-fact relationships as MOD009 (error) (`awesome-copilot-pbi-data.xml:11851`). (Sharing a dimension at *different grains* is a related concern — see `references/grain.md` for the target-vs-actual grain-mismatch case.)

**A `TREATAS` (or other virtual-relationship) bridge in a measure is a SMELL** that a real shared dimension is missing. If a measure uses `TREATAS(VALUES(FactA[Col]), FactB[Col])` to align two facts on a shared column, the proper fix is to extract `Col` into a conformed dimension and create real relationships from both facts — the measure then drops the `TREATAS` and aggregates across the relationship. **Propose this rather than leaving the bridge in place.** (The model checker surfaces this bridge as MOD016, and two facts that share a categorical column with no shared dimension path as MOD010.)

#### Conformed-dimension build path

When you find the same categorical column on two facts (or a `TREATAS` bridge), build the real shared dimension:

Before writing anything for a cross-fact shared-dimension fix, call `pbi_model_plan_star_schema_join` with the actual two table names and explicit shared axes. Treat its `proposedDimensions`, `keyColumnWrites`, `relationshipWrites`, `relationshipRepairWrites`, `hideFkWrites`, `dateAxisRequirement`, and `blockers` as the deterministic source of truth. Stop on `relationship-repair-unsupported` or `relationship-write-blocked`; those are not prompt-level judgment calls. Do not invent a `Dim X` table name or create a direct fact-to-fact relationship unless the planner explicitly returns `directFactRelationshipAllowed: true` (for cross-fact joins, expect `false`). If `dateAxisRequirement` is `governed-date-table-required`, the categorical shared-dimension fix can proceed but the date-aware model remains incomplete until `pbi_date_table_create_governed` creates/proves one shared governed Date table and relationships.

For live model writes, call `pbi_model_apply_star_schema_join` with explicit axes. Use `dryRun: true` when you need to show or verify the executable sequence without changing the model; use the same apply tool without `dryRun` to write. It re-plans from the live model, refuses blockers, creates/reuses calculated dimensions, refreshes calculated metadata, hardens dimension key metadata, creates/repairs single-direction many-to-one relationships, hides fact-side FK fields, validates the final state, and carries unresolved Date-axis requirements forward. If it returns `shared-dimensions-*-date-axis-incomplete`, do not report the full modeling request as done. Do not manually replay the table/key/relationship/hide-FK primitives; if the apply tool is unavailable or unsupported, stop and report the operation as unsupported.

If the bridge also involves date filters, a governed Date table, or a target/actual measure, call `pbi_model_plan_date_table` before calendar/date-table changes and `pbi_model_plan_date_grain` before activating date relationships or removing date-related `USERELATIONSHIP`/`TREATAS`. A star-schema categorical fix does not prove whether the Date table covers fact min/max dates or whether the target date column is daily, month-start, submonthly, or unknown.

The apply tool executes this conceptual recipe:

1. **Create the dimension table.** The planner uses a calculated table that pulls the distinct domain *from the two tables in the planner request* — `DISTINCT`, `SELECTCOLUMNS`, or `SUMMARIZE` over the fact column(s). For the current two-table planner, use the union of both planned source domains so one table does not create orphan keys in the other. A one-table `DISTINCT` is only acceptable when an upstream constraint proves the other table cannot contain extra keys.
   ```dax
   -- Illustrative only: replace every placeholder from planner output.
   <DimensionTable> =
       DISTINCT (
           UNION (
               DISTINCT ( '<LeftFactTable>'[<SharedKeyColumn>] ),
               DISTINCT ( '<RightFactTable>'[<SharedKeyColumn>] )
           )
       )

   -- For key + label shapes, use planner-confirmed source columns only.
   <DimensionTable> =
       SELECTCOLUMNS (
           DISTINCT ( '<SourceTable>'[<SharedKeyColumn>] ),
           "<SharedKeyColumn>", '<SourceTable>'[<SharedKeyColumn>]
       )
   ```
   (Or build it in Power Query / M if the domain has attributes the facts don't carry.) Mark its key column `isKey: true`.
2. **Relate BOTH facts to it.** The apply tool creates or repairs one relationship from each fact's key column to the shared dimension key (fact = many-side, dimension = one-side, `cardinality: "manyToOne"`). The gate verifies endpoints, key types, active paths, and date-relationship rules.
3. **Hide the FK columns** on both facts (`isHidden`) — the dimension is now the user-facing source of truth; the raw many-side keys must not appear in the field list. Leaving both the dimension field and fact FK visible creates duplicate fields and lets report authors accidentally slice only one fact table. The apply tool treats skipped hide-FK writes as incomplete.
4. **Simplify / drop the `TREATAS`.** Rewrite the affected measure to aggregate across the new relationship and remove the virtual-relationship bridge. If the `TREATAS` includes date truncation or date-key remapping, only remove it when `pbi_model_plan_date_table` proves Date-table coverage and `pbi_model_plan_date_grain` proves the target fact is at the required date grain; otherwise use the grain-alignment patterns in `references/grain.md`.

### Role-playing dimensions

When one fact has **multiple columns that reference the same dimension**, create **one active** relationship for the planner-confirmed primary axis and **one inactive** relationship per extra role — reusing the single dimension, not a physical copy per role. Activate the inactive one inside specific measures with `USERELATIONSHIP`:

```dax
<MeasureName> =
CALCULATE (
    [<BaseMeasure>],
    USERELATIONSHIP ( '<FactTable>'[<AlternateRoleDateColumn>], '<DateTable>'[<DateKeyColumn>] )
)
```

### Relationship direction & cardinality

| Rule | Detail |
|---|---|
| FK on the many-side | `fromColumn` is the **many-side** (the fact-table foreign key); `toColumn` is the **one-side** (the dimension key) |
| Single cross-filter by default | Default to `crossFilteringBehavior: oneDirection` |
| Matching data types | The columns on both sides must have the **same `dataType`** — mismatched types cause errors and performance issues |
| Hide the FK | Hide foreign key columns on the many-side (`isHidden`) — always |
| Mark the PK | Set `isKey: true` on the primary key column of the dimension table |

```tmdl
relationship '<FactToDimensionRelationshipName>'
	fromColumn: '<FactTable>'.'<ForeignKeyColumn>'        // many-side (fact FK)
	toColumn: '<DimensionTable>'.'<DimensionKeyColumn>'   // one-side (dimension PK)
```

(For inactive-relationship and `crossFilteringBehavior` enum syntax, see `references/tmdl-grammar.md`.)

### Keys

| DO | DON'T |
|---|---|
| Prefer **integer (`int64`) keys** over string keys (faster relationships) | **No composite keys** — they are NOT supported |
| Give each dimension **exactly ONE** unique key column, marked `isKey: true` | Do **not** create surrogate keys on fact tables (memory waste) |
| Ensure relationship columns on both sides share the same `dataType` | — |

### Cross-filtering & many-to-many

- Do **not** use bi-directional cross-filtering unless strictly necessary — it causes ambiguity and performance issues. If it's needed on a many-to-many, verify it can be single-direction first.
- Do **not** use many-to-many relationships unless required — they degrade performance.
- Keep bi-directional + many-to-many relationships below **30%** of total relationships.
- Do **not** create inactive relationships unless they are activated via `USERELATIONSHIP` in at least one measure.
- Do **not** combine `USERELATIONSHIP` with Row-Level Security on the same table (causes errors).

### Order of operations

**Create relationships before the measures that depend on them.** Measures may reference relationship paths, so the relationships must exist first.

1. Create the partition / query to the source.
2. Create columns with proper data types (`sourceColumn` mapped, FK columns hidden).
3. Mark dimension PKs (`isKey`) and create relationships.
4. Then author the measures that rely on those relationships.

### Referential integrity

Fix referential-integrity violations — orphan keys present in the fact table but missing from the dimension table.
