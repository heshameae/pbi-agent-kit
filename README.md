# pbi-mcp-ts

Power BI semantic-model beta for Claude Code — native TypeScript MCP server + skills + subagents + hooks, with internal report/PBIR dogfood support kept behind a separate config.

The modeling layer is exposed through this server's wrapper tools. Microsoft's Power BI modeling MCP is spawned internally by the wrapper; users should register `pbi-modeling-beta`, not the raw Microsoft MCP as a peer server.

> Status: **v0.1.0 in development.** The modeling-only beta is available through `pbi-modeling-beta`; the full report/PBIR surface remains an internal dogfood profile.

## What this is

A Claude Code plugin that bundles:

- A native TypeScript **MCP server** that performs gated semantic-model changes in the beta profile and can create/edit/validate PBIR files in the internal dogfood profile — works in any MCP-capable agent (Claude Code, Cursor, VS Code, Cline, ...)
- Claude Code-native **skills, subagents, hooks, slash commands** for a first-class Claude experience
- Auto-registered `.mcp.json` for the modeling-only beta surface, plus `.mcp.full.json` for internal dogfood report/PBIR development

## Quickstart

1. Prepare the local plugin checkout:

   ```bash
   pnpm install
   pnpm build
   ```

2. Install the plugin in Claude Code:

   ```bash
   /plugin install <repo-path>
   ```

3. Run `/mcp` and verify `pbi-modeling-beta` is listed.
4. No dictionary path is required. If no data dictionary is provided, agents must use live MCP model discovery and ask concise clarifying questions when business meaning is ambiguous.
5. Optionally add business context at `.pbi-mcp/data-dictionary.yaml`. See `docs/data-dictionary.md` for the template. This file is agent context only; do not add it to MCP server config.
6. Do not register the raw Microsoft Power BI modeling MCP as a peer server. The wrapper starts it internally so deterministic gates and live-model targeting run first.

The default MCP launcher uses the compiled server at `packages/mcp/dist/server.js`. If `dist/` is missing but dependencies are already installed, it attempts a quiet one-time `pnpm build`; if that cannot run, it prints the build command to stderr and exits without writing to the MCP stdout protocol.

## Modeling Beta Scope

In the modeling-only beta, dashboard/report/page/visual/PBIR authoring is unavailable. A Claude Code hook blocks direct report-authoring prompts, direct report skill expansion, and stale report/PBIR tool calls before model-facing agents can drift into report work. Mixed prompts may continue only the explicit modeling task: live model analysis, KPI/spec preparation, DAX measures from confirmed intent, optional data-dictionary grounding, governed Date tables, relationships, model checks, refresh, and regulated readiness.

> **Readiness is not certification.** A clean structural model check is **not** a bank-safe, compliance-approved, or RLS-leakage-proven launch signal. `pbi_model_regulated_check` captures evidence and blocks when evidence is missing — it does not certify compliance or prove that RLS prevents data leakage. Copilot / data-agent exposure additionally requires AI schema scope, RLS leakage tests, tenant settings, and approved instructions; AI-readiness checks here are structural/metadata-only. Formal compliance sign-off and RLS leakage validation remain the team's responsibility.

Internal report/PBIR dogfood uses `.mcp.full.json` or a local MCP config that starts the same server without `PBI_MCP_SURFACE=modeling`.

## Install (other agents)

After Phase 7 of the build plan, see `docs/setup-other-agents.md` for Cursor / VS Code Copilot / Cline / Windsurf / Zed config snippets.

## Architecture

This repo is **simultaneously** a Claude Code plugin (top-level `.claude-plugin/`, `skills/`, `agents/`, `hooks/`, `commands/`, `.mcp.json`, `bin/`) and a Node monorepo (`packages/core`, `packages/cli`, `packages/mcp`).

```
.claude-plugin/   # Plugin manifest
skills/           # Claude Code skills (Phase 8)
agents/           # Subagent definitions (Phase 8)
hooks/            # PostToolUse validation, Desktop auto-sync (Phase 8-9)
commands/         # Slash commands (Phase 8)
.mcp.json         # MCP server registration
bin/              # Compiled CLI shim
packages/
  core/           # Pure TS engine (no MCP deps)
  cli/            # commander CLI wrapper
  mcp/            # @modelcontextprotocol/sdk wrapper
fixtures/         # Real .pbip projects for integration testing
docs/             # Setup guides + workflow docs
```

## License

MIT. Bundled visual templates are inherited from [pbi-cli](https://github.com/MinaSaad1/pbi-cli) (also MIT). No GPL prose is copied from data-goblin/power-bi-agentic-development.
