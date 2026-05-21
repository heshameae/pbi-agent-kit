#!/usr/bin/env bash
#
# One-time setup: download Microsoft's Power BI modeling MCP binary into the
# Parallels Windows VM, where pbi-mcp-bridge.sh expects it.
#
# This installs the platform-specific package (the actual .exe), NOT the generic
# `@microsoft/powerbi-modeling-mcp` npx launcher — the win32-x64 exe is what the
# bridge runs via `prlctl exec`.
#
# Prereqs:
#   - Parallels Desktop Pro/Business (the `prlctl` CLI), a running Windows VM
#   - Internet access from inside the VM
#
# Usage:
#   ./scripts/setup-pbi-mcp.sh                 # auto-detect VM, default version
#   PBI_VM_NAME="Windows 11" VERSION=0.5.0-beta.2 ./scripts/setup-pbi-mcp.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/config.sh"

# Reference-proven version. 0.5.0-beta.6 is the latest if you want to upgrade.
VERSION="${VERSION:-0.5.0-beta.2}"
PKG_URL="https://registry.npmjs.org/@microsoft/powerbi-modeling-mcp-win32-x64/-/powerbi-modeling-mcp-win32-x64-${VERSION}.tgz"

echo "Installing Power BI modeling MCP v${VERSION} into VM '${PBI_VM_NAME}'..."

prlctl exec "$PBI_VM_NAME" powershell -Command "
  New-Item -ItemType Directory -Force -Path 'C:\pbi-mcp' | Out-Null;
  \$url = '${PKG_URL}';
  Write-Output 'Downloading from npm...';
  Invoke-WebRequest -Uri \$url -OutFile 'C:\pbi-mcp\pbi-mcp.tgz';
  Write-Output 'Extracting...';
  tar -xzf 'C:\pbi-mcp\pbi-mcp.tgz' -C 'C:\pbi-mcp';
  Remove-Item 'C:\pbi-mcp\pbi-mcp.tgz';
  Write-Output 'Done. Binary at C:\pbi-mcp\package\dist\powerbi-modeling-mcp.exe';
"

echo "Setup complete. Make sure Power BI Desktop is running with a .pbip open before using the bridge."
