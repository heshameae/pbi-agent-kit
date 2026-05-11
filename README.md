# pbi-mcp-ts

Power BI report (PBIR) authoring for Claude Code — native TypeScript MCP server + skills + subagents + hooks.

Pairs with [`@microsoft/powerbi-modeling-mcp`](https://github.com/microsoft/powerbi-modeling-mcp) (Microsoft's official MCP for the modeling layer) to give agents full Power BI capability across both the semantic model and the report.

> Status: **v0.1 in development.** Phase 0 (foundation) complete. See `/Users/heshameissa/.claude/plans/ok-so-let-s-take-jolly-mist.md` for the full migration plan.

## What this is

A Claude Code plugin that bundles:

- A native TypeScript **MCP server** that creates, edits, and validates PBIR (Power BI Enhanced Report Format) files — works in any MCP-capable agent (Claude Code, Cursor, VS Code, Cline, …)
- Claude Code-native **skills, subagents, hooks, slash commands** for a first-class Claude experience
- Auto-registered `.mcp.json` that wires up both this plugin's MCP server AND Microsoft's modeling MCP

## Install (Claude Code)

```bash
# When ready:
/plugin install /Users/heshameissa/Documents/Projects/pbi-mcp-ts
```

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
