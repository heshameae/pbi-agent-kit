---
description: Emit MCP server configuration snippets for non-Claude-Code agents (Cursor, VS Code Copilot, Cline, Continue, Windsurf) so they can use the pbi-modeling-beta MCP server outside the plugin.
disable-model-invocation: true
---

# /pbi-init-config

Print copy-paste config snippets for popular MCP clients to register the pbi-modeling-beta MCP server installed by this plugin.

## Instructions

1. Resolve the absolute path to `${CLAUDE_PLUGIN_ROOT}/scripts/start-mcp.mjs`.
2. Print a header:
   ```
   pbi-modeling-beta MCP server: <absolute-path>
   ```
3. Then print the per-client config blocks, each in a labelled fenced code block:

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows)

```json
{
  "mcpServers": {
    "pbi-modeling-beta": {
      "command": "node",
      "args": ["<absolute-path>"]
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

Same as Claude Desktop.

### VS Code Copilot (`.vscode/mcp.json` per workspace)

```json
{
  "servers": {
    "pbi-modeling-beta": {
      "command": "node",
      "args": ["<absolute-path>"],
      "type": "stdio"
    }
  }
}
```

### Cline (settings UI)

Add a new MCP server named `pbi-modeling-beta` with command `node` and arg `<absolute-path>`.

4. Remind the user:
   - This plugin's `.mcp.json` registers `pbi-modeling-beta` automatically inside Claude Code.
   - Run `npm install` and `npm run build` in the plugin repository before first use; the launcher can attempt a quiet build only when dependencies are already installed.
   - Do not register the raw Microsoft Power BI modeling MCP as a peer server; the wrapper starts it internally so deterministic gates run first.
   - Optional data dictionaries such as `.pbi-agent-kit/data-dictionary.yaml` are context files, not MCP config. They provide business meaning only; live MCP tools still prove field existence.
