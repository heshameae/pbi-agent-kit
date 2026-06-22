# pbi-agent-kit

Power BI semantic-model beta for Claude Code — native TypeScript MCP server, skills, subagents, hooks, and deterministic guardrails.

The modeling layer is exposed through this server's wrapper tools. Microsoft's Power BI modeling MCP is spawned internally by the wrapper; users should register `pbi-modeling-beta`, not the raw Microsoft MCP as a peer server.

> Status: **v0.1.0 in development.** This release is modeling-only.

## What this is

A Claude Code plugin that bundles:

- A native TypeScript **MCP server** that performs gated semantic-model checks and changes — works in any MCP-capable agent (Claude Code, Cursor, VS Code, Cline, ...)
- Claude Code-native **skills, subagents, and hooks** for a first-class Claude experience
- Auto-registered `.mcp.json` for the modeling-only beta surface

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
5. Optionally add business context at `.pbi-agent-kit/data-dictionary.yaml` — run `/pbi-init-data-dictionary` to create it from a template and fill it via clarifying questions (a non-blocking reminder also surfaces when it's absent in a Power BI project; opt out with `PBI_AGENT_KIT_NO_DICT_REMINDER=1`). See `docs/data-dictionary.md`. This file is agent context only; do not add it to MCP server config.
6. Do not register the raw Microsoft Power BI modeling MCP as a peer server. The wrapper starts it internally so deterministic gates and live-model targeting run first.

The default MCP launcher uses the compiled server at `packages/mcp/dist/server.js`, which ships **prebuilt** with the plugin. If the compiled server is missing or stale the launcher **fails closed** — it prints build instructions to stderr and exits, and does **not** run a build on the runtime. For local development you can opt in to an automatic one-time `pnpm build` with `PBI_AGENT_KIT_ALLOW_RUNTIME_BUILD=1` (requires installed dependencies; never use on an offline/bank runtime).

## Modeling Beta Scope

In the modeling-only beta, dashboard/report/page/visual/PBIR authoring is unavailable. A Claude Code hook blocks direct report-authoring prompts, direct report skill expansion, and stale report/PBIR tool calls before model-facing agents can drift into report work. Mixed prompts may continue only the explicit modeling task: live model analysis, KPI/spec preparation, DAX measures from confirmed intent, optional data-dictionary grounding, governed Date tables, relationships, model checks, refresh, and regulated readiness.

> **Readiness is not certification.** A clean structural model check is **not** a bank-safe, compliance-approved, or RLS-leakage-proven launch signal. `pbi_model_regulated_check` captures evidence and blocks when evidence is missing — it does not certify compliance or prove that RLS prevents data leakage. Copilot / data-agent exposure additionally requires AI schema scope, RLS leakage tests, tenant settings, and approved instructions; AI-readiness checks here are structural/metadata-only. Formal compliance sign-off and RLS leakage validation remain the team's responsibility.

## Install (other agents)

Use `/pbi-init-config` for Cursor / VS Code Copilot / Cline / Windsurf / Zed config snippets.

## Offline / Windows (bank) install

For an air-gapped Windows install — no internet, no `npx` — see **[docs/install-offline-windows.md](docs/install-offline-windows.md)**. You must set `PBI_MODELING_MCP_COMMAND` to the approved local Power BI modeling MCP executable; the wrapper fails closed if it is unset, rather than reaching for `npx`.

## Known limitations

See **[docs/known-limitations.md](docs/known-limitations.md)** for modeling-only scope, readiness-vs-certification, the live-Desktop dependency, and live-write caveats — the disclosed-risk sheet for handover.

## Architecture

This repo is **simultaneously** a Claude Code plugin (top-level `.claude-plugin/`, `skills/`, `agents/`, `hooks/`, `.mcp.json`) and a Node monorepo (`packages/core`, `packages/mcp`).

```
.claude-plugin/   # Plugin manifest
skills/           # Claude Code modeling skills
agents/           # Modeling subagent definitions
hooks/            # Scope and guardrail hooks
.mcp.json         # MCP server registration
packages/
  core/           # Pure TS engine (no MCP deps)
  mcp/            # @modelcontextprotocol/sdk wrapper
docs/             # Setup guides + workflow docs
```

## License

MIT.
