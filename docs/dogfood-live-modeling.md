# Live modeling from a Mac via the Parallels bridge

How to drive **live** Power BI model edits (measures appear in Desktop with no
restart) while running Claude Code + our plugin on the Mac. The Microsoft
modeling MCP is Windows-only, so our server spawns it **inside the Parallels VM**
via `prlctl exec` and pipes its JSON-RPC stdio back.

```
Mac: Claude Code → pbi-report server ──(spawns)──► bash scripts/pbi-mcp-bridge.sh
                                                       └─ prlctl exec <VM> --current-user
                                                            powerbi-modeling-mcp.exe --start
VM:  powerbi-modeling-mcp.exe ──► Power BI Desktop's local Analysis Services (localhost:<port>)
```

The whole live connection lives **inside the VM**. The Mac only ever sees JSON-RPC
over the stdio pipe — it never needs the SSAS port.

## Prerequisites

- **Parallels Desktop Pro/Business** (the `prlctl` CLI; Standard edition lacks it — verify on your box).
- A running **Windows VM** with **Power BI Desktop** open on a `.pbip` (the model you want to edit). The VM must have an interactive user session (windowed, not headless) — the Desktop window must actually exist.
- Internet access from inside the VM (one-time, for setup).

## One-time setup

Installs the vendored win32 exe into the VM at `C:\pbi-mcp\package\dist\powerbi-modeling-mcp.exe`:

```bash
./scripts/setup-pbi-mcp.sh
# or pin: PBI_VM_NAME="Windows 11" VERSION=0.5.0-beta.2 ./scripts/setup-pbi-mcp.sh
```

This downloads `@microsoft/powerbi-modeling-mcp-win32-x64` (the platform exe — **not** the generic `@microsoft/powerbi-modeling-mcp` npx launcher).

## Wire the Mac dev loop to the bridge

Our server picks the spawn method from env. Export these in the shell **before** launching Claude Code, so the spawned MCP server inherits them:

```bash
export PBI_MODELING_MCP_COMMAND=bash
export PBI_MODELING_MCP_ARGS='["/Users/heshameissa/Documents/Projects/pbi-mcp-ts/scripts/pbi-mcp-bridge.sh"]'
# Optional, only if multiple Desktops are open (discovery otherwise picks the single one):
# export PBI_MODELING_MCP_CONNECTION_STRING='Data Source=localhost:59186;'
# Optional, only if VM auto-detect picks the wrong VM:
# export PBI_VM_NAME="Windows 11"
```

Use the **absolute** path to the bridge script (our server's cwd isn't guaranteed to be the repo root). If shell env doesn't reach the plugin's MCP server in your setup, put the same `env` block on the `pbi-report` entry of a local (uncommitted) `.mcp.json`.

> The committed `.mcp.json` deliberately does **not** include the bridge — it's Mac+Parallels-specific. Windows-native users leave these unset and the server spawns the MS MCP directly.

## What makes the bridge work (don't break these)

1. **`--current-user`** — runs the exe in the interactive Windows session so it can reach Desktop's local Analysis Services. This is the actual fix; without it the connection silently fails.
2. **Pristine stdout** — nothing on the bridge path may print to stdout (it's the JSON-RPC channel). `config.sh` keeps its VM probe inside command substitution; the bridge ends in `exec`; we never `2>&1`. A stray `echo` or a chatty shell profile will corrupt the stream.
3. **stderr stays separate** — the SDK pipes the child's stderr away from stdout; keep it that way.

## Validate (run in order; stop on first failure)

Desktop open on a `.pbip` in the VM, env exported, Claude Code launched from that shell.

1. **Live read:** call `pbi_model_snapshot` **with no folderPath** → it discovers the single Desktop instance, connects, and returns the live model. If a caller supplies `folderPath` while Desktop or `PBI_MODELING_MCP_CONNECTION_STRING` is available, live still wins; `folderPath` is only the cross-platform/offline fallback when no live model can be reached.
2. **Gate refuses a bad ref:** `pbi_measure_create` with an expression referencing a non-existent field → refused in code, nothing written.
3. **Date-table coverage proof:** `pbi_model_plan_date_table` with the governed Date table/key and relevant fact date columns → returns `status`, key evidence, and fact min/max coverage. It must block gaps, duplicates, blanks, fact dates outside the Date table, auto date tables, and `TODAY()`/`NOW()` calendar anchors.
4. **Date-grain proof:** `pbi_model_plan_date_grain` with the relevant fact date columns → returns one `probeStatus` and observed grain evidence without dumping all `LocalDateTable_*` columns. Use this before target/actual date relationship edits.
5. **Live create:** `pbi_measure_create` of a valid measure → it appears in Desktop's Fields pane **without restart**. Press **Ctrl+S** in Desktop to persist to the `.pbip`.
6. **In-batch dependency:** create measure B referencing measure A from the same batch → no false-block (the gate reads the live model, which already has A).

## Lifecycle / recovery

The connection is a lazy singleton reused across calls; it re-spawns automatically if the transport drops (Desktop closed, VM slept, pipe broken). If Desktop closes mid-session, the next call surfaces a clear error and re-discovers on retry. Multiple open Desktops → pass `model` with the file/model name or listed port; pin `PBI_MODELING_MCP_CONNECTION_STRING` only when you want an explicit override.
