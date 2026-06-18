import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, setModelDriverForTests } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAR_FIXTURE = path.resolve(__dirname, '../../core/tests/modeling/fixtures/star-good');

const tempRoots: string[] = [];

beforeEach(() => {
  process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
});

function semanticModelFixture(source: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pbi-model-list-'));
  tempRoots.push(root);
  const definition = path.join(root, 'Fixture.SemanticModel', 'definition');
  cpSync(source, definition, { recursive: true });
  return definition;
}

afterEach(() => {
  // biome-ignore lint/performance/noDelete: tests must restore the process environment
  delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
  setModelDriverForTests(null);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function callTool(name: string, args: Record<string, unknown>) {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}

function jsonPayload(result: Awaited<ReturnType<typeof callTool>>): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, unknown>;
  }
  const text = result.content.find((c) => c.type === 'text')?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

describe('model list tools', () => {
  it('returns a data dictionary with counts and canonical refs from a fixture model', async () => {
    const result = await callTool('pbi_data_dictionary_get', {
      folderPath: semanticModelFixture(STAR_FIXTURE),
    });

    const payload = jsonPayload(result);
    expect(payload.mode).toBe('folder');
    expect(payload.counts).toEqual({
      tables: 3,
      fields: 7,
      measures: 3,
      relationships: 1,
    });
    const fields = payload.fields as Array<Record<string, unknown>> | undefined;
    const measures = payload.measures as Array<Record<string, unknown>> | undefined;
    const relationships = payload.relationships as Array<Record<string, unknown>> | undefined;
    expect(fields?.map((field) => field.ref)).toContain('Sales[Amount]');
    expect(fields?.map((field) => field.ref)).toContain('Product[Product Name]');
    expect(fields?.map((field) => field.ref)).not.toContain('Sales[OrderId]');
    expect(measures?.map((measure) => measure.ref)).toContain('Sales[Total Amount]');
    expect(measures?.[0]).not.toHaveProperty('expression');
    expect(relationships?.map((relationship) => relationship.fromRef)).toContain('Sales[DateKey]');
    expect(relationships?.map((relationship) => relationship.fromRef)).not.toContain(
      'Sales[ProductKey]',
    );
  });

  it('lists table inventory without field payload by default', async () => {
    const result = await callTool('pbi_model_list_tables', {
      folderPath: semanticModelFixture(STAR_FIXTURE),
    });

    const tables = jsonPayload(result).tables;
    expect(Array.isArray(tables)).toBe(true);
    expect(tables).not.toHaveLength(0);
    expect(tables?.[0]).toHaveProperty('name');
    expect(tables?.[0]).not.toHaveProperty('columns');
    expect(tables?.[0]).not.toHaveProperty('measures');
  });

  it('can opt into nested columns and measures', async () => {
    const result = await callTool('pbi_model_list_tables', {
      folderPath: semanticModelFixture(STAR_FIXTURE),
      includeColumns: true,
      includeMeasures: true,
    });

    const tables = jsonPayload(result).tables as Record<string, unknown>[] | undefined;
    expect(tables?.[0]).toHaveProperty('columns');
    expect(tables?.[0]).toHaveProperty('measures');
  });

  it('uses a fresh live snapshot for user-facing nested table reads', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const selectedConnection = {
      mode: 'live' as const,
      connectionString: 'Data Source=localhost:2;',
    };
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: selectedConnection.connectionString }];
      },
      async ensureConnection() {
        return selectedConnection;
      },
      async getFreshSnapshot() {
        return {
          modelPath: '(live)',
          tables: [
            {
              name: 'FreshTable',
              columns: [],
              measures: [],
              isHidden: false,
              isCalculated: false,
              isAutoDateTable: false,
            },
          ],
          relationships: [],
        };
      },
      async getCachedSnapshot() {
        return {
          modelPath: '(live)',
          tables: [
            {
              name: 'StaleTable',
              columns: [],
              measures: [],
              isHidden: false,
              isCalculated: false,
              isAutoDateTable: false,
            },
          ],
          relationships: [],
        };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await callTool('pbi_model_list_tables', {
      includeColumns: true,
      includeMeasures: true,
    });

    const tables = jsonPayload(result).tables as Record<string, unknown>[] | undefined;
    expect(tables?.map((table) => table.name)).toEqual(['FreshTable']);
  });

  it('redacts the live connection in pbi_model_snapshot output', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const selectedConnection = {
      mode: 'live' as const,
      connectionString: 'Data Source=localhost:2;Password=secret;',
    };
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: selectedConnection.connectionString }];
      },
      async ensureConnection() {
        return selectedConnection;
      },
      async getFreshSnapshot() {
        return {
          modelPath: '(live)',
          tables: [],
          relationships: [],
        };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await callTool('pbi_model_snapshot', {});
    const payload = jsonPayload(result);

    expect(JSON.stringify(payload)).not.toContain('localhost:2');
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(payload).not.toHaveProperty('connection');
    expect(payload.liveTarget).toEqual(
      expect.objectContaining({
        mode: 'live',
        connectionString: expect.stringContaining('Data Source=***'),
      }),
    );
  });

  it('binds the live fast table inventory call to the selected connection', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const selectedConnection = {
      mode: 'live' as const,
      connectionString: 'Data Source=localhost:2;',
    };
    let inventoryConnection: unknown;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: selectedConnection.connectionString }];
      },
      async ensureConnection() {
        return selectedConnection;
      },
      async listTableInventoryRaw(connection: unknown) {
        inventoryConnection = connection;
        return [{ name: 'Selected', isHidden: false, isCalculated: false, isAutoDateTable: false }];
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await callTool('pbi_model_list_tables', {});

    expect(jsonPayload(result).mode).toBe('live');
    expect(inventoryConnection).toEqual(selectedConnection);
  });

  it('uses a fresh live snapshot for nested table discovery reads', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live discovery behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const selectedConnection = {
      mode: 'live' as const,
      connectionString: 'Data Source=localhost:2;',
    };
    let freshReads = 0;
    let cachedReads = 0;
    let freshConnection: unknown;
    setModelDriverForTests({
      async ensureConnection() {
        return selectedConnection;
      },
      async getFreshSnapshot(connection: unknown) {
        freshReads += 1;
        freshConnection = connection;
        return {
          modelPath: '(live)',
          tables: [
            {
              name: 'FreshTable',
              columns: [
                {
                  table: 'FreshTable',
                  name: 'FreshColumn',
                  dataType: 'string',
                  isHidden: false,
                  isKey: false,
                  isCalculated: false,
                },
              ],
              measures: [],
              isHidden: false,
              isCalculated: false,
              isAutoDateTable: false,
            },
          ],
          relationships: [],
        };
      },
      async getCachedSnapshot() {
        cachedReads += 1;
        return {
          modelPath: '(live)',
          tables: [
            {
              name: 'CachedTable',
              columns: [],
              measures: [],
              isHidden: false,
              isCalculated: false,
              isAutoDateTable: false,
            },
          ],
          relationships: [],
        };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await callTool('pbi_model_list_tables', {
      includeColumns: true,
    });

    const tables = jsonPayload(result).tables as Record<string, unknown>[] | undefined;
    expect(freshReads).toBe(1);
    expect(cachedReads).toBe(0);
    expect(freshConnection).toEqual(selectedConnection);
    expect(tables?.map((table) => table.name)).toEqual(['FreshTable']);
  });

  it('returns redacted live-target diagnostics when live table inventory is empty', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live discovery behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const selectedConnection = {
      mode: 'live' as const,
      connectionString:
        'Data Source=localhost:61234;Initial Catalog=DiagnosticsModel;Password=hunter2;',
    };
    setModelDriverForTests({
      async ensureConnection() {
        return selectedConnection;
      },
      async listTableInventoryRaw() {
        return [];
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await callTool('pbi_model_list_tables', {});
    const payload = jsonPayload(result);
    const diagnostics = payload.diagnostics as Record<string, unknown> | undefined;
    const liveTarget = diagnostics?.liveTarget as Record<string, unknown> | undefined;
    const remediation = diagnostics?.remediation as string[] | undefined;

    expect(payload.mode).toBe('live');
    expect(payload.tables).toEqual([]);
    expect(liveTarget?.mode).toBe('live');
    expect(JSON.stringify(liveTarget)).not.toContain('localhost:61234');
    expect(JSON.stringify(liveTarget)).not.toContain('hunter2');
    expect(remediation?.join('\n')).toContain('pbi_model_refresh');
    expect(remediation?.join('\n')).toContain('Ctrl+S');
  });

  it('adds redacted live-target diagnostics when a relationship endpoint table is missing', async () => {
    const selectedConnection = {
      mode: 'live' as const,
      connectionString: 'Data Source=localhost:61234;Password=hunter2;',
    };
    setModelDriverForTests({
      async ensureConnection() {
        return selectedConnection;
      },
      async getCachedSnapshot() {
        return {
          modelPath: '(live)',
          tables: [
            {
              name: 'ExistingTable',
              columns: [
                {
                  table: 'ExistingTable',
                  name: 'Id',
                  dataType: 'int64',
                  isHidden: false,
                  isKey: true,
                  isCalculated: false,
                },
              ],
              measures: [],
              isHidden: false,
              isCalculated: false,
              isAutoDateTable: false,
            },
          ],
          relationships: [],
        };
      },
      async createRelationship() {
        throw new Error('createRelationship should not be called when a table is missing');
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await callTool('pbi_relationship_create', {
      fromTable: 'MissingTable',
      fromColumn: 'Id',
      toTable: 'ExistingTable',
      toColumn: 'Id',
    });

    const payload = jsonPayload(result);
    const diagnostics = payload.diagnostics as Record<string, unknown> | undefined;
    const liveTarget = diagnostics?.liveTarget as Record<string, unknown> | undefined;

    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('relationship-check');
    expect(payload.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'from-table-missing' })]),
    );
    expect(diagnostics?.requestedTables).toEqual(['MissingTable', 'ExistingTable']);
    expect(JSON.stringify(liveTarget)).not.toContain('localhost:61234');
    expect(JSON.stringify(liveTarget)).not.toContain('hunter2');
    expect((diagnostics?.remediation as string[] | undefined)?.join('\n')).toContain(
      'pbi_model_refresh',
    );
  });

  it('binds pbi_dax_query execution to the selected connection', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const selectedConnection = {
      mode: 'live' as const,
      connectionString: 'Data Source=localhost:2;',
    };
    let daxConnection: unknown;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: selectedConnection.connectionString }];
      },
      async ensureConnection() {
        return selectedConnection;
      },
      async daxQuery(_query: string, connection: unknown) {
        daxConnection = connection;
        return { rows: [] };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    await callTool('pbi_dax_query', { query: 'EVALUATE ROW("x", 1)' });

    expect(daxConnection).toEqual(selectedConnection);
  });

  it('pbi_model_refresh refuses a reprocess without explicit confirmReprocess', async () => {
    let refreshed = false;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:1;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:1;' };
      },
      async refreshModel() {
        refreshed = true;
        return { refreshed: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);
    const result = await callTool('pbi_model_refresh', {});
    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('refresh-not-authorized');
    expect(refreshed).toBe(false);
  });

  it('pbi_model_refresh proceeds when confirmReprocess is true', async () => {
    let refreshed = false;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:1;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:1;' };
      },
      async refreshModel() {
        refreshed = true;
        return { refreshed: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);
    const result = await callTool('pbi_model_refresh', { confirmReprocess: true });
    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload.refreshed).toBe(true);
    expect(refreshed).toBe(true);
  });

  it('pbi_column_create surfaces an advisory for a calc expression with an unresolved reference', async () => {
    const snapshot = {
      modelPath: '(live)',
      tables: [
        {
          name: 'Sales',
          columns: [
            {
              table: 'Sales',
              name: 'Amount',
              dataType: 'decimal',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
          ],
          measures: [],
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
        },
      ],
      relationships: [],
    };
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:1;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:1;' };
      },
      async getModelSnapshot() {
        return snapshot;
      },
      async getCachedSnapshot() {
        return snapshot;
      },
      async createColumn() {
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);
    const result = await callTool('pbi_column_create', {
      tableName: 'Sales',
      name: 'Doubled',
      // [Amount] resolves via the host-table row context; [NonexistentColumn] does not.
      expression: '[Amount] + [NonexistentColumn]',
    });
    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload.created).toBe(true);
    const advisory = payload.referenceAdvisory as Record<string, unknown> | undefined;
    expect(advisory?.advisory).toBe('calc-expression-reference-check');
    expect(advisory?.missing).toContain('[NonexistentColumn]');
  });

  it('returns pbi_dax_query rows through the server boundary without dropping structured rows', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const selectedConnection = {
      mode: 'live' as const,
      connectionString: 'Data Source=localhost:2;',
    };
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: selectedConnection.connectionString }];
      },
      async ensureConnection() {
        return selectedConnection;
      },
      async daxQuery() {
        return {
          columns: ['[Label]', '[Value]'],
          rows: [{ '[Label]': 'ok', '[Value]': 1 }],
          rowCount: 1,
        };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await callTool('pbi_dax_query', { query: 'EVALUATE ROW("Value", 1)' });

    const payload = jsonPayload(result);
    expect(payload).toMatchObject({
      columns: ['[Label]', '[Value]'],
      rows: [{ '[Label]': 'ok', '[Value]': 1 }],
      rowCount: 1,
    });
  });
});
