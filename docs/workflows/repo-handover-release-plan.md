# Repo Handover and Release Plan

This document captures the working plan for moving `pbi-agent-kit` from personal development into the bank environment while keeping ownership, versioning, and future updates clear.

## Product Name

Use `pbi-agent-kit` as the repo/product name.

The repo is broader than a single MCP server. It contains:

- The AA CoE Power BI MCP wrapper.
- Skills and agents for governed Power BI workflows.
- Deterministic modeling checks and planners.
- Tests, scripts, and guardrails.
- Future room for report-layer capabilities.

## Ownership Model

AA CoE should own the official bank GitHub repo.

Digital teams can contribute, but through AA CoE-controlled issues, branches, and pull requests. AA CoE should own:

- Canonical GitHub repo.
- Main branch.
- Release approval.
- Security scan submission.
- Versioning.
- Architecture decisions.
- CODEOWNERS and contribution rules.

Digital can have:

- Read access.
- Issue access.
- Feature request access.
- PR contribution rights.
- Reviewer role where useful.

## Branch Model

Keep the branch model simple.

Long-lived branches:

```text
main
future/full-surface
feature/*
```

Use `main` as the latest official product state that the bank should see.

```text
main = latest bank-ready product line
```

Use tags as permanent release snapshots.

```text
v0.1.0
v0.2.0
v0.3.0
```

Do not use long-lived release branches unless the bank later requires a formal stabilization process.

## Full-Surface Backup

Before cleaning `main`, keep a branch that preserves the current broader work:

```text
future/full-surface
```

This branch can keep material that is not part of the first bank release, such as:

- Report-layer experiments.
- Archived skills and agents.
- Research/mining docs.
- Demo artifacts.
- Broader MCP/report surface.

Later, report-layer work can be brought back intentionally through:

```text
feature/report-layer
```

## Main Branch Policy

`main` should not be a dumping ground. It should contain only what belongs to the product line being handed to the bank.

Before tagging `v0.1.0`, clean `main` down to the first release scope.

Likely keep:

- `packages/mcp`
- Required `packages/core` modeling/runtime code
- Required `packages/cli` if used
- Modeling skills
- Modeling/review agents
- Runtime scripts
- Guardrails
- Relevant tests
- Install/usage/security docs
- Plugin/MCP metadata needed for Claude Code

Likely exclude from `v0.1.0`:

- `archive/`
- old report-layer skills and agents
- internal/personal skills
- mining/research docs
- personal `.claude` local settings
- demo PBIP unless explicitly needed
- presentation files
- broad/full-report MCP config
- Microsoft MCP binary unless legal/security explicitly approve bundling it

## Claude Code Layout

Use Claude Code conventions:

- Project-shared skills: `.claude/skills/...`
- Project-shared agents: `.claude/agents/...`
- Personal/local skills: `~/.claude/skills/...`
- Local settings: `.claude/settings.local.json`

Internal development skills, such as system-improvement helpers, should not ship in the bank beta unless they are intentionally part of the AA CoE operating model.

## Versioning

Use SemVer tags:

```text
v0.1.0
v0.1.1
v0.2.0
v1.0.0
```

Meaning:

- Patch: fixes, docs, guardrail tweaks.
- Minor: new capabilities or workflow surface.
- Major: breaking workflow/config/tool contract changes.

Do not include `beta` in the tag unless the bank requires it. `0.x` already communicates pre-1.0 maturity.

Describe scope in release notes instead:

```text
v0.1.0
Scope: modeling workflows only.
```

## First Bank Handoff

The first bank handoff should be:

```text
main at v0.1.0
pbi-agent-kit-v0.1.0.zip
release notes
dependency list / SBOM if available
checksum manifest
test evidence
offline Windows install instructions
known limitations
```

Do not hand over a random feature branch or working-copy zip.

## Future Updates and Diffs

Future releases should build on `main`.

Example:

```text
v0.1.0 = first modeling release
v0.2.0 = next approved release
```

The bank should keep Git history so future updates are merges/diffs, not folder replacement.

Review diff:

```bash
git diff v0.1.0..v0.2.0
```

Upgrade flow:

```bash
git fetch upstream
git merge v0.2.0
```

Or open a PR from the new tagged release into the AA CoE bank repo.

Avoid replacing the whole repo folder unless security forces zip-only imports. If zip-only imports are required, still provide a tag-to-tag diff package so reviewers can see what changed.

## Microsoft MCP Runtime

For the bank, assume Windows-only and no internet at runtime.

Do not rely on:

```text
npx -y @microsoft/powerbi-modeling-mcp
```

Preferred model:

- AA CoE repo ships our wrapper.
- Microsoft MCP is provided through a bank-approved internal artifact path.
- Our wrapper resolves the local approved Microsoft MCP executable.
- Users register our MCP, not Microsoft's raw MCP.

Resolution order should be:

```text
PBI_MODELING_MCP_EXE
repo/internal approved binary path if allowed
clear failure with setup instructions
```

## Practical Next Steps

1. Create and push `future/full-surface` from the current full repo state.
2. Clean `main` to only the `v0.1.0` release scope.
3. Move shared Claude Code assets to `.claude/skills` and `.claude/agents` where appropriate.
4. Remove or exclude personal/internal/dev-only material from `main`.
5. Add bank handoff docs and offline Windows setup notes.
6. Run tests and build.
7. Tag `v0.1.0`.
8. Create the scan package from the tag.

