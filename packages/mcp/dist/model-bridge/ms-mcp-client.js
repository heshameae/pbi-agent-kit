// Wraps Microsoft's Power BI modeling MCP as an INTERNAL child subprocess.
//
// The Microsoft MCP is NOT registered as a peer that Claude routes to — our
// server spawns it and acts as its MCP client (stdio). This is what lets us
// run validation in code before delegating a write, instead of relying on
// PreToolUse hooks.
//
// Connection is a lazy singleton: spawn + connect on first use, reuse across
// calls, and re-spawn if the transport drops (Desktop closed, pipe broken).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// Pinned version for the opt-in native-Windows npx fallback (dev machines only;
// the offline bank runtime uses PBI_MODELING_MCP_COMMAND pointing at the approved
// vendored exe). beta.2 is the reference-proven version validated against this kit.
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
// Proven invocation flags for a directly-spawned Microsoft MCP executable (matches
// the Parallels bridge: `--start --skipconfirmation`). Overridable via PBI_MODELING_MCP_ARGS.
export const DEFAULT_MS_MCP_EXE_ARGS = ['--start', '--skipconfirmation'];
// Parse PBI_MODELING_MCP_ARGS (a JSON array of strings) or return undefined when unset.
function parseArgsEnv(rawArgs) {
    if (!rawArgs || rawArgs.trim().length === 0)
        return undefined;
    const parsed = JSON.parse(rawArgs);
    if (!Array.isArray(parsed) || parsed.some((a) => typeof a !== 'string')) {
        throw new Error('PBI_MODELING_MCP_ARGS must be a JSON array of strings');
    }
    return parsed;
}
// Plugin root: CLAUDE_PLUGIN_ROOT when running as a plugin, else relative to this
// module (packages/mcp/dist/model-bridge/ms-mcp-client.js → plugin root).
function pluginRootFrom(env) {
    if (env.CLAUDE_PLUGIN_ROOT?.trim())
        return env.CLAUDE_PLUGIN_ROOT.trim();
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '../../../..');
}
// Resolve a locally vendored Microsoft MCP executable so a native-Windows install
// needs no env var: drop the approved exe under <plugin>/vendor/powerbi-modeling-mcp/.
// Probes the npm win32-x64 tarball layout first, then flatter fallbacks; first hit wins.
export function defaultVendoredExe(pluginRoot) {
    const base = path.join(pluginRoot, 'vendor', 'powerbi-modeling-mcp');
    const candidates = [
        path.join(base, 'package', 'dist', 'powerbi-modeling-mcp.exe'),
        path.join(base, 'dist', 'powerbi-modeling-mcp.exe'),
        path.join(base, 'powerbi-modeling-mcp.exe'),
    ];
    return candidates.find((candidate) => existsSync(candidate));
}
// Resolve how to spawn the Microsoft MCP:
//   1. PBI_MODELING_MCP_COMMAND / _ARGS (JSON array): explicit override — always wins.
//   2. macOS: the MS MCP is a Windows-only exe, so go through the Parallels bridge
//      automatically (no config needed). Live calls need it; folder reads don't use it.
//   3. Windows/native: auto-resolve a locally vendored exe (no env var). This is the
//      supported bank path — the wrapper resolves the approved local executable.
//   4. Windows/native with no vendored exe: FAIL CLOSED (deferred to spawn time so the
//      offline folder-read path is not blocked). The legacy npx fallback is available
//      for a networked dev machine only behind an explicit PBI_AGENT_KIT_ALLOW_NPX_MS_MCP=1.
export function resolveSpawnConfig(env = process.env, platform = process.platform, findVendoredExe = defaultVendoredExe) {
    const command = env.PBI_MODELING_MCP_COMMAND;
    if (command && command.trim().length > 0) {
        return {
            command,
            args: parseArgsEnv(env.PBI_MODELING_MCP_ARGS) ?? [],
            env: envStringRecord(env),
        };
    }
    if (platform === 'darwin') {
        return { command: 'bash', args: [defaultBridgePath(env, platform)], env: envStringRecord(env) };
    }
    // Native non-darwin (Windows). Prefer a locally vendored executable — no env var
    // needed. Args default to the proven flags, overridable via PBI_MODELING_MCP_ARGS.
    const vendored = findVendoredExe(pluginRootFrom(env));
    if (vendored) {
        return {
            command: vendored,
            args: parseArgsEnv(env.PBI_MODELING_MCP_ARGS) ?? [...DEFAULT_MS_MCP_EXE_ARGS],
            env: envStringRecord(env),
        };
    }
    // No vendored exe. Fail closed unless the npx fallback is explicitly opted into —
    // never silently reach the forbidden network path. Deferred to spawn time so the
    // offline folder-read path (builds the driver but never spawns) is not blocked.
    if (env.PBI_AGENT_KIT_ALLOW_NPX_MS_MCP !== '1') {
        return {
            command: '',
            args: [],
            env: envStringRecord(env),
            deferredError: 'Microsoft Power BI modeling MCP is not configured for this platform. ' +
                'Place the approved powerbi-modeling-mcp executable under <plugin>/vendor/powerbi-modeling-mcp/ ' +
                '(or set PBI_MODELING_MCP_COMMAND to its path, with optional PBI_MODELING_MCP_ARGS as a JSON array). ' +
                'See docs/install-offline-windows.md. ' +
                'For a networked development machine only, opt in to the npx fallback with PBI_AGENT_KIT_ALLOW_NPX_MS_MCP=1.',
        };
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
    // Deferred fail-closed: resolveSpawnConfig flagged this platform/env as
    // unconfigured. Throw only now (a real spawn attempt), so folder-only reads
    // that never reach here stay unaffected. The tool() wrapper surfaces this as a
    // clean, actionable MCP error.
    if (config.deferredError) {
        throw new Error(config.deferredError);
    }
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