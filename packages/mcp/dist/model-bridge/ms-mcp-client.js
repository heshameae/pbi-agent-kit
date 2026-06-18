// Wraps Microsoft's Power BI modeling MCP as an INTERNAL child subprocess.
//
// The Microsoft MCP is NOT registered as a peer that Claude routes to — our
// server spawns it and acts as its MCP client (stdio). This is what lets us
// run validation in code before delegating a write, instead of relying on
// PreToolUse hooks.
//
// Connection is a lazy singleton: spawn + connect on first use, reuse across
// calls, and re-spawn if the transport drops (Desktop closed, pipe broken).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// Pinned default for the native-Windows npx fallback. The Mac→Parallels bridge
// instead runs the vendored win32-x64 exe (see scripts/setup-pbi-mcp.sh) — that
// is the proven path. beta.2 is the reference-proven version; beta.6 is latest.
export const DEFAULT_MS_MCP_VERSION = '0.5.0-beta.2';
// Bound each MS MCP request. The SDK default is 60_000ms; a hung call at that
// default is the main multiplier behind retry-storm latency. Live reads/writes
// return well under this; discovery / ConnectFolder a little more. 30s is a
// fail-fast backstop that still tolerates a cold Parallels-VM spawn.
export const MS_MCP_CALL_TIMEOUT_MS = 30_000;
function envStringRecord(env) {
    const out = {};
    for (const [key, value] of Object.entries(env)) {
        if (typeof value === 'string')
            out[key] = value;
    }
    return out;
}
// Absolute path to the Parallels bridge script. Prefer CLAUDE_PLUGIN_ROOT (set by
// Claude Code when running as a plugin); fall back to a path relative to this
// module (packages/mcp/dist/model-bridge/ms-mcp-client.js → plugin root).
function defaultBridgePath(env, platform) {
    if (env.CLAUDE_PLUGIN_ROOT?.trim()) {
        const pluginRoot = env.CLAUDE_PLUGIN_ROOT.trim();
        const join = platform === 'darwin' ? path.posix.join : path.join;
        return join(pluginRoot, 'scripts', 'pbi-mcp-bridge.sh');
    }
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '../../../../scripts/pbi-mcp-bridge.sh');
}
// Resolve how to spawn the Microsoft MCP:
//   1. PBI_MODELING_MCP_COMMAND / _ARGS (JSON array): explicit override — always wins.
//   2. macOS: the MS MCP is a Windows-only exe, so go through the Parallels bridge
//      automatically (no config needed). Live calls need it; folder reads don't use it.
//   3. Windows/native: npx -y @microsoft/powerbi-modeling-mcp@<version> --start
export function resolveSpawnConfig(env = process.env, platform = process.platform) {
    const command = env.PBI_MODELING_MCP_COMMAND;
    if (command && command.trim().length > 0) {
        const rawArgs = env.PBI_MODELING_MCP_ARGS;
        let args = [];
        if (rawArgs && rawArgs.trim().length > 0) {
            const parsed = JSON.parse(rawArgs);
            if (!Array.isArray(parsed) || parsed.some((a) => typeof a !== 'string')) {
                throw new Error('PBI_MODELING_MCP_ARGS must be a JSON array of strings');
            }
            args = parsed;
        }
        return { command, args, env: envStringRecord(env) };
    }
    if (platform === 'darwin') {
        return { command: 'bash', args: [defaultBridgePath(env, platform)], env: envStringRecord(env) };
    }
    const version = env.PBI_MODELING_MCP_VERSION?.trim() || DEFAULT_MS_MCP_VERSION;
    return {
        command: 'npx',
        args: ['-y', `@microsoft/powerbi-modeling-mcp@${version}`, '--start'],
        env: envStringRecord(env),
    };
}
// Real factory: spawn the subprocess over stdio and connect an SDK Client.
export const defaultClientFactory = async (config, onClose) => {
    const transport = new StdioClientTransport({
        command: config.command,
        args: [...config.args],
        env: config.env ? { ...config.env } : undefined,
    });
    transport.onclose = () => onClose();
    transport.onerror = () => onClose();
    const client = new Client({ name: 'pbi-agent-kit-model-bridge', version: '0.1.0' }, { capabilities: {} });
    await client.connect(transport);
    return client;
};
// Lazy-singleton wrapper around one Microsoft-MCP client connection.
export class MsMcpClient {
    #client = null;
    #pending = null;
    #onReset;
    #factory;
    #config;
    constructor(factory, config) {
        this.#factory = factory;
        this.#config = config;
    }
    // Register a callback fired whenever the connection is reset (transport drop
    // or explicit reset) — lets the driver invalidate its cached connection.
    onReset(cb) {
        this.#onReset = cb;
    }
    // Connect on first use; reuse the live client; dedupe concurrent connects.
    async get() {
        if (this.#client)
            return this.#client;
        if (this.#pending)
            return this.#pending;
        this.#pending = this.#factory(this.#config, () => this.reset())
            .then((client) => {
            this.#client = client;
            this.#pending = null;
            return client;
        })
            .catch((err) => {
            this.#pending = null;
            throw err;
        });
        return this.#pending;
    }
    async callTool(name, args) {
        const client = await this.get();
        return client.callTool({ name, arguments: args }, undefined, {
            timeout: MS_MCP_CALL_TIMEOUT_MS,
        });
    }
    // Drop the cached client so the next call re-spawns. Fired by the transport
    // on close/error, or callable directly (e.g. on a reachability error).
    reset() {
        const client = this.#client;
        this.#client = null;
        this.#pending = null;
        if (client)
            void client.close().catch(() => undefined);
        this.#onReset?.();
    }
}
let singleton = null;
export function getMsMcpClient() {
    if (!singleton) {
        singleton = new MsMcpClient(defaultClientFactory, resolveSpawnConfig());
    }
    return singleton;
}
// Test/teardown hook.
export function resetMsMcpClientSingleton() {
    singleton?.reset();
    singleton = null;
}
//# sourceMappingURL=ms-mcp-client.js.map