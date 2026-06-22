import { describe, expect, it, vi } from 'vitest';
import {
  type ClientFactory,
  DEFAULT_MS_MCP_VERSION,
  type McpClientLike,
  MsMcpClient,
  defaultClientFactory,
  resolveSpawnConfig,
} from '../src/model-bridge/ms-mcp-client.js';

function mockClient(): McpClientLike & { closed: number } {
  return {
    closed: 0,
    async callTool({ name, arguments: args }) {
      return { structuredContent: { name, args }, content: [] };
    },
    async close() {
      this.closed += 1;
    },
  };
}

describe('resolveSpawnConfig', () => {
  it('auto-resolves a locally vendored exe on Windows without any env var', () => {
    const exe = 'C:\\plugin\\vendor\\powerbi-modeling-mcp\\package\\dist\\powerbi-modeling-mcp.exe';
    const cfg = resolveSpawnConfig({}, 'win32', () => exe);
    expect(cfg.command).toBe(exe);
    expect(cfg.args).toEqual(['--start', '--skipconfirmation']);
    expect(cfg.deferredError).toBeUndefined();
  });

  it('honors PBI_MODELING_MCP_ARGS over the default for a vendored exe', () => {
    const cfg = resolveSpawnConfig(
      { PBI_MODELING_MCP_ARGS: '["--start"]' },
      'win32',
      () => '/x/mcp.exe',
    );
    expect(cfg.command).toBe('/x/mcp.exe');
    expect(cfg.args).toEqual(['--start']);
  });

  it('fails closed on native Windows when unconfigured: no silent npx, deferred error, no throw at resolve', () => {
    const cfg = resolveSpawnConfig({}, 'win32', () => undefined);
    // Resolving must NOT throw — offline folder-only reads still build the driver.
    expect(cfg.command).not.toBe('npx');
    // ...but actually spawning must fail closed with an actionable message.
    expect(cfg.deferredError).toMatch(/not configured/i);
  });

  it('defers the fail-closed throw to spawn time (defaultClientFactory)', async () => {
    const cfg = resolveSpawnConfig({}, 'win32', () => undefined);
    await expect(defaultClientFactory(cfg, () => undefined)).rejects.toThrow(/not configured/i);
  });

  it('allows the npx fallback on Windows only behind the explicit opt-in', () => {
    const cfg = resolveSpawnConfig(
      { PBI_AGENT_KIT_ALLOW_NPX_MS_MCP: '1' },
      'win32',
      () => undefined,
    );
    expect(cfg.command).toBe('npx');
    expect(cfg.args).toContain(`@microsoft/powerbi-modeling-mcp@${DEFAULT_MS_MCP_VERSION}`);
    expect(cfg.args).toContain('--start');
  });

  it('defaults to the Parallels bridge on macOS (no config needed)', () => {
    const cfg = resolveSpawnConfig({ CLAUDE_PLUGIN_ROOT: '/plug' }, 'darwin');
    expect(cfg.command).toBe('bash');
    expect(cfg.args).toEqual(['/plug/scripts/pbi-mcp-bridge.sh']);
  });

  it('honors an explicit command + JSON args override (wins on any platform)', () => {
    const cfg = resolveSpawnConfig(
      {
        PBI_MODELING_MCP_COMMAND: 'bash',
        PBI_MODELING_MCP_ARGS: '["scripts/pbi-mcp-bridge.sh"]',
      },
      'darwin',
    );
    expect(cfg.command).toBe('bash');
    expect(cfg.args).toEqual(['scripts/pbi-mcp-bridge.sh']);
  });

  it('honors a version override on Windows behind the npx opt-in', () => {
    const cfg = resolveSpawnConfig(
      { PBI_AGENT_KIT_ALLOW_NPX_MS_MCP: '1', PBI_MODELING_MCP_VERSION: '9.9.9' },
      'win32',
      () => undefined,
    );
    expect(cfg.args).toContain('@microsoft/powerbi-modeling-mcp@9.9.9');
  });

  it('rejects malformed args JSON', () => {
    expect(() =>
      resolveSpawnConfig({ PBI_MODELING_MCP_COMMAND: 'bash', PBI_MODELING_MCP_ARGS: '{not json' }),
    ).toThrow();
    expect(() =>
      resolveSpawnConfig({ PBI_MODELING_MCP_COMMAND: 'bash', PBI_MODELING_MCP_ARGS: '[1,2]' }),
    ).toThrow(/array of strings/);
  });
});

describe('MsMcpClient', () => {
  const config = { command: 'noop', args: [] };

  it('spawns once and reuses the connection', async () => {
    const factory = vi.fn<ClientFactory>(async () => mockClient());
    const bridge = new MsMcpClient(factory, config);

    const a = await bridge.get();
    const b = await bridge.get();

    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent connects', async () => {
    const factory = vi.fn<ClientFactory>(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return mockClient();
    });
    const bridge = new MsMcpClient(factory, config);

    const [a, b] = await Promise.all([bridge.get(), bridge.get()]);

    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('delegates callTool with name + arguments', async () => {
    const factory: ClientFactory = async () => mockClient();
    const bridge = new MsMcpClient(factory, config);

    const result = await bridge.callTool('measure_operations', {
      request: { operation: 'List' },
    });

    expect(result.structuredContent).toEqual({
      name: 'measure_operations',
      args: { request: { operation: 'List' } },
    });
  });

  it('re-spawns after the transport drops (onClose)', async () => {
    let onCloseHook: (() => void) | undefined;
    const factory = vi.fn<ClientFactory>(async (_cfg, onClose) => {
      onCloseHook = onClose;
      return mockClient();
    });
    const bridge = new MsMcpClient(factory, config);

    await bridge.get();
    expect(factory).toHaveBeenCalledTimes(1);

    // Transport drops (Desktop closed / pipe broken).
    onCloseHook?.();

    await bridge.get();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('closes the live client on reset', async () => {
    const client = mockClient();
    const bridge = new MsMcpClient(async () => client, config);

    await bridge.get();
    bridge.reset();
    // close is fire-and-forget; let the microtask run.
    await Promise.resolve();

    expect(client.closed).toBe(1);
  });

  it('clears the pending promise on a failed connect so the next call retries', async () => {
    let attempt = 0;
    const factory = vi.fn<ClientFactory>(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('spawn failed');
      return mockClient();
    });
    const bridge = new MsMcpClient(factory, config);

    await expect(bridge.get()).rejects.toThrow('spawn failed');
    await expect(bridge.get()).resolves.toBeDefined();
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
