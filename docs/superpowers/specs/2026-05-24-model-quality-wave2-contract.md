# Model-Quality Enforcement — Wave 2 Build Contract

Synthesized 2026-05-24 from 3 planning agents (structural / object-DAX / metadata-capture).
Closes MOD008-class correctness holes found in the re-mining pass. **MINE-DON'T-INVENT**
(every rule cites `docs/superpowers/mining/packed/<file>.xml:<lines>`) and **DATASET-AGNOSTIC**
(no hardcoded dataset fields; structural signals + generic tokens only) are IRONCLAD.

Severity literal is `'error' | 'warning' | 'info'` (NOT `'warn'`). Canonical BPA severity is
**not portable** — port the *detection*, calibrate the *severity* to real correctness impact.

---

## 0. CRITICAL GOTCHAS (read first — these are how we broke things before)

1. **ESCAPE-SEQUENCE CONTROL BYTES.** Any regex matching control characters MUST be written with
   text escape sequences (`\x00`, `\x1f`, `\x7f`), NEVER raw control bytes. Last wave a fixer
   pasted raw bytes into `bpa.ts` and `file` reported it as binary, breaking grep/git-diff. After
   any edit touching control-char regexes, verify `file packages/core/src/modeling/bpa.ts` reports
   text, not "data".
2. **E5 description check must NOT reuse `hasControlChars`.** Names may never contain tab/newline,
   but descriptions legitimately do. E5 uses a whitespace-EXCLUDING set:
   `const NON_WS_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;` (excludes `\t`=09, `\n`=0a, `\r`=0d).
   Reusing `hasControlChars` would false-positive at ERROR severity on every multi-line description.
3. **Gate every consuming-rule that reads an UNVERIFIED live-captured field** so a missing/incomplete
   capture yields SILENCE, never a false positive. Mechanisms below (per rule). This is mandatory:
   the live-driver keys are guesses until a Windows run confirms them.
4. **Two existing tests change intentionally** (MOD003 A9-fold, and any doctor.test.ts count asserts).
   These are deliberate behavior updates, not regressions — see each rule.
5. **Do not regress the review-fix regression block** in bpa.test.ts (`describe('BPA review-fix
   regressions ...')`): MOD014 must still ignore "Number of Orders"/"No of Items" and flag "ProductID";
   NAM002 must still allow "Profit & Loss"/"A/B Test" and flag "DimProduct"/"FactSales". Each new rule
   names the regression tests it could interact with.

---

## 1. FINAL RULE-ID ASSIGNMENTS (collisions resolved)

Collisions resolved: MOD017 → P1 (ambiguous path); P2's numeric-summarize → **MOD022**.
META001 dropped entirely — P2's control-char-description → **E5**; P3's no-description → **MOD026**.
P3's string-month → **FMT007** (Formatting category). No META* prefix (catalog uses MOD/DAX/FMT/E/NAM).

| ID | Rule | Type | Severity | Category | Owner build |
|----|------|------|----------|----------|-------------|
| MOD017 | Ambiguous multi-hop (diamond) filter path | NEW | error | Modeling | B2 |
| MOD018 | Time-intelligence used but no marked date table | NEW | error | Modeling | B2 |
| MOD019 | Target-vs-actual grain mismatch (heuristic) | NEW | warning | Modeling | B2 |
| MOD020 | Mark primary keys (one-side rel col not isKey) | NEW | info | Modeling | B2 |
| MOD021 | One-to-one relationship advisory | NEW | info | Modeling | B2 |
| MOD022 | General numeric summarizeBy advisory (companion to MOD014) | NEW | info | Modeling | B2 |
| MOD023 | USERELATIONSHIP + RLS against same table | NEW | error | Modeling | B2 |
| MOD024 | Many-to-many on a dynamic-RLS table | NEW | warning | Modeling | B2 |
| MOD025 | Bidirectional cross-filter into a secured table | NEW | warning | Modeling | B2 |
| MOD026 | Visible object with no description (AI-readiness) | NEW | info | Maintenance | B2 |
| MOD027 | Table >10 visible measures, none in a display folder | NEW | info | Maintenance | B2 |
| MOD028 | Assume-RI into a DirectQuery source | NEW | warning | Modeling | B2 |
| DAX012 | EVALUATEANDLOG in production | NEW | warning | DAX | B2 |
| DAX013 | `1-(x/y)` / `1±DIVIDE` syntax | NEW | warning | DAX | B2 |
| DAX014 | BLANK-suppression (`+0`/`COALESCE(…,0)`/`IF(ISBLANK,0,…)`) | NEW | warning | DAX | B2 |
| FMT005 | %-named measure with no `%` in format string | NEW | warning | Formatting | B2 |
| FMT006 | Missing geography dataCategory | NEW | info | Formatting | B2 |
| FMT007 | String month column with no sortByColumn | NEW | warning | Formatting | B2 |
| E3 | Calculated column has a blank expression | NEW | error | ErrorPrevention | B2 |
| E4 | isAvailableInMdx=false on a sort-by target column | NEW | error | ErrorPrevention | B2 |
| E5 | Control characters in a measure description | NEW | error | ErrorPrevention | B2 |
| MOD002 | Inactive rel — reframe msg + role-playing error escalation | STRENGTHEN | warn/error | Modeling | B2 |
| MOD003 | m:m bidi without bridge → error | STRENGTHEN | warn/error | Modeling | B2 |
| MOD011 | Relationship key type mismatch — severity split | STRENGTHEN | warn/error | Modeling | B2 |
| NAM002 | + reserved-word object-name branch | STRENGTHEN | warning | Naming | B2 |
| DAX001 | Extend DIVIDE check over calculated columns | EXTEND | warning | DAX | B2 |
| DAX005 | Extend reference check over calculated columns | EXTEND | warning | DAX | B2 |

**Deferred (not in this wave, documented):** calculation-ITEMS DAX (calc groups not captured — no parser
branch, no driver op); E4 hierarchy/variation half (hierarchies not captured); E5 column/table descriptions
(now unblocked by M4 capture — builder MAY extend E5 to columns/tables once M4 lands, otherwise leave as
measure-only and note it).

---

## 2. FILE OWNERSHIP (so the two builds never touch the same file)

**Orchestrator (me), applied BEFORE builds launch:** `packages/core/src/modeling/types.ts` (§3 below).

**Build 1 — metadata capture (parser + driver):**
- `packages/core/src/modeling/tmdl-parser.ts`
- `packages/mcp/src/model-bridge/model-driver.ts`
- `packages/core/src/modeling/index.ts` (export `parseRoleFile` only)
- `packages/core/tests/modeling/tmdl-parser.test.ts`
- `packages/mcp/tests/model-driver.test.ts`
- new fixture dir `packages/core/tests/fixtures/rls-model/` (1 fact, 1 dim, 1 role)

**Build 2 — rules + tests:**
- `packages/core/src/modeling/bpa.ts`
- `packages/core/src/modeling/relationship-check.ts` (add diamond gate; export `typesCompatible`)
- `packages/core/src/modeling/field-index.ts` (export a directed-filter-edge helper for MOD017)
- `packages/core/tests/modeling/bpa.test.ts` (add new optional fields to `c`/`meas`/`tbl`/`rel` opts + `roles` via `makeModel` overrides; new rule fixtures)
- `packages/core/tests/modeling/relationship-check.test.ts`
- the check-catalog rule registry + its test (grep for `MOD016` / `DAX011` to locate; mirror the entry format) — add ALL new IDs
- `packages/core/tests/modeling/doctor.test.ts` (only if new rules shift asserted counts — update deliberately)

Build 2 imports `typesCompatible` directly from `./relationship-check.js` and the new edge helper from
`./field-index.js` (both Build-2-owned). Build 2 does NOT touch index.ts. No file is shared between builds.

---

## 3. types.ts ADDITIONS (orchestrator locks these first — all optional `readonly ?:`)

```typescript
// new supporting types (near Cardinality/CrossFilteringBehavior)
export type StorageMode = 'import' | 'directQuery' | 'dual' | 'directLake';
export interface TMDLRolePermission {
  readonly table: string;
  readonly filterExpression: string; // '' = static role / no dynamic predicate
}
export interface TMDLRole {
  readonly name: string;
  readonly tablePermissions: ReadonlyArray<TMDLRolePermission>;
}

// TMDLColumn (after isCalculated)
  readonly expression?: string;        // M1 calc-column DAX (RHS of `column 'X' = <DAX>`)
  readonly description?: string;       // M4
  readonly displayFolder?: string;     // M5
  readonly sortByColumn?: string;      // M3 (bare column name on the same table)
  readonly isAvailableInMdx?: boolean; // M3 (absent ⇒ treated as true; only explicit false is risky)

// TMDLMeasure (after annotations)
  readonly displayFolder?: string;     // M5 (parser currently drops it)

// TMDLTable (after isAutoDateTable)
  readonly description?: string;       // M4
  readonly storageMode?: StorageMode;  // M6

// TMDLRelationship (after cardinality)
  readonly relyOnReferentialIntegrity?: boolean; // M6

// TMDLModel (after relationships)
  readonly roles?: ReadonlyArray<TMDLRole>;      // M2
```

---

## 4. BUILD 2 — RULE SPECS

Reuse existing bpa.ts helpers: `violation(id,sev,cat,object,{message,fix?})`, `forEachMeasure`,
`stripDaxComments`, `measureRef`/`columnRef`/`columnRefRaw`/`measureRefRaw`, `looksLikeKeyName`,
`isNumericType`, `looksLikeDateTableName`. **dataType literals are lowercase** in this model
(`int64|decimal|double|string|date|dateTime`) — do not port the XML's `Int64` casing.
Append new rule objects to `BPA_RULES`. Verify exact line numbers by reading the file (may have shifted).

### MOD017 — Ambiguous multi-hop (diamond) path — NEW, error, Modeling, scope model
Existing `detectAmbiguousPaths` only catches ≥2 rels on the SAME table pair. A diamond (A→B active AND
A→C→B active via different intermediates) is undetected. Build the **directed active-filter edge set**
(same direction semantics as field-index `outgoingFilterLinks`: single = dim(to)→fact(from); both = both
ways), tag each edge with its relationshipId. For each ordered table pair, greedily count edge-disjoint
active directed paths (find a path, delete its edges, repeat); if ≥2 paths exist **AND they differ by ≥1
intermediate table** (so the same-pair case stays owned by the existing error), emit once per unordered pair.
**Export** a `directedFilterEdges(index)` helper from field-index.ts for reuse by the gate.
Guards: active edges only (inactive role-playing must not contribute); skip auto-date tables; a single shared
dim fanning to two facts is NOT a diamond (length-1 paths). Fixtures: POS = A→B,A→C,B→D,C→D all active single
(A reaches D via B and via C) ⇒ error; NEG = clean star; NEG = one of the two paths inactive ⇒ silent.
Cite: `awesome-copilot-pbi-data.xml:18504-18508, :18571-18574, :18589, :12259-12260`.

**Pre-write gate (relationship-check.ts):** in `relationshipCheck`, when `candidate.isActive !== false`,
BFS the existing directed active-filter graph (honor `ignoreRelationshipId`) for an existing path between the
candidate's endpoints through a different route; if found, push blocking reason `code:'ambiguous-diamond-path'`
(distinct from the existing same-pair `ambiguous-active-path`). Test in relationship-check.test.ts.

### MOD018 — Time-intelligence used, no marked date table — NEW, error, Modeling, scope model
TI fn set (uppercase): DATEADD, SAMEPERIODLASTYEAR, TOTALYTD/QTD/MTD, DATESYTD/QTD/MTD, PARALLELPERIOD,
DATESBETWEEN, DATESINPERIOD, PREVIOUS/NEXT YEAR|QUARTER|MONTH|DAY, START/ENDOF YEAR|QUARTER|MONTH,
OPENING/CLOSINGBALANCE YEAR|QUARTER|MONTH. `hasMarkedDate = model.tables.some(t => t.columns.some(c =>
(c.dataCategory??'').toLowerCase()==='time'))` — reuse the EXACT MODB1/MODB2 predicate. If marked ⇒ `[]`.
Else scan measures: `stripDaxComments`, test one regex `\b(<fns>)\s*\(` (the `\s*\(` requires a call, so a
measure named `[Previous Year]` referenced as `[...]` won't match). Emit ONE model-level finding naming a
sample measure. Fixtures: POS = measure `TOTALYTD(...)`, no date table ⇒ error; NEG = same with a dataCategory
'Time' column present; NEG = `[Previous Year]` ref, no date table ⇒ silent. Cite: `dg3-semantic-models.xml:5104`.

### MOD019 — Target-vs-actual grain mismatch (HEURISTIC) — NEW, warning, Modeling, scope model
**Highest false-positive risk — warning, not error; reviewer must scrutinize.** For each date dimension D
(a table with a dataCategory 'Time' column OR `looksLikeDateTableName(D.name)`) that ≥2 high-confidence facts
(`classifyTable(model,t).kind==='fact' && confidence>=0.85`) relate to via ACTIVE rels: for each fact read its
rel's to-side column on D and classify grain — **day-grain** if to-col dataType is `date`/`dateTime` or name
matches `/(^|[^a-z])(date|day)([^a-z]|$)/i`; **coarse-grain** if dataType `int64`/`string` AND name matches
`/(^|[^a-z])(month|quarter|year|week|period)([^a-z]|$)/i`. If one fact day-grain and another coarse-grain ⇒
warn once for the pair (point at the coarse fact). Guards: both facts ≥0.85; D must be a real date dim; only
fire when one side clearly day + other clearly coarse (else silent); same to-column ⇒ never fire; skip inactive.
Tokens are a generic structural heuristic (NOT dataset fields) — keep message advisory ("confirm the intended
grains"). If the builder finds 0.85 too strict for 2-signal facts, fall back to `kind==='fact'` with the
date-dim guard carrying FP weight — note the choice. Cite: `dg3-semantic-models.xml:1037-1076`,
`awesome-copilot-pbi-data.xml:18856-18862`.

### MOD020 — Mark primary keys — NEW, info, Modeling, scope column
For each relationship, resolve the to-side column; skip if missing, if `isKey===true`, if
`cardinality==='manyToMany'` (bridge FK, not a one-side key), or if the to-table is a date table
(dataCategory 'Time' or `looksLikeDateTableName`). Else info, deduped per `toTable[toColumn]` (Set, like
MOD015). Cite: `dg4-te-fabric-desktop-root.xml:30697`.

### MOD021 — One-to-one advisory — NEW, info, Modeling, scope relationship
`r.cardinality==='oneToOne'` ⇒ info ("rare; consider consolidating unless deliberate PII split"). `deriveCardinality`
only returns oneToOne for explicit one+one, so the default-manyToOne collapse can't trip it. Cite:
`awesome-copilot-pbi-data.xml:18455, :11829-11839`.

### MOD022 — General numeric summarizeBy advisory — NEW, info, Modeling, scope column (companion to MOD014)
MOD014 stays exactly as-is (error, key-named only). MOD022 is the broad info companion and MUST NOT double-report:
for each visible column on a visible table, `isNumericType(c.dataType)` && `summarizeBy` set && not 'none' &&
**NOT `looksLikeKeyName(c.name)`** (MOD014 owns those) ⇒ info ("prefer summarizeBy=None + explicit measure").
Regression interaction: it WILL newly emit info on "Number of Orders"/factTable's "Amount" etc. — that's correct
and invisible to `has(...,'MODxxx')` checks; add a companion assertion that for the MOD014 key fixtures MOD022 is
silent (dedup) and for the additive-count fixtures MOD014 stays falsy while MOD022 is info. Cite:
`dg4-te-fabric-desktop-root.xml:30639` (canonical Sev3 — DE-escalated to info; firing on every Sales/Quantity at
error would false-positive every model).

### MOD023 — USERELATIONSHIP + RLS same table — NEW, error, Modeling, scope model
**Gated:** if `!model.roles?.length` ⇒ `[]`. `securedTables` = every `permission.table` across roles. For each
measure, for each `USERELATIONSHIP(...)` call, extract the two `'Table'[Col]` operands (qualified-ref regex
`('([^']+)'|([A-Za-z_][\w .-]*))\[([^\]]+)\]`), collect their table names, intersect with `securedTables` ⇒
error. Cite: `dg4-te-fabric-desktop-root.xml:30404-30411`.

### MOD024 — m:m on dynamic-RLS table — NEW, warning, Modeling, scope model
**Gated** on roles. `dynamicSecured` = permission tables whose `filterExpression.trim()!=='' &&
/\b(USERNAME|USERPRINCIPALNAME)\s*\(/i` (the "dynamic" qualifier). For each relationship with
`cardinality==='manyToMany'`, if either endpoint ∈ dynamicSecured ⇒ warning. (Canonical Sev3 Perf —
calibrated to warning: the symptom is degradation, not breakage, consistent with MOD003/MOD013.)
Cite: `dg4-te-fabric-desktop-root.xml:30165-30172` (+ dynamic pattern `:30248-30250`).

### MOD025 — Bidirectional into secured table — NEW, warning, Modeling, scope model
**Gated** on roles. `securedTables` = permission tables with `filterExpression.trim()!==''`. For each rel with
`crossFilteringBehavior==='both'`, if either endpoint ∈ securedTables ⇒ warning (RLS row-leak risk). Complements
MOD004 (both may fire). Cite: `awesome-copilot-pbi-data.xml:18480-18481, :18605-18608`; vocab `dg4:58066-58072`.

### MOD026 — Visible object no description — NEW, info, Maintenance, scope tables/columns/measures
**Gated:** if NO table/column/measure anywhere has a non-empty description ⇒ `[]` (convention not captured;
mirror E1's "convention expressed" guard — keeps it inert on UNVERIFIED-incomplete live snapshots). Else, for
each visible (`!isHidden`) table (skip auto-date)/column/measure with blank description ⇒ info. Cite:
`dg4-te-fabric-desktop-root.xml:30521-30527`, `dg3-semantic-models.xml:402-406`.

### MOD027 — >10 visible measures none foldered — NEW, info, Maintenance, scope table
**Gated:** if NO measure anywhere has a non-empty displayFolder ⇒ `[]` (convention not captured). Else per table:
`visible = measures.filter(!isHidden)`; `unfoldered = visible.filter(no displayFolder)`; if `unfoldered.length>10`
⇒ info. Cite: `dg4-te-fabric-desktop-root.xml:29771-29778`.

### MOD028 — Assume-RI into DirectQuery — NEW, warning, Modeling, scope relationship (most-uncertain capture)
**Double-gated:** `r.relyOnReferentialIntegrity===true` AND (fromTable or toTable `storageMode==='directQuery'`)
⇒ warning (INNER join silently drops fact rows). Both fields UNVERIFIED-capture; double-gate ⇒ inert unless both
captured (safe). Cite: `awesome-copilot-pbi-data.xml:11854-11857`, `dg4-te-fabric-desktop-root.xml:19766-19769`.

### DAX012 — EVALUATEANDLOG — NEW, warning, DAX, scope measure
`/\bEVALUATEANDLOG\s*\(/i` on `stripDaxComments(m.expression)`. Cite: `dg4:30364`.

### DAX013 — `1-(x/y)` syntax — NEW, warning, DAX, scope measure
Two regexes on stripped expr: `/[0-9]+\s*[-+]\s*\(*\s*SUM\s*\(\s*'?[A-Za-z0-9 _]+'?\s*\[[A-Za-z0-9 _]+\]\s*\)\s*\//i`
and `/[0-9]+\s*[-+]\s*DIVIDE\s*\(/i`. Leading `[0-9]+` anchors to literal-number±(SUM/DIVIDE), so plain
`a - DIVIDE(...)` with a measure ref doesn't match. May co-fire with DAX001 (intentional). Cite: `dg4:30354/:30360`.

### DAX014 — BLANK-suppression — NEW, warning, DAX, scope measure (advisory wording)
On stripped expr (optionally strip double-quoted strings first via `replace(/"(?:""|[^"])*"/g,' ')`):
P1 `/\+\s*0\s*(\)|$)/`, P2 `/\bCOALESCE\s*\([^()]*,\s*0\s*\)/i`, P3 `/\bIF\s*\(\s*ISBLANK\s*\([^()]*\)\s*,\s*0\s*,/i`.
Message: "if not intentional, inflates SUMMARIZECOLUMNS result set with spurious all-zero rows." The documented
gated exception `+ IF(NOT ISEMPTY(...),0)` must NOT match (P1 anchor excludes it). Cite: `dg3-semantic-models.xml:1080-1101`.

### FMT005 — %-named measure no `%` format — NEW, warning, Formatting, scope measure
Skip hidden; skip if formatString absent/blank (FMT001 owns that). `looksLikePercentageMeasure(name)` =
`/(%|percent|percentage)$/i.test(name.trim())` — **DROP "Rate"** (too unit-ambiguous; would flag Exchange/Interest
Rate). If name matches AND `!formatString.includes('%')` ⇒ warning. NEG fixture: "Exchange Rate" `$#,0.00` ⇒ silent
(load-bearing). Cite: `dg4:29860`.

### FMT006 — Geo dataCategory — NEW, info, Formatting, scope column
Skip if dataCategory non-blank. String col whose lowercased name includes country/continent/city, OR
decimal/double col matching `/^(lat|long|latitude|longitude)/` (prefix gated by numeric type) ⇒ info. Cite: `dg4:30676`.

### FMT007 — String month no sortByColumn — NEW, warning, Formatting, scope column
Skip auto-date tables. `dataType==='string'` && `/month/i.test(name)` && `!/months/i.test(name)` &&
no `sortByColumn` ⇒ warning. **Gated implicitly** by sortByColumn capture being UNVERIFIED on live — acceptable
at warning (degrades to "verify month sort"); exact on disk. Cite: `dg4:30728-30733`.

### E3 — Calc-column blank expression — NEW, error, ErrorPrevention, scope calc columns
**Gated:** if NO calc column anywhere has a non-empty `expression` ⇒ `[]` (mirror E1's `modelExpressesSources`
guard — inert on UNVERIFIED-incomplete live). Else: column `isCalculated===true` && blank `expression` ⇒ error.
Data columns (no expression, have sourceColumn) never flagged. Cite: `dg4:30384-30391`.

### E4 — isAvailableInMdx=false on sort-by target — NEW, error, ErrorPrevention, scope column
Build `targets` = `${t.name}[${c.sortByColumn}]` for every column with a sortByColumn. For each column with
**explicit** `isAvailableInMdx===false` (never undefined) that is a sort-by target (or itself has a sortByColumn)
⇒ error. Hierarchy/variation half DEFERRED (not captured). Cite: `dg4:30446-30453`.

### E5 — Control chars in measure description — NEW, error, ErrorPrevention, scope measure
`const NON_WS_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;` (ESCAPE SEQUENCES — see Gotcha #1/#2). If
`m.description && NON_WS_CONTROL.test(m.description)` ⇒ error. NEG fixture: multi-line description (with `\n`)
⇒ silent (load-bearing). `meas()` can't set description — use a raw measure object literal in the fixture.
Cite: `dg4:30435`. (Builder MAY extend to column/table descriptions once M4 lands; else leave measure-only + note.)

### MOD002 STRENGTHEN — role-playing
Keep the USERELATIONSHIP-usage gate first (referenced ⇒ emit nothing). For an unreferenced inactive rel: if the
same unordered (fromTable,toTable) pair ALSO has a separate ACTIVE rel on DIFFERENT columns (compare column-pair
signature; guard `active.id!==r.id`) ⇒ **error** (silent fallback to the active path = wrong slicing). Else keep
**warning** but fix the message to suggest ADDING a USERELATIONSHIP measure, not deleting. Existing MOD002 test
(single inactive, no sibling active) stays warning. Cite: `dg3:5108`, `awesome-copilot:18494-18526`, `dg4:30344`.

### MOD003 STRENGTHEN — unbridged bidi m:m → error
When `cardinality==='manyToMany'` && `crossFilteringBehavior==='both'` && neither endpoint is a bridge ⇒ **error**;
else keep warning. **Bridge test:** table is to-side of exactly two relationships AND has no measures AND is thin
(every column key-like/FK: `isKey || looksLikeKeyName(name) || (isNumericType(dataType) && summarizeBy in {none,unset})`).
**INTENDED TEST CHANGE:** the existing A9-fold test (bpa.test.ts ~499-511, bidi m:m between two dimTables) now escalates
to error — update that assertion to `severity==='error'` and keep matching "bidirectional" in the message. Cite:
`awesome-copilot:18917`, `dg4:30185`.

### MOD011 STRENGTHEN — severity split
**Export `typesCompatible` from relationship-check.ts**; import into bpa.ts. When `fromCol.dataType!==toCol.dataType`:
`typesCompatible(fromCol,toCol)` (equal, or both numeric {int64,decimal,double}, or both temporal {date,dateTime})
⇒ **warning** (widening); else ⇒ **error** (hard incompatible: string↔int64, dateTime↔int64…). Existing tests:
int64↔decimal stays warning ✓, identical skipped ✓. Add NEG/POS for the error tier. Cite: `dg4:30414`.

### NAM002 STRENGTHEN — reserved words
Add a branch (after the control-char error branch, before the Fact/Dim+special-char branch, with early return):
`isReservedWord(name)` = `/^(DATE|TIME|YEAR|MONTH|DAY|HOUR|MINUTE|SECOND|NOW|TODAY|TRUE|FALSE|BLANK)$/i.test(name.trim())`
⇒ warning. Use EXACTLY this 13-token canonical set (no additions — MINE-DON'T-INVENT). None of the existing
regression names are reserved words, so they stay green. POS: table named `Date`. Cite: `dg4:29830`.

### DAX001 + DAX005 EXTEND over calculated columns
Add a shared iterator `forEachExpressionObject(model, fn)` yielding every measure AND every calc column with a
non-empty expression (`kind:'measure'|'calcColumn'`, object ref = measureRefRaw|columnRefRaw). Switch DAX001's
check to it (regex body unchanged). For references: in a calc-column pass call the EXPORTED
`daxReferenceCheck(o.expression, model, {hostTable:o.table})` and emit DAX005 warning per missing ref (reuse the
library fn — do NOT duplicate matchers). Do NOT widen DAX002/007/008/010/011 (measure-only canonical scope).
Cite: `dg4:30294-30301` (DIVIDE incl CalculatedColumn), `:30254-30271` (ref checks incl calc objects).

---

## 5. BUILD 1 — METADATA CAPTURE

Full line-by-line spec (TMDL syntax, exact insertion points, `// UNVERIFIED` key candidates, parser/driver test
cases, the new `rls-model` fixture, and the degradation/try-catch for the roles read) is in the persisted P3
planner output — **READ IT**:
`/Users/heshameissa/.claude/projects/-Users-heshameissa-Documents-Projects-pbi-mcp-ts/d20b20a5-ca9b-462e-8941-65d6fe8693bc/tool-results/toolu_016NcG273JeyvQD3wVHPg2gA.json`
(§2 Parser spec, §3 Driver spec, §4 test cases). Summary of what to capture:

- **M1 calc-column `expression`:** parser — split `column 'X' = <DAX>` on first `=` (mirror `parseMeasureHeader`),
  accumulate inline + indented continuation, set `isCalculated`; guard `sawCalcSignal` so a malformed data-column
  body can't absorb a stray line. driver — `str(c,'expression','daxExpression','dax')` (write path proves
  `daxExpression`). 
- **M3 `sortByColumn`, `isAvailableInMdx`:** parser body lines `sortByColumn:` / `isAvailableInMDX:`; driver
  `str`/typeof (do NOT default isAvailableInMdx to true — keep undefined when absent).
- **M4 `description` (column + table):** parser `description:` body line + the `///` above-header form (mirror the
  measure path); driver `str(...,'description')`.
- **M5 `displayFolder` (measure + column):** parser — STOP dropping `displayFolder:` for measures (currently
  discarded); capture for both; driver `str(...,'displayFolder')`.
- **M6 `storageMode` (table partition `mode:`) + `relyOnReferentialIntegrity` (relationship):** parser — scan table
  body for `/^mode:\s*(\w+)/i` → normalize; rel body `relyOnReferentialIntegrity:`; driver — `normalizeStorageMode`
  + `bool(...) || undefined`. storageMode partition parse is the least-certain bit — leave undefined if absent
  (MOD028 is gated, so a miss is silent).
- **M2 `roles`:** parser — NEW folder read `definition/roles/*.tmdl`; new exported `parseRoleFile` (match `role <name>`,
  parse `tablePermission <Table> = <expr>` blocks via header-split-on-`=` + `collectBlock`); omit `roles` when empty.
  driver — NEW `listRolesRaw()` via `MS_TOOLS.roles` (`// UNVERIFIED` op name, likely `role_operations`/`security`),
  assemble tolerantly, **wrap in try/catch degrading to no `roles` key** so `getModelSnapshot` can't break on the
  unconfirmed op.

Every live-driver key/op that isn't proven by existing code gets a `// UNVERIFIED` comment. Parser (disk) paths are
exact and fully testable now; driver tests assert the assumed-key wiring (real keys await a Windows payload capture).

---

## 6. VERIFICATION GATE (after both builds)

`pnpm -r build` green; `pnpm -r test` green (core + mcp + cli); `pnpm biome check` clean;
`file packages/core/src/modeling/bpa.ts` reports text (NOT data) — Gotcha #1. Then the review wave.
