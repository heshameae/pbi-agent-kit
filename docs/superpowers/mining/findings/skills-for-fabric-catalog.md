# Mining findings: microsoft/skills-for-fabric — catalog/ops slice
Source: skills-for-fabric-2-catalog.xml

## Relevance summary
Roughly 60-65% of this slice is LOW relevance (Spark/Delta, SQL DW/T-SQL, Eventhouse/KQL, Eventstream, Activator, and Databricks/Synapse/HDInsight migrations) — discarded per the relevance bar. The HIGH-value remainder is excellent and falls in two buckets: (a) the **catalog/plugin packaging + auto-trigger description-craft** structure, which is the most transferable single takeaway and directly informs how we package pbi-mcp-ts and write skill frontmatter; and (b) two directly-PBI skills (`powerbi-authoring-cli`, `powerbi-consumption-cli`) plus the shared `ITEM-DEFINITIONS-CORE` and a `check-updates` lifecycle skill, which map cleanly onto our subagents, shared-knowledge skills, refresh/deploy concepts, and DAX metadata discovery. Note the az-rest/curl CLI runtime is external-tool/non-Node (reference-only); the *structure, guardrails, and recipes* are what transfer.

## High-value extractions

### Plugin manifest = catalog packaging via bundle variants → maps to our plugin packaging / `.github/plugin/plugin.json`
- What it is / why valuable: One repo ships THREE plugin manifests that are *bundle variants* over a single shared `skills/` dir — `fabric-consumption` (read/query subset), `fabric-operations` (diagnostics subset), and `fabric-skills` (complete bundle). Each manifest lists the *same* skills by relative path, so skills are authored once and re-exposed in multiple curated bundles. This is exactly the "how a large multi-plugin skills catalog is structured" question we care about.
- Key content (manifest schema, reusable as-is):
  ```json
  {
    "$schema": "https://json-schema.org/draft-07/schema",
    "name": "fabric-consumption",
    "description": "Consumer skills for interactive ... operations - queries, exploration, monitoring",
    "version": "0.3.1",
    "license": "MIT",
    "repository": "https://github.com/microsoft/skills-for-fabric",
    "keywords": ["fabric", "microsoft-fabric", "consumption", "query", "exploration"],
    "skills": ["./skills/check-updates", "./skills/powerbi-consumption-cli", ...],
    "agents": ["./agents/FabricAdmin.agent.md", "./agents/FabricDataEngineer.agent.md", "./agents/FabricAppDev.agent.md"],
    "mcpServers": { "PowerBIQuery": { "type": "http", "url": "https://api.fabric.microsoft.com/v1/mcp/powerbi", "headers": {}, "tools": ["ExecuteQuery"] } }
  }
  ```
  - Bundle composition idea for us: a `pbi-modeling` bundle, a `pbi-reporting` bundle, and a `pbi-all` complete bundle, all referencing the same underlying skills + worker subagents.
  - `mcpServers` is declared *inline in plugin.json* AND mirrored in a sibling `.mcp.json` (identical content) — so the MCP server is registered both at plugin-manifest level and at repo level. Worth replicating for our MCP tools.
  - `keywords` array per bundle aids discoverability/search in a marketplace.
- Source path: `plugins/fabric-consumption/.github/plugin/plugin.json`, `plugins/fabric-operations/.github/plugin/plugin.json`, `plugins/fabric-skills/.github/plugin/plugin.json`, plus `plugins/*/.mcp.json`
- Quality: 5 — clean, schema-validated, real-world multi-bundle layout.
- Recommendation: adapt (mirror the bundle-variant + inline-mcpServers structure for pbi-mcp-ts)

### Auto-trigger SKILL.md description template → maps to ALL our skill frontmatter (the single biggest takeaway)
- What it is / why valuable: Every one of the 23 skills uses an IDENTICAL, highly-disciplined `description: >` frontmatter shape engineered for reliable auto-triggering. This is the "auto-trigger description craft" we explicitly came for. The formula is consistent enough to adopt as a house style.
- The formula (4 parts):
  1. One sentence: what the skill does + scope boundary (often emphatic, e.g. "The ONLY supported path for read-only ... query interactions").
  2. A numbered use-case list `Use when the user wants to: (1) ... (2) ... (N) ...`.
  3. Explicit cross-skill routing INSIDE the description (e.g. "For read-only DAX queries, use `powerbi-consumption-cli`. For fine-grained modeling changes, route to `powerbi-modeling-mcp`.").
  4. A literal `Triggers:` line listing quoted natural-language phrases a user might say.
- Verbatim exemplars (paste-and-adapt):
  ```yaml
  # powerbi-authoring-cli
  description: >
    Create, manage, and deploy Power BI semantic models inside Microsoft Fabric workspaces ...
    Use when the user wants to:
    (1) create a semantic model from TMDL definition files,
    (2) retrieve or download semantic model definitions,
    (3) update a semantic model definition with modified TMDL,
    (4) trigger or manage dataset refresh operations,
    (5) configure data sources, parameters, or permissions,
    (6) deploy semantic models between pipeline stages.
    For read-only DAX queries, use `powerbi-consumption-cli`.
    For fine-grained modeling changes, route to `powerbi-modeling-mcp`.
    Triggers: "create semantic model", "upload TMDL", "download semantic model TMDL",
    "refresh dataset", "semantic model deployment pipeline", "dataset permissions",
    "list dataset users", "semantic model authoring".

  # powerbi-consumption-cli
  description: >
    The ONLY supported path for read-only ... Power BI semantic model ... query interactions.
    Execute DAX queries via the MCP server ExecuteQuery tool to: (1) discover semantic model metadata
    (tables, columns, measures, relationships, hierarchies, etc.), (2) retrieve data from a semantic model.
    Triggers: "DAX query", "semantic model metadata", "list semantic model tables", "run EVALUATE", "get measure expression".
  ```
- Source path: every `skills/*/SKILL.md` frontmatter (esp. `powerbi-authoring-cli/SKILL.md`, `powerbi-consumption-cli/SKILL.md`, `search-consumption-cli/SKILL.md`, `check-updates/SKILL.md`)
- Quality: 5 — uniform, deliberate, demonstrably designed for trigger precision + disambiguation.
- Recommendation: adopt-as-is (make this the mandatory frontmatter template for all pbi-mcp-ts skills)

### Subagent (`*.agent.md`) structure with `delegates_to` frontmatter → maps to our worker subagents (data-analyst, model-builder, model-reviewer, report-builder, report-reviewer)
- What it is / why valuable: Three persona agents (FabricAdmin, FabricAppDev, FabricDataEngineer) each authored as a Markdown file with structured frontmatter and a consistent body skeleton. The `delegates_to:` frontmatter list is the routing contract from an orchestrator agent to specialist skills — directly analogous to our orchestrator → worker-subagent pipeline.
- Key content:
  - Frontmatter shape: `name`, `description: >` (same what+`Use when`+`Delegates ...` formula as skills), and `delegates_to:` (YAML list of skill names). Note one agent even delegates to *another agent* (`FabricMigrationEngineer`) — agents can route to agents.
  - Body skeleton (reusable section order): `## Personality` → `## Purpose` → `## Core workflows` / `## Workflow when asked to ...` → `## Delegation Rules` (prose mapping of "route to X for Y") → `## Relevant documentation` → `## Must` / `## Prefer` / `## Avoid`.
  - The `## Must/Prefer/Avoid` guardrail triad recurs in BOTH agents and skills — a strong convention to standardize on. Examples of dataset-agnostic guardrails worth lifting: "Externalize all secrets/connection strings", "Require explicit confirmation before destructive operations", and repeatedly "Avoid hardcoded tenant/workspace/item IDs — resolve dynamically via REST API."
- Source path: `plugins/fabric-consumption/agents/FabricAdmin.agent.md`, `.../FabricAppDev.agent.md`, `.../FabricDataEngineer.agent.md` (duplicated across all three plugins)
- Quality: 4 — strong structure; personality prose is verbose/flavored (trim for our use); the explicit `delegates_to` + `## Delegation Rules` pairing is the gem.
- Recommendation: adapt (adopt the frontmatter `delegates_to` + Must/Prefer/Avoid skeleton; drop the heavy persona prose)

### `powerbi-authoring-cli` SKILL.md — full semantic-model lifecycle → maps to model-builder subagent + tmdl-conventions + pbi-status/refresh + thin CRUD skills
- What it is / why valuable: The most on-target file in the slice. End-to-end semantic-model authoring via TMDL definition envelopes, refresh, data sources/params, permissions, RLS role membership, and deployment pipelines. The CLI mechanics are external-tool/non-Node (reference-only), but the *workflow, guardrails, troubleshooting, and TMDL conventions* transfer fully.
- Key transferable content:
  - **Massive Table-of-Contents-as-index pattern**: SKILL.md opens with a giant table mapping Task → Reference link → Notes, pointing into `references/*.md` and shared `common/*` docs. This keeps the skill body lean while making deep refs discoverable — a structure we should copy for our larger skills.
  - **TMDL convention rules** (dataset-agnostic, adopt into tmdl-conventions): tab indentation; measures-before-columns ordering; single-quote names containing spaces/`.`/`=`/`:`/`'`; use `///` description syntax NOT `description:` property and NOT `//` comments; never hand-write `lineageTag` (auto-generated → conflicts); `defaultPowerBIDataSourceVersion: powerBI_V3` required for Import models; Import vs Direct Lake partition examples (`mode: import` w/ M source vs `mode: directLake` w/ `entityName`/`schemaName`/`expressionSource`).
  - **Required TMDL parts** (matches our PBIP layout): `definition.pbism`, `definition/database.tmdl`, `definition/model.tmdl`, `definition/tables/<T>.tmdl`.
  - **Refresh/deploy concepts** (map to pbi-status/refresh): trigger refresh, refresh history (`?$top=N`), cancel in-progress refresh, get/update `refreshSchedule` (days/times/timezone), deployment pipelines (list → stages → deploy stage N→N+1 with allowCreate/allowOverwrite). These are concept/recipe gold even though the HTTP calls themselves are out of our Node scope.
  - **Agentic Workflow ordering** (adopt for model-builder): discover workspace → list models → analyze source schema → design star schema → author TMDL → **create relationships BEFORE measures that depend on them** → add measures with `formatString` for every aggregatable value → deploy → verify → refresh → validate with DAX.
  - **Post-creation validation checklist** (adopt for model-reviewer): all required parts present; `EVALUATE { [Measure] }` per measure; verify relationship cardinality/cross-filter/matching dataType on both sides; verify `sourceColumn`/`dataType` vs source; no duplicate measure names/orphans.
  - **Permission early-abort heuristic** (excellent for our error handling): "If getDefinition returns 404 on a listable item AND refresh API returns 403 'identity None', STOP retrying — it's a Viewer-role permission issue, not an API-usage issue; confirm via roleAssignments." Encodes "don't thrash on permission errors."
  - **Tool-selection priority** (maps to MCP-vs-file decision in our engine): MCP for fine-grained object edits > edit TMDL files + deploy > getDefinition→edit→updateDefinition. Plus the rule "send ALL definition parts on update (modified + unmodified) — API replaces the whole definition; omitted parts are deleted" and "never include `.platform` unless `?updateMetadata=true`."
- Source path: `plugins/fabric-skills/skills/powerbi-authoring-cli/SKILL.md` (+ `references/tmdl-authoring-guide.md`, `tmdl-advanced-features-guide.md`, `semantic-model-properties-guide.md`) — duplicated under `fabric-consumption/skills/`
- Quality: 5 — comprehensive, opinionated, dataset-agnostic; explicit "do not generate TMDL from memory — read the reference first."
- Recommendation: adapt (mine TMDL rules + workflow + validation + guardrails into our skills/subagents; mark the az-rest CLI calls reference-only/non-Node)

### `powerbi-consumption-cli` SKILL.md + discovery-queries.md — DAX metadata discovery & dependency analysis → maps to data-analyst + model-reviewer + dax-patterns
- What it is / why valuable: Read-only DAX patterns for introspecting any semantic model via `INFO.*` / `INFO.VIEW.*` rowsets, plus dependency/lineage queries. Entirely dataset-agnostic and directly usable by our review/analyst agents.
- Key transferable content:
  - **Metadata Object → INFO function map** (table) and a "frequently used INFO functions" shortlist: `INFO.VIEW.TABLES/COLUMNS/MEASURES/RELATIONSHIPS`, `INFO.MODEL`, `INFO.PARTITIONS`, `INFO.DEPENDENCIES`, `INFO.CALCULATIONGROUPS/ITEMS`, `INFO.ROLES`, `INFO.CULTURES`, storage internals, etc.
  - **Progressive-discovery / context-budget discipline** (adopt as a model-review principle): run a scope-estimation `ROW(COUNTROWS(...))` probe first; probe an INFO function's output schema with `TOPN(0, INFO.VIEW.COLUMNS())`; then narrow with `SELECTCOLUMNS(FILTER(INFO.VIEW.COLUMNS(), [Table]="X"), ...)` to avoid dumping full schemas into context. This is a reusable "don't blow the context window" technique for our agents.
  - **Dependency / impact analysis DAX** (gold for model-reviewer "what breaks if I change this measure"):
    ```dax
    -- forward deps for a query
    INFO.DEPENDENCIES("QUERY", "EVALUATE SUMMARIZECOLUMNS('Date'[Year], ""Sales"", [Sales])")
    -- deps of a measure
    FILTER(INFO.DEPENDENCIES(), [OBJECT_TYPE]="MEASURE" && [TABLE]="Sales" && [OBJECT]="Total Sales")
    -- reverse deps (what references a measure)
    FILTER(INFO.DEPENDENCIES(), [REFERENCED_OBJECT_TYPE]="MEASURE" && [REFERENCED_TABLE]="Sales" && [REFERENCED_OBJECT]="Total Sales")
    ```
  - **Permission-tiering note**: treat `INFO.VIEW.*` + data DAX as available to any reader; assume other `INFO.*` may need elevated perms. And: don't use DAX `INFO.ROLEMEMBERSHIPS()` for role members (assigned at service/Entra level post-deploy) — use the REST API instead. Useful accuracy guidance for our reviewer.
  - **Sample analytic query shape**: `DEFINE MEASURE ... EVALUATE SUMMARIZECOLUMNS(dim[col], "Label", [Measure]) ORDER BY ... DESC`.
- Source path: `plugins/fabric-skills/skills/powerbi-consumption-cli/SKILL.md` + `references/discovery-queries.md` (duplicated under `fabric-consumption/skills/`)
- Quality: 5 — clean, dataset-agnostic, immediately reusable DAX.
- Recommendation: adopt-as-is (fold INFO.* discovery + dependency DAX + progressive-discovery discipline into dax-patterns and the analyst/reviewer subagents)

### Shared `common/*-CORE.md` docs referenced by relative links → maps to our shared-knowledge skills (DRY pattern)
- What it is / why valuable: Skills DON'T duplicate foundational knowledge inline; they link into shared `common/COMMON-CORE.md`, `COMMON-CLI.md`, `ITEM-DEFINITIONS-CORE.md`, and per-workload `*-CORE.md` files via relative markdown links (`../../common/...#anchor`). This is the catalog mechanism for shared-knowledge reuse across many skills — exactly our tmdl-conventions/dax-patterns/etc. shared-skill concept.
- Key content:
  - `ITEM-DEFINITIONS-CORE.md` defines the universal **definition envelope** (`{definition:{format, parts:[{path,payload(base64),payloadType:"InlineBase64"}]}}`), the `.platform` metadata-file rules, and a **per-item-type support matrix**. Confirms: SemanticModel → `TMDL` (preferred) / `TMSL`; **Report → `PBIR` (preferred) / `PBIR-Legacy`** (relevant to our report-builder format choice); Notebook → `ipynb`.
  - Each CORE doc opens with a `> Purpose:` line and is organized by anchored sections so skills can deep-link precisely.
- Source path: `plugins/*/common/ITEM-DEFINITIONS-CORE.md`, `plugins/*/common/COMMON-CORE.md`, `COMMON-CLI.md`
- Quality: 4 — good DRY pattern; much of the CLI/Spark CORE content itself is out of our scope, but the *linking architecture* and the item-definition envelope/format matrix are valuable.
- Recommendation: adapt (replicate the "thin skill body + deep-linked shared-knowledge CORE docs" architecture; reuse the definition-envelope + PBIR/TMDL format facts)

### `check-updates` skill — plugin self-update / version lifecycle → maps to plugin maintenance + (loosely) pbi-status concepts
- What it is / why valuable: A dedicated maintenance skill that checks for marketplace updates once per session/week, with a robust, reusable lifecycle recipe. Every functional skill begins with a mandatory "Update Check — ONCE PER SESSION" callout that invokes it. Good model for a maintainable plugin.
- Key transferable content:
  - **Throttled-check via persistent marker file**: store `~/.config/<collection>/last-update-check.json` mapping plugin→last-check UTC date; skip if checked within 7 days. Emphasizes **UTC consistency** (`date -u +%Y-%m-%d`) to avoid timezone drift across environments.
  - **Version source resolution across install layouts**: read `version` from `.github/plugin/plugin.json` (plugin install) OR `package.json` (git clone); parse `repository` URL for owner/repo (with an explicit warning: "use owner string EXACTLY — LLMs sometimes auto-correct underscores to hyphens; don't").
  - **Tiered remote-version fetch**: Method A `git fetch origin main && git show origin/main:package.json` (clone) → Method B GitHub MCP `get_file_contents` (works for private) → Method C `GET /repos/{owner}/{repo}/releases/latest` (public only, fallback). Note 404 ≠ missing repo for private.
  - Plugin-rename/deprecated-alias handling (skills-for-fabric → fabric-skills, legacy id kept as alias) — a pattern if we ever rename our plugin.
- Source path: `plugins/fabric-skills/skills/check-updates/SKILL.md` (duplicated across plugins and top-level `skills/`)
- Quality: 4 — thorough and Node/git-friendly (git + GitHub API, not Spark/CLI); slightly over-engineered for our needs.
- Recommendation: reference-only / adapt-lightly (a trimmed UTC-throttled update check is worth having; the bundle-alias logic is contingency reference)

### `e2e-medallion-architecture` SKILL.md — orchestration/pipeline skill pattern → maps to our pipeline skills (orchestrator skeleton + "finish the whole flow" rule)
- What it is / why valuable: Mostly Spark/Delta (LOW relevance content), but the *shape* of a multi-step orchestration skill is a useful template for our pipeline skills, and it terminates in a Power BI step.
- Key transferable content:
  - **Numbered end-to-end orchestration workflow** with a strong completion guardrail: "**Complete the full end-to-end flow** — do not stop after creating notebooks; bind, execute sequentially, verify, and connect Power BI ... unless the user explicitly requests a partial setup." Good "don't leave it half-done" pattern for our pipelines.
  - **Step 8 connects to our world**: "Connect Power BI to Gold layer — discover the Gold lakehouse SQL endpoint, create a **Direct Lake semantic model**, create a report with visuals on the Gold summary table." Confirms Direct Lake + report-on-curated-layer as the consumption endpoint.
  - **"Guide the LLM to generate, don't paste full implementation code into skills"** — explicit anti-pattern listed under AVOID. A meta-principle for authoring our skills (keep recipes/patterns, not giant code dumps).
- Source path: `plugins/fabric-skills/skills/e2e-medallion-architecture/SKILL.md`
- Quality: 3 — domain content low-relevance, but the orchestration skeleton + completion guardrail + "guide-don't-paste" principle are worth lifting.
- Recommendation: reference-only (lift the orchestration skeleton + completion/"guide-don't-paste" guardrails; ignore the Spark specifics)

## Cross-source overlap flags
- **TMDL conventions / semantic-model authoring**: heavy overlap with the sibling findings `dg3-semantic-models.md` and `dg1-pbip.md`. The TMDL rules here (single-quote special-char names, `///` not `//`, no hand-written lineageTag, measures-before-columns, V3 for import, definition-envelope parts) should be de-duplicated against those during consolidation; treat this source as confirming/reinforcing rather than novel on TMDL syntax.
- **DAX patterns**: the `INFO.*` discovery + dependency DAX likely overlaps any dax-patterns extraction in sibling findings; this source's distinct contribution is the *dependency/reverse-dependency* queries and the *progressive-discovery context-budget* discipline.
- **Hooks / TE**: this slice has no hook content — the `dg4-te-fabric-hooks-root.md` sibling owns that; no overlap.
- **Refresh/deploy**: refresh + deployment-pipeline recipes here may overlap pbi-status/refresh notes elsewhere; this source adds the refreshSchedule + deployment-pipeline-stages specifics and the Viewer-role early-abort heuristic.

## Discarded / not relevant (substantial — as expected)
- **Spark authoring/consumption/operations** (`spark-*-cli`, all `references/*` like job-diagnostics, spark-history-server, jobinsight-api, performance-patterns, session-health, pipeline-diagnosis): Spark/Livy/PySpark + Fabric Spark diagnostics — non-Node data-engineering runtime, out of PBI scope. Only the orchestration-skeleton meta-pattern (captured above) survives.
- **SQL DW / Warehouse** (`sqldw-authoring/consumption/operations-cli` + `query-reference.md`, `script-templates.md`, T-SQL DMV slow-query analysis): T-SQL/warehouse runtime, not semantic-model/report authoring.
- **Eventhouse / KQL** (`eventhouse-*-cli`, KQL ingestion/query, `discovery-queries.md` for KQL): real-time/Kusto, unrelated to PBI authoring.
- **Eventstream** (`eventstream-*-cli`): streaming ingestion topology, out of scope.
- **Activator / Reflex** (`activator-*-cli` + `action-types.md`, `rule-conditions.md`, `*-source.md`): event-driven alerting/automation; the only mildly interesting bit (Teams/Email action bindings) is non-PBI. Discarded.
- **Dataflows** (`dataflows-authoring/consumption/save-as-authoring-cli`): Power Query/Dataflow Gen1→Gen2 lifecycle — adjacent to M-query but the content is CLI/CI-CD ops, not authoring patterns we can lift; discarded (note: our m-query-patterns shared skill is better served by dedicated M sources).
- **Migrations** (`databricks-migration`, `synapse-migration`, `hdinsight-migration` + all `resources/*` like dbutils-to-notebookutils, hive-to-delta, path-migration, utility-api-mapping, connectivity-migration): Spark/code migration mappings — entirely non-PBI, non-Node-runtime. Discarded.
- **Notebook-authoring common docs** (`common/notebook-authoring/*`: connections, lakehouse-paths/tables, library-mgmt, ml-workflow, troubleshooting): Spark notebook authoring; out of scope.
- **`COMMON-CLI.md` body, OneLake/`curl`, `az rest`/`az login`/`sqlcmd` recipes, capacity/shortcut CLI**: external-tool, non-Node runtime mechanics — reference-only context for the PBI skills above, not adopted as runtime.
- **Bulk duplication**: most skills/agents/common docs are physically duplicated 2-3x across `fabric-consumption/`, `fabric-operations/`, `fabric-skills/`, and top-level `skills/` (the bundle-variant structure). Only read one copy of each; the duplication itself is noted above as the packaging pattern.
