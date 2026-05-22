import { afterEach, describe, expect, it } from 'vitest';
import {
  type ModelClient,
  ModelDriver,
  collectConnectionStrings,
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

  it('throws on multiple instances', async () => {
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
        data: [{ connectionString: 'Data Source=localhost:59186;' }],
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
  it('assembles a TMDLModel from live List output (defensive field names)', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'FactPrimary' }, { name: 'DimShared' }] }),
      // Live column List is grouped per table with a nested `columns` array.
      'column_operations/List': json({
        data: [
          { tableName: 'FactPrimary', columns: [{ name: 'ValueMetric', dataType: 'double' }] },
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
          },
        ],
      }),
    });
    const driver = new ModelDriver(client);

    const model = await driver.getModelSnapshot();

    expect(model.tables.map((t) => t.name).sort()).toEqual(['DimShared', 'FactPrimary']);
    const fact = model.tables.find((t) => t.name === 'FactPrimary');
    expect(fact?.columns.map((c) => c.name)).toEqual(['ValueMetric']);
    expect(fact?.measures.map((m) => m.name)).toEqual(['Total Value']);
    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0]?.toTable).toBe('DimShared');
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
  it('reconnects and retries once when an operation drops the connection', async () => {
    let createAttempts = 0;
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
        if (name === 'measure_operations' && op === 'Create') {
          createAttempts += 1;
          if (createAttempts === 1) throw new Error('transport closed');
          return { structuredContent: { success: true } };
        }
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);
    await driver.ensureConnection();
    await driver.createMeasure({ tableName: 'T', name: 'M', expression: '1', formatString: '0' });
    expect(createAttempts).toBe(2); // failed once, retried
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
});
