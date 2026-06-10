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

**Tool rules:** `MOD004` (bidirectional outside an m:m bridge, **warning**). When row-level security is present, `MOD025` (bidirectional cross-filter into a *secured* table, **warning** — bidirectional filtering can bypass the RLS boundary and leak rows) also fires; cite it for any bidi edge touching a secured table.

**Severity:** Critical

### Check 1.2 — Circular Dependencies

**Problem:** Circular measure references cause calculation errors.

**Check:** Parse measure definitions and build a dependency graph. Flag any cycles.

**Tool rule:** ambiguous multi-hop filter paths are caught by `MOD017` (a "diamond" — two tables connected by ≥2 different active routes through different intermediate tables, **error**), complementing the same-pair ambiguous-path check. Cite MOD017 for diamond findings.

**Severity:** Critical

### Check 1.3 — Missing Data Types

**Problem:** Columns without explicit data types rely on auto-detection, which can be incorrect and changes unpredictably.

**Check:** Verify all columns have explicit `dataType:` declarations in their TMDL definitions.

**Severity:** Critical

### Check 1.4 — Tables Without Relationships (Orphaned)

**Problem:** Tables with no relationships cannot participate in cross-table filtering. Measures referencing them will produce incorrect totals.

**Check:** Analyze the relationship graph; flag tables with no incoming or outgoing relationships (excluding field parameter tables and calculation groups, which are intentionally disconnected).

**Tool rule:** `MOD008` (orphan/disconnected table, tri-state) — cite it for every finding. The tool reports **error** for an orphan *fact* table, **warning** for a non-fact orphan, and **info** for a deliberately disconnected table (single-column / what-if / field-parameter / calc-group). Do not re-derive orphans from TMDL you read yourself; report what MOD008 emits.

**Severity:** Critical (when MOD008 fires as error on a fact table)

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

**Tool rule:** `E4` catches the inverse hazard — a column with `isAvailableInMDX: false` that is the **sort-by target** of another column (or carries a sortByColumn itself), which errors in Excel/MDX clients and breaks the sort (**error**). Never set `isAvailableInMDX: false` on a sort-by key.

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

**Recommendation:** Apply policy/user-confirmed time-based filters or implement incremental refresh to limit history. Do not invent a retention window.

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

**Tool rule:** `MOD014` (numeric key/ID column with `summarizeBy != none`, **error**) catches the highest-risk subset — a visible numeric key/ID/year/postal column that silently auto-sums. Cite MOD014 for those findings; the broader "missing explicit measure" judgement remains a narrative call.

**Severity:** Warning (Critical if AI/Copilot readiness is a goal); MOD014 itself is an error

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

**Tool rules:** `MOD012` (snowflake — a table that is both a from-side and a to-side, excluding facts, **warning**) and `MOD009` (fact-to-fact relationship, **error**). Cite MOD009 for fact→fact and MOD012 for dim→dim chains. Fix fact-to-fact by bridging via a conformed dimension (see `../modeling-semantic-model/references/columns-relationships.md`).

**Severity:** Warning (MOD012); Error (MOD009)

### Check 7.2 — Missing or Misconfigured Date Table

**Problem:** No proper date table limits time intelligence. Misconfigured date tables cause DATEADD, SAMEPERIODLASTYEAR, and TOTALYTD to return BLANK.

**Check:** Look for a table marked with `dataCategory: Time`. Validate that it has:
- A continuous daily date column with no gaps
- Date range spanning the full range of fact data
- A single-column relationship to each fact table
- The table marked as a date table

**Tool rules:** `MODB1` (model has no date table, **warning**), `MODB2` (a date/calendar-named table is not marked as a date table, **warning**), and `MOD029` (Date/calendar source uses volatile `TODAY()`/`NOW()` anchors or literal hardcoded bounds, **error**). Cite MODB1/MODB2 for marking findings and MOD029 for unsafe source bounds. For continuity, uniqueness, blanks, and fact min/max coverage, run `pbi_model_plan_date_table` with the governed date table/key and every relevant fact date column; do not infer coverage from names or sample rows. Fix by calling `pbi_table_mark_as_date(tableName, dateColumn, facts)` only after that planner returns clean.

**Severity:** Critical (if time intelligence measures exist in the model); the tool emits MODB1/MODB2 as warnings

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

**Tool rule:** `MOD010` (missing conformed dimension — 2+ fact tables share a same-named categorical column with no shared dimension path, **warning**). Cite MOD010; a `TREATAS` bridge standing in for the missing dimension is the related `MOD016` (info). Fix with the conformed-dimension build recipe in `../modeling-semantic-model/references/columns-relationships.md`.

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

---

## Appendix: Tool Rule Reference (`pbi_model_check`)

Every model-side BPA rule the tool emits, by category. Always attribute a finding to the rule that produced it — never re-derive it from TMDL you read yourself. Severities are the tool's calibrated severities (canonical BPA severity is not portable; the tool calibrates to real correctness impact).

### Modeling

| ID | Severity | What it flags |
|----|----------|---------------|
| MOD001 | warning | Auto date/time tables (`LocalDateTable_*` / `DateTableTemplate_*`). |
| MOD002 | warning / **error** | Inactive relationship not activated by any USERELATIONSHIP. **Error** when a sibling active relationship joins the same table pair on different columns (a dead role-playing alternate — queries silently fall back to the active key). |
| MOD003 | warning / **error** | Many-to-many cardinality. **Error** when bidirectional AND neither endpoint is a bridge table (ambiguous propagation corrupts results); warning for a bidi m:m through a real bridge. |
| MOD004 | warning | Bidirectional filter outside a many-to-many bridge. |
| MOD005 | warning/error | Foreign-key column on the many side is visible. Escalates to error when it duplicates a visible one-side source-of-truth dimension field because report authors can pick the fact-side field and bypass shared dimension filtering. |
| MOD006 | info | String column with `summarizeBy != none`. |
| MOD008 | error / warning / info | Orphan/disconnected table (tri-state: error for an isolated fact, warning for a non-fact orphan, info for a deliberate single-column/what-if/param table). |
| MOD009 | error | Direct fact-to-fact relationship. |
| MOD010 | warning | Missing conformed dimension (2+ facts share a same-named categorical column with no shared dimension path). |
| MOD011 | warning / **error** | Relationship key data types differ. **Error** for a hard-incompatible mismatch (e.g. string↔int64); warning for a same-family widening (e.g. int64↔decimal). |
| MOD012 | warning | Snowflake (a dimension chained onto another dimension). |
| MOD013 | warning | Excessive bidirectional / many-to-many ratio (>30%). |
| MOD014 | error | Numeric key/identifier column with `summarizeBy != none` (summing a key gives meaningless totals). |
| MOD015 | info | Relationship key column is not an integer. |
| MOD016 | info | TREATAS bridge between two facts (consider a conformed dimension). |
| MOD017 | error | Ambiguous multi-hop (diamond) filter path — two tables connected by ≥2 active routes through different intermediates. |
| MOD018 | error | Time-intelligence DAX is used but no table is marked as a date table (TI returns BLANK). |
| MOD019 | warning | Target-vs-actual grain mismatch: run `pbi_model_plan_date_table` and `pbi_model_plan_date_grain`; block relationship activation or target-measure rewrites if deterministic proof is unavailable or not clean. |
| MOD020 | info | The one-side (dimension) column of a relationship is not marked `isKey`. |
| MOD021 | info | One-to-one relationship (rare — consider consolidating unless a deliberate PII split). |
| MOD022 | info | Non-key numeric column auto-aggregates (`summarizeBy != none`) — prefer `summarizeBy: none` + an explicit measure. Companion to MOD014 (which owns key-named columns); the two never double-report. |
| MOD023 | error | A measure uses USERELATIONSHIP against a table that also has row-level security (errors at visual evaluation). |
| MOD024 | warning | Many-to-many relationship touching a table secured by *dynamic* RLS (USERNAME/USERPRINCIPALNAME) — severe query-performance degradation. |
| MOD025 | warning | Bidirectional cross-filter into a secured table (RLS row-leak risk). |
| MOD028 | warning | "Assume referential integrity" enabled on a DirectQuery source (INNER join silently drops fact rows with no matching dimension key). |
| MOD029 | error | Date/calendar source expression uses volatile current-date anchors or literal hardcoded calendar bounds. Run `pbi_model_plan_date_table`; anchor default bounds to observed fact min/max dates and extend only with an explicit future-horizon policy. |
| MODB1 | warning | Model has no marked date table (but date columns exist). |
| MODB2 | warning | A date/calendar-named table is not marked as a date table. |

### DAX

| ID | Severity | What it flags |
|----|----------|---------------|
| DAX001 | warning | Uses `/` instead of DIVIDE() (checked over measures AND calculated columns). |
| DAX002 | error | USERELATIONSHIP outside CALCULATE/CALCULATETABLE. |
| DAX003 | warning | IFERROR (slower than IF + ISBLANK). |
| DAX004 | info | CALCULATE with no filter arguments. |
| DAX005 | warning | Reference to a non-existent measure or column (checked over measures AND calculated columns). |
| DAX006 | error | Column reference not fully qualified. |
| DAX007 | error | Measure reference is table-qualified. |
| DAX008 | warning | Duplicate measure definitions. |
| DAX009 | warning | Uses INTERSECT (prefer TREATAS). |
| DAX010 | warning | Measure is a bare direct reference to another measure. |
| DAX011 | warning | Whole-table FILTER inside CALCULATE. |
| DAX012 | warning | EVALUATEANDLOG (a debugging function) in a production measure. |
| DAX013 | warning | Literal-number divide syntax (`1-(x/y)` / `1±DIVIDE(...)`) — brittle when the denominator is blank/zero. |
| DAX014 | warning | BLANK-suppression (`+0` / `COALESCE(...,0)` / `IF(ISBLANK,0,...)`) inflates result sets with spurious all-zero rows. |

### Formatting

| ID | Severity | What it flags |
|----|----------|---------------|
| FMT001 | error | Visible measure has no format string. |
| FMT002 | error | Format string wrapped in quotes (renders as text). |
| FMT003 | warning | Visible numeric column has no format string. |
| FMT004 | warning | Column uses the double (floating-point) data type. |
| FMT005 | warning | Percentage-named measure (`...%`/`...percent`) whose format string has no `%`. |
| FMT006 | info | Geography column (country/continent/city/lat/long) with no `dataCategory`. |
| FMT007 | warning | String month column with no `sortByColumn` (sorts alphabetically). |

### Naming

| ID | Severity | What it flags |
|----|----------|---------------|
| NAM001 | error | Measure name collides with a column on its host table. |
| NAM002 | error / warning | Object-name hygiene: **error** for leading/trailing whitespace or control characters; **warning** for a DAX reserved word (Date/Time/Year/…), a Fact/Dim prefix, or special characters. |

### Error Prevention

| ID | Severity | What it flags |
|----|----------|---------------|
| E1 | error | Data (non-calculated) column has no `sourceColumn`. |
| E2 | error | Measure has a blank expression. |
| E3 | error | Calculated column has a blank expression. |
| E4 | error | `isAvailableInMDX: false` on a sort-by target column (errors in Excel/MDX clients). |
| E5 | error | Control characters in a measure description (corrupts serialization). |

### Maintenance

| ID | Severity | What it flags |
|----|----------|---------------|
| MOD007 | info | Empty table (no columns, no measures). |
| MOD026 | info | Visible table/column/measure has no description (AI/Copilot readiness). |
| MOD027 | info | Table has >10 visible measures, none in a display folder. |

**Gating note (live snapshots):** MOD023/MOD024/MOD025 require captured roles; MOD026 requires at least one description; MOD027 requires at least one display folder; MOD028 requires both the Assume-RI flag and a DirectQuery storage mode; E3 requires at least one captured calc-column expression; E4 fires only on an *explicit* `isAvailableInMDX: false`. When the underlying metadata isn't captured, these rules stay silent rather than emit false positives — so absence of a finding is not proof of absence of the issue on an incompletely-captured live model.
