#!/usr/bin/env bash
#
# Bridges our MCP server (running on macOS) to the Windows-only Microsoft Power BI
# modeling MCP running inside a Parallels VM, over stdio.
#
# Our ms-mcp-client spawns this when configured with:
#   PBI_MODELING_MCP_COMMAND="bash"
#   PBI_MODELING_MCP_ARGS='["scripts/pbi-mcp-bridge.sh"]'
#
# Required env:
#   PBI_VM_NAME    — Parallels VM name (e.g. "Windows 11")
#   PBI_MS_MCP_EXE — Windows path to the MS MCP exe
#                    (e.g. 'C:\pbi-mcp\package\dist\powerbi-modeling-mcp.exe')
#
# On a Windows-native host you do NOT need this script: leave
# PBI_MODELING_MCP_COMMAND unset and the client spawns
# `npx -y @microsoft/powerbi-modeling-mcp@<version> --start` directly.
#
# `exec` so JSON-RPC stdio passes straight through to the guest process.
set -euo pipefail
: "${PBI_VM_NAME:?set PBI_VM_NAME to your Parallels VM name}"
: "${PBI_MS_MCP_EXE:?set PBI_MS_MCP_EXE to the Windows path of powerbi-modeling-mcp.exe}"
exec prlctl exec "$PBI_VM_NAME" --current-user "$PBI_MS_MCP_EXE" --start --skipconfirmation
