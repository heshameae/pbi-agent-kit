# Model-Quality Enforcement — Implementation Contract (DRAFT for review)

Synthesis of: `docs/superpowers/mining/MODEL-QUALITY-RULES.md` (mined catalog) + the two gap-finder reports (detection layer; build/tooling layer). Enforcement = **advisory** (detect + report; the pre-write gate hard-blocks only unambiguous errors). Scope = **full model-quality**, **relationships/star-schema first**. Two ironclad rules apply: mine-don't-invent (cite catalog/source), dataset-agnostic.

This is the plan the review/plan agent finalizes and the 2 fix agents implement.

---

## 0. Decisions (final unless the planner flags a problem)

- **Severity calibration** (per `dg3:402-406`): missing-format-on-measure, summarizeBy-on-numeric-key, datatype-mismatch, orphan FACT table, fact-to-fact → **error**; orphan non-fact / snowflake / inactive-rel-unused / FK-visible / excessive-bidi → **warn**; deliberate-disconnect (param/what-if), stylistic, naming, descriptions → **info**.
- **Orphan-table rule is tri-state**: error for a fact-like isolated table, warn for a non-fact isolated table, **info** when the table looks deliberate (single-column / what-if / field-parameter / calc-group). Never hard-block.
- **New model fields to ADD now** (the cheap high-value unlockers — populate in BOTH `tmdl-parser.ts` AND the live `model-driver.ts` snapshot, or live silently regresses): `TMDLColumn.dataCategory?`, `TMDLColumn.formatString?`, and **precise relationship `cardinality`** (`oneToMany|manyToOne|oneToOne|manyToMany`). FAST-FOLLOW (note, don't add now unless trivial): `isAvailableInMdx`, `sortByColumn`, column `description`.
- **DEFER (needs data/metadata we won't model now)**: RLS roles (→ A12 USERELATIONSHIP+RLS), composite keys (A16), 1:1 detection beyond the new cardinality field, calc-group items (F3), RI violations / Vertipaq cardinality (F2, high-card). List them as known-deferred in code comments + the review skill, so we don't promise findings the tool can't produce.
- **Enforcement stays advisory**: do NOT add star-schema best-practice blocks to the pre-write `relationship-check.ts` gate (it keeps blocking only the existing hard errors: missing endpoint, type mismatch, self-loop, ambiguous active path). New star-schema findings surface via `pbi_model_check` (warn/info) + agent guidance.

---

## 1. Shared helper: fact/dimension classifier

Several rules (orphan-fact, fact-to-fact, snowflake, conformed-dim) need to know if a table is fact-like. No native `isFact`. Add a heuristic helper (near `grain.ts`), reused across rules:
- **fact-like** if: has ≥1 numeric column with `summarizeBy != none` (a measure-able quantity) AND/OR participates as the many-side of ≥1 relationship AND/OR has ≥2 FK-like columns. Tune with the mined signals. Returns a confidence the rules can threshold.
- Dataset-agnostic — purely structural, no hardcoded names.

---

## 2. Fixer A — pbi-core detection + model fields + driver capture  (runs FIRST)

Files: `packages/core/src/modeling/{types.ts, tmdl-parser.ts, bpa.ts, grain.ts, relationship-check.ts}`, `packages/mcp/src/model-bridge/model-driver.ts` (snapshot read + write-shape param types), `packages/core/tests/**`, `packages/mcp/tests/model-driver.test.ts`.

### 2a. Model fields (types + both ingestion paths)
- `types.ts`: add `dataCategory?: string` and `formatString?: string` to `TMDLColumn`; ensure `TMDLRelationship.cardinality` carries `oneToMany|manyToOne|oneToOne|manyToMany`.
- `tmdl-parser.ts`: populate the above from TMDL (`dataCategory`, `formatString`, relationship `fromCardinality`/`toCardinality`).
- `model-driver.ts` `getModelSnapshot`: **capture `cardinality` + column `dataCategory`/`formatString`** from the MS-MCP payload (currently dropped — this is the live-regression bug that makes MOD003/MOD004 never fire live). Use tolerant `str(...)` lifts; `// UNVERIFIED` the exact MS-MCP keys and attempt-then-tolerate.

### 2b. bpa.ts severity calibration (existing rules)
`FMT001` info→**error** (C2); `MOD002` info→**warn** (A10); `MOD005` info→**warn** (A13); `DAX003` info→**warn** (D5). Keep DAX002/DAX004/FMT002/MOD006/MOD007/NAM001 as-is (valuable, no catalog conflict).

### 2c. bpa.ts NEW rules — PRIORITY (Section A, statically checkable now)
| id | severity | condition | catalog/source |
|---|---|---|---|
| MOD008 orphan/disconnected table | tri-state err/warn/info | table name absent from all relationship endpoints; severity by fact-classifier + deliberate-heuristic | A1 `dg4:30511`, `dg3:402-406` |
| MOD009 fact-to-fact relationship | error | both endpoints fact-like | A2 `awesome-copilot-pbi-data.xml:11851` |
| MOD010 missing conformed dimension | warn | 2+ fact-like tables share a same-named categorical column with no shared dim path (use `field-index` path check) | A3 `:18923`, `dg3:5107` |
| MOD011 rel datatype mismatch (audit) | error | `from.dataType != to.dataType` (reuse `typesCompatible`) — A4 enforced at write but never re-audited | A4 `dg4:30414` |
| REL/MOD snowflake | warn | a table is both a from-side and a to-side (dim→dim), excluding fact-likes | A6 `dg4:30085` |
| REL excessive bidi/M2M ratio | warn | `(both + manyToMany)/total > 0.30` | A7 `dg4:30125` |
| REL M2M not single-direction | warn | `manyToMany && crossFilter=='both'` | A9 `dg4:30185` |
| MOD TREATAS-as-smell | info | measure TREATAS-bridges two facts (reuse `treatasBridgeMeasures` index) | A15 |
| REL int-keys | info | relationship column dataType != int64 | A5 `dg4:30666` |

### 2d. bpa.ts NEW rules — broad model-quality (feasible now / with the new fields)
| id | severity | condition | source |
|---|---|---|---|
| MOD014 numeric-key summarizeBy≠none | error | visible numeric col, name matches key/ID/postal/year/monthNo, summarizeBy!=none | C1 `dg4:30635` |
| FMT003 visible numeric column unformatted | warn | needs new `formatString` col field | C3 `dg4:29840` |
| FMT004 avoid double type | warn | numeric col dataType=='double' | C4 `dg4:30013` |
| B1 model should have a date table | warn | needs `dataCategory` — no table with dataCategory=='Time' + date key | B1 `dg4:30095` |
| B2 date/calendar table not marked | warn | needs `dataCategory` — table named date/calendar not marked Time | B2 `dg4:30105` |
| NAM002 object-name hygiene | err(lead/trail space, ctrl chars)/warn(Fact/Dim prefix, special chars) | regex on names | C11 `dg4:30593/30719`, `dg3:5214-28` |
| E1 data column missing sourceColumn | error | non-calc col, empty sourceColumn | E1 `dg4:30374` |
| E2 expression-reliant object blank | error | measure with blank expression | E2 `dg4:30384` |
| D1 columns fully qualified / D2 measures not qualified | error | reuse DAX005 ref machinery | D1/D2 `dg4:30254/30264` |
| D3 duplicate measures | warn | identical normalized DAX | D3 `dg4:30274` |
| D6 INTERSECT→TREATAS / D7 direct-ref measure / D8 table-filter-in-CALCULATE | warn | regex/structural | D6/D7/D8 |
| C13 flag columns as Yes/No | info | `Is*` int64 or `* Flag` non-string | C13 `dg4:30583` |

### 2e. orchestrator (doctor.ts/bpa.ts)
- Confirm `runBPA(model)` passes whole model (it does) → MOD008 enumerates tables − relationship endpoints. Add `Relationships`/`StarSchema`/`ErrorPrevention` to the category union (report shape unchanged — category is free-form). MOD008 emits per-table severity (tri-state), not a flat one.

### 2f. write-shape param types (driver, for Fixer B to consume)
Add `isKey?: boolean` + `dataCategory?: string` to `ColumnWrite`/`ColumnUpdate`; add `dataCategory?: string` to `TableUpdate`. Pass-through in `createColumn`/`updateColumn`/`updateTable` (after `toDaxSource`). `// UNVERIFIED` the MS-MCP `dataCategory`/`isKey` Update keys. (Optional) `markAsDateTable(table, dateColumn)` driver method = table Update `dataCategory:'Time'` + column Update `isKey:true`.

### 2g. tests (Fixer A)
One unit test per new bpa rule (build a tiny TMDLModel with FactPrimary/DimShared fixtures: orphan table → MOD008 error; fact-to-fact → MOD009; numeric-key summ → MOD014; datatype mismatch → MOD011; etc.). Driver tests: snapshot now captures cardinality + dataCategory; calc-column maps daxExpression (exists); new write params serialize.

---

## 3. Fixer B — server tools + skills + agents  (runs AFTER A)

Files: `packages/mcp/src/server.ts`, `skills/modeling-semantic-model/**`, `skills/reviewing-models/references/check-catalog.md`, `agents/model-builder.md`, `agents/model-reviewer.md`, `packages/mcp/tests/tool-registry.test.ts`.

### 3a. tooling
- Expose `isKey?`, `dataCategory?` on `pbi_column_create`/`pbi_column_update`; `dataCategory?` on `pbi_table_update`. (Optional, recommended) `pbi_table_mark_as_date(tableName, dateColumn)` → `drv.markAsDateTable`. Add a one-line note to `pbi_column_create` desc: "calculated columns (via `expression`) are supported on imported tables too."

### 3b. skills/modeling-semantic-model
- **G2 grain-mismatch remediation (HEADLINE)** — new section (in `columns-relationships.md` or a new ref): the target-vs-actual monthly-vs-daily problem + options A–D (coarser groupby / period-end axis column / BLANK non-boundary via EOMONTH / daily-additive via DIVIDE-by-days). Source `dg3:1037-1076`; cross-link `authoring-measures/references/dax-performance.md:481` period-end recipe.
- **G1** one-consistent-grain principle (one line). **A2** fact-to-fact = error (one line). **C1** numeric-key summarizeBy = error callout (distinguish from string MOD006). **C2** measure-missing-format = error. **Conformed-dimension build recipe**: create dim calc-table (`DISTINCT`/`SELECTCOLUMNS`/`SUMMARIZE` over the fact) → relate both facts → hide FKs → simplify/drop the TREATAS. **Date-table marking** mechanism note (dataCategory:Time + isKey, via the new tool).

### 3c. agents/model-builder.md
- **Build-completeness gate (KEY)**: new Must — track the full planned object list; after writes, diff planned-vs-built via `pbi_model_list_*` and report any unbuilt item as **incomplete, not done**. (Fixes partial-build-declared-done.)
- Conformed-dim 4-step recipe (ref the skill). Mark-as-date-table step + new tool in the tools list. Tighten post-build: re-run `pbi_model_check`; treat MOD008/MOD009 firing as build-incomplete.

### 3d. agents/model-reviewer.md + reviewing-models/check-catalog.md
- Extend the reviewer's Fix Quick Reference with the new rule IDs (MOD008 orphan, MOD009 fact-to-fact, MOD011 datatype, MOD014 summarizeBy, B1/B2 date table) + concise fixes. Wire check-catalog checks 1.4/7.1/7.5/5.1 to the new rule IDs so findings cite tool output. Note the DEFER items as skill-only narrative (not tool-backed).

### 3e. tests (Fixer B)
Registration tests: new tool params present; mark-as-date tool registered + hints. (No live Desktop needed.)

---

## 4. Verify
`pnpm -r build` + `pnpm -r test` + `npx biome check .` green after each fixer. Then a review agent audits vs this contract + the two ironclad rules; loop until clean.

## 5. Known-deferred (document, don't implement)
A12 USERELATIONSHIP+RLS (no roles in model), A16 composite keys, F2 RI violations, F3 calc-group items, C6/C7 isAvailableInMdx, C9 sortByColumn, C12 column descriptions (fast-follow fields).

---

# FINAL CONTRACT (reviewed — AUTHORITATIVE; supersedes the draft above on any conflict)

## Critical corrections to the draft (the fix agents MUST use these)
1. **Severity literal is `'warning'`** (not `'warn'`). `Severity = 'error'|'warning'|'info'` (`types.ts:1`).
2. **`TMDLRelationship.cardinality` ALREADY EXISTS** typed `'manyToOne'|'oneToMany'|'oneToOne'|'manyToMany'` (`types.ts:3,45`). Do NOT add it. The work is to POPULATE it correctly (below).
3. **CONFIRMED PARSER BUG (fix it):** `tmdl-parser.ts:352-354` sets `cardinality='manyToMany'` whenever it sees `many` on either side — so a normal 1:many (`fromCardinality: many` + `toCardinality: one`) is mislabeled `manyToMany` → **MOD003 false-positives on every real TMDL relationship.** Rewrite to derive from the (from,to) pair: many+one→`manyToOne`, one+many→`oneToMany`, one+one→`oneToOne`, many+many→`manyToMany`, absent→`manyToOne` (PBI default). Factor into ONE shared helper (e.g. `cardinality.ts`) used by BOTH parser and driver.
4. **`getModelSnapshot` (`model-driver.ts:672-690`) drops cardinality entirely** and columns drop `dataCategory`/`formatString` → MOD003 never fires live; MOD004 fires on every `both` edge live. Capture all three (tolerant `str(...)`, `// UNVERIFIED` MS keys), computing cardinality via the shared helper.
5. **FMT001 starts at `'warning'`** (`bpa.ts:84`), not info → change to **error**.
6. **MOD003 (m:m) already exists** (`bpa.ts:158-170`). Do NOT add a separate A9 rule — fold "M2M should be single-direction" into MOD003 (escalate message when `crossFilteringBehavior==='both'`).
7. **MOD011 uses STRICT `from.dataType !== to.dataType`** (NOT `typesCompatible`, which treats int64/decimal as compatible). Severity **`'warning'`** (the breaking subset is already gated at write). Code-comment the deliberate difference.
8. **`BPARuleCategory` is a CLOSED union** (`bpa.ts:11-17`), not free-form. Reuse `'Modeling'` for MOD008-016, `'Formatting'` for FMT003/004, `'Naming'` for NAM002; add ONLY `'ErrorPrevention'` to the union (for E1/E2). Report shape unchanged; `doctor.ts` tally needs no change.

## New model fields (NOW) — two only, in BOTH `types.ts` + `tmdl-parser.ts` + `model-driver.ts` snapshot
`TMDLColumn.dataCategory?: string`, `TMDLColumn.formatString?: string`. (Plus the cardinality bug-fix in both paths — not a new field.) Defer `isAvailableInMdx`/`sortByColumn`/column `description` (keep parser↔driver symmetric).

## Fact/dimension classifier — `packages/core/src/modeling/fact-classifier.ts` (pure, dataset-agnostic, NO hardcoded names)
Signals from `TMDLModel` only: S1 has ≥1 measure; S2 count of `isSummarizableColumn` (numeric + summarizeBy!=none, reuse `field-index.ts:203`); S3 is `fromTable` (many side) of ≥1 relationship; S4 distinct relationships where it's `fromTable` (fan-out). Return `{kind:'fact'|'dimension'|'unknown', confidence}`: **fact** = S3≥1 AND (S2≥1 OR S4≥2); **dimension** = appears only as `toTable`, or 0 numerics+0 measures; else **unknown**. Allowed name-regex rules (MOD014 key/id/year/postal; NAM002; MODB2 date/calendar) are structural patterns from the canonical TE ruleset, not dataset identifiers — comment to preempt reviewer flags.

## FINAL rule list (Fixer A, `bpa.ts`)
**Tier 1 (priority):** MOD008 orphan tri-state (error if fact / info if deliberate [single-col, or `isCalculated`+≤2col+0measure, or `isAutoDateTable`] / warning else); MOD009 fact-to-fact (error, both endpoints fact-high); MOD010 missing-conformed-dim (warning, ≥2 facts share same-named non-key col + no `hasUndirectedRelationshipPath`); MOD011 strict datatype-mismatch (warning); MOD012 snowflake (warning, both from&to side, exclude facts); MOD013 excessive bidi/M2M ratio >0.30 (warning, one model-level finding); MOD003 extend (fold A9); MOD015 int-keys (info); MOD016 TREATAS-smell (info, reuse `treatasBridgeMeasures`).
**Tier 2:** MOD014 numeric-key summarizeBy≠none (error); FMT003 visible numeric col unformatted (warning, new field); FMT004 double type (warning); MODB1 model-should-have-date-table (warning, new field); MODB2 date/calendar-not-marked (warning, new field); NAM002 name hygiene (error lead/trail-space+ctrl-chars / warning Fact-Dim-prefix+special-chars); E1 data-col-missing-sourceColumn (error); E2 expression-reliant-blank (error).
**Tier 3 (DAX, skip D4/D5 — already DAX001/DAX003):** DAX006 columns-fully-qualified (error); DAX007 measures-not-qualified (error); DAX008 duplicate-measures (warning); DAX009 INTERSECT→TREATAS (warning); DAX010 direct-ref-measure (warning); DAX011 table-filter-in-CALCULATE (warning). [DAX006/007 higher-risk — may fast-follow if time-boxed.]
**Severity recal (existing):** FMT001→error, MOD002→warning, MOD005→warning, DAX003→warning. **Cut:** draft C13/C8.

## Tooling
Fixer A driver: add `isKey?`+`dataCategory?` to `ColumnWrite`/`ColumnUpdate`, `dataCategory?` to `TableUpdate` (pass-through; `toDaxSource` spreads them fine; `updateTable` doesn't call it — also fine); `// UNVERIFIED` MS keys; add `markAsDateTable(table,dateColumn)` = table Update `dataCategory:'Time'` + column Update `isKey:true`. Fixer B server: expose those params on `pbi_column_create/update` + `pbi_table_update`; add convenience tool `pbi_table_mark_as_date(tableName,dateColumn)`; one-line `pbi_column_create` desc note that calc columns (via `expression`) work on imported tables (doc-only — wiring already correct/tested).

## Build split (CONFIRMED disjoint, A→B mandatory)
**Fixer A** (runs first): `packages/core/src/modeling/{types,tmdl-parser,bpa}.ts` + new `fact-classifier.ts`/`cardinality.ts` + `BPARuleCategory` union edit; `packages/mcp/src/model-bridge/model-driver.ts`; tests `packages/core/tests/modeling/{bpa,tmdl-parser,fact-classifier}.test.ts` + `packages/mcp/tests/model-driver.test.ts`. **Fixer B** (after A): `packages/mcp/src/server.ts` + `skills/modeling-semantic-model/**` + `skills/reviewing-models/references/check-catalog.md` + `agents/model-builder.md` + `agents/model-reviewer.md` + `packages/mcp/tests/tool-registry.test.ts`. B's server imports A's new param types + references A's new rule IDs → A must land first. No file shared.

## Test must-haves
Per-rule bpa tests incl. all three MOD008 severities + the severity-recal assertions; `fact-classifier.test.ts`; **`tmdl-parser.test.ts` cardinality coverage (the biggest current gap): `fromCardinality: many`+`toCardinality: one` → `manyToOne` AND a regression that this no longer trips MOD003**; driver tests for cardinality + dataCategory/formatString capture + new write-param serialization + `markAsDateTable`; registration tests (Fixer B). Gate: the MOD003 false-positive regression MUST pass.
