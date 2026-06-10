#!/usr/bin/env bash
#
# Sourced by pbi-mcp-bridge.sh. Auto-detects the Parallels Windows VM name.
#
# ── MUST NOT write to STDOUT ── this runs on the JSON-RPC bridge path; any
# stdout here would corrupt the MCP stream. The `prlctl list` probe stays inside
# command substitution (captured into $_VM), never printed. Override the
# detection by exporting PBI_VM_NAME before launching.

# Ensure prlctl is reachable even when the MCP server is spawned with a minimal
# PATH. Claude Code / macOS GUI-app launches do NOT inherit your interactive
# shell PATH, so a bare `prlctl` resolves to nothing (exit 127) and the bridge
# silently reports "no live instance". Parallels installs prlctl at
# /usr/local/bin/prlctl (a symlink into the app bundle); /opt/homebrew/bin covers
# Homebrew setups. Augmenting PATH here is stdout-safe and fixes BOTH the probe
# below and the `exec prlctl` in pbi-mcp-bridge.sh, which sources this file first.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if [ -z "${PBI_VM_NAME:-}" ]; then
  _VM=$(prlctl list -a 2>/dev/null \
    | grep -i "running" \
    | grep -i "windows" \
    | head -1 \
    | awk '{for (i = 4; i < NF; i++) printf $i" "; print $NF}' \
    | sed 's/ *$//')
  export PBI_VM_NAME="${_VM:-Windows 11}"
fi
