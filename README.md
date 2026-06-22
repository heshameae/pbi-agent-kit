# pbi-agent-kit

A Power BI **semantic-model** assistant for Claude Code: a wrapper MCP server with deterministic modeling gates, plus skills, subagents, and hooks for a first-class modeling experience in any MCP-capable client.

> **Status: v0.1.0 — modeling-only.** Report, page, and visual authoring are not available in this release.

## What it does

Works against a live Power BI Desktop model (or an offline project folder) to:

- **Discover** the live model — tables, columns, measures, relationships, storage mode.
- **Author measures** from confirmed intent, with a DAX-reference gate before any write.
- **Build governed Date tables** (`pbi_date_table_create_governed`) from proven fact-date evidence — no `TODAY()` / `CALENDAR(...)` guesswork.
- **Join facts** via star-schema / actuals-vs-targets planners (shared governed Date axes, conformed dimensions, FK hiding).
- **Guard time intelligence** — caps `TOTALYTD/QTD/MTD` to the last data period so default-context measures don't return blank.
- **Check models** (`pbi_model_check`) for BPA-style correctness, DAX, formatting, naming, and relationship issues.
- **Assess regulated readiness** (`pbi_model_regulated_check`) — RLS/OLS/sensitivity/lineage evidence (read/evidence-only).

Every write passes through deterministic gates in code before it reaches the model. Writes are **live-first** — they appear in Power BI Desktop immediately; press **Ctrl+S** to persist.

**Not included (this release):** dashboard / report / page / visual / PBIR authoring. A hook refuses report-authoring prompts and steers mixed prompts to the modeling task only.

## Requirements

- **Power BI Desktop** (Windows) with a model open, for live work.
- **Node.js ≥ 20** and **pnpm**.
- The **Microsoft Power BI modeling MCP** executable. The **win32-arm64** build is bundled under `vendor/powerbi-modeling-mcp/`; on **x86-64**, supply the `win32-x64` build (same layout) or set `PBI_MODELING_MCP_COMMAND`. The wrapper spawns it internally — **do not** register the raw Microsoft MCP as a peer server.

## Quickstart

```bash
pnpm install
pnpm build          # compiles packages/{core,mcp}; the plugin also ships prebuilt dist
```

1. Install the plugin in Claude Code: `/plugin install <repo-path>`
2. Run `/mcp` and confirm `pbi-modeling-beta` is connected.
3. Open a model in Power BI Desktop and ask, e.g. *"connect to my model and list the tables."*

For air-gapped / Windows installs (no internet, no `npx`), see **[docs/install-offline-windows.md](docs/install-offline-windows.md)**.

## Using it

Example prompts:

- *"List tables, measures, and relationships, and run a model check."*
- *"Create a measure for total sales by segment."* (it confirms intent first)
- *"Plan and create a governed Date table and relationships."*
- *"Join actuals and targets on a shared calendar."*

Commands:

- `/pbi-init-config` — MCP config snippets for other agents (Cursor, VS Code Copilot, Cline, Windsurf, Zed).
- `/pbi-init-data-dictionary` — create an optional `.pbi-agent-kit/data-dictionary.yaml` business-context file and fill it via clarifying questions.

**Optional data dictionary:** `.pbi-agent-kit/data-dictionary.yaml` carries business meaning (term definitions, owners, measure intent). It is optional and never required; live MCP tools — not the file — prove that fields exist. See **[docs/data-dictionary.md](docs/data-dictionary.md)**.

## How it works

This repo is **simultaneously** a Claude Code plugin (top-level `.claude-plugin/`, `skills/`, `agents/`, `hooks/`, `.mcp.json`) and a Node monorepo (`packages/core`, `packages/mcp`).

```
.claude-plugin/   Plugin + marketplace manifest
skills/           Modeling skills
agents/           Modeling subagents
hooks/            Scope + no-Python guards; data-dictionary reminder
commands/         Slash commands
vendor/           Bundled Microsoft MCP executable (win32-arm64)
.mcp.json         MCP server registration
packages/
  core/           Pure TS modeling engine (gates, planners, checks)
  mcp/            MCP server that wraps Microsoft's modeling MCP
docs/             Install, data dictionary, limitations
```

The MCP launcher runs the prebuilt `packages/mcp/dist/server.js`. If it is missing or stale it **fails closed** with build instructions rather than building on the runtime (dev opt-in: `PBI_AGENT_KIT_ALLOW_RUNTIME_BUILD=1`).

> **Readiness is not certification.** A clean model check is not a compliance approval or an RLS-leakage proof. See **[docs/known-limitations.md](docs/known-limitations.md)**.

## Environment variables

| Variable | Purpose |
|---|---|
| `PBI_MODELING_MCP_COMMAND` / `PBI_MODELING_MCP_ARGS` | Point at an external Microsoft MCP executable (overrides the vendored one); args as a JSON array |
| `PBI_AGENT_KIT_ALLOW_NPX_MS_MCP=1` | Dev only — allow the `npx` Microsoft-MCP fallback (needs internet) |
| `PBI_AGENT_KIT_ALLOW_RUNTIME_BUILD=1` | Dev only — allow an on-demand `pnpm build` when `dist` is stale |
| `PBI_AGENT_KIT_NO_DICT_REMINDER=1` | Silence the data-dictionary reminder |

## Development

```bash
pnpm build          # build core then mcp + write the build marker
pnpm test           # full test suite
pnpm lint           # biome
pnpm verify:release # assert a tag would ship a runnable compiled server
pnpm release        # build offline release artifacts (zip, checksums, SBOM, test evidence)
```

## License

MIT. The bundled Microsoft Power BI modeling MCP under `vendor/` is Microsoft's software, governed by its own license — see `vendor/powerbi-modeling-mcp/LICENSE.txt`.
