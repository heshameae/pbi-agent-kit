# Mining findings: microsoft/skills-for-fabric — authoring/PBI slice
Source: skills-for-fabric-1-authoring.xml

## Relevance summary
This is Microsoft's first-party agentic skill pack for Fabric/Power BI authoring — authoritative and directly aligned with our project. The crown jewels are `powerbi-authoring-cli` (full semantic-model lifecycle + 3 deep TMDL reference guides), `powerbi-consumption-cli` (read-only DAX/`INFO.VIEW.*` discovery), the dataflows skills (Power Query M section-document structure → m-query-patterns), `e2e-medallion-architecture` (Bronze/Silver/Gold → bi-pattern-library), and the agent/plugin/MCP wiring (subagent personalities + Must/Prefer/Avoid + delegation; a real Microsoft-hosted Power BI MCP). The `az rest` CLI runtime is external-tool/reference-only for us (Node/TS), but the *recipes* (operation sequencing, LRO handling, definition-envelope rules, TMDL/DAX conventions, INFO discovery order) are gold and largely transferable to our MCP tools. All examples are dataset-agnostic and use placeholders — good model to imitate.

## High-value extractions

### TMDL authoring conventions (Microsoft-authoritative) → maps to `tmdl-conventions` skill + model-builder/model-reviewer subagents
- **What it is / why valuable**: The single best concise, first-party TMDL syntax + modeling-best-practices reference seen so far. This is exactly the content our `tmdl-conventions` shared-knowledge skill should encode, and the rules our model-reviewer should enforce.
- **Key content (reusable rules, paste verbatim)**:
  - **Syntax**: TMDL uses **tab indentation** (one `\t` per level — spaces cause validation errors). Objects declared as `<TOMtype> <Name>` (`table Customer`, `measure 'Total Sales'`). Names with spaces/`.`/`=`/`:`/`'` must be **single-quoted**. Descriptions use `///` **above** the object — NOT a `description` property. `//` comments are **not supported**. Do **not** add `lineageTag` to new objects (auto-generated). Multi-line DAX must be wrapped in **triple backticks**. **Measures before columns** in table files. `formatString` required on every measure.
  - **Naming**: Tables business-friendly, no `Fact`/`Dim` prefixes (plural facts `Sales`, singular dims `Product`). Columns readable w/ spaces (`Order Date`). Measures clear patterns; time-intel suffixes `[m]`, `[m (ly)]`, `[m (ytd)]`.
  - **Column rules**: `dataType` required (`int64/decimal/string/dateTime/boolean`, **avoid `double`**). `sourceColumn` maps exactly to partition source. `isHidden` for IDs/FKs/system cols. `summarizeBy: none` for non-aggregatable numerics (IDs, postal codes, years). `isAvailableInMdx: false` for hidden cols not used in sort/hierarchy. `dataCategory` for geo cols. `sortByColumn` for month-name→month-number.
  - **Measure/DAX rules**: always `formatString`; use `DIVIDE()` not `/`; **never `IFERROR`** (perf); prefix VARs with `_`; use `displayFolder`; **never set `dataType` on measures** (inferred); add `///` business-logic descriptions.
  - **Format strings**: currency `\$#,##0.00`; pct `0.00%`; int `#,##0`; decimal `#,##0.00`; thousands `#,##0,K`; millions `#,##0,,M`.
  - **Relationships**: `fromColumn:`=many-side(fact), `toColumn:`=one-side(dim); default `crossFilteringBehavior: oneDirection` (add `bothDirections` only when needed); `isActive: false` for role-playing dims (+ `USERELATIONSHIP()`); prefer integer keys; matching `dataType` both sides; `isKey: true` on dim PK; hide FKs on fact; **no composite keys** (use single surrogate int); create relationships **before** dependent measures.
  - **Date table**: prefer source date table; contiguous range; `dataCategory: Time`; `sortByColumn` for month names; disable auto-date tables.
  - **Parameters** (named expressions): `expression Server = "..." meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`; reference via `#"Server"` in partition M.
  - **Annotations**: `annotation <Key> = <Value>` indented under object; do NOT manually add `PBI_*` annotations (internal).
- **Source path**: `skills/powerbi-authoring-cli/references/tmdl-authoring-guide.md`
- **Quality**: 5 — first-party, concise, dataset-agnostic, directly enforceable.
- **Recommendation**: **adopt-as-is** (as the canonical content of our `tmdl-conventions` skill; mirror the rules as model-reviewer checks).

### TMDL advanced features: calc groups, RLS roles, translations, perspectives, functions, calendars, file layout → maps to `calc-group-patterns`, `rls-patterns`, `tmdl-conventions`, advanced TMDL MCP write tools
- **What it is / why valuable**: Working TMDL syntax for every advanced object, derived from real Fabric models. Covers the multi-file folder layout and `ref` declarations that our PBIR/TMDL write tools must produce correctly.
- **Key content**:
  - **File layout**: `definition/relationships.tmdl` (named/inactive rels), `definition/functions.tmdl`, `definition/tables/<T>.tmdl` (hierarchies + calc groups live here), `definition/roles/<Role>.tmdl`, `definition/cultures/<locale>.tmdl`, `definition/perspectives/<Name>.tmdl`.
  - **database.tmdl MUST start with `database <GUID-or-name>` declaration** then `compatibilityLevel: 1702`, `compatibilityMode: powerBI`, `language: 1033`. A bare `compatibilityLevel:` without the `database` object → `InvalidLineType: Property!` error.
  - **model.tmdl** declares props + `ref table X` / `ref role X` / `ref perspective X` / `ref cultureInfo en-US` so the engine discovers files. `defaultPowerBIDataSourceVersion: powerBI_V3` **required for Import** (else `Import from JSON supported for V3 models only`).
  - **Calculation groups**: `calculationGroup` keyword (no name) under a table; `calculationItem <Name> = <DAX>`; use `formatStringDefinition` (not `formatString`) for items that override format; the table needs a `column` (usually same name as table) and a `partition '...' = calculationGroup`. Example items: `Current = SELECTEDMEASURE()`, `YTD = CALCULATE(SELECTEDMEASURE(), DATESYTD('Date'[Date]))`, `PY = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))`.
  - **RLS roles** (per-file): `role <Name>` → `modelPermission: read` (or `readRefresh`) → `tablePermission <Table> = <DAX filter>` (e.g. `[Region] = "East"`). One tablePermission per table; add `ref role` in model.tmdl. **Role *membership* is NOT in TMDL** — assigned via Power BI REST API after deploy (see below).
  - **Translations**: `cultureInfo <locale>` → `translations` → `model Model` → `table`/`column` → `caption:`/`description:`. Don't include `linguisticMetadata` (auto).
  - **Perspectives**: `perspective <Name>` → `perspectiveTable <T>` (`includeAll` OR list `perspectiveColumn`/`perspectiveMeasure`).
  - **User-defined functions** (`functions.tmdl`): `function <Name> = <Signature> = <DAX>` single-line or triple-backtick multi-line.
  - **Calendar objects** (date intelligence on Date table): `calendar '<Name>'` → `calendarColumnGroup = year/month/date` with `primaryColumn:`/`associatedColumn:`.
- **Source path**: `skills/powerbi-authoring-cli/references/tmdl-advanced-features-guide.md`
- **Quality**: 5 — load-bearing syntax our write tools must match; the `database` declaration + `ref` + `formatStringDefinition` gotchas are the kind that break round-trips.
- **Recommendation**: **adopt-as-is** for calc-group/rls knowledge skills; **adapt** into our TMDL-emitter MCP tool's templates.

### Semantic-model authoring lifecycle + agentic workflow + Must/Prefer/Avoid + troubleshooting → maps to `pbi-build`/`modify` pipeline skills + model-builder subagent
- **What it is / why valuable**: A complete end-to-end recipe (discover→design star schema→author TMDL→create relationships→measures→deploy→verify→refresh→validate-with-DAX) plus hard guardrails and a symptom→cause→fix table. This is the template for our pipeline skills and the model-builder's operating procedure. The *sequencing* is transferable even though the transport (az rest) is not.
- **Key content (recipes/guardrails)**:
  - **Agentic workflow steps**: (1) discover workspace (2) list semantic models (3) analyze source schema (4) design star schema — identify fact/dim, relationship keys, plan measures (5) author TMDL parts (6) **create relationships before dependent measures** (7) add explicit measures w/ `formatString` for all aggregatables (8) deploy (single create-with-definition POST) (9) verify (10) refresh (11) validate with DAX.
  - **Tool-selection priority**: MCP available → use MCP for fine-grained object changes (measures/columns/relationships); MCP unavailable + files → edit TMDL + updateDefinition; workspace only → getDefinition→edit→updateDefinition. (Our analog: prefer fine-grained MCP edits over full-definition round-trips.)
  - **Post-creation validation checklist**: verify all required parts present; `EVALUATE { [Measure] }` per measure; verify relationship cardinality + cross-filter + matching dataType; verify `sourceColumn`+dataType vs source; no duplicate/orphan objects.
  - **Definition-envelope rules (CRITICAL, transferable to our writer)**: `updateDefinition` **replaces the entire definition** — must include ALL parts (modified + unmodified); omitted parts are **deleted**. **Never include `.platform`** in update payloads (Git metadata; or use `?updateMetadata=true` to update name/desc). Required parts: `definition.pbism`, `definition/database.tmdl`, `definition/model.tmdl`, `definition/tables/<T>.tmdl` (≥1). Prefer create-with-definition over create-then-update. Prefer TMDL over TMSL.
  - **AVOID list worth mirroring**: report creation is NOT in this skill (separate PBIR format); no manual `lineageTag`; no `//` comments / `description` prop in TMDL; no hardcoded workspace/item IDs (resolve dynamically); don't send only modified parts.
  - **Troubleshooting early-abort rule**: if getDefinition `404 EntityNotFound` on a listable item AND refresh `403 "identity None"` → user is **Viewer**; stop retrying, check `roleAssignments`. (Permission-failure-as-404 masquerade is a great pattern for our error messaging.)
  - **DAX gotcha**: `INFO.ROLES()`/`INFO.ROLEMEMBERSHIPS()` don't reliably return role members — use the REST API users endpoint instead.
- **Source path**: `skills/powerbi-authoring-cli/SKILL.md`
- **Quality**: 5 — the most directly reusable agent recipe in the pack.
- **Recommendation**: **adapt** (lift workflow + validation checklist + envelope rules + Must/Prefer/Avoid into our pipeline skills; drop az-rest commands).

### Read-only DAX metadata discovery via `INFO.VIEW.*` / `INFO.*` → maps to data-analyst + model-reviewer subagents, `audit` pipeline, our DAX-query MCP tool
- **What it is / why valuable**: A disciplined, scalable metadata-discovery methodology: scope-estimate first, then progressive filtered/projected INFO queries to avoid context bloat. This is exactly how our analyst/reviewer should explore an unknown model, and a great default behavior for our consumption MCP tool.
- **Key content**:
  - **Recommended discovery order**: (1) scope-estimate counts → (2) `INFO.VIEW.TABLES()` → (3) `INFO.VIEW.COLUMNS()` + `INFO.VIEW.MEASURES()` → (4) `INFO.VIEW.RELATIONSHIPS()` → (5) deeper INFO as needed.
  - **Scope-estimate query** (run before deep discovery):
    ```dax
    EVALUATE ROW(
      "TableCount", COUNTROWS(INFO.VIEW.TABLES()),
      "ColumnCount", COUNTROWS(INFO.VIEW.COLUMNS()),
      "MeasureCount", COUNTROWS(INFO.VIEW.MEASURES()),
      "RelationshipCount", COUNTROWS(INFO.VIEW.RELATIONSHIPS()))
    ```
  - **High-value INFO.VIEW columns**: TABLES(`Name,DataCategory,StorageMode,IsHidden,Expression,CalculationGroupPrecedence,LineageTag`); COLUMNS(`Table,Name,DataType,DataCategory,IsHidden,SummarizeBy,Expression,SortByColumn,FormatString`); MEASURES(`Table,Name,Expression,FormatString,State,DisplayFolder,KPIID`); RELATIONSHIPS(`FromTable,FromColumn,ToTable,ToColumn,FromCardinality,ToCardinality,CrossFilteringBehavior,SecurityFilteringBehavior,IsActive`).
  - **Narrowing pattern** (avoid output bloat): `SELECTCOLUMNS(FILTER(INFO.VIEW.COLUMNS(), [Table]="X"), "Column",[Name],"DataType",[DataType])`. Probe schema with `TOPN(0, INFO.VIEW.COLUMNS())`.
  - **Dependency discovery**: `INFO.DEPENDENCIES("QUERY", _Query)` for a DAX query's dependency graph; `FILTER(INFO.DEPENDENCIES(), [OBJECT_TYPE]="MEASURE" && [TABLE]="Sales" && [OBJECT]="Total Sales")` scoped to a measure; reverse via `[REFERENCED_OBJECT_TYPE]/[REFERENCED_TABLE]/[REFERENCED_OBJECT]` (column names vary by engine — probe unfiltered first). Useful for our impact-analysis / dax-reference-check feature.
  - **Object→INFO map** (subset for our purposes): Model→`INFO.MODEL`; Hierarchies→`INFO.HIERARCHIES,INFO.LEVELS`; Calc groups→`INFO.CALCULATIONGROUPS,INFO.CALCULATIONITEMS`; Roles→`INFO.ROLES,INFO.TABLEPERMISSIONS,INFO.COLUMNPERMISSIONS`; Partitions→`INFO.PARTITIONS,INFO.REFRESHPOLICIES`; UDFs→`INFO.USERDEFINEDFUNCTIONS`.
  - **Permission note**: treat `INFO.VIEW.*` + data queries as available to any reader; assume other `INFO.*` may need elevated perms (fall back to INFO.VIEW.* on permission error).
- **Source path**: `skills/powerbi-consumption-cli/SKILL.md` + `references/discovery-queries.md`
- **Quality**: 5 — the progressive-discovery + projection discipline is a standout pattern for keeping agent context lean.
- **Recommendation**: **adopt-as-is** (the DAX queries are portable; encode discovery-order + narrowing as the analyst/reviewer default).

### Property-to-API mapping & storage modes (semantic model metadata spread across 3 surfaces) → reference for our model-reviewer / audit completeness
- **What it is / why valuable**: Documents that model properties live across Fabric Items API, Power BI Datasets API, and the TMDL itself — so any "describe this model" feature must combine sources. Useful as a checklist of what metadata exists even if we read it differently.
- **Key content**: `targetStorageMode` values `Abf`(Direct Lake)/`PremiumFiles`(Import on Fabric)/`Import`; `isRefreshable` always false for DQ/LiveConnection; per-table mode in TMDL partitions = `directLake`/`import`/`directQuery`. Refresh-history fields (`refreshType,status,serviceExceptionJson,refreshAttempts[]`). Read-only callers get limited dataset metadata (id+name only). Direct Lake source connection is discoverable from the M expression in TMDL.
- **Source path**: `skills/powerbi-authoring-cli/references/semantic-model-properties-guide.md`
- **Quality**: 3 — mostly REST-surface specifics (reference-only for us), but the storage-mode taxonomy + "metadata is multi-source" insight is useful.
- **Recommendation**: **reference-only**.

### Direct Lake + Import + calculated-table TMDL partition patterns → maps to `tmdl-conventions` / bi-pattern-library + our TMDL emitter
- **What it is / why valuable**: Concrete, copyable partition syntax for the three storage modes — the part our writer most needs to get exactly right.
- **Key content**:
  - **Import partition**: `partition Customer = m` / `mode: import` / `source = let ... in ...` referencing `#"Server"`/`#"Database"`.
  - **Direct Lake**: define a **named expression first** pointing to the Lakehouse (`AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/<WsId>/<LhId>", [HierarchicalNavigation=true])`), then `partition Sales = entity` / `mode: directLake` / `source` with `entityName:`, `schemaName:`, `expressionSource:`. Constraints: ALL partitions must be entity-source (no M); `binary` columns unsupported; columns map via `sourceColumn` with no transforms.
  - **Calculated table**: `partition <Name> = calculated` / `mode: import` / `source = <DAX>` (e.g. measures-only table `ROW("Dummy", BLANK())`).
- **Source path**: `skills/powerbi-authoring-cli/SKILL.md` (Minimal TMDL examples) + tmdl-authoring-guide.md
- **Quality**: 5.
- **Recommendation**: **adopt-as-is** as emitter templates.

### Power Query M / Dataflows Gen2 structure → maps to `m-query-patterns` shared-knowledge skill
- **What it is / why valuable**: First-party reference for the **section-document** M format, multi-query references, parameters, connection model, and the read-modify-write definition lifecycle — the foundation our `m-query-patterns` skill needs. Note: this targets Dataflows Gen2 (3-part definition), but the M-language structure applies equally to semantic-model M partitions.
- **Key content**:
  - **mashup.pq section format**: `[StagingDefinition = [Kind = "FastCopy"]]` (optional, enables fast copy) → `section Section1;` → `shared QueryName = let ... in ...;` per query. Queries reference each other by name within the section.
  - **Multi-query + join example**: `Table.NestedJoin(Customers,{"CustomerID"},Orders,{"CustomerID"},"OrderData",JoinKind.Inner)` then `Table.ExpandTableColumn(...)`.
  - **Parameters**: `shared ServerName = "..." meta [IsParameterQuery=true, Type="Text"];` (types: Text, True/False, Decimal Number, Date/Time, Date, Time, Date/Time/Timezone, Duration, Binary, Any). Params in mashup must also appear in `queriesMetadata`.
  - **Connection model**: `connections[]` in queryMetadata.json with `path`/`kind`/`connectionId`. Kind↔M-function↔path map: `Lakehouse`→`Lakehouse.Contents()`; `Sql`→`Sql.Database()` (`server;db`); `Web`→`Web.Contents()`; `SharePoint`→`SharePoint.Contents()`; `AzureDataLakeStorage`→`AzureStorage.DataLake()`. Connections **must pre-exist** in the connection store.
  - **queryMetadata.json**: `formatVersion: "202502"` (required); `loadEnabled: true` = query writes output; `computeEngineSettings.allowFastCopy`; `parametric: true` when exposing params.
  - **Definition lifecycle**: 3 parts (`queryMetadata.json`, `mashup.pq`, `.platform`), each base64; `getDefinition` is a **POST** (LRO); `updateDefinition` is a **full replacement** — send all 3 parts or queries are silently dropped; `?updateMetadata=true` to apply `.platform` (display name).
  - **Query classification heuristic** (for audit): `loadEnabled→OUTPUT`, else `isHidden→HELPER`, else `STAGING`.
- **Source paths**: `common/DATAFLOWS-AUTHORING-CORE.md`, `skills/dataflows-authoring-cli/SKILL.md` + references, `skills/dataflows-consumption-cli/references/discovery-queries.md`
- **Quality**: 5 for M-language structure; the dataflow REST/CLI plumbing is reference-only.
- **Recommendation**: **adapt** (extract M-language patterns + connection-kind table + query classification into `m-query-patterns`; mark the Gen2 3-part REST lifecycle reference-only).

### Medallion architecture (Bronze/Silver/Gold) + Gold→Power BI Direct Lake consumption → maps to `bi-pattern-library` + report-builder/model-builder pipeline
- **What it is / why valuable**: Microsoft's canonical layered-lakehouse design, plus the explicit "connect Power BI to the Gold layer via Direct Lake" recipe — useful architectural context for how our semantic models sit atop a medallion source. The PySpark/Delta specifics are external-tool/reference-only, but the layer profiles and the Gold→PBI flow are reusable guidance.
- **Key content (the BI-relevant parts)**:
  - **Layer profiles**: Bronze = raw, write-optimized, append-only, partition by ingestion date, +metadata cols (ingestion ts, source file, batch id). Silver = cleaned/deduped/conformed, schema enforcement, partition by business date. Gold = aggregated, **read-optimized for Power BI** — V-Order (`spark.sql.parquet.vorder.default=true`) + Optimize Write (`binSize=1g`) + ZORDER on filter cols; pre-aggregate metrics.
  - **Gold→Power BI recipe**: discover Gold lakehouse SQL endpoint (`properties.sqlEndpointProperties.connectionString`, wait for provisioning `Success`) → verify tables via SQL → create **Direct Lake** semantic model on Gold delta tables (match table/column names exactly) with key measures → create PBIR report with visuals (line=trend, card=KPI, bar=by-category, table=detail) → validate via DAX. **Prefer Direct Lake** (no data duplication).
  - **Principle worth adopting**: "complete the full end-to-end flow — don't stop after creating notebooks/models; bind, execute, verify, connect, validate" — mirrors our pipeline-completeness ethos.
- **Source path**: `skills/e2e-medallion-architecture/SKILL.md`
- **Quality**: 4 (BI-relevant slices) — the Spark engineering is out of scope; the layering + Gold-serving + Direct Lake guidance is solid.
- **Recommendation**: **adapt** (capture layer profiles + Gold→PBI Direct Lake recipe in bi-pattern-library; mark PySpark/Delta engineering reference-only).

### Subagent design pattern: personality + purpose + Must/Prefer/Avoid + delegation → maps to our 5 subagents' design
- **What it is / why valuable**: Microsoft's agent files show a clean, repeatable structure for authoring worker agents — a frontmatter `delegates_to` list, a vivid persona, an explicit workflow, and Must/Prefer/Avoid constraint blocks. This is a direct template for how we write data-analyst/model-builder/model-reviewer/report-builder/report-reviewer.
- **Key content**:
  - **Structure**: YAML frontmatter (`name`, multi-line `description` with trigger phrasing, `delegates_to:` list) → `## Personality` → `## Purpose` → `## Core workflows`/`## Delegation Rules` → `## Must` / `## Prefer` / `## Avoid`.
  - **Orchestrator→worker delegation**: `FabricDataEngineer` decomposes broad requests then routes to single-purpose skills via an explicit "Route X → skill Y" table — the same orchestration shape we want (pipeline skill delegates to worker subagents).
  - **Reusable Must/Avoid themes**: never hardcode IDs/secrets; require explicit env parameterization (dev/test/prod); validate at each phase before proceeding; require confirmation before destructive ops; "complex calculated columns in semantic models → use measures instead" (AGENTS.md); "assess before acting / surface blockers explicitly" (migration agent).
  - **Workspace-documentation workflow** (FabricAdmin) is a near-perfect spec for a future "document this model/report" feature: be concise, skip column-level detail, call out interesting business logic, write per-artifact markdown + a conversational summary.
- **Source paths**: `agents/FabricAdmin.agent.md`, `agents/FabricDataEngineer.agent.md`, `agents/FabricAppDev.agent.md`, `agents/FabricMigrationEngineer.agent.md`, `AGENTS.md`, `CLAUDE.md`
- **Quality**: 4 — strong structural template; content is Fabric-broad (much is non-PBI), so mine the *shape* and the PBI/parameterization rules.
- **Recommendation**: **adapt** (adopt the frontmatter+persona+Must/Prefer/Avoid+delegation template for our subagents).

### Plugin + MCP wiring (marketplace.json with skills+agents+mcpServers; real Microsoft Power BI MCP) → maps to our plugin manifest + MCP integration patterns
- **What it is / why valuable**: Shows how Microsoft packages a Claude/Copilot plugin: a single `marketplace.json` lists `skills[]`, `agents[]`, and `mcpServers{}`. Critically, it registers an **official Microsoft-hosted Power BI MCP** — concrete proof of the MCP surface our project parallels.
- **Key content**:
  - **Official MCP**: `"PowerBIQuery": { "type": "http", "url": "https://api.fabric.microsoft.com/v1/mcp/powerbi", "tools": ["ExecuteQuery"] }` — a remote HTTP MCP exposing a single `ExecuteQuery(artifactId, daxQuery)` tool. (The consumption skill notes this is the "ONLY supported path" for read-only model queries.) Validates our approach and is a real endpoint to reference.
  - **Skills-vs-MCP doctrine** (worth echoing in our docs): "Skills teach the AI *what to do*; MCP servers *do it*." Skills = knowledge/patterns (markdown, loaded into context); MCP = data access (separate process). Don't embed MCP configs inside skills (separation of concerns, security, reusability).
  - **Bundle scoping**: focused bundles (`fabric-authoring`/`consumption`/`operations`) install only relevant skills; MCP config is scoped per bundle (consumption bundle ships the Power BI MCP; authoring doesn't). Good model for our thin-CRUD vs pipeline skill packaging.
  - **Skill naming convention**: `<workload>-<authoring|consumption|operations>-cli` — clear capability split (authoring=write, consumption=read-only, operations=diagnostics). Maps to our build/modify vs audit split.
  - **check-updates pattern**: once-per-session/once-per-7-days update check storing a UTC marker at `~/.config/<collection>/last-update-check.json`; compares local manifest `version` vs remote — a tidy housekeeping-skill design if we want one.
- **Source paths**: `.claude-plugin/marketplace.json`, `docs/mcp-servers-guide.md`, `mcp-setup/README.md`, `skills/check-updates/SKILL.md`, `CHANGELOG.md`, `README.md`
- **Quality**: 4 — directly informative for our plugin manifest + MCP framing.
- **Recommendation**: **adapt** (mirror the manifest shape + skills-vs-MCP doctrine + naming convention; reference the official Power BI MCP endpoint).

### ITEM-DEFINITIONS-CORE: canonical SemanticModel (TMDL) & Report (PBIR) part paths → maps to our PBIR+TMDL read/write/validate MCP tools
- **What it is / why valuable**: Authoritative file-layout spec for the two item types we author. Confirms exact part paths our read/write/validate tools must produce/consume.
- **Key content**:
  - **SemanticModel (TMDL preferred)**: `definition/database.tmdl`, `definition/model.tmdl`, `definition/tables/<T>.tmdl`, `definition.pbism`, optional `diagramLayout.json`, `.platform`. (TMSL alt: `model.bim` + `definition.pbism`.)
  - **Report (PBIR preferred over PBIR-Legacy)**: `definition/report.json`, `definition/version.json`, `definition/pages/pages.json`, `definition/pages/<pageId>/page.json`, `definition/pages/<pageId>/visuals/<visualId>/visual.json`, `definition.pbir` (semantic-model reference). PBIR-Legacy = single `report.json` + `definition.pbir`. **`definition.pbir` only supports `byConnection` references via REST (not `byPath`)** — relevant constraint for our report writer. `StaticResources/RegisteredResources/*` for custom visuals/images/themes; `BaseThemes/*` for base themes.
  - **Definition envelope** (universal): `{ definition: { format, parts: [{ path, payload(base64), payloadType:"InlineBase64" }] } }`. `.platform` returned by get, optional on create, accepted on update only with `?updateMetadata=true`.
  - **VariableLibrary** (env-parameterization item): `variables.json` + `settings.json` (+ `valueSets/<env>.json`); types String/Boolean/Number/Integer/DateTime/ItemReference; useful pattern for our env-override story.
- **Source path**: `common/ITEM-DEFINITIONS-CORE.md`
- **Quality**: 5 — the authoritative PBIR/TMDL layout, with the per-page/per-visual PBIR granularity our tools target.
- **Recommendation**: **adopt-as-is** (validate our PBIR/TMDL part paths against this; encode the `byConnection`-only constraint).

### Dataflow save-as risk assessment: 7 migration-readiness signals → maps to `audit`/`fix-model` pipeline pattern (general "readiness scan" recipe)
- **What it is / why valuable**: A structured pre-flight risk-scan (detect→classify Safe/Warning/Blocker→remediate) that's a reusable *shape* for any "is this model/report ready for X?" audit, even though the specific signals are dataflow-migration-only.
- **Key content**: 7 signals with severity — DirectQuery partitions (blocker), BYOSA/custom ADLS storage (blocker), caller-not-owner/insufficient-role (blocker), linked/computed entities (warn/blocker by upstream state), incremental refresh (warn), Power Automate/API triggers (warn), downstream pipeline deps (warn). Composite rule: any blocker→Blocked; only warnings→Manual followups; none→Safe. Each signal = detection method + classification thresholds + remediation steps.
- **Source path**: `skills/dataflows-save-as-authoring-cli/references/risk-assessment-guide.md`
- **Quality**: 3 — specific signals are out of scope, but the detect/classify/remediate audit framework is a good template for our model/report audit skill.
- **Recommendation**: **reference-only** (borrow the audit framework shape, not the signals).

### End-to-end task prompt examples → reference for our pipeline-skill acceptance tests / demo prompts
- **What it is / why valuable**: Real natural-language task prompts Microsoft ships as demos — useful as exemplars for our pipeline-skill triggers and as integration-test scenarios.
- **Key content**: "NYC Taxi medallion → clean dim/fact tables → SQL aggregate view → **generate a Power BI semantic model incl. dimension+fact tables + measures for all aggregations** → ask which workspace before deploying"; "Document my workspace"; "Analyze warehouse data → outlier analysis + 3-month forecast → PDF". Note the consistent "ask before deploying / ask which workspace" confirmation gate.
- **Source path**: `prompt_examples/*.txt`
- **Quality**: 3.
- **Recommendation**: **reference-only** (use as demo/test prompts).

## Cross-source overlap flags
- **TMDL conventions / DAX best practices**: heavy overlap expected with the data-goblin repos, `awesome-copilot-pbi-data`, `dg3-semantic-models`, and `dg1-pbip`. This Microsoft source is **first-party/authoritative** — when rules conflict (e.g., avoid `IFERROR`, no `Fact`/`Dim` prefixes, single surrogate key, `DIVIDE` over `/`), prefer this one as the canonical baseline. Consolidation should de-dupe against those repos and cite this as the source of truth.
- **Power BI MCP / ExecuteQuery + INFO discovery**: overlaps with `powerbi-agentic-plugins` and `powerbi-modeling-mcp` references seen here; the official `https://api.fabric.microsoft.com/v1/mcp/powerbi` endpoint is the authoritative read-query MCP — reconcile our MCP tool naming against it.
- **PBIR report structure**: overlaps with `dg2-reports` (which is report-deep). Cross-check the per-page/per-visual PBIR layout here against dg2-reports for the fuller visual.json schema.
- **Medallion / Direct Lake**: overlaps with any Fabric-infra source; keep only the BI-serving slice (Gold→Direct Lake) and defer Spark/Delta depth to the data-engineering repos.
- **Agent design + Must/Prefer/Avoid template**: overlaps with claude-skills/plugin-marketplace repos on skill-authoring conventions; this gives a concrete Fabric-flavored instance.

## Discarded / not relevant
- **All `az rest`/`curl`/`base64`/`jq` CLI command bodies and the bash/PowerShell script templates** — external-tool, non-Node runtime. We keep the *recipes/sequencing/envelope rules* but discard the binary-dependent commands (e.g., `skills/dataflows-authoring-cli/references/authoring-script-templates.md` is reference-only).
- **`common/notebook-authoring/*`** (connections, lakehouse-paths/tables, ml-workflow, library-mgmt, troubleshooting) — PySpark/`notebookutils` runtime, not Power BI authoring.
- **Spark skill + resources** (`spark-authoring-cli`, data-engineering-patterns, infrastructure-orchestration, notebook-api-operations) — Spark/Delta engineering; out of scope (V-Order/ZORDER noted only as Gold-serving context).
- **SQLDW / Warehouse cores** (`SQLDW-*-CORE.md`, `sqldw-authoring-cli`) — T-SQL/warehouse; not our authoring surface (SQL-endpoint discovery noted only as Direct Lake source context).
- **Real-Time Intelligence**: `EVENTHOUSE-*`, `EVENTSTREAM-*`, `activator-authoring-cli` + all its references (action-types, kql-source, rule-conditions, etc.) — KQL/streaming/Reflex; lower-priority Fabric-infra, not Power BI authoring.
- **`FabricAppDev`/`FabricMigrationEngineer` deep content** — Python app-building and Synapse/Databricks/HDInsight migration; only the agent-file *structure* and generic Must/Avoid rules were mined.
- **`COMMON-CLI.md` / `COMMON-CORE.md` auth+token+`az rest` plumbing** — CLI/REST transport mechanics (token audiences, LRO via `az`); reference-only (the conceptual LRO/pagination idea is generic, the implementation is non-Node).
- **`CODE_OF_CONDUCT.md`, `SECURITY.md`, `mcp-setup/register-*.{sh,ps1}`, `plugins/fabric-authoring/**` duplicates** — boilerplate / duplicated copies of the top-level `skills/` content (the pack duplicates everything under `plugins/fabric-authoring/`; mined the top-level canonical versions only).
