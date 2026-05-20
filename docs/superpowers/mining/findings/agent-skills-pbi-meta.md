# Mining findings: practicalswan/agent-skills — PBI/data + meta-authoring
Source: agent-skills.xml

## Relevance summary
This is a large, well-maintained cross-client skill catalog. The single biggest wins for us are the **mcp-builder** reference set (TypeScript MCP SDK patterns, tool-design rules, and a complete MCP evaluation methodology) and the **writing-skills** family (TDD-for-skills, Claude Search Optimization, Anthropic's official authoring best practices incl. "degrees of freedom" + progressive disclosure). The **powerbi-modeling** references give a clean, dataset-agnostic DAX/star-schema/RLS/perf knowledge base for our dax/tmdl skills and model-builder/reviewer. The **subagent-driven-development** prompt templates (implementer + spec-reviewer + code-quality-reviewer) and **agentic-eval** rubric loop map directly onto our worker/reviewer subagents and our skill-evaluation process. SQL/Excel/spreadsheet skills are mostly reference-only (wrong runtime / generic), but their skill *structure* is a useful template.

## High-value extractions

### Power BI modeling reference set → maps to our dax/tmdl/m-query skills + model-builder + model-reviewer
- **What it is / why valuable:** Five compact, dataset-agnostic reference docs (STAR-SCHEMA, RELATIONSHIPS, MEASURES-DAX, PERFORMANCE, RLS) plus a model-examples file. Each ends with a validation checklist — perfect raw material for our shared-knowledge skills and reviewer rubrics. Example tables (Sales/Customer/Date) are illustrative naming patterns, NOT hardcoded dataset fields, so they're reusable.
- **Key content (reusable bits):**
  - **Naming conventions (MEASURES-DAX):** dimension = singular noun, fact = business process noun, measure table = `_`-prefixed (`_Measures`); keys suffix `Key`/`ID`; dates suffix `Date`; flags prefix `Is`/`Has`. Measure naming: Aggregation = Verb+Noun (`Total Sales`); Ratio = "X per Y" / "X Rate"; Time-intel = Period+Metric (`YTD Sales`, `PY Sales`); Comparison = Metric + vs + Baseline.
  - **DAX rules:** Always create explicit measures for key metrics. **Always fully-qualify COLUMN refs** (`SUM(Sales[Amount])`); **never qualify MEASURE refs** (`[Total Sales]` not `Sales[Total Sales]` — breaks if home table changes). Use `DIVIDE()` over `/` (handles div-by-zero). Use `VAR` for repeated subexpressions. Avoid `FILTER(WholeTable, ...)` — use column predicate `CALCULATE([m], Sales[Amount] > 1000)`. Use `KEEPFILTERS`, `USERELATIONSHIP` (role-playing), `CROSSFILTER(...,BOTH)` in measures instead of bidirectional relationships.
  - **Star schema:** separate dims from facts; consistent grain (never mix); surrogate keys; dedicated marked Date table; anti-patterns table (wide denormalized, snowflake, m2m-without-bridge, mixed-grain). Special dims: role-playing, SCD-2, junk, degenerate.
  - **Relationships:** prefer 1:* single-direction; one active path between two tables; matching key data types; troubleshooting for "ambiguous path"/"bidirectional not allowed"/"relationship not detected".
  - **RLS:** filter dimensions not facts (propagation); dynamic RLS via `USERPRINCIPALNAME()`; security-mapping-table pattern; manager-hierarchy via `PATHCONTAINS`; roles are additive UNION not intersection; defensive pattern returning no data for unknown users; OLS note; test valid/invalid/NULL users.
  - **Performance:** data reduction (drop columns/rows, reduce cardinality, optimize data types DateTime→Date), prefer Power Query (M) columns over DAX calculated columns, avoid calc columns on relationship keys (`COMBINEVALUES` for composite), set `SummarizeBy=None` on non-additive columns, minimize bidirectional/m2m, disable Auto Date/Time for DirectQuery, user-defined aggregations, verify with Performance Analyzer/DAX Studio.
- **Source path:** `powerbi-modeling/references/{STAR-SCHEMA,RELATIONSHIPS,MEASURES-DAX,PERFORMANCE,RLS}.md`, `powerbi-modeling/examples/model-examples.md`, `powerbi-modeling/SKILL.md`
- **Quality:** 5 — clean, accurate, dataset-agnostic, checklist-driven.
- **Recommendation:** adapt (lift the rules + checklists into our skills; rewrite the MCP-call examples to our tool surface; convert Python/pseudo MCP calls to our TS conventions).

### powerbi-modeling SKILL.md "MCP Reality" + verification protocol → maps to our model-builder/reviewer workflow
- **What it is / why valuable:** Shows the host-agnostic posture (inspect available MCP ops first, map to model areas: connections/tables/columns/measures/relationships/DAX/roles) and a 5-point verification protocol (name runtime+files; run build/lint/test; address edge cases; pressure-test a change that passes happy-path but fails one boundary; zero untested success claims). Good template for our reviewer agent gates.
- **Source path:** `powerbi-modeling/SKILL.md`
- **Quality:** 4 — generic but solid scaffolding.
- **Recommendation:** adapt.

### mcp-builder TypeScript guide → maps DIRECTLY to our MCP server (packages/mcp)
- **What it is / why valuable:** The most directly reusable artifact in the whole pack. Concrete, modern MCP TS SDK patterns. We are a TS MCP server, so this is adopt-grade.
- **Key content (reusable bits):**
  - **Use modern APIs only:** `server.registerTool()` / `registerResource()` / `registerPrompt()`. Do NOT use deprecated `server.tool()` or manual `setRequestHandler(ListToolsRequestSchema,...)`.
  - **Tool registration shape:** provide `title`, `description`, `inputSchema` (a **Zod** object, `.strict()`), and `annotations` `{readOnlyHint, destructiveHint, idempotentHint, openWorldHint}`. Return `{ content: [{type:"text", text: JSON.stringify(out)}], structuredContent: out }`.
  - **Tool naming:** snake_case, **service-prefixed** to avoid collisions (`pbi_create_measure`, not `create_measure`); action-oriented verb-first.
  - **Descriptions must be exhaustive:** include Args, Returns (with full JSON schema + field comments), Examples ("Use when…" / "Don't use when…"), and Error Handling text. JSDoc is NOT auto-extracted — description must be explicit.
  - **Response format option:** `response_format` enum (`markdown` default human-readable / `json` machine-readable) on every data-returning tool.
  - **Pagination:** respect `limit`(1-100,default 20)/`offset`; return `{total,count,offset,items,has_more,next_offset}`; never load everything into memory.
  - **CHARACTER_LIMIT constant (~25000):** truncate large responses, set `truncated:true` + `truncation_message` telling the agent to use offset/filters.
  - **Error handling:** central `handleApiError()` mapping 404/403/429/timeout → actionable messages; report tool errors *inside* result objects (`isError:true`), not as protocol errors; never leak internals.
  - **Project structure:** `src/{index.ts,types.ts,tools/,services/,schemas/,constants.ts}` → `dist/index.js`; server name `{service}-mcp-server`.
  - **TS quality bar:** strict mode, no `any` (use `unknown`/types), explicit `Promise<T>`, Zod `.parse()` on external data, type guards (`axios.isAxiosError`, `z.ZodError`).
  - **Transports:** stdio for local (NEVER log to stdout — use stderr), Streamable HTTP for remote (create a new transport per request, stateless, prevents request-ID collisions; bind 127.0.0.1 + validate Origin for local HTTP). SSE is deprecated.
  - **Resources vs Tools:** Resources for static/URI-template data access; Tools for operations with validation/side-effects/business logic.
  - Full Node/TS quality checklist (Strategic Design / Implementation / TS / Advanced / Project / Code / Testing) — directly usable as a PR gate for our MCP package.
- **Source path:** `mcp-builder/reference/node_mcp_server.md`, `mcp-builder/reference/mcp_best_practices.md`, `mcp-builder/SKILL.md`
- **Quality:** 5.
- **Recommendation:** adopt-as-is (checklists + patterns); adapt code samples to our tool surface. Cross-check against the `mcp-builder` *skill* we already have installed and the awesome-copilot mcp findings to dedupe.

### mcp-builder evaluation methodology → maps to our MCP-server eval + agentic-eval process
- **What it is / why valuable:** A rigorous, reusable recipe for proving an MCP server is actually usable by an LLM (not just that tools exist). "The measure of quality is how well the schemas/descriptions enable an LLM with ONLY the server to answer hard questions."
- **Key content (reusable bits):**
  - Produce **10 questions**: READ-ONLY, INDEPENDENT, NON-DESTRUCTIVE, IDEMPOTENT; each needs many tool calls; single verifiable STABLE answer (no "current state" counts).
  - Questions must NOT be solvable by keyword search (use synonyms/paraphrase), must stress large/multi-modal returns (IDs, names, timestamps, file types, URLs), include ambiguous-but-single-answer cases.
  - Answers verified by **direct string comparison** → constrain output format in the question ("Use YYYY/MM/DD", "True/False", "A/B/C/D"); prefer human-readable; not lists/structures.
  - 5-step process: documentation inspection → tool inspection (don't call yet) → iterate understanding (NEVER read server source) → read-only content inspection (small `limit<10` calls, paginate, watch context) → task generation. Then verify by solving each yourself and dropping any that need writes.
  - `<evaluation><qa_pair><question/><answer/></qa_pair></evaluation>` XML format; troubleshooting low accuracy ("review agent feedback per task; clarify descriptions; check return size").
- **Source path:** `mcp-builder/reference/evaluation.md`
- **Quality:** 5.
- **Recommendation:** adapt — write a dataset-agnostic eval set for our PBI MCP tools (questions phrased over an arbitrary model, answers stable). Reuse the XML format + verification loop.

### writing-skills SKILL.md (CSO + TDD-for-skills + bulletproofing) → maps to our skill-authoring process + writing-skills skill
- **What it is / why valuable:** The canonical "how to author skills" doc. Treats skill creation as TDD: RED (run pressure scenario WITHOUT skill, capture verbatim rationalizations) → GREEN (write minimal skill addressing them) → REFACTOR (close loopholes). Iron Law: "No skill without a failing test first."
- **Key content (reusable bits):**
  - **Claude Search Optimization (CSO):** `description` must describe ONLY *when to use* (triggers/symptoms), third person, "Use when…", and **must NOT summarize the workflow** — doing so makes Claude follow the description and skip the body (documented real failure: a "two-stage review" summary caused Claude to do one review). Keyword coverage (error strings, symptoms, synonyms, tool names). Verb-first gerund names (`creating-skills` not `skill-creation`).
  - **Skill types + token budgets:** Technique 300-700w, Pattern 250-600w, Reference 150-350w in SKILL.md (details to references). Frequently-loaded skills <200w.
  - **Bulletproofing discipline skills:** close every loophole explicitly ("Delete means delete. Don't keep as reference. Don't adapt it."); add foundational principle "Violating the letter is violating the spirit"; build a **rationalization table** (Excuse|Reality) from baseline testing; add a **Red Flags — STOP** list; put violation-symptoms in the description.
  - **Cross-references:** name the skill with `**REQUIRED SUB-SKILL:**` markers; NEVER use `@path` links (force-loads, burns 200k context).
  - **Flowcharts only** for non-obvious decisions/loops — never for reference (use tables) or linear steps (use lists).
  - SKILL.md skeleton (Overview/When to Use/Core Pattern/Quick Reference/Implementation/Common Mistakes) + a full TDD-adapted creation checklist.
- **Source path:** `writing-skills/SKILL.md`, `writing-skills/testing-skills-with-subagents.md` (pressure types table: time/sunk-cost/authority/economic/exhaustion/social/pragmatic; combine 3+; meta-testing the skill when it still fails)
- **Quality:** 5.
- **Recommendation:** adopt-as-is as our skill-authoring doctrine. Note overlap with our installed `writing-skills` skill.

### Anthropic official skill best-practices → maps to our skill structure standards
- **What it is / why valuable:** Anthropic's first-party guidance, complementary to the TDD doc. Two standout frameworks.
- **Key content (reusable bits):**
  - **Concise is key:** context window is a public good; only metadata preloads, SKILL.md loads on trigger. Challenge every line ("Can I assume Claude knows this?"). Concise PDF example (~50 tok) vs verbose (~150 tok).
  - **Degrees of freedom** (match specificity to task fragility): High freedom = text instructions (many valid approaches); Medium = pseudocode/params (preferred pattern exists); Low = exact script, no params, "do not modify the command" (fragile/consistency-critical, e.g. migrations). Analogy: narrow bridge w/ cliffs (low freedom) vs open field (high freedom).
  - **Progressive disclosure:** keep SKILL.md body <500 lines; split when approaching. Pattern 1 high-level guide+refs; Pattern 2 domain-split references (`reference/finance.md`, `sales.md`…) so only relevant context loads; Pattern 3 conditional details. **Keep references one level deep** (Claude partially reads deeply-nested files with `head`). For reference files >100 lines, add a table of contents at top.
  - **Descriptions** third-person, what+when, key terms; one description chooses among 100+ skills.
  - **Workflows:** provide a copy-paste checklist for complex multi-step tasks (works for non-code analysis too).
  - Test across the models you'll use (Haiku needs more guidance; Opus needs less over-explaining).
- **Source path:** `writing-skills/anthropic-best-practices.md`
- **Quality:** 5.
- **Recommendation:** adopt-as-is.

### subagent-driven-development + 3 prompt templates → maps to our worker/reviewer subagents + dev process
- **What it is / why valuable:** Concrete workflow: fresh subagent per task + **two-stage review (spec compliance FIRST, then code quality)** + review loops. The three prompt templates are copy-paste-ready and map onto our model-builder/report-builder (implementer) and model-reviewer/report-reviewer (spec + quality reviewers).
- **Key content (reusable bits):**
  - **Implementer prompt:** paste FULL task text (don't make subagent read the plan file); scene-setting context; "ask questions before AND during"; implement→test(TDD)→verify→commit→**self-review** (Completeness/Quality/Discipline-YAGNI/Testing) then report (what built / tested+results / files / self-review findings / concerns).
  - **Spec reviewer prompt:** "CRITICAL: Do Not Trust the Report — the implementer finished suspiciously quickly." Read actual code, compare line-by-line to requirements; check Missing, Extra/over-engineered, Misunderstandings; report `✅ Spec compliant` or `❌ Issues` with file:line.
  - **Code-quality reviewer prompt:** only dispatch AFTER spec passes; uses the shared `code-reviewer.md` template; returns Strengths / Issues (Critical/Important/Minor) / Assessment.
  - **Red flags / never:** skip reviews; proceed with unfixed issues; dispatch parallel implementers (conflicts); make subagent read the plan; start code-quality before spec is ✅; move on with open issues. Controller curates exactly the context needed (no file-read overhead, no leakage).
  - **Phase-gate self-questions** before claiming branch ready (every task passed spec→quality; all reviewer issues fixed + re-reviewed; Todo/tests/notes agree; another engineer can audit why it's safe).
- **Source path:** `subagent-driven-development/SKILL.md`, `implementer-prompt.md`, `spec-reviewer-prompt.md`, `code-quality-reviewer-prompt.md`
- **Quality:** 5.
- **Recommendation:** adapt — turn the three templates into our subagent definitions; bake "spec-first-then-quality" + "don't trust the report" into model-reviewer/report-reviewer.

### code-reviewer.md (two-stage review template) → maps to our reviewer subagents
- **What it is / why valuable:** Self-contained reusable reviewer prompt with placeholders (`{WHAT_WAS_IMPLEMENTED}`, `{PLAN_OR_REQUIREMENTS}`, `{BASE_SHA}`, `{HEAD_SHA}`, `{DESCRIPTION}`), a review checklist (Code Quality/Architecture/Testing/Requirements/Production Readiness), strict severity buckets (Critical=must fix / Important=should fix / Minor=nice-to-have), output format (Strengths/Issues with file:line+why+fix/Recommendations/Assessment "Ready to merge? Yes/No/With fixes"), and DO/DON'T rules ("don't mark nitpicks Critical", "give a clear verdict").
- **Source path:** `requesting-code-review/code-reviewer.md`, `requesting-code-review/SKILL.md`
- **Quality:** 5.
- **Recommendation:** adopt-as-is as the base prompt for our report/model reviewer agents.

### agentic-eval (rubric loop) → maps to evaluating our skills/agents/outputs + agentic-eval skill
- **What it is / why valuable:** Lightweight evaluator-optimizer loop with weighted rubrics and explicit stop conditions — usable to grade our generated DAX/TMDL/reports and our own skills.
- **Key content (reusable bits):**
  - Loop: define artifact → weighted rubric → generate → evaluate → convert feedback to concrete changes → re-run until threshold met or budget exhausted.
  - Three patterns: Self-Reflection (moderate risk), Evaluator-Optimizer split (high value, separate judge), Evidence-Based (back score with tests/logs/benchmarks).
  - Rubric rules: few concrete dimensions, weight business-critical highest, define passing score up-front, require written evidence for any failing dimension, stop when no longer learning fixes. Suggested dims: correctness/completeness/clarity/maintainability/risk/evidence-quality.
  - Output table format (Dimension|Weight|Score|Notes → Weighted score vs Threshold → PASS/FAIL → Required Improvements). Concrete rubric JSON: `{max_score:5, dimensions:{correctness:{weight:0.4}, completeness:{0.25}, clarity:{0.15}, maintainability:{0.2}}}`.
  - Stop conditions + phase-gate questions ("did I stop because acceptable or because I ran out of patience?").
- **Source path:** `agentic-eval/SKILL.md`, `agentic-eval/references/rubric-template.json`, `example-scores.json`
- **Quality:** 5.
- **Recommendation:** adapt (define a PBI-specific rubric: DAX correctness, model-health, perf, naming, RLS-safety).

### verification-before-completion → maps to all our reviewer agents + Stop hooks + dev process
- **What it is / why valuable:** Hard discipline skill: "Claiming work complete without verification is dishonesty." Iron Law: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
- **Key content (reusable bits):**
  - **Gate function:** IDENTIFY proving command → RUN full/fresh → READ full output+exit code+failure count → VERIFY → only then claim WITH evidence. Skip a step = lying.
  - **Claim→Requires→Not-Sufficient table** (Tests pass = 0 failures in *this* run, not "should"; Build = exit 0, not "linter passed"; Agent completed = VCS diff shows changes, not "agent reported success"; Requirements met = line-by-line checklist, not "tests pass").
  - Red flags ("should/probably/seems", "Great!/Perfect!/Done!" before verifying, trusting agent reports, "just this once") + rationalization table.
  - Regression test must be red-green verified (revert fix → MUST FAIL → restore → pass).
- **Source path:** `verification-before-completion/SKILL.md`
- **Quality:** 5.
- **Recommendation:** adopt-as-is — strong fit for our reviewer agents and any "done" claim; pairs with our validator hook.

### test-driven-development (TS-flavored) → maps to our dev process for core/mcp packages
- **What it is / why valuable:** TS/Vitest-Jest-flavored RED-GREEN-REFACTOR with good/bad test examples (test real behavior, not mocks; one behavior; clear name). Iron Law + "watch it fail" mandatory step. "Tests written after pass immediately — proves nothing."
- **Source path:** `test-driven-development/SKILL.md`, `test-driven-development/testing-anti-patterns.md` (not deep-read)
- **Quality:** 5.
- **Recommendation:** adopt-as-is (we already use vitest; this codifies discipline).

### systematic-debugging (4-phase) → maps to our debugging discipline + reviewer/builder agents
- **What it is / why valuable:** 4 phases (Root Cause → Pattern Analysis → Hypothesis+Testing → Implementation), each gated. Iron Law: NO FIXES WITHOUT ROOT CAUSE FIRST. "Symptom fixes are failure." Cheat-sheet table (phase|goal|min evidence|red flags).
- **Key content (reusable bits):** read errors fully; reproduce; check recent changes (git diff); **add diagnostic instrumentation at each component boundary** in multi-layer systems to find WHERE it breaks before fixing; trace data flow backward to source; single hypothesis + smallest test; "sufficient evidence" questions before leaving Phase 1. Companion `condition-based-waiting.md` has a TS `waitFor()` polling helper (poll 10ms, always timeout) for flaky async tests — directly usable in our test suite.
- **Source path:** `systematic-debugging/SKILL.md`, `systematic-debugging/condition-based-waiting.md`, `root-cause-tracing.md`/`defense-in-depth.md` (not deep-read), `CREATION-LOG.md` (good worked example of bulletproofing a skill)
- **Quality:** 5.
- **Recommendation:** adopt-as-is.

### code-quality (review priorities + refactoring catalog) → maps to our reviewer agents
- **What it is / why valuable:** Severity-ranked review priorities (🔴 CRITICAL block merge: security/correctness/breaking-changes/data-loss; 🟡 IMPORTANT: SOLID/test-coverage/perf/architecture; 🟢 SUGGESTION: readability/optimization/best-practices/docs); review principles (be specific file:line, explain WHY, suggest fix, acknowledge good code, be pragmatic, group related comments). Refactoring golden rules (behavior preserved, small steps, commit before/after, tests essential, one thing at a time) + when-NOT-to-refactor + smell catalog (long method, dup code, large class, magic numbers, feature envy) + self-evaluation reflection-loop pseudocode.
- **Source path:** `code-quality/SKILL.md`, `code-quality/references/{code-smells,refactoring-catalog}.md` (not deep-read)
- **Quality:** 5.
- **Recommendation:** adapt — fold severity buckets + principles into our reviewer agents.

### writing-plans → maps to our pipeline/plan skills + writing-plans skill
- **What it is / why valuable:** "Write plans assuming the engineer has zero context and questionable taste." Bite-sized tasks (one action, 2-5 min: write failing test → run to fail → minimal code → run to pass → commit). Mandatory plan header (Goal/Architecture/Tech Stack + REQUIRED SUB-SKILL pointer). Task structure with **exact file paths**, complete code (not "add validation"), exact commands + expected output. Save to `docs/plans/YYYY-MM-DD-<feature>.md`. Execution handoff offering subagent-driven vs parallel-session.
- **Source path:** `writing-plans/SKILL.md`
- **Quality:** 5.
- **Recommendation:** adopt-as-is (we already keep plans in docs/superpowers/plans/).

### subagent-delegation + agent-task-mapping → maps to our subagent orchestration
- **What it is / why valuable:** 5-step delegation process (Plan→Delegate→Review→Integrate→Validate); quality-control checklist before integrating subagent output (follows conventions, matches interfaces, error handling, no security/perf issues, compatible imports); phase-gate questions (scoped task? reviewed output not forwarded blindly? evidence trail? unresolved assumptions explicit?). agent-task-mapping gives a decision framework (identify task type → match specialization → check availability → use exact agentName) — pattern is reusable even though its specific agent roster (React/Next/Playwright) is irrelevant to us.
- **Source path:** `subagent-delegation/SKILL.md`, `subagent-delegation/references/patterns.md` (not deep-read), `agent-task-mapping/SKILL.md`
- **Quality:** 4 (delegation), 3 (task-mapping roster is off-domain).
- **Recommendation:** adapt the delegation process + QC checklist; reference-only the agent roster.

### Cross-client skill structural conventions (excel-sheet / spreadsheet-formula-helper / sql-development as templates) → maps to our SKILL.md house style
- **What it is / why valuable:** Not domain content for us, but a consistent SKILL.md template worth mirroring: frontmatter (name/description/version/last_updated/tags), "Activation Conditions" as symptom→action triggers, "Anti-Patterns", a 5-point "Verification Protocol" (incl. one pressure-test + a measurable success metric), "MCP Availability And Fallback" (preferred server + copy-paste fallback prompt), and a "Related Skills" footer. SQL skill's one genuinely transferable idea: **SARGable predicates** (no functions on indexed/filtered columns) — conceptually mirrors our DAX perf rule about avoiding column-function filters; and "explicit columns, never SELECT *" mirrors "import only needed columns."
- **Source path:** `excel-sheet/SKILL.md`, `spreadsheet-formula-helper/SKILL.md`, `sql-development/SKILL.md`
- **Quality:** 3 (as templates, not domain).
- **Recommendation:** reference-only (template), adapt the SARGable/explicit-columns concept into our perf skill.

## Cross-source overlap flags
- **writing-skills + anthropic-best-practices vs awesome-copilot-meta + powerbi-agentic-plugins(-structure):** All cover skill authoring. This source is the *strongest and most opinionated* on CSO, TDD-for-skills, degrees-of-freedom, and progressive disclosure — treat it as the primary authoring doctrine; let the consolidator dedupe overlapping "how to write a skill" sections and keep only the unique bits from the others (e.g., PBIP/plugin-packaging specifics from the powerbi-agentic-plugins findings).
- **mcp-builder (this source) vs awesome-copilot mcp findings vs the `mcp-builder` skill already installed:** Heavy overlap on tool naming/annotations/pagination/structured-output. This source has the most complete *TS-specific* SDK guidance + the *evaluation* methodology — prefer it; dedupe the generic best-practices list.
- **agentic-eval vs code-quality "Self-Evaluation" vs mcp-builder/evaluation:** Three takes on evaluator-optimizer loops. agentic-eval = the rubric loop; mcp-builder/evaluation = MCP-specific QA-pair eval; code-quality = reflection-loop code. Keep all three but file under one "evaluation" umbrella to avoid duplication.
- **verification-before-completion vs test-driven-development vs subagent-driven-development:** Shared "evidence before claims / don't trust agent reports" thread — consolidate the rationalization tables once and cross-reference.
- **PBI references here vs dg3-semantic-models / skills-for-fabric-* / awesome-copilot-pbi-data findings:** Likely overlapping DAX/star-schema/RLS guidance. This source is concise and checklist-driven; the data-goblin/fabric findings probably go deeper on TMDL/PBIP file formats and Tabular Editor/TE scripting. Merge: keep this for the *rules/checklists*, keep the fabric sources for *file-format + tooling* specifics.

## Discarded / not relevant
- **powerpoint-ppt, microsoft-development (Azure Functions/C#), legacy-circuit-mockups, notebooklm/notion/word/pdf, vite/react/nextjs/php/mongodb, frontend/canvas/stitch/premium-frontend, infostealer/secret-scanning** — off-domain or other-runtime; sibling agent owns the breadth/UX skills. (Azure Functions C# Cosmos example is a clean REST/DI sample but reference-only — wrong runtime.)
- **jupyter-notebook** — assigned to me but low value for our plugin (notebook structure/experiment patterns don't map to a PBI authoring plugin); skipped deep read intentionally. Reference-only if we ever ship analysis notebooks.
- **sql-development references (mysql-8.4 / tsql-patterns / performance-tuning) deep content** — SQL Server/MySQL-specific (MERGE, PIVOT, Query Store, stored-proc templates); not our DAX/M domain. Reference-only; only the SARGable + explicit-columns *concepts* transfer.
- **excel-sheet / spreadsheet-formula-helper domain content** (openpyxl, Excel/Sheets formula dialects) — not PBI modeling; kept only their SKILL.md *structure* as a template.
- **mcp-builder/reference/python_mcp_server.md** — Python SDK (FastMCP); reference-only since we're TS-only (parallel structure confirms our TS choices but no code to lift).
- **Python MCP-call snippets in powerbi-modeling/examples** — illustrative only; we must re-express in TS against our own tool surface (and must NOT hardcode the example field names per project CLAUDE.md).
