# ADOPTION MAP — pbi-mcp-ts

**Destination-first** routing table: for every artifact we will build (agent / skill / hook / MCP tool / packaging), *what content to put there* and the *exact source repo file path* to pull it from. This is the actionable replacement for reading the 22 findings/review docs.

**Workflow:** find your destination in the index → read its rows → get the content by either (a) opening `Path in repo` on GitHub, or (b) grepping the local packed copy: `grep -n '<file path="<path>"' docs/superpowers/mining/packed/<xml>` then read that block.

## How to read a row
- **What to put here** — the content chunk to adopt into this destination.
- **Source repo** + **Path in repo** — origin (repo-relative path; opens on GitHub or lives inside the packed XML).
- **Packed XML** — local copy under `docs/superpowers/mining/packed/`.
- **Action** — `adopt` (lift ~as-is, de-hardcode any dataset names) · `adapt` (rework for our TS / PBIR / Claude-Code schema) · `ref` (reference-only — do NOT copy; non-Node, CLI, C#, or foreign config schema).
- **Pri** — `P0` hard-gate/foundation (build first, per the v6 plan's phase order) · `P1` shared-knowledge skill content · `P2` breadth / nice-to-have.
- **Shared with** — the same source also feeds these other destinations (row not duplicated).
- **Deep detail** — the findings file with the fuller extraction.

## Source repos (short → full)
`data-goblin` = data-goblin/power-bi-agentic-development · `ruiromano` = ruiromano/powerbi-agentic-plugins · `skills-for-fabric` = microsoft/skills-for-fabric · `awesome-copilot` = github/awesome-copilot · `claude-plugin-marketplace` = josiahsiegel/claude-plugin-marketplace · `claude-skills` = borghei/Claude-Skills · `agent-skills` = practicalswan/agent-skills · `antigravity` = sickn33/antigravity-awesome-skills · `awesome-llm-apps` = shubhamsaboo/awesome-llm-apps

---

## DESTINATION INDEX
Section = which part of this doc holds the rows (Model / Report / Infra). Build = new artifact vs extend an existing repo file.

### Agents (5)
| Destination | Build | Pri | Section |
|---|---|---|---|
| `data-analyst` | new (carve from pbi-data-architect) | P1 | Infra |
| `model-builder` | new | P0–P1 | Model |
| `model-reviewer` | new (replaces pbi-model-doctor) | P1 | Model |
| `report-builder` | new | P1 | Report |
| `report-reviewer` | new | P1 | Report |

### Shared-knowledge skills (14)
| Destination | Build | Pri | Section |
|---|---|---|---|
| `tmdl-conventions` | new | P0 | Model |
| `dax-patterns` | new | P1 | Model |
| `time-intelligence` | extend `skills/pbi-date-intelligence` | P1 | Model |
| `m-query-patterns` | new | P1 | Model |
| `rls-patterns` | new | P1 | Model |
| `calc-group-patterns` | new | P1 | Model |
| `ai-readiness` | new | P1–P2 | Model |
| `bi-pattern-library` | new | P1 | Report |
| `layout-patterns` | new | P1 | Report |
| `theme-cascade` | new | P1 | Report |
| `kpi-design-rules` | new | P1 | Report |
| `table-design-rules` | new | P1 | Report |
| `svg-dax-patterns` | new | P1 | Report |
| `audience-styles` | new | P1–P2 | Report |

### Pipeline skills (4) + thin CRUD skills (10)
| Destination | Build | Pri | Section |
|---|---|---|---|
| `pbi-build` / `pbi-modify` / `pbi-fix-model` / `pbi-audit` | new | P1 | Infra |
| thin CRUD (`pbi-report/pages/visuals/themes/filters/bookmarks/layout/setup/status/validate`) | new (wrap MCP) | P2 | Infra |

### Hooks (6)
| Destination | Build | Pri | Section |
|---|---|---|---|
| `gate-measure-create` | extend `hooks/scripts/` | P0 | Model (detail) |
| `gate-data-analyst-readonly` | new | P0 | Infra |
| `block-destructive-commands` | new | P0 | Infra |
| `block-secrets-exposure` | new | P0 | Infra |
| `block-pnpm-discipline` | new | P0 | Infra |
| hooks config + kill-switch | new | P1 | Infra |

### MCP tools / BPA engine (6)
| Destination | Build | Pri | Section |
|---|---|---|---|
| BPA engine — semantic rules | extend `packages/core/src/modeling/bpa.ts` | P0–P1 | Model |
| BPA engine — report rules | extend `packages/core/src/modeling/bpa.ts` | P1 | Report |
| `pbi_dax_reference_check` | extend (exists) | P0 | Model |
| `pbi_model_check` | extend (exists) | P0 | Model |
| `pbi_visual_bind` (annotation-aware) | extend `packages/core/src/visual/bind-validator.ts` | P0 | Report |
| `pbi_spec_validate` | new (`packages/mcp/src/server.ts`) | P0 | Infra |
| MCP server design (registerTool/Zod/eval) | extend `packages/mcp/src/server.ts` | P1 | Infra |

### Packaging / authoring conventions (5)
| Destination | Build | Pri | Section |
|---|---|---|---|
| `plugin.json` + `marketplace.json` | extend | P0 | Infra |
| skills catalog/index + index schema | new | P2 | Infra |
| description-craft house-style | convention | P1 | Infra |
| SKILL.md house-style | convention | P1 | Infra |
| agent-frontmatter house-style | convention | P1 | Infra |

---

# Adoption Map — Model / Semantic side

Routing table re-pivoted from `review/01-domain-knowledge-adoption.md` + `review/02-architecture-authoring-adoption.md`.
Every "Path in repo" is grep-verified against `packed/*.xml`. Source-repo short names:
ruiromano = ruiromano/powerbi-agentic-plugins · dg1/dg3/dg4 = data-goblin set · sff = microsoft/skills-for-fabric ·
ac = awesome-copilot-pbi-data · pbm = powerbi-master (claude-plugin-marketplace).
**Action:** adopt (lift, de-hardcode names) · adapt (rework for our TS/TMDL) · ref (reference-only — non-Node/CLI/C#/PS).
**Pri:** P0 = foundation/hard-gate · P1 = shared-knowledge skill core · P2 = breadth/nice-to-have.

---

## tmdl-conventions · skill
**Role:** TMDL grammar, indentation, emission gotchas, partition/relationship/column rules. **Build:** new `skills/tmdl-conventions/`. **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| First-party TMDL baseline (indent=1 tab/level, quoting, `///` desc, file layout, partition templates Import/DirectLake/Calculated) | sff | plugins/fabric-authoring/skills/powerbi-authoring-cli/references/tmdl-authoring-guide.md | skills-for-fabric-1-authoring.xml | adopt | P0 |
| TMDL advanced features (calc groups, RLS roles, perspectives, cultures, KPIs in TMDL) | sff | plugins/fabric-authoring/skills/powerbi-authoring-cli/references/tmdl-advanced-features-guide.md | skills-for-fabric-1-authoring.xml | adopt | P0 |
| Semantic-model property guide (column/measure/table prop semantics) | sff | plugins/fabric-authoring/skills/powerbi-authoring-cli/references/semantic-model-properties-guide.md | skills-for-fabric-1-authoring.xml | adopt | P1 |
| Indentation-depth table + enum value sets (dataType/crossFilter/summarizeBy…) | dg1 | plugins/pbip/skills/tmdl/references/object-properties.md | dg1-pbip.xml | adopt | P0 |
| Column rules (dataType req, sourceColumn, summarizeBy none, isAvailableInMdx, dataCategory, sortByColumn) | dg1 | plugins/pbip/skills/tmdl/references/column-properties.md | dg1-pbip.xml | adopt | P0 |
| TMDL file examples (database/model/relationships/table file shapes) | dg1 | plugins/pbip/skills/tmdl/references/tmdl-file-examples.md | dg1-pbip.xml | adopt | P1 |
| TMDL SKILL doctrine (tab-only, TmdlFormatException, no // comments) | dg1 | plugins/pbip/skills/tmdl/SKILL.md | dg1-pbip.xml | adopt | P1 |
| Grammar→TOM keyword map + syntax reference | pbm | plugins/powerbi-master/skills/tmdl-mastery/references/tmdl-syntax-reference.md | claude-plugin-marketplace.xml | adopt | P1 |
| TMDL examples cookbook (worked table/measure/calc-group emission) | pbm | plugins/powerbi-master/skills/tmdl-mastery/references/tmdl-examples-cookbook.md | claude-plugin-marketplace.xml | adapt | P2 |
| Emission gotchas (no hand-written lineageTag, measures-before-columns, triple-backtick multiline DAX, no dataType on measure, leave PBI_* annotations) | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/references/TMDL.md | powerbi-agentic-plugins.xml | adopt | P0 |
| Modeling/relationship guidelines (FK many-side, oneDirection default, integer keys, isKey on dim PK, no composite keys) | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/references/modeling-guidelines.md | powerbi-agentic-plugins.xml | adopt | P0 |
| Naming rules (no Fact/Dim prefixes, dim main col = dim name, `[m]`/`[m (ly)]`/`[m (ytd)]` variants) | dg3 | plugins/semantic-models/skills/standardize-naming-conventions/references/naming-rules.md | dg3-semantic-models.xml | adopt | P1 |
| `bim-to-tmdl` TOM/CLI conversion | dg1 | plugins/pbip/skills/tmdl/references/bim-to-tmdl.md | dg1-pbip.xml | ref | P2 |

**Shared with:** rls-patterns (tmdl-advanced-features-guide role syntax), calc-group-patterns (advanced-features + cookbook), BPA (object-properties enums = valid-value sets), m-query-patterns (partition templates). **Deep detail:** dg1-pbip.md (§ TMDL + object-properties), skills-for-fabric-authoring.md, claude-plugin-marketplace-pbi.md, powerbi-agentic-plugins.md.

---

## dax-patterns · skill
**Role:** DAX001–021 anti-pattern→rewrite catalog, FE/SE engine model, valid-query + authoring rules, UDFs, advanced template library. **Build:** new `skills/dax-patterns/`. **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| DAX001–021 perf catalog + FE/SE engine model + fusion/callback "why" (the spine) | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/references/dax-performance-optimization.md | powerbi-agentic-plugins.xml | adopt | P0 |
| Valid-query rules (// not --, qualify cols not measures, ORDER BY, CALCULATE boolean-filter limits, SUMMARIZECOLUMNS vs SUMMARIZE) | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/references/dax-query-guidelines.md | powerbi-agentic-plugins.xml | adopt | P0 |
| DAX UDF guidelines (param Val vs Expr; PriorYearValue Expr pattern) | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/references/dax-udf-functions-guidelines.md | powerbi-agentic-plugins.xml | adopt | P2 |
| DAX001–021 verbatim framework (same upstream — single-impl, cross-check only) | dg3 | plugins/semantic-models/skills/dax/references/dax-performance-optimization.md | dg3-semantic-models.xml | ref | P0 |
| Decision-Guide + named patterns + circular-dep gotcha (SUMMARIZECOLUMNS-in-CALCULATETABLE) | dg3 | plugins/semantic-models/skills/dax/references/dax-patterns.md | dg3-semantic-models.xml | adopt | P1 |
| Engine internals (FE/SE, VertiPaq, callbacks) supplementary | dg3 | plugins/semantic-models/skills/dax/references/engine-internals.md | dg3-semantic-models.xml | ref | P2 |
| Core authoring rules (VAR `_` prefix, avoid IFERROR, TREATAS over INTERSECT, single CALCULATE) | dg3 | plugins/semantic-models/skills/dax/SKILL.md | dg3-semantic-models.xml | adopt | P1 |
| Advanced template lib (ABC/Pareto, RANKX, Top-N-ties, dynamic-measure-selector, parent-child PATH, semi-additive) | ac | skills/powerbi-modeling/references/MEASURES-DAX.md | awesome-copilot-pbi-data.xml | adapt | P1 |
| DAX best-practices checklist (de-hardcode AdventureWorks names) | ac | instructions/power-bi-dax-best-practices.instructions.md | awesome-copilot-pbi-data.xml | adapt | P2 |
| Advanced DAX patterns (WINDOW/OFFSET/RANK/ROWNUMBER, visual calc, dynamic format strings) | pbm | plugins/powerbi-master/skills/dax-mastery/references/dax-patterns-advanced.md | claude-plugin-marketplace.xml | adapt | P1 |
| DAX function categories reference | pbm | plugins/powerbi-master/skills/dax-mastery/references/dax-function-categories.md | claude-plugin-marketplace.xml | ref | P2 |

**Shared with:** BPA (DAX001/002/004 + valid-query rules → predicates), time-intelligence (DAX019/020 lift-TI + TI detector), gate-measure-create (qualify-cols / valid-query rules). **Deep detail:** powerbi-agentic-plugins.md (DAX framework), dg3-semantic-models.md, awesome-copilot-pbi-data.md, claude-plugin-marketplace-pbi.md.

---

## time-intelligence · skill (EXTEND existing `pbi-date-intelligence`)
**Role:** date-table correctness rule, TI-function detector, lift-TI-to-outer-CALCULATE perf, target/comparison templates. **Build:** extend `skills/pbi-date-intelligence/`. **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Date-table correctness rule (dataCategory Time, continuous daily, full span, single-col rel → else TI returns BLANK) | dg3 | plugins/semantic-models/skills/review-semantic-model/references/ai-readiness.md | dg3-semantic-models.xml | adopt | P1 |
| MDL005/006 (pre-compute period-comparison cols; row-based TI table for fusion) | dg3 | plugins/semantic-models/skills/dax/references/model-optimization.md | dg3-semantic-models.xml | adopt | P1 |
| ~35-func TI detector regex + DATESINPERIOD off-by-one + "last year from MAX(fact date)" | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/references/dax-query-guidelines.md | powerbi-agentic-plugins.xml | adopt | P0 |
| DAX019/020 keep base measures TI-free, apply TI in outer CALCULATE | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/references/dax-performance-optimization.md | powerbi-agentic-plugins.xml | adopt | P1 |
| Calendar / column-group date-dim guidance (calendar table scaffold) | dg4 | plugins/pbi-desktop/skills/connect-pbid/references/calendar-column-groups.md | dg4-te-fabric-desktop-root.xml | adapt | P2 |
| Week-based time-intelligence (niche) | pbm | plugins/powerbi-master/skills/dax-mastery/references/dax-patterns-advanced.md | claude-plugin-marketplace.xml | ref | P2 |

**Shared with:** dax-patterns (TI detector + DAX019/020 — primary home is dax-patterns), calc-group-patterns (TI item bodies = single canonical copy), BPA (TI-detector for DQ-TI rule), ai-readiness (date-table correctness via dg3 ai-readiness.md). **Deep detail:** dg3-semantic-models.md (date-table, MDL005/006), powerbi-agentic-plugins.md (detector, off-by-one).

---

## m-query-patterns · skill
**Role:** query-folding catalog (folds/breaks/sometimes), safe write order, section-document structure, incremental-refresh + calendar recipes. **Build:** new `skills/m-query-patterns/`. **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Folding catalog (folds→SQL / breaks-folding full list / sometimes-folds) + safe write order (the spine) | dg3 | plugins/semantic-models/skills/power-query/references/best-practices.md | dg3-semantic-models.xml | adopt | P0 |
| PQ SKILL doctrine (type mappings, naming, avoid silent try…otherwise) | dg3 | plugins/semantic-models/skills/power-query/SKILL.md | dg3-semantic-models.xml | adopt | P1 |
| M validation concept (XMLA save validates syntax, misses folding/columns) | dg3 | plugins/semantic-models/skills/power-query/references/validation.md | dg3-semantic-models.xml | ref | P2 |
| Section-document structure + connection-kind↔M-function map + query-classification heuristic | sff | plugins/fabric-authoring/common/DATAFLOWS-AUTHORING-CORE.md | skills-for-fabric-1-authoring.xml | adopt | P1 |
| M cookbook recipes (calendar generator, REST pagination, incremental-refresh M) | pbm | plugins/powerbi-master/skills/power-query-m/references/m-patterns-cookbook.md | claude-plugin-marketplace.xml | adapt | P1 |
| Incremental-refresh M folding pattern (RangeStart/RangeEnd) — de-hardcode names | ac | skills/powerbi-modeling/references/PERFORMANCE.md | awesome-copilot-pbi-data.xml | adapt | P2 |

**Shared with:** BPA (PQ anti-pattern rules — see BPA M-scope row), tmdl-conventions (Import partition `source = let…in…` templates). **Deep detail:** dg3-semantic-models.md (§ folding), skills-for-fabric-authoring.md (Dataflows), claude-plugin-marketplace-pbi.md (M cookbook), awesome-copilot-pbi-data.md.

---

## rls-patterns · skill
**Role:** static vs dynamic RLS, filter-expression library (placeholders), default-deny template, TMDL role-file syntax, OLS. **Build:** new `skills/rls-patterns/`. **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Best-organized RLS skill (static/dynamic, 4 patterns, security-table, common-mistakes, OLS, checklist) — de-hardcode names | ac | skills/powerbi-modeling/references/RLS.md | awesome-copilot-pbi-data.xml | adopt | P1 |
| Advanced RLS (CUSTOMDATA, time-based, least-privilege, default-deny) | ac | instructions/power-bi-security-rls-best-practices.instructions.md | awesome-copilot-pbi-data.xml | adopt | P1 |
| RLS FilterExpression library + best-practices (filter dims, additive roles, USERPRINCIPALNAME) — DAX knowledge only | dg4 | plugins/tabular-editor/skills/c-sharp-scripting/object-types/roles.md | dg4-te-fabric-desktop-root.xml | adapt | P1 |
| Roles examples README (pattern catalog) — `.csx` body is ref-only | dg4 | plugins/tabular-editor/skills/c-sharp-scripting/examples/roles/README.md | dg4-te-fabric-desktop-root.xml | adapt | P2 |
| TMDL role-file emission (`role`/`modelPermission`/`tablePermission`/`columnPermission`), membership-not-in-TMDL | sff | plugins/fabric-authoring/skills/powerbi-authoring-cli/references/tmdl-advanced-features-guide.md | skills-for-fabric-1-authoring.xml | adopt | P1 |
| `configure-rls.csx` / `configure-ols.csx` (C# CRUD) | dg4 | plugins/tabular-editor/skills/c-sharp-scripting/examples/roles/configure-rls.csx | dg4-te-fabric-desktop-root.xml | ref | P2 |

**Shared with:** BPA (RLS rules: LIMIT_RLS_LOGIC, CHECK_IF_DYNAMIC_RLS, AVOID_M2M…DYNAMIC_RLS, AVOID_USERELATIONSHIP_AND_RLS), tmdl-conventions (role-file syntax). **Deep detail:** awesome-copilot-pbi-data.md (§ RLS), dg4-te-fabric-hooks-root.md (§15 RLS library), skills-for-fabric-authoring.md.

---

## calc-group-patterns · skill
**Role:** calc-group concepts, TI/currency item DAX library, precedence table, TMDL `calculationGroup`/`formatStringDefinition`/Ordinal emission, field-parameter shape. **Build:** new `skills/calc-group-patterns/`. **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Concepts + TI/currency item DAX library + precedence + best-practices (SELECTEDMEASURE, Current item) — DAX knowledge only | dg4 | plugins/tabular-editor/skills/c-sharp-scripting/object-types/calculation-groups.md | dg4-te-fabric-desktop-root.xml | adapt | P1 |
| TI calc-item bodies (YTD/QTD/MTD/PY/YoY%) — `'Date'[Date]` placeholders | dg4 | plugins/tabular-editor/skills/c-sharp-scripting/examples/calculation-groups/time_intelligence.csx | dg4-te-fabric-desktop-root.xml | adapt | P1 |
| Currency-conversion item (SELECTEDMEASURE * SELECTEDVALUE rate) | dg4 | plugins/tabular-editor/skills/c-sharp-scripting/examples/calculation-groups/currency_conversion.csx | dg4-te-fabric-desktop-root.xml | adapt | P2 |
| TMDL emission shape (calculationGroup keyword, calculationItem, formatStringDefinition, Ordinal, partition=calculationGroup) | sff | plugins/fabric-authoring/skills/powerbi-authoring-cli/references/tmdl-advanced-features-guide.md | skills-for-fabric-1-authoring.xml | adopt | P1 |
| Full calc-group + field-parameter cookbook example (ParameterMetadata annotation) | pbm | plugins/powerbi-master/skills/tmdl-mastery/references/tmdl-examples-cookbook.md | claude-plugin-marketplace.xml | adapt | P1 |
| Time-intel item TI bodies (cross-check, de-hardcode) | ac | skills/powerbi-modeling/references/MEASURES-DAX.md | awesome-copilot-pbi-data.xml | ref | P2 |

**Shared with:** time-intelligence (TI item bodies — single canonical copy), tmdl-conventions (advanced-features emission). **Deep detail:** dg4-te-fabric-hooks-root.md (§14 calc-group), skills-for-fabric-authoring.md, claude-plugin-marketplace-pbi.md.

---

## ai-readiness · skill
**Role:** make models LLM/Q&A-friendly (explicit measures, human names, synonyms, disambiguating descriptions). **NOTE:** distinct from awesome-copilot's repo-maturity "ai-readiness" (DISCARD that). **Build:** new `skills/ai-readiness/`. **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| AI-readiness checklist (star schema, explicit measures, human names, synonyms, disambiguating descriptions, no dup field names) + valid-but-AI-hard nuance + pragmatic guardrails (the spine) | dg3 | plugins/semantic-models/skills/review-semantic-model/references/ai-readiness.md | dg3-semantic-models.xml | adopt | P1 |
| review-semantic-model SKILL framing (analyze-first, audit posture) | dg3 | plugins/semantic-models/skills/review-semantic-model/SKILL.md | dg3-semantic-models.xml | adopt | P2 |
| PBIR `verifiedAnswer` annotation + stable-identifier annotations (Copilot trigger) | dg1 | plugins/pbip/skills/pbir-format/references/annotations.md | dg1-pbip.xml | adapt | P2 |
| awesome-copilot "ai-readiness" (AgentRC repo maturity — WRONG domain) | ac | agents/ai-readiness-reporter.agent.md | awesome-copilot-pbi-data.xml | ref | P2 |

**Shared with:** model-reviewer (checklist = reviewer checks), time-intelligence (date-table correctness lives in same dg3 file), naming (human-readable-names overlaps tmdl-conventions naming). **Deep detail:** dg3-semantic-models.md (§10 ai-readiness), dg1-pbip.md (§ annotations).

---

## BPA · engine (EXTEND `packages/core/src/modeling/bpa.ts`, ~15 rules → ~40)
**Role:** static TS predicates over parsed TMDL model graph; semantic-model rules only (report BPA = report side). **Build:** extend `packages/core/src/modeling/bpa.ts`. **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Canonical MS-AS rule set (~50, authoritative) = baseline; keep our IDs, add stable cross-ref IDs | dg4 | plugins/tabular-editor/skills/bpa-rules/examples/microsoft-analysis-services-rules.json | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| Comprehensive rule set (~30 — cleaner Governance/Layout/error-prevention) | dg4 | plugins/tabular-editor/skills/bpa-rules/examples/comprehensive-rules.json | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| Power-Query operations rules (M-scope: distinct/dedupe/join/buffer + MINIMIZE_POWER_QUERY_TRANSFORMATIONS) | dg4 | plugins/tabular-editor/skills/bpa-rules/examples/power-query-operations-rules.json | dg4-te-fabric-desktop-root.xml | adapt | P1 |
| 60-rule semantic-model BPA (same lineage — dedupe by intent/ID) | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/scripts/bpa-rules-semanticmodel.json | powerbi-agentic-plugins.xml | adapt | P0 |
| Consolidated ID/severity checklist + additions (COALESCE, high-card-datetime, no-FORMAT-in-numeric-measures) | pbm | plugins/powerbi-master/skills/validation-testing/references/bpa-rules-reference.md | claude-plugin-marketplace.xml | adapt | P1 |
| dg3 auditor 28 checks + naming-regex set (snake/Camel/UPPER/tech-prefix) — fold into same list | dg3 | plugins/semantic-models/skills/standardize-naming-conventions/references/naming-rules.md | dg3-semantic-models.xml | adapt | P1 |
| Rule JSON schema + I/O fields (ID/Name/Category/Severity/Scope/FixExpression/CompatibilityLevel/Source) | dg4 | plugins/tabular-editor/skills/bpa-rules/references/rule-schema.md | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| Draft-07 JSON Schema for rule files | dg4 | plugins/tabular-editor/skills/bpa-rules/schema/bparules-schema.json | dg4-te-fabric-desktop-root.xml | adapt | P1 |
| Expression-language capability spec (IsHidden/ReferencedBy/UsedInRelationships/Tokenize) — capability list only | dg4 | plugins/tabular-editor/skills/bpa-rules/references/expression-syntax.md | dg4-te-fabric-desktop-root.xml | ref | P1 |
| BPA quick-reference (severity 1-3, CompatibilityLevel ladder) | dg4 | plugins/tabular-editor/skills/bpa-rules/references/quick-reference.md | dg4-te-fabric-desktop-root.xml | adapt | P1 |
| Model-level BPA annotations (BestPracticeAnalyzer / _IgnoreRules / _Ignore) read/honor | dg4 | plugins/tabular-editor/skills/bpa-rules/references/tmdl-annotations.md | dg4-te-fabric-desktop-root.xml | adapt | P1 |
| Annotated-model TMDL example (ignore-rules embedding) | dg4 | plugins/tabular-editor/skills/bpa-rules/examples/model-with-bpa-annotations.tmdl | dg4-te-fabric-desktop-root.xml | adapt | P2 |
| DISCARD: hardcodes table names + invalid severities 4/5 (anti-pattern teaching only) | dg4 | plugins/tabular-editor/skills/bpa-rules/examples/course-3-business-case-bpa-rules.json | dg4-te-fabric-desktop-root.xml | ref | P2 |
| STAR-SCHEMA / PERFORMANCE checklists (modeling rule intents) — de-hardcode names | ac | skills/powerbi-modeling/references/STAR-SCHEMA.md | awesome-copilot-pbi-data.xml | ref | P2 |

**Buckets (per decision):** A = statically-checkable NOW (priority backlog: DIVIDE w/ DAX018 exception, IFERROR, TREATAS-not-INTERSECT, dup-measures, FK same-datatype, inactive-rels, M2M-single-direction, date-table-marked, unused cols/measures, naming-regex, format-string, hide-FKs, summarizeBy-none). B = report-side (NOT here — report destination). C = defer (Vertipaq/trace stats: high-cardinality, partitioning, RI-violations, split-datetime).
**Conflicts:** DIVIDE rule must encode DAX018 (don't flag `/` inside guarded iterator). DISCARD course-3 set.
**Shared with:** rls-patterns (RLS rule intents), m-query-patterns (PQ rules), time-intelligence (TI detector), dax-patterns (DAX001/002/004), pbi_model_check (runs this engine). **Deep detail:** dg4-te-fabric-hooks-root.md (§1-6), powerbi-agentic-plugins.md (BPA json), claude-plugin-marketplace-pbi.md (§ BPA catalog), dg3-semantic-models.md (§9 auditor).

---

## pbi_dax_reference_check · mcp-tool (exists)
**Role:** validate `'Table'[Col]` + unqualified `[Ref]` in DAX against resolved model index; "Did you mean…?" fuzzy. **Build:** extend `packages/core/src/modeling/dax-reference-check.ts` + MCP `pbi_dax_reference_check`. **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Valid-query qualification rules (define→qualify `'T'[M]`, use→unqualified `[M]`; always-qualify columns) = the check's ruleset | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/references/dax-query-guidelines.md | powerbi-agentic-plugins.xml | adopt | P0 |
| `cmd_validate_dax` blueprint (extract refs, validate vs tables/cols/measures, 3-pass fuzzy, exclude DEFINE MEASURE targets + string aliases) | dg4 | plugins/pbi-desktop/hooks/pbi-hooks.sh | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| Fix-broken-field-references technique (rebinding, suggestion UX) | dg1 | plugins/pbip/skills/pbir-format/references/how-to/fix-broken-field-references.md | dg1-pbip.xml | adapt | P1 |
| INFO.DEPENDENCIES forward/reverse impact-analysis (what breaks if a measure changes) | sff | plugins/fabric-authoring/skills/powerbi-authoring-cli/SKILL.md | skills-for-fabric-1-authoring.xml | ref | P2 |

**Shared with:** gate-measure-create (same DAX-reference validation logic + grounding invariant — single shared module), dax-patterns (qualification rules). **Deep detail:** powerbi-agentic-plugins.md (query guide), dg4-te-fabric-hooks-root.md (pbi-desktop validate-dax), 02-architecture §5.

---

## pbi_model_check · mcp-tool (exists)
**Role:** run BPA engine + reference check over the model index; return severity-bucketed findings. **Build:** extend MCP `pbi_model_check` (wraps BPA engine). **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| (rule content = BPA engine rows above) Four-layer validation taxonomy framing + "what validation CANNOT catch" | pbm | plugins/powerbi-master/skills/validation-testing/references/tmdl-validation-recipes.md | claude-plugin-marketplace.xml | adapt | P1 |
| TS MCP tool shape (registerTool, Zod .strict, annotations readOnlyHint, response_format, pagination, CHARACTER_LIMIT) | ac | skills/powerbi-modeling/references/PERFORMANCE.md | awesome-copilot-pbi-data.xml | ref | P1 |
| Typed-immutable model-index snapshot threaded to tool + gate (retrieve once, use everywhere) | — | (see findings: awesome-llm-apps-rag-eval.md / 02-architecture §6) | — | adapt | P1 |

**Shared with:** BPA engine (the rule list it executes), model-reviewer (consumes its output). **Deep detail:** claude-plugin-marketplace-pbi.md (validation taxonomy), agent-skills-pbi-meta.md (mcp-builder TS guide), 02-architecture §6.

---

## gate-measure-create · hook (PreToolUse, exists)
**Role:** before a measure-create MCP tool runs, require metadata (DisplayFolder/Description/FormatString) + validate DAX refs against the model index; else stderr list + exit 2. **Build:** extend `hooks/scripts/gate-measure-create.mjs` + `hooks/hooks.json`. **Loads skills:** —

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| `cmd_validate_measure` + `cmd_validate_dax` blueprint (required-metadata check; DAX-ref validation; "Did you mean"; exit 2) | dg4 | plugins/pbi-desktop/hooks/pbi-hooks.sh | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| Hook wiring (PreToolUse matcher, config kill-switch, fail-open posture) | dg4 | plugins/pbi-desktop/hooks/hooks.json | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| Per-check booleans + master `all_hooks_enabled` kill-switch | dg4 | plugins/pbi-desktop/hooks/config.yaml | dg4-te-fabric-desktop-root.xml | adapt | P1 |
| Defensive-degradation + exit-codes (read stdin once, exit-0 on env failure, exit-2 only on confirmed violation, 10s timeout) | dg1 | plugins/pbip/hooks/validate-tmdl.sh | dg1-pbip.xml | adapt | P0 |
| pbip-validator safety-fixing + deterministic-first doctrine | dg1 | plugins/pbip/agents/pbip-validator.agent.md | dg1-pbip.xml | adapt | P1 |
| Required measure metadata source-of-truth (`formatString` + `///` desc; no dataType on measure) | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/references/TMDL.md | powerbi-agentic-plugins.xml | adopt | P0 |
| PowerShell `check-referential-integrity.ps1` / `snapshot-model.ps1` (reimplement via TMDL parser) | dg4 | plugins/pbi-desktop/hooks/check-referential-integrity.ps1 | dg4-te-fabric-desktop-root.xml | ref | P2 |

**Shared with:** pbi_dax_reference_check (shares the DAX-reference validation module + grounding invariant), tmdl-conventions (measure-metadata rules). **Deep detail:** dg4-te-fabric-hooks-root.md (pbi-desktop hooks), dg1-pbip.md (validation hooks), 02-architecture §5.

---

## model-builder · agent
**Role:** implementer (model: sonnet) — creates DAX measures + exports TMDL; tool-first, self-validate, report. **Build:** new `agents/model-builder.md` (closest existing: `pbi-data-architect.md`). **Loads skills:** tmdl-conventions, dax-patterns, time-intelligence, m-query-patterns, rls-patterns, calc-group-patterns, ai-readiness.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| developer agent (implements, model Sonnet, glob-scoped MCP grants, EARS spec consume) | ruiromano | plugins/powerbi/agents/powerbi-developer.agent.md | powerbi-agentic-plugins.xml | adapt | P1 |
| `delegates_to` + Must/Prefer/Avoid frontmatter triad + analyze-first | sff | plugins/fabric-authoring/agents/FabricDataEngineer.agent.md | skills-for-fabric-1-authoring.xml | adapt | P1 |
| Skill-Activation table (Topic→Skill) + lean-orchestrator limit (no domain dump) — port to TS-agent shape | pbm | plugins/powerbi-master/agents/powerbi-expert.md | claude-plugin-marketplace.xml | adapt | P1 |
| Modeling guidelines (measures over calc-cols; create rels before dependent measures) | ruiromano | plugins/powerbi/skills/powerbi-semantic-model-authoring/references/modeling-guidelines.md | powerbi-agentic-plugins.xml | adopt | P1 |
| INFO.* discovery discipline (scope-estimate, progressive INFO.VIEW.*, TOPN(0) probe) | sff | plugins/fabric-authoring/skills/powerbi-authoring-cli/SKILL.md | skills-for-fabric-1-authoring.xml | adapt | P1 |

**Shared with:** model-reviewer (Must/Prefer/Avoid guardrails, frontmatter house-shape), all model skills (delegates to them). **Deep detail:** 02-architecture §1 + §4, powerbi-agentic-plugins-structure.md, skills-for-fabric-catalog.md.

---

## model-reviewer · agent (read-only)
**Role:** reviewer (model: sonnet, tools Read/Grep/Glob[+Bash]) — grain/relationships/BPA; deterministic-first, don't-trust-the-report, severity-bucketed output. **Build:** new `agents/model-reviewer.md` (closest existing: `pbi-model-doctor.md`). **Loads skills:** ai-readiness, dax-patterns, tmdl-conventions, time-intelligence, rls-patterns.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| semantic-model-auditor (28 severity-categorized checks + audit-report template) | dg3 | plugins/semantic-models/skills/review-semantic-model/SKILL.md | dg3-semantic-models.xml | adapt | P1 |
| AI-hard-but-valid nuance + AI-readiness checks (disconnected/M2M/inactive = informational) | dg3 | plugins/semantic-models/skills/review-semantic-model/references/ai-readiness.md | dg3-semantic-models.xml | adopt | P1 |
| Deterministic-first / LLM-fallback + safety-fixing rules + edge-case catalog | dg1 | plugins/pbip/agents/pbip-validator.agent.md | dg1-pbip.xml | adapt | P0 |
| BPA-expression reviewer agent design (read-only, Issue→Fix→Explain→Test output) | dg4 | plugins/tabular-editor/agents/bpa-expression-helper.agent.md | dg4-te-fabric-desktop-root.xml | adapt | P1 |
| Four-layer validation taxonomy (syntax/schema/BPA/lineage) + "what validation CANNOT catch" | pbm | plugins/powerbi-master/commands/pbi-model-review.md | claude-plugin-marketplace.xml | adapt | P1 |
| Architect agent (design-only review framing, model Opus option) | ruiromano | plugins/powerbi/agents/powerbi-architect.agent.md | powerbi-agentic-plugins.xml | adapt | P2 |
| Model-design-review checklists (Quick-Assessment vs Comprehensive tiers) — de-hardcode names | ac | skills/powerbi-modeling/references/STAR-SCHEMA.md | awesome-copilot-pbi-data.xml | ref | P2 |

**Shared with:** model-builder (frontmatter house-shape, Must/Prefer/Avoid), BPA engine + pbi_model_check (its check catalog = the engine's rules), ai-readiness skill (shared dg3 file). **Deep detail:** dg3-semantic-models.md (§9 auditor), dg1-pbip.md (§ pbip-validator), claude-plugin-marketplace-pbi.md (taxonomy), 02-architecture §4.

---

# Adoption Map — Report / Visual side

Routing table re-pivoting the backbone decisions (`review/01-domain-knowledge-adoption.md`, `review/02-architecture-authoring-adoption.md`) into per-destination, grep-verified paths. All `<file path>` confirmed against `docs/superpowers/mining/packed/*.xml`. Every name in sources is a placeholder — de-hardcode on adopt. **Action:** adopt (lift ~as-is, de-hardcode) · adapt (rework for TS/PBIR) · ref (reference-only; Python/R = ref). **Pri:** P0 hard-gate/foundation · P1 shared-skill core · P2 breadth.

---

## bi-pattern-library · skill
**Role:** Chart selection + named analytical patterns + BI architecture context. **Build:** new `skills/<name>/SKILL.md`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Chart-selection matrix (question→visual, avoid-list, axis/sort rules) | data-goblin | plugins/reports/skills/pbi-report-design/references/visual-colors.md ; plugins/reports/skills/pbi-report-design/SKILL.md | dg2-reports.xml | adopt | P1 |
| Chart-by-relationship + visual-perf ranking | awesome-copilot | instructions/power-bi-report-design-best-practices.instructions.md ; skills/power-bi-report-design-consultation/SKILL.md | awesome-copilot-pbi-data.xml | adapt | P1 |
| Named patterns: funnel/cohort/root-cause + paired-metrics + Simpson's anti-pattern | claude-skills (borghei) | marketing/campaign-analytics/references/funnel-optimization-framework.md ; data-analytics/business-intelligence/SKILL.md | claude-skills-borghei.xml | adopt | P1 |
| ICE prioritization + hypothesis framing for pattern selection | claude-skills (borghei) | product-team/ab-test-setup/SKILL.md | claude-skills-borghei.xml | adopt | P2 |
| Architectural slice: medallion Gold→Direct Lake, M2M "optimized hybrid" taxonomy | data-goblin / (see findings: dg3) | (see findings: dg3-semantic-models.md — skills-for-fabric medallion) | — | ref | P2 |
| Custom-visual routing (Deneb=Vega interactive; SVG=inline; Python/R=non-Node) | data-goblin | plugins/reports/skills/deneb-visuals/SKILL.md ; plugins/reports/skills/svg-visuals/SKILL.md | dg2-reports.xml | adapt | P2 |
| Deneb/Vega spec library (15+ specs) — reference only, lives in report-builder | data-goblin | plugins/reports/skills/deneb-visuals/references/vega-lite-patterns.md ; plugins/reports/skills/deneb-visuals/references/vega-patterns.md ; plugins/reports/skills/deneb-visuals/examples/spec/ | dg2-reports.xml | ref | P2 |
| Department-KPI menus (suggestion library only, never coupled) | antigravity | plugins/antigravity-bundle-business-analyst/skills/startup-metrics-framework/SKILL.md | antigravity-awesome-skills.xml | ref | P2 |

**Shared with:** kpi-design-rules (target/funnel patterns), audience-styles (maturity ladders), svg-dax-patterns + report-builder (Deneb/custom routing). **Deep detail:** findings/dg2-reports.md, findings/claude-skills-data-analytics.md, findings/antigravity-bi-bundles.md.

---

## layout-patterns · skill
**Role:** Page grid, arithmetic spacing, page/visual size tables, default templates. **Build:** new `skills/<name>/SKILL.md` (relates to existing `skills/pbi-layout`).

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| 3-30-300 detail gradient + zone bands (1280×720) | data-goblin | plugins/reports/skills/pbi-report-design/references/layout-guidelines.md | dg2-reports.xml | adopt | P1 |
| Arithmetic spacing algorithm (content_width/gaps/visual_width) + column-alignment check | data-goblin | plugins/reports/skills/pbi-report-design/references/layout-guidelines.md | dg2-reports.xml | adopt | P1 |
| Page + visual size tables; "query page dims first, set w/h before x/y" | data-goblin | plugins/reports/skills/pbir-cli/references/layout.md ; plugins/reports/skills/pbi-report-design/references/layout-guidelines.md | dg2-reports.xml | adopt | P1 |
| Default layout templates (KPI-row+trend+table etc.) + time-granularity inference | data-goblin | plugins/reports/skills/create-pbi-report/references/layout-example.md ; plugins/reports/skills/create-pbi-report/SKILL.md | dg2-reports.xml | adopt | P1 |
| Page hygiene: max 2-3 slicers, title required, no overlap, ≤12-15 visuals | data-goblin | plugins/reports/skills/pbir-cli/important/MENTAL-MODEL.md ; plugins/pbip/skills/pbir-format/important/MENTAL-MODEL.md | dg2-reports.xml ; dg1-pbip.xml | adopt | P1 |
| Visual-design theory: proximity tiers, 8px grid, F/Z scan, 60-30-10 (translate px→PBI) | agent-skills | canvas-design/references/design-principles.md ; canvas-design/SKILL.md | agent-skills.xml | adapt | P2 |
| 5-8 ideal vs 15 ceiling (audience-dependent) | awesome-copilot | instructions/power-bi-report-design-best-practices.instructions.md | awesome-copilot-pbi-data.xml | adopt | P2 |

**Shared with:** audience-styles (visuals/page by audience), report-builder (templates+spacing as auto-layout), report-reviewer (spacing/gradient checks). **Deep detail:** findings/dg2-reports.md, findings/agent-skills-design-breadth.md.

---

## theme-cascade · skill
**Role:** Theme JSON: 4-level cascade, key table, textClasses, container-name gotchas, compliance audit. **Build:** new `skills/<name>/SKILL.md` (relates to existing `skills/pbi-themes`).

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| 4-level cascade (L1 default→L2 `*` wildcard→L3 visual-type→L4 instance); objects/visualContainerObjects→same theme section | data-goblin | plugins/reports/skills/modifying-theme-json/SKILL.md ; plugins/reports/skills/modifying-theme-json/references/theme-authoring.md | dg2-reports.xml | adopt | P1 |
| Theme top-level keys (dataColors, good/bad/neutral flat root, gradients, textClasses) | data-goblin | plugins/reports/skills/modifying-theme-json/references/theme-authoring.md | dg2-reports.xml | adopt | P1 |
| textClasses sizes + the plain-hex (NOT `{solid:{color}}`) wrapper gotcha | data-goblin | plugins/reports/skills/modifying-theme-json/references/theme-authoring.md | dg2-reports.xml | adopt | P1 |
| Container-name gotchas (kpi `trendline`, card `labels.color`, tableEx `backColor`, `pivotTable`, slicer `textSize`) | data-goblin | plugins/reports/skills/modifying-theme-json/examples/visualTypes/kpi.md ; .../visualTypes/card.md ; .../visualTypes/cardVisual.md ; .../visualTypes/tableEx.md ; .../visualTypes/pivotTable.md ; .../visualTypes/slicer.md ; .../visualTypes/multiRowCard.md | dg2-reports.xml | adopt | P1 |
| Sentiment tokens (good/bad/neutral/minColor/maxColor; `midColor` invalid in ext. measures); accessible teal/orange defaults | data-goblin | plugins/reports/skills/modifying-theme-json/references/visual-type-overrides.md ; plugins/reports/skills/pbi-report-design/references/visual-colors.md | dg2-reports.xml | adopt | P0 |
| Compliance audit (Stale/Conflicting/Exception/CF classification + promote-or-remove tree); never read full 75KB theme | data-goblin | plugins/reports/skills/modifying-theme-json/references/theme-compliance.md ; plugins/reports/skills/modifying-theme-json/references/promoting-formatting.md ; plugins/reports/skills/modifying-theme-json/references/serialize-build.md | dg2-reports.xml | adopt | P1 |
| Color/type theory: 60-30-10, harmony, finance red caution, CVD needs icon+label, token-doc schema (principles, NOT fixed hex) | agent-skills | canvas-design/references/color-psychology.md ; canvas-design/examples/design-philosophy-example.md | agent-skills.xml | adapt | P2 |
| Base theme examples (structure reference; de-brand) | data-goblin | plugins/reports/skills/modifying-theme-json/examples/Fluent2-CY26SU03.json ; plugins/reports/skills/modifying-theme-json/examples/DataGoblins2021.json | dg2-reports.xml | ref | P2 |
| Apply/copy theme mechanics (PBIR RegisteredResource) | data-goblin | plugins/reports/skills/modifying-theme-json/references/applying-themes.md ; plugins/reports/skills/modifying-theme-json/references/copying-themes.md ; plugins/pbip/skills/pbir-format/references/theme.md | dg2-reports.xml ; dg1-pbip.xml | adapt | P2 |

**Shared with:** kpi-design-rules + table-design-rules + svg-dax-patterns (sentiment-token CF coordination), report-reviewer (stale-override/compliance audit), report-builder (visual.json holds only bindings/position/CF). **Deep detail:** findings/dg2-reports.md, findings/agent-skills-design-breadth.md.

---

## kpi-design-rules · skill
**Role:** KPI card doctrine, display-unit algorithm, target DAX, KPI definition contract + threshold lint. **Build:** new `skills/<name>/SKILL.md`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Card doctrine (good/bad + better/worse mandatory; max 5/page; actionable-vs-vanity; CF on gap not value; label target; prefer kpi over card) | data-goblin | plugins/reports/skills/pbi-report-design/references/cards-and-kpis.md | dg2-reports.xml | adopt | P1 |
| Display-unit selection algorithm + "Auto breaks custom formats, set explicit" + indicatorDisplayUnits enum | data-goblin | plugins/reports/skills/pbi-report-design/references/cards-and-kpis.md | dg2-reports.xml | adopt | P1 |
| Target-source DAX templates (PY/PP/budget/rolling — placeholders) | data-goblin | plugins/reports/skills/pbi-report-design/references/cards-and-kpis.md | dg2-reports.xml | adopt | P1 |
| KPI definition contract (name/owner/formula/granularity/target/warning~90%/critical~80%/dims/caveats) + threshold-consistency lint | claude-skills (borghei) | data-analytics/business-intelligence/SKILL.md | claude-skills-borghei.xml | adopt | P1 |
| "Measures live in the model — remove report-level computed fields" governance | claude-skills (borghei) | data-analytics/business-intelligence/SKILL.md | claude-skills-borghei.xml | adopt | P1 |
| SMART gate + KPI levels (Strategic/Tactical/Operational) + benchmark discipline | antigravity | plugins/antigravity-bundle-business-analyst/skills/kpi-dashboard-design/SKILL.md ; skills/kpi-dashboard-design/SKILL.md | antigravity-awesome-skills.xml | adopt | P2 |
| CF thresholds green>110%/yellow 90-110%/red<90%; data-bar consistent scale | awesome-copilot | instructions/power-bi-report-design-best-practices.instructions.md | awesome-copilot-pbi-data.xml | adopt | P2 |
| PBIR kpi/card visual.json shapes (goals.goalText, indicatorDisplayUnits) | data-goblin | plugins/reports/skills/pbir-cli/examples/visuals/formatted/kpi.json ; .../formatted/card.json ; .../formatted/cardVisual.json | dg2-reports.xml | adapt | P1 |

**Shared with:** table-design-rules + theme-cascade (CF/sentiment colors), audience-styles (KPI levels↔personas), time-intelligence (target DAX), data-analyst (definition contract). **Deep detail:** findings/dg2-reports.md, findings/claude-skills-data-analytics.md, findings/antigravity-bi-bundles.md.

---

## table-design-rules · skill
**Role:** Table vs matrix, column order, subtract-formatting, CF strategy, auto-size gotcha. **Build:** new `skills/<name>/SKILL.md` (single-source = dg2; expect to extend).

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Decision-first ("subtract not add"); table(tableEx) vs matrix(pivotTable); flat-repeating-parent anti-pattern | data-goblin | plugins/reports/skills/pbi-report-design/references/tables-and-matrices.md | dg2-reports.xml | adopt | P1 |
| Column order (labels→primary→secondary→variance) + sort-by-variance-desc | data-goblin | plugins/reports/skills/pbi-report-design/references/tables-and-matrices.md | dg2-reports.xml | adopt | P1 |
| Subtract-formatting (gridlines/banding/padding/fonts); tables show MORE precision, NO display units | data-goblin | plugins/reports/skills/pbi-report-design/references/tables-and-matrices.md | dg2-reports.xml | adopt | P1 |
| CF strategy (data bars on primary, color scales on variance only) | data-goblin | plugins/reports/skills/pbi-report-design/references/tables-and-matrices.md | dg2-reports.xml | adopt | P1 |
| Auto-size gotcha (`columnHeaders.autoSizeColumnWidth=false` when sharing a row) | data-goblin | plugins/reports/skills/pbi-report-design/references/tables-and-matrices.md | dg2-reports.xml | adopt | P1 |
| PBIR table/matrix visual.json (tableEx/pivotTable, gradient CF) | data-goblin | plugins/reports/skills/pbir-cli/examples/visuals/formatted/tableEx-gradient.json ; .../formatted/pivotTable-bullet-kpi.json | dg2-reports.xml | adapt | P1 |
| Visual-perf note (matrix/table-many-columns = slowest) | awesome-copilot | skills/power-bi-performance-troubleshooting/SKILL.md | awesome-copilot-pbi-data.xml | ref | P2 |

**Shared with:** theme-cascade (tableEx `backColor` gotcha, CF colors), svg-dax-patterns (inline sparklines in cells), report-reviewer (auto-size scroll check). **Deep detail:** findings/dg2-reports.md.

---

## svg-dax-patterns · skill
**Role:** SVG visuals authored via DAX measures (in-scope: SVG-via-DAX is Node-compatible). **Build:** new `skills/<name>/SKILL.md`. Primary + sole = dg2 `svg-visuals`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Mechanism: `data:image/svg+xml;utf8,` + dataCategory ImageUrl; card unsupported→cardVisual; bind via tableEx/pivotTable/image/cardVisual | data-goblin | plugins/reports/skills/svg-visuals/SKILL.md | dg2-reports.xml | adopt | P1 |
| VAR-based structure (CONFIG→NORMALIZE→ELEMENTS→ASSEMBLY→RETURN) + axis normalization + Y=top inversion | data-goblin | plugins/reports/skills/svg-visuals/SKILL.md ; plugins/reports/skills/svg-visuals/references/svg-elements.md | dg2-reports.xml | adopt | P1 |
| Element reference (rect/circle/line/polyline/text/path/group/gradient attr tables) | data-goblin | plugins/reports/skills/svg-visuals/references/svg-elements.md | dg2-reports.xml | adopt | P1 |
| Escaping/color gotchas (single-quote attrs, `""` escape, hex-`#`-only never `%23`/named, viewBox, xmlns, HASONEVALUE guard, `<desc>` sort trick) | data-goblin | plugins/reports/skills/svg-visuals/SKILL.md ; plugins/reports/skills/svg-visuals/references/svg-table-matrix.md | dg2-reports.xml | adopt | P0 |
| Binding refs per host (table/matrix grid.imageHeight; image sourceType; cardVisual callout.imageFX) | data-goblin | plugins/reports/skills/svg-visuals/references/svg-table-matrix.md ; plugins/reports/skills/svg-visuals/references/svg-image-visual.md ; plugins/reports/skills/svg-visuals/references/svg-card-slicer.md | dg2-reports.xml | adopt | P1 |
| 12 example measures (boxplot/bullet/dumbbell/ibcs-bar/jitter/lollipop/overlapping-bars(+variance)/progress-bar/sparkline/status-pill/waterfall) — de-hardcode | data-goblin | plugins/reports/skills/svg-visuals/examples/*.dax (boxplot-measure.dax, bullet-chart-measure.dax, dumbbell-chart-measure.dax, ibcs-bar-measure.dax, jitter-plot-measure.dax, lollipop-conditional-measure.dax, overlapping-bars-measure.dax, overlapping-bars-with-variance-measure.dax, progress-bar-measure.dax, sparkline-measure.dax, status-pill-measure.dax, waterfall-measure.dax) | dg2-reports.xml | adopt | P1 |
| ~32K rendered-char limit; polylines>dots; adaptive number-format SWITCH | data-goblin | plugins/reports/skills/svg-visuals/SKILL.md | dg2-reports.xml | adopt | P1 |
| reportExtensions.json schema (ImageUrl/Text dataType, displayFolder, references.measures[]) + DELETE-if-empty rule | data-goblin | plugins/pbip/skills/pbir-format/references/report-extensions.md ; plugins/pbip/skills/pbir-format/references/measures.md ; plugins/pbip/skills/pbir-format/references/how-to/svg-in-visuals.md | dg1-pbip.xml | adopt | P0 |
| PBIR image-svg-measure visual binding example | data-goblin | plugins/reports/skills/pbir-cli/examples/visuals/formatted/image-svg-measure.json ; plugins/pbip/skills/pbir-format/examples/visuals/formatted/image-svg-measure.json | dg2-reports.xml ; dg1-pbip.xml | adapt | P1 |
| UDF-library awareness (detect DaxLib PowerofBI.IBCS./Viz./Compound./Element.; don't vendor) | data-goblin | plugins/reports/skills/svg-visuals/references/community-examples.md | dg2-reports.xml | ref | P2 |
| Preview-first workflow (query→/tmp/mockup.svg→browser→DAX) | data-goblin | plugins/reports/skills/svg-visuals/SKILL.md | dg2-reports.xml | adopt | P2 |

**Shared with:** theme-cascade (color tokens Text dtype), table-design-rules (inline cell SVG), report-reviewer (svg-reviewer checklist), pbi_visual_bind (ImageUrl-measure binding). **Deep detail:** findings/dg2-reports.md, findings/dg1-pbip.md.

---

## audience-styles · skill
**Role:** Exec/analyst/ops personas + maturity ladders + data-storytelling. **Build:** new `skills/<name>/SKILL.md`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Audience archetypes (Executive/Analytical/Operational) + per-persona style specifics | claude-skills (borghei) | data-analytics/business-intelligence/SKILL.md | claude-skills-borghei.xml | adopt | P1 |
| Per-persona style specifics (exec R/Y/G+whitespace; analytical drill; ops real-time+mobile) | awesome-copilot | skills/power-bi-report-design-consultation/SKILL.md ; instructions/power-bi-report-design-best-practices.instructions.md | awesome-copilot-pbi-data.xml | adopt | P1 |
| Maturity ladders (self-service L1-L4; question-sophistication L1-L5) as scope-setting tables | claude-skills (borghei) | data-analytics/business-intelligence/SKILL.md ; data-analytics/data-analyst/SKILL.md | claude-skills-borghei.xml | adopt | P1 |
| Data-storytelling (6-beat arc, S-C-R, What/So-What/Now-What, headline formula `[Number]+[Impact]+[Context]`) | antigravity | skills/data-storytelling/SKILL.md | antigravity-awesome-skills.xml | adopt | P1 |
| Design-philosophy doc template (Intent→Principles→Aesthetic→Anti-Patterns→Philosophy→UI; each choice traceable) | agent-skills | canvas-design/examples/design-philosophy-example.md ; canvas-design/references/design-principles.md | agent-skills.xml | adapt | P2 |

**Shared with:** kpi-design-rules (KPI levels), bi-pattern-library (maturity vocabulary), data-analyst (audience trichotomy + storytelling), report-builder (per-persona defaults). **Deep detail:** findings/claude-skills-data-analytics.md, findings/antigravity-bi-bundles.md, findings/agent-skills-design-breadth.md.

---

## report-builder · agent
**Role:** Builds report pages/visuals — ONE page per invocation; lean orchestrator. **Build:** new `agents/<name>.md` (relates to existing `agents/pbi-designer.md`). **Loads skills:** bi-pattern-library, layout-patterns, theme-cascade, kpi-design-rules, table-design-rules, svg-dax-patterns, audience-styles.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Build workflow + completion ethos ("bind→execute→verify→connect→validate; don't stop early") | data-goblin | plugins/reports/skills/create-pbi-report/SKILL.md ; plugins/reports/skills/pbir-cli/SKILL.md | dg2-reports.xml | adapt | P1 |
| Default templates + verified spacing proof (seed builder) | data-goblin | plugins/reports/skills/create-pbi-report/references/layout-example.md | dg2-reports.xml | adopt | P1 |
| PBIR add-visual / fields-and-bindings / format mechanics (call pbi_visual_bind) | data-goblin | plugins/reports/skills/pbir-cli/references/add-new-visual.md ; plugins/reports/skills/pbir-cli/references/fields-and-bindings.md ; plugins/reports/skills/pbir-cli/references/format-visuals.md | dg2-reports.xml | adapt | P1 |
| Conditional-formatting + visual-calculations + reference-lines authoring | data-goblin | plugins/reports/skills/pbir-cli/references/conditional-formatting.md ; plugins/reports/skills/pbir-cli/references/visual-calculations.md ; plugins/reports/skills/pbir-cli/references/reference-lines.md | dg2-reports.xml | adapt | P2 |
| PBIR conditional-formatting / expressions / selectors schema patterns | data-goblin | plugins/pbip/skills/pbir-format/references/schema-patterns/conditional-formatting.md ; .../schema-patterns/expressions.md ; .../schema-patterns/selectors.md ; .../schema-patterns/visual-calculations.md | dg1-pbip.xml | adapt | P1 |
| Lean-orchestrator agent body (role+skill table+process+output; 2-3 sentence summaries) | (see findings: agent-skills-pbi-meta) | (see findings: agent-skills-pbi-meta.md — code-reviewer.md template) | — | adapt | P1 |
| Visual JSON template library (default + formatted, all chart types) | data-goblin | plugins/reports/skills/pbir-cli/examples/visuals/default/ ; plugins/reports/skills/pbir-cli/examples/visuals/formatted/ | dg2-reports.xml | ref | P2 |

**Shared with:** all 7 report skills (consumes them), pbi_visual_bind (writes bindings via the MCP tool), data-analyst (receives the propose-before-building plan). **Deep detail:** findings/dg2-reports.md, findings/dg1-pbip.md, findings/agent-skills-design-breadth.md.

---

## report-reviewer · agent
**Role:** Design/binding/a11y/perf review — READ-ONLY; two-stage (spec-compliance first, then quality). **Build:** new `agents/<name>.md` (relates to existing `agents/pbi-report-reviewer.md`). **Loads skills:** layout-patterns, theme-cascade, kpi-design-rules, table-design-rules, svg-dax-patterns, audience-styles, bi-pattern-library.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Reviewing philosophy (can't assert "looks good"; suggest+ask intent; confirm font sizes; watch (Blank)/repeats/errors) | data-goblin | plugins/reports/skills/review-report/SKILL.md ; plugins/reports/skills/review-report/references/best-practices.md | dg2-reports.xml | adopt | P1 |
| Six dimensions + lifecycle gate (Dev/Test/Prod) | data-goblin | plugins/reports/skills/review-report/SKILL.md | dg2-reports.xml | adopt | P1 |
| Design checklist (titles/spacing/gradient/color/fonts/≤15 visuals/no-empty/axes/sort/sel-pane/interactions/synced slicers) | data-goblin | plugins/reports/skills/review-report/references/best-practices.md | dg2-reports.xml | adopt | P1 |
| Binding checklist (thin report; bindings resolve; ext. measures sparingly; measures-vs-columns; no stray filters) | data-goblin | plugins/reports/skills/review-report/references/best-practices.md ; plugins/reports/skills/pbir-cli/references/thin-report-measures.md | dg2-reports.xml | adopt | P1 |
| Performance + metadata/governance review refs | data-goblin | plugins/reports/skills/review-report/references/performance.md ; plugins/reports/skills/review-report/references/report-metadata.md | dg2-reports.xml | adopt | P2 |
| Theme-compliance / stale-override audit | data-goblin | plugins/reports/skills/modifying-theme-json/references/theme-compliance.md | dg2-reports.xml | adopt | P1 |
| Audit-report driver (BPA report-side findings) | data-goblin | plugins/reports/skills/pbir-cli/references/audit-report.md ; plugins/reports/skills/pbir-cli/references/bpa.md | dg2-reports.xml | adapt | P1 |
| Visual checklist + P0-P3 priority matrix + WCAG (4.5:1 / UI+chart 3:1) + CVD shape+text | agent-skills | web-design-reviewer/references/visual-checklist.md ; web-design-reviewer/SKILL.md ; frontend-design/references/accessibility-checklist.md | agent-skills.xml | adapt | P1 |
| Severity scale (Critical/High/Medium/Low) + output (severity-count table → grouped + `[Category]` + location + fix); two-stage review | data-goblin | plugins/reports/skills/review-report/SKILL.md | dg2-reports.xml | adopt | P1 |
| Sub-reviewer checklists: deneb-reviewer + svg-reviewer (fold in or keep dedicated) | data-goblin | plugins/reports/agents/svg-reviewer.agent.md ; plugins/reports/agents/deneb-reviewer.agent.md | dg2-reports.xml | adapt | P2 |
| Deterministic-first + safety-fixing doctrine (read-only; attribute to tool; don't re-walk BPA) | data-goblin | plugins/pbip/agents/pbip-validator.agent.md | dg1-pbip.xml | adopt | P1 |
| Usage/adoption telemetry dimension (Python+tenant API) | data-goblin | plugins/reports/skills/review-report/references/usage-metrics.md ; plugins/reports/skills/review-report/references/distribution.md | dg2-reports.xml | ref | P2 |
| python/r-reviewer agents (non-Node) | data-goblin | plugins/reports/agents/python-reviewer.agent.md ; plugins/reports/agents/r-reviewer.agent.md | dg2-reports.xml | ref | P2 |

**Shared with:** report-side BPA (bucket B feeds findings), theme-cascade (compliance audit), all report skills (their rules = its checks), model-reviewer (shared severity/output format). **Deep detail:** findings/dg2-reports.md, findings/agent-skills-design-breadth.md, findings/powerbi-agentic-plugins.md.

---

## pbi_visual_bind · mcp-tool
**Role:** Annotation-aware field→visual binding (canonical+alias roles, measure/column auto-detect, bridge-annotation coverage). **Build:** extend `packages/mcp/src/server.ts` + `packages/core/src/visual/bind-validator.ts` (tools ALREADY exist: `pbi_visual_bind` server.ts:547, `pbi_visual_bind_check` :591, `pbi_visual_bulk_bind` :1093; bridge logic in bind-validator.ts:534+).

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Annotation-aware binding semantics (PBIR field-reference + bridge `pbi_bridge_*` coverage — already in bind.ts/bind-validator.ts) | (our code) | packages/core/src/visual/bind.ts ; packages/core/src/visual/bind-validator.ts | — | extend | P0 |
| Field-reference / finding-fields / report-rebinding rules (PBIR SourceRef, schema=extension for ext. measures) | data-goblin | plugins/pbip/skills/pbir-format/references/semantic-model/field-references.md ; .../semantic-model/finding-fields.md ; .../semantic-model/report-rebinding.md | dg1-pbip.xml | adapt | P0 |
| Infer-queries-from-visuals + fix-broken-field-references (binding repair) | data-goblin | plugins/pbip/skills/pbir-format/references/semantic-model/inferring-queries-from-visuals.md ; plugins/pbip/skills/pbir-format/references/how-to/fix-broken-field-references.md | dg1-pbip.xml | adapt | P1 |
| measures-vs-literals + measures binding rules (measure vs column role correctness) | data-goblin | plugins/pbip/skills/pbir-format/references/measures-vs-literals.md ; plugins/pbip/skills/pbir-format/references/measures.md ; plugins/reports/skills/pbir-cli/references/fields-and-bindings.md | dg1-pbip.xml ; dg2-reports.xml | adapt | P0 |
| ImageUrl-measure (SVG) binding path into image/cardVisual/table | data-goblin | plugins/pbip/skills/pbir-format/references/how-to/svg-in-visuals.md | dg1-pbip.xml | adapt | P1 |
| verifiedAnswer / stable-identifier annotation triggers (annotation-aware surface) | data-goblin | plugins/pbip/skills/pbir-format/references/annotations.md | dg1-pbip.xml | adapt | P2 |
| Report-binding validation hook (PostToolUse parity) | data-goblin | plugins/pbip/hooks/validate-report-binding.sh | dg1-pbip.xml | ref | P2 |

**Shared with:** svg-dax-patterns (ImageUrl binding), report-builder (calls this tool), report-reviewer (binding checklist mirrors its validations). **Deep detail:** findings/dg1-pbip.md, findings/dg2-reports.md.

---

## report-side BPA · engine
**Role:** New PBIR-side BPA rule surface (report rules + lineage linter) feeding report-reviewer. **Build:** extend `packages/core/src/modeling/bpa.ts` (or a new `bpa-report.ts`) — re-implement rule JSON as TS predicates over the parsed PBIR model.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Report BPA rule set (REDUCE_VISUALS_ON_PAGE ≤20, REDUCE_OBJECTS_WITHIN_VISUALS ≤6, REDUCE_TOPN/ADVANCED_FILTERS, REDUCE_PAGES ≤10, AVOID_SHOW_ITEMS_NO_DATA, HIDE_TOOLTIP_DRILLTHROUGH, ENSURE_THEME_COLOURS, ENSURE_PAGES_DO_NOT_SCROLL ≤720, ENSURE_ALTTEXT, REMOVE_UNUSED_CUSTOM_VISUALS) | powerbi-agentic (ruiromano) | plugins/powerbi/skills/powerbi-report-authoring/scripts/bpa-rules-report.json | powerbi-agentic-plugins.xml | adapt | P1 |
| Report-authoring KB (rule rationale + report structure context) | powerbi-agentic (ruiromano) | plugins/powerbi/skills/powerbi-report-authoring/SKILL.md ; plugins/powerbi/skills/powerbi-report-authoring/assets/templateReport/template-report-kb.md | powerbi-agentic-plugins.xml | ref | P2 |
| PBIR lineage linter (bookmark targetSection→page exists; drillthrough pageBindings.name→page; defaultPage→page; theme RegisteredResource→file committed); service limits (≤1000 pages, ≤1000 visuals/page, ≤300MB) | data-goblin | plugins/pbip/skills/pbir-format/references/bookmarks.md ; plugins/pbip/skills/pbir-format/references/pbir-structure.md ; plugins/pbip/skills/pbir-format/references/report.md ; plugins/reports/skills/pbir-cli/references/bpa.md | dg1-pbip.xml ; dg2-reports.xml | adapt | P1 |
| Report-BPA narrative + audit-report output shape | data-goblin | plugins/reports/skills/pbir-cli/references/bpa.md ; plugins/reports/skills/pbir-cli/references/audit-report.md | dg2-reports.xml | adapt | P1 |
| Reuse existing BPARule/Severity schema + annotations (BestPracticeAnalyzer_IgnoreRules etc.) — already in bpa.ts | (our code) | packages/core/src/modeling/bpa.ts | — | extend | P0 |
| ENSURE_THEME_COLOURS overlap with theme stale-override audit | data-goblin | plugins/reports/skills/modifying-theme-json/references/theme-compliance.md | dg2-reports.xml | adopt | P2 |

**Shared with:** report-reviewer (bucket B = its findings), theme-cascade (no-hardcoded-hex rule), pbi_visual_bind (lineage/orphan-binding checks). **Deep detail:** findings/powerbi-agentic-plugins.md, findings/dg1-pbip.md, findings/dg2-reports.md.

---

## Notes / unverified
- All `<file path>` rows grep-confirmed against packed XMLs except 4 rows marked `(see findings: …)`: medallion/M2M architecture (dg3 not in report-side packed set), the lean-orchestrator/code-reviewer agent template (agent-skills-pbi-meta — not in scope packed set). These cite the findings file per instructions.
- dg2 ships TWO mirror skill trees: `plugins/reports/skills/pbi-report-design/` (the kpi/table/layout/color references the findings call `cards-and-kpis.md`/`tables-and-matrices.md`) and `plugins/reports/skills/pbir-cli/` (CLI authoring + examples + bpa.md). Both verified; paths above use the design refs for doctrine and pbir-cli for authoring/examples.
- dg1 (`plugins/pbip/`) and dg2 (`plugins/reports/`) duplicate the PBIR example report + `image-svg-measure.json`; rows list both confirmed paths.
- De-hardcode watchlist (carry into every adopt): awesome-copilot AdventureWorks names, dg2 CF examples (`[Revenue]`/`[Target]`), antigravity dept-KPI menus, agent-skills industry hex palettes — all placeholders/suggestion-libraries only.

---

# Adoption Map — Cross-cutting / Infra / Authoring

Routing table re-pivoted from `review/02-architecture-authoring-adoption.md` (PRIMARY) + the data-analyst
section of `review/01-domain-knowledge-adoption.md`. Every "Path in repo" grep-confirmed against `packed/*.xml`
(`<file path=...>`), repo-relative to each source repo's root. `(see findings: X)` = synthesized in findings,
no single canonical file. **Platform note:** awesome-copilot `hooks.json` + `*.agent.md`/`workflows` = GitHub
Copilot-CLI / Actions schema → config **ref**-only, bash/structure portable. ruiromano/Microsoft `.agent.md`
`tools:`/`model:` values + `.github/plugin/plugin.json` + `.codex-plugin` = non-Claude → translate, don't copy.

---

## data-analyst · agent
**Role:** read-only planner — clarifying intake, KPI contract, INFO.* model discovery, emits DashboardSpec. **Build:** new `agents/data-analyst.md`. **Loads skills:** kpi-design-rules, dax-patterns (read), pbi-status/validate (read), + INFO.* discovery technique.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Clarify-the-reporting-need gate (audience exec/operational/self-service, key questions, cadence, validate sources exist) | borghei | data-analytics/business-intelligence/SKILL.md | claude-skills-borghei.xml | adapt | P1 |
| KPI definition contract (name/owner/purpose/formula/source/granularity/target/RAG/dimensions/caveats) + threshold-consistency lint | borghei | data-analytics/business-intelligence/SKILL.md | claude-skills-borghei.xml | adapt | P1 |
| Hypothesis framing template ("Because[obs] we believe[change] will cause[outcome]…MDE…guardrails") + good/bad-question coaching | borghei | data-analytics/data-scientist/SKILL.md ; product-team/ab-test-setup/SKILL.md | claude-skills-borghei.xml | adapt | P1 |
| Primary/Secondary/Guardrail metric triad + ICE prioritization | borghei | data-analytics/business-intelligence/SKILL.md | claude-skills-borghei.xml | adapt | P1 |
| Insight delivery (What/So-What/Now-What/Evidence/Confidence) + analysis skeleton + maturity L1-L5 | borghei | data-analytics/data-analyst/SKILL.md | claude-skills-borghei.xml | adapt | P1 |
| Propose-before-building / AskUserQuestion protocol (ask 3 min; sensible-defaults table; don't lecture/interview/ship-generic) | data-goblin (dg2) | plugins/reports/skills/create-pbi-report/references/vague-prompts.md | dg2-reports.xml | adapt | P1 |
| INFO.* discovery discipline (scope-estimate `COUNTROWS(INFO.VIEW.TABLES())`→progressive INFO.VIEW.*→`SELECTCOLUMNS(FILTER…)`→`TOPN(0,…)`; `INFO.DEPENDENCIES` impact) | Microsoft skills-for-fabric | skills/powerbi-consumption-cli/references/discovery-queries.md ; skills/powerbi-authoring-cli/SKILL.md | skills-for-fabric-1-authoring.xml | adapt | P1 |
| Anti-fabrication / grounding invariant (same model index for gen+validate; grade-then-decide answer/refine/refuse) | awesome-llm-apps | rag_tutorials/knowledge_graph_rag_citations/README.md ; advanced_ai_agents/single_agent_apps/ai_agent_governance/README.md | awesome-llm-apps.xml | adapt | P1 |
| Architect/spec role split (design-only, model Opus, emits spec) — frontmatter pattern | ruiromano | plugins/powerbi/agents/powerbi-architect.agent.md | powerbi-agentic-plugins.xml | adapt | P1 |
| Read-only reviewer/planner deterministic-first frontmatter (`tools:[Read,Grep,Glob]`) + delegates_to | data-goblin (dg1) / Microsoft | plugins/pbip/agents/pbip-validator.agent.md ; agents/FabricDataEngineer.agent.md | dg1-pbip.xml ; skills-for-fabric-1-authoring.xml | adapt | P1 |

**Shared with:** house-style frontmatter (§authoring); INFO.* technique also feeds model-builder/reviewer; grounding invariant shared w/ gate-measure-create. **Deep detail:** review/01 §data-analyst; claude-skills-data-analytics.md, dg2-reports.md, skills-for-fabric-authoring.md, awesome-llm-apps-rag-eval.md.

---

## pbi-build · pipeline-skill
**Role:** Sequential orchestrator: data-analyst → model-builder → model-reviewer → report-builder → report-reviewer. **Build:** new `skills/pbi-build/SKILL.md`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Sequential primitive (each stage consumes prior typed output) + named-workflow vocabulary | awesome-llm-apps | advanced_ai_agents/multi_agent_apps/multi_agent_researcher/README.md (see findings: awesome-llm-apps-orchestration.md) | awesome-llm-apps.xml | adapt | P1 |
| Skill-Chain I/O contract (each step declares in/out format+required fields; fail-fast; idempotent; observable; ≤6 steps) | borghei | standards/orchestration-protocol.md ; docs/guides/orchestration.md | claude-skills-borghei.xml | adapt | P1 |
| Canonical SKILL.md skeleton (Overview/When · Tool-Selection-Priority · Pre-flight · numbered phases · Output schema · Completion rule) | Microsoft / awesome-copilot | skills/powerbi-authoring-cli/SKILL.md (see findings: awesome-copilot-meta.md) | skills-for-fabric-1-authoring.xml | adapt | P1 |
| Tool Selection Priority ladder (MCP engine → local PBIP/TMDL → ask user) | ruiromano | plugins/powerbi/agents/powerbi-architect.agent.md (see findings: powerbi-agentic-plugins-structure.md) | powerbi-agentic-plugins.xml | adapt | P1 |
| "Complete the full e2e flow / don't stop half-done" final hard-constraint line | Microsoft | skills/powerbi-authoring-cli/SKILL.md | skills-for-fabric-1-authoring.xml | adapt | P1 |

**Shared with:** SKILL.md skeleton + Tool-Selection ladder reused by all 4 pipelines; I/O contract shared w/ pbi-modify/fix/audit. **Deep detail:** review/02 §2; awesome-llm-apps-orchestration.md, claude-skills-standards.md, skills-for-fabric-catalog.md.

---

## pbi-modify · pipeline-skill
**Role:** Sequential w/ targeted entry point + rename-cascade discipline. **Build:** new `skills/pbi-modify/SKILL.md`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Rename-cascade discipline (rename ≠ folder edit; propagate refs) | data-goblin (dg1) | plugins/pbip/skills/pbip/references/rename-cascade.md | dg1-pbip.xml | adapt | P1 |
| Sequential primitive + targeted-entry + I/O contract (shared) | borghei | standards/orchestration-protocol.md | claude-skills-borghei.xml | adapt | P1 |
| Canonical SKILL.md skeleton (shared) | Microsoft | skills/powerbi-authoring-cli/SKILL.md | skills-for-fabric-1-authoring.xml | adapt | P1 |

**Shared with:** skeleton/ladder/I-O-contract = pbi-build. **Deep detail:** review/02 §2; dg1-pbip.md.

---

## pbi-fix-model · pipeline-skill
**Role:** Bounded Loop — reviewer→fixer cycle, max-iter budget + success predicate, keep-if-improved-else-revert. **Build:** new `skills/pbi-fix-model/SKILL.md`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Bounded Loop primitive (max-iteration budget + success predicate; cap cycles at 2; no Infinite-Loop anti-pattern) | awesome-llm-apps + borghei | advanced_ai_agents/multi_agent_apps/ai_self_evolving_agent/README.md (see findings: awesome-llm-apps-orchestration.md) ; standards/orchestration-protocol.md | awesome-llm-apps.xml ; claude-skills-borghei.xml | adapt | P1 |
| Apply-one-change / keep-if-improved-else-revert (binary criteria: BPA pass-count rises, bind errors→0) | awesome-llm-apps | rag_tutorials/agentic_rag_with_reasoning/README.md (see findings: awesome-llm-apps-rag-eval.md) | awesome-llm-apps.xml | adapt | P1 |
| Deterministic-first + safety-fixing rules (re-validate after fix; never auto-edit identity/.platform/DAX silently; report changes) | data-goblin (dg1) | plugins/pbip/agents/pbip-validator.agent.md ; plugins/pbip/hooks/validate-tmdl.sh | dg1-pbip.xml | adapt | P1 |
| Canonical SKILL.md skeleton (shared) | Microsoft | skills/powerbi-authoring-cli/SKILL.md | skills-for-fabric-1-authoring.xml | adapt | P1 |

**Shared with:** binary-criteria/revert loop = §eval optimizer; skeleton = pbi-build. **Deep detail:** review/02 §2,§8; awesome-llm-apps-orchestration.md, awesome-llm-apps-rag-eval.md.

---

## pbi-audit · pipeline-skill
**Role:** Parallel fan-out — independent read-only checks (BPA + DAX-ref + bind) → distinct report sections, optional synthesizer. **Build:** new `skills/pbi-audit/SKILL.md`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Parallel fan-out / "shared state, distinct keys" primitive | awesome-llm-apps | advanced_ai_agents/multi_agent_apps/multi_agent_researcher/README.md (see findings: awesome-llm-apps-orchestration.md) | awesome-llm-apps.xml | adapt | P1 |
| Read-only check composition + deterministic-first (don't re-walk what validators check; attribute to tool) | data-goblin (dg1) | plugins/pbip/agents/pbip-validator.agent.md | dg1-pbip.xml | adapt | P1 |
| Severity-bucketed audit output (BLOCKERS/CRITICAL/HIGH/MED/LOW + counts + verdict) | agent-skills (practicalswan) | requesting-code-review/code-reviewer.md | agent-skills.xml | adapt | P1 |
| Canonical SKILL.md skeleton (shared) | Microsoft | skills/powerbi-authoring-cli/SKILL.md | skills-for-fabric-1-authoring.xml | adapt | P1 |

**Shared with:** severity model = reviewer agents (§authoring); skeleton = pbi-build. **Deep detail:** review/02 §2; awesome-llm-apps-orchestration.md.

---

## gate-data-analyst-readonly · hook
**Role:** PreToolUse — block any write/mutating MCP tool while data-analyst subagent active; deny w/ structured reason routing to model-builder/report-builder. **Build:** new `hooks/scripts/gate-data-analyst-readonly.mjs` + entry in `hooks/hooks.json`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| PreToolUse deny pattern (matcher on write-tool family; `permissionDecision:"deny"` + reason) | data-goblin | useful-stuff/hooks/block-destructive-commands/hook.json | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| Claude Code plugin hooks.json schema (top-level `hooks` wrapper; type/command/args/timeout) | plugin-master | plugins/plugin-master/skills/hook-development/SKILL.md ; plugins/plugin-master/skills/advanced-features-2025/references/hooks-advanced.md | claude-plugin-marketplace.xml | adapt | P0 |
| Deterministic-policy-gate-before-execution (ALLOW/DENY/REQUIRE-APPROVAL; narrowed capability envelope) | awesome-llm-apps | advanced_ai_agents/single_agent_apps/ai_agent_governance/README.md | awesome-llm-apps.xml | adapt | P0 |
| Per-agent tool-scoping reference (least-privilege settings) | data-goblin | useful-stuff/agent-settings/settings.json ; useful-stuff/agent-settings/README.md | dg4-te-fabric-desktop-root.xml | ref | P1 |

**Shared with:** hooks.json schema + defensive-degradation + config kill-switch shared by ALL hooks below. **Deep detail:** review/02 §5 (gate-data-analyst-readonly), §1 (tool-scoping).

---

## block-destructive-commands · hook
**Role:** PreToolUse(Bash) — deny anchored destructive `rm -rf ~`/`$HOME`/`/`, `.git` delete, force-push to main, `chmod 777`, `curl|sh`; per-pattern safer-alternative suggestion. **Build:** adapt → `hooks/scripts/block-destructive-commands.mjs`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| hook.json + anchored deny regex (narrow precise stance) | data-goblin | useful-stuff/hooks/block-destructive-commands/hook.json | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| settings.json.example flat-array structure | data-goblin | useful-stuff/hooks/block-destructive-commands/settings.json.example | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| Rationale/README (what is/isn't blocked) | data-goblin | useful-stuff/hooks/block-destructive-commands/README.md | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| Per-pattern safer-alternative suggestion UX (threat table) — bash logic only | awesome-copilot | (see findings: awesome-copilot-meta.md — Copilot-CLI hooks.json, config ref-only) | awesome-copilot-meta.xml | ref | P0 |

**Shared with:** schema + flat-array + README pattern = block-pnpm-discipline / block-secrets-exposure. **Deep detail:** review/02 §5 (threat table CATEGORY/SEVERITY/REGEX/SUGGESTION).

---

## block-secrets-exposure · hook
**Role:** Read denies `*.env`/`*.env.*` (allow `.env.example`/`.template`); Bash denies credential-dump (`printenv`, `security find-*-password`, cloud token cmds, `keyring get`). **Build:** adapt → `hooks/scripts/block-secrets-exposure.mjs`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| settings.json.example flat-array (USE THIS — its hook.json is non-standard nested, do NOT copy) | data-goblin | useful-stuff/hooks/block-secrets-exposure/settings.json.example | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| README (env-deny + credential-dump command list) | data-goblin | useful-stuff/hooks/block-secrets-exposure/README.md | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| hook.json (reference for regex content only — nested shape harness-incorrect) | data-goblin | useful-stuff/hooks/block-secrets-exposure/hook.json | dg4-te-fabric-desktop-root.xml | ref | P0 |
| secrets PATTERNS array + placeholder-suppression (`example\|placeholder\|your[_-]\|xxx\|changeme…`) + redaction `first4...last4` — logic only | awesome-copilot | (see findings: awesome-copilot-meta.md — Copilot-CLI schema, config ref-only) | awesome-copilot-meta.xml | ref | P0 |

**Shared with:** schema/flat-array = block-destructive-commands. **Deep detail:** review/02 §5; platform watchlist (data-goblin nested-shape warning).

---

## block-pnpm-discipline · hook
**Role:** PreToolUse(Bash) — deny `npm`/`yarn` (anchored), enforce pnpm; supply-chain rationale. **Build:** adapt block-npm → `hooks/scripts/block-pnpm-discipline.mjs`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| block-npm hook.json + anchored regex `(^\|;\|&&\|\|\|)\s*npm\s` (swap msg to pnpm, NOT bun) | data-goblin | useful-stuff/hooks/block-npm/hook.json | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| settings.json.example flat-array | data-goblin | useful-stuff/hooks/block-npm/settings.json.example | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| README rationale (post-install scripts = supply-chain risk; pnpm lockfile-strict) | data-goblin | useful-stuff/hooks/block-npm/README.md | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| block-pip as second clone pattern (structure parallel) | data-goblin | useful-stuff/hooks/block-pip/hook.json | dg4-te-fabric-desktop-root.xml | ref | P2 |

**Shared with:** schema/flat-array/README = block-destructive-commands. **Deep detail:** review/02 §5.

---

## config + kill-switch · hook (cross-cutting)
**Role:** per-check booleans + master `all_hooks_enabled` kill-switch; committed config read first; disable only via gitignored local override; fail-open exit-0 on env failure. **Build:** new `hooks/config.json` (TS/JSON) + shared `hooks/scripts/_config.mjs` loader.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| config.yaml per-check booleans + kill-switch ("changes take effect immediately") | data-goblin (dg1) | plugins/pbip/hooks/config.yaml | dg1-pbip.xml | adapt | P0 |
| pbi-desktop multi-hook config.yaml + dispatcher (kill-switch model) | data-goblin | plugins/pbi-desktop/hooks/config.yaml ; plugins/pbi-desktop/hooks/hooks.json | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| Defensive-degradation discipline (read stdin once; fail-open; bias false-negatives; 10s timeout; Windows-bug rationale) | data-goblin (dg1) | plugins/pbip/hooks/README.md | dg1-pbip.xml | adapt | P0 |
| Hook-security-pattern (committed-config-as-contract; disable via gitignored only) | borghei | standards/security/hook-security-pattern.md | claude-skills-borghei.xml | adapt | P0 |
| "Hooks beat prompt rules" + fail-open + false-negative-bias philosophy | borghei | standards/security/security-standards.md | claude-skills-borghei.xml | ref | P1 |

**Shared with:** every hook reads this config + applies defensive-degradation. **Deep detail:** review/02 §5 (config+kill-switch, defensive-degradation, Windows bug list).

---

## gate-measure-create (extend) · hook
**Role:** PreToolUse — require measure metadata (DisplayFolder/Description/FormatString) + DAX-reference grounding check. **Build:** extend `hooks/scripts/gate-measure-create.mjs` (already exists).

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| cmd_validate_measure blueprint (required-metadata check → stderr list + exit 2) + cmd_validate_dax (ref-extract, 3-pass fuzzy "Did you mean?") | data-goblin | plugins/pbi-desktop/hooks/pbi-hooks.sh ; plugins/pbi-desktop/hooks/hooks.json | dg4-te-fabric-desktop-root.xml | adapt | P0 |
| PostToolUse validation-hook trio pattern (PBIR schema / report-binding / TMDL lint) | data-goblin (dg1) | plugins/pbip/hooks/validate-tmdl.sh ; validate-report-binding.sh ; validate-pbir.sh | dg1-pbip.xml | adapt | P0 |
| Retrieve-once grounding invariant (same model index for write+verify) | awesome-llm-apps | rag_tutorials/multimodal_agentic_rag/README.md ; rag_tutorials/knowledge_graph_rag_citations/README.md | awesome-llm-apps.xml | adapt | P0 |

**Shared with:** grounding invariant = data-analyst + MCP immutable-context. **Deep detail:** review/02 §5 (gate-measure-create blueprint).

---

## MCP server design (extend) · mcp
**Role:** TS MCP best-practice PR gate for `packages/mcp` — registerTool/Zod.strict/annotations/pagination/CHARACTER_LIMIT/response_format/central-error. **Build:** extend `packages/mcp/src/server.ts`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| TS MCP server reference (registerTool, Zod, annotations, transports, error handling) | agent-skills (mcp-builder) | mcp-builder/reference/node_mcp_server.md | agent-skills.xml | adapt | P0 |
| MCP best-practices (tool-design rules, naming, pagination, char-limit, response_format, descriptions-exhaustive) | agent-skills (mcp-builder) | mcp-builder/reference/mcp_best_practices.md | agent-skills.xml | adapt | P0 |
| mcp-builder SKILL (overall workflow + skills-vs-MCP doctrine) | agent-skills | mcp-builder/SKILL.md | agent-skills.xml | adapt | P1 |
| MCP packaging via .mcp.json + `${CLAUDE_PLUGIN_ROOT}` + npx-when-published | ruiromano | plugins/powerbi/.mcp.json ; plugins/fabric/.mcp.json | powerbi-agentic-plugins.xml | adapt | P0 |
| Typed immutable model-index context + tool-output compression invariants | awesome-llm-apps | rag_tutorials/multimodal_agentic_rag/README.md (see findings: awesome-llm-apps-rag-eval.md) | awesome-llm-apps.xml | adapt | P1 |
| Analyze-first workflow + 404-masquerade heuristic (Python — logic only) | agent-skills (mcp-builder) | mcp-builder/reference/python_mcp_server.md (see findings: awesome-copilot-pbi-data.md) | agent-skills.xml | ref | P1 |

**Shared with:** annotations enable §gate-data-analyst-readonly + per-worker tool-scoping; immutable-context = grounding invariant. **Deep detail:** review/02 §6.

---

## pbi_spec_validate · mcp (tool)
**Role:** new MCP tool — validate a DashboardSpec (strict versioned Zod) as input guardrail into builders. **Build:** new tool in `packages/mcp/src/server.ts` + schema in `packages/core/src/types/spec.ts`.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Structured-output-as-handoff-contract (strict typed schema, enums, required/optional, field-level descriptions) | awesome-llm-apps | advanced_ai_agents/multi_agent_apps/multi_agent_researcher/README.md (see findings: awesome-llm-apps-orchestration.md) | awesome-llm-apps.xml | adapt | P0 |
| 4-field handoff payload (artifact / why / questions-for-next / non-negotiable constraints; cap 4 handoffs) | borghei | standards/orchestration-protocol.md | claude-skills-borghei.xml | adapt | P1 |
| EARS acceptance-criteria spec body ("THE System SHALL…", "WHEN… THE System SHALL…") | ruiromano | plugins/powerbi/agents/powerbi-architect.agent.md | powerbi-agentic-plugins.xml | adapt | P1 |
| registerTool shape + Zod.strict + annotations(readOnlyHint) for the validate tool | agent-skills (mcp-builder) | mcp-builder/reference/node_mcp_server.md | agent-skills.xml | adapt | P0 |
| Input-guardrail (reject incomplete/contradictory spec w/ structured reason before work) | awesome-llm-apps | advanced_ai_agents/single_agent_apps/ai_agent_governance/README.md | awesome-llm-apps.xml | adapt | P0 |

**Shared with:** Zod spec = DashboardSpec contract (worker handoff, review/02 §1); registerTool = MCP server design. **Deep detail:** review/02 §1 (DashboardSpec), §6 (tool shape), §8 (binary criteria).

---

## plugin.json + marketplace.json · packaging
**Role:** Claude Code manifests; keep description+keywords+version in sync across plugin.json ↔ marketplace.json ↔ README + sync-check. **Build:** extend `.claude-plugin/plugin.json` + `marketplace.json` (fix v0.2.0↔v0.3.0 drift).

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| plugin.json field rules (name kebab, version STRING, author OBJECT, keywords ARRAY 5-15, auto-discovery, ≤500-char description no boilerplate) | plugin-master | plugins/plugin-master/skills/plugin-master/references/manifest-reference.md ; plugins/plugin-master/.claude-plugin/plugin.json | claude-plugin-marketplace.xml | adapt | P0 |
| marketplace.json shape (local `source:"./"` not `"."`; remote = source-object w/ immutable `ref`; require license+keywords) | plugin-master + antigravity | .claude-plugin/marketplace.json (plugin-master) ; CATALOG.md (antigravity source:"./" caveat) | claude-plugin-marketplace.xml ; antigravity-awesome-skills.xml | adapt | P0 |
| Publishing guide (registration, public-repo, "not complete until in marketplace.json") | plugin-master | plugins/plugin-master/skills/plugin-master/references/publishing-guide.md | claude-plugin-marketplace.xml | adapt | P0 |
| Claude-native manifest cross-confirm (local-vs-remote source, pluginRoot) — bash/structure only | awesome-copilot | (see findings: awesome-copilot-meta.md) | awesome-copilot-meta.xml | ref | P1 |
| Reference plugin.json + .mcp.json mirroring layout | data-goblin / ruiromano | plugins/pbi-desktop/hooks/hooks.json ; plugins/powerbi/.mcp.json | dg4-te-fabric-desktop-root.xml ; powerbi-agentic-plugins.xml | ref | P1 |

**Shared with:** description-craft (below) = the description fields here. **Deep detail:** review/02 §7; platform watchlist (ignore `.codex-plugin`/`interface{}`/`.github/plugin`).

---

## skills catalog/index + schema · packaging
**Role:** generate validated skills-index (typed TS const/JSON) + README CATALOG from frontmatter (single source of truth); enforce folder==name; `kind: pipeline|shared-knowledge|crud` taxonomy, no catch-all. **Build:** new `packages/core` index generator + README CATALOG section.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| skills-index JSON-Schema (the index shape to adapt) | antigravity | schemas/skills-index.v1.schema.json | antigravity-awesome-skills.xml | adapt | P2 |
| CATALOG.md taxonomy + generated-artifact pipeline (replace `risk` w/ `kind`; avoid `general(354)` catch-all) | antigravity | CATALOG.md | antigravity-awesome-skills.xml | adapt | P2 |
| triggering-reliability greppable audit (port to TS pre-ship check) | plugin-master | plugins/plugin-master/skills/triggering-reliability/SKILL.md | claude-plugin-marketplace.xml | adapt | P2 |
| Frontmatter-as-single-source + bundle-over-shared-skills/ doctrine | Microsoft | skills/powerbi-authoring-cli/SKILL.md (see findings: skills-for-fabric-catalog.md) | skills-for-fabric-1-authoring.xml | ref | P2 |

**Shared with:** greppable audit also at §eval pre-ship QA + §agent-frontmatter. **Deep detail:** review/02 §7 (catalog/index); platform watchlist (defer bundle-variants).

---

## description-craft (auto-trigger) · authoring
**Role:** house-style for `description:` — the single biggest routing lever; `<capability+scope>. Use when <2-4 triggers>. Does NOT… (use X).` WHEN-not-WHAT, BI-noun-dense, ≤~200 chars. **Build:** new authoring convention (apply to all 16 skill + 7 agent descriptions).

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Description = WHEN-not-WHAT philosophy (summary-in-description caused skip-the-body bug); CSO; degrees-of-freedom | agent-skills (writing-skills) | writing-skills/SKILL.md ; writing-skills/anthropic-best-practices.md | agent-skills.xml | adapt | P1 |
| Uniform 4-part `description:` formula across many skills | Microsoft | skills/powerbi-authoring-cli/SKILL.md (see findings: skills-for-fabric-catalog.md) | skills-for-fabric-1-authoring.xml | adapt | P1 |
| `Use when …` + `## Do not use when` negative-scope formula at scale | antigravity | CATALOG.md (see findings: antigravity-catalog-structure.md) | antigravity-awesome-skills.xml | adapt | P1 |
| Exact constraints (name ≤64 + matches-folder; description 10-1024 single-quoted) | awesome-copilot | (see findings: awesome-copilot-meta.md) | awesome-copilot-meta.xml | ref | P1 |

**Shared with:** feeds plugin.json/marketplace descriptions; mirrored in §SKILL.md house-style. **Deep detail:** review/02 §3 (the big conflict resolution: enumeration-idea-yes, workflow-narration-no).

---

## SKILL.md house-style · authoring
**Role:** the conventions every skill must follow — frontmatter + body skeleton + size budgets + progressive disclosure + TDD-for-skills + anti-patterns. **Build:** new authoring standard doc + apply to all skills.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Primary doctrine: CSO, TDD-for-skills (RED/GREEN/REFACTOR, "no skill without failing test"), progressive disclosure, degrees-of-freedom, no `@path` links | agent-skills (writing-skills) | writing-skills/SKILL.md ; writing-skills/anthropic-best-practices.md ; writing-skills/testing-skills-with-subagents.md | agent-skills.xml | adapt | P1 |
| 3-tier loading + frontmatter rules + size table + greppable triggering audit | plugin-master | plugins/plugin-master/skills/skill-development/SKILL.md ; plugins/plugin-master/skills/plugin-master/references/component-patterns.md | claude-plugin-marketplace.xml | adapt | P1 |
| Formal skill-authoring-standard (10-pattern; confidence tags [PROVEN]/[RECOMMENDED]/[EXPERIMENTAL] section-level) | borghei | standards/skill-authoring-standard.md | claude-skills-borghei.xml | adapt | P1 |
| Stricter CONTRIBUTING rules (third-person + "Use when…" + numbered-steps-with-validation + realistic-data) — wins on conflict | borghei | CONTRIBUTING.md | claude-skills-borghei.xml | adapt | P1 |
| Body-skeleton + anti-patterns-section exemplar (Overview/When/Quick-Ref/Workflow/Anti-Patterns/Resources) | agent-skills | code-quality/SKILL.md | agent-skills.xml | ref | P2 |

**Shared with:** description rules = §description-craft; greppable audit = §catalog + §eval. **Deep detail:** review/02 §3 (size budgets, conflict resolutions); description philosophy is the load-bearing call.

---

## agent-frontmatter house-style · authoring
**Role:** conventions for `agents/*.md` — lean-orchestrator vs read-only-reviewer archetypes; `<example>` routing; Skill-Activation table; Self-Validation Protocol; model-per-role; greppable audit. **Build:** new authoring standard + apply to 7 agents.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| Lean-orchestrator agent + Skill-Activation table + Self-Validation Protocol + `<example>` mechanics + greppable agent audit | plugin-master | plugins/plugin-master/skills/agent-development/SKILL.md ; plugins/plugin-master/agents/plugin-expert.md ; plugins/plugin-master/scripts/validate-agent.sh | claude-plugin-marketplace.xml | adapt | P1 |
| Builder/reviewer subagent triplet prompts (implementer + spec-reviewer + code-quality-reviewer; "don't trust the report"; spec-first-then-quality) | agent-skills (practicalswan) | subagent-driven-development/implementer-prompt.md ; spec-reviewer-prompt.md ; code-quality-reviewer-prompt.md | agent-skills.xml | adapt | P1 |
| code-reviewer template (severity buckets + verdict + communication standards) | agent-skills | requesting-code-review/code-reviewer.md | agent-skills.xml | adapt | P1 |
| delegates_to + Must/Prefer/Avoid triad (frontmatter skeleton) | Microsoft | agents/FabricDataEngineer.agent.md ; agents/FabricAppDev.agent.md | skills-for-fabric-1-authoring.xml | adapt | P1 |
| model-per-role (architect=Opus design-only / developer=Sonnet implements) + glob-scoped MCP grant idea | ruiromano | plugins/powerbi/agents/powerbi-architect.agent.md ; plugins/powerbi/agents/powerbi-developer.agent.md | powerbi-agentic-plugins.xml | adapt | P1 |
| Reviewer deterministic-first + safety-fixing rules (read-only, Issue→Fix→Explain→Test) | data-goblin (dg1) | plugins/pbip/agents/pbip-validator.agent.md | dg1-pbip.xml | adapt | P1 |

**Shared with:** `<example>`/audit = §catalog + §eval pre-ship QA; severity model = pbi-audit + reviewer agents. **Deep detail:** review/02 §4. **Platform flag:** ruiromano/Microsoft `.agent.md` `tools:`/`model:` values are Copilot-flavored → translate to Claude `tools:[Read,Edit,…]`/`model:sonnet|opus`.

---

## thin CRUD skills · crud
**Role:** `pbi-report / pbi-pages / pbi-visuals / pbi-themes / pbi-filters / pbi-bookmarks / pbi-layout / pbi-setup / pbi-status / pbi-validate` — thin wrappers over MCP tools. **Build:** new `skills/<name>/SKILL.md` each; THIN — one note + the shared structural template, do not pad.

| What to put here | Source repo | Path in repo | Packed XML | Action | Pri |
|---|---|---|---|---|---|
| ONE combined note: each CRUD skill = minimal SKILL.md = description (§description-craft) + Tool-Selection-Priority(MCP-first) + "call the MUST-use tool even for simple ops" + thin body delegating to `pbi_*` tools; pull thin-skill structural template from a consumption-CLI exemplar | Microsoft skills-for-fabric | skills/powerbi-consumption-cli/SKILL.md ; plugins/fabric-consumption/skills/check-updates/SKILL.md | skills-for-fabric-1-authoring.xml ; skills-for-fabric-2-catalog.xml | adapt | P2 |
| Reference thin per-verb skill exemplar (template only) | data-goblin | plugins/reports/skills/create-pbi-report/SKILL.md | dg2-reports.xml | ref | P2 |

**Shared with:** skeleton/description from §SKILL.md house-style + §description-craft; all wrap §MCP tools. **Deep detail:** review/02 §3 (skeleton), §7 (skills-vs-MCP doctrine). NOTE: design depth for bookmarks/layout/themes/filters is DOMAIN-side (review/01) — this side is just the thin wrapper shell.
