# Consolidated Adoption Decision — Architecture / Authoring / Infra (Review Agent B)

Scope: how we *build/ship/orchestrate* pbi-mcp-ts. Domain knowledge (DAX/TMDL/PBIR content,
BPA rule bodies, report-design rules) is Review Agent A's lane and is referenced here only where
it touches infra (e.g. the gate-measure-create blueprint, the BPA rule *schema*).

Synthesized from all 20 findings files. Reconciled against the **actual current scaffolding**
(`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, root `.mcp.json`, `hooks/hooks.json`
+ `hooks/scripts/*.mjs`, 16 `skills/*/SKILL.md`, 7 `agents/*.md`, `packages/{core,mcp,cli}`).

Hard rules honored: **Node/TS only** (Python/PowerShell/CLI = reference-only); be explicit about
which platform a config schema targets (Claude Code vs GitHub Copilot CLI vs Codex). **Nothing
dataset-specific is hardcoded** — all guidance describes *form*, not field values.

---

## 1. Worker-agent design & the DashboardSpec handoff contract

**Verdict:** strong patterns available.

**Canonical source(s):**
- `agent-skills-pbi-meta.md` (practicalswan) — subagent-driven-development: implementer + spec-reviewer
  + code-quality-reviewer prompt triplet, "spec-first-then-quality", "don't trust the report". The
  single best worker/reviewer blueprint.
- `awesome-llm-apps-orchestration.md` — structured-output-as-handoff-contract, triage→specialist with
  *scoped tools*, narrowed capability envelope per worker, explicit communication topology.
- `powerbi-agentic-plugins-structure.md` / `powerbi-agentic-plugins.md` (ruiromano) — architect (design-only,
  emits `specs/*.spec.md`, model: Opus) vs developer (implements, model: Sonnet); EARS spec template;
  glob-scoped MCP tool grants; "respect team-standards.md" hook.
- `skills-for-fabric-*` (Microsoft) — `delegates_to:` frontmatter + `## Must / ## Prefer / ## Avoid` triad.
- `dg1-pbip.md` — `pbip-validator` agent: "deterministic-first, LLM-fallback", safety fixing rules,
  edge-case catalog (the model for our reviewer agents).

**Adopt (merged):**

Our 5 workers map to the canonical triplet + the architect/developer split:
- **data-analyst** = read-only planner = "architect/spec" role (model Opus). Research-first, never
  guesses schema; produces the DashboardSpec (our `specs/*.spec.md` analog). Runs the clarifying
  intake before any build.
- **model-builder / report-builder** = "implementer" role (model Sonnet). Tool-first; implement →
  self-validate (Completeness/Quality/YAGNI/Testing) → report (what built / tested+results / files /
  self-review findings / concerns).
- **model-reviewer / report-reviewer** = two-stage review: **spec compliance FIRST, code/artifact quality
  SECOND**. Reviewer prompt opens with *"Do Not Trust the Report — the implementer finished suspiciously
  quickly"*; reads actual artifacts, compares line-by-line to the spec, checks Missing / Extra-over-engineered /
  Misunderstandings; emits `✅ compliant` or `❌ issues` with `file:line`.

Worker frontmatter house-shape (Claude Code subagent — merged from Microsoft `delegates_to` triad +
ruiromano model-per-role + data-goblin tools-scoping):
```yaml
---
name: model-builder                       # kebab, == file stem
description: >                            # WHEN-to-use only (see §4 house style)
  <one sentence capability + scope boundary>. Use when <2-4 concrete triggers>.
  Does NOT handle <X> (use <other-agent>).
model: sonnet                            # Opus for planner/reviewer-judge; Sonnet for builders
tools: [Read, Edit, Write, Bash, Grep, Glob]   # least-privilege; add only what the stage needs
---
## Personality / Purpose          (1-2 short paras — trim Microsoft's verbose persona prose)
## Core workflow                  (numbered, with validation checkpoints between phases)
## Delegation rules               (prose "route X → agent/skill Y")
## Must / Prefer / Avoid          (dataset-agnostic guardrails — see below)
```

Reusable **Must/Prefer/Avoid** guardrails (lift verbatim, dataset-agnostic): never hardcode
workspace/item IDs or field names (resolve dynamically); validate at each phase before proceeding;
require explicit confirmation before destructive ops; "complex calculated columns → use measures";
"research-first, not assumption-first"; "tool-first, not efficiency-first — call the MUST-use tool
even for simple ops to get current state."

**Per-worker MCP tool scoping (high-leverage, do this):** do NOT expose all 47 MCP tools to every
agent. Grant each worker the minimal slice (`awesome-llm-apps` "narrowed capability envelope" +
"router→specialist with scoped tools"): model-builder → DAX/TMDL/measure tools; report-builder →
visual/bind/layout tools; reviewers → read-only/validate tools. Fewer tools = better tool selection +
safer writes. Use the matcher-scoping we already do in hooks.json as the model.

**DashboardSpec handoff contract** (merged from `awesome-llm-apps-orchestration` structured-output rules
+ borghei handoff protocol + ruiromano EARS spec):
- Keep it a **strict typed schema** (Zod), NOT prose. Enums for everything categorical (visual type,
  aggregation, filter operator). Required vs optional clearly marked. Field-level descriptions live
  *in the schema* (they double as LLM guidance when data-analyst fills it).
- **Version the spec** and tolerate additive changes (downstream builders read it; plan for evolution).
- Every handoff carries borghei's **4 fields**: (1) the artifact, (2) why it was produced, (3) specific
  questions for the next reviewer, (4) non-negotiable constraints from prior reviewers. Cap at 4 handoffs;
  the final reviewer decides. Never drop context silently (summarize if needed).
- Validate the spec on the way **into** the builder (input guardrail: reject incomplete/contradictory
  spec with a structured reason before any work) and gate artifacts on the way **out** (output guardrail:
  block a TMDL/DAX/PBIR change that fails the reference/bind check).
- EARS acceptance criteria in the spec body where useful: "THE System SHALL …", "WHEN … THE System SHALL …".

**Mix-and-match notes:** Used practicalswan for the *reviewer prompt mechanics* (don't-trust-the-report,
two-stage), ruiromano for *model-per-role + spec-driven design*, Microsoft for the *frontmatter skeleton
(delegates_to / Must-Prefer-Avoid)*, awesome-llm-apps for *tool-scoping + structured handoff + guardrails*,
data-goblin for *deterministic-first + safety-fixing rules*. Persona layer (borghei "personas") stays
optional — we have Agents+Skills, not a separate Persona tier.

**Reference-only / defer:** borghei agent template's Python-script integration; "agents-as-tools" (use
sparingly for bounded sub-capabilities like a DAX-syntax-validator called mid-build with a turn budget);
parallel-for-quality (sample-N-then-pick) — selective, not default; trust-score/cryptographic delegation
machinery (over-engineered for a local plugin — keep only the narrowed-scope idea).

**Conflicts resolved:** ruiromano's `tools:`/`model:` values are Copilot-flavored — translate to Claude Code
subagent frontmatter (`tools: [Read, Edit, ...]`, `model: sonnet|opus`). Microsoft agent prose is verbose —
trim to 1-2 paras.

**Provenance:** agent-skills-pbi-meta.md, awesome-llm-apps-orchestration.md, powerbi-agentic-plugins-structure.md,
powerbi-agentic-plugins.md, skills-for-fabric-authoring.md, skills-for-fabric-catalog.md, dg1-pbip.md.

---

## 2. Pipeline-skill orchestration patterns

**Verdict:** strong patterns available.

**Canonical source(s):**
- `awesome-llm-apps-orchestration.md` — Sequential / Loop / Parallel as named workflow primitives;
  generate→critique→revise (bounded, keep-if-improved/revert); global plugin/callback hooks taxonomy.
- `claude-skills-standards.md` (borghei) — Orchestration Protocol: Skill-Chain I/O contract + Multi-Agent
  Handoff + error-handling + anti-patterns (Echo Chamber, Infinite Loop, Context Dropout).
- `skills-for-fabric-*` + `awesome-copilot-meta.md` — "numbered phases + explicit factor checklist + fixed
  enumerated output schema + final hard-constraint line"; the "complete the full end-to-end flow / don't
  stop half-done" guardrail; "guide the LLM to generate, don't paste full code into skills."
- `powerbi-agentic-plugins-structure.md` — the **Tool Selection Priority ladder** (MCP → local files → ask).

**Adopt (merged):** Our pipeline skills ARE deterministic orchestrators expressed as Claude Code skills.
Map them to the named primitives:
- **pbi-build** = **Sequential**: data-analyst → model-builder → model-reviewer → report-builder →
  report-reviewer. Each stage consumes the prior's typed output.
- **pbi-modify** = Sequential with a targeted entry point + the rename-cascade discipline.
- **pbi-fix-model** = **Loop (bounded)**: reviewer→fixer cycle with an **explicit max-iteration budget
  AND a success predicate** (e.g. BPA pass-count rises / bind-validator errors → 0). Apply a change only
  if it **improves the validation result, else revert** (no regressions). Cap review cycles at 2 (avoid
  borghei's "Infinite Loop" anti-pattern — never loop without a decision-maker).
- **pbi-audit** = **Parallel fan-out**: independent read-only checks (model BPA + DAX-reference check +
  visual-bind check) writing to *distinct sections* of one report, optional synthesizer. "Shared state,
  distinct keys" is the safe parallel pattern.

Each pipeline SKILL.md uses ONE canonical skeleton (merged from awesome-copilot relevance-workflow +
Microsoft e2e-medallion + borghei Skill-Chain):
```
## Overview / When to use         (auto-trigger description — §3 house style)
## Tool Selection Priority         (ladder: MCP engine → local PBIP/TMDL files → ask user)
## Pre-flight: gather context first (list tables/relationships/measures before mutating)
### 1. <Phase>  → 2. <Phase> ...   (numbered phases; each declares input/output format + required fields)
## Output schema                   (fixed, enumerated verdict/recommendation values)
## Completion rule                 (don't stop half-done; fail-fast on invalid step output; observable/logged)
```

Skill-Chain I/O contract rules (borghei, adopt): each step **declares input/output format
(JSON/Markdown/text) + required fields**; fail-fast on invalid output; idempotent; observable (log each
step's I/O); max ~6 steps. Error handling: skill failure → retry once then escalate; chain failure → stop +
log failure point + report completed steps.

Hook-point taxonomy to design toward (ADK plugin/callback model): `before_run` (inject standing
constraints like the dataset-agnostic rule), pre-write/pre-tool gate (block invalid edit before it lands),
post-edit validation (run bind-validator/BPA after a write), `on_tool_error` → substitute a safe fallback
so a failed tool degrades gracefully instead of aborting the pipeline.

**Mix-and-match notes:** awesome-llm-apps gives the *primitive vocabulary* (Sequential/Loop/Parallel) and the
*bounded-loop + keep-or-revert* discipline; awesome-copilot/Microsoft give the *SKILL.md prose skeleton*;
borghei gives the *I/O-contract + error-handling rules*; ruiromano gives the *MCP-vs-files fallback ladder*.

**Reference-only / defer:** `gh aw`/GitHub-Actions runtime (awesome-copilot workflows are Copilot CLI — the
*structure* is 5/5, the runtime is not ours); ADK Python framework specifics; context-compression/TOON
serialization (a context-budget optimization to evaluate later, not core orchestration).

**Conflicts resolved:** borghei has TWO orchestration vocabularies (`orchestration-protocol.md`:
Solo-Sprint/Domain-Deep-Dive/Multi-Agent-Handoff/Skill-Chain vs `docs/guides/orchestration.md`:
Sequential/Fan-Out-Fan-In/Agent-Delegation/Iterative-Refinement). **Pick ONE vocabulary** = the
awesome-llm-apps **Sequential / Loop / Parallel** trio (cleanest, maps 1:1 to our 4 pipelines), plus
borghei's **Multi-Agent-Handoff** for the builder↔reviewer chains.

**Provenance:** awesome-llm-apps-orchestration.md, claude-skills-standards.md, skills-for-fabric-authoring.md,
skills-for-fabric-catalog.md, awesome-copilot-meta.md, powerbi-agentic-plugins-structure.md.

---

## 3. SKILL.md authoring house-style

**Verdict:** strong patterns available (but conflicting across sources — reconciled below).

**Canonical source(s):**
- `agent-skills-pbi-meta.md` (writing-skills + anthropic-best-practices) — **the primary doctrine**: CSO
  (Claude Search Optimization), TDD-for-skills, degrees-of-freedom, progressive disclosure. Strongest and
  most opinionated.
- `claude-plugin-marketplace-structure.md` (plugin-master) — 3-tier loading, frontmatter rules, size table,
  the greppable triggering-reliability audit.
- `skills-for-fabric-catalog.md` (Microsoft) — the uniform 4-part `description:` formula across 23 skills.
- `antigravity-catalog-structure.md` — `Use when …` + `## Do not use when` negative-scope formula at scale.
- `awesome-copilot-meta.md` — exact constraints (name ≤64 + matches-folder, description 10-1024 single-quoted).

**Adopt (merged) — ONE reconciled house style:**

**Frontmatter (Claude Code skill):**
```yaml
---
name: pbi-build                # lowercase-hyphenated, MUST == folder name, ≤64 chars
description: >                  # SINGLE quoted, 10-1024 chars, WHEN-to-use ONLY
  <Capability + scope boundary in one sentence>. Use when <2-4 concrete named triggers>.
  Does NOT handle <X> (use <other-skill>).
---
```
The `description:` is the **single most important lever for reliable auto-trigger**. The reconciled rule
set (resolving the conflicts below):
1. **Describe WHEN to use, never WHAT the workflow does.** (writing-skills: a "two-stage review" *summary*
   in the description caused Claude to do one review and skip the body. The description must NOT summarize
   steps.) This wins over plugin-master's `Provides:` enumeration when they conflict.
2. **Two-part shape:** `<capability + scope>. Use when <triggers>.` Pack concrete BI nouns (TMDL, DAX,
   measure, visual binding, bookmark, theme, RLS, calc group, format string) — they tokenize into the
   trigger/search index. Vague descriptions ("provide guidance") tokenize to junk.
3. **Add explicit negative routing:** end with `Does NOT handle … (use <other-skill>)` to prevent
   cross-skill mis-routing (critical for our 16-skill catalog). Mirror in a `## Do not use when` body section.
4. Third-person/imperative voice; verb-first gerund names where natural (`creating-…` over `…-creation`).
5. ~200 char target for the trigger sentence (antigravity: oversized descriptions get truncated).

**Body skeleton (merged):**
```
# Title
## Overview                    (2-3 sentences)
## When to use / Do not use     (positive + negative trigger bullets — anti over-trigger)
## Quick Reference              (tables, decision trees — keep IN SKILL.md)
## Core Content / Workflow      (numbered steps for complex tasks; copy-paste checklist)
## Anti-Patterns                (≥3, each = Mistake / Why it happens / Instead)
## Additional Resources         (pointers to references/ and examples/ — link, don't inline)
```

**Size budgets (merged hard limits):** metadata always-loaded ~100 words; SKILL.md body 1500-2000 words
(3000 hard max → split); `references/*.md` 2000-5000+ words; technique-skills 300-700w, pattern 250-600w,
reference 150-350w; frequently-loaded skills <200w. **No intra-file duplication** (info lives in SKILL.md
OR references/, never both). Cross-cutting boilerplate (paths, docs policy) goes in the agent body or ONE
shared reference — NEVER in a skill `description:` (poisons routing → over-triggers).

**Progressive disclosure (anthropic-best-practices, adopt):** 3-tier loading (metadata → SKILL.md body →
references on demand). Keep references **one level deep** (Claude only `head`s deeply-nested files). For
reference files >100 lines add a table-of-contents at top. `scripts/` are executed not loaded (token-efficient);
`assets/` used in output not read. **Degrees of freedom:** high (text instructions) for flexible tasks,
medium (pseudocode/params) for a preferred pattern, low (exact script, "do not modify") for fragile/
consistency-critical operations.

**TDD-for-skills (writing-skills, adopt as doctrine):** RED (run the pressure scenario WITHOUT the skill,
capture verbatim rationalizations) → GREEN (write minimal skill addressing them) → REFACTOR (close
loopholes). Iron Law: "No skill without a failing test first." For discipline skills, build a
rationalization table (Excuse|Reality) + a "Red Flags — STOP" list, and put violation-symptoms in the
description. NEVER use `@path` links in skill bodies (force-loads, burns context).

**Mix-and-match notes:** writing-skills wins the *description philosophy* (when-not-what); plugin-master/
Microsoft/antigravity supply the *concrete formula + negative routing + size table + greppable audit*;
anthropic-best-practices supplies *progressive disclosure + degrees-of-freedom*; borghei supplies the
*anti-patterns-section + confidence-tagging* options (use confidence tags `[PROVEN]/[RECOMMENDED]/
[EXPERIMENTAL]` only where genuinely useful, at section level).

**Reference-only / defer:** plugin-master's `PROACTIVELY activate for: (1)…(N) Provides: …` enumeration —
this is the **conflict** below; we keep the enumeration *idea* (numbered ops aid routing) but follow
writing-skills' rule that the description must not summarize the *workflow*. borghei's `license`/`metadata.*`
frontmatter block, the 40%/30% quality threshold, and the ≥70 quality-scorer — adopt as soft authoring
guidance, not enforced fields. Python tool-design (P7) — rewrite for TS.

**Conflicts resolved (the big one):**
- borghei has TWO internal styles: formal `skill-authoring-standard` (license + metadata.*, confidence tags)
  vs stricter `CONTRIBUTING` ("Use when…" + third-person + numbered-steps-with-validation + realistic-data +
  ≥70 score). **Resolution:** take CONTRIBUTING's trigger-clause + third-person + numbered-steps-with-validation
  ON TOP of the 10-pattern standard.
- writing-skills (`description` = when-only, must-not-summarize-workflow) vs plugin-master/ruiromano/Microsoft
  (`(1)…(N)` op enumeration + `Provides:`). **Resolution:** description = `<capability>. Use when <triggers>.
  Does NOT … (use X).` A *short* numbered op-list is allowed (it lists capabilities, which is "when"-adjacent
  and aids routing) but **must not narrate the step-by-step workflow** — that lives in the body. This is the
  reconciliation of conflict #2 in the brief.

**Provenance:** agent-skills-pbi-meta.md, claude-plugin-marketplace-structure.md, skills-for-fabric-catalog.md,
antigravity-catalog-structure.md, awesome-copilot-meta.md, claude-skills-standards.md, agent-skills-design-breadth.md.

---

## 4. Agent authoring house-style

**Verdict:** strong patterns available.

**Canonical source(s):**
- `claude-plugin-marketplace-structure.md` — lean-orchestrator agent + skill-activation table +
  Self-Validation Protocol + `<example>` blocks + the greppable agent audit.
- `dg4-te-fabric-hooks-root.md` (bpa-expression-helper) + `dg1-pbip.md` (pbip-validator) — read-only
  reviewer agent design, Issue→Fix→Explain→Test output, deterministic-first.
- `skills-for-fabric-*` — `delegates_to` + Must/Prefer/Avoid (shared with §1).
- `agent-skills-pbi-meta.md` — code-reviewer.md template (severity buckets + verdict), subagent triplet.

**Adopt (merged):** Two agent archetypes —

**(a) Builder/orchestrator agents** (lean, delegate to skills/MCP — NOT a knowledge dump). Frontmatter:
```yaml
---
name: pbi-designer
description: >                          # WHEN-to-use + 4-7 <example> blocks (see below)
  ...
model: sonnet                          # or inherit; Opus for the planner
tools: [Read, Edit, Write, Bash, Grep, Glob, Skill]   # least-privilege incl. Skill
color: cyan
---
```
Body sections: `## Skill Activation` (a **Topic → Skill-to-load table** with inline disambiguation, e.g.
"TMDL editing/syntax → tmdl-conventions; TMDL in pipelines → pbi-build"), `## Core Responsibilities`,
`## Process`, `## Self-Validation Protocol`, `## Output Format`. **Lean-orchestrator limit:** agent body =
role identity + skill table + high-level process + output format + 2-3 sentence summaries. NOT detailed
domain knowledge / full API refs / code (those live in skills). #1 mistake is duplicating skill content
into the agent.

`<example>` blocks in the agent description (plugin-master + data-goblin pattern — drive routing): 4-7 per
agent, each = `Context: …` + user quote + 1-2 sentence assistant reply + `<commentary>Triggers for kw1, kw2</commentary>`.
**Coverage rule:** every skill the agent delegates to MUST have ≥1 `<example>` that routes to it.

**Self-Validation Protocol** (plugin-master, adopt — we already have a validator hook): "You generated X →
validate with Y" table, 3-part response (artifact / validation command / known-limitations of static checks),
and the crucial guardrail *"validation as a quality gate, not a ceremony — do NOT add validation boilerplate
to every response."* Pair with our gate-measure-create hook + dax-reference-check/bind-validator so the agent
doesn't double-validate.

**(b) Reviewer/validator agents** (read-only, deterministic-first). Frontmatter `tools: [Read, Grep, Glob]`
(+ `Bash` if it runs our validators; + `Edit` only for the pbip-validator's safe-fix mode), `model: sonnet`.
Adopt data-goblin's **deterministic-first / LLM-fallback** principle: "prefer deterministic validators over
LLM walking; only fall back to manual inspection for classes of problems the tools do not cover; do NOT
re-walk what the validator already checks; attribute findings to the tool." Output format = severity-bucketed
`BLOCKERS / CRITICAL / HIGH / MEDIUM / LOW` each with `[file:line] description + remediation`, plus a counts
summary + verdict (`READY | NEEDS CHANGES`). Adopt the **safety fixing rules** verbatim: fix obvious
JSON-syntax only (re-validate after); never auto-modify identity/`.platform`; never rename folders to "fix"
names (needs cascade); never edit DAX silently; always report what changed.

**Severity model** (merged code-quality + code-reviewer + RAG taxonomy): 🔴 Critical = block (security,
correctness, breaking, data-loss, ungrounded reference); 🟡 Important = should-fix (perf, SOLID,
test-coverage, architecture); 🟢 Suggestion = nice-to-have (readability, docs). "Don't mark nitpicks
Critical; give a clear verdict." Communication: be specific (file:line), explain WHY, suggest the fix,
acknowledge good code, be pragmatic, group related comments. (borghei communication standards: absolute
honesty, zero fluff, no generic praise, no advice without implementation detail.)

**Greppable agent audit (pre-ship gate — adopt, port to a TS check):**
```bash
for f in agents/*.md; do grep -q "<example>" "$f" || echo "NO EXAMPLES: $f"; done
for f in agents/*.md; do head -20 "$f" | grep -q "^model:" || echo "NO MODEL: $f"; done
# example-count >= delegated-skill-count (coverage); description WHEN-not-WHAT;
# no Windows/docs boilerplate inside YAML description: (poisons routing)
```

**Mix-and-match notes:** plugin-master = *lean-orchestrator + skill-activation-table + self-validation +
`<example>` mechanics + audit*; data-goblin = *reviewer deterministic-first + safety-fixing + edge-case catalog*;
practicalswan = *code-reviewer severity buckets + don't-trust-report*; Microsoft = *delegates_to + Must/Prefer/Avoid*.

**Reference-only / defer:** borghei agent-template's "≥3 workflows / success-metrics / Related-Agents" section
skeleton (good discipline but Python-relative-path-centric — adopt the *structure*, not the script integration);
query-listener agent (ADOMD/PowerShell — design only, reference-only impl).

**Conflicts resolved:** `model: inherit` (plugin-master) vs explicit `model: sonnet|opus` (ruiromano per-role).
**Resolution:** explicit model per role (Opus for planner/judge, Sonnet for builders/reviewers) — deliberate
model-per-role beats inherit for cost/quality control; use `inherit` only for thin utility agents.

**Provenance:** claude-plugin-marketplace-structure.md, dg4-te-fabric-hooks-root.md, dg1-pbip.md,
agent-skills-pbi-meta.md, skills-for-fabric-authoring.md, skills-for-fabric-catalog.md.

---

## 5. Hooks (safety + gate + config/kill-switch)

**Verdict:** strong patterns available — this is the highest-confidence, most directly-portable area.

**Canonical source(s):**
- `dg4-te-fabric-hooks-root.md` (data-goblin) — **the canonical Claude Code hook source**: block-destructive-commands,
  block-npm/pip, block-secrets-exposure (as `settings.json.example` + `hook.json` regex variants), and the
  **pbi-desktop multi-hook plugin** (`validate-measure`/`validate-dax` + `config.yaml` kill-switch) — the
  near-exact blueprint for our gate-measure-create.
- `dg1-pbip.md` — three PostToolUse validation hooks (PBIR schema / report-binding / TMDL lint) + `config.yaml`
  + the defensive-degradation discipline + the Windows-bug rationale for exit-0-on-error.
- `claude-plugin-marketplace-structure.md` (plugin-master) — the authoritative **Claude Code hooks.json schema**
  + plugin-vs-settings format gotcha + exit-code semantics.
- `awesome-copilot-meta.md` — the **reusable bash threat tables** (tool-guardian destructive-cmd table +
  secrets-scanner PATTERNS array) — best per-pattern-suggestion + placeholder-suppression + redaction UX.
  **NOTE: awesome-copilot's `hooks.json` is GitHub Copilot CLI's schema — config reference-only; logic portable.**
- `awesome-llm-apps-rag-eval.md` — deterministic-policy-gate-before-execution (ALLOW/DENY/REQUIRE-APPROVAL).
- `claude-skills-standards.md` — "hooks beat prompt rules" philosophy + fail-open + false-negative-bias.

**Adopt (merged):**

### Canonical Claude Code `hooks/hooks.json` shape (THE authoritative shape — resolves Conflict #1)
A **plugin** `hooks/hooks.json` wraps events under a top-level `hooks` key (matches our existing file):
```json
{ "hooks": {
  "PreToolUse":  [ { "matcher": "<regex>", "hooks": [ { "type": "command",
                     "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/x.mjs"],
                     "timeout": 10 } ] } ],
  "PostToolUse": [ ... ] } }
```
(A *user settings* `.claude/settings.json` puts events at top level WITHOUT the `hooks` wrapper —
`{ "PreToolUse": [...] }`. Mixing the two = hooks silently don't load. We are a plugin → use the wrapper.)
Key facts: events = PreToolUse / PostToolUse / SessionStart / SessionEnd / UserPromptSubmit / PreCompact /
Notification / Stop / SubagentStop. Matchers are case-sensitive regex. Hook input arrives on **stdin as JSON**
(`tool_name`, `tool_input.{...}`). Exit codes: **0 = success** (stdout in transcript), **2 = blocking error**
(stderr fed back to Claude), other = non-blocking. PreToolUse may also return
`hookSpecificOutput.permissionDecision: allow|deny|ask` + `updatedInput`. `${CLAUDE_PLUGIN_ROOT}` /
`$CLAUDE_PROJECT_DIR` available. **Hooks load at session start → editing them needs a restart; all matching
hooks run in parallel → design for independence.** We already follow this with MCP-tool-name matchers — keep that.

### Defensive-degradation discipline (data-goblin — adopt wholesale into every hook)
- Read stdin once: `const input = readStdin() || '{}'`.
- **Fail-open / exit-0 on ANY environmental failure** (missing dep, missing metadata, empty stdin) so a hook
  NEVER bricks a session. Block (`exit 2`) only on a genuine, confirmed violation.
- **Bias toward false negatives over false positives** — "a hook that fires on every other command will be
  disabled by users and protect nothing." Make the obvious accidents impossible, not a comprehensive DLP.
- 10s timeout. Quote all vars. (Bash variants: `set -o pipefail` but intentionally NOT `set -u`.)
- Rationale on record: 5 open Windows Claude Code hook bugs (#49229 `if` ignored, #38800 `${CLAUDE_PLUGIN_ROOT}`+spaces,
  #47070 execvpe, #50243 settings.local-only, #34457 hangs) → justify the kill-switch + exit-0-on-error posture.

### config + kill-switch (data-goblin `config.yaml` → our TS/JSON config)
Per-check booleans (`dax_validation`, `measure_metadata`, `report_validation`, …) + a master
`all_hooks_enabled` kill-switch; "changes take effect immediately." Ship this as a committed config our hooks
read first; allow disable via a gitignored local override (borghei: hooks live in committed config = contract
for all contributors; disable only via gitignored local settings — never by mutating the command to evade it).

### gate-measure-create (PreToolUse — we already have `hooks/scripts/gate-measure-create.mjs`)
Blueprint = data-goblin `cmd_validate_measure`: fire only when the measure-create tool is invoked; check for
required metadata (`DisplayFolder`, `Description`, `FormatString`/`FormatStringDefinition`); if any missing →
`stderr` the precise list + `exit 2`. Plus the **DAX-reference validation** blueprint (`cmd_validate_dax`):
load the resolved model index, extract `'Table'[Column]` + unqualified `[Ref]` references from the command,
validate each against tables/columns/measures, on a miss emit a "Did you mean …?" suggestion (3-pass fuzzy:
case-insensitive exact → substring → first-word); exclude `DEFINE MEASURE` targets + string-literal aliases.
This is the **deterministic policy gate** (RAG-eval `ai_agent_governance`): interpose code, don't rely on the
LLM to police itself; ALLOW clean writes, DENY ungrounded ones. Grounding invariant
(`multimodal_agentic_rag` / `knowledge_graph_rag_citations`): the *same* model index fed to generation is the
*only* set the gate accepts references from (retrieve once, use for both write + verify).

### gate-data-analyst-readonly (PreToolUse — to add)
Block any write/mutating MCP tool when the data-analyst subagent is active (data-analyst is read-only planner).
Pattern: matcher on the write-tool family; deny with a structured reason routing the write to model-builder/
report-builder. (This operationalizes the "narrowed capability envelope" from §1.)

### Safety hooks (port the bash *logic*, keep our Claude Code config schema)

**block-destructive-commands** — matcher `Bash`, deny via `permissionDecision:"deny"`. Use the **anchored
regex** form (data-goblin `hook.json` variant — more precise than glob `if`). Merge data-goblin's narrow set
with awesome-copilot's per-pattern *safer-alternative suggestion* UX. Reusable threat table (CATEGORY / SEVERITY /
REGEX / SUGGESTION):
```
destructive_file_ops  critical  (^|[;&|]\s*)rm\s+.*-rf\s+~/        Use a specific path, not home dir
destructive_file_ops  critical  rm\s+.*-rf\s+\$HOME                 Use a specific path, not $HOME
destructive_file_ops  critical  rm\s+.*-rf\s+/(\s|$)                Never target root filesystem
destructive_file_ops  critical  (rm|del|unlink).*\.git[^i]          Never delete .git — use git commands
destructive_git_ops   critical  git\s+push\s.*--force\s.*(main|master)   Use --force-with-lease / feature branch
destructive_git_ops   high      git\s+reset\s+--hard                Use git stash / --soft
destructive_git_ops   high      git\s+clean\s+-fd                   Run git clean -n (dry run) first
permission_abuse      high      chmod\s+777                         Use 755 (dirs) / 644 (files)
network_exfiltration  critical  curl.*\|\s*(bash|sh)                Download, review, then execute
network_exfiltration  critical  wget.*\|\s*(bash|sh)                Download, review, then execute
```
(Keep data-goblin's deliberately-narrow stance: project-relative `rm -rf`, normal deletes, force-push to
*feature* branches, `git reset --soft/--mixed` are NOT blocked.)

**block-pnpm-discipline** — clone the data-goblin block-npm hook, swap to enforce **pnpm** (not bun). Anchored
regex prevents substring false-positives:
```
(^|;|&&|\|\|)\s*npm\s         Use pnpm instead of npm.
(^|;|&&|\|\|)\s*yarn\s        Use pnpm instead of yarn.
```
Rationale (README-worthy): npm/yarn run arbitrary post-install scripts → supply-chain risk for auto-approving
agents; pnpm is reproducible/lockfile-strict. (Do NOT copy data-goblin's "use bun" message — we are pnpm.)

**block-secrets-exposure** — matcher `Read` denies `*.env` / `*.env.*` (ADD a template allowance for
`.env.example`/`.env.template`); matcher `Bash` denies credential-dump commands: `printenv`,
`security find-generic-password|find-internet-password|dump-keychain` (macOS), `az account get-access-token`,
`aws sts get-session-token`, `gcloud auth print-access-token|print-identity-token`, `keyring get`,
`secret-tool lookup`. Use the **settings.json.example flat-array structure** (data-goblin's `hook.json` for
this one uses a non-standard nested shape — do not copy it). Reuse awesome-copilot's secrets-scanner PATTERNS
array + **placeholder-suppression** (skip `example|placeholder|your[_-]|xxx|changeme|TODO|dummy|fake|test[_-]?key|sample`)
+ **redaction-before-logging** (`first4...last4`) if we add a content scanner (PreToolUse Write|Edit and/or Stop).

**Mix-and-match notes:** data-goblin = *Claude Code config schema + narrow precise regex + gate-measure/dax
blueprint + config.yaml kill-switch + defensive degradation*; awesome-copilot = *per-pattern suggestion UX +
secrets PATTERNS array + placeholder-suppression + redaction* (logic only, NOT its Copilot config schema);
plugin-master = *authoritative hooks.json schema + exit codes*; RAG-eval/borghei = *deterministic-gate-before-
execution + fail-open philosophy + "hooks beat prompt rules."*

**Reference-only / defer:** governance-audit prompt-injection hook (awesome-copilot — we have no UserPromptSubmit
gate yet; the prompt-injection pattern set + tiered open|standard|strict|locked levels + base64-evidence privacy
trick are worth lifting *if* we add one); PowerShell `snapshot-model.ps1`/`check-referential-integrity.ps1`
(reimplement via our TMDL parser); dependency-license-checker / session-auto-commit hooks (out of scope).

**Conflicts resolved (Conflict #1):** awesome-copilot hooks.json uses Copilot CLI's schema (camelCase events
`preToolUse`, `bash`, `timeoutSec`, `version:1`) — **reference-only**; the canonical config is Claude Code's
`{ "hooks": { "PreToolUse": [ { "matcher", "hooks":[{ "type":"command", "command"/"args", "timeout" }] } ] } }`
(plugin form, top-level `hooks` wrapper). The bash threat *logic* is fully portable; we run it via Node `.mjs`
scripts. Also: data-goblin's `block-secrets-exposure` `hook.json` uses a non-standard nested shape — use its
`settings.json.example` flat-array structure instead.

**Provenance:** dg4-te-fabric-hooks-root.md, dg1-pbip.md, claude-plugin-marketplace-structure.md,
awesome-copilot-meta.md, awesome-llm-apps-rag-eval.md, claude-skills-standards.md.

---

## 6. MCP server design

**Verdict:** strong patterns available.

**Canonical source(s):**
- `agent-skills-pbi-meta.md` (mcp-builder TypeScript guide + evaluation methodology) — **the canonical,
  adopt-grade source** (we are a TS MCP server). Modern SDK APIs, tool-design rules, Zod, annotations,
  pagination, char limits, transports, and a full LLM-usability eval recipe.
- `claude-plugin-marketplace-structure.md` + `powerbi-agentic-plugins.md`/`-structure.md` — MCP *packaging*
  inside a plugin (`.mcp.json`, `${CLAUDE_PLUGIN_ROOT}`, npx convention) — see §7.
- `awesome-copilot-pbi-data.md` (powerbi-modeling skill) — MCP-operation-category checklist + "analyze-first"
  workflow; skills-vs-MCP doctrine (Microsoft).
- `awesome-llm-apps-rag-eval.md` — typed-immutable-context (the model index) + tool-output compression.

**Adopt (merged) — TS MCP best-practice checklist (use as PR gate for `packages/mcp`):**
- **Modern APIs only:** `server.registerTool()` / `registerResource()` / `registerPrompt()`. NOT deprecated
  `server.tool()` or manual `setRequestHandler(ListToolsRequestSchema,...)`.
- **Tool registration shape:** `title`, exhaustive `description`, `inputSchema` (a **Zod** object, `.strict()`),
  and **`annotations`** `{readOnlyHint, destructiveHint, idempotentHint, openWorldHint}`. Return
  `{ content: [{type:"text", text: JSON.stringify(out)}], structuredContent: out }`.
- **Tool naming:** snake_case, **service-prefixed** to avoid collisions (`pbi_create_measure`, not
  `create_measure`); action-oriented verb-first. (We already prefix `pbi_*` — keep it.)
- **Descriptions must be exhaustive** (JSDoc is NOT auto-extracted): Args, Returns (full JSON schema + field
  comments), Examples ("Use when…" / "Don't use when…"), and Error Handling text.
- **`response_format` enum** (`markdown` default / `json`) on every data-returning tool.
- **Pagination:** `limit` (1-100, default 20) / `offset`; return `{total, count, offset, items, has_more,
  next_offset}`; never load everything into memory.
- **CHARACTER_LIMIT constant (~25000):** truncate large responses, set `truncated:true` +
  `truncation_message` telling the agent to use offset/filters.
- **Error handling:** central `handleApiError()` mapping 404/403/429/timeout → actionable messages; report tool
  errors *inside* result objects (`isError:true`), not as protocol errors; never leak internals. (Adopt the PBI
  "permission-failure-as-404 masquerade" heuristic from Microsoft: getDefinition 404 + refresh 403 → Viewer-role,
  stop retrying.)
- **TS quality bar:** strict mode, no `any` (use `unknown`/types), explicit `Promise<T>`, Zod `.parse()` on
  external data, type guards.
- **Transports:** stdio for local (NEVER log to stdout — use stderr); Streamable HTTP for remote (new transport
  per request, stateless; bind 127.0.0.1 + validate Origin). SSE is deprecated.
- **Resources vs Tools:** Resources for static/URI-template data access; Tools for operations with validation/
  side-effects. **Annotate read-only tools** so per-agent tool-scoping (§1) + the readonly gate (§5) can reason
  about them.
- **Typed immutable model-index context** (RAG-eval): the resolved model index (tables/columns/measures/
  relationships) is a frozen, validated snapshot threaded to every tool + the validation gate — generation,
  validation, and review all read ONE consistent snapshot ("retrieved once, used everywhere").
- **Analyze-first workflow** (Microsoft powerbi-modeling): tools/agents examine current model state before
  guidance/mutation.

**MCP eval methodology (adopt — adapt to a dataset-agnostic PBI eval set):** "the measure of quality is how
well schemas/descriptions enable an LLM with ONLY the server to answer hard questions." Produce ~10 questions:
READ-ONLY, INDEPENDENT, NON-DESTRUCTIVE, single verifiable STABLE answer; each needs many tool calls; NOT
solvable by keyword search (synonyms); stress large returns. Constrain output format for direct string
comparison. 5-step process: docs inspection → tool inspection (don't call yet) → iterate understanding (never
read server source) → read-only content inspection (small `limit<10`, paginate) → task generation; verify by
solving each yourself, drop any needing writes. `<evaluation><qa_pair><question/><answer/></qa_pair></evaluation>`.
Phrase questions over an *arbitrary* model so the eval stays dataset-agnostic.

**Mix-and-match notes:** mcp-builder TS guide is the spine (90%); Microsoft adds the *operation-category
coverage checklist + analyze-first + 404-masquerade*; RAG-eval adds *immutable-snapshot context + tool-output
compression invariants*; packaging is §7.

**Reference-only / defer:** mcp-builder Python (FastMCP) server; tool-output statistical compression / TOON
encoding (evaluate for big TMDL/field dumps later — keep the safety invariants: never drop human content,
never break tool-call pairing, parse-failure = pass-through).

**Conflict resolved (Conflict #4 — see §7 for the packaging answer):** inline `mcpServers` in plugin.json vs
separate `.mcp.json` — both valid; we already use `.mcp.json` referenced from plugin.json. Keep that.

**Provenance:** agent-skills-pbi-meta.md, claude-plugin-marketplace-structure.md, awesome-copilot-pbi-data.md,
powerbi-agentic-plugins.md, awesome-llm-apps-rag-eval.md, skills-for-fabric-catalog.md.

---

## 7. Plugin/marketplace packaging + skills catalog/index + description-craft

**Verdict:** strong patterns available.

**Canonical source(s) (Conflict #3 — pick the Claude Code native ones):**
- `claude-plugin-marketplace-structure.md` (plugin-master) + `dg4-te-fabric-hooks-root.md` (data-goblin) +
  `powerbi-agentic-plugins-structure.md` (ruiromano) — **the authoritative Claude Code manifest sources**
  (all Claude Code native). plugin-master is the most rigorous on field rules + auto-discovery + the
  triggering-reliability audit.
- `awesome-copilot-meta.md` — also Claude Code spec (`code.claude.com/docs/en/plugin-marketplaces`); confirms
  local-vs-remote `source` shapes, `pluginRoot`, immutable `ref`.
- `antigravity-catalog-structure.md` — skills-index JSON-Schema + CATALOG.md taxonomy + generated-artifact pipeline.
- `skills-for-fabric-catalog.md` — bundle-variants over one shared `skills/` + inline+`.mcp.json` mirroring.

**Adopt (merged) — canonical Claude Code manifests:**

`.claude-plugin/plugin.json` (matches + tightens our current file):
```json
{
  "name": "pbi-mcp-ts",                 // REQUIRED, kebab-case, == repo/folder, unique
  "version": "0.3.0",                   // STRING (semver), not number
  "description": "...",                 // aim <500 chars; WHEN-to-use voice; no path/docs boilerplate
  "author": { "name": "..." },          // OBJECT, not string
  "homepage": "https://github.com/.../tree/main",
  "repository": "https://github.com/owner/repo",
  "license": "MIT",
  "keywords": ["power-bi","tmdl","pbir","dax","semantic-model","measure","report-authoring"],  // 5-15, lowercase-hyphenated
  "skills": "./skills/",                // optional dir pointer (auto-discovered anyway)
  "agents": ["./agents/<name>.md", ...], // optional explicit list
  "mcpServers": "./.mcp.json"           // optional — points at root .mcp.json
}
```
Field rules (plugin-master, adopt): `agents`/`skills`/`commands` are **auto-discovered** from `agents/`,
`skills/*/SKILL.md`, `commands/` — listing them is optional (adds *extra* paths only; defaults always load).
Every listed path must resolve. `version` is a STRING; `author` an OBJECT; `keywords` an ARRAY. Keep
description ≤500 chars and free of cross-cutting boilerplate (poisons routing).

`.claude-plugin/marketplace.json` (Claude Code marketplace spec — local entry uses string `source`):
```json
{
  "name": "pbi-mcp-marketplace",
  "owner": { "name": "...", "email": "user@users.noreply.github.com" },
  "metadata": { "description": "...", "version": "1.0.0", "pluginRoot": "./" },
  "plugins": [
    { "name": "pbi-mcp-ts", "source": "./", "version": "0.3.0",
      "description": "...", "keywords": [...] } ]   // remote entry: source = {source:"github", repo, path, ref}
}
```
Caveats (adopt): local `source` is a repo-relative path — **use `"./"` not `"."`** (antigravity's documented
gotcha; matches our current file). Remote entries use a `source` *object* (`source:"github"`, `repo`,
`path`, **immutable `ref`** = release tag or full SHA, NEVER a branch) + require `license` + `keywords`.
Repo must be public to publish. **HARD RULE (stated repeatedly):** keep `description` + `keywords` + `version`
**in sync across plugin.json ↔ marketplace.json ↔ README**. *Action item: our marketplace.json is currently
out of sync (v0.2.0, "46-tool/14 skills/5 subagents") with plugin.json (v0.3.0, "47-tool/16 skills/7 subagents")
— resolve and add a sync check.* "A plugin is NOT complete until registered in marketplace.json."

**MCP packaging (Conflict #4 answer):** declare via `.mcp.json` at plugin root (our current approach), every
internal path via **`${CLAUDE_PLUGIN_ROOT}`** (mandatory portability mechanism — never hardcode absolute
paths), stdio transport, secrets via `env` `${VAR}` interpolation. ruiromano's `npx -y <pkg>@latest` pattern
is the way to ship a *published* server; we currently run a local built `node ${CLAUDE_PLUGIN_ROOT}/packages/
mcp/dist/server.js` (correct for dev — switch to `npx -y @scope/pbi-mcp-ts@latest` once published). Microsoft
shows inline `mcpServers` in plugin.json **mirrored** in a sibling `.mcp.json` — our plugin.json already
points `mcpServers` at `./.mcp.json`, which is the cleaner single-source approach; keep it.

**Directory layout (plugin-master + data-goblin, confirms ours):**
```
pbi-mcp-ts/
  .claude-plugin/{plugin.json, marketplace.json}
  .mcp.json
  agents/<name>.md
  skills/<name>/{SKILL.md, references/*.md, examples/*.md, scripts/*}
  hooks/{hooks.json, scripts/*.mjs, tests/*}
  packages/{core, mcp, cli}
  README.md  LICENSE
```

**Skills catalog/index (antigravity, adapt-lightly given our ~16 skills):** keep **frontmatter as the single
source of truth**; generate a small validated `skills-index` (a typed TS const or JSON) + a CATALOG section in
README from it (so it never drifts). Enforce `folder == name`. Replace antigravity's security-oriented `risk`
field with a meaningful `kind: pipeline | shared-knowledge | crud` enum. Use a **small fixed taxonomy aligned
to skill *class*** (pipeline / shared-knowledge / crud) rather than domains — **avoid a catch-all category**
(antigravity's `general(354)` bucket is the lesson at scale). Skip the warning-budget machinery initially.

**Description-craft for routing (the dedup target — merged):** the Microsoft 23-skill formula + ruiromano
numbered-ops + negative routing + antigravity `Use when`/`Do not use when` → see §3 house style. The single
biggest discoverability lever; this is consistent enough across all three sources to be our mandatory template.

**Mix-and-match notes:** plugin-master/data-goblin/ruiromano = *manifest field shapes + layout + audit*;
awesome-copilot = *local-vs-remote source + pluginRoot + immutable ref*; antigravity = *index-from-frontmatter +
taxonomy + source:"./" caveat + generated-artifact discipline*; Microsoft = *bundle-variants + mcp mirroring +
skills-vs-MCP doctrine*.

**Reference-only / defer:** Codex `.codex-plugin/plugin.json` + `interface{}` block (antigravity/Microsoft —
only if multi-host distribution becomes a goal); Microsoft bundle-variants (a `pbi-modeling`/`pbi-reporting`/
`pbi-all` split — defer; our catalog is small, single-plugin is right for now); borghei `bundles.json` +
per-bundle plugin.json duplication (the duplication is a wart — prefer one source of truth); `check-updates`
self-update skill (a trimmed UTC-throttled version is worth having later); team-distribution
`extraKnownMarketplaces` (relevant if rolled out to a data team).

**Conflict resolved (Conflict #3):** plugin.json/marketplace.json shapes appear in non-Claude repos too
(awesome-copilot is Claude-spec; antigravity ships BOTH `.claude-plugin` and `.codex-plugin`). **Authoritative
= the Claude Code native trio (plugin-master + data-goblin + ruiromano)**, corroborated by awesome-copilot's
Claude-spec manifests. Ignore Codex/`interface{}` fields. (Also resolved Conflict #4 above: `.mcp.json` +
`${CLAUDE_PLUGIN_ROOT}` + `npx -y <pkg>@latest`-when-published is our recommended approach.)

**Provenance:** claude-plugin-marketplace-structure.md, dg4-te-fabric-hooks-root.md, powerbi-agentic-plugins-structure.md,
awesome-copilot-meta.md, antigravity-catalog-structure.md, skills-for-fabric-catalog.md, antigravity-bi-bundles.md.

---

## 8. Eval/verification & review disciplines

**Verdict:** strong patterns available.

**Canonical source(s):**
- `claude-skills-standards.md` (borghei) — the **stdlib-only evals harness** (static `runner.py` structural
  validator + rubric `grader.py` + `test_cases.json` schema with version-drift check). The standout reusable
  *engineering* artifact — reimplement in TS.
- `agent-skills-pbi-meta.md` — verification-before-completion (Iron Law: no completion claims without fresh
  evidence), agentic-eval (weighted rubric loop), code-reviewer.md, subagent two-stage review,
  mcp-builder/evaluation (in §6).
- `awesome-llm-apps-rag-eval.md` — Executor/Analyst/Mutator loop (binary criteria + structured-output +
  keep-if-improved/revert), LLM-as-judge with discrete scale + UNVERIFIABLE escape, **RAG failure taxonomy
  P01-P12** (reviewer triage vocabulary + regression-fixture naming), deterministic-gate-before-execution.
- `awesome-llm-apps-orchestration.md` — generate→critique→revise bounded loop.

**Adopt (merged):**

**Two-stage review (the spine — practicalswan):** spec-compliance review FIRST, code/artifact-quality review
SECOND; dispatch quality only AFTER spec passes; "Do Not Trust the Report"; reviewer reads actual artifacts +
compares line-by-line; no proceeding with open issues. (Wires §1's model-reviewer/report-reviewer.)

**Verification-before-completion (adopt-as-is for every "done" claim):** Iron Law = NO COMPLETION CLAIMS
WITHOUT FRESH VERIFICATION EVIDENCE. Gate: IDENTIFY proving command → RUN fresh → READ full output + exit code +
failure count → VERIFY → claim WITH evidence. Claim→Requires→Not-Sufficient table ("tests pass" = 0 failures
in *this* run, not "should"; "agent completed" = VCS diff shows changes, not "agent reported success";
"requirements met" = line-by-line checklist). Regression tests red-green verified (revert fix → MUST FAIL →
restore → pass). Pairs with our validator hook.

**Structural eval harness (borghei → reimplement in TS — highest-leverage borrow):**
- A static **`runner` (TS)** with NO model: SKILL.md exists + well-formed frontmatter (name/description);
  every script/reference path referenced in a skill resolves on disk; index is valid; **version-drift warning**
  if a skill's version ≠ its test_cases version. Exit 0 = pass, non-zero + JSON diagnostic = fail (CI-ready).
- A **rubric grader**: `must_contain` / `must_not_contain` (plain substring OR `/regex/`) + optional minimal
  JSONSchema subset check; weighted `score = passed_weight/total_weight`. "must_contain/must_not_contain are
  the cheapest, most deterministic signal — for facts the skill must always state and footguns it must never
  produce."
- `test_cases` schema (reuse as-is): `{skill, version, cases:[{id, prompt, expected:{format, must_contain[],
  must_not_contain[], schema?}, rubric, weight}]}`.

**Executor/Analyst/Mutator loop (RAG-eval — for hardening skills/agents AND grading generated artifacts):**
score against **binary yes/no criteria** (e.g. "every DAX reference resolves? y/n", "measure has format
string? y/n" — binary beats fuzzy); the diagnosing agent emits **structured output** (a schema), not prose;
**apply ONE change at a time, keep-if-improved-else-revert**; bound by target pass-rate + max_rounds.

**Reviewer rubric loop (agentic-eval):** few concrete dimensions, weight business-critical highest, define
passing score up-front, require written evidence for any failing dimension, stop when no longer learning fixes.
Output table: `Dimension | Weight | Score | Notes → Weighted score vs Threshold → PASS/FAIL → Required
Improvements`. Example rubric weights: correctness 0.4 / completeness 0.25 / clarity 0.15 / maintainability 0.2.

**LLM-as-judge (fact-checker):** discrete scale (for us: GROUNDED / PARTIALLY-GROUNDED / UNGROUNDED /
UN-CHECKABLE), **state required evidence BEFORE judging** (forces grounding), and keep the **UN-CHECKABLE escape
hatch** (prevents the judge fabricating a pass/fail when the model can't be resolved).

**RAG failure taxonomy P01-P12 (adopt vocabulary + fix-framing):** classify each review/incident to a named
pattern → propose a *minimal structural fix* (not "add more context/better model"); keep a small JSON library
of real failure cases as regression fixtures. P01 grounding-drift / P07 ungrounded-tool-call = exactly our
DAX-references-nonexistent-field gate; **P09 (passes tests, fails real incidents)** = explicit warning for our
eval design — green unit tests ≠ no hallucination on real models.

**Pre-ship plugin QA (plugin-master triggering-reliability audit — run before every release):** the greppable
checks for missing `<example>`/enumeration/model + boilerplate-in-YAML (port into our TS validator). Fix
priority P0 (invisible/broken) before P1 (missing examples/enumeration) before P2 (metadata hygiene). Skill-
coverage rule: every delegated skill has ≥1 routing example.

**Mix-and-match notes:** borghei = *static-validator + rubric-grader + test_cases schema + version-drift*;
practicalswan = *two-stage review + verification-before-completion + code-reviewer template + MCP eval (§6)*;
RAG-eval = *binary-criteria + structured-output + keep-or-revert + discrete-judge + failure taxonomy*;
agentic-eval = *weighted rubric loop*. File all under ONE "evaluation" umbrella to avoid the three-takes
duplication the findings flagged.

**Reference-only / defer:** Python harness code (reimplement in TS); LLM-as-judge external harness (start with
the cheap deterministic must_contain/must_not_contain signal); self-improving-skills full autonomy loop
(adopt the loop *shape*, run human-in-loop initially).

**Conflicts resolved:** three overlapping evaluator-optimizer takes (agentic-eval rubric loop vs RAG-eval
Executor/Analyst/Mutator vs code-quality reflection loop) → consolidate: **borghei structural-validator +
test_cases** for offline CI; **RAG-eval binary+structured+revert** for the in-loop optimizer; **agentic-eval
weighted rubric** for human-readable review verdicts. Verification-before-completion + TDD +
subagent-driven-development share a "evidence before claims / don't trust agent reports" thread — consolidate
the rationalization tables once and cross-reference.

**Provenance:** claude-skills-standards.md, agent-skills-pbi-meta.md, awesome-llm-apps-rag-eval.md,
awesome-llm-apps-orchestration.md.

---

## Top 10 highest-value architecture/authoring adoptions (ranked)

1. **gate-measure-create + gate-data-analyst-readonly as deterministic PreToolUse gates** (exit-2 to block,
   fail-open on error), using the data-goblin `cmd_validate_measure`/`cmd_validate_dax` blueprint + the
   retrieve-once-grounding invariant. — *dg4-te-fabric-hooks-root.md, dg1-pbip.md, awesome-llm-apps-rag-eval.md*
2. **Reusable bash threat tables + config.yaml kill-switch** for block-destructive-commands / block-pnpm-discipline /
   block-secrets-exposure, in **Claude Code hooks.json schema** (anchored regex, per-pattern suggestions,
   placeholder-suppression). — *dg4-te-fabric-hooks-root.md, awesome-copilot-meta.md*
3. **Reconciled SKILL.md `description:` house style** (`<capability>. Use when <triggers>. Does NOT … (use X).`,
   WHEN-not-WHAT, negative routing, ≤~200 chars, BI-noun-dense). — *agent-skills-pbi-meta.md (writing-skills),
   skills-for-fabric-catalog.md, antigravity-catalog-structure.md*
4. **TS MCP best-practice checklist** (registerTool + Zod.strict + annotations + pagination + CHARACTER_LIMIT +
   response_format + service-prefixed snake_case) as a PR gate for `packages/mcp`. — *agent-skills-pbi-meta.md (mcp-builder)*
5. **Two-stage review (spec-first, then quality) + "don't trust the report" + verification-before-completion**
   wired into model-reviewer/report-reviewer. — *agent-skills-pbi-meta.md*
6. **Structural eval harness (TS) + test_cases schema + version-drift check** + binary-criteria/keep-or-revert
   optimizer loop. — *claude-skills-standards.md, awesome-llm-apps-rag-eval.md*
7. **DashboardSpec = strict versioned Zod schema with enums + field-level descriptions**, validated as input
   guardrail into builders + output guardrail on writes; 4-field handoff payload. — *awesome-llm-apps-orchestration.md, claude-skills-standards.md*
8. **Per-worker MCP tool scoping** (least-privilege envelope per subagent) instead of all-47-tools-everywhere. —
   *awesome-llm-apps-orchestration.md*
9. **Pipeline = named primitives (Sequential/Loop-bounded/Parallel) + Tool-Selection-Priority ladder +
   "don't-stop-half-done"** completion guardrail. — *awesome-llm-apps-orchestration.md, powerbi-agentic-plugins-structure.md, skills-for-fabric-catalog.md*
10. **Lean-orchestrator agent + skill-activation table + Self-Validation Protocol + `<example>` routing + greppable
    pre-ship audit**, with deterministic-first reviewer agents + safety-fixing rules. — *claude-plugin-marketplace-structure.md, dg4-te-fabric-hooks-root.md, dg1-pbip.md*

---

## Recommended sequencing (given hooks/gates + foundations are already prioritized)

1. **Hooks first (hardest gates).** We already have the Claude Code hooks.json schema + gate-measure-create.mjs +
   sidecar hooks. Next: (a) add the **config + master kill-switch** + fail-open-on-error discipline to all
   `.mjs` hooks; (b) add **gate-data-analyst-readonly**; (c) add the three **safety hooks**
   (block-destructive-commands / block-pnpm-discipline / block-secrets-exposure) using the merged threat tables;
   (d) extend gate-measure-create with the **DAX-reference grounding check** (retrieve-once invariant) where the
   model index is available.
2. **MCP hardening (foundation).** Apply the TS MCP checklist to `packages/mcp` as a PR gate: annotations on
   every tool (enables tool-scoping + readonly-gate), pagination + CHARACTER_LIMIT on data tools, response_format,
   central error mapping, immutable model-index context.
3. **Authoring house style (foundation, unblocks everything else).** Lock the reconciled SKILL.md + agent
   frontmatter styles; rewrite our 16 skill `description:` fields + 7 agent descriptions to the formula + add
   `<example>` blocks; add `## Do not use when` sections.
4. **DashboardSpec contract + per-worker tool scoping.** Define the Zod spec + the 5 workers' frontmatter
   (model-per-role, scoped tools, Must/Prefer/Avoid, delegates_to) + the two-stage review prompts.
5. **Pipeline orchestration.** Author pbi-build/modify/fix-model/audit to the canonical skeleton (named
   primitives + tool-selection ladder + bounded loop + completion guardrail).
6. **Eval + pre-ship QA.** Stand up the TS structural validator + test_cases + the greppable triggering-reliability
   audit as a CI/pre-ship gate; add the binary-criteria optimizer for skill hardening.
7. **Packaging hygiene (continuous).** Fix the plugin.json↔marketplace.json drift now; add a version/keyword/
   description sync check; generate the skills-index + README CATALOG from frontmatter.

---

## Platform-mismatch watchlist (translate, do NOT copy)

- **awesome-copilot `hooks.json`** = **GitHub Copilot CLI schema** (camelCase events `preToolUse`/`postToolUse`/
  `userPromptSubmitted`/`errorOccurred`, fields `bash`/`timeoutSec`/`type:"command"`, `version:1`, stdin keys
  `toolName`/`toolInput` as *string*). Our schema = Claude Code (`{ "hooks": { "PreToolUse":[{matcher, hooks:[{
  type:"command", command/args, timeout}]} ] } }`, stdin `tool_name`/`tool_input` *object*). **Port the bash
  threat *logic* only; keep our config schema.**
- **awesome-copilot `*.agent.md` / `*.instructions.md` (`applyTo` glob) / `workflows/*.md` (`on`/`permissions`/
  `safe-outputs`, compiled via `gh aw` to `.lock.yml`)** = Copilot/GitHub-Actions runtime. The *structure*
  (numbered phases + fixed output schema) transfers; the runtime + frontmatter fields do not.
- **antigravity / skills-for-fabric / antigravity-bi-bundles `.codex-plugin/plugin.json` + `interface{}` block**
  = Codex manifest dialect. Ignore unless we add multi-host distribution; use only the `.claude-plugin/plugin.json`
  half + the `source:"./"` caveat.
- **ruiromano + microsoft agent `tools:` / `model:` values** = Copilot-flavored (`tools:[vscode, execute, agent,
  'powerbi-modeling-mcp/*', ...]`). Translate to Claude Code subagent frontmatter (`tools:[Read, Edit, Bash,...]`,
  `model: sonnet|opus`). The *glob-scoped MCP tool grant* idea is good; the literal values are not portable.
- **All `.csx` / C# (Tabular Editor scripting), `.ps1` (PowerShell), `az rest`/`fab`/`curl` CLI bodies, Python
  (FastMCP, validate_pbip.py, dbt/Jinja/SQL, matplotlib/ggplot2)** = non-Node runtimes → **reference-only**.
  Reimplement the *logic* (validator checks, BPA predicates, M-validation, refresh semantics) in TS; never ship
  the foreign-runtime code.
- **data-goblin `block-secrets-exposure` `hook.json`** uses a **non-standard nested shape** (`{"PreToolUse":
  {"read-hooks":[...],"bash-hooks":[...]}}`) — NOT harness-correct. Use its `settings.json.example` flat-array
  structure (translated to our plugin `hooks.json` form) instead.
- **Microsoft official Power BI MCP** (`https://api.fabric.microsoft.com/v1/mcp/powerbi`, HTTP, `ExecuteQuery`)
  and **ruiromano `@microsoft/powerbi-modeling-mcp`** (needs a *live* Desktop/AS endpoint) — these are real but
  *different tool surfaces* from our **file-based PBIR+TMDL** MCP (a deliberate divergence). Reference their tool
  *naming/coverage* as a checklist; do not assume their tool names/transport.
