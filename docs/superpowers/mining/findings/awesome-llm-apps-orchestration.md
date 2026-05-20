# Mining findings: awesome-llm-apps — agent orchestration patterns
Source: awesome-llm-apps.xml

## Relevance summary
Signal-to-noise is mixed but the high-signal parts are very high. The two crash courses (`openai_sdk_crash_course`, `google_adk_crash_course`) and `awesome_agent_skills/` are essentially pattern catalogs — they teach orchestration vocabulary (handoffs, agents-as-tools, sequential/loop/parallel agents, guardrails, structured-output contracts, global plugin/callback hooks, progressive-disclosure skill layout) that maps almost 1:1 onto our subagent + pipeline-skill + hooks + MCP design. The ~60 application READMEs (agent_teams, single_agent_apps, voice, rag) are mostly app-specific Streamlit demos with thin architectural content; I mined the few that demonstrate a transferable team-composition or delegation pattern and discarded the rest. Everything below is described runtime-agnostically; all source code is Python and treated as reference-only per the hard rules.

## High-value extractions

### Sequential / Loop / Parallel as named workflow primitives → maps to our pipeline skills (pbi-build, pbi-modify, pbi-fix-model, pbi-audit)
- The pattern: ADK formalizes three deterministic orchestrators distinct from a free-reasoning LLM agent. **SequentialAgent** runs sub-agents in a fixed order where each builds on the prior's output (Research→Summarize→Critique; or Market→SWOT→Strategy→Implementation). **LoopAgent** repeats a sub-agent set over shared state until `max_iterations` or a sub-agent escalates a "stop" signal. **ParallelAgent** fans out independent sub-agents concurrently, each writing to a *distinct* key in shared state, optionally followed by a synthesizer.
- Why it helps / how to apply: Our pipeline skills ARE these orchestrators expressed as Claude Code skills. pbi-build = a Sequential pipeline (data-analyst → model-builder → model-reviewer → report-builder → report-reviewer). The reviewer→fixer cycle in pbi-fix-model = a Loop with an explicit bounded iteration count and an escalation/"accepted" termination flag, not an open-ended "keep going." Independent read-only analyses in pbi-audit (e.g. model BPA + DAX reference check + visual-bind check) = a Parallel fan-out writing to separate report sections. Adopt the explicit-termination discipline: every loop skill must declare a max-iteration budget AND a success predicate so an agent can stop early.
- Source path: `ai_agent_framework_crash_course/google_adk_crash_course/9_multi_agent_patterns/{9_1_sequential_agent,9_2_loop_agent,9_3_parallel_agent}/README.md`; `.../8_simple_multi_agent/README.md`
- Quality: 5 — cleanest articulation of orchestration topologies in the pack.
- Recommendation: adapt

### Structured output as the inter-agent handoff contract → maps to our DashboardSpec
- The pattern: Every serious example makes agents emit a validated typed object (Pydantic `output_type` / ADK `response_format` / `output_schema`) rather than prose, specifically so downstream code/agents can consume it reliably. Schemas use enums for controlled vocab, required-vs-optional fields, field descriptions to steer the LLM, list/nested fields, and constraint validators (rating 1–5, regex on priority). Explicit warning: plan for *schema evolution* in production.
- Why it helps / how to apply: This is exactly our `DashboardSpec` handoff. Reinforces three concrete moves: (1) keep the spec a strict schema with enums for anything categorical (visual type, aggregation, filter operator) and required/optional clearly marked; (2) embed field-level descriptions *in the schema itself* because they double as LLM guidance when data-analyst fills it; (3) version the spec and tolerate additive changes, since model-builder/report-builder read it. The "structured output > prose" rule should be enforced for every agent-to-agent boundary in our pipeline, not just the first one. Stays dataset-agnostic because the schema describes shape, not field values.
- Source path: `ai_agent_framework_crash_course/openai_sdk_crash_course/2_structured_output_agent/README.md`; `.../google_adk_crash_course/3_structured_output_agent/README.md`
- Quality: 5
- Recommendation: adapt (we already do this; harden enums + descriptions + versioning)

### Triage/router → specialist with scoped tools → maps to our pipeline-skill dispatch + per-subagent MCP scoping
- The pattern: Two complementary forms. (a) **Handoffs**: a triage agent holds a list of specialist agents; each handoff auto-generates a `transfer_to_X` tool and the LLM picks which specialist to route to, optionally passing a structured payload and *filtering context* (`input_filter` strips tools/sensitive data before transfer). (b) **MCP router**: instead of one mega-agent with every tool, a router classifies intent and dispatches to a specialist that connects to ONLY the MCP servers it needs (code-reviewer→GitHub+FS, researcher→Fetch+FS, etc.).
- Why it helps / how to apply: This is the architectural case for keeping model-builder, report-builder, and the reviewers as *separate* subagents each granted a minimal slice of our MCP toolset (model-builder gets DAX/TMDL tools; report-builder gets visual/bind tools; reviewers get read-only/validation tools). The pipeline skill is the triage layer that routes to the right worker. Two adoptable refinements: (1) define per-subagent allowed-tool lists rather than exposing all 39 MCP tools to every agent — fewer tools = better tool selection + safer; (2) when handing off, pass only the minimal context (the spec + the relevant slice), not the whole transcript.
- Source path: `mcp_ai_agents/multi_mcp_agent_router/README.md`; `ai_agent_framework_crash_course/openai_sdk_crash_course/8_handoffs_delegation/{README,8_2_advanced_handoffs}/README.md`
- Quality: 5 (router) / 4 (handoffs)
- Recommendation: adapt

### Agents-as-tools (sub-agent invoked as a callable) → maps to enrichment steps inside a worker
- The pattern: A specialized agent is wrapped as a function-tool (`agent.as_tool()` / `@function_tool` calling a nested run, or ADK's `AgentTool`) so an orchestrator can call it like any tool, with per-call config (max_turns, temperature). Example: a Market-Research agent owns a wrapped Search agent it calls for live data; a content orchestrator calls research_tool then writing_tool.
- Why it helps / how to apply: Distinct from full handoff — here control *returns* to the caller. Useful when a worker needs a bounded sub-capability without ceding the whole turn: e.g. model-builder calling a focused "DAX-syntax-validator" agent or "field-resolver" agent as a tool mid-build, getting a typed result back, and continuing. Lets us compose capability without flattening everything into one giant agent prompt. Cap nested runs with a turn budget to bound cost.
- Source path: `ai_agent_framework_crash_course/openai_sdk_crash_course/{3_tool_using_agent/3_3_agents_as_tools,9_multi_agent_orchestration/9_2_agents_as_tools}/README.md`
- Quality: 4
- Recommendation: adapt (use sparingly for bounded sub-capabilities)

### Generate → critique → revise loop (bounded) → maps to our builder↔reviewer cycle
- The pattern: Produce an initial artifact, run a dedicated *critic* that lists concrete flaws (missing info, unclear, logical gaps), then a *reviser* that addresses every critique point while explicitly preserving the good parts, repeat 1–3 rounds. Variant ("self-improving skills"): an Executor scores outputs against binary yes/no eval criteria, an Analyst diagnoses the failure and picks ONE mutation strategy, a Mutator applies exactly one surgical change, re-score, and **keep-if-improved / revert-if-not**, until target pass-rate or max rounds.
- Why it helps / how to apply: This is our model-reviewer→model-builder and report-reviewer→report-builder loops, made disciplined: (1) the reviewer must emit a concrete, itemized findings list (not a vibe), (2) the builder revises against each item and preserves passing work, (3) the loop is bounded and has a measurable stop condition, (4) the keep-or-revert gate prevents regressions — apply a change only if it improves the validation result (BPA pass count, bind-validator errors→0). The Executor/Analyst/Mutator split is also a blueprint for an *eval harness for our own skills/agents*: define scenarios + binary checks, let a loop optimize the prompt, revert non-improvements.
- Source path: `advanced_llm_apps/gpt_oss_critique_improvement_loop/README.md`; `awesome_agent_skills/self-improving-agent-skills/README.md`
- Quality: 5 (self-improving) / 4 (critique loop)
- Recommendation: adapt

### Progressive-disclosure skill layout: SKILL.md → AGENTS.md compilation → rules/*.md deep dives → maps to ALL our skills & reviewer agents
- The pattern: The best skills (code-reviewer, ux-designer) use a 3-tier structure. `SKILL.md` is a lean entry point: YAML frontmatter (name + rich "Use when…" trigger description + version), a "When to Apply" list, a priority-ordered process, deliverable templates, and a pointer table to detailed rules. `AGENTS.md` compiles all rules with examples in priority order. `rules/<category>-<topic>.md` hold the deep dives (one concern per file, tagged with Impact/Category). Each rule shows ❌ incorrect / ✅ correct pairs. Severity tiers (CRITICAL→HIGH→MEDIUM) drive ordering everywhere.
- Why it helps / how to apply: Directly templatable for our model-reviewer and report-reviewer: SKILL.md lists the review process + output format and links to a `rules/` set (e.g. dax-performance, model-bpa-relationships, accessibility-contrast, binding-correctness), each rule a tagged ❌/✅ file. Keeps the always-loaded context small while letting the agent pull the exact rule on demand (token-efficient progressive disclosure). The frontmatter "Use when…" trigger phrasing is also the right pattern for our skills' descriptions so Claude Code auto-selects them. Rules must stay dataset-agnostic (describe the anti-pattern, never specific field names).
- Source path: `awesome_agent_skills/code-reviewer/{SKILL.md,AGENTS.md,rules/*.md}`; `awesome_agent_skills/ux-designer/{SKILL.md,AGENTS.md,rules/*.md}`; `awesome_agent_skills/README.md` (agentskills.io spec: SKILL.md + scripts/ + references/ + assets/)
- Quality: 5 — ux-designer SKILL.md is the single best exemplar in the pack.
- Recommendation: adopt-as-is (structure); adapt (content to Power BI)

### Skill anatomy: priority-ordered process + deliverable templates + structured review-output format + worked example → maps to our agent prompts
- The pattern: Strong skills bundle four reusable sections beyond raw instructions: (1) a numbered **process** in severity/priority order; (2) **deliverable templates** (persona, user-flow, project plan) the agent fills in; (3) a fixed **review-output format** (Critical 🔴 / High 🟠 / Medium 🟡 / Strengths ✅, each finding = What/Why-it-matters/Recommendation/code-fix); (4) an end-to-end **worked example** showing the skill applied, with footnote citations back to the specific rule used. The debugger skill adds a reusable diagnostic spine: Understand→Gather→Hypothesize(ranked)→Test→Root-cause→Fix→Prevent.
- Why it helps / how to apply: Our reviewer subagents should emit findings in exactly this severity-tiered, fix-included format so the builder can act mechanically and so pbi-audit produces consistent reports. The debugger spine is a ready template for pbi-fix-model (rank hypotheses, isolate, fix root cause, add a regression check). The project-planner's WBS/milestone/dependency-map template is a model for how data-analyst could structure a build plan inside the DashboardSpec. The "worked example with rule citations" technique is worth replicating in our skills to ground behavior.
- Source path: `awesome_agent_skills/{ux-designer,debugger,project-planner,code-reviewer}/SKILL.md`
- Quality: 5 (ux-designer, debugger) / 4 (others)
- Recommendation: adapt

### Global plugin / callback hooks at the runner level → maps to our hooks layer
- The pattern: ADK separates per-agent callbacks (lifecycle, before/after model, before/after tool) from **Plugins** registered once on the Runner that fire globally across every agent/tool/model call — for cross-cutting concerns: logging/tracing, request/response modification, policy enforcement, response caching, and error-recovery callbacks that can *suppress an exception and substitute a fallback*. Plugin callbacks run before agent-level ones. Named hook points: on_user_message, before/after_run, before/after_agent, before/after_model, before/after_tool, on_model_error, on_tool_error, on_event.
- Why it helps / how to apply: This is the conceptual model for our Claude Code hooks (hooks/hooks.json + scripts). Our validator hook = an `after_tool`/`before_run` policy gate. The taxonomy suggests hook points we may not have: a pre-write/pre-tool gate that blocks an invalid TMDL/DAX edit before it lands (policy enforcement + exception→fallback), a post-edit validation hook (run bind-validator/BPA after a write), and a global "modify request" hook to inject standing rules (e.g. the dataset-agnostic constraint) into every worker. Adopt the "error callback can substitute a safe fallback" idea so a failed tool call degrades gracefully instead of aborting the pipeline.
- Source path: `ai_agent_framework_crash_course/google_adk_crash_course/{6_callbacks,7_plugins}/README.md`
- Quality: 5
- Recommendation: adapt

### Guardrails: input/output validation with tripwire + confidence threshold → maps to spec validation & write-gating
- The pattern: Dedicated input guardrails validate/filter a request before the agent runs and output guardrails check the response before delivery; either can trigger a "tripwire" that blocks with a structured reason. A specialized guardrail *agent* can do the judging. Refinements: confidence-thresholded blocking to cut false positives, layered (multiple guardrails per agent), context-aware guardrails that check user/permission state, and business-rule guardrails.
- Why it helps / how to apply: Maps to validating the DashboardSpec on the way INTO model-builder (reject an incomplete/contradictory spec with a structured reason before any work) and gating writes OUT of builders (block a TMDL/DAX change that fails validation, returning a precise reason the builder can fix). "Layered + business-rule" guardrails = our place to enforce the hard rule programmatically: a guardrail that flags hardcoded dataset field values would operationalize the "dataset-agnostic" mandate. Treat guardrails as cheap pre/post checks distinct from the heavier reviewer pass.
- Source path: `ai_agent_framework_crash_course/openai_sdk_crash_course/6_guardrails_validation/README.md`
- Quality: 4
- Recommendation: adapt

### Delegation with narrowed scope → maps to constraining what a worker subagent may touch
- The pattern: An orchestrator creates a delegation that cryptographically/explicitly *narrows* permissions for the worker: allowed_actions, resource/token limits, time limit, allowed domains; actions outside scope are denied. (The surrounding trust-score/sponsor machinery is app-specific.)
- Why it helps / how to apply: Even without the trust-scoring apparatus, the core idea — a parent passes a *constrained capability envelope* to a child — is the right mental model for handing a worker subagent only the tools + write paths it needs for its stage (e.g. report-builder may write report visuals but not model TMDL). Combined with the MCP-router scoping above, this argues for a per-stage "what this agent is allowed to do" manifest in our orchestration.
- Source path: `advanced_ai_agents/multi_agent_apps/multi_agent_trust_layer/README.md`
- Quality: 3 — concept useful, most of the README is app-specific.
- Recommendation: reference-only (adopt the narrowed-scope idea, skip the trust layer)

### Coordinated team with explicit communication topology + role→tool ownership → maps to our agent-team composition
- The pattern: Role-based "agencies/teams" (CEO/CTO/PM/Dev, or Researcher/Summarizer/Critic, or tabbed Competitor/Sentiment/Metrics analysts) where a coordinator orchestrates specialists, each specialist owns a specific structured tool (e.g. CEO→AnalyzeProjectRequirements, CTO→CreateTechnicalSpecification), and crucially an **explicit communication flow** is defined (CEO↔all, CTO↔Dev, PM↔Client-Success) rather than a free-for-all. Output is assembled as per-specialist typed sections of one report. Recruitment/teaching variants add a human-review disclaimer ("automated decisions should be reviewed by a human").
- Why it helps / how to apply: Validates our fixed 5-role lineup with a *defined topology* (data-analyst→builders→reviewers) instead of agents talking arbitrarily. Two takeaways: (1) give each worker a single clearly-owned capability/tool surface (model-builder owns DAX+TMDL emit; report-builder owns visual binding), and (2) compose the final artifact from typed sections each agent produces, which our spec already encourages. The human-review disclaimer reinforces keeping reviewer gates (and ultimately the user) in the loop before publishing a model/report.
- Source path: `advanced_ai_agents/multi_agent_apps/agent_teams/{ai_services_agency,ai_recruitment_agent_team,ai_teaching_agent_team}/README.md`; `.../multi_agent_researcher/README.md`; `.../product_launch_intelligence_agent/README.md`
- Quality: 3–4 — thin READMEs but the topology/role-ownership idea is solid and recurs.
- Recommendation: reference-only / adapt (confirms our design; adopt explicit-topology + single-capability-per-role)

### Parallel-for-quality (sample N, then pick/synthesize) → optional quality lever for our builders
- The pattern: Run the same task N times (or N stylistic variants) concurrently, then a *picker/synthesizer* agent selects the best or merges them. High temperature for diversity in candidates, low temperature for the synthesis/selection step.
- Why it helps / how to apply: A latency-cheap quality boost for high-stakes single artifacts — e.g. generate 2–3 candidate DAX measures or visual layouts and have a selector (or the reviewer) choose the best against our validation criteria, instead of trusting one shot. Use selectively where correctness matters and cost is acceptable; not a default for every step.
- Source path: `ai_agent_framework_crash_course/openai_sdk_crash_course/9_multi_agent_orchestration/9_1_parallel_execution/README.md`
- Quality: 4
- Recommendation: reference-only (selective adoption)

### Context object + sessions (shared typed state across a run) → maps to how our pipeline threads the spec/state
- The pattern: A typed context object (RunContextWrapper[T]) is passed through a run so every tool/step reads the same state; sessions add automatic conversation history with operations to inspect/append/pop/clear turns; multi-session keeps separate state per user/purpose and can be shared across handed-off agents. ADK's parallel children share one session.state but write to distinct keys.
- Why it helps / how to apply: Our DashboardSpec is the typed context threaded through the pipeline; this validates passing one evolving state object across stages rather than re-deriving context. The "shared state, distinct keys" rule is the safe pattern if we ever run audit checks in parallel. The pop/correct-turn operations suggest supporting a "revise the spec and re-run downstream" correction flow without restarting the whole pipeline.
- Source path: `ai_agent_framework_crash_course/openai_sdk_crash_course/{5_context_management,7_sessions}/README.md`
- Quality: 3 — generic, partly framework-specific, but the state-threading principle transfers.
- Recommendation: reference-only

## Cross-source overlap flags
- **Progressive-disclosure skill layout (SKILL.md + rules/ + AGENTS.md, severity tiers, ❌/✅ pairs, frontmatter triggers)** almost certainly overlaps with the sibling fabric/copilot skill repos already mined (`skills-for-fabric-authoring.md`, `skills-for-fabric-catalog.md`, `powerbi-agentic-plugins*.md`, `awesome-copilot-*`). Reviewers should de-dupe; the ux-designer/code-reviewer exemplars here are the cleanest *generic* template, while the fabric repos likely have Power-BI-specific rule content — combine: this repo's structure + those repos' domain rules.
- **Reviewer/critic patterns** (this file's critique-loop + severity-tiered review output) overlap with the data-goblin model-reviewer/report-reviewer findings (dg2/dg3) and copilot code-review instructions — consolidate into one reviewer-agent spec.
- **Hooks/callbacks/guardrails** overlap with the data-goblin hooks findings (dg4-te-fabric-hooks-root) — ADK's runner-Plugin taxonomy is the generic framing; the fabric repo has the concrete Power-BI hook scripts.
- **RAG/memory/eval** content (rag_tutorials/, llm_apps_with_memory_tutorials/, sessions/memory) is the sibling agent's beat — flagged and not covered here beyond noting sessions as state-threading.

## Discarded / not relevant
Large portion of the pack is app-specific Streamlit demos with no transferable orchestration content beyond "N role-agents + a coordinator," already captured generically above. Discarded:
- **All `starter_ai_agents/*`** (blog-to-podcast, meme generator, music, medical imaging, finance, web-scraper, etc.) — single-agent app demos; pattern already covered by the crash courses.
- **`advanced_ai_agents/autonomous_game_playing_agent_apps/*`** (chess, tic-tac-toe, 3D pygame) — adversarial/game loops; the only nugget (a "board proxy" validation agent) is just a guardrail, already captured.
- **`advanced_ai_agents/single_agent_apps/*`** and most of `advanced_ai_agents/multi_agent_apps/*` non-team apps (financial coach, mental wellbeing, negotiation sim, news/podcast, deep-research, fraud investigation, etc.) — domain apps; no new orchestration mechanics.
- **`voice_ai_agents/*` and `openai_sdk_crash_course/11_voice`** — voice pipeline (STT/TTS/realtime) is out of scope for a Power BI authoring plugin.
- **`advanced_llm_apps/chat_with_X_tutorials/*`, `chat-with-tarots`, `cursor_ai_experiments/*`, `llm_finetuning_tutorials/*`, `llm_optimization_tools/*`, `multimodal_video_moment_finder`, `resume_job_matcher`, `thinkpath_chatbot_app`** — chat/finetune/optimization/multimodal apps unrelated to agent orchestration.
- **All `rag_tutorials/*` and `llm_apps_with_memory_tutorials/*`** — RAG/memory; explicitly the sibling agent's scope.
- **`mcp_ai_agents/{browser,github,notion}_mcp_agent` and `multi_mcp_agent`** — single-MCP or all-tools-in-one-agent demos; the *router* variant (kept above) is the only one with a transferable scoping pattern; `multi_mcp_agent` is a mild anti-pattern (one agent, all tools) worth noting as the thing to avoid.
- **Tracing/observability READMEs (`10_tracing_observability`)** — noted as a production concern (group multi-agent runs in one trace) but thin; relevant only as a reminder to keep our pipeline runs inspectable/logged.
- **Trust-score/sponsor machinery in `multi_agent_trust_layer`** — the narrowed-scope delegation idea was extracted; the cryptographic identity/scoring system is app-specific and discarded.
