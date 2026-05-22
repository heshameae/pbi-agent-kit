# Handover — pbi-mcp-ts skills/agents architecture (2026-05-22)

## 0. Orientation

**Project:** `/Users/heshameissa/Documents/Projects/pbi-mcp-ts` — a Claude Code **plugin** (TS port of the older `pbi-cli`). Ships skills + agents + an MCP server (`pbi-report`) driving Power BI report (PBIR) and semantic-model (TMDL) authoring. Dev on Mac; live modeling needs Power BI Desktop in Parallels/Windows.

**Branch:** `feat/v6-b1-wrapped-model`.

**Where in the plan:** v6 redesign (`~/.claude/plans/ok-so-let-s-take-jolly-mist.md`) split the model side into three agents — plan / build / review — over a *wrapped* Microsoft modeling MCP (spawned as our server's child subprocess; gates enforced in-code). Phases B-1…B1d done (tasks #69–81). This session = post-B1 polish: fix agent format, deep-mine a reference repo, fill skill gaps.

## 1. Two ironclad rules (carry forward)

1. **Mine, don't invent.** All skill/reference content comes from `docs/superpowers/mining/packed/*.xml` and the reference plugin `…/power-bi-agentic-development-main/plugins/semantic-models`. Routing authority = `docs/superpowers/mining/ADOPTION-MAP.md`. If a source is unknown, ASK.
2. **Dataset-agnostic.** Generic names (`Sales`, `Product`, `Customer`) or placeholders (`FactPrimary`/`DimShared`/`ValueMetric`). No real field names. No `Fact`/`Dim` prefixes.

Plus **shadow purity** (don't edit pre-existing `pbi-*` agents/skills) and the **`pbi-` prefix** stays only on those pre-existing artifacts.

## 2. What we did this session

### (a) Fixed 3 model agents' formatting
`data-analyst.md`, `model-builder.md`, `model-reviewer.md`:
- `description:` → single-line `"Use when…"` trigger-only (was `description: >` content summary).
- Removed `delegates_to:` (not a valid field).
- `skills:` → YAML list `[a, b]`.
- Removed stale `skills: reviewing-models` from model-reviewer (the skill now exists).

### (b) Plugin-agent platform constraint (approach-relevant)
- Plugin agents **cannot** define `mcpServers:`, `hooks:`, `permissionMode:` in frontmatter (silently ignored).
- They **can** use MCP tools by listing tool names in `tools:` (inherited from the main session). So listing `mcp__…` tools directly is correct; never add an `mcpServers:` block.

### (c) Deep-mined the reference repo
3 Explore agents read every file in `…/plugins/semantic-models` (6 skills + 1 auditor) and diffed against ours → prioritized gap map.

### (d) Filled gaps (3 writer agents + 1 audit agent)
2,377 lines of mined content across 13 files (all verified on disk).

## 3. Files created/changed (verified)

**authoring-measures/**: `dax-performance.md` (+QRY001–004), new `dax-performance-optimization.md` (240), `engine-internals.md` (176), `model-optimization.md` (173); SKILL.md table updated.

**modeling-semantic-model/**: new `naming.md` (252), `ai-readiness.md` (145), `performance.md` (96); SKILL.md table updated.

**New skills:** `reviewing-models/` (SKILL 97 + check-catalog 457 + output-format 149), `power-query/` (SKILL 125 + folding-guide 268 + validation-workflow 141), `lineage-analysis/` (SKILL 58).

## 4. Approach changes / learnings

1. **Description format flip** (skills + agents): content-summary → `"Use when…"` trigger-only. Reason (superpowers writing-skills CSO): a workflow-summary description becomes a shortcut Claude takes instead of reading the body.
2. **Plugin agents ≠ workspace agents** on MCP/hooks (see 2b). Settled: list tools, never declare servers.
3. **reviewing-models now exists** — `model-reviewer.md` could optionally re-add `skills: [reviewing-models]` to preload it (its body already points at check-catalog.md / output-format.md, which now exist).
4. **power-query became a standalone skill** (not the planned `modeling-semantic-model/references/power-query-m.md`), because the reference repo had a full PQ skill worth mining whole.

## 5. Open items / what's next (prioritized)

### A. Dangling skill references (create-or-repoint; FIND SOURCE FIRST)
| Broken ref | In | Where to mine | Action |
|---|---|---|---|
| `calc-groups.md` | authoring-measures/SKILL.md:35 | dg4-te-fabric-desktop-root.xml: calculation-groups.md (~L55770) + time_intelligence.csx (~L34377) | create |
| `columns-relationships.md` | modeling-semantic-model/SKILL.md:31 | check ADOPTION-MAP (likely dg3-semantic-models.xml) | create |
| `rls.md` | modeling-semantic-model/SKILL.md:34 | check ADOPTION-MAP (RLS/security source) | create |
| `power-query-m.md` | modeling-semantic-model/SKILL.md:33 | — | repoint row to the new `power-query` skill (don't duplicate) |

### B. Tool-prefix split — DO NOT bulk-fix blindly
- 3 new model agents use `mcp__plugin_pbi-mcp-ts_pbi-report__*`; 7 old `pbi-*` agents use `mcp__pbi-report__*`.
- **This session's live runtime exposes tools as `mcp__plugin_pbi-mcp-ts_pbi-report__*`** → new agents match, old look stale.
- The audit subagent labeled these BACKWARDS — ignore its labels.
- Prefix depends on registration method. Confirm on a live Windows plugin install before changing; editing old `pbi-*` agents also conflicts with shadow purity → user's call.

### C. `pbi-data-architect.md` has `model: sonnet` (line 5)
Should be a full ID (`claude-sonnet-4-6`). Pre-existing agent (shadow purity) → confirm before touching.

### D. Manifest registration — VERIFY EARLY (high risk)
Per the manifest memory, plugin.json must explicitly declare components or they're invisible. Verify the 6 new/changed skills and 3 new agents are declared in `.claude-plugin/plugin.json` (bumped to 0.4.0 in B0).

### E. Carry-over pending
- `planning-dashboards/references/intake-protocol.md` — missing What/So-What/Now-What/Evidence/Confidence template (borghei), analysis skeleton, refresh-cadence gate, maturity model L1–L4.
- `modeling-semantic-model/SKILL.md` **body** — add to Critical Rules: formatString-required, DIVIDE over `/`, `isAvailableInMdx: false`, avoid `double` dataType.
- **reviewing-reports** skill (counterpart to reviewing-models) — not started.
- **Phase 3:** `designing-reports` skill + `report-builder` agent — not started.
- Task **#32**: TopN filter shape needs Desktop ground-truth comparison.

### F. Testing debt (flag, not blocking)
The 13 mined files are untested per superpowers `writing-skills` Iron Law (RED-GREEN-REFACTOR with subagent scenarios). They're reference skills (bar = retrieval/gap testing), but none verified by an agent actually using them.

## 6. Key locations
- Plan: `~/.claude/plans/ok-so-let-s-take-jolly-mist.md`
- Mining: `docs/superpowers/mining/packed/*.xml`; routing `docs/superpowers/mining/ADOPTION-MAP.md`
- Reference repo mined: `…/power-bi-agentic-development-main/plugins/semantic-models`
- Memory index: `~/.claude/projects/-Users-heshameissa-Documents-Projects-pbi-cli/memory/MEMORY.md`
