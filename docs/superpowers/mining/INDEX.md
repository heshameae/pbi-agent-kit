# Repo Mining — Index (2026-05-20)

Mined 9 GitHub repos for content relevant to **pbi-mcp-ts** (skills, agents, DAX/time-intelligence, model/report review, hooks, plugin packaging). Workflow: repomix pack (scoped to drop example-data/site noise) → 20 mining agents (4 on the priority repo, 2 each on the rest) → 2 review agents that deduped across sources and produced consolidated adoption decisions.

## START HERE — actionable build map
- **[../plans/2026-05-20-skill-architecture.md](../plans/2026-05-20-skill-architecture.md)** ← **the skill architecture.** Task-grouped taxonomy: 7 lean SKILL.md skills (each with `references/` + `scripts/`), folder trees, agent→skill wiring, migration from the 16 existing skills, build sequencing.
- **[ADOPTION-MAP.md](ADOPTION-MAP.md)** ← **the routing table** (now grouped by **skill → `references/<file>.md`**): for each reference file, the exact source repo path + packed XML + action (adopt/adapt/ref) + priority (P0/P1/P2). One-screen destination index up top; 208 grep-verified paths. (`ADOPTION-MAP.flat-backup.md` keeps the prior flat-by-topic version.)

## Background — consolidated decisions (the "why" behind the map)
- **[review/01-domain-knowledge-adoption.md](review/01-domain-knowledge-adoption.md)** — what content goes into our 14 shared-knowledge skills + BPA engine + model/report reviewers + data-analyst. Includes a canonical-source hierarchy, Top 10 adoptions, hardcoding watchlist, gaps.
- **[review/02-architecture-authoring-adoption.md](review/02-architecture-authoring-adoption.md)** — how we build/ship: worker-agent + DashboardSpec contract, pipeline orchestration, SKILL.md/agent house-style, hooks (safety + gate), MCP server design, plugin/marketplace packaging + catalog, eval/verification. Includes Top 10, sequencing, platform-mismatch watchlist.

## Packed sources (`packed/`, repomix XML, scoped/lean)
| File | ~Tokens | Repo / scope |
|---|---|---|
| dg1-pbip.xml | 333k | data-goblin · pbip plugin (TMDL, PBIR format, validator hook) |
| dg2-reports.xml | 446k | data-goblin · reports plugin (design/visuals/themes/review) |
| dg3-semantic-models.xml | 57k | data-goblin · semantic-models (DAX/M/review/naming) |
| dg4-te-fabric-desktop-root.xml | 554k | data-goblin · tabular-editor/fabric/desktop + useful-stuff hooks + root |
| awesome-copilot-pbi-data.xml | 144k | github/awesome-copilot · Power BI + data slice |
| awesome-copilot-meta.xml | 292k | github/awesome-copilot · hooks/manifests/authoring |
| skills-for-fabric-1-authoring.xml | 349k | microsoft/skills-for-fabric · authoring/PBI/dataflows |
| skills-for-fabric-2-catalog.xml | 636k | microsoft/skills-for-fabric · catalog/consumption/ops |
| awesome-llm-apps.xml | 231k | shubhamsaboo/awesome-llm-apps · markdown only (patterns) |
| powerbi-agentic-plugins.xml | 113k | ruiromano/powerbi-agentic-plugins · powerbi+fabric plugins |
| agent-skills.xml | 624k | practicalswan/agent-skills · skills (md/json) |
| claude-plugin-marketplace.xml | 294k | josiahsiegel/claude-plugin-marketplace · powerbi/data/plugin-master |
| claude-skills-borghei.xml | 384k | borghei/Claude-Skills · data-analytics + standards/templates |
| antigravity-awesome-skills.xml | 178k | sickn33/antigravity-awesome-skills · BI bundles + catalog/index |

Raw repos totaled ~30M+ tokens; scoping to relevant paths (dropping example datasets, built doc sites, bundled binaries, irrelevant domains) reduced this to ~4.6M tokens of on-target content.

## Per-source findings (`findings/`)
data-goblin: dg1-pbip · dg2-reports · dg3-semantic-models · dg4-te-fabric-hooks-root
awesome-copilot: awesome-copilot-pbi-data · awesome-copilot-meta
skills-for-fabric: skills-for-fabric-authoring · skills-for-fabric-catalog
awesome-llm-apps: awesome-llm-apps-orchestration · awesome-llm-apps-rag-eval
powerbi-agentic-plugins: powerbi-agentic-plugins · powerbi-agentic-plugins-structure
agent-skills: agent-skills-pbi-meta · agent-skills-design-breadth
claude-plugin-marketplace: claude-plugin-marketplace-pbi · claude-plugin-marketplace-structure
claude-skills: claude-skills-data-analytics · claude-skills-standards
antigravity: antigravity-bi-bundles · antigravity-catalog-structure

## Canonical-source hierarchy (domain, on conflict)
1. microsoft/skills-for-fabric (first-party — TMDL, INFO.* discovery, definition envelopes)
2. ruiromano/powerbi-agentic-plugins (deepest DAX-perf catalog DAX001–021 + 60-rule BPA)
3. data-goblin set (richest report design, naming regexes, M-folding, calc-group/RLS DAX, extra BPA sets)
4. awesome-copilot PBI (checklist STAR/RLS/perf refs — de-hardcode AdventureWorks names)
5. claude-plugin-marketplace powerbi-master (cleanest TMDL→TOM grammar + validation taxonomy)

Architecture canon: Claude Code native manifest/hook schemas (claude-plugin-marketplace + data-goblin + ruiromano); awesome-copilot hook *config* is Copilot-CLI schema (logic portable, schema not).
