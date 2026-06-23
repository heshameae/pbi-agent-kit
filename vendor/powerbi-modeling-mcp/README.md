# Microsoft Power BI modeling MCP (vendored)

This directory contains **Microsoft's** Power BI modeling MCP executable, bundled so the plugin runs on an offline Windows install without a runtime download.

- **Product:** Microsoft Power BI modeling MCP (`powerbi-modeling-mcp`)
- **Publisher:** analysis-services (Microsoft)
- **Version:** 0.5.10
- **Platform:** `win32-x64` (Intel/AMD Windows)
- **Source:** VS Marketplace extension `analysis-services.powerbi-modeling-mcp`
- **License:** see `LICENSE.txt` in this directory. Microsoft's terms govern this binary.

The wrapper auto-resolves `powerbi-modeling-mcp.exe` here at runtime (see `packages/mcp/src/model-bridge/ms-mcp-client.ts`).

For **ARM Windows** machines, replace this folder's contents with the `win32-arm64` build (same layout), or set `PBI_MODELING_MCP_COMMAND` to an external executable. See `docs/install-offline-windows.md`.
