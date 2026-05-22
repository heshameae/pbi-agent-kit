# Column Properties & Relationships Reference

Rules for column properties and relationship/star-schema design in Power BI semantic models (TMDL format). For canonical TMDL syntax, indentation, property-ordering, and enum value sets, see `references/tmdl-grammar.md` — this file covers the *meaning* and *correct values* of column and relationship properties, not the grammar.

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
column Date
	isNameInferred
	sourceColumn: [Date]
```

`isNameInferred` indicates the column name was automatically derived from the source. The `sourceColumn` value in square brackets (`[Date]`) is the M expression format.

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
- The Date table — set `dataCategory: Time` on the calendar table (required for time intelligence).

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
column Date
	isKey
	summarizeBy: none
	sourceColumn: [Date]
```

- Only **one** column per table may have `isKey`.
- It enables certain DAX optimizations.
- It is required on the Date table (`dataCategory: Time`).
- On a dimension table, mark the unique key column with `isKey` (see Relationships below).

> Property ordering within a column block (`dataType` → `formatString` → `lineageTag` → `displayFolder` → `summarizeBy` → `isHidden` → `isKey` → `sortByColumn` → `sourceColumn` → `annotation`), `lineageTag`, `displayFolder`, and annotation rules live in `references/tmdl-grammar.md`.

---

## Relationships & Star-Schema Design

### Default to a star schema

When modeling data, **always default to a star schema**: a single fact table surrounded by denormalized dimension tables, with clear one-column relationship keys and one-to-many relationships. Only deviate when there is a strong, explicit requirement a star schema cannot satisfy.

- Avoid snowflake dimensions and dimension-to-dimension relationships.
- Ensure every table has at least one relationship to another table (except utility tables) — don't leave orphan tables disconnected without a clear reason.

### Relationship direction & cardinality

| Rule | Detail |
|---|---|
| FK on the many-side | `fromColumn` is the **many-side** (the fact-table foreign key); `toColumn` is the **one-side** (the dimension key) |
| Single cross-filter by default | Default to `crossFilteringBehavior: oneDirection` |
| Matching data types | The columns on both sides must have the **same `dataType`** — mismatched types cause errors and performance issues |
| Hide the FK | Hide foreign key columns on the many-side (`isHidden`) — always |
| Mark the PK | Set `isKey: true` on the primary key column of the dimension table |

```tmdl
relationship 'Sales to Date'
	fromColumn: Sales.'Order Date'   // many-side (fact FK)
	toColumn: Date.Date              // one-side (dimension PK)
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
