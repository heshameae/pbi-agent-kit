---
description: Emit MCP server configuration snippets for non-Claude-Code agents (Cursor, VS Code Copilot, Cline, Continue, Windsurf) so they can use the pbi-report MCP server outside the plugin.
disable-model-invocation: true
---

# /pbi-init-config

Print copy-paste config snippets for popular MCP clients to register the pbi-report MCP server installed by this plugin.

## Instructions

1. Resolve the absolute path to `${CLAUDE_PLUGIN_ROOT}/packages/mcp/dist/server.js`.
2. Print a header:
   ```
   pbi-report MCP server: <absolute-path>
   ```
3. Then print the per-client config blocks, each in a labelled fenced code block:

### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows)

```json
{
  "mcpServers": {
    "pbi-report": {
      "command": "node",
      "args": ["<absolute-path>"]
    },
    "powerbi-modeling": {
      "command": "npx",
      "args": ["-y", "@microsoft/powerbi-modeling-mcp@latest", "--start"]
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
    "pbi-report": {
      "command": "node",
      "args": ["<absolute-path>"],
      "type": "stdio"
    }
  }
}
```

### Cline (settings UI)

Add a new MCP server with command `node` and arg `<absolute-path>`.

4. Remind the user: this plugin's `.mcp.json` already registers both servers automatically inside Claude Code — the snippets above are for OTHER clients.
