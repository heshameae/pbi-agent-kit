import { afterEach, describe, expect, it } from 'vitest';
import type { McpToolResult } from '../src/model-bridge/ms-mcp-client.js';
import {
  collectConnectionStrings,
  type ModelClient,
  ModelDriver,
  operationArgs,
  pickArray,
  redactConnectionSecrets,
} from '../src/model-bridge/model-driver.js';

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
    expect(client.calls.map((c) => (c.args as { request: { operation: string } }).request.operation)).toEqual([
      'ListLocalInstances',
      'Connect',
    ]);
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

  it('falls back to folder mode when no instance and a folderPath is given', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({ data: [] }),
    });
    const driver = new ModelDriver(client);

    const info = await driver.ensureConnection({ folderPath: '/x/Model.SemanticModel/definition' });

    expect(info.mode).toBe('folder');
    expect(info.folderPath).toBe('/x/Model.SemanticModel/definition');
  });

  it('throws when no instance and no folderPath', async () => {
    const client = makeClient({ 'connection_operations/ListLocalInstances': json({ data: [] }) });
    const driver = new ModelDriver(client);
    await expect(driver.ensureConnection()).rejects.toThrow(/No open Power BI Desktop instance/);
  });
});

describe('ModelDriver.getModelSnapshot', () => {
  it('assembles a TMDLModel from live List output (defensive field names)', async () => {
    const client = makeClient({
      'table_operations/List': json({ data: [{ name: 'FactPrimary' }, { name: 'DimShared' }] }),
      'column_operations/List': json({
        data: [
          { tableName: 'FactPrimary', name: 'ValueMetric', dataType: 'double' },
          { tableName: 'DimShared', name: 'SharedAxis', dataType: 'string', isKey: true },
        ],
      }),
      'measure_operations/List': json({
        data: [
          {
            tableName: 'FactPrimary',
            name: 'Total Value',
            expression: 'SUM(FactPrimary[ValueMetric])',
            formatString: '0',
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
  it('createMeasure sends a Create with one definition', async () => {
    const client = makeClient();
    const driver = new ModelDriver(client);
    await driver.createMeasure({
      tableName: 'FactPrimary',
      name: 'Value YoY',
      expression: '...',
      formatString: '0.0%',
    });
    expect(client.calls[0]).toEqual({
      name: 'measure_operations',
      args: {
        request: {
          operation: 'Create',
          definitions: [
            { tableName: 'FactPrimary', name: 'Value YoY', expression: '...', formatString: '0.0%' },
          ],
        },
      },
    });
  });

  it('deleteMeasure sends references + shouldCascadeDelete', async () => {
    const client = makeClient();
    const driver = new ModelDriver(client);
    await driver.deleteMeasure({ tableName: 'FactPrimary', name: 'Value YoY' });
    expect(client.calls[0]?.args).toEqual({
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
