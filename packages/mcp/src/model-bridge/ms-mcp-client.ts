// Wraps Microsoft's Power BI modeling MCP as an INTERNAL child subprocess.
//
// The Microsoft MCP is NOT registered as a peer that Claude routes to — our
// server spawns it and acts as its MCP client (stdio). This is what lets us
// run validation in code before delegating a write, instead of relying on
// PreToolUse hooks. See docs/superpowers/specs/2026-05-20-phase-b1-model-agents-plan.md.
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

export interface MsMcpSpawnConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface McpToolResult {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

// Minimal surface we need from an MCP client — keeps the bridge mockable.
export interface McpClientLike {
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<McpToolResult>;
  close(): Promise<void>;
}

// Spawns a client and wires `onClose` to fire when the transport drops.
export type ClientFactory = (
  config: MsMcpSpawnConfig,
  onClose: () => void,
) => Promise<McpClientLike>;

function envStringRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

// Absolute path to the Parallels bridge script. Prefer CLAUDE_PLUGIN_ROOT (set by
// Claude Code when running as a plugin); fall back to a path relative to this
// module (packages/mcp/dist/model-bridge/ms-mcp-client.js → plugin root).
function defaultBridgePath(env: NodeJS.ProcessEnv): string {
  if (env.CLAUDE_PLUGIN_ROOT?.trim()) {
    return path.join(env.CLAUDE_PLUGIN_ROOT, 'scripts', 'pbi-mcp-bridge.sh');
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../../scripts/pbi-mcp-bridge.sh');
}

// Resolve how to spawn the Microsoft MCP:
//   1. PBI_MODELING_MCP_COMMAND / _ARGS (JSON array): explicit override — always wins.
//   2. macOS: the MS MCP is a Windows-only exe, so go through the Parallels bridge
//      automatically (no config needed). Live calls need it; folder reads don't use it.
//   3. Windows/native: npx -y @microsoft/powerbi-modeling-mcp@<version> --start
export function resolveSpawnConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): MsMcpSpawnConfig {
  const command = env.PBI_MODELING_MCP_COMMAND;
  if (command && command.trim().length > 0) {
    const rawArgs = env.PBI_MODELING_MCP_ARGS;
    let args: string[] = [];
    if (rawArgs && rawArgs.trim().length > 0) {
      const parsed: unknown = JSON.parse(rawArgs);
      if (!Array.isArray(parsed) || parsed.some((a) => typeof a !== 'string')) {
        throw new Error('PBI_MODELING_MCP_ARGS must be a JSON array of strings');
      }
      args = parsed as string[];
    }
    return { command, args, env: envStringRecord(env) };
  }
  if (platform === 'darwin') {
    return { command: 'bash', args: [defaultBridgePath(env)], env: envStringRecord(env) };
  }
  const version = env.PBI_MODELING_MCP_VERSION?.trim() || DEFAULT_MS_MCP_VERSION;
  return {
    command: 'npx',
    args: ['-y', `@microsoft/powerbi-modeling-mcp@${version}`, '--start'],
    env: envStringRecord(env),
  };
}

// Real factory: spawn the subprocess over stdio and connect an SDK Client.
export const defaultClientFactory: ClientFactory = async (config, onClose) => {
  const transport = new StdioClientTransport({
    command: config.command,
    args: [...config.args],
    env: config.env ? { ...config.env } : undefined,
  });
  transport.onclose = () => onClose();
  transport.onerror = () => onClose();

  const client = new Client(
    { name: 'pbi-mcp-ts-model-bridge', version: '0.4.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client as unknown as McpClientLike;
};

// Lazy-singleton wrapper around one Microsoft-MCP client connection.
export class MsMcpClient {
  #client: McpClientLike | null = null;
  #pending: Promise<McpClientLike> | null = null;
  readonly #factory: ClientFactory;
  readonly #config: MsMcpSpawnConfig;

  constructor(factory: ClientFactory, config: MsMcpSpawnConfig) {
    this.#factory = factory;
    this.#config = config;
  }

  // Connect on first use; reuse the live client; dedupe concurrent connects.
  async get(): Promise<McpClientLike> {
    if (this.#client) return this.#client;
    if (this.#pending) return this.#pending;
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

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const client = await this.get();
    return client.callTool({ name, arguments: args });
  }

  // Drop the cached client so the next call re-spawns. Fired by the transport
  // on close/error, or callable directly (e.g. on a reachability error).
  reset(): void {
    const client = this.#client;
    this.#client = null;
    this.#pending = null;
    if (client) void client.close().catch(() => undefined);
  }
}

let singleton: MsMcpClient | null = null;

export function getMsMcpClient(): MsMcpClient {
  if (!singleton) {
    singleton = new MsMcpClient(defaultClientFactory, resolveSpawnConfig());
  }
  return singleton;
}

// Test/teardown hook.
export function resetMsMcpClientSingleton(): void {
  singleton?.reset();
  singleton = null;
}
