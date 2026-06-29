import { afterEach, describe, expect, it } from 'vitest';
import {
  type ModelClient,
  ModelDriver,
  collectConnectionStrings,
  normalizeDaxResult,
  normalizeModelName,
  operationArgs,
  pickArray,
  redactConnectionSecrets,
} from '../src/model-bridge/model-driver.js';
import type { McpToolResult } from '../src/model-bridge/ms-mcp-client.js';

interface RecordedCall {
  name: string;
  args: Record<string, unknown>;
}

function makeClient(responses: Record<string, McpToolResult> = {}): ModelClient & {
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async callTool(name, args) {
      calls.push({ name, args });
      const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
      return responses[`${name}/${op}`] ?? { structuredContent: {} };
    },
  };
}

function json(value: unknown): McpToolResult {
  return { structuredContent: value, content: [] };
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  // biome-ignore lint/performance/noDelete: unsetting an env var needs delete; assigning undefined coerces to the string "undefined"
  delete process.env.PBI_MODELING_MCP_CONNECTION_STRING;
});

describe('operationArgs', () => {
  it('wraps List params under request.filter', () => {
    expect(operationArgs('List', { table: 'FactPrimary' })).toEqual({
      request: { operation: 'List', filter: { table: 'FactPrimary' } },
    });
  });
  it('spreads non-List params into request', () => {
    expect(operationArgs('Create', { definitions: [] })).toEqual({
      request: { operation: 'Create', definitions: [] },
    });
  });
  it('emits a bare request for no params', () => {
    expect(operationArgs('List')).toEqual({ request: { operation: 'List' } });
  });
});

describe('redactConnectionSecrets', () => {
  it('masks Data Source and Password', () => {
    const out = redactConnectionSecrets('Data Source=localhost:5123;Password=hunter2;X=1');
    expect(out).not.toContain('localhost:5123');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('Data Source=***');
    expect(out).toContain('Password=***');
  });
});

describe('pickArray', () => {
  it('returns arrays directly', () => {
    expect(pickArray([1, 2])).toEqual([1, 2]);
  });
  it('finds arrays under common keys', () => {
    expect(pickArray({ data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });
  it('falls back to any array-valued property', () => {
    expect(pickArray({ weird: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });
  it('returns empty for non-array payloads', () => {
    expect(pickArray({ a: 1 })).toEqual([]);
  });
});

describe('collectConnectionStrings', () => {
  it('extracts and dedupes connection strings from nested payloads', () => {
    const payload = {
      data: [
        { connectionString: 'Data Source=localhost:59186;Application Name=MCP' },
        { other: { dataSource: 'Data Source=localhost:59186;Application Name=MCP' } },
      ],
    };
    expect(collectConnectionStrings(payload)).toEqual([
      'Data Source=localhost:59186;Application Name=MCP',
    ]);
  });
});

describe('normalizeModelName', () => {
  it('normalizes Windows-style pbip and SemanticModel selectors', () => {
    expect(normalizeModelName('C:\\Users\\me\\Reports\\Sales.pbip')).toBe('sales');
    expect(normalizeModelName('C:\\Users\\me\\Reports\\Sales.SemanticModel\\definition')).toBe(
      'sales',
    );
  });
});

describe('ModelDriver.ensureConnection', () => {
  it('uses the env-pinned connection string (live)', async () => {
    process.env.PBI_MODELING_MCP_CONNECTION_STRING = 'Data Source=localhost:1234;';
    const client = makeClient();
    const driver = new ModelDriver(client);

    const info = await driver.ensureConnection();

    expect(info.mode).toBe('live');
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.name).toBe('connection_operations');
    expect(client.calls[0]?.args).toEqual({
      request: { operation: 'Connect', connectionString: 'Data Source=localhost:1234;' },
    });
  });

  it('connects to a single discovered live instance', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:59186;' }],
      }),
    });
    const driver = new ModelDriver(client);

    const info = await driver.ensureConnection();

    expect(info).toEqual({ mode: 'live', connectionString: 'Data Source=localhost:59186;' });
    expect(
      client.calls.map((c) => (c.args as { request: { operation: string } }).request.operation),
    ).toEqual(['ListLocalInstances', 'Connect']);
  });

  it('rejects an explicit model selector that does not match the only live instance', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:59186;' }],
      }),
    });
    const driver = new ModelDriver(client);

    await expect(driver.ensureConnection({ model: '61234' })).rejects.toThrow(
      /none uniquely matched model "61234"/i,
    );
    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual(['ListLocalInstances']);
  });

  it('throws on multiple instances with no hint to disambiguate', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [
          { connectionString: 'Data Source=localhost:1;' },
          { connectionString: 'Data Source=localhost:2;' },
        ],
      }),
    });
    const driver = new ModelDriver(client);
    await expect(driver.ensureConnection()).rejects.toThrow(/found 2 open/i);
  });

  it('connects to the matching instance when a model hint matches a databaseName', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [
          { connectionString: 'Data Source=localhost:1;', databaseName: 'ModelA' },
          { connectionString: 'Data Source=localhost:2;', databaseName: 'ModelB' },
        ],
      }),
    });
    const driver = new ModelDriver(client);

    const info = await driver.ensureConnection({ model: 'ModelB' });

    expect(info).toEqual({ mode: 'live', connectionString: 'Data Source=localhost:2;' });
    const connect = client.calls.find(
      (c) => (c.args as { request: { operation: string } }).request.operation === 'Connect',
    );
    expect((connect?.args as { request: Record<string, unknown> }).request).toEqual({
      operation: 'Connect',
      connectionString: 'Data Source=localhost:2;',
    });
  });

  it('matches via the connection-string Initial Catalog when no name field is present', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [
          { connectionString: 'Data Source=localhost:1;Initial Catalog=Sales;' },
          { connectionString: 'Data Source=localhost:2;Initial Catalog=Product;' },
        ],
      }),
    });
    const driver = new ModelDriver(client);

    const info = await driver.ensureConnection({ model: 'Product' });

    expect(info).toEqual({
      mode: 'live',
      connectionString: 'Data Source=localhost:2;Initial Catalog=Product;',
    });
  });

  it('matches by port when several unnamed instances are open', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [
          { connectionString: 'Data Source=localhost:59186;' },
          { connectionString: 'Data Source=localhost:61234;' },
        ],
      }),
    });
    const driver = new ModelDriver(client);

    const info = await driver.ensureConnection({ model: '61234' });

    expect(info).toEqual({ mode: 'live', connectionString: 'Data Source=localhost:61234;' });
    const connect = client.calls.find(
      (c) => (c.args as { request: { operation: string } }).request.operation === 'Connect',
    );
    expect((connect?.args as { request: Record<string, unknown> }).request).toEqual({
      operation: 'Connect',
      connectionString: 'Data Source=localhost:61234;',
    });
  });

  it('switches cached live connections when a later model selector targets a different port', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [
          { connectionString: 'Data Source=localhost:59186;' },
          { connectionString: 'Data Source=localhost:61234;' },
        ],
      }),
    });
    const driver = new ModelDriver(client);

    await driver.ensureConnection({ model: '59186' });
    const info = await driver.ensureConnection({ model: '61234' });

    expect(info).toEqual({ mode: 'live', connectionString: 'Data Source=localhost:61234;' });
    const connects = client.calls
      .filter((c) => (c.args as { request: { operation: string } }).request.operation === 'Connect')
      .map((c) => (c.args as { request: { connectionString: string } }).request.connectionString);
    expect(connects).toEqual(['Data Source=localhost:59186;', 'Data Source=localhost:61234;']);
  });

  it('does not let a cached folder connection mask a later live model selector', async () => {
    let discovery = 0;
    const client: ModelClient & { calls: RecordedCall[] } = {
      calls: [],
      async callTool(name, args) {
        this.calls.push({ name, args });
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (name === 'connection_operations' && op === 'ListLocalInstances') {
          discovery += 1;
          return discovery === 1
            ? json({ data: [] })
            : json({
                data: [{ connectionString: 'Data Source=localhost:61234;', databaseName: 'Model' }],
              });
        }
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);

    await driver.ensureConnection({ folderPath: '/x/Model.SemanticModel/definition' });
    const info = await driver.ensureConnection({ model: '61234' });

    expect(info).toEqual({ mode: 'live', connectionString: 'Data Source=localhost:61234;' });
    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual(['ListLocalInstances', 'ConnectFolder', 'ListLocalInstances', 'Connect']);
  });

  it('does not let a cached folder connection mask a later live-preferred folder selector', async () => {
    let discovery = 0;
    const client: ModelClient & { calls: RecordedCall[] } = {
      calls: [],
      async callTool(name, args) {
        this.calls.push({ name, args });
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (name === 'connection_operations' && op === 'ListLocalInstances') {
          discovery += 1;
          return discovery === 1
            ? json({ data: [] })
            : json({
                data: [{ connectionString: 'Data Source=localhost:61234;', databaseName: 'Model' }],
              });
        }
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);

    await driver.ensureConnection({ folderPath: '/x/Model.SemanticModel/definition' });
    const info = await driver.ensureConnection({
      folderPath: '/x/Model.SemanticModel/definition',
      livePreferred: true,
    });

    expect(info).toEqual({ mode: 'live', connectionString: 'Data Source=localhost:61234;' });
    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual(['ListLocalInstances', 'ConnectFolder', 'ListLocalInstances', 'Connect']);
  });

  it('does not let a cached folder connection mask a later live-preferred default selector', async () => {
    let discovery = 0;
    const client: ModelClient & { calls: RecordedCall[] } = {
      calls: [],
      async callTool(name, args) {
        this.calls.push({ name, args });
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (name === 'connection_operations' && op === 'ListLocalInstances') {
          discovery += 1;
          return discovery === 1
            ? json({ data: [] })
            : json({ data: [{ connectionString: 'Data Source=localhost:61234;' }] });
        }
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);

    await driver.ensureConnection({ folderPath: '/x/Model.SemanticModel/definition' });
    const info = await driver.ensureConnection({ livePreferred: true });

    expect(info).toEqual({ mode: 'live', connectionString: 'Data Source=localhost:61234;' });
    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual(['ListLocalInstances', 'ConnectFolder', 'ListLocalInstances', 'Connect']);
  });

  it('does not let a pending folder connection satisfy a concurrent live-preferred default selector', async () => {
    let discovery = 0;
    const connectFolderStarted = deferred();
    const releaseConnectFolder = deferred();
    const client: ModelClient & { calls: RecordedCall[] } = {
      calls: [],
      async callTool(name, args) {
        this.calls.push({ name, args });
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (name === 'connection_operations' && op === 'ListLocalInstances') {
          discovery += 1;
          return discovery === 1
            ? json({ data: [] })
            : json({ data: [{ connectionString: 'Data Source=localhost:61234;' }] });
        }
        if (name === 'connection_operations' && op === 'ConnectFolder') {
          connectFolderStarted.resolve();
          await releaseConnectFolder.promise;
        }
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);

    const folderConnection = driver.ensureConnection({
      folderPath: '/x/Model.SemanticModel/definition',
    });
    await connectFolderStarted.promise;
    const liveConnection = driver.ensureConnection({ livePreferred: true });
    releaseConnectFolder.resolve();

    await expect(folderConnection).resolves.toEqual({
      mode: 'folder',
      folderPath: '/x/Model.SemanticModel/definition',
    });
    await expect(liveConnection).resolves.toEqual({
      mode: 'live',
      connectionString: 'Data Source=localhost:61234;',
    });
    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual(['ListLocalInstances', 'ConnectFolder', 'ListLocalInstances', 'Connect']);
  });

  it('does not reuse a cached folder connection for a different same-named folder', async () => {
    const client = makeClient({ 'connection_operations/ListLocalInstances': json({ data: [] }) });
    const driver = new ModelDriver(client);

    await driver.ensureConnection({ folderPath: '/a/Sales.SemanticModel/definition' });
    const info = await driver.ensureConnection({
      folderPath: '/b/Sales.SemanticModel/definition',
    });

    expect(info).toEqual({ mode: 'folder', folderPath: '/b/Sales.SemanticModel/definition' });
    const connectFolders = client.calls
      .filter(
        (c) => (c.args as { request: { operation: string } }).request.operation === 'ConnectFolder',
      )
      .map((c) => (c.args as { request: { folderPath: string } }).request.folderPath);
    expect(connectFolders).toEqual([
      '/a/Sales.SemanticModel/definition',
      '/b/Sales.SemanticModel/definition',
    ]);
  });

  it('matches a folder-derived model hint to a discovered live instance', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [
          { connectionString: 'Data Source=localhost:1;', databaseName: 'FactPrimary' },
          { connectionString: 'Data Source=localhost:2;', databaseName: 'DimShared' },
        ],
      }),
    });
    const driver = new ModelDriver(client);

    const info = await driver.ensureConnection({
      folderPath: '/x/DimShared.SemanticModel/definition',
    });

    expect(info).toEqual({ mode: 'live', connectionString: 'Data Source=localhost:2;' });
  });

  it('throws with the candidate list when the hint matches no instance', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [
          { connectionString: 'Data Source=localhost:1;', databaseName: 'ModelA' },
          { connectionString: 'Data Source=localhost:2;', databaseName: 'ModelB' },
        ],
      }),
    });
    const driver = new ModelDriver(client);
    await expect(driver.ensureConnection({ model: 'ModelZ' })).rejects.toThrow(/found 2 open/i);
    // Never leaks a raw connection string (Data Source= is a secret).
    await expect(driver.ensureConnection({ model: 'ModelZ' })).rejects.not.toThrow(
      /Data Source=localhost/,
    );
  });

  it('throws when the hint matches more than one instance', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [
          { connectionString: 'Data Source=localhost:1;', databaseName: 'Sales' },
          { connectionString: 'Data Source=localhost:2;', databaseName: 'Sales' },
        ],
      }),
    });
    const driver = new ModelDriver(client);
    await expect(driver.ensureConnection({ model: 'Sales' })).rejects.toThrow(/found 2 open/i);
  });

  it('falls back to ConnectFolder when a folderPath is given and no live instance is open', async () => {
    const client = makeClient({ 'connection_operations/ListLocalInstances': json({ data: [] }) });
    const driver = new ModelDriver(client);

    const info = await driver.ensureConnection({ folderPath: '/x/Model.SemanticModel/definition' });

    expect(info.mode).toBe('folder');
    expect(info.folderPath).toBe('/x/Model.SemanticModel/definition');
    // Live-first: probe for a live instance, then fall back to folder when none.
    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual(['ListLocalInstances', 'ConnectFolder']);
    // ConnectFolder must use the MS-MCP param key `folderPath`, NOT `path`
    // (sending `path` is what produced "Missing required parameters").
    const connectFolder = client.calls.find(
      (c) => (c.args as { request: { operation: string } }).request.operation === 'ConnectFolder',
    );
    expect((connectFolder?.args as { request: Record<string, unknown> }).request).toEqual({
      operation: 'ConnectFolder',
      folderPath: '/x/Model.SemanticModel/definition',
    });
  });

  it('prefers a live instance over a supplied folderPath (live-first)', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:59186;', databaseName: 'Model' }],
      }),
    });
    const driver = new ModelDriver(client);

    // Even though a folderPath is supplied, an open Desktop instance wins.
    const info = await driver.ensureConnection({ folderPath: '/x/Model.SemanticModel/definition' });

    expect(info.mode).toBe('live');
    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual(['ListLocalInstances', 'Connect']);
    expect(ops).not.toContain('ConnectFolder');
  });

  it('refuses a single live instance that does not match the supplied folderPath hint', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:59186;', databaseName: 'OtherModel' }],
      }),
    });
    const driver = new ModelDriver(client);

    await expect(
      driver.ensureConnection({ folderPath: '/x/Model.SemanticModel/definition' }),
    ).rejects.toThrow(/none uniquely matched model "model"/i);

    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual(['ListLocalInstances']);
  });

  it('can force a folder connection without a second live discovery', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:59186;', databaseName: 'OtherModel' }],
      }),
    });
    const driver = new ModelDriver(client);

    const info = await driver.ensureConnection({
      folderPath: '/x/Model.SemanticModel/definition',
      forceFolder: true,
    });

    expect(info).toEqual({ mode: 'folder', folderPath: '/x/Model.SemanticModel/definition' });
    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual(['ConnectFolder']);
  });

  it('rebinds to the expected gated connection before a write if another call switched targets', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:59186;', databaseName: 'Other' }],
      }),
      'measure_operations/Create': json({ ok: true }),
    });
    const driver = new ModelDriver(client);

    await driver.ensureConnection({
      folderPath: '/x/Model.SemanticModel/definition',
      forceFolder: true,
    });
    const gatedConnection = driver.connection;
    if (!gatedConnection) throw new Error('Expected gated folder connection');
    await driver.ensureConnection({ model: 'Other' });

    await driver.createMeasure(
      { tableName: 'Fact', name: 'Total', expression: '1' },
      gatedConnection,
    );

    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual([
      'ConnectFolder',
      'ListLocalInstances',
      'Connect',
      'ConnectFolder',
      'Create',
    ]);
  });

  it('rebinds to the expected gated connection before a snapshot read', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [
          { connectionString: 'Data Source=localhost:1;', databaseName: 'ModelA' },
          { connectionString: 'Data Source=localhost:2;', databaseName: 'ModelB' },
        ],
      }),
      'table_operations/List': json({ data: [{ name: 'Fact' }] }),
      'column_operations/List': json({ data: [] }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    await driver.ensureConnection({ model: 'ModelA' });
    const gatedConnection = driver.connection;
    if (!gatedConnection) throw new Error('Expected gated live connection');
    await driver.ensureConnection({ model: 'ModelB' });

    await driver.getModelSnapshot(
      '(live)',
      { includeMeasures: false, includeRoles: false },
      gatedConnection,
    );

    const ops = client.calls.map(
      (c) => (c.args as { request: { operation: string } }).request.operation,
    );
    expect(ops).toEqual([
      'ListLocalInstances',
      'Connect',
      'ListLocalInstances',
      'Connect',
      'Connect',
      'List',
      'List',
      'List',
    ]);
    const connects = client.calls
      .filter((c) => (c.args as { request: { operation: string } }).request.operation === 'Connect')
      .map((c) => (c.args as { request: { connectionString: string } }).request.connectionString);
    expect(connects).toEqual([
      'Data Source=localhost:1;',
      'Data Source=localhost:2;',
      'Data Source=localhost:1;',
    ]);
  });

  it('does not retarget the shared connection while a bound write is in flight', async () => {
    const createStarted = deferred();
    const releaseCreate = deferred();
    const calls: RecordedCall[] = [];
    const client: ModelClient & { calls: RecordedCall[] } = {
      calls,
      async callTool(name, args) {
        calls.push({ name, args });
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (name === 'connection_operations' && op === 'ListLocalInstances') {
          return json({
            data: [{ connectionString: 'Data Source=localhost:2;', databaseName: 'Other' }],
          });
        }
        if (name === 'measure_operations' && op === 'Create') {
          createStarted.resolve();
          await releaseCreate.promise;
          return json({ ok: true });
        }
        return json({ ok: true });
      },
    };
    const driver = new ModelDriver(client);

    await driver.ensureConnection({
      folderPath: '/x/Model.SemanticModel/definition',
      forceFolder: true,
    });
    const gatedConnection = driver.connection;
    if (!gatedConnection) throw new Error('Expected gated folder connection');

    const write = driver.createMeasure(
      { tableName: 'Fact', name: 'Total', expression: '1' },
      gatedConnection,
    );
    await createStarted.promise;
    const retarget = driver.ensureConnection({ model: 'Other' });
    await Promise.resolve();

    expect(
      calls.map((c) => (c.args as { request: { operation: string } }).request.operation),
    ).toEqual(['ConnectFolder', 'Create']);

    releaseCreate.resolve();
    await write;
    await retarget;

    expect(
      calls.map((c) => (c.args as { request: { operation: string } }).request.operation),
    ).toEqual(['ConnectFolder', 'Create', 'ListLocalInstances', 'Connect']);
  });

  it('throws when no instance and no folderPath', async () => {
    const client = makeClient({ 'connection_operations/ListLocalInstances': json({ data: [] }) });
    const driver = new ModelDriver(client);
    await expect(driver.ensureConnection()).rejects.toThrow(/No open Power BI Desktop instance/);
  });

  it('wraps a discovery failure (MS MCP unreachable) in a clear message', async () => {
    const client: ModelClient = {
      async callTool(name) {
        if (name === 'connection_operations') throw new Error('spawn ENOENT');
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);
    await expect(driver.ensureConnection()).rejects.toThrow(/Live modeling requires Windows/);
  });
});

describe('ModelDriver.getModelSnapshot', () => {
  it('lists live table inventory without hydrating columns, measures, or relationships', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [{ name: 'FactPrimary', description: 'Fact table.', mode: 'Import' }],
      }),
      'column_operations/List': {
        isError: true,
        content: [{ type: 'text', text: 'columns should not be listed' }],
      },
      'measure_operations/List': {
        isError: true,
        content: [{ type: 'text', text: 'measures should not be listed' }],
      },
      'relationship_operations/List': {
        isError: true,
        content: [{ type: 'text', text: 'relationships should not be listed' }],
      },
    });
    const driver = new ModelDriver(client);

    const tables = await driver.listTableInventoryRaw();

    expect(tables).toEqual([
      {
        name: 'FactPrimary',
        description: 'Fact table.',
        storageMode: 'import',
        isHidden: false,
        isCalculated: false,
        isAutoDateTable: false,
      },
    ]);
    const calledTools = client.calls.map((c) => c.name);
    expect(calledTools).toContain('table_operations');
    expect(calledTools).not.toContain('column_operations');
    expect(calledTools).not.toContain('measure_operations');
    expect(calledTools).not.toContain('relationship_operations');
  });

  it('assembles a TMDLModel from live List output (defensive field names)', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [
          {
            name: 'FactPrimary',
            dataCategory: 'Time',
            expression:
              "CALENDAR(MINX('FactPrimary', 'FactPrimary'[OrderDate]), MAXX('FactPrimary', 'FactPrimary'[OrderDate]))",
          },
          { name: 'DimShared' },
        ],
      }),
      // Live column List is grouped per table with a nested `columns` array.
      'column_operations/List': json({
        data: [
          {
            tableName: 'FactPrimary',
            columns: [
              { name: 'ValueMetric', dataType: 'double', formatString: '#,0.00' },
              { name: 'OrderDate', dataType: 'dateTime', dataCategory: 'Time' },
            ],
          },
          { tableName: 'DimShared', columns: [{ name: 'SharedAxis', dataType: 'string' }] },
        ],
      }),
      // Live List is names-only; getModelSnapshot enriches via a batched Get
      // whose real shape is { results: [{ success, data: { ...measure } }] }.
      'measure_operations/List': json({ data: [{ name: 'Total Value', description: 'x' }] }),
      'measure_operations/Get': json({
        results: [
          {
            success: true,
            data: {
              tableName: 'FactPrimary',
              name: 'Total Value',
              expression: 'SUM(FactPrimary[ValueMetric])',
              formatString: '0',
            },
          },
        ],
      }),
      'relationship_operations/List': json({
        data: [
          {
            fromTable: 'FactPrimary',
            fromColumn: 'SharedKey',
            toTable: 'DimShared',
            toColumn: 'SharedAxis',
            isActive: true,
            crossFilteringBehavior: 'single',
            fromCardinality: 'many',
            toCardinality: 'one',
          },
        ],
      }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();

    expect(model.tables.map((t) => t.name).sort()).toEqual(['DimShared', 'FactPrimary']);
    const fact = model.tables.find((t) => t.name === 'FactPrimary');
    expect(fact?.columns.map((c) => c.name)).toEqual(['ValueMetric', 'OrderDate']);
    expect(fact?.measures.map((m) => m.name)).toEqual(['Total Value']);
    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0]?.id).toBe('rel_0');
    expect(model.relationships[0]?.identityProven).toBe(false);
    expect(model.relationships[0]?.toTable).toBe('DimShared');
  });

  it('hydrates measures whose List payload names are keyed by id or displayName', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [{ name: 'Sales', measureCount: 2 }],
      }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({
        data: [{ displayName: 'Total Profit' }, { id: 'Order Count' }],
      }),
      'measure_operations/Get': json({
        results: [
          {
            success: true,
            data: {
              tableName: 'Sales',
              displayName: 'Total Profit',
              expression: 'SUM(Sales[Profit])',
            },
          },
          {
            success: true,
            data: {
              table: 'Sales',
              id: 'Order Count',
              expression: 'COUNTROWS(Sales)',
            },
          },
        ],
      }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();

    expect(model.tables[0]?.measures).toEqual([
      expect.objectContaining({
        table: 'Sales',
        name: 'Total Profit',
        expression: 'SUM(Sales[Profit])',
      }),
      expect.objectContaining({
        table: 'Sales',
        name: 'Order Count',
        expression: 'COUNTROWS(Sales)',
      }),
    ]);
    const getCall = client.calls.find(
      (call) =>
        call.name === 'measure_operations' &&
        (call.args as { request?: { operation?: string } }).request?.operation === 'Get',
    );
    expect((getCall?.args as { request?: { references?: unknown } }).request?.references).toEqual([
      { name: 'Total Profit' },
      { name: 'Order Count' },
    ]);
  });

  it('falls back to nested table measures when measure List enumeration is empty', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [
          {
            name: 'Sales',
            measures: [
              { displayName: 'Total Profit', expression: 'SUM(Sales[Profit])' },
              { id: 'Order Count', expression: 'COUNTROWS(Sales)' },
            ],
          },
        ],
      }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [] }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();

    expect(model.tables[0]?.measures.map((measure) => measure.name)).toEqual([
      'Total Profit',
      'Order Count',
    ]);
    expect(model.tables[0]?.measures.map((measure) => measure.expression)).toEqual([
      'SUM(Sales[Profit])',
      'COUNTROWS(Sales)',
    ]);
    expect(
      client.calls.some(
        (call) =>
          call.name === 'measure_operations' &&
          (call.args as { request?: { operation?: string } }).request?.operation === 'Get',
      ),
    ).toBe(false);
  });

  it('degrades (does not throw) and flags measuresCaptured:false when measure names are unparseable', async () => {
    // Table inventory proves 2 measures exist, but the measure-list payload uses
    // an unrecognized name key. Enumeration must NOT throw (that would block all
    // writes); it degrades to an empty measure set flagged measuresCaptured:false.
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [{ name: 'Sales', measureCount: 2 }],
      }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({
        data: [{ objectId: 'm1' }, { objectId: 'm2' }],
      }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();
    expect(model.measuresCaptured).toBe(false);
    expect(model.tables.flatMap((t) => t.measures)).toEqual([]);
  });

  it('falls back to INFO.VIEW.MEASURES() (DAX) when the measure payload is unparseable', async () => {
    // measure_operations/List names cannot be parsed, but the version-independent
    // DAX INFO query returns the measures with bracketed column keys.
    const measuresEnvelope = {
      success: true,
      data: {
        columns: [{ name: '[Name]' }, { name: '[Table]' }, { name: '[Expression]' }],
        rows: [
          ['Total Profit', 'Sales', "SUM('Sales'[Profit])"],
          ['Profit YTD', 'Sales', "CALCULATE([Total Profit], DATESYTD('Date'[Date]))"],
        ],
        rowCount: 2,
      },
    };
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'Sales', measureCount: 2 }] }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [{ objectId: 'm1' }, { objectId: 'm2' }] }),
      'dax_query_operations/Execute': {
        content: [{ type: 'text', text: JSON.stringify(measuresEnvelope) }],
      },
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();
    expect(model.measuresCaptured).toBe(true);
    const sales = model.tables.find((t) => t.name === 'Sales');
    expect(sales?.measures.map((m) => m.name).sort()).toEqual(['Profit YTD', 'Total Profit']);
    expect(sales?.measures.find((m) => m.name === 'Total Profit')?.expression).toBe(
      "SUM('Sales'[Profit])",
    );
  });

  it('degrades to measuresCaptured:false when both the payload and the DAX fallback fail', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'Sales', measureCount: 2 }] }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [{ objectId: 'm1' }, { objectId: 'm2' }] }),
      'dax_query_operations/Execute': {
        isError: true,
        content: [{ type: 'text', text: 'no INFO' }],
      },
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();
    expect(model.measuresCaptured).toBe(false);
    expect(model.tables.flatMap((t) => t.measures)).toEqual([]);
  });

  it('flags measuresCaptured:true when every reported measure is enumerated', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'Sales', measureCount: 1 }] }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [{ name: 'Total', tableName: 'Sales' }] }),
      'measure_operations/Get': json({
        results: [{ success: true, data: { name: 'Total', tableName: 'Sales', expression: '1' } }],
      }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();
    expect(model.measuresCaptured).toBe(true);
    expect(model.tables.find((t) => t.name === 'Sales')?.measures.map((m) => m.name)).toEqual([
      'Total',
    ]);
  });

  it('uses table owner variants from enriched measures instead of dropping hydrated names', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [{ id: 'tbl-sales', name: 'Sales', displayName: 'Sales', measureCount: 2 }],
      }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({
        data: [{ displayName: 'Total Profit' }, { displayName: 'Order Count' }],
      }),
      'measure_operations/Get': json({
        results: [
          {
            success: true,
            data: {
              displayName: 'Total Profit',
              tableDisplayName: 'Sales',
              expression: 'SUM(Sales[Profit])',
            },
          },
          {
            success: true,
            data: {
              displayName: 'Order Count',
              tableId: 'tbl-sales',
              expression: 'COUNTROWS(Sales)',
            },
          },
        ],
      }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();

    expect(model.tables[0]?.measures).toEqual([
      expect.objectContaining({ table: 'Sales', name: 'Total Profit' }),
      expect.objectContaining({ table: 'Sales', name: 'Order Count' }),
    ]);
  });

  it('dedupes enriched and nested measures after table-owner alias canonicalization', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [
          {
            id: 'tbl-sales',
            name: 'Sales',
            measureCount: 1,
            measures: [
              { tableName: 'Sales', name: 'Total Profit', expression: 'SUM(Sales[Profit])' },
            ],
          },
        ],
      }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({
        data: [{ displayName: 'Total Profit' }],
      }),
      'measure_operations/Get': json({
        results: [
          {
            success: true,
            data: {
              displayName: 'Total Profit',
              tableId: 'tbl-sales',
              expression: 'SUM(Sales[Profit])',
            },
          },
        ],
      }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();

    expect(model.tables[0]?.measures).toHaveLength(1);
    expect(model.tables[0]?.measures[0]).toEqual(
      expect.objectContaining({ table: 'Sales', name: 'Total Profit' }),
    );
  });

  it('degrades (measuresCaptured:false) when measure Get yields no usable hydrated measures', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [{ name: 'Sales', measureCount: 1 }],
      }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({
        data: [{ displayName: 'Total Profit' }],
      }),
      'measure_operations/Get': json({
        results: [{ success: false, error: 'not found' }],
      }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();
    expect(model.measuresCaptured).toBe(false);
  });

  it('degrades (measuresCaptured:false) when fewer usable measures enumerate than table counts', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [{ name: 'Sales', measureCount: 2 }],
      }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({
        data: [{ displayName: 'Total Profit' }],
      }),
      'measure_operations/Get': json({
        results: [
          {
            success: true,
            data: {
              tableName: 'Sales',
              displayName: 'Total Profit',
              expression: 'SUM(Sales[Profit])',
            },
          },
        ],
      }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    // One of two measures hydrated: best-effort returns it, flagged incomplete.
    const model = await driver.getModelSnapshot();
    expect(model.measuresCaptured).toBe(false);
    expect(model.tables.find((t) => t.name === 'Sales')?.measures.map((m) => m.name)).toEqual([
      'Total Profit',
    ]);
  });

  it('captures column dataCategory + formatString and a precise relationship cardinality', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [
          {
            name: 'FactPrimary',
            dataCategory: 'Time',
            expression:
              "CALENDAR(MINX('FactPrimary', 'FactPrimary'[OrderDate]), MAXX('FactPrimary', 'FactPrimary'[OrderDate]))",
          },
          { name: 'DimShared' },
        ],
      }),
      'column_operations/List': json({
        data: [
          {
            tableName: 'FactPrimary',
            columns: [
              { name: 'ValueMetric', dataType: 'double', formatString: '#,0.00' },
              { name: 'OrderDate', dataType: 'dateTime', dataCategory: 'Time' },
            ],
          },
          { tableName: 'DimShared', columns: [{ name: 'SharedAxis', dataType: 'string' }] },
        ],
      }),
      'measure_operations/List': json({ data: [] }),
      'relationship_operations/List': json({
        data: [
          {
            fromTable: 'FactPrimary',
            fromColumn: 'SharedKey',
            toTable: 'DimShared',
            toColumn: 'SharedAxis',
            isActive: true,
            crossFilteringBehavior: 'single',
            // A normal 1:many edge — MUST resolve to manyToOne (not manyToMany).
            fromCardinality: 'many',
            toCardinality: 'one',
          },
        ],
      }),
    });
    const driver = new ModelDriver(client);
    const model = await driver.getModelSnapshot();

    const fact = model.tables.find((t) => t.name === 'FactPrimary');
    expect(fact?.dataCategory).toBe('Time');
    expect(fact?.expression).toContain('CALENDAR');
    const valueMetric = fact?.columns.find((c) => c.name === 'ValueMetric');
    const orderDate = fact?.columns.find((c) => c.name === 'OrderDate');
    expect(valueMetric?.formatString).toBe('#,0.00');
    expect(orderDate?.dataCategory).toBe('Time');
    expect(model.relationships[0]?.cardinality).toBe('manyToOne');
  });

  it('leaves live relationship cardinality undefined when endpoint cardinality metadata is absent', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [{ name: 'FactPrimary' }, { name: 'DimShared' }],
      }),
      'column_operations/List': json({
        data: [
          { tableName: 'FactPrimary', columns: [{ name: 'SharedKey', dataType: 'string' }] },
          { tableName: 'DimShared', columns: [{ name: 'SharedAxis', dataType: 'string' }] },
        ],
      }),
      'measure_operations/List': json({ data: [] }),
      'relationship_operations/List': json({
        data: [
          {
            fromTable: 'FactPrimary',
            fromColumn: 'SharedKey',
            toTable: 'DimShared',
            toColumn: 'SharedAxis',
            isActive: true,
            crossFilteringBehavior: 'single',
          },
        ],
      }),
    });
    const driver = new ModelDriver(client);
    const model = await driver.getModelSnapshot();

    expect(model.relationships[0]?.cardinality).toBeUndefined();
  });

  it('does not treat missing live column dataType as proven string metadata', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'FactPrimary' }] }),
      'column_operations/List': json({
        data: [{ tableName: 'FactPrimary', name: 'UnspecifiedType' }],
      }),
      'measure_operations/List': json({ data: [] }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();

    expect(model.tables[0]?.columns[0]?.dataType).toBe('unknown');
  });

  // --- Wave-2 metadata capture (M1-M6) ---------------------------------------
  // NOTE: every payload key fed here is the ASSUMED MS-MCP key (// UNVERIFIED in
  // the driver) — these tests assert the assumed-key WIRING. The real key names
  // await a live Windows Desktop payload capture.

  // M1 — calc-column expression (assumed key `daxExpression`, proven by the
  // WRITE path) + M3 sortByColumn/isAvailableInMDX + M4/M5 column description/
  // displayFolder.
  it('captures calc-column expression, sortByColumn, isAvailableInMDX, description, displayFolder', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'Date' }] }),
      'column_operations/List': json({
        data: [
          {
            tableName: 'Date',
            columns: [
              {
                name: 'Margin',
                dataType: 'decimal',
                isCalculated: true,
                daxExpression: '[Price] - [Cost]',
                description: 'Unit margin.',
                displayFolder: 'Calculations',
              },
              {
                name: 'Month',
                dataType: 'string',
                sortByColumn: 'MonthNo',
                isAvailableInMDX: false,
              },
              // No sort-by / MDX keys → isAvailableInMdx must stay undefined.
              { name: 'MonthNo', dataType: 'int64' },
            ],
          },
        ],
      }),
      'measure_operations/List': json({ data: [] }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);
    const model = await driver.getModelSnapshot();

    const cols = model.tables.find((t) => t.name === 'Date')?.columns ?? [];
    const margin = cols.find((c) => c.name === 'Margin');
    expect(margin?.expression).toBe('[Price] - [Cost]');
    expect(margin?.description).toBe('Unit margin.');
    expect(margin?.displayFolder).toBe('Calculations');

    const month = cols.find((c) => c.name === 'Month');
    expect(month?.sortByColumn).toBe('MonthNo');
    expect(month?.isAvailableInMdx).toBe(false);

    const monthNo = cols.find((c) => c.name === 'MonthNo');
    expect(monthNo?.isAvailableInMdx).toBeUndefined();
  });

  // M4 (table) + M5 (measure displayFolder) + M6 (table storageMode, relationship Assume-RI).
  it('captures table description/storageMode, measure displayFolder, relationship Assume-RI', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({
        data: [
          { name: 'Sales', description: 'Fact table.', mode: 'DirectQuery' },
          { name: 'Customer' },
        ],
      }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [{ name: 'Total', description: 'x' }] }),
      'measure_operations/Get': json({
        results: [
          {
            success: true,
            data: {
              tableName: 'Sales',
              name: 'Total',
              expression: 'SUM(Sales[Amount])',
              displayFolder: 'KPIs',
            },
          },
        ],
      }),
      'relationship_operations/List': json({
        data: [
          {
            fromTable: 'Sales',
            fromColumn: 'CustomerKey',
            toTable: 'Customer',
            toColumn: 'CustomerKey',
            relyOnReferentialIntegrity: true,
          },
          // No Assume-RI key → must stay undefined (keeps MOD028 gated).
          {
            fromTable: 'Sales',
            fromColumn: 'OtherKey',
            toTable: 'Customer',
            toColumn: 'OtherKey',
          },
        ],
      }),
    });
    const driver = new ModelDriver(client);
    const model = await driver.getModelSnapshot();

    const sales = model.tables.find((t) => t.name === 'Sales');
    expect(sales?.description).toBe('Fact table.');
    expect(sales?.storageMode).toBe('directQuery');
    expect(sales?.measures.find((m) => m.name === 'Total')?.displayFolder).toBe('KPIs');

    expect(model.relationships[0]?.relyOnReferentialIntegrity).toBe(true);
    expect(model.relationships[1]?.relyOnReferentialIntegrity).toBeUndefined();
  });

  it('normalizes live relationship cross-filter payloads from MS MCP names', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'FactPrimary' }, { name: 'DimShared' }] }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [] }),
      'relationship_operations/List': json({
        data: [
          {
            fromTable: 'FactPrimary',
            fromColumn: 'SharedKey',
            toTable: 'DimShared',
            toColumn: 'SharedKey',
            crossFilteringBehavior: 'BothDirections',
          },
        ],
      }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();

    expect(model.relationships[0]?.crossFilteringBehavior).toBe('both');
  });

  // M2 — RLS roles assembled from the Microsoft Modeling MCP security role surface.
  it('captures RLS roles from the security_role_operations List op', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'Customer' }] }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [] }),
      'relationship_operations/List': json({ data: [] }),
      'security_role_operations/List': json({
        data: [
          {
            name: 'Manager',
            tablePermissions: [
              { table: 'Customer', filterExpression: '[Country] = "US"' },
              // Permission with no table is dropped.
              { filterExpression: 'ignored' },
            ],
          },
          // Role with no name is dropped.
          { tablePermissions: [{ table: 'X', filterExpression: '1' }] },
        ],
      }),
    });
    const driver = new ModelDriver(client);
    const model = await driver.getModelSnapshot();

    expect(model.roles?.length).toBe(1);
    expect(model.roles?.[0]?.name).toBe('Manager');
    expect(model.roles?.[0]?.tablePermissions).toEqual([
      { table: 'Customer', filterExpression: '[Country] = "US"' },
    ]);
  });

  // M2 degradation — no role_operations response (the makeClient default
  // `{ structuredContent: {} }`) ⇒ model.roles is undefined and the snapshot
  // still assembles tables/relationships. The roles read is also wrapped in
  // try/catch so an op that THROWS degrades the same way.
  it('omits roles and still assembles when the roles op returns nothing', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'FactPrimary' }, { name: 'DimShared' }] }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [] }),
      'relationship_operations/List': json({
        data: [
          {
            fromTable: 'FactPrimary',
            fromColumn: 'K',
            toTable: 'DimShared',
            toColumn: 'K',
          },
        ],
      }),
      // No security_role_operations/List entry → makeClient returns {} → pickArray [].
    });
    const driver = new ModelDriver(client);
    const model = await driver.getModelSnapshot();

    expect(model.roles).toEqual([]);
    expect(model.rolesCaptured).toBe(true);
    // Snapshot still fully assembled.
    expect(model.tables.map((t) => t.name).sort()).toEqual(['DimShared', 'FactPrimary']);
    expect(model.relationships).toHaveLength(1);
  });

  // M2 degradation — a roles op that THROWS must not break getModelSnapshot.
  it('degrades to no roles key when the roles op throws', async () => {
    const client: ModelClient = {
      async callTool(name, args) {
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (name === 'connection_operations' && op === 'ListLocalInstances') {
          return {
            structuredContent: { data: [{ connectionString: 'Data Source=localhost:1;' }] },
          };
        }
        if (name === 'table_operations' && op === 'List') {
          return { structuredContent: { data: [{ name: 'FactPrimary' }] } };
        }
        if (name === 'security_role_operations') {
          throw new Error('invalid operation: security_role_operations is not supported');
        }
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);
    const model = await driver.getModelSnapshot();
    expect(model.roles).toBeUndefined();
    expect(model.tables.map((t) => t.name)).toEqual(['FactPrimary']);
  });

  it('binds fast table inventory reads to the selected expected connection', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [
          { connectionString: 'Data Source=localhost:1;', databaseName: 'ModelA' },
          { connectionString: 'Data Source=localhost:2;', databaseName: 'ModelB' },
        ],
      }),
      'table_operations/List': json({ data: [{ name: 'SelectedModelTable' }] }),
    });
    const driver = new ModelDriver(client);
    const selected = await driver.ensureConnection({ model: 'ModelB' });
    await driver.ensureConnection({ model: 'ModelA' });

    const tables = await driver.listTableInventoryRaw(selected);

    expect(tables.map((table) => table.name)).toEqual(['SelectedModelTable']);
    const connectCalls = client.calls.filter(
      (call) => call.name === 'connection_operations' && call.args.request?.operation === 'Connect',
    );
    expect(connectCalls.at(-1)?.args).toEqual({
      request: { operation: 'Connect', connectionString: 'Data Source=localhost:2;' },
    });
  });
});

describe('ModelDriver writes', () => {
  const liveClient = () =>
    makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
    });
  const opCall = (calls: RecordedCall[], op: string) =>
    calls.find((c) => (c.args as { request?: { operation?: string } }).request?.operation === op);

  it('createMeasure sends a Create with one definition', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createMeasure({
      tableName: 'FactPrimary',
      name: 'Value YoY',
      expression: '...',
      formatString: '0.0%',
    });
    const create = opCall(client.calls, 'Create');
    expect(create?.name).toBe('measure_operations');
    expect(create?.args).toEqual({
      request: {
        operation: 'Create',
        definitions: [
          { tableName: 'FactPrimary', name: 'Value YoY', expression: '...', formatString: '0.0%' },
        ],
      },
    });
  });

  it('deleteMeasure sends references + shouldCascadeDelete', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.deleteMeasure({ tableName: 'FactPrimary', name: 'Value YoY' });
    expect(opCall(client.calls, 'Delete')?.args).toEqual({
      request: {
        operation: 'Delete',
        references: [{ tableName: 'FactPrimary', name: 'Value YoY' }],
        shouldCascadeDelete: false,
      },
    });
  });

  // -- tables --
  it('createTable sends an import-table Create definition', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createTable({
      name: 'Sales',
      mode: 'Import',
      mExpression: 'let Source = ... in Source',
    });
    const create = opCall(client.calls, 'Create');
    expect(create?.name).toBe('table_operations');
    expect(create?.args).toEqual({
      request: {
        operation: 'Create',
        definitions: [{ name: 'Sales', mode: 'Import', mExpression: 'let Source = ... in Source' }],
      },
    });
  });

  it('createTable (calculated table) maps expression → daxExpression', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createTable({
      name: 'Date',
      expression: 'CALENDAR(DATE(2020,1,1), DATE(2026,12,31))',
    });
    // A DAX calculated table must send `daxExpression` (NOT `expression`) — the live
    // MS MCP rejects an unrecognized `expression` key with "One of DaxExpression,
    // MExpression, EntityName, or SqlQuery must be provided".
    expect(opCall(client.calls, 'Create')?.args).toEqual({
      request: {
        operation: 'Create',
        definitions: [
          { name: 'Date', daxExpression: 'CALENDAR(DATE(2020,1,1), DATE(2026,12,31))' },
        ],
      },
    });
  });

  it('refreshModel sends model Refresh with the requested refresh type', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.refreshModel('Calculate');
    const refresh = opCall(client.calls, 'Refresh');
    expect(refresh?.name).toBe('model_operations');
    expect(refresh?.args).toEqual({
      request: { operation: 'Refresh', refreshType: 'Calculate' },
    });
  });

  it('updateColumn sends sortByColumn metadata', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.updateColumn({
      tableName: 'Calendar',
      name: 'Month Name',
      sortByColumn: 'Month No',
    });
    const update = opCall(client.calls, 'Update');
    expect(update?.name).toBe('column_operations');
    expect(update?.args).toEqual({
      request: {
        operation: 'Update',
        definitions: [
          {
            tableName: 'Calendar',
            name: 'Month Name',
            sortByColumn: 'Month No',
          },
        ],
      },
    });
  });

  it('updateTable renames first and applies remaining metadata to the renamed table', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.updateTable({ name: 'Sales', newName: 'SalesFact', isHidden: true });
    expect(opCall(client.calls, 'Rename')?.name).toBe('table_operations');
    expect(opCall(client.calls, 'Rename')?.args).toEqual({
      request: {
        operation: 'Rename',
        renameDefinitions: [{ currentName: 'Sales', newName: 'SalesFact' }],
      },
    });
    expect(opCall(client.calls, 'Update')?.args).toEqual({
      request: {
        operation: 'Update',
        definitions: [{ name: 'SalesFact', isHidden: true }],
      },
    });
  });

  it('deleteTable sends references + shouldCascadeDelete:false', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.deleteTable({ name: 'Sales' });
    expect(opCall(client.calls, 'Delete')?.name).toBe('table_operations');
    expect(opCall(client.calls, 'Delete')?.args).toEqual({
      request: {
        operation: 'Delete',
        references: [{ name: 'Sales' }],
        shouldCascadeDelete: false,
      },
    });
  });

  // -- columns --
  it('createColumn (data column) sends sourceColumn + dataType', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createColumn({
      tableName: 'Product',
      name: 'ListPrice',
      sourceColumn: 'ListPrice',
      dataType: 'decimal',
    });
    const create = opCall(client.calls, 'Create');
    expect(create?.name).toBe('column_operations');
    expect(create?.args).toEqual({
      request: {
        operation: 'Create',
        definitions: [
          {
            tableName: 'Product',
            name: 'ListPrice',
            sourceColumn: 'ListPrice',
            dataType: 'decimal',
          },
        ],
      },
    });
  });

  it('createColumn (calculated column) maps expression → daxExpression', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createColumn({
      tableName: 'Product',
      name: 'Margin',
      expression: '[ListPrice] - [Cost]',
    });
    // The MS MCP source key is `daxExpression`, not `expression` (live MS MCP:
    // "One of DaxExpression, MExpression, EntityName, or SqlQuery must be provided").
    expect(opCall(client.calls, 'Create')?.args).toEqual({
      request: {
        operation: 'Create',
        definitions: [
          { tableName: 'Product', name: 'Margin', daxExpression: '[ListPrice] - [Cost]' },
        ],
      },
    });
  });

  it('updateColumn sends summarizeBy', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.updateColumn({ tableName: 'Product', name: 'ListPrice', summarizeBy: 'None' });
    expect(opCall(client.calls, 'Update')?.name).toBe('column_operations');
    expect(opCall(client.calls, 'Update')?.args).toEqual({
      request: {
        operation: 'Update',
        definitions: [{ tableName: 'Product', name: 'ListPrice', summarizeBy: 'None' }],
      },
    });
  });

  it('createColumn passes through isKey + dataCategory', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createColumn({
      tableName: 'Date',
      name: 'TheDate',
      sourceColumn: 'TheDate',
      dataType: 'dateTime',
      isKey: true,
      dataCategory: 'Time',
    });
    expect(opCall(client.calls, 'Create')?.args).toEqual({
      request: {
        operation: 'Create',
        definitions: [
          {
            tableName: 'Date',
            name: 'TheDate',
            sourceColumn: 'TheDate',
            dataType: 'dateTime',
            isKey: true,
            dataCategory: 'Time',
          },
        ],
      },
    });
  });

  it('updateColumn passes through isKey + dataCategory', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.updateColumn({
      tableName: 'Date',
      name: 'TheDate',
      isKey: true,
      dataCategory: 'Time',
    });
    expect(opCall(client.calls, 'Update')?.args).toEqual({
      request: {
        operation: 'Update',
        definitions: [{ tableName: 'Date', name: 'TheDate', isKey: true, dataCategory: 'Time' }],
      },
    });
  });

  it('updateColumn renames first and applies remaining metadata to the renamed column', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.updateColumn({
      tableName: 'Product',
      name: 'OldName',
      newName: 'NewName',
      isHidden: true,
    });

    expect(opCall(client.calls, 'Rename')?.name).toBe('column_operations');
    expect(opCall(client.calls, 'Rename')?.args).toEqual({
      request: {
        operation: 'Rename',
        renameDefinitions: [{ tableName: 'Product', currentName: 'OldName', newName: 'NewName' }],
      },
    });
    expect(opCall(client.calls, 'Update')?.args).toEqual({
      request: {
        operation: 'Update',
        definitions: [{ tableName: 'Product', name: 'NewName', isHidden: true }],
      },
    });
  });

  it('updateTable passes through dataCategory', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.updateTable({ name: 'Date', dataCategory: 'Time' });
    expect(opCall(client.calls, 'Update')?.args).toEqual({
      request: {
        operation: 'Update',
        definitions: [{ name: 'Date', dataCategory: 'Time' }],
      },
    });
  });

  it('markAsDateTable issues a table Update (dataCategory:Time) + column Update (isKey:true)', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.markAsDateTable('Date', 'TheDate');
    const updates = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'Update',
    );
    const tableUpdate = updates.find((c) => c.name === 'table_operations');
    const columnUpdate = updates.find((c) => c.name === 'column_operations');
    expect(tableUpdate?.args).toEqual({
      request: { operation: 'Update', definitions: [{ name: 'Date', dataCategory: 'Time' }] },
    });
    expect(columnUpdate?.args).toEqual({
      request: {
        operation: 'Update',
        definitions: [{ tableName: 'Date', name: 'TheDate', isKey: true }],
      },
    });
  });

  it('markAsDateTable tolerates Import-mode isKey rejection after table Time category is set', async () => {
    const client = liveClient();
    const originalCallTool = client.callTool.bind(client);
    client.callTool = async (name, args) => {
      const op = (args as { request?: { operation?: string } }).request?.operation;
      if (name === 'column_operations' && op === 'Update') {
        client.calls.push({ name, args: args as Record<string, unknown> });
        throw new Error('Setting IsKey property is only supported for DirectQuery mode tables.');
      }
      return originalCallTool(name, args);
    };
    const driver = new ModelDriver(client);

    const result = await driver.markAsDateTable('Date', 'TheDate');

    expect(result).toMatchObject({
      marked: true,
      columnKeySkipped: true,
      columnKeyWarning: 'Setting IsKey property is only supported for DirectQuery mode tables.',
    });
    // updateTable now read-back-verifies, so the call stream interleaves snapshot
    // List ops; match the Update calls specifically rather than the first op.
    const tableUpdate = client.calls.find(
      (c) =>
        c.name === 'table_operations' &&
        (c.args as { request?: { operation?: string } }).request?.operation === 'Update',
    );
    const columnUpdate = client.calls.find(
      (c) =>
        c.name === 'column_operations' &&
        (c.args as { request?: { operation?: string } }).request?.operation === 'Update',
    );
    expect(tableUpdate?.args).toEqual({
      request: { operation: 'Update', definitions: [{ name: 'Date', dataCategory: 'Time' }] },
    });
    expect(columnUpdate?.args).toEqual({
      request: {
        operation: 'Update',
        definitions: [{ tableName: 'Date', name: 'TheDate', isKey: true }],
      },
    });
  });

  it('markAsDateTable tolerates alternate Import-mode isKey rejection wording', async () => {
    const client = liveClient();
    const originalCallTool = client.callTool.bind(client);
    client.callTool = async (name, args) => {
      const op = (args as { request?: { operation?: string } }).request?.operation;
      if (name === 'column_operations' && op === 'Update') {
        client.calls.push({ name, args: args as Record<string, unknown> });
        throw new Error('Column property isKey is not valid for Import mode tables.');
      }
      return originalCallTool(name, args);
    };
    const driver = new ModelDriver(client);

    const result = await driver.markAsDateTable('Date', 'TheDate');

    expect(result).toMatchObject({
      marked: true,
      columnKeySkipped: true,
      columnKeyWarning: 'Column property isKey is not valid for Import mode tables.',
    });
  });

  it('deleteColumn sends references + shouldCascadeDelete:false', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.deleteColumn({ tableName: 'Product', name: 'ListPrice' });
    expect(opCall(client.calls, 'Delete')?.name).toBe('column_operations');
    expect(opCall(client.calls, 'Delete')?.args).toEqual({
      request: {
        operation: 'Delete',
        references: [{ tableName: 'Product', name: 'ListPrice' }],
        shouldCascadeDelete: false,
      },
    });
  });

  it('createColumns sends all definitions in one batch', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createColumns([
      {
        tableName: 'Product',
        name: 'ListPrice',
        sourceColumn: 'ListPrice',
        dataType: 'decimal',
      },
      {
        tableName: 'Product',
        name: 'Margin',
        expression: '[ListPrice] - [Cost]',
      },
    ]);
    expect(opCall(client.calls, 'Create')?.name).toBe('column_operations');
    expect(opCall(client.calls, 'Create')?.args).toEqual({
      request: {
        operation: 'Create',
        definitions: [
          {
            tableName: 'Product',
            name: 'ListPrice',
            sourceColumn: 'ListPrice',
            dataType: 'decimal',
          },
          { tableName: 'Product', name: 'Margin', daxExpression: '[ListPrice] - [Cost]' },
        ],
      },
    });
  });

  // -- relationships --
  it('createRelationship translates single → OneDirection', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createRelationship({
      fromTable: 'Sales',
      fromColumn: 'ProductKey',
      toTable: 'Product',
      toColumn: 'ProductKey',
      cardinality: 'manyToOne',
      crossFilteringBehavior: 'single',
      isActive: true,
    });
    const create = opCall(client.calls, 'Create');
    expect(create?.name).toBe('relationship_operations');
    expect(create?.args).toEqual({
      request: {
        operation: 'Create',
        definitions: [
          {
            fromTable: 'Sales',
            fromColumn: 'ProductKey',
            toTable: 'Product',
            toColumn: 'ProductKey',
            fromCardinality: 'many',
            toCardinality: 'one',
            crossFilteringBehavior: 'OneDirection',
            isActive: true,
          },
        ],
      },
    });
  });

  it('createRelationship translates both → BothDirections', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createRelationship({
      fromTable: 'Sales',
      fromColumn: 'CustomerKey',
      toTable: 'Customer',
      toColumn: 'CustomerKey',
      crossFilteringBehavior: 'both',
    });
    const def = (
      opCall(client.calls, 'Create')?.args as {
        request: { definitions: Array<Record<string, unknown>> };
      }
    ).request.definitions[0];
    expect(def?.crossFilteringBehavior).toBe('BothDirections');
  });

  it('createRelationships sends all definitions in one batch', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createRelationships([
      {
        fromTable: 'Sales',
        fromColumn: 'ProductKey',
        toTable: 'Product',
        toColumn: 'ProductKey',
        cardinality: 'manyToOne',
        crossFilteringBehavior: 'single',
        isActive: true,
      },
      {
        fromTable: 'Sales',
        fromColumn: 'CustomerKey',
        toTable: 'Customer',
        toColumn: 'CustomerKey',
        cardinality: 'manyToOne',
        crossFilteringBehavior: 'both',
        isActive: true,
      },
    ]);
    expect(opCall(client.calls, 'Create')?.name).toBe('relationship_operations');
    expect(opCall(client.calls, 'Create')?.args).toEqual({
      request: {
        operation: 'Create',
        definitions: [
          {
            fromTable: 'Sales',
            fromColumn: 'ProductKey',
            toTable: 'Product',
            toColumn: 'ProductKey',
            fromCardinality: 'many',
            toCardinality: 'one',
            crossFilteringBehavior: 'OneDirection',
            isActive: true,
          },
          {
            fromTable: 'Sales',
            fromColumn: 'CustomerKey',
            toTable: 'Customer',
            toColumn: 'CustomerKey',
            fromCardinality: 'many',
            toCardinality: 'one',
            crossFilteringBehavior: 'BothDirections',
            isActive: true,
          },
        ],
      },
    });
  });

  it('updateRelationship keys the definition by id (as name) with changed fields', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.updateRelationship({
      id: 'rel-guid-1',
      isActive: false,
      crossFilteringBehavior: 'both',
    });
    expect(opCall(client.calls, 'Update')?.name).toBe('relationship_operations');
    expect(opCall(client.calls, 'Update')?.args).toEqual({
      request: {
        operation: 'Update',
        definitions: [
          { name: 'rel-guid-1', isActive: false, crossFilteringBehavior: 'BothDirections' },
        ],
      },
    });
  });

  it('activateRelationship sends Activate with references:[{name}]', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.activateRelationship({ id: 'rel-guid-1' });
    expect(opCall(client.calls, 'Activate')?.name).toBe('relationship_operations');
    expect(opCall(client.calls, 'Activate')?.args).toEqual({
      request: { operation: 'Activate', references: [{ name: 'rel-guid-1' }] },
    });
  });

  it('deactivateRelationship sends Deactivate with references:[{name}]', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.deactivateRelationship({ id: 'rel-guid-1' });
    expect(opCall(client.calls, 'Deactivate')?.args).toEqual({
      request: { operation: 'Deactivate', references: [{ name: 'rel-guid-1' }] },
    });
  });

  it('deleteRelationship attempts Delete with references:[{name}]', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.deleteRelationship({ id: 'rel-guid-1' });
    expect(opCall(client.calls, 'Delete')?.name).toBe('relationship_operations');
    expect(opCall(client.calls, 'Delete')?.args).toEqual({
      request: { operation: 'Delete', references: [{ name: 'rel-guid-1' }] },
    });
  });

  // -- write verification (P1/P6) + auto-date delete guard (P4) --
  const verifyClient = (extra: Record<string, McpToolResult> = {}) =>
    makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      ...extra,
    });

  it('updateColumn succeeds when the live re-read reflects the requested change', async () => {
    const client = verifyClient({
      'table_operations/List': json({ data: [{ name: 'D' }] }),
      'column_operations/List': json({
        data: [{ tableName: 'D', name: 'C', isHidden: true, dataType: 'dateTime' }],
      }),
      'relationship_operations/List': json({ data: [] }),
      'column_operations/Update': json({ success: true }),
    });
    const driver = new ModelDriver(client);
    await expect(
      driver.updateColumn({ tableName: 'D', name: 'C', isHidden: true }),
    ).resolves.toBeDefined();
  });

  it('updateColumn throws when the live re-read still shows the prior column state', async () => {
    const client = verifyClient({
      'table_operations/List': json({ data: [{ name: 'D' }] }),
      'column_operations/List': json({
        data: [{ tableName: 'D', name: 'C', summarizeBy: 'none', dataType: 'dateTime' }],
      }),
      'relationship_operations/List': json({ data: [] }),
      'column_operations/Update': json({ success: true }),
    });
    const driver = new ModelDriver(client);
    await expect(
      driver.updateColumn({ tableName: 'D', name: 'C', summarizeBy: 'sum' }),
    ).rejects.toThrow(/was not applied/);
  });

  it('updateColumn tolerates an isHidden read-back that does not reflect the change', async () => {
    // isHidden is cosmetic and carries the Import-mode read-back false-negative
    // hazard (an absent List key parses to false), so it is never asserted on
    // read-back — a hide write whose re-read still shows isHidden:false must NOT
    // throw, otherwise the agent asks the user to hide fields that are already hidden.
    const client = verifyClient({
      'table_operations/List': json({ data: [{ name: 'D' }] }),
      'column_operations/List': json({
        data: [{ tableName: 'D', name: 'C', isHidden: false, dataType: 'dateTime' }],
      }),
      'relationship_operations/List': json({ data: [] }),
      'column_operations/Update': json({ success: true }),
    });
    const driver = new ModelDriver(client);
    await expect(
      driver.updateColumn({ tableName: 'D', name: 'C', isHidden: true }),
    ).resolves.toBeDefined();
  });

  it('updateColumn throws on a { success:false } envelope returned without isError', async () => {
    const client = verifyClient({
      'column_operations/Update': json({ success: false, message: 'engine rejected the write' }),
    });
    const driver = new ModelDriver(client);
    await expect(
      driver.updateColumn({ tableName: 'D', name: 'C', isHidden: true }),
    ).rejects.toThrow(/engine rejected the write/);
  });

  it('updateColumns throws when a batched result item reports success:false', async () => {
    const client = verifyClient({
      'column_operations/Update': json({
        results: [{ success: true }, { success: false, message: 'second column failed' }],
      }),
    });
    const driver = new ModelDriver(client);
    await expect(
      driver.updateColumns([
        { tableName: 'D', name: 'C', isHidden: true },
        { tableName: 'D', name: 'C2', isHidden: true },
      ]),
    ).rejects.toThrow(/second column failed/);
  });

  it('updateColumn does not false-fail when the target table is not observable', async () => {
    // An empty/unobservable snapshot must SKIP verification (cannot confirm)
    // rather than throw, so legitimately-unobservable shapes are not false
    // negatives.
    const client = liveClient();
    const driver = new ModelDriver(client);
    await expect(
      driver.updateColumn({ tableName: 'Missing', name: 'C', isHidden: true }),
    ).resolves.toBeDefined();
  });

  it('updateMeasure throws when the live re-read still shows the prior expression', async () => {
    const client = verifyClient({
      'table_operations/List': json({ data: [{ name: 'D' }] }),
      'column_operations/List': json({ data: [] }),
      'relationship_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [{ tableName: 'D', name: 'M' }] }),
      'measure_operations/Get': json({
        results: [{ success: true, data: { tableName: 'D', name: 'M', expression: 'OLD()' } }],
      }),
      'measure_operations/Update': json({ success: true }),
    });
    const driver = new ModelDriver(client);
    await expect(
      driver.updateMeasure({ tableName: 'D', name: 'M', expression: 'NEW()' }),
    ).rejects.toThrow(/was not applied/);
  });

  it('updateMeasure tolerates a measure whose expression is not surfaced on read-back', async () => {
    // The enrich Get can omit the expression (parsed as ''); an empty read-back must
    // be treated as "not observable" (cannot-disprove), never a false negative.
    const client = verifyClient({
      'table_operations/List': json({ data: [{ name: 'D' }] }),
      'column_operations/List': json({ data: [] }),
      'relationship_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [{ tableName: 'D', name: 'M' }] }),
      'measure_operations/Get': json({
        results: [{ success: true, data: { tableName: 'D', name: 'M' } }],
      }),
      'measure_operations/Update': json({ success: true }),
    });
    const driver = new ModelDriver(client);
    await expect(
      driver.updateMeasure({ tableName: 'D', name: 'M', expression: 'NEW()' }),
    ).resolves.toBeDefined();
  });

  it('activateRelationship throws when the relationship reads back inactive', async () => {
    const client = verifyClient({
      'table_operations/List': json({ data: [] }),
      'column_operations/List': json({ data: [] }),
      'relationship_operations/List': json({
        data: [
          {
            name: 'rel-1',
            fromTable: 'F',
            fromColumn: 'K',
            toTable: 'D',
            toColumn: 'K',
            isActive: false,
          },
        ],
      }),
      'relationship_operations/Activate': json({ success: true }),
    });
    const driver = new ModelDriver(client);
    await expect(driver.activateRelationship({ id: 'rel-1' })).rejects.toThrow(/was not applied/);
  });

  it('activateRelationship succeeds when the relationship reads back active', async () => {
    const client = verifyClient({
      'table_operations/List': json({ data: [] }),
      'column_operations/List': json({ data: [] }),
      'relationship_operations/List': json({
        data: [
          {
            name: 'rel-1',
            fromTable: 'F',
            fromColumn: 'K',
            toTable: 'D',
            toColumn: 'K',
            isActive: true,
          },
        ],
      }),
      'relationship_operations/Activate': json({ success: true }),
    });
    const driver = new ModelDriver(client);
    await expect(driver.activateRelationship({ id: 'rel-1' })).resolves.toBeDefined();
  });

  it('deleteRelationship refuses to orphan an auto date/time Variation', async () => {
    const client = verifyClient({
      'table_operations/List': json({
        data: [{ name: 'Sales' }, { name: 'LocalDateTable_abc', isAutoDateTable: true }],
      }),
      'column_operations/List': json({ data: [] }),
      'relationship_operations/List': json({
        data: [
          {
            id: 'auto-1',
            fromTable: 'Sales',
            fromColumn: 'OrderDate',
            toTable: 'LocalDateTable_abc',
            toColumn: 'Date',
          },
        ],
      }),
    });
    const driver = new ModelDriver(client);
    await expect(driver.deleteRelationship({ id: 'auto-1' })).rejects.toThrow(/auto date\/time/i);
    expect(opCall(client.calls, 'Delete')).toBeUndefined();
  });

  it('deleteRelationship proceeds for a normal relationship and confirms it is gone', async () => {
    let deleted = false;
    const calls: RecordedCall[] = [];
    const client: ModelClient & { calls: RecordedCall[] } = {
      calls,
      async callTool(name, args) {
        calls.push({ name, args });
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (name === 'connection_operations' && op === 'ListLocalInstances') {
          return json({ data: [{ connectionString: 'Data Source=localhost:1;' }] });
        }
        if (name === 'relationship_operations' && op === 'Delete') {
          deleted = true;
          return json({ success: true });
        }
        if (name === 'relationship_operations' && op === 'List') {
          return json({
            data: deleted
              ? []
              : [
                  {
                    id: 'rel-1',
                    fromTable: 'Sales',
                    fromColumn: 'OrderDate',
                    toTable: 'DimDate',
                    toColumn: 'Date',
                  },
                ],
          });
        }
        if (name === 'table_operations' && op === 'List') {
          return json({ data: [{ name: 'Sales' }, { name: 'DimDate' }] });
        }
        return json({});
      },
    };
    const driver = new ModelDriver(client);
    await expect(driver.deleteRelationship({ id: 'rel-1' })).resolves.toBeDefined();
    expect(opCall(calls, 'Delete')?.name).toBe('relationship_operations');
  });

  // -- snapshot invalidation regression --
  it('invalidates the cached snapshot after a write (next read re-issues a List)', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    // Prime the snapshot cache.
    await driver.getCachedSnapshot();
    const listsBefore = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;
    // A write must invalidate the cache.
    await driver.createTable({ name: 'Sales', mode: 'Import', mExpression: '...' });
    await driver.getCachedSnapshot();
    const listsAfter = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;
    expect(listsAfter).toBeGreaterThan(listsBefore);
  });

  it('does not serve a cached snapshot while a write is in flight', async () => {
    const createEntered = deferred<void>();
    const allowCreate = deferred<McpToolResult>();
    const calls: RecordedCall[] = [];
    const client: ModelClient & { calls: RecordedCall[] } = {
      calls,
      async callTool(name, args) {
        calls.push({ name, args });
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (name === 'connection_operations' && op === 'ListLocalInstances') {
          return json({ data: [{ connectionString: 'Data Source=localhost:1;' }] });
        }
        if (name === 'table_operations' && op === 'List') {
          return json({ data: [{ name: 'FactPrimary' }] });
        }
        if (name === 'table_operations' && op === 'Create') {
          createEntered.resolve();
          return allowCreate.promise;
        }
        return json({});
      },
    };
    const driver = new ModelDriver(client);

    await driver.getCachedSnapshot();
    const listsBefore = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;

    const write = driver.createTable({ name: 'FactSecondary', mode: 'Import', mExpression: '...' });
    await createEntered.promise;

    let readResolved = false;
    const read = driver.getCachedSnapshot().then((model) => {
      readResolved = true;
      return model;
    });
    await Promise.resolve();
    expect(readResolved).toBe(false);

    allowCreate.resolve(json({}));
    await write;
    await read;

    const listsAfter = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;
    expect(listsAfter).toBeGreaterThan(listsBefore);
  });

  it('does not reuse a cached snapshot across expected connections', async () => {
    let activeConnection = '';
    const calls: RecordedCall[] = [];
    const client: ModelClient & { calls: RecordedCall[] } = {
      calls,
      async callTool(name, args) {
        calls.push({ name, args });
        const request = (args as { request?: Record<string, unknown> }).request ?? {};
        const op = typeof request.operation === 'string' ? request.operation : '';
        if (name === 'connection_operations' && op === 'Connect') {
          activeConnection = String(request.connectionString ?? '');
          return json({});
        }
        if (name === 'table_operations' && op === 'List') {
          return json({
            data: [{ name: activeConnection.includes('localhost:2') ? 'TargetB' : 'TargetA' }],
          });
        }
        return json({});
      },
    };
    const driver = new ModelDriver(client);

    const snapshotA = await driver.getCachedSnapshot({
      mode: 'live',
      connectionString: 'Data Source=localhost:1;',
    });
    expect(snapshotA.tables.map((table) => table.name)).toEqual(['TargetA']);
    const listsBefore = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;

    const snapshotB = await driver.getCachedSnapshot({
      mode: 'live',
      connectionString: 'Data Source=localhost:2;',
    });

    const listsAfter = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;
    expect(snapshotB.tables.map((table) => table.name)).toEqual(['TargetB']);
    expect(listsAfter).toBeGreaterThan(listsBefore);
  });

  it('does not reuse a structure-only cached snapshot for a later measure-inclusive read', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'Measures' }] }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [{ name: 'Total' }] }),
      'measure_operations/Get': json({
        results: [{ data: { tableName: 'Measures', name: 'Total', expression: '1' } }],
      }),
      'relationship_operations/List': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const structureOnly = await driver.getCachedSnapshot(undefined, {
      includeMeasures: false,
      includeRoles: false,
    });
    const measureInclusive = await driver.getCachedSnapshot(undefined, {
      includeMeasures: true,
      includeRoles: false,
    });

    expect(structureOnly.tables[0]?.measures).toEqual([]);
    expect(measureInclusive.tables[0]?.measures).toEqual([
      expect.objectContaining({ name: 'Total', expression: '1' }),
    ]);
  });

  it('patches a measure-inclusive cached snapshot after createMeasure without re-listing', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'Measures' }] }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [] }),
      'relationship_operations/List': json({ data: [] }),
      'measure_operations/Create': json({ ok: true }),
    });
    const driver = new ModelDriver(client);
    await driver.getCachedSnapshot(undefined, { includeMeasures: true, includeRoles: false });
    const listsBefore = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;

    await driver.createMeasure({
      tableName: 'Measures',
      name: 'Gross Margin',
      expression: '1',
      formatString: '0.0%',
      description: 'Created in this batch',
    });
    const afterCreateLists = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;
    const snapshot = await driver.getCachedSnapshot(undefined, {
      includeMeasures: true,
      includeRoles: false,
    });
    const listsAfter = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;

    expect(afterCreateLists).toBe(listsBefore);
    expect(listsAfter).toBe(listsBefore);
    expect(snapshot.tables[0]?.measures).toEqual([
      expect.objectContaining({
        table: 'Measures',
        name: 'Gross Margin',
        expression: '1',
        formatString: '0.0%',
        description: 'Created in this batch',
        isHidden: false,
        annotations: {},
      }),
    ]);
  });

  it('invalidates instead of patching createMeasure into a structure-only cached snapshot', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'Measures' }] }),
      'column_operations/List': json({ data: [] }),
      'relationship_operations/List': json({ data: [] }),
      'measure_operations/Create': json({ ok: true }),
    });
    const driver = new ModelDriver(client);
    await driver.getCachedSnapshot(undefined, { includeMeasures: false, includeRoles: false });
    const listsBefore = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;

    await driver.createMeasure({
      tableName: 'Measures',
      name: 'Gross Margin',
      expression: '1',
    });
    await driver.getCachedSnapshot(undefined, { includeMeasures: false, includeRoles: false });
    const listsAfter = client.calls.filter(
      (c) => (c.args as { request?: { operation?: string } }).request?.operation === 'List',
    ).length;

    expect(listsAfter).toBeGreaterThan(listsBefore);
  });
});

describe('ModelDriver.call error handling', () => {
  it('throws a redacted error on isError results', async () => {
    const client = makeClient({
      'connection_operations/Connect': {
        isError: true,
        content: [{ type: 'text', text: 'failed for Data Source=localhost:9999;Password=p;' }],
      },
    });
    process.env.PBI_MODELING_MCP_CONNECTION_STRING = 'Data Source=localhost:9999;';
    const driver = new ModelDriver(client);
    await expect(driver.ensureConnection()).rejects.toThrow(/Data Source=\*\*\*/);
  });
});

describe('ModelDriver reconnect resilience', () => {
  it('reconnects and retries once when a read operation drops the connection', async () => {
    let listAttempts = 0;
    let connects = 0;
    const client: ModelClient = {
      reset() {},
      async callTool(name, args) {
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (name === 'connection_operations' && op === 'ListLocalInstances') {
          return {
            structuredContent: { data: [{ connectionString: 'Data Source=localhost:1;' }] },
          };
        }
        if (name === 'connection_operations' && op === 'Connect') {
          connects += 1;
          return { structuredContent: {} };
        }
        if (name === 'table_operations' && op === 'List') {
          listAttempts += 1;
          if (listAttempts === 1) throw new Error('transport closed');
          return { structuredContent: { data: [{ name: 'T' }] } };
        }
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);
    await driver.ensureConnection();
    await expect(driver.listTablesRaw()).resolves.toEqual([{ name: 'T' }]);
    expect(listAttempts).toBe(2); // failed once, retried
    expect(connects).toBeGreaterThanOrEqual(2); // re-Connected after the drop
  });

  it('invalidates the cached connection when the client resets (onReset)', async () => {
    let resetCb: (() => void) | undefined;
    const client: ModelClient = {
      onReset(cb) {
        resetCb = cb;
      },
      async callTool(_name, args) {
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (op === 'ListLocalInstances') {
          return {
            structuredContent: { data: [{ connectionString: 'Data Source=localhost:1;' }] },
          };
        }
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);
    await driver.ensureConnection();
    expect(driver.connection).not.toBeNull();
    resetCb?.(); // simulate a transport drop
    expect(driver.connection).toBeNull();
  });

  it('does not reuse a stale explicit selector after reset for an unqualified connection', async () => {
    let resetCb: (() => void) | undefined;
    const client: ModelClient = {
      onReset(cb) {
        resetCb = cb;
      },
      async callTool(_name, args) {
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (op === 'ListLocalInstances') {
          return {
            structuredContent: {
              data: [
                { connectionString: 'Data Source=localhost:1;', databaseName: 'Sales' },
                { connectionString: 'Data Source=localhost:2;', databaseName: 'Finance' },
              ],
            },
          };
        }
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);
    await driver.ensureConnection({ model: 'Sales' });
    resetCb?.();

    await expect(driver.ensureConnection()).rejects.toThrow(/found 2 open/i);
  });
});

describe('normalizeDaxResult', () => {
  it('zips the local columnar envelope (data.columns + positional rows) into keyed objects', () => {
    const envelope = {
      success: true,
      operation: 'Execute',
      message: 'ok',
      data: {
        columns: [
          { name: 'Sales[Year]', dataType: 'Int64' },
          { name: '[Total]', dataType: 'Decimal' },
        ],
        rows: [
          [2024, 100.5],
          [2025, 200],
        ],
        rowCount: 2,
        wasTruncated: false,
      },
    };
    expect(normalizeDaxResult(envelope)).toEqual({
      columns: ['Sales[Year]', '[Total]'],
      rows: [
        { 'Sales[Year]': 2024, '[Total]': 100.5 },
        { 'Sales[Year]': 2025, '[Total]': 200 },
      ],
      rowCount: 2,
    });
  });

  it('zips nested local columnar result tables into keyed objects', () => {
    const envelope = {
      success: true,
      operation: 'Execute',
      message: 'ok',
      data: {
        results: [
          {
            tables: [
              {
                columns: [
                  { name: '[__table]', dataType: 'String' },
                  { name: '[rowCount]', dataType: 'Int64' },
                ],
                rows: [['Actual', 100]],
                rowCount: 1,
              },
            ],
          },
        ],
      },
    };

    expect(normalizeDaxResult(envelope)).toEqual({
      columns: ['[__table]', '[rowCount]'],
      rows: [{ '[__table]': 'Actual', '[rowCount]': 100 }],
      rowCount: 1,
    });
  });

  it('throws on a success:false envelope (engine error returned without isError)', () => {
    expect(() =>
      normalizeDaxResult({
        success: false,
        operation: 'Execute',
        message: 'Query (1, 9) The syntax for the function is incorrect.',
      }),
    ).toThrow(/syntax/i);
  });

  it('throws on a non-tabular text payload instead of returning empty rows', () => {
    expect(() => normalizeDaxResult('Unexpected non-JSON engine message')).toThrow(
      /did not return a tabular JSON/i,
    );
  });

  it('surfaces file-paged large results (wasTruncated + filePath)', () => {
    const result = normalizeDaxResult({
      success: true,
      data: {
        columns: [{ name: '[V]', dataType: 'Decimal' }],
        rows: [],
        rowCount: 250000,
        wasTruncated: true,
        truncationReason: 'paged to file',
        filePath: '/tmp/dax-result.csv',
      },
    }) as Record<string, unknown>;
    expect(result).toMatchObject({
      rowCount: 250000,
      wasTruncated: true,
      filePath: '/tmp/dax-result.csv',
    });
  });

  it('passes the public Execute-Queries REST shape through unchanged', () => {
    const rest = { results: [{ tables: [{ rows: [{ 'Sales[Year]': 2024 }] }] }] };
    expect(normalizeDaxResult(rest)).toBe(rest);
  });

  it('throws when a columnar result reports rows but none are tabular', () => {
    expect(() =>
      normalizeDaxResult({
        success: true,
        data: {
          columns: [{ name: '[V]', dataType: 'Decimal' }],
          rows: [1, 'bad', null],
          rowCount: 3,
        },
      }),
    ).toThrow(/malformed tabular rows/i);
  });
});

describe('ModelDriver.daxQuery', () => {
  const PIN = 'PBI_MODELING_MCP_CONNECTION_STRING';
  afterEach(() => {
    delete process.env[PIN];
  });

  it('returns normalized keyed rows from a content-text columnar envelope', async () => {
    process.env[PIN] = 'Data Source=localhost:1;';
    const envelope = {
      success: true,
      data: {
        columns: [{ name: '[__table]' }, { name: '[rowCount]' }],
        rows: [['Actual', 100]],
        rowCount: 1,
      },
    };
    const client = makeClient({
      'dax_query_operations/Execute': {
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
      },
    });
    const driver = new ModelDriver(client);
    const result = (await driver.daxQuery('EVALUATE x')) as Record<string, unknown>;
    expect(result.rows).toEqual([{ '[__table]': 'Actual', '[rowCount]': 100 }]);
    expect(result.rowCount).toBe(1);
  });

  it('prefers content-text DAX rows over a bare structured success envelope', async () => {
    process.env[PIN] = 'Data Source=localhost:1;';
    const envelope = {
      success: true,
      data: {
        columns: [{ name: '[__table]' }, { name: '[rowCount]' }],
        rows: [['Actual', 100]],
        rowCount: 1,
      },
    };
    const client = makeClient({
      'dax_query_operations/Execute': {
        structuredContent: { success: true },
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
      },
    });
    const driver = new ModelDriver(client);
    const result = (await driver.daxQuery('EVALUATE x')) as Record<string, unknown>;
    expect(result.rows).toEqual([{ '[__table]': 'Actual', '[rowCount]': 100 }]);
    expect(result.rowCount).toBe(1);
  });

  it('unwraps nested MCP text content before falling back to a bare structured success envelope', async () => {
    process.env[PIN] = 'Data Source=localhost:1;';
    const envelope = {
      success: true,
      data: {
        columns: [{ name: '[__table]' }, { name: '[rowCount]' }],
        rows: [['Actual', 100]],
        rowCount: 1,
      },
    };
    const client = makeClient({
      'dax_query_operations/Execute': {
        structuredContent: { success: true },
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              content: [{ type: 'text', text: JSON.stringify(envelope) }],
            }),
          },
        ],
      },
    });
    const driver = new ModelDriver(client);
    const result = (await driver.daxQuery('EVALUATE x')) as Record<string, unknown>;
    expect(result.rows).toEqual([{ '[__table]': 'Actual', '[rowCount]': 100 }]);
    expect(result.rowCount).toBe(1);
  });

  it('prefers later tabular DAX text over an earlier plain text acknowledgement', async () => {
    process.env[PIN] = 'Data Source=localhost:1;';
    const envelope = {
      success: true,
      data: {
        columns: [{ name: '[__table]' }, { name: '[rowCount]' }],
        rows: [['Actual', 100]],
        rowCount: 1,
      },
    };
    const client = makeClient({
      'dax_query_operations/Execute': {
        structuredContent: { success: true },
        content: [
          { type: 'text', text: 'DAX Execute succeeded.' },
          { type: 'text', text: JSON.stringify(envelope) },
        ],
      },
    });
    const driver = new ModelDriver(client);
    const result = (await driver.daxQuery('EVALUATE x')) as Record<string, unknown>;
    expect(result.rows).toEqual([{ '[__table]': 'Actual', '[rowCount]': 100 }]);
    expect(result.rowCount).toBe(1);
  });

  it('reads DAX rows from CSV resources when text content is only a success acknowledgement', async () => {
    process.env[PIN] = 'Data Source=localhost:1;';
    const client = makeClient({
      'dax_query_operations/Execute': {
        content: [
          { type: 'text', text: JSON.stringify({ success: true }) },
          {
            type: 'resource',
            resource: {
              uri: 'file:///tmp/dax.csv',
              mimeType: 'text/csv',
              text: '[__table],[rowCount]\r\nActual,100\r\n',
            },
          },
        ],
      },
    });
    const driver = new ModelDriver(client);
    const result = (await driver.daxQuery('EVALUATE x')) as Record<string, unknown>;
    expect(result.rows).toEqual([{ '[__table]': 'Actual', '[rowCount]': '100' }]);
    expect(result.rowCount).toBe(1);
  });

  it('does not attach raw diagnostics to ad-hoc empty DAX results by default', async () => {
    process.env[PIN] = 'Data Source=localhost:1;';
    const envelope = {
      success: true,
      data: {
        columns: [{ name: '[__table]' }, { name: '[rowCount]' }],
        rows: [],
        rowCount: 0,
      },
    };
    const client = makeClient({
      'dax_query_operations/Execute': {
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
      },
    });
    const driver = new ModelDriver(client);
    const result = (await driver.daxQuery('EVALUATE SecretTable')) as Record<string, unknown>;
    expect(result).toMatchObject({
      columns: ['[__table]', '[rowCount]'],
      rows: [],
      rowCount: 0,
    });
    expect(result.rawDiagnostics).toBeUndefined();
  });

  it('attaches structure-only raw diagnostics for proof callers when DAX normalizes empty', async () => {
    process.env[PIN] = 'Data Source=localhost:1;';
    const envelope = {
      success: true,
      operation: 'Execute',
      message: 'Data Source=localhost:1; secret should not leak',
      data: {
        columns: [{ name: '[__table]', dataType: 'String' }, { name: '[rowCount]' }],
        rows: [],
        rowCount: 0,
      },
    };
    const client = makeClient({
      'dax_query_operations/Execute': {
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
      },
    });
    const driver = new ModelDriver(client);
    const result = (await driver.daxQuery('EVALUATE SecretTable', undefined, {
      includeRawDiagnostics: true,
    })) as Record<string, unknown>;
    expect(result).toMatchObject({
      columns: ['[__table]', '[rowCount]'],
      rows: [],
      rowCount: 0,
    });
    expect(result.rawDiagnostics).toMatchObject({
      source: 'content[0].text',
      payloadType: 'object',
      topLevelKeys: expect.arrayContaining(['success', 'operation', 'message', 'data']),
      shape: {
        node0: { path: '$', type: 'object' },
        node1: { path: '$.data', type: 'object' },
      },
    });
    const serialized = JSON.stringify(result.rawDiagnostics);
    expect(serialized).not.toContain('localhost:1');
    expect(serialized).not.toContain('SecretTable');
    expect(serialized).not.toContain('secret should not leak');
  });

  it('uses content-text as the diagnostic source when structured DAX output is success-only', async () => {
    process.env[PIN] = 'Data Source=localhost:1;';
    const envelope = {
      success: true,
      data: {
        columns: [{ name: '[__table]' }, { name: '[rowCount]' }],
        rows: [],
        rowCount: 0,
      },
    };
    const client = makeClient({
      'dax_query_operations/Execute': {
        structuredContent: { success: true },
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
      },
    });
    const driver = new ModelDriver(client);
    const result = (await driver.daxQuery('EVALUATE x', undefined, {
      includeRawDiagnostics: true,
    })) as Record<string, unknown>;
    expect(result.rawDiagnostics).toMatchObject({
      source: 'content[0].text',
      payloadType: 'object',
      topLevelKeys: expect.arrayContaining(['success', 'data']),
      shape: {
        node0: { path: '$', type: 'object' },
        node1: { path: '$.data', type: 'object' },
      },
    });
  });

  it('rejects when the engine returns a success:false envelope without isError', async () => {
    process.env[PIN] = 'Data Source=localhost:1;';
    const envelope = { success: false, message: 'Query (1, 1) The syntax is incorrect.' };
    const client = makeClient({
      'dax_query_operations/Execute': {
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
      },
    });
    const driver = new ModelDriver(client);
    await expect(driver.daxQuery('EVALUATE bad(')).rejects.toThrow(/syntax/i);
  });
});

describe('ModelDriver write retry safety', () => {
  const PIN = 'PBI_MODELING_MCP_CONNECTION_STRING';
  afterEach(() => {
    delete process.env[PIN];
  });

  it('does not retry a non-idempotent create when the transport drops after the write', async () => {
    process.env[PIN] = 'Data Source=localhost:1;';
    let createCalls = 0;
    const client: ModelClient = {
      reset() {
        // no-op for this test
      },
      async callTool(name, args) {
        const op = (args as { request?: { operation?: string } }).request?.operation ?? '';
        if (name === 'connection_operations' && op === 'Connect') {
          return { structuredContent: {} };
        }
        if (name === 'table_operations' && op === 'Create') {
          createCalls += 1;
          throw new Error('transport closed after create');
        }
        return { structuredContent: {} };
      },
    };

    const driver = new ModelDriver(client);

    await expect(
      driver.createTable({ name: 'Generated', expression: 'ROW("X", 1)' }),
    ).rejects.toThrow(/write result unknown/i);
    expect(createCalls).toBe(1);
  });
});
