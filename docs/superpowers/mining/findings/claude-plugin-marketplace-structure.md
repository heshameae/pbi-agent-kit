# Mining findings: claude-plugin-marketplace — plugin-master + packaging
Source: claude-plugin-marketplace.xml

## Relevance summary
This repo is a near-perfect packaging/authoring template for pbi-mcp-ts: a GitHub-hosted marketplace of ~25 consistently-structured `*-master` plugins, plus a dedicated **plugin-master** plugin that documents how to author Claude Code plugins (manifest schema, agent/skill/hook/MCP conventions, triggering reliability, validation scripts). The single most valuable artifacts are: (1) the `marketplace.json` + `plugin.json` schemas and their sync rule, (2) the **lean-orchestrator agent + skill-activation-table** pattern (the `powerbi-expert` agent is a directly-adoptable shape), (3) the **triggering-reliability anti-pattern catalog** with greppable audits, and (4) three reusable bash validators. The PBI/SQL *domain* content (DAX, TMDL, BPA references, T-SQL) is the sibling agent's job and is discarded here.

## High-value extractions

### 1. marketplace.json schema + registration model → maps to our `.claude-plugin/marketplace.json` (if we ship a marketplace)
- **What/why:** Canonical central registry. Each plugin is one flat entry; the registry is what `/plugin marketplace add <owner>/<repo>` reads. This is exactly how we'd register pbi-mcp-ts and any sibling plugins.
- **Key content (reusable):**
  ```json
  {
    "name": "marketplace-name",
    "description": "...",
    "owner": { "name": "...", "email": "user@users.noreply.github.com" },
    "plugins": [
      {
        "name": "plugin-name",
        "source": "./plugins/plugin-name",
        "description": "MUST match plugin.json description (incl. 'PROACTIVELY activate for:' text)",
        "version": "1.0.0",
        "author": { "name": "..." },
        "keywords": ["..."]
      }
    ]
  }
  ```
  - Install UX: `/plugin marketplace add <owner>/<repo>` then `/plugin install <plugin>@<owner|marketplace-name>`.
  - `source` is a repo-relative path starting with `./` (plugins live under `plugins/<name>/`). Repo must be **public**.
  - **HARD RULE (stated repeatedly):** description + keywords + version must be kept in sync across `marketplace.json` ↔ `plugin.json` ↔ plugin `README.md`. "A plugin is NOT complete until registered in marketplace.json."
  - Trigger language (`PROACTIVELY activate for: (1)...(N). Provides: ...`) is embedded **directly in the marketplace `description`** field, not just plugin.json.
- **Source path:** `.claude-plugin/marketplace.json`; `plugins/plugin-master/skills/plugin-master/references/publishing-guide.md`
- **Quality:** 5 — clean, real, multi-plugin.
- **Recommendation:** adapt (use schema as-is; we likely ship one plugin first, but the registry layout is the marketplace path).

### 2. plugin.json manifest schema + field rules → maps to our `pbi-mcp-ts/.claude-plugin/plugin.json`
- **What/why:** Complete field-by-field manifest spec with the exact type-mistakes that break loading.
- **Key content (reusable):**
  ```json
  {
    "name": "plugin-name",            // REQUIRED, kebab-case, 3-50 chars, unique
    "version": "1.0.0",               // STRING not number
    "description": "Complete X expertise. PROACTIVELY activate for: (1)... Provides: ...",  // aim <500 chars
    "author": { "name": "Name", "email": "...", "url": "..." },  // OBJECT not string
    "homepage": "https://.../tree/main/plugins/plugin-name",
    "repository": "https://github.com/owner/repo",  // STRING url
    "license": "MIT",
    "keywords": ["...", "..."]        // ARRAY not string; 5-15 items
  }
  ```
  - **Do NOT include `agents`, `skills`, `slashCommands`** — these are AUTO-DISCOVERED from `agents/`, `skills/*/SKILL.md`, `commands/`. (Optional `commands`/`agents`/`hooks`/`mcpServers` keys exist only to add *extra* dirs/files; defaults always load.)
  - Optional `mcpServers` can be inline in plugin.json OR in a separate `.mcp.json` (see #6).
  - Consistent layout confirmed across all 5 in-scope manifests (adf/powerbi/tsql/ssdt + plugin-master). Minor inconsistencies to AVOID copying: `ssdt-master` omits `homepage`/`repository`; `adf-master` uses prose ("This plugin should be used for...") instead of the stronger `PROACTIVELY activate for: (N)` enumeration.
- **Source path:** `plugins/plugin-master/skills/plugin-master/references/manifest-reference.md`; `plugins/*/.claude-plugin/plugin.json`
- **Quality:** 5
- **Recommendation:** adopt-as-is.

### 3. Consistent `*-master` plugin directory layout → maps to our pbi-mcp-ts internal structure
- **What/why:** Every plugin uses the identical tree. This is our packaging template.
- **Key content (reusable):**
  ```
  plugins/<name>/
  ├── .claude-plugin/plugin.json   # REQUIRED, must be inside .claude-plugin/
  ├── agents/<domain>-expert.md    # ONE expert agent (agent-first design)
  ├── commands/*.md                # 0-2 only (automation workflows)
  ├── skills/<skill-name>/
  │   ├── SKILL.md                 # core (1.5-2k words)
  │   ├── references/*.md          # detailed docs (2-5k+ words each)
  │   ├── examples/*.md            # working code
  │   └── scripts/*                # executable utilities
  ├── hooks/hooks.json             # optional event automation
  ├── .mcp.json                    # optional MCP server config
  ├── scripts/*.sh                 # plugin-level helper/validator scripts
  ├── LICENSE                      # required (MIT for consistency)
  └── README.md                    # required (Components tables: agent/skills/commands/scripts)
  ```
  - **Agent-first design (MANDATORY convention):** primary interface is ONE expert agent named `{domain}-expert` (`docker-master` → `docker-expert`); commands kept to 0-2; "users interact conversationally, not through command menus." For us: a `pbi-expert` agent is the front door; the MCP tools + thin-CRUD skills are what it orchestrates.
  - README uses standard tables (Agent | Skills | Commands | Scripts) + Installation (marketplace-first then local) + "What's New in vX" changelog section.
- **Source path:** `<directory_structure>` (lines 44-246); `plugins/plugin-master/README.md`; `CONTRIBUTING.md`
- **Quality:** 5
- **Recommendation:** adopt-as-is.

### 4. Lean-orchestrator agent + skill-activation table → maps to our `pbi-expert` agent
- **What/why:** THE most directly transferable pattern. `powerbi-expert.md` is a real, multi-skill orchestrator we can mirror structurally (taking the shape, not the PBI prose). Keeps the agent body small and pushes domain knowledge into skills (= our shared-knowledge + thin-CRUD skills + MCP tools).
- **Key content (reusable shape):**
  - Frontmatter: `name`, `model: inherit`, `color`, `tools:` (least-privilege list incl. `Skill`), and `description: |` containing `PROACTIVELY activate for: (1)...(N). Provides: ...` plus **4-7 `<example>` blocks** (Context / user quote / 1-2 sentence assistant reply / `<commentary>Triggers for kw1, kw2</commentary>`).
  - Body sections (the orchestrator): `## Skill Activation - CRITICAL` (a **Topic → Skill-to-load table**), `## Core Responsibilities`, `## Process`, `## Quality Standards`, `## Output Format`.
  - **Skill-activation table with disambiguation** (verbatim pattern worth copying): rows map a topic phrase to one skill; ambiguous keywords get an inline tiebreak, e.g. *"for TMDL-specific questions, prefer tmdl-mastery"* / *"TMDL editing/syntax → tmdl-mastery; TMDL in pipelines → programmatic-development."*
  - **Self-Validation Protocol** (highly relevant — pbi-mcp-ts already has a validator hook): a body section that says the agent always validates artifacts it generates before recommending deploy, with a "You generated X → Validate with Y" table, a 3-part validation **response format** (artifact / validation command / known-limitations of static checks), and a crucial guardrail: *"validation as a quality gate, not a ceremony — do NOT add validation boilerplate to every response."* This is a clean model for how our agent should pair generation with our hook/validator and BPA/dax-reference checks.
  - **Lean-orchestrator size limits** + "what belongs / does NOT belong" (anti-duplication is the #1 mistake): agent body = role identity + skill table + high-level process + output format + brief 2-3 sentence summaries. NOT detailed domain knowledge, full CLI/API refs, code, or anything duplicated from skills. "Agent body says 'load skill X' and keeps a 1-sentence summary."
- **Source path:** `plugins/powerbi-master/agents/powerbi-expert.md`; `plugins/plugin-master/skills/agent-development/SKILL.md`; `plugins/plugin-master/agents/plugin-expert.md`
- **Quality:** 5
- **Recommendation:** adapt (mirror the structure: skill-activation table + self-validation protocol; substitute our skills/MCP-tools/hook).

### 5. SKILL.md authoring + progressive disclosure → maps to our pipeline/shared-knowledge/thin-CRUD skills
- **What/why:** Exact rules for skill frontmatter and 3-tier loading — governs how we write every skill so it triggers reliably and stays context-cheap.
- **Key content (reusable):**
  - Three-tier loading: (1) metadata name+description always in context (~100 words), (2) SKILL.md body loaded on trigger (1.5-2k words, 3k hard max), (3) `references/` loaded only when needed (2-5k+ words each).
  - Frontmatter (canonical): `name:` MUST match directory name; `description:` MUST contain BOTH `PROACTIVELY activate for: (1)...(N)` enumeration AND `Provides: ...`. Prefer single-line description, <~800 chars. Enumerate **concrete named triggers**, describe **WHEN not WHAT**, third-person/imperative voice.
  - Body: imperative/infinitive voice ("Configure the server", not "You should configure"); structure = `# Title / ## Overview / ## Quick Reference (tables) / ## Core Content / ## Additional Resources` (pointers to references/examples).
  - Size enforcement: if >2k words, extract reference material to `references/`; if still >3k, split into two skills. Never leave a section in SKILL.md "just because it was written there first."
  - **No duplication**: never repeat a table/block within one SKILL.md; info lives in SKILL.md OR references/, never both; cross-cutting boilerplate (Windows paths, docs policy) goes in the agent body or ONE shared reference, never copied into each skill.
  - Resource dir semantics: `references/` (docs Claude reads), `examples/` (code users copy), `scripts/` (executed, not loaded into context — token-efficient), `assets/` (used in output, not read).
  - Component-pattern templates for agents (expert/validator/generator), commands (simple/interactive/workflow — note `argument-hint:` and `allowed-tools:` frontmatter), skills, hooks, MCP.
- **Source path:** `plugins/plugin-master/skills/skill-development/SKILL.md`; `plugins/plugin-master/skills/plugin-master/SKILL.md`; `.../references/component-patterns.md`
- **Quality:** 5
- **Recommendation:** adopt-as-is.

### 6. MCP server packaging inside a plugin → maps to DIRECTLY to our pbi-mcp-ts MCP server
- **What/why:** We ship an MCP server; this shows the exact, portable way to declare it from a plugin (Node/stdio is our case).
- **Key content (reusable):**
  - Declare via `.mcp.json` at plugin root OR inline `mcpServers` in plugin.json:
    ```json
    { "mcpServers": {
        "pbi-mcp": {
          "command": "node",
          "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"],
          "env": { "CONFIG_PATH": "${CLAUDE_PLUGIN_ROOT}/config.json" }
    } } }
    ```
  - **`${CLAUDE_PLUGIN_ROOT}` is mandatory** for every internal path (script args, configs) — never hardcode absolute paths; this is the portability mechanism.
  - Transports: stdio (default, our case), `"type": "sse"`/`"http"` with `url`. Secrets via `env` `${VAR}` interpolation — never hardcode keys.
  - Node SDK skeleton present (`@modelcontextprotocol/sdk` Server + StdioServerTransport, `tools/list` + `tools/call` handlers) — reference-only since we already have a server; useful as a sanity check of the wiring.
  - Verify with `/mcp` command; debug with `claude --debug`.
- **Source path:** `plugins/plugin-master/skills/advanced-features-2025/references/mcp-patterns.md`; `.../SKILL.md`; `.../references/component-patterns.md`
- **Quality:** 5 (config) / 3 (Node SDK snippet is slightly dated API)
- **Recommendation:** adopt-as-is (config); reference-only (server code).

### 7. hooks.json schema + plugin-vs-settings format → maps to our `hooks/hooks.json` (validator hook)
- **What/why:** pbi-mcp-ts already has a validator hook; this is the authoritative schema and the one gotcha that breaks plugin hooks.
- **Key content (reusable):**
  - **CRITICAL format difference:** a *plugin* `hooks/hooks.json` wraps events: `{ "hooks": { "PreToolUse": [...] } }`. A *user settings* `.claude/settings.json` puts events at top level: `{ "PreToolUse": [...] }`. Mixing these = hooks silently don't load.
  - Hook entry: `{ "matcher": "Write|Edit", "hooks": [{ "type": "command"|"prompt", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/x.sh", "timeout": 10, "description": "..." }] }`.
  - Events: PreToolUse, PostToolUse, SessionStart, SessionEnd, UserPromptSubmit, PreCompact, Notification, Stop, SubagentStop. Matchers are case-sensitive regex; avoid `.*`/`*`.
  - Command-hook exit codes: 0 = success (stdout in transcript); 2 = blocking error (stderr fed back to Claude); other = non-blocking. PreToolUse can also return `hookSpecificOutput.permissionDecision: allow|deny|ask` + `updatedInput`. Stop/SubagentStop return `decision: approve|block` + `reason`.
  - Hook input arrives on **stdin as JSON** (`tool_name`, `tool_input.file_path`, etc.); env vars `$CLAUDE_PLUGIN_ROOT`, `$CLAUDE_PROJECT_DIR`, `$CLAUDE_ENV_FILE` (SessionStart can persist `export VAR=...` to `$CLAUDE_ENV_FILE`). Prompt hooks access `$TOOL_INPUT`, `$TOOL_RESULT`, `$USER_PROMPT`.
  - Lifecycle gotcha: **hooks load at session start** — editing hooks.json/scripts requires a Claude Code restart; all matching hooks run **in parallel** (design for independence). Secure script template: `set -euo pipefail`, read `input=$(cat)`, `jq -r '.tool_input.file_path'`, validate path/block traversal+secrets, quote all vars.
  - Prompt-based hooks (LLM-driven, `"type": "prompt"`) recommended for context-aware checks; command hooks for fast deterministic checks (lint/test/format/dangerous-command-block — full working scripts provided).
- **Source path:** `plugins/plugin-master/skills/hook-development/SKILL.md`; `.../advanced-features-2025/references/hooks-advanced.md`; `.../examples/hook-scripts.md`
- **Quality:** 5
- **Recommendation:** adopt-as-is.

### 8. Triggering-reliability anti-pattern catalog + greppable audit → maps to our pre-ship QA / a `/validate-plugin`-style check
- **What/why:** This is the highest-leverage quality content: a catalog of every mistake that makes agents/skills fail to trigger, each with root cause, fix, and a one-line grep to detect it. We should run this audit before shipping pbi-mcp-ts.
- **Key content (reusable) — the audit greps (run from repo root):**
  ```bash
  # P0: skills with no YAML frontmatter (start with # not ---) -> never discovered
  for f in skills/*/SKILL.md; do head -1 "$f" | grep -q "^---" || echo "NO FRONTMATTER: $f"; done
  # P0: deprecated agent: true with no name:
  grep -rn "^agent: true" agents/*.md
  # P1: agents missing <example> blocks
  for f in agents/*.md; do grep -q "<example>" "$f" || echo "NO EXAMPLES: $f"; done
  # P1: skills missing PROACTIVELY activate for: enumeration
  for f in skills/*/SKILL.md; do head -20 "$f" | grep -q "PROACTIVELY activate for:" || echo "NO ENUMERATION: $f"; done
  # P1: skills missing Provides: list
  for f in skills/*/SKILL.md; do head -20 "$f" | grep -q "Provides:" || echo "NO PROVIDES: $f"; done
  # P2: agents missing model: inherit
  for f in agents/*.md; do head -20 "$f" | grep -q "^model: inherit" || echo "NO MODEL INHERIT: $f"; done
  # P0: cross-cutting boilerplate poisoning YAML descriptions
  grep -rn "MANDATORY: Always Use Backslashes\|NEVER create new documentation files" agents/*.md skills/*/SKILL.md
  ```
  - The 9 anti-patterns: (1) zero-frontmatter skill, (2) `agent: true` w/o `name:`, (3) abstract "Use this agent for X", (4) description says WHAT not WHEN, (5) no `<example>` blocks, (6) Windows/docs boilerplate inside YAML `description:` (poisons routing → over-triggers), (7) missing/hardcoded `model:` (use `inherit`), (8) trigger-phrase overlap between sibling skills, (9) description too long/too many triggers (>800 chars, 15+ triggers → split skill).
  - Fix priority: P0 = invisible/broken (zero-frontmatter, `agent:true`, YAML boilerplate); P1 = missing examples / missing enumeration; P2 = metadata hygiene + overlap. "Do not spend time on P2 while P0 bugs exist."
  - **Skill-coverage rule:** every skill the agent delegates to MUST have ≥1 `<example>` that routes to it (count skills vs examples). If >7 skills, combine related skills into shared examples that mention both domains.
- **Source path:** `plugins/plugin-master/skills/triggering-reliability/SKILL.md`; `plugins/plugin-master/commands/validate-plugin.md`
- **Quality:** 5
- **Recommendation:** adopt-as-is (run as a pre-ship gate; consider porting into our own validator/hook).

### 9. Reusable validation bash scripts → maps to our `scripts/` (CI + pre-commit gate)
- **What/why:** Three drop-in validators (plugin/agent/skill) we can adapt (swap the `python -c json.load` checks for `node -e`). Colored output, exit 0/1, designed for pre-commit + CI + manual use.
- **Key content (what each checks):**
  - `validate-plugin.sh <path>`: plugin.json exists at `.claude-plugin/`, valid JSON, name kebab-case, author=object, version=semver string, keywords=array, warns on deprecated `agents`/`skills` keys, counts agents/commands/skills and checks each has frontmatter, validates hooks.json JSON.
  - `validate-agent.sh <file>`: frontmatter present; `name` (3-50, lowercase-hyphen); `description` present + counts `<example>` blocks (≥2); `model` ∈ {inherit,sonnet,opus,haiku}; `color` ∈ {blue,cyan,green,yellow,magenta,red}; **example-count ≥ skill-count** coverage check; body length sanity (100–10000 chars).
  - `validate-skill.sh <dir>`: SKILL.md exists + frontmatter; `name`; `description` with ≥5 quoted trigger phrases; **word count gates (warn >2000, error >3000)**; Quick Reference present; references/examples/scripts dirs detected; scripts executable.
- **Source path:** `plugins/plugin-master/scripts/{validate-plugin,validate-agent,validate-skill}.sh`; `plugins/plugin-master/scripts/README.md`
- **Quality:** 4 (Python-dependency for JSON checks; trivially swappable to node — we're Node/TS)
- **Recommendation:** adapt.

### 10. Size-limit table + content-quality checks → maps to our authoring standards / CONTRIBUTING
- **What/why:** Hard numeric budgets that prevent context bloat — a concise rubric we can put in our own CONTRIBUTING/CLAUDE.md.
- **Key content (verbatim limits):**
  | Component | Limit | Action if exceeded |
  |---|---|---|
  | plugin.json description | ~500 chars | condense; rely on keywords |
  | Skill description | ~500 chars (≤~800 hard) | third person + specific triggers |
  | SKILL.md body | 1500-2000 words (3000 max) | split into SKILL.md + references/ |
  | Agent body | 1500-2500 words (3000 max) | lean orchestrator — delegate to skills |
  | references/ files | 2000-5000+ words each | acceptable; detailed content belongs here |
  - 6 content-quality checks before ship: (1) ≥5 trigger phrases per skill incl. synonyms/abbrevs/problem-terms users actually type, (2) no SKILL.md >3000 words, (3) no intra-file duplication, (4) every skill has an agent example, (5) no keyword claimed by 2 skills without disambiguation, (6) synonym coverage ("slow report" not just "performance optimization").
  - Housekeeping: delete working files (.bak/draft/summary) before ship; sync README with actual `commands/`; cross-cutting platform rules live in ONE place.
- **Source path:** `plugins/plugin-master/agents/plugin-expert.md`; `plugins/plugin-master/commands/{create,validate}-plugin.md`
- **Quality:** 5
- **Recommendation:** adopt-as-is.

### 11. Repo-level conventions: CONTRIBUTING, version sync, team distribution → maps to our repo governance
- **What/why:** Marketplace-quality repo hygiene we can lift for pbi-mcp-ts's repo.
- **Key content (reusable):**
  - **Version management discipline (root CLAUDE.md):** "NEVER manually edit plugin versions" — a `version_ops.py` script bumps patch/minor/major and keeps marketplace.json ↔ plugin.json in sync (`--validate`, `--sync`). NOTE: this script itself is **not in the pack** (referenced only) — we'd build our own. The *principle* (single source of truth, automated sync, semver: patch=fix/docs, minor=new skill/agent, major=breaking) is the takeaway.
  - **CONTRIBUTING.md** template: required structure, required files (plugin.json + README + LICENSE), step-by-step add-a-plugin guide, PR checklist (valid syntax, kebab name, author object, version string, keywords array, no auto-discovered fields, every agent has frontmatter+name+model:inherit+example, every skill has frontmatter+PROACTIVELY+Provides, registered in marketplace.json, versions match), and a PR template. Privacy rule: use `username@users.noreply.github.com` no-reply emails; never commit secrets.
  - **Team distribution** via repo `.claude/settings.json`: `{ "extraKnownMarketplaces": ["owner/repo"], "plugins": { "enabled": ["plugin@owner"] } }` → teammates auto-install on folder-trust. Spec format `plugin-name@marketplace-owner`. Relevant if pbi-mcp-ts is rolled out to a data team.
- **Source path:** `CLAUDE.md`; `CONTRIBUTING.md`; `README.md`; `plugins/plugin-master/skills/advanced-features-2025/references/team-distribution.md`
- **Quality:** 5 (docs) / N/A (version_ops.py absent)
- **Recommendation:** adapt.

## Cross-source overlap flags
- **Manifest/packaging vs awesome-copilot / ruiromano / data-goblin:** This source is the *authoritative* one for the **Claude Code plugin** manifest (`plugin.json`/`marketplace.json`/`.mcp.json`/`hooks.json` schemas, `${CLAUDE_PLUGIN_ROOT}`, auto-discovery). awesome-copilot is the *VS Code Copilot* `.github/*.md` ecosystem — different runtime; treat its packaging as NON-authoritative for our manifests (only its skill *content* patterns may overlap). Where data-goblin/ruiromano findings describe PBI domain content, they complement (not conflict with) this source — this one owns STRUCTURE, they own DOMAIN.
- **Agent-frontmatter `<example>` + PROACTIVELY/Provides convention** likely also surfaces in other Claude-skill sources (claude-skills-borghei, agent-skills, antigravity-awesome-skills). This source's **triggering-reliability catalog + greppable audit** is probably the most rigorous treatment — prefer it as the canonical reference and dedupe others against it.
- **Lean-orchestrator + skill-activation table** (powerbi-expert) overlaps conceptually with any "router agent" patterns in the agentic-plugins sources; this one is concrete and PBI-shaped, so it's our primary template — reconcile other router patterns into it rather than vice-versa.
- **Self-Validation Protocol** (powerbi-expert) overlaps with our existing validator hook + dax-reference-check/bind-validator work — align the agent's "validate-what-you-generate, but not as ceremony" guidance with our hook so we don't double-validate.

## Discarded / not relevant
- **All PBI/Fabric/DAX/TMDL/PBIR domain skill content** under `plugins/powerbi-master/skills/**` (dax-mastery, tmdl-mastery, power-query-m, programmatic-development, validation-testing reference bodies, etc.) — explicitly the sibling agent's scope; I took only the *agent shell structure*, not the knowledge.
- **tsql-master, ssdt-master, adf-master skill/command/reference bodies** (T-SQL optimization, SqlPackage, ADF pipeline JSON, ML patterns, DMV queries, .ps1/.sql scripts) — unrelated domain content; used their `plugin.json` only as layout-consistency evidence.
- **`windows-git-bash-compatibility` / `windows-git-bash-paths` skills** and Windows MINGW path content — environment-specific to those plugins; we're a cross-platform Node/TS project and would handle paths via `${CLAUDE_PLUGIN_ROOT}` + Node, not copy this boilerplate (and the catalog itself warns against putting such boilerplate in descriptions).
- **The ~20 other marketplace.json entries** (bash/git/docker/terraform/react/nextjs/cloudflare/modal/fal-ai/unity/viral-video/stripe/etc.) — read only to confirm the registry schema; their domains are irrelevant.
- **Marketing/`README` plugin catalog prose** — kept only the install-command + Components-table conventions.
- **NOT IN PACK (gap, not discarded):** root `scripts/version_ops.py` and `scripts/CLAUDE.md` are referenced by root CLAUDE.md but were not included in this repomix scope — only per-plugin `scripts/` were packed. We'd implement version-sync ourselves.
