#!/usr/bin/env bash
#
# Sourced by pbi-mcp-bridge.sh. Auto-detects the Parallels Windows VM name.
#
# ── MUST NOT write to STDOUT ── this runs on the JSON-RPC bridge path; any
# stdout here would corrupt the MCP stream. The `prlctl list` probe stays inside
# command substitution (captured into $_VM), never printed. Override the
# detection by exporting PBI_VM_NAME before launching.

if [ -z "${PBI_VM_NAME:-}" ]; then
  _VM=$(prlctl list -a 2>/dev/null \
    | grep -i "running" \
    | grep -i "windows" \
    | head -1 \
    | awk '{for (i = 4; i < NF; i++) printf $i" "; print $NF}' \
    | sed 's/ *$//')
  export PBI_VM_NAME="${_VM:-Windows 11}"
fi
