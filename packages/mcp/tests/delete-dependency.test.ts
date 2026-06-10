import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type TMDLModel, parseTMDLFolder } from 'pbi-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, setModelDriverForTests } from '../src/server.js';

// Non-blocking delete-dependency pre-flight (P2-2). Deleting a table/column/
// measure that other objects depend on still deletes, but the result object now
// surfaces a `dependencyWarnings: string[]` advisory. These tests run fully
// offline against a real TMDL fixture (no live Power BI Desktop) by injecting a
// mock live driver whose cached snapshot is the parsed fixture model. Everything
// is dataset-agnostic — assertions reference only the fixture's own names.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAR_FIXTURE = path.resolve(__dirname, '../../core/tests/modeling/fixtures/star-good');

beforeEach(() => {
  // Force a live connection (the mock driver) instead of folder probing so the
  // injected getCachedSnapshot supplies the model the delete gate reads.
  process.env.PBI_MODELING_MCP_CONNECTION_STRING = 'Data Source=localhost:1;';
});

afterEach(() => {
  // biome-ignore lint/performance/noDelete: tests must restore the process environment
  delete process.env.PBI_MODELING_MCP_CONNECTION_STRING;
  setModelDriverForTests(null);
});

// Parse the fixture fresh per call. `proveRelationships` flips identityProven so
// relationship-addressed writes (which require a proven identity) are not refused
// before the dependency pre-flight runs.
function fixtureModel(proveRelationships = false): TMDLModel {
  const parsed = parseTMDLFolder(STAR_FIXTURE);
  if (!proveRelationships) return parsed;
  return {
    ...parsed,
    relationships: parsed.relationships.map((rel) => ({ ...rel, identityProven: true })),
  };
}

function installMockDriver(model: TMDLModel): void {
  setModelDriverForTests({
    async listLiveInstances() {
      return [{ connectionString: 'Data Source=localhost:1;' }];
    },
    async ensureConnection() {
      return { mode: 'live' as const, connectionString: 'Data Source=localhost:1;' };
    },
    async getCachedSnapshot() {
      return model;
    },
    async getFreshSnapshot() {
      return model;
    },
    async deleteTable() {
      return { ok: true };
    },
    async deleteColumn() {
      return { ok: true };
    },
    async deleteMeasure() {
      return { ok: true };
    },
    async deleteRelationship() {
      return { ok: true };
    },
  } as unknown as Parameters<typeof setModelDriverForTests>[0]);
}

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

function payload(result: Awaited<ReturnType<typeof callTool>>): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, unknown>;
  }
  const text = result.content.find((c) => c.type === 'text')?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function warningsOf(result: Awaited<ReturnType<typeof callTool>>): string[] {
  const value = payload(result).dependencyWarnings;
  return Array.isArray(value) ? (value as string[]) : [];
}

describe('delete-dependency pre-flight warnings', () => {
  it('deletes a table but still warns when a relationship uses it', async () => {
    installMockDriver(fixtureModel());
    const result = await callTool('pbi_table_delete', { name: 'Product' });

    const data = payload(result);
    expect(data.deleted).toBe(true);
    const warnings = warningsOf(result);
    expect(warnings.length).toBeGreaterThan(0);
    // The Sales -> Product relationship endpoint must be surfaced.
    expect(warnings.some((w) => w.includes('Product'))).toBe(true);
  });

  it('warns when deleting a table referenced by a measure expression', async () => {
    installMockDriver(fixtureModel());
    // Deleting the Sales fact breaks its own measures + relationships.
    const result = await callTool('pbi_table_delete', { name: 'Sales' });

    expect(payload(result).deleted).toBe(true);
    expect(warningsOf(result).length).toBeGreaterThan(0);
  });

  it('returns an empty dependencyWarnings array for an unreferenced table', async () => {
    // Add a standalone table that nothing references or joins to.
    const base = fixtureModel();
    const model: TMDLModel = {
      ...base,
      tables: [
        ...base.tables,
        {
          name: 'Orphan',
          columns: [
            {
              table: 'Orphan',
              name: 'Note',
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
    };
    installMockDriver(model);

    const result = await callTool('pbi_table_delete', { name: 'Orphan' });

    expect(payload(result).deleted).toBe(true);
    expect(warningsOf(result)).toEqual([]);
  });

  it('deletes a column but still warns when a relationship uses it as an endpoint', async () => {
    installMockDriver(fixtureModel());
    const result = await callTool('pbi_column_delete', {
      tableName: 'Sales',
      name: 'ProductKey',
    });

    expect(payload(result).deleted).toBe(true);
    const warnings = warningsOf(result);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.toLowerCase().includes('relationship'))).toBe(true);
  });

  it('warns when deleting a column referenced by a measure expression', async () => {
    installMockDriver(fixtureModel());
    // 'Total Amount' = SUM(Sales[Amount]) depends on Sales[Amount].
    const result = await callTool('pbi_column_delete', {
      tableName: 'Sales',
      name: 'Amount',
    });

    expect(payload(result).deleted).toBe(true);
    const warnings = warningsOf(result);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('Total Amount'))).toBe(true);
  });

  it('returns an empty dependencyWarnings array for an unreferenced column', async () => {
    installMockDriver(fixtureModel());
    // Product[Category] participates in no relationship and no measure DAX.
    const result = await callTool('pbi_column_delete', {
      tableName: 'Product',
      name: 'Category',
    });

    expect(payload(result).deleted).toBe(true);
    expect(warningsOf(result)).toEqual([]);
  });

  it('warns when deleting a measure referenced by another measure', async () => {
    installMockDriver(fixtureModel());
    // AOV = DIVIDE([Total Amount], [Total Orders]) depends on 'Total Amount'.
    const result = await callTool('pbi_measure_delete', {
      tableName: 'Sales',
      name: 'Total Amount',
    });

    expect(payload(result).deleted).toBe(true);
    const warnings = warningsOf(result);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('AOV'))).toBe(true);
  });

  it('returns an empty dependencyWarnings array for an unreferenced measure', async () => {
    installMockDriver(fixtureModel());
    // Nothing references AOV.
    const result = await callTool('pbi_measure_delete', {
      tableName: 'Sales',
      name: 'AOV',
    });

    expect(payload(result).deleted).toBe(true);
    expect(warningsOf(result)).toEqual([]);
  });

  it('surfaces dependencyWarnings when deleting an active relationship', async () => {
    installMockDriver(fixtureModel(true));
    const result = await callTool('pbi_relationship_delete', { id: 'rel-sales-product' });

    expect(payload(result).deleted).toBe(true);
    // Active single-direction edge: at least the active-filter-loss advisory.
    expect(warningsOf(result).length).toBeGreaterThan(0);
  });
});
