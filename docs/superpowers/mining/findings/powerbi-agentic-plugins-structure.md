# Mining findings: ruiromano/powerbi-agentic-plugins — structure/fabric/setup
Source: powerbi-agentic-plugins.xml

## Relevance summary
This Microsoft-authored repo is a multi-plugin Claude Code / GitHub Copilot marketplace (`powerbi` + `fabric` plugins) and is the closest structural sibling to pbi-mcp-ts: it ships a root `.claude-plugin/marketplace.json`, per-plugin `.mcp.json` MCP wiring, agent personas, and skills with carefully crafted auto-trigger descriptions and explicit cross-skill boundaries. High-value, directly transferable material: the marketplace/manifest shapes, the npx-based `.mcp.json` MCP server convention, the "Tool Selection Priority" MCP-vs-files fallback ladder, the architect/developer subagent split with a spec-driven workflow, and the negative-routing ("Do NOT use for…") description craft. Fabric content is mostly `fab`-CLI/REST reference (mark reference-only) except a genuinely reusable Power Query `mashup.pq` data-prep pattern.

## High-value extractions

### Multi-plugin marketplace.json shape → maps to our packaging (.claude-plugin/marketplace.json)
- What it is: Root marketplace manifest listing two plugins by relative `source` path, each with its own version + keywords. Marketplace has its own version separate from each plugin's version. This is the exact pattern we'd use if pbi-mcp-ts ships >1 plugin or wants a marketplace entry.
- Key content (reusable shape):
```json
{
  "name": "powerbi-agentic-plugins",
  "owner": { "name": "Rui Romano" },
  "metadata": {
    "description": "Skills and tools for agentic Power BI and Fabric development including Semantic Modeling, TMDL, PBIR, Best Practices, and CRUD operations on Fabric resources.",
    "version": "0.2.0"
  },
  "plugins": [
    {
      "name": "powerbi",
      "description": "Skills and tools for agentic Power BI development including Semantic Modeling, TMDL, PBIR, Best Practices.",
      "source": "./plugins/powerbi",
      "version": "0.2.1",
      "keywords": ["power-bi", "tmdl", "pbir", "semantic-modeling", "powerbi"]
    },
    { "name": "fabric", "description": "...CRUD on workspaces, dataflows, datasets...", "source": "./plugins/fabric", "version": "0.2.0", "keywords": ["fabric", "crud", "onelake"] }
  ]
}
```
- Source path: `.claude-plugin/marketplace.json`
- Quality: 5 — clean, minimal, multi-plugin.
- Recommendation: adapt (we are single-plugin today, but this is the template to grow into a marketplace; note plugin `source` is a relative dir, and plugin version lives in the manifest entry, not necessarily in plugin.json).

### Per-plugin repo layout convention → maps to our plugin repo structure
- What it is: README declares a uniform per-plugin folder layout. NOTE/GAP: the README documents `.claude-plugin/plugin.json` per plugin, but **the repomix pack contains NO plugin.json files** (only the root marketplace.json) despite an include glob of `.claude-plugin/**` — i.e. they exist in the repo but weren't matched (the per-plugin manifests live at `plugins/*/.claude-plugin/plugin.json`, outside what got packed). So we cannot copy their exact plugin.json field shape from this source; we only know it exists and is called the "Manifest".
- Key content (documented layout):
```
plugin-name/
├── .claude-plugin/plugin.json   # Manifest
├── .mcp.json                    # Tool connections (MCP servers)
├── agents/                      # Agent personas with role-specific instructions
└── skills/                      # Domain knowledge drawn on automatically
```
  Plus glossary they use: Skills = domain expertise/best-practices/workflows (auto-invoked); Agents = personas declaring which skills+tools to use; Connectors = `.mcp.json` MCP wiring.
- Source path: root `README.md`; dir structure shows `plugins/{fabric,powerbi}/{.mcp.json,README.md,agents/,skills/}`.
- Quality: 4 — clear convention; docked because plugin.json itself is missing from the pack.
- Recommendation: adapt — mirror the `agents/ + skills/ + .mcp.json + .claude-plugin/plugin.json` layout; we still need to source plugin.json field shape elsewhere (sibling repos / Claude Code docs).

### `.mcp.json` MCP server wiring (npx convention) → maps to our MCP integration setup + setup skill/docs
- What it is: Both plugins ship a plugin-local `.mcp.json` that auto-wires an MCP server via `npx -y <pkg>@latest` with `"tools": ["*"]`. This is exactly how a Claude Code plugin bundles+auto-starts its MCP server with zero manual config — directly applicable to how pbi-mcp-ts should ship its own MCP server entry.
- Key content (two shapes):
```json
// plugins/powerbi/.mcp.json  — note "type": "local"
{ "mcpServers": { "powerbi-modeling-mcp": {
  "type": "local",
  "command": "npx",
  "args": ["-y", "@microsoft/powerbi-modeling-mcp@latest", "--start"],
  "tools": ["*"]
}}}
```
```json
// plugins/fabric/.mcp.json  — subcommand-style args, no "type"
{ "mcpServers": { "fabric-mcp-server": {
  "command": "npx",
  "args": ["-y", "@microsoft/fabric-mcp@latest", "server", "start", "--mode", "all"],
  "tools": ["*"]
}}}
```
- Source path: `plugins/powerbi/.mcp.json`, `plugins/fabric/.mcp.json`.
- Quality: 5 — this is the canonical pattern for our own bundled MCP server.
- Recommendation: adopt-as-is — ship pbi-mcp-ts's server as a plugin-local `.mcp.json` using `npx -y <our-pkg>@latest`; README explicitly tells users "Swap connectors — edit `.mcp.json` to point at your specific MCP servers."

### Install / setup README conventions → maps to our setup skill + install docs
- What it is: A clean dual-host install section (Copilot CLI + VS Code) plus a "these are starting points, customize them" framing and runnable scenario prompts. Strong model for our README/setup docs.
- Key content (Copilot CLI install flow — Claude Code analog is `/plugin marketplace add` then `/plugin install`):
```bash
copilot
/plugin marketplace add RuiRomano/powerbi-agentic-plugins   # one-time
/plugin install powerbi@powerbi-agentic-plugins
/plugin install fabric@powerbi-agentic-plugins
# Restart to activate
```
  Customization guidance worth echoing: (1) add company context (naming conventions, workspace structure, modeling patterns) into skill files; (2) adjust workflows (deployment pipeline, BPA rules); (3) swap connectors via `.mcp.json`. Also a manual fallback: copy `plugins/<x>/skills` into `.github/skills/<skill>/SKILL.md`.
  Prereqs pattern (fabric README): list CLI install link + account + a one-time `auth login` step.
- Source path: root `README.md`, `plugins/fabric/README.md`, `plugins/powerbi/README.md`.
- Quality: 5 — concise, copy-pasteable, host-agnostic framing.
- Recommendation: adapt — clone this README skeleton (Plugins table → Getting Started per host → Scenarios → customization notes). Our setup skill should encode the install + MCP-prereq + auth-status check flow.

### Skill auto-trigger description craft (numbered scope + negative routing) → maps to our skill description authoring
- What it is: Best-in-class SKILL.md `description` frontmatter that (a) enumerates supported operations as a numbered list and (b) ends with explicit "Does NOT handle … (use <other-skill>)" routing so the model picks the right skill. This is the highest-leverage transferable craft for our pipeline + thin-CRUD skills.
- Key content (paste as templates):
```
# semantic-model skill description (note numbered ops + negative routing)
description: Develops and manages Power BI Semantic Models. Handles connecting to semantic models for analysis and all development operations including (1) Creating new models, (2) Creating/editing measures using DAX, (3) Creating/editing tables and relationships, (4) Analyzing model best practices, (5) Deploying models to Fabric workspace, (6) Working with PBIP projects, (7) Troubleshooting DAX performance, (8) Refreshing models, (9) Creating or editing TMDL. Does NOT handle report layout/visual authoring, or workspace/pipeline administration (use fabric-cli).
```
```
# report-authoring skill description
description: Guide to develop Power BI Reports in PBIR format. Use this skill for any development operation against a Power BI Report PBIR file format including (1) Creating new reports on top of semantic models, (2) Editing visuals, pages, and bookmarks, (3) Aligning and laying out visuals, (4) Rebinding reports to different semantic models, (5) Deploying reports to Fabric workspaces, (6) Exporting reports. Do NOT use for semantic model development or TMDL (use powerbi-semantic-model), or workspace/pipeline administration (use fabric-cli).
```
```
# fabric-cli skill description (note explicit "invoke automatically whenever a user mentions X")
description: Use Microsoft Fabric CLI (fab) to manage workspaces, semantic models, reports, notebooks, lakehouses... Use when deploying Fabric items, running jobs, querying data, managing OneLake files, or automating Fabric operations. Invoke this skill automatically whenever a user mentions the Fabric CLI, fab, or Fabric.
```
  Also each plugin README has a "What it does" table mapping capability → example user utterance (e.g. `Semantic model development | "Create a star schema model from this CSV data"`) — good source material for crafting trigger phrases.
- Source path: `plugins/powerbi/skills/*/SKILL.md` frontmatter; `plugins/fabric/skills/fabric-cli/SKILL.md`; plugin READMEs.
- Quality: 5.
- Recommendation: adopt-as-is — use the "verb + numbered (1)…(n) operations + Does NOT … (use X)" formula for every pbi-mcp-ts skill description; add an "invoke automatically whenever the user mentions …" clause for the always-on skills.

### "Tool Selection Priority" — MCP-vs-files fallback ladder → maps to our pipeline-skill engine routing
- What it is: An explicit decision ladder telling the agent which backend to use (MCP server first, then direct TMDL files, then export/edit/redeploy via CLI, then guide user). This is exactly the kind of routing our pipeline skills need so the engine degrades gracefully when the MCP server / live model isn't available.
- Key content:
```
1. MCP Server available → use MCP tools for all ops (create/edit/deploy/query), server or local folders. Unless user explicitly wants TMDL files.
2. MCP unavailable + PBIP folder exists → edit TMDL files directly.
3. MCP unavailable + Fabric workspace → use fabric-cli to export model, edit TMDL locally, redeploy.
4. MCP unavailable + Power BI Desktop → guide user to save as PBIP folder or enable the MCP server.
```
  Companion "Pre-development: Understand the model/report first" checklists (list tables/relationships/measures, check naming conventions, identify storage mode) before any edit.
- Source path: `plugins/powerbi/skills/powerbi-semantic-model-authoring/SKILL.md` (and the report skill's parallel "Pre-development" list).
- Quality: 5.
- Recommendation: adapt — encode an analogous priority ladder in our pipeline skills (MCP engine → local PBIP/TMDL files → ask user), and ship a "gather context before mutating" preamble.

### Architect/Developer subagent split + spec-driven workflow → maps to our subagents & orchestration
- What it is: Two complementary agent personas. `powerbi-architect` designs only (produces `specs/*.spec.md`, never implements), `powerbi-developer` implements specs. README documents the handoff ("use architect to create spec, then developer to implement"). Each agent frontmatter declares `tools:` and a `model:` and lists "Skills to use". This is a clean template for our subagent layer + how two plugins/agents relate.
- Key content (reusable bits):
  - Agent frontmatter shape: `description` (role, first-person), `tools: [vscode, execute, read, agent, edit, search, web, 'microsoft-learn/*', 'powerbi-modeling-mcp/*', todo]` (note glob-scoped MCP tool grants like `'powerbi-modeling-mcp/*'`), `model: <name>`. Architect uses Opus, developer uses Sonnet — deliberate model-per-role.
  - Behavioral guardrails worth copying: architect = "Research-First, Not Assumption-First" (never guess schemas; download web CSVs to `temp/` and inspect top ~50 rows without loading whole file into context); developer = "Tool-First, Not Efficiency-First" (always call MUST-use tools even for simple ops to get up-to-date Fabric knowledge; don't skip tool calls on internal-knowledge confidence).
  - Spec template (EARS acceptance criteria: "THE System SHALL …", "WHEN … THE System SHALL …"; sections Overview/Requirements/Design+Mermaid/Components/Data Sources/Tasks-as-checkboxes), and a "look for `team-standards.md` / `team-modeling-rules.md` and respect it" hook for team customization.
  - Developer `/implement [path]` workflow: locate spec → review → check Tasks section → resume first unchecked task → mark done → emit `specs/[Name].ExecutionSummary.md`.
- Source path: `plugins/powerbi/agents/powerbi-architect.agent.md`, `plugins/powerbi/agents/powerbi-developer.agent.md`; root README "Spec driven development" scenario.
- Quality: 5.
- Recommendation: adapt — adopt the design-vs-implement subagent split, EARS spec template, model-per-role, glob-scoped MCP tool grants, and the "respect team-standards.md" customization hook. (Note `tools:`/`model:` here use Copilot-flavored values — translate to Claude Code subagent frontmatter.)

### fabric-cli SKILL.md — operational discipline + REST/JMESPath patterns → reference-only (CLI runtime) but adopt the discipline rules
- What it is: A large, well-structured CLI skill. The `fab` commands themselves are Python-CLI/REST runtime (reference-only for our Node/TS plugin), BUT its "Critical" operational rules and patterns are transferable safety/UX guidance for any agentic tool plugin.
- Key content (transferable rules, runtime-agnostic):
  - First-run safety: check `fab auth status` before use; ask the user about admin access / API restrictions / preferences before first use; "Remind the user to add their access level + preferences to their agent memory files (e.g., CLAUDE.md) for future sessions."
  - Discovery-before-mutation: verify name with `ls`/`exists` before acting; never remove/move/rename without explicit user direction; never circumvent a blocked permission — stop and ask.
  - Non-interactive discipline: always pass `-f` (force) for scripts; "interactive mode doesn't work with coding agents"; try the simple command before piping; read `--help` the first time you use a command.
  - Variable-extraction + REST pattern (conceptually reusable; CLI syntax reference-only): extract IDs once, then call REST. Power BI REST endpoints worth noting for our engine: `groups/{wsId}/datasets/{modelId}/refreshes` (POST `{"type":"Full"}`), `.../executeQueries` (POST `{"queries":[{"query":"EVALUATE ..."}]}`), refresh-status via `refreshes?$top=1`. Async write pattern: POST `updateDefinition`, read operation id from `Location` header, poll `operations/{id}` until `Succeeded`.
  - Note (Bash-first): "If you have a Bash tool (e.g., Claude Code), execute `fab` directly via Bash rather than using an MCP server" — relevant to whether we wrap CLIs in MCP vs. let Bash run them.
- Source path: `plugins/fabric/skills/fabric-cli/SKILL.md` (+ references/ quickstart.md, notebooks.md, semantic-models.md).
- Quality: 5 as a skill; transferability mixed (rules=adopt, commands=reference-only).
- Recommendation: reference-only for commands; **adapt** the operational discipline ("Critical" block: auth-check, discovery-before-mutation, never-circumvent-permissions, persist-prefs-to-CLAUDE.md, non-interactive flags) into our skill preambles.

### Power Query `mashup.pq` + dataflow definition → maps to m-query-patterns / bi-pattern-library (reference-only)
- What it is: The dataflow item definition (`queryMetadata.json` + `mashup.pq`) with a real M/Power Query mashup. The M-language `section`/`shared` query structure, Lakehouse navigation, and column-transform chain are a transferable data-prep authoring pattern for our M-query knowledge — though dataflow CRUD itself is Fabric-REST (reference-only).
- Key content (reusable M pattern; FLAG: the GUIDs/workspaceId/lakehouseId/connectionId are sample placeholders — must be parameterized, never hardcoded):
```pq
[StagingDefinition = [Kind = "FastCopy"]]
section Section1;
shared publicholidays =
let  Source = Lakehouse.Contents([]),
  #"Navigation 1" = Source{[workspaceId = "<WORKSPACE_ID>"]}[Data],
  #"Navigation 2" = #"Navigation 1"{[lakehouseId = "<LAKEHOUSE_ID>"]}[Data],
  #"Navigation 3" = #"Navigation 2"{[Id = "publicholidays", ItemKind = "Table"]}[Data],
  #"Changed column type" = Table.TransformColumnTypes(#"Navigation 3", {{"normalizeHolidayName", type text}}),
  #"Lowercased text" = Table.TransformColumns(#"Changed column type", {{"countryRegionCode", each Text.Lower(_), type nullable text}}),
  #"Uppercased text" = Table.TransformColumns(#"Lowercased text", {{"normalizeHolidayName", each Text.Upper(_), type nullable text}}),
  #"Calculated text length" = Table.TransformColumns(#"Uppercased text", {{"countryOrRegion", each Text.Length(_), type nullable Int64.Type}})
in  #"Calculated text length";
```
  Dataflow metadata flags worth knowing: `formatVersion` must be `"202502"`; `computeEngineSettings.allowFastCopy`; `connections[].kind = "Lakehouse"`. External authoritative refs the skill points to: `powerquery.guide/function/<fn>` and Microsoft "Power Query best practices".
- Source path: `plugins/fabric/skills/fabric-cli/assets/dataflow-definition.md`.
- Quality: 3 — verbatim MS Learn reference, but the M snippet is reusable.
- Recommendation: reference-only — capture the M `section/shared` + `Table.TransformColumns` chain idiom for our pattern library; flag all GUIDs/IDs as must-parameterize.

### PBIP/PBIR item template + Fabric JSON-schema URLs → reference for our authoring engine (sibling owns detail)
- What it is: A complete minimal PBIP template (`templateReport.pbip`, `report/` PBIR folder, `report.dummyModel/` semantic-model folder) used as a scaffold to create reports. Useful as the canonical "what files an item folder must contain" + the official Fabric `$schema` URLs we can validate against. (DAX/visual/BPA detail is the sibling agent's scope — flagged here only as packaging/template structure.)
- Key content (load-bearing schema URLs + rebind mechanism):
  - `.platform` (per item): `$schema .../fabric/gitIntegration/platformProperties/2.0.0/schema.json`, `metadata.type` ∈ {`Report`,`SemanticModel`,…}, `config.logicalId` (GUID).
  - Report `definition.pbir`: `$schema .../fabric/item/report/definitionProperties/2.0.0/schema.json`; the `datasetReference` selects model binding — `byPath` (local relative folder, e.g. `"../report.dummyModel"`) for local dev vs `byConnection` (`semanticModelId`/`workspace`) for deployment. Rebinding = editing this one file (CRITICAL: must be `byConnection` when deploying to a workspace).
  - Semantic model `definition.pbism`: `$schema .../fabric/item/semanticModel/definitionProperties/1.0.0/schema.json`; `database.tmdl` carries `compatibilityLevel: 1702`; model.tmdl annotation `PBI_ProTooling = ["TMDL-Extension","DevMode"]`.
- Source path: `plugins/powerbi/skills/powerbi-report-authoring/assets/templateReport/**` (`.platform`, `definition.pbir`, `definition.pbism`, `database.tmdl`, `model.tmdl`, `templateReport.pbip`).
- Quality: 4 (as structural reference).
- Recommendation: reference-only here (defer DAX/visual/BPA to sibling) — but adopt the official `$schema` URLs for validation and the `byPath`-vs-`byConnection` rebind rule in our report engine; ship a comparable empty template scaffold.

## Cross-source overlap flags
- **marketplace.json / plugin packaging:** Likely overlaps with every other plugin-repo source being mined (data-goblin's fabric-cli-plugin is the upstream of this `fabric-cli` skill — same SKILL.md will appear there; dedupe). Consolidate manifest/packaging findings across all plugin repos into one canonical recommendation.
- **fabric-cli skill** is third-party (by Kurt Buhler / data-goblin, vendored here) — its content will be near-identical in the data-goblin source; treat this repo's copy as the "as-integrated-into-a-marketplace" variant.
- **DAX / BPA / TMDL / report visual detail** is intentionally NOT extracted here (sibling agent owns it): `powerbi-semantic-model-authoring/references/*` (dax-*, modeling, direct-lake, TMDL, pbip), `bpa-rules-*.json`, `bpa.ps1`, all `visual.json`/`theme.json`, and the `*-definition.md` schema docs (report/semantic-model). Flag for the sibling: `bpa.ps1` is PowerShell (reference-only for our Node/TS BPA), and `direct-lake-guidelines.md` + `dax-udf-functions-guidelines.md` exist here too.

## Discarded / not relevant
- `plugins/fabric/skills/fabric-cli/references/{admin,workspaces,reports,semantic-models,reference,fab-api,querying-data,create-workspaces}.md` — `fab` CLI command catalogs / Fabric REST reference; runtime is Python CLI, not transferable as code. (Operational *rules* already extracted from SKILL.md; commands reference-only.)
- `plugins/fabric/skills/fabric-cli/assets/{lakehouse,semantic-model,report,notebook}-definition.md` and `report-agent-instructions.md` — verbatim Microsoft Learn REST API definition docs (lakehouse shortcuts/data-access-roles, item definition formats). Pure external reference; no plugin-structure or Node/TS pattern value. (Dataflow's M snippet was the one exception, extracted above.)
- `notebooks.md` PySpark/`fab job` recipes — Spark/Python + CLI runtime; the InlineBase64 `updateDefinition` + `operations/{id}` polling concept was noted under fabric-cli, the rest is reference-only.
- `report.dummyModel/.pbi/localSettings.json` `securityBindingsSignature` — machine-generated encrypted blob; ignore.
- `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `LICENSE` — Microsoft OSS boilerplate; not relevant to packaging beyond "include standard OSS files."
- Sample dataset references throughout (WideWorldImporters-style `fact_sale`/`dimension_city`, `assets/sample-data` CSVs, "Retail sample data") — ignored per dataset-agnostic rule; these are demo data, not patterns.
