# pbi-agent-kit

A Claude Code assistant for building and checking Power BI data models.

> Status: v0.1.0, modeling only. Report, page, and visual authoring are not available yet.

## What you can do

Connect to a model open in Power BI Desktop and work on it in plain language:

| Goal | Ask something like |
|---|---|
| Understand a model you didn't build | "Connect to my dashboard, then list the tables, measures, and relationships, and flag anything off." |
| Add a correct measure | "Create a measure for total sales by segment." It confirms the intent and checks the fields exist first. |
| Build or fix the date table | "Plan and create a proper Date table and wire up the relationships." |
| Make actuals vs targets work | "Join actuals and targets on a shared calendar." |
| Fix time intelligence | "Add a year-to-date sales measure." It caps to the last data period so it isn't blank. |
| Review before handoff | "Run a model check and tell me what to fix." |
| Check governance readiness | "Check RLS, sensitivity, and lineage evidence." |

A typical first session:

1. `connect to my dashboard`
2. "List the tables and measures, and run a model check."
3. "Create a measure for total sales by segment." Confirm the intent, and it writes the DAX into the live model.
4. Press Ctrl+S in Power BI Desktop to save.

Building reports, dashboards, and visuals is not part of this release. The assistant stays on the data model.

## Setup

You need Power BI Desktop (Windows), Node.js 20+, and pnpm.

```bash
pnpm install
pnpm build
```

Then in Claude Code:

1. Install the plugin: `/plugin install <repo-path>`, then check it is enabled with `/plugin`.
2. Check the server is up: run `/mcp` and confirm `pbi-modeling-beta` shows connected. If it doesn't, restart Claude Code and check again.

The plugin drives Microsoft's Power BI modeling MCP, which is bundled for Windows on ARM (`win32-arm64`) under `vendor/`. On Intel/AMD Windows, drop in the `win32-x64` build or set `PBI_MODELING_MCP_COMMAND`. For air-gapped or Windows installs, see [docs/install-offline-windows.md](docs/install-offline-windows.md).

## Connect first

Open your model in Power BI Desktop, then make your first prompt `connect to my dashboard` (or `connect to my model`). The assistant works against the live model, so it has to attach before anything else. Any file format works to connect. The `.pbip` project format is recommended for source control and is only required for offline folder reads.

## Give it business context (recommended)

A model knows column names, not what your business means by them. Two optional files give the assistant that meaning, and it writes much better measures and checks when they exist. Create both in your project, then reference them from your project's `CLAUDE.md` so Claude Code loads them at the start of every session.

**`business-context.md`** (freeform): what the business does, who the audience is, the KPIs that matter and how you define them in plain words, terminology and acronyms, the fiscal calendar, and any data caveats. See [docs/business-context.md](docs/business-context.md) for a starter you can copy.

**`.pbi-agent-kit/data-dictionary.yaml`** (structured): for each term and measure, the business definition, owner, grain, and whether it is draft or confirmed. Run `/pbi-init-data-dictionary` to create it, or see [docs/data-dictionary.md](docs/data-dictionary.md).

Then add a few lines to your project `CLAUDE.md`:

```markdown
## Business context
Our business context is in business-context.md, and our confirmed measure
definitions are in .pbi-agent-kit/data-dictionary.yaml. Read both before
proposing or writing measures.
```

These files give meaning only. The assistant still checks the live model to prove a field exists before it uses it.

## Commands

- `/pbi-init-config`: config snippets to use the server from other tools (Cursor, VS Code, Cline, Windsurf, Zed).
- `/pbi-init-data-dictionary`: create the data dictionary and fill it in by answering a few questions.

## How it stays safe

The assistant runs checks in code before anything reaches your model, so it does not improvise:

- It does not write DAX from guesses. Measures come from intent you confirm, against fields the model proves exist.
- It does not hardcode dates. Date tables come from your real fact dates, and year-to-date style measures are capped to the last data period so they do not go blank.
- It checks before it writes, then confirms the change by re-reading the model.
- It does not block your work. It only declines out-of-scope report building.
- It works on any model. No table or column names are baked in.

Readiness is not certification. A clean model check is not a compliance sign-off. See [docs/known-limitations.md](docs/known-limitations.md).

## Troubleshooting

| Problem | Fix |
|---|---|
| `pbi-modeling-beta` not connected in `/mcp` | Check the plugin is enabled (`/plugin`), then restart Claude Code. |
| "No open Power BI Desktop instance found" | Open your model in Power BI Desktop, then say `connect to my dashboard`. |
| `spawn EFTYPE` on connect | The bundled exe is the wrong CPU type. Use the matching build in `vendor/powerbi-modeling-mcp/`: `win32-arm64` for ARM Windows (Parallels on Apple Silicon), `win32-x64` for Intel/AMD. |
| "compiled MCP server unavailable" | The prebuilt server is missing. In a dev checkout, run `pnpm install && pnpm build`. |
| It asks you to confirm a measure or date detail | Expected. It does not write from guesses. Confirm and it continues. |

## For developers

This repo is both a Claude Code plugin and a small Node monorepo.

```
.claude-plugin/  Plugin and marketplace manifest
skills/          Modeling skills
agents/          Modeling subagents
hooks/           Guardrails
commands/        Slash commands
vendor/          Bundled Microsoft MCP executable
.mcp.json        MCP server registration
packages/core    Modeling engine (checks, planners)
packages/mcp     MCP server that wraps Microsoft's modeling MCP
docs/            Install, data dictionary, limitations
```

Three subagents do the work, and prompts route to them automatically: `data-analyst` plans (read only), `model-builder` makes the changes, `model-reviewer` runs checks (read only). The skills (`authoring-measures`, `modeling-semantic-model`, `power-query`, `reviewing-models`) hold the know-how they apply.

```bash
pnpm build           # build and stamp the build marker
pnpm test            # run the tests
pnpm lint            # biome
pnpm verify:release  # check a tag would ship a runnable server
pnpm release         # build the release artifacts
```

Dev-only environment variables:

| Variable | Purpose |
|---|---|
| `PBI_MODELING_MCP_COMMAND` / `PBI_MODELING_MCP_ARGS` | Point at an external Microsoft MCP executable instead of the bundled one |
| `PBI_AGENT_KIT_ALLOW_RUNTIME_BUILD=1` | Let the launcher build on the fly when the compiled server is missing |
| `PBI_AGENT_KIT_NO_DICT_REMINDER=1` | Silence the data-dictionary reminder |

## License

MIT. The bundled Microsoft Power BI modeling MCP under `vendor/` is Microsoft's software under its own license; see `vendor/powerbi-modeling-mcp/LICENSE.txt`.
