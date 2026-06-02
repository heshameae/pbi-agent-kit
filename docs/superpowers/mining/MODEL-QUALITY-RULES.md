# Mined Model-Quality Rule Catalog

Consolidated from a 4-agent mining pass over `docs/superpowers/mining/packed/*.xml`. Every rule is source-cited (`file:line`). This is the **mining deliverable** — the grounded "meat" that drives new `pbi_model_check` rules, the relationship gate, and the modeling/review skills. Downstream gap-find / plan / fix agents treat this as the source of truth (do not re-mine; read the cited sections for detail).

**Severity scale** (Tabular-Editor BPA): `error` (must-fix / sev 3) · `warn` (sev 2) · `info` (sev 1).

**Canonical ruleset location (PRIME):** `dg4-te-fabric-desktop-root.xml:30010–30737` = the Microsoft/TE standard ~50-rule set (`ID, Name, Category, Severity, Scope, Expression, FixExpression`). Parallel set: `dg4:29587–29899` (`comprehensive-rules.json`, prefixed IDs). TE3 built-ins: `dg4:28548–28576`. Rule schema: `dg4:32741–32953`. Expressions are C# Dynamic-LINQ — reimplement as TS predicates over `TMDLModel`.

**Severity-calibration nuance (important):** `dg3-semantic-models.xml:402–406` — disconnected tables, M2M-without-bridge, inactive rels, ambiguous paths are *valid patterns* that mainly hurt AI/Copilot readability. Calibrate: escalate **accidental fact-table isolation, fact-to-fact, datatype-mismatch, missing-format-on-measure, summarizeBy-on-key** to error/warn; keep deliberate-pattern and stylistic items at info. Enforcement is **advisory** (detect + guide); the pre-write gate hard-blocks only unambiguous errors.

---

## A. Relationships & Star-Schema  (PRIORITY — the user's core concern)

| # | Rule | Condition | Sev | Source |
|---|---|---|---|---|
| A1 | **Table participates in no relationship (orphan)** — THE GAP that lets 2 disconnected facts pass with 0 errors | Table appears on neither From nor To side of any relationship | **error** (fact) / warn (other) / info (deliberate parameter/what-if table) | `dg4:30511` (`ENSURE_TABLES_HAVE_RELATIONSHIPS`); inverse of snowflake predicate `dg4:30091`; deliberate-disconnect nuance `dg3:402-406`, `dg3:1658-1660` |
| A2 | **Fact-to-fact relationship** | A relationship whose both endpoints are fact tables | **error** | `awesome-copilot-pbi-data.xml:11851`, `:12238-12242` |
| A3 | **Missing conformed dimension** | 2+ fact tables share a categorical column but no shared dimension relates them | **warn** | `awesome-copilot-pbi-data.xml:18923`; `dg3:5107` |
| A4 | **Relationship columns same data type** | `from.dataType != to.dataType` | **error** | `dg4:30414` (`RELATIONSHIP_COLUMNS_SAME_DATA_TYPE`); `awesome-copilot-pbi-data.xml:18580-18583` |
| A5 | **Relationship columns should be integer** | rel column dataType != int64 | info | `dg4:30666`; `powerbi-agentic-plugins.xml:10965` |
| A6 | **Snowflake schema** | A table is BOTH a From-side and a To-side of relationships (dim chained onto dim) | **warn** | `dg4:30085` (`SNOWFLAKE_SCHEMA_ARCHITECTURE`); `awesome-copilot-pbi-data.xml:18916` |
| A7 | **Excessive bi-di / M2M** | `(bothDirections + manyToMany) / total > 0.30` | **warn** | `dg4:30125`; `powerbi-agentic-plugins.xml:10975` |
| A8 | **Bidirectional filter outside m:m bridge** | crossFilter == both, not an m:m bridge | warn | `dg4:30234`; (current plugin MOD004 — verify parity) |
| A9 | **M2M must be single-direction** | many&&many && bothDirections | warn | `dg4:30185` |
| A10 | **Inactive relationship never activated** | isActive==false AND no measure refs it via `USERELATIONSHIP(from,to)` | **warn** | `dg4:30344`; (current plugin MOD002 — verify parity) |
| A11 | **>1 active path between two tables (ambiguity)** | two tables joined by >1 active relationship/path | **error** | `awesome-copilot-pbi-data.xml:18492-18493`, `:18926` |
| A12 | **USERELATIONSHIP + RLS on same table** | a table targeted by USERELATIONSHIP also has an RLS role filter | **error** | `dg4:30404`; `powerbi-agentic-plugins.xml:11017` |
| A13 | **Hide foreign keys** | visible column that is a relationship From (many-side) column | warn | `dg4:30686` (`HIDE_FOREIGN_KEYS`); (current plugin MOD005 — verify) |
| A14 | **Mark primary keys** | one-side relationship column with isKey==false | info | `dg4:30697` (`MARK_PRIMARY_KEYS`) |
| A15 | **TREATAS as a smell** | measure uses `TREATAS(VALUES(FactA[c]), FactB[c])` to bridge facts that should share a dimension | info | `awesome-copilot-pbi-data.xml:18483-18490`; `dg3:5107` |
| A16 | **No composite keys** | relationship needs >1 column | error | `powerbi-agentic-plugins.xml:10972`; `awesome-copilot-pbi-data.xml:11792` |
| A17 | **One-to-one is rare** | one&&one relationship | info | `awesome-copilot-pbi-data.xml:18455` |

Read in full: `awesome-copilot-pbi-data.xml:18445-18593` (RELATIONSHIPS.md), `:18824-18928` (STAR-SCHEMA.md), `dg4:29945-30007` + `30084-30700` (BPA expressions), `powerbi-agentic-plugins.xml:10960-10978` (relationship DO/DON'T).

## B. Date / Time

| # | Rule | Condition | Sev | Source |
|---|---|---|---|---|
| B1 | **Model should have a date table** | no table with DataCategory=="Time" + isKey DateTime column | warn | `dg4:30095` |
| B2 | **Date/Calendar table not marked** | table named *date*/*calendar* but not marked as date table | warn | `dg4:30105` |
| B3 | **Remove auto-date tables** | calc tables `DateTableTemplate_*` / `LocalDateTable_*` | warn | `dg4:30115`; (current plugin MOD001) |

## C. Columns / Formatting / Metadata

| # | Rule | Condition | Sev | Source |
|---|---|---|---|---|
| C1 | **Numeric key summarizeBy != none** | visible numeric column (key/ID/postal/year/monthNo) with summarizeBy != none | **error** | `dg4:30635` (`NUMERIC_COLUMN_SUMMARIZE_BY`); `dg1-pbip.xml:52283-52298` |
| C2 | **Measure has no format string** | visible measure with empty formatString | **error** | `dg4:30625`; `powerbi-agentic-plugins.xml:10958` |
| C3 | **Visible numeric column unformatted** | visible numeric column, empty formatString | warn | `dg4:29840` |
| C4 | **Avoid floating-point (double) types** | numeric column dataType==double | warn | `dg4:30013`; `dg3:239` |
| C5 | **Hide fact-table columns aggregated by measures** | raw fact numeric column visible alongside its measure | warn | `dg4:30708` |
| C6 | **isAvailableInMdx=false on hidden non-attribute cols** | hidden col, isAvailableInMdx true, not in sort/hierarchy/variation | warn | `dg4:30024` |
| C7 | **isAvailableInMdx=true on necessary cols** | isAvailableInMdx false but used as sortBy / in hierarchy | error | `dg4:30446` |
| C8 | **Percentage / integer formatting canonical** | %/whole-number measure not in canonical format | warn/info | `dg4:30646`, `:30656` |
| C9 | **Month-as-string must be sorted** | string "month" column with no sortByColumn | warn | `dg4:30728` |
| C10 | **Add data category for geo columns** | city/country/lat/long column without dataCategory | info | `dg4:30676` |
| C11 | **Object names: no lead/trail space (err), capitalize first, no special chars, no Fact/Dim prefix** | per condition | error/warn | `dg4:30593`, `:30719`, `:30563`; `dg3:5214-5228` (no Fact/Dim — current plugin NAM001, verify) |
| C12 | **Objects with no description** | visible table/column/measure with blank description | info | `dg4:30521`; `dg3:303-309` |
| C13 | **Flag columns as Yes/No** | `Is*` int64 or `* Flag` non-string visible | info | `dg4:30583` |

Read in full: `dg4:29645-30700` (BPA JSON), `dg1-pbip.xml:52242-52534` (column-properties), `:52536-52702` (naming), `powerbi-agentic-plugins.xml:10876-11050`, `dg3:5159-5393` (naming-rules regexes).

## D. DAX Expressions

| # | Rule | Condition | Sev | Source |
|---|---|---|---|---|
| D1 | **Columns fully qualified** | measure refs a column not as `'Table'[Col]` | error | `dg4:30254` |
| D2 | **Measures NOT qualified** | reference to a measure is table-qualified | error | `dg4:30264` |
| D3 | **Avoid duplicate measures** | two measures with identical (whitespace-normalized) DAX | warn | `dg4:30274` |
| D4 | **Use DIVIDE for division** | `]/` or `)/` division operator | warn | `dg4:30294`; (current plugin DAX001-005 — verify parity) |
| D5 | **Avoid IFERROR** | expression matches `IFERROR(` | warn | `dg4:30304` |
| D6 | **TREATAS instead of INTERSECT** | expression uses `INTERSECT(` | warn | `dg4:30284` |
| D7 | **Measure not a direct ref of another measure** | measure body is just `[OtherMeasure]` | warn | `dg4:30314` |
| D8 | **Filter column/measure values correctly** | `CALCULATE(...,FILTER('T','T'[c]="x"))` / `FILTER('T',[m]>n)` | warn | `dg4:30324`, `:30334` |

## E. Error Prevention

| # | Rule | Condition | Sev | Source |
|---|---|---|---|---|
| E1 | **Data column must have a source column** | data (non-calc) column with empty sourceColumn | error | `dg4:30374` |
| E2 | **Expression-reliant object must have an expression** | measure/calc-col/calc-item with blank expression | error | `dg4:30384` |
| E3 | **Avoid invalid name/description chars** | name/description has control chars | error | `dg4:30424`, `:30435` |

## F. Maintenance

| # | Rule | Condition | Sev | Source |
|---|---|---|---|---|
| F1 | **Unused (hidden, 0-ref) columns/measures** | hidden, no references, not in rel/sort/hier/RLS | warn | `dg4:30457`, `:30468` |
| F2 | **Fix referential-integrity violations** | rel RI-violation rows > 0 | warn | `dg4:30479` (DEFER — needs data scan) |
| F3 | **Calc groups with no items** | calc group, 0 items | warn | `dg4:30542` |

## G. Grain (mostly skill/review guidance — hard to statically check without data)

| # | Principle | Detail | Source |
|---|---|---|---|
| G1 | **Fact tables store one consistent grain** | never mix grains in one table | `awesome-copilot-pbi-data.xml:18856-18862`, `:11785` |
| G2 | **Target-vs-actual grain mismatch** (monthly target vs daily actual) — the [Sales Target] BLANK-on-daily bug class | 4 remediation options A-D (coarser groupby / period-end axis / BLANK non-boundary / daily-additive via DIVIDE-by-days) | `dg3:1037-1076` (= `powerbi-agentic-plugins.xml:9528-9560`) |

## H. Maturity / AI-readiness / Review structure (skill/review meat)

- Consumption-decision gate (Reports / Conversational BI / Both) before investing in AI-readiness: `dg3:4344-4362`.
- AI-readiness foundation (star schema, types, explicit measures, dedupe): `dg3:4366-4403`.
- Review workflow + severity tiers (Critical→…→AI-readiness) + output format: `dg3:5020-5149`, `:408-444`; two-tier review framework `awesome-copilot-pbi-data.xml:16890-17019`.
- Maturity ladder L1-L4: `claude-skills-borghei.xml:15517-15616`.
- Measure best-practices (DIVIDE, no IFERROR, `_`-prefixed VARs, no duplicate measures, explicit measures): `powerbi-agentic-plugins.xml:10905-10924`.

---

## Build-layer gaps observed in the live session (for the build/tooling fix)

1. **Calc column on an imported (M) table failed** — `pbi_column_create` with `expression` on a non-calculated table returned "Processed 1 column(s): 0 succeeded". A DAX calculated column IS valid on an imported table; investigate whether this is the `expression`→`daxExpression` wire-key fix (already applied to driver) not yet reloaded, OR a genuine MS-MCP limitation. The agent wrongly concluded "imported tables can't have calculated columns via the tool."
2. **No mark-as-date-table operation** — the build agent could not mark the Date table; no tool exposes it. Needed for B1/B2 and time-intelligence correctness.
3. **Partial build, declared done** — the builder built the Date dimension but silently skipped the conformed Category/Segment dimensions that were in the agreed plan, leaving the TREATAS bridge. Build-completeness/enforcement gap.
4. **Conformed-dimension build workflow** — no end-to-end guidance/tooling for: create dim (calc table `DISTINCT`/`SELECTCOLUMNS` over the fact, or M) → relate both facts → hide FKs → simplify the TREATAS measure.

## Known conflict (flag for the planner)
**Measure organization:** ruiromano says *distribute* measures across home tables and avoid a single Measures table (`powerbi-agentic-plugins.xml:10906`); dg1/SQLBI prefer a dedicated `__Measures` table (`dg1-pbip.xml:52633-52635`). Make this **info / configurable**, never a hard rule.
