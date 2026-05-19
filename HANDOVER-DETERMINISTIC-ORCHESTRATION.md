# pbi-mcp-ts — Handover Brief: Deterministic Orchestration Sprint

**Audience:** A fresh Claude Code session that will be asked to produce a plan (not code) for the next sprint.

**Reading order:** Read this brief in full first. Then read the files listed under §9 in the order given. Then produce the plan described in §10. Do not write code until the plan is approved by the user.

---

## TL;DR

We've built a 47-tool TypeScript MCP server + 16 skills + 7 subagents for Power BI report authoring on Mac (with Microsoft's modeling MCP handling the modeling layer). The orchestration between skills / agents / MCP tools is currently enforced through markdown rules in prompt files ("you MUST invoke the architect," "NEVER fabricate measures," "model-doctor MUST pass with zero errors"). These rules drift. In the most recent real-world test the agent:

1. Skipped the multi-fact architect gate (a "REQUIRED, NOT OPTIONAL" markdown rule).
2. Fabricated `Profit Target = Sales Target × 0.15` to fill a gap in the source data.
3. Defaulted to a TREATAS bridge for cross-fact comparison instead of conformed dim tables.
4. Bound bridged measures on Sub-Category axes (in `bridge_blocked_axes`), producing mathematically wrong numbers that validators couldn't catch.
5. Reported "Clean bill of health — zero errors, zero warnings" because PBIR-structural validation passes regardless of semantic correctness.

Phase 8.9 (just landed) hardened the markdown rules, but they remain markdown. The user's directive for the next sprint:

> "We need to make a plan to have our architecture and flow more deterministic — using tools and stuff. We need handover to another session."

**Translation:** Move gate enforcement from prompt sentences to code-level write boundaries. If the write tool refuses on a precondition violation, the LLM physically cannot bypass it.

**Important review update:** The first version of this brief over-trusted two ideas that are still soft unless implemented carefully:

1. **Plain JSON "certifications" are not hard gates.** If the LLM can type the certificate, it can fabricate the certificate. A certificate only counts as hard if a tool issues an opaque/signed value that downstream tools verify, OR if the downstream tool recomputes the fact from TMDL/PBIR itself.
2. **Parallel safe tools do not help if unsafe tools remain available.** `pbi_visual_bind_safe` next to `pbi_visual_bind` will be bypassed eventually. The default plan should harden the existing `pbi_visual_bind` and `pbi_visual_bulk_bind` tools, or remove the unsafe tools from every normal skill/agent surface.
3. **Modeling writes are harder than report writes.** This repo's MCP server owns PBIR/report writes. Microsoft's modeling MCP is a separate sibling server. A true `pbi_measure_create_safe` requires a real wrapper/proxy around Microsoft `measure_operations.Create` or a tool-surface change that prevents direct unsafe calls. A preflight checker alone is useful, but not deterministic.
4. **Reference checking does not stop business-logic fabrication.** `Profit Target = [Sales Target] * 0.15` can reference real fields and still be invented. The sprint needs a provenance gate: direct aggregation, standard derivation, or explicit user-approved proxy with a permanent TMDL description.

---

## 1. Project context

### What pbi-mcp-ts is

A Claude Code plugin that lets the user author Power BI reports through natural language. Repo: `/Users/heshameissa/Documents/Projects/pbi-mcp-ts`. TypeScript port of an older Python tool at `/Users/heshameissa/Documents/Projects/pbi-cli` (the Python project is the reference design — DO NOT propose returning to Python; we are actively migrating away).

### Layered architecture

| Layer | Owned by | Responsibility |
|---|---|---|
| Engine | `packages/core/` (TS) | Pure functions over PBIR JSON + TMDL files. No I/O beyond fs. 500 tests. |
| MCP server | `packages/mcp/src/server.ts` | Stdio MCP server. Wraps engine functions as 47 MCP tools prefixed `pbi_*`. |
| CLI | `packages/cli/` | Commander CLI for headless use. |
| Skills + Agents | `skills/*/SKILL.md`, `agents/*.md` | Prompt-layer orchestration. Tell the LLM how to compose tool calls. |
| Hooks | `hooks/` | PostToolUse validators. |
| Plugin manifest | `.claude-plugin/plugin.json`, `.mcp.json` | Registers skills / agents / MCP servers / hooks for Claude Code. |

### Sibling: Microsoft modeling MCP

We pair with `@microsoft/powerbi-modeling-mcp` (vendored at `bin/powerbi-modeling-mcp`, 47MB Mac arm64 binary, ad-hoc signed for Gatekeeper). It owns the TMDL semantic-model layer (tables, columns, measures, relationships, ConnectFolder, ExportToTmdlFolder). We own the PBIR report layer (pages, visuals, bindings, themes). We do not replicate or replace Microsoft's MCP.

### Key constraint: dataset-agnostic

Every line of code and every rule in every prompt must work on ANY Power BI model the user connects. We must NEVER hardcode names from our dev test fixture (Demo.pbip, "Sample - Superstore_Orders", "Sales Target (US)_Full Data", etc.). Both Phase 8.8 and Phase 8.9 just passed dual-agent audits confirming zero dataset hardcoding.

---

## 2. What's been built (recent phases)

### Phase 8.5 — Layout primitives + dashboard scaffolds (done)
Engine layout helpers (`layoutRow`, `layoutColumn`, `layoutGrid`). Three scaffold skills (`pbi-scaffold-overview`, `pbi-scaffold-kpi-grid`, `pbi-scaffold-drill`) that compose layouts at runtime. `pbi-designer` subagent for layout review.

### Phase 8.7 — Intent + modeling synthesis (done)
`pbi-measure-architect` skill (DAX synthesis from intent: YoY / MoM / QoQ / YTD / rolling / vs-target / share-of). `pbi-data-architect` subagent (multi-fact reasoning, relationship synthesis). `pbi-date-intelligence` skill (date-aware template library).

### Phase 8.8 — Modeling validators package (done, this session)
Net-new code: `packages/core/src/modeling/`:
- `tmdl-parser.ts` — offline TMDL parser → `TMDLModel`.
- `grain.ts` — bridge analysis (`bridge_covers` / `bridge_uncovered` / `bridge_blocked_axes`).
- `bpa.ts` — 15 BPA rules (DAX001-005, FMT001-002, MOD001-007, NAM001).
- `relationship-check.ts` — missing endpoints, type mismatch, ambiguous active relationships, cycle detection.
- `doctor.ts` — orchestrator.
Exposed as MCP tool `pbi_model_check` and subagent `pbi-model-doctor`. 34 new tests.

### Phase 8.9 — Orchestration hardening via prompt rules (done, this session)
Six surgical edits to skill / agent prompts:
1. data-architect step 4a flipped to shared-dim FIRST (TREATAS bridge as fallback).
2. data-architect step 1.5 anti-fabrication firewall (mandatory clarifying questions when model can't deliver).
3. Scaffold gates expanded to fire on comparative-intent keywords (vs / YoY / variance / target / etc.), not just fact-count ≥ 2.
4. measure-architect step 9.5 model-doctor upgraded to "hard gate" (zero errors required).
5. measure-architect anti-fabrication rule (verify references before Create).
6. Anti-shell-out rule across 7 agents.

**Phase 8.9's limitation:** every fix is a markdown sentence. The LLM can still bypass them. This sprint exists because Phase 8.9 was not enough.

---

## 3. The problem this sprint must solve

### Symptom (concrete)

User asked for an executive dashboard with Sales-vs-Target visuals across multiple axes including Sub-Category. The agent:

- Did not invoke `pbi-data-architect` (the gate was a markdown rule, agent rationalized that it "had a clear picture").
- Created 3 measures, one of which was `Profit Target = Sales Target × 0.15` — pure fabrication, because the Targets table had no Profit Target column.
- Used TREATAS bridge for Sales-vs-Target, which structurally cannot work on Sub-Category (Targets has no Sub-Category column).
- Bound `Total Sales` + `Sales Target` on a Sub-Category bar chart anyway. Numbers were wrong.
- Reported success because PBIR validator (which only checks structural integrity) found no errors.

### Why prompt rules drift

When a rule is a sentence in a 200-line markdown file, the LLM treats it as guidance and can rationalize bypass under several conditions:
- "I already have what I need, so the step is implied."
- The rule is wrapped in "should" / "must" / "REQUIRED" prose that the LLM has been trained on as a soft signal.
- A different skill / agent invocation provides similar information, so the gate "feels" satisfied.
- The text is far enough from the current step that the LLM has forgotten it by the time the gate would fire.

This is documented in the project memory (`feedback_pbi_dashboard_three_silent_failures.md`, `feedback_pbi_scaffold_kind_map_authoritative.md`). The pattern repeats every time a rule is added in prose.

### Failure modes observed across the project

| # | Rule | Failure type |
|---|---|---|
| 1 | Scaffold step 2.5 "MUST invoke data-architect" | Skipped silently on multi-fact models. |
| 2 | Kind-map "authoritative" rule | Bypassed via custom Task subagents that didn't read the kind map. |
| 3 | Persistence rule (ExportToTmdlFolder required) | Skipped enough times to require a dedicated fix task (#43). |
| 4 | formatString bare-TMDL form (no triple quotes) | Triple-quoted on multiple sessions; required a dedicated fix task (#44). |
| 5 | TREATAS pre-flight to compute bridge_blocked_axes | Computed inconsistently; required fix tasks #45, #46. |
| 6 | "No fabrication" rule | Bypassed by `Profit Target = Sales Target × 0.15` last session. |
| 7 | model-doctor "MUST run with zero errors" | Just added; untested but exposed to the same drift mode. |

---

## 4. The user's directive

Verbatim:

> "fine - i think now we need to work on an important sprint which is not having our soft skills - we need to make a plan to have our architecture and flow more determinstic - using tools and stuff."

**Interpretation:**
- "soft skills" = markdown rules in skill / agent prompts.
- "deterministic ... using tools" = move enforcement to code-level tool boundaries.
- "important sprint" = a focused 1–2 week deliverable, not a 6-month rewrite.

---

## 5. Architectural options (think through each, recommend a narrowed sprint)

### Option A — Token-gated MCP tools
**Idea:** Downstream write tools refuse to run without a certification issued by an upstream MCP tool. The data architect subagent may consume the certification, but the LLM must not be the authority that creates it.
- **Pro:** Cannot be bypassed if the token is opaque/signed and verified server-side, and if the unsafe write path is removed or hardened.
- **Pro:** Self-documenting via tool schema.
- **Con:** Plain JSON certificates are bypassable because the LLM can fabricate them.
- **Con:** Tokens need scope (model path + report path + page + visual + model mtime/hash + issued-at). Stateless is possible only with signed payloads or deterministic recomputation.

### Option B — Pre-write validators baked into write tools
**Idea:** Every write tool internally calls validators before executing. No external gate needed.
- `pbi_visual_bind` / `pbi_visual_bulk_bind` internally validate field existence, measure-vs-column kind, required aggregation, and axis/measure compatibility before writing PBIR.
- A future modeling wrapper verifies references, format strings, provenance, and persistence before/after invoking Microsoft modeling MCP.
- **Pro:** Zero ceremony for the LLM — the tool just works or returns a structured error.
- **Pro:** Stateless. Each call is self-contained.
- **Con:** Tools become heavier; validator runtime cost per write.
- **Con:** Doesn't enforce cross-skill handoffs (e.g., "architect must have run first" can't be encoded in a single write tool's preconditions).

### Option C — Single workflow MCP tool
**Idea:** Replace the dashboard scaffold's multi-step orchestration with one MCP tool `pbi_dashboard_build({ pageName, userRequest, ... })` that runs the entire pipeline deterministically.
- **Pro:** Maximum determinism — code owns the workflow.
- **Con:** Stiff. Cannot handle "wait, change of plans" mid-flight.
- **Con:** Hides the workflow steps from the LLM; debugging becomes a black-box exercise.
- **Con:** A large new tool with many internal LLM calls would replicate work the skill layer already does.

### Option D — Workflow runner / state machine engine
**Idea:** A thin engine that runs a DAG workflow. The LLM is INSIDE a step, not orchestrating the whole.
- **Pro:** Deterministic order of operations.
- **Con:** Heavy infra to build. Most of the value of B comes for less complexity.

### Option E — Narrowed hybrid (recommended starting position for the plan)
- **B first, on existing report write tools** — harden `pbi_visual_bind` and `pbi_visual_bulk_bind` in place. These are fully owned by this repo and have clean local preconditions.
- **Modeling-wrapper track second** — only call `pbi_measure_create_safe` deterministic if it is a real proxy/wrapper around Microsoft modeling MCP OR direct unsafe modeling calls are removed from normal skills. Otherwise call it "preflight assistance", not a hard gate.
- **A only if certificates are tool-issued and non-forgeable** — prefer downstream recomputation from TMDL/PBIR for bind checks. If certificates are used, make them opaque/signed; do not trust plain LLM-authored JSON.
- **Defer C and D** — too stiff; the skill / agent layer is where ergonomics live and we should not rewrite all of it in one sprint.

**Sprint recommendation:** Option B only for report-side writes in this sprint. Harden existing `pbi_visual_bind` and `pbi_visual_bulk_bind`; defer token gates and true modeling-MCP wrappers unless the plan explicitly shows how they are made non-bypassable in 1-2 weeks.

---

## 6. Soft-rule → tool migration candidates

Concrete table for the plan to triage. Mark each as in-sprint / deferred / not-worth-it.

| # | Current rule (markdown) | Where it lives now | Sprint status | Migration approach |
|---|---|---|---|---|
| 1 | "Every Table[Col] / [Measure] in DAX must exist in model before Create" | `skills/pbi-measure-architect/SKILL.md` Boundaries | Deferred hard enforcement / optional advisory | `pbi_dax_reference_check` is useful, but does NOT stop fabrication by itself. Hard enforcement requires a modeling wrapper plus provenance classification: direct aggregation / standard derivation / explicit user-approved proxy. |
| 2 | "model-doctor MUST pass with zero errors before binding" | `agents/pbi-data-architect.md` step 8.5; `skills/pbi-measure-architect/SKILL.md` step 9.5 | In sprint | Patch existing `pbi_visual_bind` and `pbi_visual_bulk_bind` to run model-aware preflight before writing. No parallel `pbi_visual_bind_safe` unless unsafe bind is removed from normal skill/agent surfaces. |
| 3 | "Bridged measures may only be bound on `bridge_covers` axes" | `skills/pbi-scaffold-overview/SKILL.md` step 2.5 binding rules | In sprint | Bind tool recomputes/verifies coverage from TMDL/DAX/model graph, then refuses incompatible axis/measure pairs. Certification may annotate intent but is not trusted unless tool-issued and non-forgeable. |
| 4 | "Data-architect MUST be invoked on multi-fact OR comparative-intent" | All 3 scaffolds, Rule 1 + step 2.5 | Advisory only | `pbi_intent_classify` can help scaffolds route earlier, but the hard safety net is bind-time refusal. A later tool cannot force a subagent to have run; it can refuse unsafe cross-fact output. |
| 5 | "Anti-fabrication firewall — clarify when model lacks requested metric" | `agents/pbi-data-architect.md` step 1.5 | Deferred hard enforcement / optional advisory | `pbi_request_verify({ userRequest, modelPath })` can return gap + provenance analysis. For true hard enforcement, measure creation must require provenance metadata and reject proxy formulas unless user-approved. |
| 6 | "Persist via ExportToTmdlFolder after every modeling write batch" | Multiple skill prompts | Deferred hard enforcement | Hard to enforce without wrapping Microsoft's MCP. Session-end hooks are best-effort only. A real modeling wrapper should call Create/Update/Delete, then ExportToTmdlFolder, then disk-side verify before success. |
| 7 | "formatString must be bare-TMDL backslash form, never triple-quoted" | `skills/pbi-measure-architect/SKILL.md` step 7 | Deferred hard enforcement | Enforce in the modeling wrapper if built. If no wrapper, `pbi_measure_preflight` and model-doctor post-check are advisory/backstop only and remain bypassable. |
| 8 | "No shell-outs (no cat/grep/py/jq) for things MCP tools expose" | 7 agents, Tool discipline | Not worth code enforcement | Cannot enforce in-tool; this stays as prompt rule. It is about LLM discipline, not data correctness. |
| 9 | "Conformed dim FIRST, TREATAS bridge as fallback" | `agents/pbi-data-architect.md` step 4a | Deferred | Architect remains LLM-driven for proposal and permission. A future engine helper could generate dim-extraction operation plans, but that is not the first deterministic sprint. |
| 10 | "Visual-axis kind-map authoritative — bind only to names that exist" | `skills/pbi-scaffold-overview/SKILL.md` Rule 2 | In sprint | Promote to `pbi_visual_bind` pre-flight. Use the TMDL parser to build a table/column/measure index, then reject missing fields, measure/column shape mismatch, and aggregatable column bindings without aggregation. |

### Required in-sprint deliverables

The plan should include these concrete deliverables if it accepts the recommended scope:

1. `buildModelFieldIndex(modelPath)` or equivalent — reusable core helper over TMDL that returns tables, columns, measures, summarizeBy, hidden flags, measure expressions, and relationship graph.
2. `validateVisualBindingPlan({ reportPath, modelPath?, page, visual, proposedBindings })` — core validator that evaluates the visual's existing projections plus proposed bindings together. It refuses missing fields, measure/column kind mismatch, missing aggregation for summable columns in measure-style roles, bridged/TREATAS measures on blocked axes, and no valid filter path between axis table and measure fact.
3. Harden existing `pbi_visual_bind` with the validator. Keep the current API valid; add optional `modelPath`/auto-resolution if needed. If no sibling `.SemanticModel` exists, preserve current PBIR-only behavior. If a model exists, enforce.
4. Harden `pbi_visual_bulk_bind` with two-phase behavior: find targeted visuals, validate every target first, then write. If any target fails validation, write none.
5. Move `pbi-bind-doctor` off manual TMDL grep/parsing. After this sprint it should call the new tool/validator instead of reimplementing model parsing in prompt text.
6. Keep hooks as post-write backup validation only. The current PostToolUse hook runs after writes, so it cannot be the deterministic gate.

---

## 7. Current MCP tool inventory (47 tools)

Listed in `packages/mcp/src/server.ts`. Grouped:

- **Report**: `pbi_report_create`, `pbi_report_info`, `pbi_report_validate`, `pbi_report_convert`
- **Pages**: `pbi_page_add`, `pbi_page_delete`, `pbi_page_get`, `pbi_page_list`, `pbi_page_set_background`, `pbi_page_set_visibility`
- **Visuals**: `pbi_visual_add`, `pbi_visual_bind`, `pbi_visual_delete`, `pbi_visual_get`, `pbi_visual_list`, `pbi_visual_set_container`, `pbi_visual_update`, `pbi_visual_where`
- **Visual calcs**: `pbi_visual_calc_add`, `pbi_visual_calc_delete`, `pbi_visual_calc_list`
- **Bulk**: `pbi_visual_bulk_bind`, `pbi_visual_bulk_delete`, `pbi_visual_bulk_update`
- **Filters**: `pbi_filter_add_categorical`, `pbi_filter_add_relative_date`, `pbi_filter_add_topn`, `pbi_filter_clear`, `pbi_filter_list`, `pbi_filter_remove`
- **Format**: `pbi_format_background_conditional`, `pbi_format_background_gradient`, `pbi_format_background_measure`, `pbi_format_clear`, `pbi_format_get`
- **Bookmarks**: `pbi_bookmark_add`, `pbi_bookmark_delete`, `pbi_bookmark_get`, `pbi_bookmark_list`, `pbi_bookmark_set_visibility`
- **Themes**: `pbi_theme_diff`, `pbi_theme_get`, `pbi_theme_set`
- **Layout**: `pbi_layout_column`, `pbi_layout_grid`, `pbi_layout_row`
- **Modeling** (Phase 8.8): `pbi_model_check`

Plus the Microsoft modeling MCP (vendored): `mcp__powerbi-modeling__connection_operations`, `table_operations`, `column_operations`, `measure_operations`, `relationship_operations`, `database_operations`, `dax_query_operations`. The plan can propose wrapping these but should not propose replicating them.

---

## 8. Repo layout (quick orientation)

```
pbi-mcp-ts/
├── packages/
│   ├── core/            # engine (TS, 500 tests, dataset-agnostic)
│   │   ├── src/
│   │   │   ├── modeling/        # Phase 8.8 (just landed)
│   │   │   ├── pbir/            # PBIR parsing, schemas, validators
│   │   │   ├── visual/          # bind, calc, backend, templates
│   │   │   ├── filter/, bookmark/, format/, bulk/, layout/, report/
│   │   │   └── index.ts         # barrel
│   │   └── tests/
│   ├── mcp/             # MCP server (TS, 47 tools)
│   │   └── src/server.ts        # single file with all tool registrations
│   └── cli/             # commander CLI
├── skills/              # 16 SKILL.md files
│   ├── pbi-measure-architect/
│   ├── pbi-data-architect/ (no — this lives in agents/)
│   ├── pbi-scaffold-overview/
│   ├── pbi-scaffold-kpi-grid/
│   ├── pbi-scaffold-drill/
│   ├── pbi-date-intelligence/
│   └── ... (pbi-pages, pbi-visuals, pbi-themes, pbi-filters, pbi-bookmarks, pbi-format, pbi-bulk, pbi-layout, pbi-report, pbi-scaffold)
├── agents/              # 7 .md files (subagents)
│   ├── pbi-data-architect.md
│   ├── pbi-model-doctor.md (Phase 8.8)
│   ├── pbi-bind-doctor.md
│   ├── pbi-measure-doctor.md (no — doesn't exist)
│   ├── pbi-bulk-operator.md
│   ├── pbi-designer.md
│   ├── pbi-report-reviewer.md
│   └── pbi-report-validator.md
├── hooks/               # PostToolUse validator
├── .claude-plugin/plugin.json
├── .mcp.json
└── bin/powerbi-modeling-mcp   # Microsoft modeling MCP binary
```

---

## 9. Files to read (in this order)

The fresh session should read these BEFORE writing the plan:

1. **`agents/pbi-data-architect.md`** — the most complex agent. The new shared-dim step (4a-B) and the anti-fabrication firewall (step 1.5) live here. ~370 lines.
2. **`skills/pbi-scaffold-overview/SKILL.md`** — the scaffold whose gate was bypassed. The new dual-trigger Rule 1 and step 2.5 live here. ~180 lines.
3. **`skills/pbi-measure-architect/SKILL.md`** — the skill that fabricated `Profit Target × 0.15`. The new step 9.5 hard gate and anti-fabrication rule live here. ~290 lines.
4. **`agents/pbi-model-doctor.md`** — Phase 8.8 validator agent. ~85 lines.
5. **`agents/pbi-bind-doctor.md`** — today it reimplements model binding checks in prompt text; this sprint should move that logic into core/tooling.
6. **`packages/core/src/visual/bind.ts`** + **`packages/core/src/bulk/backend.ts`** — the existing write paths to harden. Bulk bind currently writes one visual at a time.
7. **`packages/core/src/modeling/index.ts`** — barrel for the modeling package; gives the API surface at a glance.
8. **`packages/core/src/modeling/grain.ts`** + **`bpa.ts`** + **`doctor.ts`** — the validators themselves.
9. **`packages/mcp/src/server.ts`** — the MCP tool registration file (lines 1-300 to see the pattern). Where new deterministic tool inputs / optional `modelPath` fields would go.
10. **`.claude-plugin/plugin.json`** + **`.mcp.json`** — plugin manifest. Shows how skills / agents / MCP servers are registered.
11. **The user's memory at `~/.claude/projects/-Users-heshameissa-Documents-Projects-pbi-cli/memory/`** — especially `MEMORY.md`, `project_pbi_mcp_ts_status.md`, `feedback_pbi_shared_dim_first.md`, `feedback_pbi_dashboard_three_silent_failures.md`, `feedback_pbi_data_architect_must_act.md`, `feedback_pbi_scaffold_kind_map_authoritative.md`.
12. **`packages/core/tests/modeling/*.test.ts`** + **`packages/core/tests/visual/bind.test.ts`** — to see the testing style and existing bind regression coverage.

---

## 10. What the plan should produce

A markdown plan that the user can review before any code lands. Required sections:

1. **Sprint scope** — what's in (concrete tool list with names), what's deferred, what's out of scope.
2. **Deliverables** — for each new tool/helper: name, input schema sketch, output schema sketch, preconditions enforced, where it lives in the repo. Required: model field index, visual binding plan validator, hardened `pbi_visual_bind`, hardened two-phase `pbi_visual_bulk_bind`.
3. **Migration table** — for each markdown rule being replaced: where it lived, what tool replaces it, what happens to the prompt text (delete entirely / keep as backup / replace with "the tool handles this").
4. **Tests strategy** — include core unit tests for field index + bind validator, `visualBind` regression tests, bulk-bind atomicity tests, bridge-mismatch fixture tests, MCP smoke tests for schema/backward compatibility, skill/agent migration audit, and dataset-agnostic search.
5. **Backward compatibility** — default recommendation should be to harden existing `pbi_visual_bind` / `pbi_visual_bulk_bind`, not add parallel safe tools. If the plan proposes safe suffix tools, it must also explain how unsafe tools are removed from normal skills/agents so the gate cannot be bypassed.
6. **Risk list** — top 3-5 things that could go wrong and how to mitigate.
7. **Estimate** — rough person-day count and dependencies between deliverables.
8. **Open questions** — anything the plan author cannot resolve without the user.

The plan should NOT include code. Pseudocode for tool schemas is fine; actual TS implementations come after approval.

---

## 11. Constraints and non-goals

**Constraints:**
- **Dataset-agnostic.** No hardcoding "Sample - Superstore_Orders" / "Sales Target (US)" / etc. anywhere. Both code and prompts just passed audits — keep them passing.
- **TypeScript only.** No reverting to Python. The pbi-cli repo is the Python ancestor and is being deprecated.
- **Pairs with Microsoft modeling MCP.** Wrap, don't replace. The vendored binary handles ConnectFolder / ExportToTmdlFolder / measure_operations / relationship_operations etc.
- **Hard gate definition.** A fix is deterministic only if the write boundary enforces it. Optional preflight tools, prompt rules, and plain JSON from the LLM are helpful but not hard gates.
- **Hooks are backstops, not gates.** The current hook is `PostToolUse`, so it can report a bad write after the fact but cannot prevent it.
- **Mac is primary, Windows is secondary.** Many users run Desktop on Windows but author on Mac. Anything Desktop-specific (live DAX queries) is opt-in.
- **MCP stdio transport.** Don't propose moving to HTTP / SSE unless the plan explains why.

**Non-goals for this sprint:**
- A workflow runner (Option D). Out of scope.
- Replacing all skills / agents with code. Skill layer is where ergonomics live.
- A new validator framework. Phase 8.8 just delivered one; build on it.
- Live DAX execution / empirical grain probe. That's deferred Phase 8.8b.
- Persisting tokens server-side. If a token system is proposed, prefer stateless signed/opaque tokens or recomputation from model/report state. Plain JSON certificates are explicitly not acceptable as hard gates.

---

## 12. Open questions worth surfacing in the plan (don't decide unilaterally)

1. **Patch existing bind or add safe bind?** Recommended: patch existing `pbi_visual_bind` and `pbi_visual_bulk_bind`. If co-existing safe tools are proposed, how is unsafe bind removed from skill/agent allowed tools?
2. **Can we build a real modeling wrapper this sprint?** If yes, define how our MCP invokes Microsoft modeling MCP and handles Create → ExportToTmdlFolder → disk verify. If no, classify measure safety as partial/advisory and keep the sprint centered on report binding.
3. **Certification shape.** If used, is certification recomputed by the bind tool, signed/opaque, or plain JSON? Plain JSON is not acceptable as a hard gate.
4. **Bridge-mode tolerance.** If a user explicitly chose TREATAS bridge over conformed dims (Path C in data-architect), the bind tool needs path-aware rules: covered axes allowed, blocked axes refused, actuals-only axes allowed for actuals measures only.
5. **Pre-flight cost.** Model-aware bind preflight may parse TMDL on every bind. Cache by model path + mtimes/hash? Batch validation for multi-binding and bulk-bind?
6. **Bulk-bind atomicity.** Should failure on one visual block the whole bulk operation? Recommended yes: validate all targets before writing any.
7. **Failure UX.** When a write tool refuses, what's the error shape? Prefer structured `{ code, severity, blockedWrite, reason, fixOptions }` so the LLM can recover.
8. **Microsoft MCP version pinning.** If we wrap Microsoft's tools in a later sprint, we depend on their API shape. What happens when they ship a new version of the modeling MCP? Plan should mention.
9. **Audit / telemetry.** Should we log every refusal to a file for post-mortem? Light touch (counts only) or verbose? Helpful for spotting drift in the LLM's tool-use patterns.

---

## 13. What NOT to do (in the plan)

- Do not propose deleting all skills or agents — they're where natural-language ergonomics live.
- Do not propose moving to a different MCP framework (e.g., LangChain tools). We're committed to the MCP protocol.
- Do not propose replacing Microsoft's modeling MCP. We wrap, we don't reinvent.
- Do not propose adding Python anywhere. The Python project (pbi-cli) is being deprecated.
- Do not treat an optional preflight tool or LLM-authored JSON certificate as deterministic enforcement.
- Do not leave an unsafe write tool in the normal allowed-tools path while claiming a safe replacement enforces the rule.
- Do not propose breaking the existing 500 tests. Backward compatibility for the engine layer is required.
- Do not skip the dataset-agnostic audit at the end. Re-run the dual-agent audit pattern from this session before sprint close.
- Do not produce a plan over ~4000 words. Tight is better; the user reads every line.

---

## 14. Existing memory references

These are in `~/.claude/projects/-Users-heshameissa-Documents-Projects-pbi-cli/memory/`. Read selectively as needed; do not read all of them.

- `MEMORY.md` — index of all memory entries.
- `project_pbi_mcp_ts_status.md` — full project status snapshot (read in full).
- `feedback_pbi_shared_dim_first.md` — Phase 8.9 outcome on conformed-dim default.
- `feedback_pbi_data_architect_must_act.md` — historical fix on architect not acting.
- `feedback_pbi_dashboard_three_silent_failures.md` — the recurring failure modes.
- `feedback_pbi_scaffold_kind_map_authoritative.md` — the kind-map bypass pattern.
- `feedback_no_dataset_hardcoding.md` — the dataset-agnostic rule.
- `feedback_pbi_modeling_validators_gap.md` — Phase 8.8 build notes.
- `feedback_pbi_measure_vs_column_binding.md` — measure/column shape detection.
- `feedback_pbi_plugin_dev_loop.md` — the dev install loop (symlinked plugin cache).
- `feedback_modeling_mcp_persist.md` — the ExportToTmdlFolder rule.

---

## 15. Smoke-test the plan before submitting

Before handing the plan back, the fresh session should sanity-check it against the recent failure log (the one in this session that produced the corrupted dashboard). Walk through:

1. User says "build me an executive dashboard with Sales vs Target by Sub-Category."
2. Step by step, would the new architecture catch each of the failures listed in §3?
   - Fabricated `Profit Target × 0.15` → caught by which provenance gate? If the plan only has reference checking, this still slips through.
   - Skipped architect on multi-fact → caught how? A later tool cannot force the subagent to have run; it must refuse unsafe cross-fact bind output.
   - Bridged measures on Sub-Category → caught by `pbi_visual_bind` / `pbi_visual_bulk_bind` refusing the incompatible axis/measure pair.
   - "Clean bill of health" while wrong → caught by bind-time model compatibility validation, not only by PBIR structural validation or `model-doctor` zero-error summary.

If any of those four still slips through under the proposed architecture, the plan is incomplete. State explicitly which tool catches each, with the precondition / refusal path.

---

## End of brief

Total length ~4500 words. Self-contained for a fresh session. Do not write code; produce the plan described in §10.
