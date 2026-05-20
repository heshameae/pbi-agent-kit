# Mining findings: data-goblin pbip plugin (TMDL/PBIR/validator)
Source: dg1-pbip.xml

## Relevance summary
This is the single most directly relevant source mined so far for our `tmdl-conventions` skill, our PBIR MCP read/write/validate tools, our validator hooks, and our model-builder/reviewer + pbip-validator-equivalent agents. It contains a complete, dataset-agnostic TMDL authoring reference (syntax, indentation depth rules, name quoting, full per-object property tables with enum values, summarizeBy/formatString rules, naming conventions), a deep PBIR JSON format reference (visual.json field-reference patterns, expr-wrapper type suffixes, query-role-by-visual-type tables, selectors, conditional formatting, extension measures), three runnable PostToolUse validation hooks (jq-based PBIR schema/required-field/name-regex checks, report-binding checks, TMDL structural lint), and a well-designed `pbip-validator` agent with explicit "deterministic-first, LLM-fallback" division of labor. Everything is generalized — no hardcoded table/column/measure names except in clearly-marked illustrative examples. Python appears only in `validate_pbip.py` and field-discovery snippets (reference-only); the rest is bash/JSON/markdown.

## High-value extractions

### TMDL authoring skill (syntax, indentation, quoting, properties) → maps to our `tmdl-conventions` skill + model-builder agent
- What it is: A complete `tmdl` SKILL.md plus 5 references that teach how to author/edit `.tmdl` correctly. This is the prime target — near-1:1 with our `tmdl-conventions` skill.
- Key content (directly reusable, dataset-agnostic):
  - **The load-bearing indentation rule:** "a multi-line DAX body is always 2 levels deeper than its enclosing object declaration." Depth table:
    | Context | Tabs |
    |---|---|
    | Top-level (`table`, `relationship`, `expression`) | 0 |
    | Table props, column/measure/hierarchy decls | 1 |
    | Column/measure props, hierarchy levels | 2 |
    | DAX body for measure/column inside table | 3 |
    | DAX body for top-level `function` | 2 |
    | `calculationItem` inside `calculationGroup` | 2 |
    | DAX body for `calculationItem` | 4 |
  - **Tabs not spaces. Indentation is semantic.**
  - **`///` (triple-slash) sets the `Description` property** on the next declaration; must be immediately followed by a declaration (no blank line, never another `///`). `//` is a plain comment. Multiple `///` lines concatenate. (Native TMDL, not a Tabular Editor extension.)
  - **Name quoting:** single-quote only names with spaces/dots/equals/colons/special chars or starting with a digit; escape inner quotes by doubling (`'Customer''s Name'`). Do NOT quote simple identifiers or underscore-prefixed (`_Measures`, `Product`, `CgMetricQuantity`).
  - **M-expression vs table name collision (ERROR):** M shared expressions and tables share one member namespace; a duplicate fails load with `'duplicate member <name>'`. Fix: suffix the M expression with ` Query`/` Source` and reference via `source = #"<Name> Query"`.
  - **Object nesting rules table** (which child objects are allowed under which parent — `column/measure/hierarchy/partition/calculationGroup` → `table`; `level` → `hierarchy`; `calculationItem` → `calculationGroup`; `tablePermission` → `role`; `columnPermission` → `tablePermission`; `formatStringDefinition` → `measure|calculationItem`; `ref` → `model|table`; `annotation` → any object). Root-level only: `model, database, table, relationship, role, cultureInfo, perspective, dataSource, expression, queryGroup, function`.
  - **Annotation syntax:** `annotation <Name> = <Value>`, at property indentation depth, blank line before first annotation and between annotations.
  - **Multi-line DAX two ways:** indented block (2 tabs deeper) OR triple-backtick fence (`` ``` ``) for DAX/M containing TMDL-conflicting chars (colons/equals).
  - **formatStringDefinition** replaces `formatString` for dynamic (DAX-computed) format strings.
  - **PBI_FormatHint annotation:** Power BI re-adds it automatically; do not fight it — leave existing ones in place.
  - **summarizeBy decision table** (keys/attributes/dates/booleans/non-additive → `none`; additive facts → `sum`; "when in doubt, `none`").
  - **formatString patterns table** (Integer `#,##0`, Decimal `#,##0.00`, Percentage `0.00%`, Currency `$#,##0.00`, Date `mm/dd/yyyy`).
  - **displayFolder nesting** uses backslash (`02. MTD\A. Actuals`); numbered-prefix convention for ordering.
- Source path: `plugins/pbip/skills/tmdl/SKILL.md`, `references/{naming-conventions,column-properties,bim-to-tmdl,tmdl-file-examples}.md`
- Quality: 5 — precise, exhaustive, generalized, matches Microsoft TMDL semantics.
- Recommendation: **adapt** (lift wholesale into `tmdl-conventions`; this is exactly our scope. Reword examples but keep all rules/tables verbatim.)

### Complete TMDL object-properties reference with enum values → maps to `tmdl-conventions` + our TMDL parser/types + model-reviewer (BPA)
- What it is: `object-properties.md` — a property table for every one of ~35 TMDL object types (alternateOf, calculationGroup, calculationItem, calendar, column, cultureInfo, dataSource, database, expression, function, hierarchy, kpi, level, measure, model, partition, perspective*, refreshPolicy, relationship, role, table, tablePermission, variation, etc.), each property mapped to a type, followed by the full enum value lists.
- Key content (directly reusable for validation and our `types.ts`/`tmdl-parser.ts`):
  - **aggregateFunction**: default, none, sum, min, max, count, average, distinctCount
  - **dataType**: automatic, string, int64, double, dateTime, decimal, boolean, binary, unknown, variant
  - **crossFilteringBehavior**: oneDirection, bothDirections, automatic
  - **securityFilteringBehavior**: oneDirection, bothDirections, none
  - **relationshipEndCardinality**: none, one, many
  - **modeType**: import, directQuery, default, push, dual, directLake
  - **partitionSourceType**: query, calculated, none, m, entity, policyRange, calculationGroup, inferred
  - **modelPermission**: none, read, readRefresh, refresh, administrator
  - **columnType**: data, calculated, rowNumber, calculatedTableColumn
  - **summarizationType** (alternateOf): groupBy, sum, count, min, max
  - plus directLakeBehavior, encodingHintType, evaluationBehavior, metadataPermission, refreshGranularityType, valueFilterBehaviorType, timeUnit, etc.
- Source path: `plugins/pbip/skills/tmdl/references/object-properties.md`
- Quality: 5 — this is reference-grade enum data we can hardcode as VALID-VALUE sets (these are TMDL grammar enums, not dataset content, so NOT a violation of our no-hardcoding rule).
- Recommendation: **adopt-as-is** (use as the source of truth for property/enum validation in `pbi_model_check` and the TMDL parser).

### Three PostToolUse validation hooks (PBIR schema, report-binding, TMDL lint) → maps directly to our validator hook + `pbi_model_check`/`pbi_visual_bind` MCP tools
- What it is: `validate-pbir.sh`, `validate-report-binding.sh`, `validate-tmdl.sh` + `hooks.json` + `config.yaml` + README. Pure bash + jq, graceful-degradation, exit-2-to-block design. These are the closest analog to our PreToolUse validator hooks — we should port the *rules* to TS.
- Key content (rules to port to TS, all dataset-agnostic):
  - **Required fields per file type** (from Microsoft schemas):
    | File | Schema | Required |
    |---|---|---|
    | `visual.json` | visualContainer/2.7.0 | `$schema`, `name`, `position` + oneOf(`visual`,`visualGroup`) |
    | `page.json` | page/2.1.0 | `$schema`, `name`, `displayName`, `displayOption` |
    | `report.json` | report/3.2.0 | `$schema`, `themeCollection` |
    | `definition.pbir` | definitionProperties/2.0.0 | `$schema`, `version`, `datasetReference` |
  - **Name format regex (silent-ignore bug):** visual/page/bookmark `name` must match `^[a-zA-Z0-9_][a-zA-Z0-9_-]*$` (word chars/hyphen). Non-compliant names are SILENTLY ignored by Desktop — object vanishes with no error. Same regex (`^[\w-]+$`) applies to folder names.
  - **Folder-path-with-spaces check:** pages/visuals in folders with spaces deploy but won't render — block.
  - **$schema URL pattern:** most files `^https://developer\.microsoft\.com/json-schemas/fabric/item/report/definition/`; definition.pbir uses the different `.../definitionProperties/2.x.x/schema.json` base path.
  - **Report binding (definition.pbir):** `datasetReference` must have `byPath` OR `byConnection`; `byPath.path` required + target dir must exist; `byConnection.connectionString` required (optional `fab exists` liveness check via parsed `myorg/<ws>` + `initial catalog=<model>`).
  - **TMDL structural lint:** runs a Rust `tmdl-validate` binary (closed-source stopgap, to be replaced by `te validate`) only on `.tmdl` inside `.SemanticModel/`, `.Dataset/`, or `/definition/`.
  - **Hook design patterns worth copying:** `config.yaml` per-check toggles + master `all_hooks_enabled` kill-switch; graceful skip when `jq`/binary absent; only exit-2+stderr surfaces in Claude Code; consolidated single jq call per file (`jq -r '(."$schema"//""), (has("name")|tostring), ...'`); 10s timeout; bash 3.2-compatible (no mapfile/assoc arrays); `if` filters use gitignore path patterns for Edit/Write but glob text-match for Bash; pipes unsupported in `if` (use separate matchers, not `Write|Edit`).
- Source path: `plugins/pbip/hooks/{validate-pbir.sh,validate-report-binding.sh,validate-tmdl.sh,hooks.json,config.yaml,README.md}`
- Quality: 5 — battle-tested, defensively coded, the rules are exactly what our validator hook + bind-validator should enforce.
- Recommendation: **adapt** (port the rule set to our TS validator/MCP tools; their bash is reference-only for us since we're Node/TS, but the validation *logic* is gold).

### pbip-validator agent design → maps to our model-reviewer + a PBIR-validator agent + pipeline `pbi-audit`
- What it is: `pbip-validator.agent.md` — frontmatter + worked examples + a 5-step deterministic-first validation process + output format + fixing rules + edge-case catalog.
- Key content (reusable agent design):
  - **Frontmatter:** `model: sonnet`, `tools: ["Read","Grep","Glob","Bash","Edit"]`, description with explicit trigger phrases ("validate my PBIP project", "check if the rename cascade is complete", "is this visual.json valid", "my PBIP won't open").
  - **Core principle:** "prefer deterministic validators over LLM walking; only fall back to manual inspection for classes of problems the tools do not cover." Do NOT re-walk what `validate_pbip.py` / `pbir validate` already check; attribute findings to the tool.
  - **Step order:** (0) tool discovery → (1) project validator → (2) `pbir validate --all` per Report → (3) manual TMDL syntax (validators don't parse TMDL) → (3a) M/table collision → (4) cross-reference consistency → (5) post-rename grep cascade.
  - **Manual TMDL checks the agent owns:** table decl matches filename; partition name matches table name (M partitions); tab indentation; `///` immediately precedes decls; valid `formatString`/`summarizeBy`; balanced quotes/parens in DAX; relationships reference existing tables/columns; culture `ConceptualEntity` refs match table names.
  - **Fixing rules (safety):** fix obvious JSON syntax only (re-validate `jq empty` after); never auto-modify `.platform` (logicalId is Fabric identity); never rename page/visual/bookmark folders to "fix" invalid names (requires full cascade); never edit DAX; never delete orphan folders automatically; always report what changed.
  - **Output format:** BLOCKERS / ERRORS / WARNINGS / INFO / FIXES APPLIED, each with `[file:line] description + remediation`.
  - **Edge-case catalog** (high value for our reviewers): silent-ignore name regex on pages/visuals/bookmarks; folder name must equal `name` field case-sensitively; theme resources resolve at `<Report>/StaticResources/<package_type>/<item.path>`; thin vs thick handling; TMDL vs TMSL mutual exclusion; `.pbi/` contents all optional; `.pbip` root optional.
- Source path: `plugins/pbip/agents/pbip-validator.agent.md`
- Quality: 5 — exemplary agent design; the deterministic-first + safety-fixing-rules pattern should shape our model-reviewer/report-reviewer.
- Recommendation: **adapt** (mirror the structure and edge-case catalog into our reviewer agents and `pbi-audit` pipeline).

### PBIR visual.json reference (field refs, expr suffixes, query roles, selectors) → maps to `pbi_visual_bind` + bind-validator + report-builder
- What it is: `visual-json.md` + `field-references.md` + `visual-container-formatting.md` + `schema-patterns/selectors.md` — the complete grammar for binding fields and formatting visuals in PBIR.
- Key content (directly reusable for bind-validator + PBIR write tools):
  - **expr-wrapper type suffixes** (critical for generating valid PBIR): String `"'val'"` (inner single quotes), Double `"14D"`, Integer `"14L"`, Decimal `"2.4M"`, Boolean `"true"` (no quotes/suffix), DateTime `"datetime'...'"`, Color `"'#FF0000'"`, Null `"null"`. Theme color: `{"ThemeDataColor":{"ColorId":0,"Percent":0}}` (Percent -1.0 darker → 1.0 lighter). Gotchas: `transparency` uses D normally but L inside dropShadow; `labelPrecision` always L, `labelDisplayUnits` always D. Inner single quotes doubled for escaping; font fallback chains use triple-quote escaping.
  - **Six field-reference patterns:** Column, Measure(model), Measure(extension — needs `"Schema":"extension"`), Aggregation (`Function` codes 0=Sum…8=Variance), HierarchyLevel, SparklineData. **Three components required:** field type (Column/Measure/HierarchyLevel) + Entity (table) + Property (field).
  - **queryRef/nativeQueryRef:** `queryRef` = `Table.Field` (extension measures OMIT the `extension.` prefix); `nativeQueryRef` = field name only.
  - **Query-roles-by-visual-type table** (essential for bind-validator to know which roles a visual accepts): card→Values; cardVisual(new)→Data (conflicts with old card!); tableEx→Values; pivotTable→Rows/Columns/Values; slicer→Values; line/bar/column→Category,Y(+Y2 combo); scatter→Category,X,Y,Size,Tooltips; gauge→Y,TargetValue; kpi→Indicator,Goal,TrendLine; combo charts use Y(columns)+Y2(line) NOT ColumnY/LineY.
  - **objects vs visualContainerObjects split:** `objects` = visual-specific (dataPoint, legend, axes, dataLabels, lineStyles); `visualContainerObjects` = chrome (title, background, border, dropShadow, padding, visualHeader, visualTooltip). Putting container props in `objects` silently fails; vCO at root errors. Schema 2.1.0–2.2.0 use `objects` for everything; 2.4.0+ splits.
  - **Selector types:** none (whole visual); `metadata: "Table.Field"`; `id` (named, e.g. "default"/"selection:selected"/"interaction:hover"); `dataViewWildcard` (matchingOption 0=identities+totals, 1=per-point [most common for CF], 2=totals); `scopeId` (specific value via Comparison; ComparisonKind 0=Equal,1=GT,2=GTE,3=LTE,4=LT). Per-point CF requires a two-entry array with matchingOption:1.
  - **Filter SourceRef gotcha:** in `Where` conditions SourceRef uses `"Source":"alias"` (referencing `From[].Name`), NOT `"Entity"` — differs from query projections.
- Source path: `plugins/pbip/skills/pbir-format/references/{visual-json,semantic-model/field-references,visual-container-formatting,schema-patterns/selectors}.md`
- Quality: 5 — extremely detailed and generalized; this is the spec our `pbi_visual_bind` and bind-validator should encode.
- Recommendation: **adapt** (encode the field-ref patterns, query-role table, expr suffixes, and selector rules into bind-validator + PBIR write tools).

### Inferring DAX queries from visual metadata → maps to bind-validator + `dax-reference-check` + data-analyst agent
- What it is: `inferring-queries-from-visuals.md` — maps visual.json projections to the `SUMMARIZECOLUMNS` query Power BI generates.
- Key content: Column projection → grouping column; Measure → `"alias", Table[Measure]`; extension measure (`Schema:"extension"`) → DEFINE block + included in SUMMARIZECOLUMNS; cards/KPIs (no grouping) use `IGNORE()`, charts (with grouping) do NOT; slicers use `CALCULATETABLE + SUMMARIZE + VALUES` not SUMMARIZECOLUMNS; alias naming = spaces/special chars → underscores; sort column auto-added if `sortByColumn` exists; TOPN limits 1001 charts / 501 tables / 101 slicers. Data-roles-by-visual-type table (grouping vs measure roles).
- Source path: `plugins/pbip/skills/pbir-format/references/semantic-model/inferring-queries-from-visuals.md`
- Quality: 5
- Recommendation: **adapt** (useful for our data-analyst plan step and for any validation that needs to reason about the generated query).

### Extension measures (reportExtensions.json) reference → maps to our PBIR write tools + report-builder + bind-validator
- What it is: `measures.md` + `report-extensions.md` — full schema and authoring rules for report-level (thin) measures.
- Key content (reusable, dataset-agnostic):
  - **Schema:** root `$schema` (reportExtension/1.0.0) + `name:"extension"` + `entities[]`; each entity `name` MUST be an EXISTING model table (cannot create entities); each measure needs `name`,`dataType`,`expression`; optional `formatString`,`displayFolder`,`description`,`hidden`,`dataCategory`,`references`,`annotations`.
  - **Critical fragility rule:** if there are no extension measures, DELETE `reportExtensions.json` entirely — an empty `"entities":[]` makes Desktop fail with `ModelAuthoringHostService.UpdateModelExtensions ... wrong arg[0]=extensions`.
  - **dataType for colors MUST be `"Text"`**; transparency/sizes `Int64`/`Double`; show/hide `Boolean`. Full type list: Binary, Boolean, Date, DateTime, DateTimeZone, Decimal, Double, Duration, Integer, Int64, Json, None, Null, Text, Time, Variant.
  - **Color tokens:** prefer theme tokens `"good"`,`"bad"`,`"neutral"`,`"minColor"`,`"maxColor"` (note: `"midColor"` is NOT valid — use `"neutral"`); hex `"#RRGGBB"`/`"#AARRGGBB"`; empty string `""` = default.
  - **references.measures[]** must list ALL model measures the DAX depends on (`{entity,name}`); for referencing other extension measures add `"schema":"extension"`. `"unrecognizedReferences": true` = a referenced measure wasn't found.
  - When in visuals, extension measures need `"Schema":"extension"` in SourceRef (model measures omit it). queryRef still uses bare `Table.Property`.
- Source path: `plugins/pbip/skills/pbir-format/references/{measures,report-extensions}.md`
- Quality: 5
- Recommendation: **adapt** (encode the empty-file-must-be-deleted rule and the references-must-be-complete rule into our PBIR validator; reuse the DAX-color-pattern guidance in svg-dax-patterns / kpi-design-rules.)

### PBIR structure + schemas + file types + report.json → maps to PBIR read/write tools + pbir-structure knowledge
- What it is: `pbir-structure.md`, `schemas.md`, `report.md`, `version-json.md`, `pbip-file-types.md` — the folder layout, schema URL shapes, schema-version table, and entry-point file JSON.
- Key content (reusable):
  - **Folder layout** of `Report.Report/` (definition.pbir at root NOT inside definition/; version.json + report.json REQUIRED; reportExtensions.json OPTIONAL; pages/pages.json with `pageOrder`+`activePageName`; StaticResources SharedResources/RegisteredResources).
  - **Two schema URL shapes:** most files `.../report/definition/{type}/{version}/schema.json`; root files (definition.pbir) `.../report/{type}/{version}/schema.json`. Schemas update ~monthly — always match the existing `$schema`, never blind-upgrade.
  - **Schema version table** (late 2025 K201 baseline): visualContainer 2.4.0, report 3.0.0, page 2.0.0, semanticQuery 1.4.0, formattingObjectDefinitions 1.5.0, reportExtension 1.0.0, versionMetadata 1.0.0, pagesMetadata 1.0.0, bookmark 1.4.0, definitionProperties 2.0.0 — with note that early-2026 has newer (visualContainer 2.7.0, report 3.2.0, page 2.1.0).
  - **definition.pbir byPath vs byConnection** full JSON; byConnection current form is connectionString-only (legacy 6-property form deprecated); Fabric REST deploy uses `semanticmodelid=` form.
  - **report.json:** top-level keys (no `config` wrapper) `themeCollection`/`filterConfig`/`objects`/`settings`/`resourcePackages`/`annotations`; at report level outspacePane only supports `visible`+`expanded` (styling must go in theme); `reportVersionAtImport` is theme-import-time version, NOT current schema — never set manually.
  - **.platform rules:** never change `logicalId` on existing item; new GUID required when forking; `type` ∈ {Report, SemanticModel}.
- Source path: `plugins/pbip/skills/pbir-format/references/{pbir-structure,schemas,report,version-json}.md`, `plugins/pbip/skills/pbip/references/pbip-file-types.md`
- Quality: 5
- Recommendation: **adopt-as-is** for the structural/schema facts; **adapt** the "match existing $schema, never blind-upgrade" rule into our PBIR write tools.

### Rename-cascade + broken-field-reference repair → maps to model-reviewer/report-reviewer + a future rename MCP tool + `pbi-fix-model`
- What it is: `rename-patterns.md`, `pbip/SKILL.md` rename section, `how-to/fix-broken-field-references.md` — the exhaustive list of every place a table/column/measure name is embedded.
- Key content: "Where Entity references live" table — query projections (`SourceRef.Entity`, `queryRef`, `nativeQueryRef`); conditional-formatting `SourceRef.Entity` nested in `Conditional.Cases`; SparklineData structured form AND compact metadata-selector string `SparklineData(<Entity>.<Measure>_[<GroupEntity>.<Hierarchy>.<Level>])` (routinely missed); filterConfig `From[].Entity` + `Where.SourceRef.Entity`; sortDefinition; reportExtensions `entities[].name` + `references.measures[].entity`; semanticModelDiagramLayout `nodeIndex`; culture `ConceptualEntity`/`ConceptualProperty`; DAX query files in BOTH `.SemanticModel/DAXQueries/` AND `.Report/DAXQueries/`. Repair: distinguish field *references* (replace) from filter *literal values* (do NOT replace on rename); `queryRef` mismatch causes blank-but-valid visuals.
- Source path: `plugins/pbip/skills/pbir-format/references/rename-patterns.md`, `plugins/pbip/skills/pbip/SKILL.md`, `plugins/pbip/skills/pbir-format/references/how-to/fix-broken-field-references.md`
- Quality: 5
- Recommendation: **adapt** (this enumeration is the spec for any rename/refactor tool and for `dax-reference-check` cross-file coverage).

### PBIR annotations → maps to `ai-readiness` skill + report metadata tooling
- What it is: `annotations.md` — name/value string metadata on report/page/visual (Desktop ignores them; for external tooling/CI/docs).
- Key content: array of `{name,value}` (both always strings); store JSON as escaped string; names unique per object; avoid `PBI_`-prefixed names (reserved); survives Desktop save. Notable: `verifiedAnswer` visual annotation = Copilot verified-answer trigger phrase; `defaultPage`/`version`/`environment`/`owner` report-level. jq read patterns provided.
- Source path: `plugins/pbip/skills/pbir-format/references/annotations.md`
- Quality: 4
- Recommendation: **reference-only / adapt** (the `verifiedAnswer` + stable-identifier annotation idea is directly useful for our `ai-readiness` skill).

### Agent mental model + report-design rules → maps to our data-analyst/report-builder agents + audience-styles/layout-patterns/kpi-design-rules
- What it is: `MENTAL-MODEL.md` + the "Additional validation" rules in pbir-format SKILL.md.
- Key content: problem-first framing (who/what-problem/what-action/what-reader-knows before building); detail gradient (summary top, detail bottom); "formatting nothing means formatting everything" (CF on variance columns only); iteration cycle (interview→wireframe→draft→review→refine); **3-30-300 rule** (KPIs/cards top, breakdowns middle, detail bottom; max 2-3 slicers/page); push formatting to theme over bespoke visual.json; visuals must not overlap; every page needs a title (textbox 24-28pt); set `altText`; name visuals descriptively; centralize CF in measures referencing theme semantic colors. **Tone rule explicitly forbids emojis** and forbids calling things "production-ready"/"beautiful"/"perfect".
- Source path: `plugins/pbip/skills/pbir-format/important/MENTAL-MODEL.md`, `plugins/pbip/skills/pbir-format/SKILL.md`
- Quality: 4 (opinionated but well-reasoned; the 3-30-300 + theme-first + formatting-with-intent rules are reusable for our design skills).
- Recommendation: **adapt** (feed into layout-patterns/kpi-design-rules/audience-styles; aligns with our no-emoji house rule).

### validate_pbip.py — project-level validator (Python, reference-only) → algorithm to port to a TS `pbi_project_check` tool
- What it is: a self-contained Python validator for cross-cutting PBIP concerns NOT covered by `pbir validate`.
- Key content (port the *checks*, not the code): discovery of project type (thick/thin/report-only/sm-only) from `.pbip`/`.Report`/`.SemanticModel`; `.platform` validation (type match, GUID `logicalId`, never auto-create); definition.pbir datasetReference resolution (byPath dir exists / byConnection has connectionString); TMDL-vs-TMSL mutual exclusion (`definition/model.tmdl` xor `model.bim`); **theme resource resolution** at `<report>/StaticResources/<pkg_type>/<item.path>` (missing file = blocker); **orphan page folders** (on disk but not in pages.json pageOrder); **page-name regex `^[\w-]+$`** (silent-ignore); page.json `name` must equal folder slug case-sensitively; activePageName must be in pageOrder; UTF-8 BOM warning; **M/table name-collision detector** (parses top-level `expression <name>` in expressions.tmdl ∩ `table <name>` in tables/*.tmdl, handling bare/single/double/`#"..."` quoted identifiers, column-0-only = top-level). Exit codes 0 clean / 1 warn / 2 error / 3 usage.
- Source path: `plugins/pbip/skills/pbip/scripts/validate_pbip.py` (Python, reference-only)
- Quality: 5 (the check catalog is excellent; we reimplement in TS).
- Recommendation: **reference-only** (port the algorithm to a TS MCP tool; do not ship Python).

## Cross-source overlap flags
- **TMDL conventions / DAX patterns / naming**: will heavily overlap with any `tabular-editor`, `semantic-models`, or SQLBI-derived repo and likely with sibling data-goblin plugins (this plugin itself references separate `semantic-models`, `pbi-desktop`, `tabular-editor` plugins). Reviewers should de-dupe the summarizeBy/formatString/naming tables against those.
- **PBIR visual.json / theme / conditional formatting**: overlaps with any `pbir-cli` repo and the `pbi-report-design` skill referenced here. The expr-suffix table and query-role table are likely to recur — keep one canonical copy.
- **3-30-300 rule, report-as-problem framing, Data Goblins report checklist**: these are Kurt Buhler / SQLBI house content and will recur across all data-goblin sources and design-focused repos — consolidate into our design skills once.
- **definition.pbir byPath/byConnection + .platform logicalId rules**: will overlap with any Fabric/`fabric-cli` deployment repo.
- **Schema version tables**: any PBIR repo will have a (differently-dated) version table — note ours must say "match existing $schema" rather than pin versions.

## Discarded / not relevant
- **All `examples/visuals/*.json` (54 default + formatted visual examples) and the K201 example report** (bookmarks/pages/visuals JSON, ~lines 3545–36900): large concrete visual.json/theme/bookmark instances. Useful as fixtures eventually but out of scope for my focus (TMDL/PBIR-format/validator/hooks) and they embed example-specific field names — skipped to avoid hardcoding contamination. Flag for the report-builder miner if fixtures are wanted.
- **theme.md, wallpaper.md, images.md, textbox.md, filter-pane.md, page.md, bookmarks.md, enumerations.md** (PBIR formatting/visual detail references): relevant to report-builder/theme-cascade/layout skills, not to my TMDL/PBIR-validator focus — skimmed and left for the report-format miner.
- **schema-patterns/{expressions,conditional-formatting,visual-calculations}.md, how-to/{apply-advanced-conditional-formatting,svg-in-visuals,convert-legacy-to-pbir}.md**: deep formatting/CF/SVG patterns — map to svg-dax-patterns / report-builder, not my focus (selectors.md was read since it informs validation).
- **Python scripts `convert_legacy_to_pbir.py`, `generate-background-with-gemini.py`, `set-background-image.py`**: Python utilities, off-focus, and one calls Gemini — discarded (Node/TS-only rule; not validation-related).
- **copilot-folder.md, rename-cascade.md detail body, bim-to-tmdl.md CLI specifics**: copilot-folder is off-focus; bim-to-tmdl is Tabular-Editor/TOM CLI (reference-only, captured the gist in tmdl section).
- **hooks/README Windows-bug list and antivirus/Rust-binary notes**: environment-specific operational caveats, not portable rules — noted only that the TMDL linter is a stopgap to be replaced by `te validate`.
