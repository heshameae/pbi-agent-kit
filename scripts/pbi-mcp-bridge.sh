#!/usr/bin/env bash
#
# Bridge: run Microsoft's Power BI modeling MCP inside the Parallels Windows VM
# and pipe its JSON-RPC stdio back to our server on the Mac.
#
# Our ms-mcp-client spawns this when configured with:
#   PBI_MODELING_MCP_COMMAND="bash"
#   PBI_MODELING_MCP_ARGS='["<abs>/scripts/pbi-mcp-bridge.sh"]'
#
# On a Windows-native host you do NOT need this script — leave
# PBI_MODELING_MCP_COMMAND unset and the client spawns the MS MCP directly.
#
# ── CRITICAL stdio discipline (verbatim from a working reference setup) ──
#   1. Nothing here may write to STDOUT. A stray echo (or a chatty profile on
#      the bridge's shell) corrupts the first JSON-RPC frames. config.sh keeps
#      its `prlctl list` probe inside command substitution for this reason.
#   2. End in `exec` so the shell is replaced by prlctl — no wrapper buffering.
#   3. Never merge stderr into stdout (no `2>&1`). The SDK pipes stderr
#      separately; merging it would contaminate the JSON-RPC channel.
#   4. `--current-user` is REQUIRED, not optional: it runs the exe in the
#      interactive Windows session so it can reach Power BI Desktop's local
#      Analysis Services instance. Without it prlctl runs in a service context
#      that cannot see the user's Desktop. This is THE fix that makes it work.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/config.sh"

# Vendored win32 exe installed by scripts/setup-pbi-mcp.sh. Override with PBI_MS_MCP_EXE.
EXE_PATH="${PBI_MS_MCP_EXE:-C:\\pbi-mcp\\package\\dist\\powerbi-modeling-mcp.exe}"

exec prlctl exec "$PBI_VM_NAME" --current-user "$EXE_PATH" "--start" "--skipconfirmation"
