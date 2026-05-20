# Mining findings: awesome-copilot — meta/authoring/hooks
Source: awesome-copilot-meta.xml

## Relevance summary
High-value source for our authoring/manifest/hooks concerns. It ships 6 production-grade safety/audit hooks (tool-guardian, secrets-scanner, governance-audit map almost 1:1 to our block-destructive-commands / block-secrets-exposure / PreToolUse-gate hooks), plus the canonical CONTRIBUTING.md + AGENTS.md that define exact frontmatter schemas, naming rules, validation tooling, and a quality bar ("no meaningful uplift over the base model" — directly supports our HIGH relevance bar). Critically, this repo's plugins use the **Claude Code plugin spec** (`plugin.json` with `agents`/`commands`/`skills` arrays + Claude Code marketplace `source` entries), so the manifest conventions are directly adoptable; the hooks.json format is **GitHub Copilot CLI's** schema (different event names + shape from Claude Code), so hook *config* is reference-only while hook *logic* (the .sh threat/secret scanners) is fully reusable.

## High-value extractions

### Tool Guardian hook → maps to our block-destructive-commands (PreToolUse gate)
- What it is: a `preToolUse` hook that reads the tool invocation JSON on stdin, scans `toolName`+`toolInput` against ~20 regex threat patterns in 6 categories, and blocks (exit 1) or warns. The standout quality pattern: **every blocked pattern ships a safer-alternative suggestion**, and findings are emitted both as a human table and a JSON Lines audit log. This is the single most directly reusable hook for us.
- Key content — the threat pattern table (delimiter `:::` to avoid clashing with regex `|`), `"CATEGORY:::SEVERITY:::REGEX:::SUGGESTION"`:
```
# Destructive file operations
"destructive_file_ops:::critical:::rm -rf /:::Use targeted 'rm' on specific paths instead of root"
"destructive_file_ops:::critical:::rm -rf ~:::Use targeted 'rm' on specific paths instead of home directory"
"destructive_file_ops:::critical:::(rm|del|unlink).*\.env:::Use 'mv' to back up .env files before removing"
"destructive_file_ops:::critical:::(rm|del|unlink).*\.git[^i]:::Never delete .git directory — use 'git' commands"
# Destructive git operations
"destructive_git_ops:::critical:::git push --force.*(main|master):::Use 'git push --force-with-lease' or a feature branch"
"destructive_git_ops:::critical:::git push -f.*(main|master):::Use 'git push --force-with-lease' or a feature branch"
"destructive_git_ops:::high:::git reset --hard:::Use 'git stash' to preserve changes, or 'git reset --soft'"
"destructive_git_ops:::high:::git clean -fd:::Use 'git clean -n' (dry run) first to preview"
# Database destruction
"database_destruction:::critical:::DROP TABLE:::Use 'ALTER TABLE' or a migration with rollback support"
"database_destruction:::critical:::DROP DATABASE:::Create a backup first; consider revoking DROP privileges"
"database_destruction:::critical:::TRUNCATE:::Use 'DELETE FROM ... WHERE' with a condition"
"database_destruction:::high:::DELETE FROM [a-zA-Z_]+ *;:::Add a WHERE clause to avoid deleting all rows"
# Permission abuse / Network exfiltration / System danger
"permission_abuse:::high:::chmod 777:::Use 'chmod 755' for dirs or 'chmod 644' for files"
"network_exfiltration:::critical:::curl.*\|.*bash:::Download the script first, review it, then execute"
"network_exfiltration:::critical:::wget.*\|.*sh:::Download the script first, review it, then execute"
"system_danger:::high:::sudo :::Avoid 'sudo' — run with least privilege"
"system_danger:::high:::npm publish:::Use 'npm publish --dry-run' first"
```
- Reusable engineering bits: stdin JSON parsed with `jq` if available, regex/sed fallback otherwise (zero hard dep); env-var controls `GUARD_MODE` (warn|block, default block), `SKIP_TOOL_GUARD`, `*_ALLOWLIST` (comma-separated, checked first to short-circuit), `*_LOG_DIR`; `json_escape()` helper; structured `guard.log` JSONL records `{event:"threats_detected"|"guard_passed", tool, threat_count, threats:[...]}`. 10s timeout.
- Source path: `hooks/tool-guardian/{guard-tool.sh,hooks.json,README.md}`
- Quality: 5 — clean, dependency-light, allowlist + warn/block modes + per-pattern remediation is exactly the UX we want.
- Recommendation: **adapt** — port the pattern table + warn/block/allowlist + suggestion UX into our block-destructive-commands hook. NOTE: for our pnpm-discipline hook, swap `npm publish` for pnpm equivalents and add `npm install`/`npx` patterns. Translate stdin schema: Claude Code PreToolUse passes `tool_name`/`tool_input` (object) not Copilot's `toolName`/`toolInput` (string).

### Secrets Scanner hook → maps to our block-secrets-exposure
- What it is: scans modified/staged files at `sessionEnd` against 20+ secret regexes; warn or block; redacts matches in logs (first4...last4); skips placeholders; allowlist support; zero deps (grep/file/git).
- Key content — the PATTERNS array (`"NAME|SEVERITY|REGEX"`), reusable as-is:
```
"AWS_ACCESS_KEY|critical|AKIA[0-9A-Z]{16}"
"AWS_SECRET_KEY|critical|aws_secret_access_key[[:space:]]*[:=][[:space:]]*['\"]?[A-Za-z0-9/+=]{40}"
"GCP_API_KEY|high|AIza[0-9A-Za-z_-]{35}"
"AZURE_CLIENT_SECRET|critical|azure[_-]?client[_-]?secret[[:space:]]*[:=][[:space:]]*['\"]?[A-Za-z0-9_~.-]{34,}"
"GITHUB_PAT|critical|ghp_[0-9A-Za-z]{36}"   (also gho_/ghs_/ghr_ + github_pat_[..]{82})
"PRIVATE_KEY|critical|-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----"
"GENERIC_SECRET|high|(secret|token|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|client[_-]?secret)[[:space:]]*[:=][[:space:]]*['\"]?[A-Za-z0-9_/+=~.-]{8,}"
"CONNECTION_STRING|high|(mongodb(\\+srv)?|postgres(ql)?|mysql|redis|amqp|mssql)://[^[:space:]'\"]{10,}"
"SLACK_TOKEN|high|xox[baprs]-[0-9]{10,}-[0-9A-Za-z-]+"
"STRIPE_SECRET_KEY|critical|sk_live_[0-9A-Za-z]{24,}"
"NPM_TOKEN|high|npm_[0-9A-Za-z]{36}"
"JWT_TOKEN|medium|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
```
- Two quality patterns worth copying: (1) **placeholder suppression** — skip any match matching `(example|placeholder|your[_-]|xxx|changeme|TODO|FIXME|replace[_-]?me|dummy|fake|test[_-]?key|sample)`; (2) **redaction before logging** so the audit log never re-leaks the secret; (3) skips lock files (`*.lock`, `package-lock.json`, `pnpm-lock.yaml`, etc.) and binary files via `file --mime-type`. Env: `SCAN_MODE` warn|block, `SCAN_SCOPE` diff|staged (staged scans `git show :file` index content), `SECRETS_ALLOWLIST`.
- Source path: `hooks/secrets-scanner/{scan-secrets.sh,hooks.json,README.md}`
- Quality: 5
- Recommendation: **adapt** — reuse the PATTERNS array + placeholder/redaction logic verbatim. For Claude Code, run as a PreToolUse(Write|Edit) gate (block before write) and/or a Stop hook, rather than Copilot's `sessionEnd`. Keep `SCAN_MODE=block` for our use.

### Governance Audit hook → maps to our PreToolUse gate + prompt-injection defense
- What it is: a 3-script bundle (`sessionStart`/`sessionEnd`/`userPromptSubmitted`) that scans the *user prompt* (not just tool calls) for prompt-injection / exfiltration / privilege-escalation signals, with severity scores (0.0-1.0) and **tiered governance levels** open|standard|strict|locked controlling block behavior. Complements tool-guardian by covering a different surface (the prompt).
- Key content — prompt-injection patterns (a surface our gate hooks don't yet cover):
```
"ignore\s+(previous|above|all)\s+(instructions?|rules?|prompts?)"  prompt_injection 0.9
"you\s+are\s+now\s+(a|an)\s+(assistant|ai|bot|system|expert|language\s+model)\b"  prompt_injection 0.7
"(^|\n)\s*system\s*:\s*you\s+are"  prompt_injection 0.6
"send\s+(all|every|entire)\s+\w+\s+to\s+"  data_exfiltration 0.8
"upload\s+.*\s+(credentials|secrets|keys)"  data_exfiltration 0.95
```
- Privacy pattern worth copying: **never log full prompts** — only base64-encoded minimal evidence snippets + metadata (avoids re-injection / leakage via the log). Governance levels table: open=log only; standard=block if `BLOCK_ON_THREAT=true`; strict/locked=always block.
- Source path: `hooks/governance-audit/{audit-prompt.sh,audit-session-start.sh,audit-session-end.sh,hooks.json,README.md}`
- Quality: 4 — heavier (needs jq+bc), but the prompt-injection layer + tiered levels are a good model.
- Recommendation: **reference-only / adapt-later** — our safety set doesn't currently have a prompt-injection gate; the pattern set + the "tiered level" config knob and base64-evidence privacy trick are worth lifting if we add a UserPromptSubmit hook.

### hooks.json shape + hook-folder layout convention → reference-only (Copilot format ≠ Claude Code)
- What it is: every hook is a folder = `README.md` (with frontmatter) + `hooks.json` + scripts; install by copying to `.github/hooks/`; scripts must be `chmod +x`; logs dir gitignored.
- Key content — Copilot CLI hooks.json schema (NOTE: NOT Claude Code's schema):
```json
{ "version": 1,
  "hooks": {
    "preToolUse": [ { "type": "command", "bash": "hooks/tool-guardian/guard-tool.sh",
                      "cwd": ".", "env": { "GUARD_MODE": "block" }, "timeoutSec": 10 } ] } }
```
  Copilot events: `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`.
- Source path: `hooks/*/hooks.json`, `docs/README.hooks.md`, `AGENTS.md`
- Quality: 3 (for us) — structurally analogous to Claude Code hooks but field names differ (`bash`/`timeoutSec`/`type:"command"`/camelCase events vs Claude Code's `command`/`timeout`/`matcher` + `PreToolUse`/`PostToolUse`/`UserPromptSubmit`/`SessionStart`/`Stop`).
- Recommendation: **reference-only** — keep our existing Claude Code `hooks/hooks.json` format; borrow only the folder-layout discipline (one folder per hook + README frontmatter + bundled script + JSONL log + gitignored log dir).

### plugin.json (Claude Code spec) + marketplace.json conventions → maps to our .claude-plugin/plugin.json + marketplace.json
- What it is: plugins declare content **declaratively** with Claude Code spec fields; marketplace.json is auto-generated from all plugins. THIS IS OUR FORMAT — directly adoptable.
- Key content — plugin.json (Claude Code spec):
```json
{ "name": "my-plugin-id", "description": "Plugin description", "version": "1.0.0",
  "keywords": [], "author": { "name": "..." },
  "repository": "https://github.com/...", "license": "MIT",
  "agents":   ["./agents/my-agent.md"],
  "commands": ["./commands/my-command.md"],
  "skills":   ["./skills/my-skill/"] }
```
  Plugin folder layout: `plugins/<id>/.github/plugin/plugin.json` + `README.md`. Rules: `name` must match folder; `description` + semver `version` required; every path in `agents`/`commands`/`skills` must resolve to a real file; **instructions are NOT part of plugins** (standalone). Validate with `npm run plugin:validate`.
- Key content — marketplace.json (top-level + per-entry, Claude Code marketplace spec):
```json
{ "name": "awesome-copilot",
  "metadata": { "description": "...", "version": "1.0.0", "pluginRoot": "./plugins" },
  "owner": { "name": "GitHub", "email": "copilot@github.com" },
  "plugins": [
    { "name": "power-bi-development", "source": "power-bi-development",
      "description": "...", "version": "1.0.0" },                 // local entry
    { "name": "ext", "description": "...", "version": "1.0.0",     // remote/github entry
      "author": {"name":"...","url":"..."}, "license": "MIT",
      "keywords": ["lowercase-hyphenated"], "repository": "https://github.com/owner/repo",
      "source": { "source": "github", "repo": "owner/repo",
                  "path": ".github/plugin", "ref": "v1.0.0" } } ] }
```
  Local plugins use a string `source` (folder name); remote use a `source` object with `source:"github"`, `repo` (owner/repo), `path`, immutable `ref` (release tag or full SHA — never a branch). External entries additionally require `license` + `keywords` (lowercase-hyphenated). Spec ref cited: `code.claude.com/docs/en/plugin-marketplaces#plugin-entries`.
- Source path: `.github/plugin/marketplace.json`, `CONTRIBUTING.md` (Adding Plugins), `AGENTS.md` (Plugin Folders)
- Quality: 5 — authoritative, matches our distribution model.
- Recommendation: **adopt-as-is** for field shapes — model our `.claude-plugin/plugin.json` and `marketplace.json` on these. Use `keywords` (lowercase-hyphenated), `pluginRoot`, immutable `ref`. Our plugin bundles subagents+skills+hooks+MCP; mirror the `agents`/`skills`/`commands` arrays (note: hooks/MCP are configured separately, not in these arrays).

### Frontmatter schemas + naming + validation rules (all primitives) → maps to our SKILL.md / agent / hook authoring conventions
- What it is: the precise required/recommended frontmatter fields per primitive, with hard constraints, plus the canonical PR checklists. Core authoring reference.
- Key content (from AGENTS.md "Development Workflow" + CONTRIBUTING checklists):
  - **Skills** (`skills/<name>/SKILL.md`): `name` lowercase-hyphenated, **matches folder name, ≤64 chars**; `description` single-quoted, **10–1024 chars**, non-empty; folder lowercase-hyphenated; bundled assets <5MB each and referenced from SKILL.md; progressive disclosure (loaded on demand); follows agentskills.io/specification. Scaffold `npm run skill:create -- --name <n>`, validate `npm run skill:validate`.
  - **Agents** (`*.agent.md`): `description` (single-quoted) required; `tools` recommended; `model` strongly recommended; filename lowercase-hyphenated. Body template: persona ("You are an expert [domain]…") → `## Your Expertise` → `## Your Approach` → `## Guidelines` (constraints/limitations).
  - **Instructions** (`*.instructions.md`): `description` (single-quoted, non-empty) + **`applyTo`** glob (e.g. `'**.ts, **.tsx'`) required; filename lowercase-hyphenated.
  - **Hooks** (`hooks/<name>/README.md`): `name` (human-readable), `description` (single-quoted, non-empty), optional `tags`; must ship `hooks.json` (events extracted from it).
  - **Workflows** (`workflows/<name>.md`): `name` + `description` (single-quoted) + agentic frontmatter (`on`, `permissions`, `safe-outputs`); `.md` only.
- Description-craft observations (from real entries): descriptions are dense, third-person, lead with capability + scope + the value/uplift (e.g. "Expert Power BI DAX guidance using Microsoft best practices for performance, readability, and maintainability of DAX formulas") — good template for our autotrigger `description` fields. Skill/agent descriptions explicitly name the *trigger surface* and *what's specialized*.
- Source path: `AGENTS.md`, `CONTRIBUTING.md`
- Quality: 5
- Recommendation: **adopt-as-is** — enforce these exact constraints in our skills/agents (esp. SKILL.md `name`≤64 + matches-folder, `description` 10–1024 single-quoted; lowercase-hyphenated everywhere). Add a `skill:validate`-style check to our build/hooks.

### Quality bar / "What We Don't Accept" → maps to our HIGH relevance bar
- What it is: an explicit anti-pattern that mirrors our mining mandate to discard low-uplift domain content.
- Key content (paste-worthy rationale): *"**Duplicate Existing Model Strengths Without Meaningful Uplift** — Submissions that mainly tell Copilot to do work frontier models already handle well (e.g. generic TypeScript/HTML) without a clear gap, specialized workflow, or domain-specific constraint. These are lower value and can introduce weaker or conflicting guidance than the model's default behavior."* Plus Quality Guidelines: be specific (not generic), keep it focused (one technology/use-case per file), write clearly, test the content.
- Source path: `CONTRIBUTING.md` (What We Don't Accept; Quality Guidelines)
- Quality: 5
- Recommendation: **adopt-as-is** as an authoring principle — every PBI skill must encode a genuine domain constraint (TMDL/DAX/PBIR specifics, dataset-agnostic) the base model lacks, not restate general coding advice.

### Agentic-workflow structure → maps to our pipeline skills (multi-step orchestration)
- What it is: single-`.md` workflows with YAML frontmatter (`on` triggers, least-privilege `permissions`, `safe-outputs`) + natural-language body, compiled to `.lock.yml` via `gh aw compile`. The two relevance workflows are excellent templates for staged, schema-constrained agent tasks.
- Key content — the orchestration shape we should mirror in pipeline skills: a numbered phase sequence + a fixed output schema. `relevance-check.md` body = **`### 1. Gather Information` → `### 2. Evaluate Relevance` (explicit factor checklist) → `### 3. Provide Your Analysis` (fixed report template with enumerated verdict/recommendation values)**, ending with a hard constraint ("Do not make changes — your only action is to comment"). `relevance-summary.md` aggregates many per-item outputs into one table with `### Statistics`. Frontmatter safety pattern:
```yaml
permissions: { contents: read, issues: read, pull-requests: read }   # least privilege
safe-outputs: { add-comment: { max: 1 } }                            # constrained side-effects
```
- The `power-platform-architect` plugin README documents the same shape for a single skill: a 5-phase process (Requirements Analysis → Follow-Up Questions → Component Recommendation → Architecture Narrative → Optional Diagram) with a built-in decision framework + example prompts — a clean model for our pipeline SKILL.md prose.
- Source path: `workflows/relevance-check.md`, `workflows/relevance-summary.md`, `docs/README.workflows.md`, `plugins/power-platform-architect/README.md`
- Quality: 4 (workflows are GitHub-Actions-specific = reference-only for the runtime; the *structure* is 5/5).
- Recommendation: **adapt** — copy the "numbered phases + explicit factor checklist + fixed enumerated output schema + final hard-constraint line" structure into our pipeline skills. Don't adopt `gh aw`/Actions runtime.

### Domain plugin bundling pattern (power-bi-development) → maps to how WE bundle our plugin's contents
- What it is: a directly on-topic example of a Power BI Copilot plugin. Shows the README "What's Included" convention: separate tables for **Commands (slash)**, **Agents**, **Skills**, each invoked namespaced as `/<plugin-name>:<item-name>`.
- Key content: bundles 4 prompts (`/power-bi-development:power-bi-dax-optimization`, `…model-design-review`, `…performance-troubleshooting`, `…report-design-consultation`) + 4 agents (`power-bi-data-modeling-expert`, `power-bi-dax-expert`, `power-bi-performance-expert`, `power-bi-visualization-expert`). Install line: `copilot plugin install power-bi-development@awesome-copilot`. NOTE: this is prompt/agent-only guidance (no MCP/engine) — our plugin is materially deeper (engine + MCP + thin-CRUD skills), so this is a naming/packaging reference, not a content source.
- Source path: `plugins/power-bi-development/README.md`, `plugins/power-platform-architect/README.md`
- Quality: 3 (content) / 4 (packaging convention)
- Recommendation: **reference-only** — mirror the README "What's Included" tables + namespaced invocation naming; do not import its (shallow) domain content. Confirms naming taste for our PBI agents/skills.

## Cross-source overlap flags
- **Safety hooks**: tool-guardian (destructive cmds) + secrets-scanner overlap heavily with our existing block-destructive-commands / block-secrets-exposure and likely with safety-hook findings from other mined repos. When consolidating, prefer this repo's **per-pattern safer-alternative suggestions**, **placeholder-suppression + redaction**, and **warn/block + allowlist env knobs** as the merge target — they're the most polished versions seen.
- **Plugin/marketplace manifests**: this repo's plugin.json/marketplace.json are explicitly Claude Code spec (`code.claude.com/docs/en/plugin-marketplaces`). If other sources show divergent manifest shapes, treat THIS as canonical for our distribution since it matches our runtime.
- **pnpm discipline**: tool-guardian flags `npm publish` only; our block-pnpm-discipline hook is more specific. Cross-check with any pnpm-skill findings — extend the pattern table with `npm install`/`yarn add`/`npx` → pnpm-equivalent suggestions.
- **Pipeline/orchestration**: the "numbered phases + fixed output schema" pattern from relevance workflows + power-platform-architect overlaps with pipeline-skill structure expected from other repos (e.g. data-goblin). Consolidate into one canonical pipeline-SKILL.md skeleton.

## Discarded / not relevant
- ~55 domain plugin README listings (clojure, ember, phoenix, salesforce, java/kotlin/rust/swift/php/go/ruby MCP-dev, react18/19-upgrade, oracle→postgres, openapi-to-* generators, arize-ax, chrome-devtools, eyeball, napkin, etc.) — unrelated domains; only their *packaging shape* matters, captured generically above. Per HARD RULES (HIGH bar), discarded as content.
- `dependency-license-checker` hook — well-built (multi-ecosystem npm/pip/go/ruby/rust license detection), but license compliance is out of scope for a PBI authoring plugin. Logic noted as reference-only; not adopting.
- `session-auto-commit` / `session-logger` hooks — generic session automation (auto-commit+push, activity logging); not aligned with our safety/authoring focus. Skipped.
- OSPO/governance workflows (`ospo-contributors-report`, `ospo-org-health`, `ospo-release-compliance-checker`, `ospo-stale-repos`, `daily-issues-report`, `weekly-comment-sync`) — repo-maintenance automation in GitHub Actions; only `relevance-check`/`relevance-summary` were mined for their orchestration structure.
- `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, all-contributors/recognition sections, external-plugin issue-form review workflow (labels/`/approve` cadence, 6-month re-review) — GitHub-org process, not applicable to our plugin.
- Non-Node hook *implementations*: none — all 6 hooks are bash + optional jq, so portable; flagged that Copilot's hooks.json *schema* itself is reference-only vs Claude Code.
