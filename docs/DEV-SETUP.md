# pbi-mcp-ts — Developer setup & Claude Code automations

Supporting infrastructure for working on the plugin. **Not** part of the architecture design (see `docs/superpowers/specs/2026-05-18-pbi-architecture-design.md`). Each item below is independently adoptable.

---

## 1. Hooks (beyond the 3 in the architecture design)

The design ships `block-destructive-commands`, `block-secrets-exposure`, `block-pnpm-discipline`. These three add edit-time quality gates for the dev loop itself.

### `tsc-noemit-on-edit`

Catches TS errors at edit time instead of build time.

```jsonc
// hooks/hooks.json — add to PostToolUse
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "cd \"${CLAUDE_PROJECT_DIR}\" && pnpm -F pbi-core exec tsc --noEmit 2>&1 | head -30",
    "if": "Edit(**/packages/*/src/**/*.ts)|Write(**/packages/*/src/**/*.ts)"
  }]
}
```

### `plugin-manifest-validate`

Memory `feedback_claude_code_plugin_manifest.md` documents that `plugin.json` must explicitly declare skills/agents/hooks paths. Validates JSON shape + path existence after every edit.

```jsonc
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "cd \"${CLAUDE_PROJECT_DIR}\" && node -e \"const p=require('./.claude-plugin/plugin.json'); const fs=require('fs'); ['skills','agents'].forEach(k=>{const v=p[k]; (Array.isArray(v)?v:[v]).forEach(x=>x&&!fs.existsSync(x.replace('./',''))&&console.error('MISSING:',x))})\"",
    "if": "Edit(.claude-plugin/plugin.json)|Write(.claude-plugin/plugin.json)"
  }]
}
```

### `skill-frontmatter-validate`

With 13+ shared-knowledge skills whose `description:` drives auto-trigger routing, malformed frontmatter silently breaks routing. Tiny JS validator on `Edit|Write(**/SKILL.md)` checks `name`, `description` are present.

---

## 2. Output styles

Files in `.claude/output-styles/`. Activated with `/output-style <name>`.

### `tight-tables.md`

```yaml
---
name: tight-tables
description: Terse responses with tables. No filler prose. No trailing summary.
---
- Use tables (markdown) when comparing 3+ items.
- No "Great, here is..." / "Let me know if..." / "Hope this helps!".
- Maximum two sentences of prose between sections.
- Lead with the answer; reasoning second if needed.
```

### `arch-review.md`

For design-doc work. Always present options as a table; mark recommended pick with ★; end with one explicit clarifying question OR "ready to proceed?" — never an open invitation to chat.

---

## 3. Status line

`.claude/settings.json`:
```jsonc
{
  "statusLine": { "type": "command", "command": ".claude/status-line.sh" }
}
```

`.claude/status-line.sh`:
```bash
#!/usr/bin/env bash
PLUGIN_VER=$(jq -r .version "${CLAUDE_PROJECT_DIR}/.claude-plugin/plugin.json" 2>/dev/null)
CACHE_TARGET=$(readlink "${HOME}/.claude/plugins/cache/pbi-mcp-marketplace/pbi-mcp-ts/${PLUGIN_VER}" 2>/dev/null || echo "(not symlinked)")
BRANCH=$(git -C "${CLAUDE_PROJECT_DIR}" branch --show-current 2>/dev/null)
TEST_STATUS=$(cat "${CLAUDE_PROJECT_DIR}/.cache/test-status" 2>/dev/null || echo "?")
echo "pbi-mcp-ts@${PLUGIN_VER} · ${BRANCH} · ${TEST_STATUS} · cache→${CACHE_TARGET##*/}"
```

Eliminates the "is Claude Code running my latest version?" question that's burned us before.

---

## 4. Settings

### Permission allowlist

`.claude/settings.json` (commit to repo so the whole team gets it).

> Note: an earlier draft proposed `permissions.deny` on `mcp__powerbi-modeling__measure_operations(operation=Create)`. **That syntax doesn't work** — Claude Code's permission rules match server/tool names, not JSON input fields. Use the PreToolUse `gate-measure-create` hook in the architecture design instead; it inspects input and refuses on missing references.

```jsonc
{
  "permissions": {
    "allow": [
      "Bash(pnpm test:*)",
      "Bash(pnpm build:*)",
      "Bash(pnpm -r build:*)",
      "Bash(pnpm -r test:*)",
      "Bash(pnpm -F *:*)",
      "Bash(pnpm exec biome:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(node -e *)"
    ]
  }
}
```

### Env vars

```jsonc
{
  "env": {
    "PBI_TEST_DEMO_PBIP": "/Users/heshameissa/Documents/Projects/pbi-demo/pbi-demo/Demo.pbip",
    "PBI_PLUGIN_ROOT": "/Users/heshameissa/Documents/Projects/pbi-mcp-ts"
  }
}
```

---

## 5. CI / scheduled automation

### Plugin audit on every PR

`.github/workflows/plugin-audit.yml`:

```yaml
name: plugin audit
on: pull_request
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          claude -p "Validate plugin manifest declarations, every SKILL.md has valid frontmatter, no dataset-specific names ('Superstore', 'Demo.pbip', 'Sales Target (US)') in packages/*/src or packages/*/tests. Report violations only. Exit 1 if any." \
            --output-format stream-json
```

### Auto-rebuild MCP server on `packages/mcp/src/**` edits

PostToolUse hook that runs `pnpm -F pbi-report-mcp build` automatically when an MCP server source file is edited. Pair with a status-line flash "MCP rebuilt — restart Claude Code" so you don't miss the still-manual restart step.

### Scheduled drift detector

`/schedule "weekly review skill-vs-tool drift"` runs a small audit prompt every week: check that every MCP tool in `packages/mcp/src/server.ts` has a corresponding skill wrapper (CRUD skill) or is consumed by an agent. Catches missing wrappers before they bite.

---

## Adoption order (if implementing all of this)

1. **Settings allowlist + status line** — instant ergonomics win, zero risk.
2. **`tsc-noemit-on-edit` + `plugin-manifest-validate` hooks** — catch the two most common silent-bug classes at edit time.
3. **Output styles** — fold into your default workflow (`/output-style tight-tables` once, sticks).
4. **CI plugin audit** — protects PRs from drift.
5. **Auto-rebuild MCP hook + drift detector** — operational nice-to-haves, last.

Everything here is optional and incrementally addable.
