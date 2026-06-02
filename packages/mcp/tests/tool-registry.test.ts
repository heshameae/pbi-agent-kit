import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

// Registration/annotation tests for the live-write CRUD tool surface. These
// exercise the registered MCP tool list only — no live Power BI Desktop is
// required (we never invoke a handler, just inspect listTools()).

type ToolInfo = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: { readonly properties?: Record<string, unknown> };
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
  };
};

let tools: ToolInfo[] = [];

function byName(name: string): ToolInfo | undefined {
  return tools.find((t) => t.name === name);
}

function paramsOf(name: string): Record<string, unknown> {
  return byName(name)?.inputSchema?.properties ?? {};
}

beforeAll(async () => {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  try {
    const list = await client.listTools();
    tools = list.tools as ToolInfo[];
  } finally {
    await client.close();
  }
});

const NEW_TOOLS = [
  'pbi_table_create',
  'pbi_table_update',
  'pbi_table_mark_as_date',
  'pbi_table_delete',
  'pbi_column_create',
  'pbi_column_update',
  'pbi_column_delete',
  'pbi_relationship_create',
  'pbi_relationship_update',
  'pbi_relationship_activate',
  'pbi_relationship_deactivate',
  'pbi_relationship_delete',
];

const DELETE_TOOLS = ['pbi_table_delete', 'pbi_column_delete', 'pbi_relationship_delete'];

const IDEMPOTENT_TOOLS = [
  'pbi_table_update',
  'pbi_table_mark_as_date',
  'pbi_column_update',
  'pbi_relationship_update',
  'pbi_relationship_activate',
  'pbi_relationship_deactivate',
];

const CREATE_TOOLS = ['pbi_table_create', 'pbi_column_create', 'pbi_relationship_create'];

describe('live-write CRUD tool registry', () => {
  it('registers all 12 new write tools', () => {
    expect(NEW_TOOLS).toHaveLength(12);
    for (const name of NEW_TOOLS) {
      expect(byName(name), `expected ${name} to be registered`).toBeDefined();
    }
  });

  it('marks the three delete tools as destructive', () => {
    for (const name of DELETE_TOOLS) {
      expect(byName(name)?.annotations?.destructiveHint, name).toBe(true);
    }
  });

  it('marks updates/activate/deactivate as idempotent', () => {
    for (const name of IDEMPOTENT_TOOLS) {
      expect(byName(name)?.annotations?.idempotentHint, name).toBe(true);
    }
  });

  it('marks creates as non-destructive and non-idempotent', () => {
    for (const name of CREATE_TOOLS) {
      const ann = byName(name)?.annotations;
      expect(ann?.destructiveHint, name).toBe(false);
      expect(ann?.idempotentHint, name).toBe(false);
    }
  });

  it('describes the relationship-create validity gate / refusal', () => {
    const desc = byName('pbi_relationship_create')?.description ?? '';
    expect(desc.toLowerCase()).toContain('gate');
    expect(desc.toLowerCase()).toContain('refused');
  });

  it('notes calculated-column DAX is engine-validated (no false-positive pre-flight gate)', () => {
    const desc = byName('pbi_column_create')?.description ?? '';
    expect(desc.toLowerCase()).toContain('calculated');
    expect(desc.toLowerCase()).toContain('validated');
  });

  it('notes calculated columns work on imported tables (kills the stale limitation)', () => {
    const desc = byName('pbi_column_create')?.description?.toLowerCase() ?? '';
    expect(desc).toContain('imported');
  });
});

describe('date-table modeling params', () => {
  it('pbi_column_create exposes isKey + dataCategory', () => {
    const props = paramsOf('pbi_column_create');
    expect(props.isKey, 'pbi_column_create should accept isKey').toBeDefined();
    expect(props.dataCategory, 'pbi_column_create should accept dataCategory').toBeDefined();
  });

  it('pbi_column_update exposes isKey + dataCategory', () => {
    const props = paramsOf('pbi_column_update');
    expect(props.isKey, 'pbi_column_update should accept isKey').toBeDefined();
    expect(props.dataCategory, 'pbi_column_update should accept dataCategory').toBeDefined();
  });

  it('pbi_table_update exposes dataCategory', () => {
    const props = paramsOf('pbi_table_update');
    expect(props.dataCategory, 'pbi_table_update should accept dataCategory').toBeDefined();
  });

  it('registers pbi_table_mark_as_date with tableName + dateColumn and idempotentHint', () => {
    const tool = byName('pbi_table_mark_as_date');
    expect(tool, 'pbi_table_mark_as_date should be registered').toBeDefined();
    const props = paramsOf('pbi_table_mark_as_date');
    expect(props.tableName, 'pbi_table_mark_as_date should accept tableName').toBeDefined();
    expect(props.dateColumn, 'pbi_table_mark_as_date should accept dateColumn').toBeDefined();
    expect(tool?.annotations?.idempotentHint, 'mark-as-date should be idempotent').toBe(true);
    expect(tool?.annotations?.destructiveHint, 'mark-as-date should be non-destructive').toBe(
      false,
    );
  });
});

describe('model selector threading', () => {
  // Every live model tool must accept the optional `model` selector that fixes
  // the multi-instance connection bug.
  const MODEL_TOOLS = [
    'pbi_model_snapshot',
    'pbi_model_list_tables',
    'pbi_model_list_columns',
    'pbi_model_list_measures',
    'pbi_model_list_relationships',
    'pbi_dax_query',
    'pbi_measure_create',
    'pbi_measure_update',
    'pbi_measure_delete',
    'pbi_model_export',
    ...NEW_TOOLS,
  ];

  it('exposes a `model` input property on every live model tool', () => {
    for (const name of MODEL_TOOLS) {
      const found = tools.find((t) => t.name === name) as
        | (ToolInfo & { inputSchema?: { properties?: Record<string, unknown> } })
        | undefined;
      expect(found, `${name} should be registered`).toBeDefined();
      expect(found?.inputSchema?.properties?.model, `${name} should accept model`).toBeDefined();
    }
  });
});
