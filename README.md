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

## Safety guarantees

The wrapper runs deterministic gates *in code* before anything reaches your model, so the assistant won't improvise:

- **No guessed DAX.** Measures are written only from confirmed intent against fields the live model proves exist — never from table/column-name guesses.
- **No hardcoded dates.** Date tables are built from proven fact-date evidence; literal `CALENDAR(...)` ranges and volatile `TODAY()`/`NOW()` anchors are rejected, and time intelligence is capped to the last data period so default-context measures don't go blank.
- **Verifies before it writes.** Field existence, relationship validity, and date grain are checked against the live model first; writes are confirmed by a fresh re-read, not the tool's acknowledgement.
- **Never blocks your work.** Guards add scope context or refuse out-of-scope (report) authoring; modeling work is never blocked, and the data-dictionary reminder is a one-time, non-blocking nudge.
- **Modeling-only by design.** Report/page/visual authoring is partitioned out and refused, so the assistant stays in its lane.
- **Dataset-agnostic.** No table, column, or value names are hardcoded anywhere — it works against any model.

## Requirements

- **Power BI Desktop** (Windows) with a model open — the source of truth for live work. **No specific file format is required** to connect; the wrapper reads the live model. The **`.pbip` (Power BI Project) format** is recommended for source control, and is required only for the offline folder-read fallback (`folderPath` → a `.SemanticModel/definition` folder).
- **Node.js ≥ 20** and **pnpm**.
- The **Microsoft Power BI modeling MCP** executable. The **win32-arm64** build is bundled under `vendor/powerbi-modeling-mcp/`; on **x86-64**, supply the `win32-x64` build (same layout) or set `PBI_MODELING_MCP_COMMAND`. The wrapper spawns it internally — **do not** register the raw Microsoft MCP as a peer server.

## Quickstart

```bash
pnpm install
pnpm build          # compiles packages/{core,mcp}; the plugin also ships prebuilt dist
```

1. **Install the plugin** in Claude Code: `/plugin install <repo-path>`. Confirm it's enabled with `/plugin`.
2. **Confirm the MCP server is up:** run `/mcp` and check that `pbi-modeling-beta` shows **connected**. If it doesn't, restart Claude Code and re-check before continuing.
3. **Open your model in Power BI Desktop.**
4. **Make your first prompt `connect to my dashboard`** (see the note below).

> ⚠️ **Always start a session with `connect to my dashboard`** (or `connect to my model`). The plugin works against the *live* Power BI Desktop model, so the agent must attach to it before any modeling request — make this your first prompt every time, before asking for measures, Date tables, checks, etc.

For air-gapped / Windows installs (no internet), see **[docs/install-offline-windows.md](docs/install-offline-windows.md)**.

## Using it

### What you can do

| Goal | Ask something like |
|---|---|
| **Understand a model you didn't build** | *"Connect to my dashboard, then list tables, measures, and relationships and flag anything off."* |
| **Add a correct measure** | *"Create a measure for total sales by segment."* — it confirms the intent and resolves real fields first |
| **Build or fix the Date dimension** | *"Plan and create a governed Date table and wire the relationships."* |
| **Make actuals-vs-targets work** | *"Join actuals and targets on a shared calendar."* |
| **Fix time intelligence** | *"Add a YTD sales measure."* — capped to the last data period so it isn't blank |
| **Review before handoff** | *"Run a model check and tell me what to fix."* |
| **Assess governance / Copilot readiness** | *"Check regulated readiness — RLS, sensitivity, and lineage evidence."* |

A typical first session:

1. `connect to my dashboard`
2. *"List the tables and measures, and run a model check."*
3. *"Create a measure for total sales by segment."* — confirm the intent, and it writes the DAX live
4. Press **Ctrl+S** in Power BI Desktop to persist.

Commands:

- `/pbi-init-config` — MCP config snippets for other agents (Cursor, VS Code Copilot, Cline, Windsurf, Zed).
- `/pbi-init-data-dictionary` — create an optional `.pbi-agent-kit/data-dictionary.yaml` business-context file and fill it via clarifying questions.

**Optional data dictionary:** `.pbi-agent-kit/data-dictionary.yaml` carries business meaning (term definitions, owners, measure intent). It is optional and never required; live MCP tools — not the file — prove that fields exist. See **[docs/data-dictionary.md](docs/data-dictionary.md)**.

## Agents & skills

Natural prompts route to purpose-built subagents and skills — you don't invoke them manually:

- **`data-analyst`** (read-only) — inventories the live model and produces a validated prep spec: KPI/measure intent, source refs, grain, relationships. It plans; it doesn't write.
- **`model-builder`** — performs the writes (measures, tables, columns, relationships, governed Date tables) and validates DAX refs + relationship validity before every change.
- **`model-reviewer`** (read-only) — runs model checks and regulated-readiness review and reports findings.

Skills — `authoring-measures`, `modeling-semantic-model`, `power-query`, `reviewing-models` — carry the modeling know-how the agents apply.

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

## Troubleshooting

| Symptom | Fix |
|---|---|
| `pbi-modeling-beta` not listed / not connected in `/mcp` | Confirm the plugin is enabled (`/plugin`), then restart Claude Code and re-check. |
| *"No open Power BI Desktop instance found"* / the agent can't see your model | Open your model in Power BI Desktop, then make `connect to my dashboard` your first prompt. |
| `spawn EFTYPE` when connecting | The vendored exe is the wrong CPU architecture. Use the matching build in `vendor/powerbi-modeling-mcp/` — `win32-arm64` on ARM Windows (e.g. Parallels on Apple Silicon), `win32-x64` on x64. |
| *"compiled MCP server unavailable"* on start | The prebuilt `dist` is missing/stale (it ships prebuilt). In dev, run `pnpm install && pnpm build`; the runtime fails closed by design rather than building. |
| A measure or Date-table request asks you to confirm details first | Expected — the gates won't write from guesses. Confirm the intent and it proceeds. |

## Environment variables

| Variable | Purpose |
|---|---|
| `PBI_MODELING_MCP_COMMAND` / `PBI_MODELING_MCP_ARGS` | Point at an external Microsoft MCP executable (overrides the vendored one); args as a JSON array |
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
