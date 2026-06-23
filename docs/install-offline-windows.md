# Offline Windows Install

This guide covers installing `pbi-agent-kit` on a locked-down Windows machine with **no internet access** and **no `npx`**. This is the assumed offline runtime. It is dataset-agnostic: nothing here depends on a specific model, table, or field.

## Assumptions

- Windows host with Power BI Desktop installed.
- No outbound internet; package registries (`registry.npmjs.org`) are unreachable.
- `npx` / on-demand package download is unavailable or disallowed.
- The Microsoft Power BI modeling MCP is delivered as an **approved internal artifact** (a local executable), not fetched at runtime.
- Node.js (>= 20) is available, or the plugin is delivered as a self-contained bundle (see "Runtime bundle" below).

## What must be in the shipped package

The handover artifact must contain a **prebuilt** server; the launcher does not build on the runtime:

- `packages/core/dist/**` and `packages/mcp/dist/**` (compiled JavaScript)
- `packages/mcp/dist/server.js` (the MCP entry point)
- `packages/mcp/dist/pbi-agent-kit-build.json` (the build marker)
- Production `node_modules` for the compiled server (it imports `@modelcontextprotocol/sdk`, `zod`, and the built `pbi-core`). Vendor these or run a one-time `pnpm install --prod --offline` from a local store on a staging machine before packaging.

Verify the package before handover with `node scripts/verify-release-artifact.mjs` (see "Release verification").

## Step 1: place the approved Microsoft MCP executable

**Option A: vendored drop-in (recommended, no environment variable).** Place the approved Power BI modeling MCP executable inside the plugin so the wrapper resolves it automatically. The npm `@microsoft/powerbi-modeling-mcp-win32-x64` tarball extracts to exactly this layout:

```text
<plugin-root>\vendor\powerbi-modeling-mcp\package\dist\powerbi-modeling-mcp.exe
```

`<plugin-root>` is the installed plugin directory (the value of `CLAUDE_PLUGIN_ROOT`). A flat `vendor\powerbi-modeling-mcp\powerbi-modeling-mcp.exe` is also accepted. The Microsoft MCP binary is **not shipped in this repo**; place the approved build for your CPU here yourself (`win32-x64` for Intel/AMD, `win32-arm64` for ARM). With the exe present, no environment variable is needed; the wrapper spawns it with `--start --skipconfirmation`.

**Option B: explicit path.** If the exe lives outside the plugin, point the wrapper at it via `PBI_MODELING_MCP_COMMAND` (Step 2).

## Step 2: point the wrapper at the executable (Option B only)

Skip this if you used the vendored layout in Step 1. Otherwise set these in the environment Claude Code (or the host MCP client) runs in:

```powershell
$env:PBI_MODELING_MCP_COMMAND = "C:\path\to\powerbi-modeling-mcp.exe"
$env:PBI_MODELING_MCP_ARGS    = "[\"--start\",\"--skipconfirmation\"]"
```

- `PBI_MODELING_MCP_COMMAND`: absolute path to the approved executable (overrides the vendored auto-resolution).
- `PBI_MODELING_MCP_ARGS`: a JSON array of string arguments. Defaults to `["--start","--skipconfirmation"]` for a vendored exe; set explicitly to match the approved executable's flags.

Resolution order on native Windows: `PBI_MODELING_MCP_COMMAND`, then the vendored exe, then **fail closed** with a clear setup error. There is **no network fallback**: supply the exe or set `PBI_MODELING_MCP_COMMAND`.

## Step 3: install the plugin from a local path

Install from the unpacked local checkout (no marketplace fetch):

```text
/plugin install <absolute-path-to-unpacked-plugin>
```

## Step 4: verify

1. Run `/mcp` and confirm `pbi-modeling-beta` is listed and connected.
2. Open a Power BI Desktop model and run a read-only model discovery to confirm the wrapper reaches the live model through the approved executable.

If the compiled server is missing or stale, the launcher prints build instructions and exits. On the offline runtime this means the package was built incorrectly. Rebuild and repackage on a staging machine; **do not** set `PBI_AGENT_KIT_ALLOW_RUNTIME_BUILD=1` on the offline host.

## Release verification (run before handover, on a staging machine)

```bash
pnpm install
pnpm build                       # builds core then mcp, writes the build marker
pnpm -r test                     # full suite must be green
node scripts/verify-release-artifact.mjs   # confirms the tag/zip would ship a runnable server
```

## Environment variable reference

| Variable | Purpose | Offline runtime |
|---|---|---|
| _(none)_ | Vendored exe under `<plugin>/vendor/powerbi-modeling-mcp/` auto-resolves | **Recommended (Option A)** |
| `PBI_MODELING_MCP_COMMAND` | Absolute path to the approved Microsoft MCP executable | Required only if not vendored (Option B) |
| `PBI_MODELING_MCP_ARGS` | JSON array of args for that executable (default `["--start","--skipconfirmation"]`) | Optional |
| `PBI_AGENT_KIT_ALLOW_RUNTIME_BUILD` | Opt in to an on-demand `pnpm build` (dev only) | **Do not set** |
