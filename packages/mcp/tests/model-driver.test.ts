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

  it('derives the hint from a folderPath basename when several instances are open', async () => {
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
    expect(model.relationships[0]?.toTable).toBe('DimShared');
  });

  it('captures column dataCategory + formatString and a precise relationship cardinality', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'FactPrimary' }, { name: 'DimShared' }] }),
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
    const valueMetric = fact?.columns.find((c) => c.name === 'ValueMetric');
    const orderDate = fact?.columns.find((c) => c.name === 'OrderDate');
    expect(valueMetric?.formatString).toBe('#,0.00');
    expect(orderDate?.dataCategory).toBe('Time');
    expect(model.relationships[0]?.cardinality).toBe('manyToOne');
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

  // M2 — RLS roles assembled from the assumed `role_operations/List` op.
  it('captures RLS roles from the (assumed) role_operations List op', async () => {
    const client = makeClient({
      'connection_operations/ListLocalInstances': json({
        data: [{ connectionString: 'Data Source=localhost:1;' }],
      }),
      'table_operations/List': json({ data: [{ name: 'Customer' }] }),
      'column_operations/List': json({ data: [] }),
      'measure_operations/List': json({ data: [] }),
      'relationship_operations/List': json({ data: [] }),
      'role_operations/List': json({
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
      // No 'role_operations/List' entry → makeClient returns {} → pickArray [].
    });
    const driver = new ModelDriver(client);
    const model = await driver.getModelSnapshot();

    expect(model.roles).toBeUndefined();
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
        if (name === 'role_operations') {
          throw new Error('invalid operation: role_operations is not supported');
        }
        return { structuredContent: {} };
      },
    };
    const driver = new ModelDriver(client);
    const model = await driver.getModelSnapshot();
    expect(model.roles).toBeUndefined();
    expect(model.tables.map((t) => t.name)).toEqual(['FactPrimary']);
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

  it('updateTable carries a rename via newName', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.updateTable({ name: 'Sales', newName: 'SalesFact', isHidden: true });
    expect(opCall(client.calls, 'Update')?.name).toBe('table_operations');
    expect(opCall(client.calls, 'Update')?.args).toEqual({
      request: {
        operation: 'Update',
        definitions: [{ name: 'Sales', newName: 'SalesFact', isHidden: true }],
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

  // -- relationships --
  it('createRelationship translates single → OneDirection', async () => {
    const client = liveClient();
    const driver = new ModelDriver(client);
    await driver.createRelationship({
      fromTable: 'Sales',
      fromColumn: 'ProductKey',
      toTable: 'Product',
      toColumn: 'ProductKey',
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
