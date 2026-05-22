# Audit Check Catalog

Full checklist for semantic model audits. 9 categories ordered by severity. Use this catalog when running `reviewing-models` — every finding must be attributed to actual tool output.

## Business Context Guidance

The model's purpose changes which checks matter most and which severity levels apply:

| Context | Highest Priority |
|---|---|
| Model for 3 internal analysts | Documentation (Info), Design (Warning), DAX Anti-Patterns (Warning) |
| Production model, broad consumer base | All Critical/Warning categories, Memory and Size, Data Reduction |
| Copilot-facing / data agent model | AI and Copilot Readiness (Critical), Naming (Critical), Descriptions (Critical) |
| Pre-production gate review | All categories at full severity |
| Post-write regression check | Critical only, plus any category touched by the write |

---

## Category 1: Critical

Issues that cause incorrect results, errors, or broken model behavior. Fix before any other work.

### Check 1.1 — Bidirectional Relationships

**Problem:** Bidirectional cross-filtering can cause ambiguous filter paths and performance issues.

**Check:** In relationships, look for `crossFilteringBehavior: bothDirections`.

**Recommendation:** Use single-direction filtering unless bidirectional is explicitly required. Consider using CROSSFILTER() in DAX instead.

**Severity:** Critical

### Check 1.2 — Circular Dependencies

**Problem:** Circular measure references cause calculation errors.

**Check:** Parse measure definitions and build a dependency graph. Flag any cycles.

**Severity:** Critical

### Check 1.3 — Missing Data Types

**Problem:** Columns without explicit data types rely on auto-detection, which can be incorrect and changes unpredictably.

**Check:** Verify all columns have explicit `dataType:` declarations in their TMDL definitions.

**Severity:** Critical

### Check 1.4 — Tables Without Relationships (Orphaned)

**Problem:** Tables with no relationships cannot participate in cross-table filtering. Measures referencing them will produce incorrect totals.

**Check:** Analyze the relationship graph; flag tables with no incoming or outgoing relationships (excluding field parameter tables and calculation groups, which are intentionally disconnected).

**Severity:** Critical

---

## Category 2: Memory and Size

Issues that inflate model size, slow refresh, or degrade query performance through dictionary bloat.

### Check 2.1 — High-Cardinality Columns (Dictionary Size)

**Problem:** Columns with many unique values build large dictionaries that dominate model size. A single near-unique column (GUID, transaction ID, composite key, or unsplit DateTime) can consume the majority of model memory.

**Check:** Identify columns that are string/text types with names suggesting identifiers, GUIDs, or composite keys.

**Recommendation:** Remove columns not needed downstream. Split DateTime columns into Date and Time. Split composite string identifiers into component columns. Use appropriate data types (Integer for IDs, Fixed Decimal for currency instead of Double).

**Severity:** Warning

### Check 2.2 — Unsplit DateTime Columns

**Problem:** DateTime columns with second- or millisecond-level precision create near-unique dictionaries (e.g. 96M unique values). Splitting into Date + Time can reduce the column's memory by 90%+.

**Check:** Find columns with `dataType: dateTime`. Assess whether they are used at time-level granularity or only date-level.

**Recommendation:** Split into separate Date and Time columns. If the combined value is needed for display, recreate as a DAX measure.

**Severity:** Warning

### Check 2.3 — Attribute Hierarchies (IsAvailableInMDX)

**Problem:** By default, Power BI creates an attribute hierarchy for every column. For high-cardinality columns, the hierarchy structure alone can consume over 1 GB. These hierarchies are only used by Excel PivotTables via MDX; they are useless for DAX queries, reports, Copilot, and data agents.

**Check:** Look for hidden columns or high-cardinality columns that do NOT have `isAvailableInMDX: false`. Every hidden column and every column not needed in Excel PivotTables should have this set.

**Recommendation:** Set `isAvailableInMDX: false` on all hidden columns and high-cardinality columns not used in Excel PivotTables.

**Severity:** Warning

### Check 2.4 — Auto Date/Time Tables

**Problem:** When Auto Date/Time is enabled in Power BI Desktop, hidden date tables are generated for every date column. These can be massive if source data contains extreme date ranges (e.g. 1/1/1900 or 12/31/2199 placeholder values).

**Check:** Look for hidden tables with names like `LocalDateTable_*` or `DateTableTemplate_*`.

**Recommendation:** Disable Auto Date/Time in Power BI Desktop settings. Use explicit, shared date tables instead.

**Severity:** Warning

### Check 2.5 — Inappropriate Data Types

**Problem:** Using Double/Float for financial amounts wastes memory (excessive decimal precision = more unique values = larger dictionaries). Using String for numeric columns prevents VALUE encoding.

**Check:** Flag columns with `dataType: double` that represent currency or financial values. Flag numeric-looking columns stored as `dataType: string`.

**Recommendation:** Use Fixed Decimal (Currency) for financial amounts. Use Integer for counts and identifiers. Avoid String for numeric data.

**Severity:** Warning

### Check 2.6 — Calculated Columns vs. Measures

**Problem:** Calculated columns consume memory and slow refresh. They are evaluated row-by-row during processing and stored in VertiPaq.

**Check:** Count calculated columns (those with an `expression:` in the column definition).

**Recommendation:** Convert calculated columns to measures where possible, especially for aggregations.

**Severity:** Warning

### Check 2.7 — Unused Columns

**Problem:** Columns not referenced in measures, relationships, or hierarchies waste memory.

**Check:** Cross-reference all column names against: measure DAX expressions, relationship definitions, hierarchy levels, and report field usage (if report is available).

**Severity:** Warning

### Check 2.8 — DISTINCTCOUNT on High Cardinality

**Problem:** DISTINCTCOUNT on millions of unique values is expensive -- it requires a full dictionary scan.

**Check:** Find measures using DISTINCTCOUNT and flag if the target column has high cardinality.

**Recommendation:** Consider approximate DISTINCTCOUNT or pre-aggregation in Power Query.

**Severity:** Warning

---

## Category 3: Data Reduction

Issues where the model loads more data than is needed for its reporting purpose.

### Check 3.1 — Unfiltered History in Fact Tables

**Problem:** Loading all available history when only recent data is needed wastes memory and slows refresh.

**Check:** Examine M expressions for fact table queries. Flag tables that lack date-range filters or incremental refresh configuration.

**Recommendation:** Apply time-based filters (e.g. last 2 years) or implement incremental refresh to limit history.

**Severity:** Warning

### Check 3.2 — Columns Not Necessary for Reporting

**Problem:** Columns pulled from the source that are never used in reports, measures, or relationships inflate model size without benefit.

**Check:** Identify columns with no references in measures, visuals, or relationships.

**Recommendation:** Remove or hide columns not needed for reporting or downstream calculations.

**Severity:** Warning

### Check 3.3 — Pre-Summarization Opportunities

**Problem:** Fact tables at detail grain when the reporting grain is higher (e.g. daily transaction rows when all reports show monthly totals) waste memory and slow queries.

**Check:** Assess whether the grain of fact tables matches the lowest grain required in any report or measure.

**Recommendation:** Pre-aggregate in Power Query or the source to the minimum grain required.

**Severity:** Info

### Check 3.4 — Power Query Computed Columns vs. DAX Calculated Columns

**Problem:** DAX calculated columns are less efficient than Power Query computed columns. They are stored slightly differently and achieve less efficient compression. They are also built after all tables load, extending refresh time.

**Check:** For each calculated column, assess whether the logic could be moved to the Power Query layer (M expression) or materialized in the source.

**Recommendation:** Prefer Power Query computed columns or source-level calculations over DAX calculated columns where possible.

**Severity:** Info

---

## Category 4: DAX Anti-Patterns

For systematic DAX query optimization, load `authoring-measures`. This category covers structural anti-patterns detectable without running queries.

### Check 4.1 — Filtering Tables Instead of Columns in CALCULATE

**Problem:** Using a table reference as a CALCULATE filter argument (e.g. `CALCULATE([Measure], Sales)`) filters all columns in the table, causing both correctness issues and performance degradation.

**Check:** Scan measure expressions for CALCULATE filter arguments that reference a table name without specifying a column predicate.

**Severity:** Warning

### Check 4.2 — Division Without Error Handling

**Problem:** Division by zero returns errors that propagate through downstream measures and visuals.

**Check:** Find `/` operators in measures without DIVIDE() or IFERROR() wrapping.

**Recommendation:** Use `DIVIDE(numerator, denominator, 0)` or `DIVIDE(numerator, denominator, BLANK())`. Plain `/` is acceptable only when the denominator is guaranteed non-zero.

**Severity:** Warning

### Check 4.3 — Nested CALCULATE

**Problem:** `CALCULATE(CALCULATE(...))` is often redundant and creates confusing context transition chains.

**Check:** Regex for `CALCULATE\s*\([^)]*CALCULATE` in measure expressions.

**Severity:** Warning

### Check 4.4 — Iterators Over Large Tables Without Filters

**Problem:** SUMX, AVERAGEX, and other iterators over large tables without filter context evaluate row-by-row and can be extremely slow.

**Check:** Find iterator functions (SUMX, AVERAGEX, MINX, MAXX, RANKX, etc.) without surrounding FILTER context.

**Recommendation:** Add filters to reduce iteration scope; consider pre-aggregation. Note: iterators over large tables are fine if the expression is Storage Engine-pushable.

**Severity:** Warning

### Check 4.5 — ALL() Instead of REMOVEFILTERS()

**Problem:** ALL() used for filter removal is less readable than REMOVEFILTERS() and can create semantic ambiguity when used inside CALCULATE.

**Check:** Find `ALL(TableName)` patterns used as CALCULATE filter arguments.

**Recommendation:** Use REMOVEFILTERS() for clarity when removing filters; reserve ALL() for table arguments where its behavior as a table function is intended.

**Severity:** Info

### Check 4.6 — Missing KEEPFILTERS Around Non-Equality Predicates

**Problem:** Non-equality filter predicates in CALCULATE without KEEPFILTERS can override unintended filters from the report context.

**Check:** Scan for CALCULATE filter arguments using comparison operators (`>`, `<`, `>=`, `<=`, `<>`) without KEEPFILTERS wrapping.

**Severity:** Warning

---

## Category 5: Measure Hygiene

Issues with how measures are defined, scoped, and structured.

### Check 5.1 — Implicit Measures

**Problem:** Implicit measures (auto-aggregations on numeric columns) are not accessible to data agents. They also bypass formatting and calculation logic.

**Check:** Identify numeric columns that lack corresponding explicit measures but appear to be key metrics.

**Recommendation:** Create explicit DAX measures for all key metrics. Use `summarizeBy: none` on numeric columns that should not be auto-aggregated.

**Severity:** Warning (Critical if AI/Copilot readiness is a goal)

### Check 5.2 — Report-Scoped Extension Measures

**Problem:** Extension measures defined in reports are invisible to data agents and cannot be reused across reports.

**Check:** Identify measures defined at the report layer rather than the model layer.

**Recommendation:** Move extension measures to the semantic model.

**Severity:** Warning

### Check 5.3 — Duplicate or Overlapping Measures

**Problem:** Multiple measures that compute the same or similar value with ambiguous names confuse users and AI tools.

**Check:** Analyze measure names and expressions for near-duplicates or overlapping definitions (e.g. `Revenue`, `Total Revenue`, `Net Revenue` with similar DAX).

**Recommendation:** Consolidate or clearly differentiate. Document the distinction in descriptions.

**Severity:** Warning

---

## Category 6: Documentation

Issues that reduce discoverability, AI effectiveness, and developer productivity.

### Check 6.1 — Missing Descriptions

**Problem:** Missing descriptions hurt discoverability and Copilot/data agent effectiveness.

**Check:** Count tables, columns, and measures missing a `description:` property (TMDL `///` comment).

**Recommendation:** All user-facing objects should have descriptions. Hidden objects can skip this.

**Severity:** Warning (Critical if AI/Copilot readiness is a goal)

### Check 6.2 — Missing Display Folders for Measures

**Problem:** Flat measure lists are hard to navigate in large models.

**Check:** Count measures without a `displayFolder:` property.

**Recommendation:** Organize measures into display folders following the fact/dimension folder templates in `../modeling-semantic-model/references/naming.md`.

**Severity:** Info

### Check 6.3 — Inconsistent Naming Conventions

**Problem:** Inconsistent naming (snake_case, CamelCase, abbreviations, technical prefixes) confuses users and AI tools that interpret field names literally.

**Check:** Analyze naming patterns using detection patterns from `../modeling-semantic-model/references/naming.md`:
- `measure [a-z]+_[a-z]+` — snake_case measures
- `measure [A-Z][a-z]+[A-Z]` — CamelCase measures
- `measure [A-Z_]{4,}` — UPPER_CASE measures
- `table (DIM|FACT|dim|fact|STG|stg|RAW|raw)_` — technical prefixes

**Recommendation:** Apply naming conventions from `../modeling-semantic-model/references/naming.md`. Present rename plan and get user approval before applying to a production model.

**Severity:** Warning

---

## Category 7: Design

Structural design issues that affect correctness, maintainability, or query performance.

### Check 7.1 — Star Schema Violations

**Problem:** Snowflake schemas (dimension tables with outgoing relationships to other dimension tables) or direct fact-to-fact relationships hurt performance and complicate DAX.

**Check:** Analyze the relationship graph. Flag dimension tables with outgoing relationships. Flag relationships between fact tables.

**Severity:** Warning

### Check 7.2 — Missing or Misconfigured Date Table

**Problem:** No proper date table limits time intelligence. Misconfigured date tables cause DATEADD, SAMEPERIODLASTYEAR, and TOTALYTD to return BLANK.

**Check:** Look for a table marked with `dataCategory: Time`. Validate that it has:
- A continuous daily date column with no gaps
- Date range spanning the full range of fact data
- A single-column relationship to each fact table
- The table marked as a date table

**Severity:** Critical (if time intelligence measures exist in the model)

### Check 7.3 — Excessive Columns Per Table

**Problem:** Tables with 30+ columns often indicate denormalization issues that hurt compression and complicate usage.

**Check:** Count columns per table; flag those exceeding 30.

**Severity:** Info

### Check 7.4 — Many-to-Many Relationships Without Bridging Tables

**Problem:** Implicit M:M relationships (two fact tables sharing a dimension without a bridge) cause double-counting and unpredictable filter behavior.

**Check:** Identify M:M cardinality relationships in the model.

**Recommendation:** Introduce bridging tables or conformed dimensions. See `modeling-semantic-model` data-architect patterns.

**Severity:** Warning

### Check 7.5 — Multiple Fact Tables Without Shared Conformed Dimensions

**Problem:** Multiple fact tables relating to the same dimension via different keys without a shared conformed dimension causes slicers on one fact to not filter the other.

**Check:** Identify fact tables that share dimension-like tables but connect via different key columns.

**Severity:** Warning

### Check 7.6 — Inactive Relationships Without Corresponding USERELATIONSHIP

**Problem:** Inactive relationships that are never activated by USERELATIONSHIP in any measure are orphaned -- they suggest incomplete modeling or a relationship that was deactivated to resolve ambiguity but never replaced.

**Check:** Identify inactive relationships; cross-reference against all measure expressions for USERELATIONSHIP calls referencing them.

**Severity:** Info

---

## Category 8: Direct Lake (if applicable)

Only audit this category if the model uses Direct Lake storage mode.

### Check 8.1 — Parquet File Count

**Problem:** Direct Lake framing fails if a Delta table exceeds capacity guardrails (e.g. >10,000 parquet files). Too many small files also degrade transcoding performance.

**Check:** Flag whether the model is Direct Lake. Note that TMDL analysis alone cannot confirm file counts -- this is a reminder to check Delta table health externally.

**Recommendation:** Run `OPTIMIZE` and `VACUUM` on underlying Delta tables. Aim for large row groups (1M–16M rows). Apply V-Order optimization.

**Severity:** Warning

### Check 8.2 — DirectQuery Fallback Risk

**Problem:** Direct Lake queries fall back to DirectQuery when guardrails are exceeded or when SQL endpoint views/RLS are involved. Fallback degrades performance significantly.

**Check:** If model is Direct Lake, check for RLS definitions in roles. Note any views referenced in the model.

**Recommendation:** Design to avoid DirectQuery fallback. Size capacity to stay within guardrails. Consider setting `DirectLakeBehavior` to disable fallback if performance consistency is critical.

**Severity:** Warning

---

## Category 9: AI and Copilot Readiness

Only audit this category if the user has confirmed conversational BI is a target. See the before-investing gate in `../modeling-semantic-model/references/ai-readiness.md`.

### Check 9.1 — Duplicate Field Names Across Tables

**Problem:** Duplicate column names across tables confuse Copilot and data agents. E.g. a `Name` column in both `Customer` and `Product` tables.

**Check:** Cross-reference column names across all tables. Flag any column name that appears in more than one table (excluding relationship keys, which are expected to match).

**Recommendation:** Prefix or rename columns to be unique and human-readable (e.g. `Customer Name`, `Product Name`).

**Severity:** Warning

### Check 9.2 — Missing AI Instructions

**Problem:** Without AI instructions, Copilot and data agents must infer business terminology, date definitions, and metric preferences from field names alone. This produces low-quality responses for anything non-trivial.

**Check:** Check whether AI instructions are present and non-empty.

**Severity:** Critical (if AI/Copilot is a target)

### Check 9.3 — Missing or Inadequate Descriptions

**Problem:** Missing descriptions are doubly harmful for AI: the model structure alone is insufficient for disambiguation.

**Check:** Count objects missing descriptions. For objects with descriptions, assess whether they disambiguate (AI-audience) vs. merely restate the field name.

**Severity:** Critical (if AI/Copilot is a target)

### Check 9.4 — Complex Patterns That Impair AI Navigation

**Note:** Disconnected tables (field parameters), many-to-many relationships, and inactive relationships are not bad practices -- they are valid and commonplace patterns. However, these patterns make it harder for AI tools like Copilot and data agents to interpret the model correctly.

**Check:** Flag disconnected tables, M:M relationships, inactive relationships, and ambiguous relationship paths. Report them as informational notes, not as issues requiring fixes.

**Recommendation:** Ensure descriptions are thorough on complex objects so AI has context. Accept that some model patterns are inherently difficult for AI to navigate -- direct users to reports and measures rather than expecting Copilot to handle complex relationship patterns.

**Severity:** Info

### Check 9.5 — AI Data Schema Not Scoped

**Problem:** If the entire model is exposed in the AI data schema, Copilot and data agents receive too many fields, including helper measures and intermediate calculations, which degrades response quality.

**Check:** Assess whether the AI data schema (Prep for AI configuration) is scoped to only relevant tables, columns, and measures. See the full AI Data Schema checklist in `../modeling-semantic-model/references/ai-readiness.md`.

**Severity:** Warning (if AI/Copilot is a target)
