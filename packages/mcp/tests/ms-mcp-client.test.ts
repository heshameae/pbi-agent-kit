import { describe, expect, it, vi } from 'vitest';
import {
  type ClientFactory,
  DEFAULT_MS_MCP_VERSION,
  type McpClientLike,
  MsMcpClient,
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
  it('defaults to npx with the pinned version', () => {
    const cfg = resolveSpawnConfig({});
    expect(cfg.command).toBe('npx');
    expect(cfg.args).toContain(`@microsoft/powerbi-modeling-mcp@${DEFAULT_MS_MCP_VERSION}`);
    expect(cfg.args).toContain('--start');
  });

  it('honors an explicit command + JSON args override (the Parallels bridge)', () => {
    const cfg = resolveSpawnConfig({
      PBI_MODELING_MCP_COMMAND: 'bash',
      PBI_MODELING_MCP_ARGS: '["scripts/pbi-mcp-bridge.sh"]',
    });
    expect(cfg.command).toBe('bash');
    expect(cfg.args).toEqual(['scripts/pbi-mcp-bridge.sh']);
  });

  it('honors a version override', () => {
    const cfg = resolveSpawnConfig({ PBI_MODELING_MCP_VERSION: '9.9.9' });
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
