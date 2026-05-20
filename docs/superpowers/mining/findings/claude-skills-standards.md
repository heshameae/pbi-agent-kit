# Mining findings: borghei/Claude-Skills — authoring standards/orchestration/templates
Source: claude-skills-borghei.xml

## Relevance summary
This repo is a 245+ skill "universal AI skills library" whose **meta layer** (standards/, templates/, bundles.json) is directly on-target for us: it ships a formal 10-pattern skill-authoring standard, a 4-pattern orchestration protocol, an agent template + agents/CLAUDE.md authoring guide, a stdlib-only evals harness (static `runner.py` + rubric `grader.py` + `test_cases.json` schema), a JSON bundle schema, and quality/communication/security/documentation standards. The skill/agent/persona taxonomy and the hook-enforced security pattern map almost 1:1 to our subagents + pipeline skills + shared-knowledge skills + reviewer agents + hooks. The actual domain skill *content* (marketing, c-level, compliance, even their data-analytics) is out of scope and discarded; the Python-script tooling rules are reference-only since we are Node/TS.

## High-value extractions

### Skill Authoring Standard (10 patterns) → our SKILL.md house style
- What it is / why valuable: A formal, checklist-backed standard every SKILL.md must follow. This is the single most reusable artifact for our SKILL.md conventions. Quality 5.
- Key content (the 10 patterns, condensed):
  1. **Context-First Design** — first 3 lines must be a specific description with *trigger phrases* + target audience. "Helps with architecture" is a failure because it "matches everything and nothing."
  2. **YAML Frontmatter Schema** — required: `name` (lowercase-hyphenated, matches folder), `description` (<120 chars, no jargon), `license: MIT`, `metadata.{version (semver), author, category (= top-level dir), domain, updated (ISO 8601), tags (3-8)}`.
  3. **Line Limits** — SKILL.md < 500 lines; `references/*.md` ≤ 800; `scripts/*` ≤ 300; assets unlimited. Split strategy: keep workflows/decision-trees/quick-ref tables in SKILL.md, move deep frameworks/checklists/theory to `references/`, link don't duplicate.
  4. **Opinionated Recommendations** — "Use X because Y" always beats "you could use X or Y". State recommendation first → one-sentence alternative → escape hatch (when it doesn't apply).
  5. **Anti-Patterns Section** — mandatory, ≥3 entries, each = `Mistake / Why it happens / Instead`, drawn from real experience.
  6. **Confidence Tagging** — tag recommendations `[PROVEN]` (seen in 3+ projects), `[RECOMMENDED]` (default when unsure), `[EXPERIMENTAL]` (must include a risk note). Tag at section level, not per sentence.
  7. **Tool Design Standards** — (Python-specific; reference-only for us) stdlib-only, argparse `--help`, JSON + human output, 150-300 lines, deterministic/no ML calls, type hints + docstrings.
  8. **Reference Architecture** — standard flat dir layout `SKILL.md + scripts/ + references/ + assets/`; "knowledge flows: references/ → SKILL.md workflows → scripts/ execution → assets/ templates"; no nested subdirs.
  9. **Self-Contained Packaging** — zero cross-skill imports/references; "duplicate rather than depend"; `standards/` is the only allowed shared dependency. Validation test: copy the folder to an empty dir and everything must still resolve.
  10. **Quality Threshold** — a skill must save 40%+ time AND improve a quality dimension 30%+, else don't publish. Explicitly rejects info-only skills, thin wrappers, and copy-paste-of-docs skills.
- Reusable publish checklist (verbatim shape): frontmatter complete + name=dir (P2); <500 lines (P3); 3-line activation context (P1); opinionated w/ rationale (P4); 3+ anti-patterns (P5); confidence tags (P6); script rules (P7); standard layout (P8); self-contained (P9); 40%/30% bar (P10).
- Source path within repo: `standards/skill-authoring-standard.md`
- Quality: 5 — crisp, opinionated, has good/bad examples and a "Common Mistakes → Pattern Violated → Fix" table.
- Recommendation: **adapt** (adopt patterns 1-6, 8-10 nearly verbatim; rewrite P7 for TS/Node tooling; align frontmatter to Claude Code plugin skill schema).

### Orchestration Protocol (4 patterns + taxonomy) → our pipeline skills + worker-agent contracts
- What it is / why valuable: Defines the Skill/Agent/Persona taxonomy and 4 coordination patterns with explicit handoff rules. Maps directly to our pipeline skills (orchestration) and worker-agent contracts. Quality 5.
- Key content:
  - **Taxonomy / hierarchy:** Skills = "how to execute" (stateless, composable, deterministic). Agents = "what to do" (domain-scoped coordinators that select+sequence skills, interpret results, decide). Personas = "who thinks" (cross-domain, opinionated). Hierarchy: `Persona → Agent → Skill`; info flows up (outputs/findings) and down (goals/constraints).
  - **Pattern 1 Solo Sprint:** one persona moves across skills through phases; context accumulates each phase; persona decides transitions; backtracking allowed; time-box phases. Safest default when unsure.
  - **Pattern 2 Domain Deep-Dive:** one persona stacks 3-5 same-domain skills; persona synthesizes raw skill outputs; "contradictions are valuable" — persona resolves and documents the tradeoff (e.g., produces an ADR).
  - **Pattern 3 Multi-Agent Handoff:** multiple personas review each other's work; **handoff protocol** = each handoff carries (1) the artifact, (2) why it was produced, (3) specific questions for the next reviewer, (4) non-negotiable constraints from prior reviewers. Max 4 handoffs; final persona decides. This is the model for our model-builder→model-reviewer / report-builder→report-reviewer chains.
  - **Pattern 4 Skill Chain:** pure execution pipeline, no persona; each skill must **declare input/output format (JSON/Markdown/text) + required fields**; fail-fast on invalid output; idempotent; observable (log each step's I/O); max ~6 steps. This is our deterministic pipeline-skill contract.
  - **Pattern selection table** (situation → pattern → reason) and **error handling**: skill failure → retry once then escalate to persona; handoff failure → return to prior persona with specific questions; chain failure → stop + log failure point + report completed steps.
  - **Cross-cutting anti-patterns:** Kitchen Sink (activate everything), Echo Chamber (same-domain reviewing itself = agreement not validation), Infinite Loop (review without a decision-maker; cap review cycles at 2), Premature Pipeline, Context Dropout (never drop context silently — summarize if needed).
- Source path within repo: `standards/orchestration-protocol.md` (a lighter, more execution-oriented variant lives at `docs/guides/orchestration.md`: Sequential Pipeline, Fan-Out/Fan-In, Agent Delegation, Iterative Refinement — useful framing for our CI-style quality gates and the "score → revise → re-score" loop).
- Quality: 5 — every pattern has when-to-use, flow diagram, YAML example, rules, anti-patterns.
- Recommendation: **adapt** — adopt the handoff protocol (4 fields) and Skill-Chain I/O-contract rules as our worker-agent + pipeline-skill contracts; keep Persona layer optional (we mostly have Agents+Skills).

### Agent template + agents/CLAUDE.md authoring guide → our agent frontmatter + agent docs
- What it is / why valuable: A fill-in-the-blanks agent markdown template plus a guide on agent-vs-skill separation and required sections. Maps to our worker subagent files. Quality 4.
- Key content:
  - **Agent frontmatter schema:** `name` (cs- prefix, kebab), `description` (<150 chars), `skills` (folder it orchestrates), `domain`, `model: sonnet|opus|haiku`, `tools: [Read, Write, Bash, Grep, Glob]`.
  - **Required sections (in order):** Purpose (2-3 paras) → Skill Integration (Skill Location + Python Tools + Knowledge Bases + Templates) → Workflows (**minimum 3**: primary, advanced, integration; each = Goal / numbered Steps / Expected Output / Time Estimate / Example) → Integration Examples (copy-paste-ready) → Success Metrics (3-4 categories, measurable) → Related Agents (cross-refs) → References.
  - **Core principle:** "Agents ORCHESTRATE skills, they don't replace them." Agent = single .md + frontmatter; Skill = SKILL.md + scripts/references/assets. Agents reference skills by relative path and must test that paths resolve.
  - Agent quality checklist: valid YAML, all required fields, cs- prefix, paths resolve, ≥3 workflows, integration examples tested, success metrics defined, related agents cross-referenced.
- Source path within repo: `templates/agent-template.md`, `agents/CLAUDE.md`, `templates/CLAUDE.md`
- Quality: 4 — thorough but Python/relative-path-centric (their agents shell out to scripts; ours call MCP tools). The "min 3 workflows + measurable success metrics + Related Agents cross-refs" structure is the keeper.
- Recommendation: **adapt** — adopt the section skeleton + "≥3 workflows w/ Goal/Steps/Output" + success-metrics discipline; replace Python-script integration with our MCP-tool/subagent invocation contract.

### Evals harness (static runner + rubric grader + test_cases schema) → our agent/skill evaluation
- What it is / why valuable: A drop-in, dependency-free evaluation harness answering "does this skill still produce good output when the model changes?" Directly fills our "agent evaluation" gap. Quality 5 — this is the standout reusable engineering artifact.
- Key content:
  - **Three pieces:** `test_cases.json` (prompts + expected schema + rubric), `grader.py` (scores a captured candidate output against the deterministic rubric), `runner.py` (static validator — runs with NO model).
  - **`runner.py` static checks** (port these to a TS validator): SKILL.md exists + well-formed frontmatter (name, description, version); every script/tool referenced in the "Tools Overview" table exists on disk; referenced `references/*.md` exist; `test_cases.json` is valid JSON with `cases[]` (≥1); **version-drift warning** if SKILL.md `metadata.version` ≠ `test_cases.json` `version`. Exit 0 = pass, non-zero + JSON diagnostic = fail (CI-ready). Required sections it looks for: "Overview", "Use when".
  - **`grader.py` rubric model:** `must_contain` / `must_not_contain` are plain substrings OR regex when wrapped in `/.../`; optional minimal JSONSchema subset check (type/required/properties/items); weighted pass/fail with an overall `score = passed_weight/total_weight`. Deliberately model-agnostic — LLM-as-judge scoring is delegated to an external harness.
  - **`test_cases.json` schema (reusable as-is):**
    ```json
    {
      "skill": "skill-name", "version": "1.0.0",
      "cases": [{
        "id": "case-001",
        "prompt": "Plain-English request a user would make of this skill",
        "expected": {
          "format": "markdown | json | code",
          "must_contain": ["substring-or-/regex/"],
          "must_not_contain": ["anti-pattern"],
          "schema": { "...optional JSONSchema fragment..." }
        },
        "rubric": { "structure": "...", "accuracy": "...", "scope": "..." },
        "weight": 1.0
      }]
    }
    ```
  - **Design rationale (adopt verbatim for us):** stdlib-only/no LLM in repo scripts; CI-ready exit codes + JSON diagnostics; eval `version` tracks SKILL.md `metadata.version` so eval drift is detectable; `must_contain`/`must_not_contain` are "the cheapest, most deterministic signal — use them for facts the skill must always state and footguns it must never produce."
- Source path within repo: `templates/evals-template/{README.md, evals/runner.py, evals/grader.py, evals/test_cases.json}`
- Quality: 5.
- Recommendation: **adapt** — reimplement `runner.py` (structural validator) and the `test_cases.json` schema in TS for our skills/agents; keep the static/graded split and the version-drift check. This is arguably the highest-leverage borrow in the source.

### bundles.json schema → how we group our skills
- What it is / why valuable: A simple, machine-readable manifest grouping skills into role-based bundles, each with an optional default persona. Maps to how we'd package our pipeline + shared-knowledge + CRUD skills into installable sets. Quality 4.
- Key content (schema shape):
  ```json
  {
    "version": "1.0.0", "description": "...", "repository": "...",
    "bundles": {
      "<bundle-key>": {
        "name": "Human Name",
        "description": "one-liner",
        "skills": ["domain/skill-a", "domain/skill-b"],
        "persona": "default-persona-id"
      }
    }
  }
  ```
  - Note a parallel **plugin-bundle** mechanism: `bundles/<name>/.claude-plugin/plugin.json` + README per bundle (the Claude Code plugin packaging form) — relevant since we ship as a plugin. The directory layout pairs `bundles.json` (catalog) with per-bundle plugin manifests.
- Source path within repo: `bundles.json`, `bundles/README.md`, `bundles/*/.claude-plugin/plugin.json`, `docs/guides/bundles.md`
- Quality: 4 — clean schema; the duplication between `bundles.json` and per-bundle `plugin.json` is a wart to avoid.
- Recommendation: **adapt** — a single `bundles.json`-style catalog keyed by role/pipeline is a good model; prefer one source of truth over duplicating into per-bundle plugin manifests.

### Quality + Communication standards → our reviewer agents + house voice
- What it is / why valuable: Defines the quality bar and the blunt, anti-fluff communication style our reviewer agents should enforce/use. Quality 4.
- Key content:
  - **Communication standards:** Absolute Honesty (no diplomatic cushioning), Zero Fluff, Pragmatic Focus (every suggestion immediately actionable), Critical Analysis (challenge assumptions before responding), File Economy (edit > create), Anti-Overengineering. Prohibited: generic praise, vague suggestions, advice without implementation detail, assumptions when requirements unclear. (Source: `standards/communication/communication-standards.md`.)
  - **Quality standards:** "Zero Defect Handoff" (nothing complete with known issues); validation checklists for functional/quality/docs; agent-specific gates (valid frontmatter, paths resolve, ≥3 workflows, success metrics); **issue-priority/SLA table** P0 (broken tools, bad paths, security, data loss <1h) → P3 (<1mo). Success metrics framed as target+measurement pairs. (Source: `standards/quality/quality-standards.md`.)
  - **standards/CLAUDE.md** sets a **standards hierarchy / priority order**: Security > Quality > Git > Documentation > Communication, with "when to reference" triggers per standard — a clean model for our reviewer-agent rubric ordering.
- Source path within repo: `standards/communication/`, `standards/quality/`, `standards/CLAUDE.md`, `standards/documentation/documentation-standards.md`
- Quality: 4 — the Python/PEP8 specifics are reference-only; the principles, the priority hierarchy, and the P0-P3 severity model are reusable.
- Recommendation: **adapt** — fold the communication principles + the Security>Quality>... priority order + zero-defect-handoff into our reviewer-agent rubrics; ignore PEP8/yamllint specifics.

### Hook-Enforced Security Pattern → our hooks + safety posture
- What it is / why valuable: A concise rationale + concrete design for deterministic, fail-open hooks at the Bash boundary. Directly informs our `hooks/` (we already have hooks/scripts + hooks/tests). Quality 5.
- Key content:
  - **Core argument (quote-worthy):** "Prompt-level guidance asking the model to 'never paste secrets' can be ignored, paraphrased, or routed around. Hook-layer defenses run deterministically outside the model — they cannot be argued with, distracted, or socially engineered. A hook that exits non-zero blocks the tool call regardless of what the conversation looked like."
  - **Two narrowly-scoped jobs:** (1) `PreToolUse` on Bash → secret scanner blocking AWS/GitHub/Slack/Anthropic/OpenAI key patterns, inline PEM private keys, and `.env` writes of secret-bearing vars; (2) `SessionStart` → registry/index freshness check (warn if `registry.json generated_at` older than newest `SKILL.md` mtime).
  - **Design rules:** stdlib-only, no network, **fail-open on error** (a hook must never brick a session); explicit threat model with in-scope vs out-of-scope; "**bias toward false negatives over false positives** — a hook that fires on every other command will be disabled by users and protect nothing"; hooks live in committed `.claude/settings.json` (contract for all contributors), disable only via gitignored `settings.local.json`; "never bypass a hook by mutating the command to evade the pattern."
  - Extending: append `(re.compile(...), "label")` to `SECRET_PATTERNS` + add a `tests/` smoke case (JSON payload piped in, assert exit code 2).
  - Companion `security-standards.md` gives concrete prohibited-vs-good patterns: no hardcoded secrets (env vars + raise if missing), safe path handling (reject `..`/absolute, `is_relative_to` check), `subprocess` arg-list not `shell=True` + timeout, input validation/sanitization, never expose secrets in error messages.
- Source path within repo: `standards/security/hook-security-pattern.md`, `standards/security/security-standards.md`
- Quality: 5 — exactly the philosophy we want for our hooks; threat-model honesty ("make the obvious accidents impossible, not a comprehensive DLP system") is a good posture to copy.
- Recommendation: **adopt-as-is** (the philosophy + the fail-open/false-negative-bias rules + the "hooks beat prompt rules" framing); **reference-only** for the Python implementation (ours is TS/Node).

### Git workflow + documentation conventions → our repo hygiene
- What it is / why valuable: Conventional-commit scopes and living-docs triggers usable for our CONTRIBUTING/commit style. Quality 3 (generic but clean).
- Key content: Conventional commits `<type>(scope): desc` with types feat/fix/docs/style/refactor/perf/test/chore/ci and domain scopes (`feat(agents):`, `fix(tool):`). Branch flow feature→dev→main (PR-only, main protected). Living-docs update triggers: update README on new skill/agent; update CLAUDE.md on structural/standards changes; update AGENTS.md on agent add/modify. Doc rules: one H1, no skipped heading levels, descriptive link text, alt text, max ~200 lines per CLAUDE.md.
- Source path within repo: `standards/git/git-workflow-standards.md`, `standards/documentation/documentation-standards.md`, root `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`
- Quality: 3.
- Recommendation: **reference-only / adapt** — adopt conventional-commit scopes and the living-docs triggers; the rest is standard hygiene.

## Cross-source overlap flags
- **Two competing SKILL.md house styles inside THIS repo (internal inconsistency to resolve before we copy):** the formal `standards/skill-authoring-standard.md` (frontmatter `license` + `metadata.{author,category,domain}`, confidence tags, no voice mandate) vs `CONTRIBUTING.md`'s stricter rules: (a) frontmatter `name/description/version/updated/domain/tags` (no `license`/`author`), (b) mandatory **"Use when..." trigger clause**, (c) **third-person agent voice** ("The agent analyzes...", not "You should..."), (d) **numbered workflow steps with explicit validation checkpoints**, (e) **<500 lines AND <3,000 words**, (f) realistic-data examples ("Acme Corp Q3 $2.4M" beats "Company X $N"), (g) a **quality scorer threshold ≥70**. The `runner.py` validator yet again expects sections "Overview" + "Use when". When we define our house style, reconcile these — recommend taking CONTRIBUTING's trigger-clause + third-person voice + numbered-steps-with-validation + realistic-data rules ON TOP of the standard's 10 patterns.
- **vs writing-skills / agent-skills (Anthropic's own skill-authoring guidance):** strong overlap on progressive disclosure (SKILL.md thin + references/ deep), frontmatter discipline, "trigger phrases / use when" for activation, and tight line limits. borghei adds **confidence tags ([PROVEN]/[RECOMMENDED]/[EXPERIMENTAL])**, the explicit **40%/30% quality threshold**, and the **self-contained "duplicate rather than depend"** rule — check whether the agent-skills source already covers these before double-listing.
- **vs awesome-copilot conventions:** likely overlap on YAML-frontmatter-for-discovery and naming conventions (kebab-case, name=folder). borghei's bundle schema + persona layer + orchestration protocol are probably unique to it.
- **Orchestration doc duplication within repo:** `standards/orchestration-protocol.md` (Solo Sprint / Domain Deep-Dive / Multi-Agent Handoff / Skill Chain) vs `docs/guides/orchestration.md` (Sequential / Fan-Out-Fan-In / Agent Delegation / Iterative Refinement) describe overlapping ideas with different names — we should pick ONE vocabulary.

## Discarded / not relevant
- **All domain skill content** — `marketing/`, `c-level-advisor/` (via agents), `compliance/ra-qm-team/`, `hr-operations/`, `product-team/`, `business-growth/`, `finance/`, and especially `data-analytics/` (analytics-engineer, business-intelligence, data-analyst, data-scientist, ml-ops-engineer): business-domain knowledge, owned by the sibling data-analytics agent. Not authoring/orchestration standards.
- **The 74 cs-* agents + 7 personas as content** (e.g. cs-ceo-advisor, cs-cto-advisor, solo-founder): only their *structure/frontmatter* was extracted; the advisory content is out of scope.
- **Python tooling specifics (P7, quality PEP8/flake8/yamllint, script skeletons, `scripts/skill-installer.py`, integration_test_runner.py):** reference-only — we are Node/TS, not Python. The *concepts* (argparse→CLI, dual JSON/human output, deterministic/no-LLM, line limits) carry over; the language does not.
- **Non-Claude platform configs** (`.cursorrules`, `.windsurfrules`, `.clinerules`, `.goosehints`, `GEMINI.md`, `AGENTS.md` cross-platform matrix): we target Claude Code only; reference-only at most.
- **CODE_OF_CONDUCT.md, SECURITY.md (policy), CHANGELOG.md, MkDocs site files (docs/stylesheets, mkdocs config), docs/getting-started/**, AUDIT_REPORT.md:** boilerplate / project-meta, not reusable standards.
- **templates/workflows/*.yml (GitHub Actions: claude.yml, ci-quality-gate.yml, release-drafter.yml, changelog-enforcer.yml, etc.) + WORKFLOW_KILLSWITCH:** CI plumbing; reference-only — the changelog-enforcer/quality-gate ideas could inform our CI but the YAML itself is GitHub-specific and not core to authoring/orchestration.
