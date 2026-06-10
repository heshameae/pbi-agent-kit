import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, setModelDriverForTests } from '../src/server.js';

// Registration/annotation tests for the live-write CRUD tool surface. These
// exercise the registered MCP tool list only — no live Power BI Desktop is
// required (we never invoke a handler, just inspect listTools()).

type ToolInfo = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: {
    readonly properties?: Record<string, unknown>;
    readonly required?: readonly string[];
  };
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

function requiredOf(name: string): readonly string[] {
  return byName(name)?.inputSchema?.required ?? [];
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

afterEach(() => {
  setModelDriverForTests(null);
});

const NEW_TOOLS = [
  'pbi_date_table_create_governed',
  'pbi_model_apply_star_schema_join',
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
  'pbi_model_refresh',
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
  it('registers all live write tools', () => {
    expect(NEW_TOOLS).toHaveLength(15);
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

  it('pbi_relationship_create exposes explicit cardinality', () => {
    const props = paramsOf('pbi_relationship_create');
    expect(props.cardinality, 'pbi_relationship_create should accept cardinality').toBeDefined();
    expect(JSON.stringify(props.cardinality)).toContain('manyToOne');
    expect(JSON.stringify(props.cardinality)).not.toContain('manyToMany');
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

describe('modeling-only server surface', () => {
  const MODELING_SURFACE_TOOLS = [
    'pbi_model_check',
    'pbi_model_regulated_check',
    'pbi_model_snapshot',
    'pbi_model_list_tables',
    'pbi_model_list_columns',
    'pbi_model_list_measures',
    'pbi_model_list_relationships',
    'pbi_model_plan_star_schema_join',
    'pbi_model_plan_actuals_targets_join',
    'pbi_model_apply_star_schema_join',
    'pbi_model_plan_date_grain',
    'pbi_model_plan_date_table',
    'pbi_model_refresh',
    'pbi_model_export',
    'pbi_dax_query',
    'pbi_dax_reference_check',
    'pbi_measure_create',
    'pbi_measure_update',
    'pbi_measure_delete',
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
    'pbi_date_table_create_governed',
    'pbi_spec_validate',
  ] as const;

  it('builds the exact modeling launch surface without prefix-leaked tools', async () => {
    const server = buildServer({ surface: 'modeling' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    try {
      const list = await client.listTools();
      const names = list.tools.map((tool) => tool.name);
      expect([...names].sort()).toEqual([...MODELING_SURFACE_TOOLS].sort());
      expect(names).not.toContain('pbi_data_dictionary_get');
      expect(
        names.some((name) =>
          /^pbi_(report|page|visual|theme|filter|bookmark|format|layout)_/.test(name),
        ),
      ).toBe(false);
    } finally {
      await client.close();
    }
  });

  it('uses the exact modeling surface when PBI_MCP_SURFACE=modeling is set', async () => {
    const oldSurface = process.env.PBI_MCP_SURFACE;
    process.env.PBI_MCP_SURFACE = 'modeling';
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    try {
      const list = await client.listTools();
      const names = list.tools.map((tool) => tool.name);
      expect([...names].sort()).toEqual([...MODELING_SURFACE_TOOLS].sort());
    } finally {
      await client.close();
      if (oldSurface === undefined) {
        // biome-ignore lint/performance/noDelete: tests must restore process environment
        delete process.env.PBI_MCP_SURFACE;
      } else {
        process.env.PBI_MCP_SURFACE = oldSurface;
      }
    }
  });

  it('rejects unknown PBI_MCP_SURFACE values instead of exposing the full surface', () => {
    expect(() => buildServer({ surface: 'not-a-surface' as never })).toThrow(
      /PBI_MCP_SURFACE must be either "full" or "modeling"/,
    );
  });
});

describe('data dictionary tool registry', () => {
  it('registers pbi_data_dictionary_get as read-only and idempotent model metadata', () => {
    const tool = byName('pbi_data_dictionary_get');
    expect(tool, 'pbi_data_dictionary_get should be registered').toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.annotations?.idempotentHint).toBe(true);
    expect(tool?.annotations?.destructiveHint).toBe(false);
    const desc = tool?.description?.toLowerCase() ?? '';
    expect(desc).toContain('model metadata');
    expect(desc).toContain('not business meaning');
    const props = paramsOf('pbi_data_dictionary_get');
    expect(props.folderPath).toBeDefined();
    expect(props.model).toBeDefined();
    expect(props.includeHidden).toBeDefined();
    expect(props.includeExpressions).toBeDefined();
    expect(props.includeNested).toBeDefined();
    expect(props.tableNames).toBeDefined();
    expect(props.refs).toBeDefined();
  });
});

describe('report write tool registry', () => {
  it('warns PBIR disk-write tools not to use Desktop Ctrl+S from stale state', () => {
    const reportWriteTools = [
      'pbi_page_add',
      'pbi_visual_add',
      'pbi_visual_bind',
      'pbi_visual_set_container',
      'pbi_visual_bulk_update',
      'pbi_report_convert',
    ];

    for (const name of reportWriteTools) {
      const desc = byName(name)?.description?.toLowerCase() ?? '';
      expect(desc, name).toContain('pbir');
      expect(desc, name).toContain('disk');
      expect(desc, name).toContain('ctrl+s');
      expect(desc, name).toContain('stale');
      expect(desc, name).toMatch(/close\/reopen|reload/);
    }
  });

  it('returns a PBIR disk persistence warning from report write tool calls', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pbi-report-persist-'));
    try {
      const result = await callTool('pbi_report_create', {
        targetPath: root,
        name: 'PersistContract',
      });
      const structured = result.structuredContent as {
        reportPersistence?: {
          mode?: string;
          userAction?: string;
          saveRule?: string;
        };
      };
      expect(structured.reportPersistence?.mode).toBe('pbir-disk');
      expect(structured.reportPersistence?.userAction?.toLowerCase()).toContain(
        'do not press ctrl+s',
      );
      expect(structured.reportPersistence?.userAction?.toLowerCase()).toContain('stale');
      expect(structured.reportPersistence?.saveRule?.toLowerCase()).toContain('desktop edits');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it('pbi_model_check describes live-first validation with folder fallback', () => {
    const desc = byName('pbi_model_check')?.description?.toLowerCase() ?? '';
    expect(desc).toContain('live-first');
    expect(desc).toContain('modelpath is the offline fallback');
  });

  it('registers pbi_table_mark_as_date with fact coverage proof inputs and idempotentHint', () => {
    const tool = byName('pbi_table_mark_as_date');
    expect(tool, 'pbi_table_mark_as_date should be registered').toBeDefined();
    const props = paramsOf('pbi_table_mark_as_date');
    const required = requiredOf('pbi_table_mark_as_date');
    expect(props.tableName, 'pbi_table_mark_as_date should accept tableName').toBeDefined();
    expect(props.dateColumn, 'pbi_table_mark_as_date should accept dateColumn').toBeDefined();
    expect(props.facts, 'pbi_table_mark_as_date should require fact coverage inputs').toBeDefined();
    expect(
      props.futureHorizonDays,
      'pbi_table_mark_as_date should expose explicit future padding policy',
    ).toBeDefined();
    expect(required).toContain('tableName');
    expect(required).toContain('dateColumn');
    expect(required).toContain('facts');
    expect(tool?.annotations?.idempotentHint, 'mark-as-date should be idempotent').toBe(true);
    expect(tool?.annotations?.destructiveHint, 'mark-as-date should be non-destructive').toBe(
      false,
    );
  });

  it('registers pbi_model_plan_date_table with explicit coverage and future padding inputs', () => {
    const props = paramsOf('pbi_model_plan_date_table');
    const required = requiredOf('pbi_model_plan_date_table');
    expect(props.dateTable, 'pbi_model_plan_date_table should accept dateTable').toBeDefined();
    expect(props.dateColumn, 'pbi_model_plan_date_table should accept dateColumn').toBeDefined();
    expect(
      props.facts,
      'pbi_model_plan_date_table should accept fact coverage inputs',
    ).toBeDefined();
    expect(
      props.futureHorizonDays,
      'pbi_model_plan_date_table should expose future padding policy',
    ).toBeDefined();
    expect(required).toContain('dateTable');
    expect(required).toContain('dateColumn');
    expect(required).toContain('facts');
  });

  it('caps futureHorizonDays consistently on Date grain and relationship gates', () => {
    const toolNames = [
      'pbi_model_plan_date_grain',
      'pbi_relationship_create',
      'pbi_relationship_update',
      'pbi_relationship_activate',
      'pbi_table_mark_as_date',
      'pbi_model_plan_date_table',
      'pbi_date_table_create_governed',
    ];

    for (const name of toolNames) {
      const schema = JSON.stringify(paramsOf(name).futureHorizonDays);
      expect(schema, `${name} should cap futureHorizonDays`).toContain('"maximum":3660');
    }
  });

  it('registers governed Date table create with clarification and refresh inputs', () => {
    const tool = byName('pbi_date_table_create_governed');
    expect(tool, 'pbi_date_table_create_governed should be registered').toBeDefined();
    const desc = tool?.description?.toLowerCase() ?? '';
    expect(desc).toContain('clarifyingquestions');
    expect(desc).toContain('dynamic fact-anchored dax');
    expect(desc).toContain('refresh');
    expect(desc).toContain('explicit');
    expect(desc).toContain('refreshbeforeprobe');
    expect(desc).toContain('today');
    expect(desc).not.toContain('attempts live refresh automatically');
    expect(desc).not.toContain('refresh automatically');
    const props = paramsOf('pbi_date_table_create_governed');
    const required = requiredOf('pbi_date_table_create_governed');
    expect(props.tableName).toBeDefined();
    expect(props.dateColumn).toBeDefined();
    expect(props.facts).toBeDefined();
    expect(props.rangePolicy).toBeDefined();
    expect(props.futureHorizonDays).toBeDefined();
    expect(props.refreshBeforeProbe).toBeDefined();
    const refreshDesc = String(props.refreshBeforeProbe?.description ?? '').toLowerCase();
    expect(refreshDesc).toContain('explicit');
    expect(refreshDesc).toContain('needs-user-input');
    expect(refreshDesc).not.toContain('defaults to true');
    expect(props.createRelationships).toBeDefined();
    expect(required).toContain('tableName');
    expect(required).toContain('dateColumn');
    expect(required).toContain('facts');
    expect(required).not.toContain('rangePolicy');
    expect(tool?.annotations?.destructiveHint).toBe(false);
    expect(tool?.annotations?.idempotentHint).toBe(false);
  });

  it('describes date-grain planning as required before asking users to choose target grain', () => {
    const tool = byName('pbi_model_plan_date_grain');
    expect(tool, 'pbi_model_plan_date_grain should be registered').toBeDefined();
    const desc = tool?.description?.toLowerCase() ?? '';
    expect(desc).toContain('before asking');
    expect(desc).toContain('target grain');
    expect(desc).toContain('day/month/year');
    expect(desc).toContain('allocation');
  });

  it('steers cross-fact star-schema writes away from primitive table and relationship tools', () => {
    const tableDesc = byName('pbi_table_create')?.description?.toLowerCase() ?? '';
    const relationshipDesc = byName('pbi_relationship_create')?.description?.toLowerCase() ?? '';
    expect(tableDesc).toContain('pbi_model_apply_star_schema_join');
    expect(tableDesc).toContain('cross-fact');
    expect(tableDesc).toContain('do not manually replay');
    expect(relationshipDesc).toContain('pbi_model_apply_star_schema_join');
    expect(relationshipDesc).toContain('cross-fact');
    expect(relationshipDesc).toContain('do not manually replay');
  });

  it('does not advertise primitive table create or DAX query as Date-table fallback paths', () => {
    const table = byName('pbi_table_create');
    const tableDesc = table?.description?.toLowerCase() ?? '';
    const tableExpressionDesc = String(
      paramsOf('pbi_table_create').expression?.description ?? '',
    ).toLowerCase();
    expect(tableDesc).toContain('date/calendar table creation is refused');
    expect(tableDesc).toContain('pbi_date_table_create_governed');
    expect(tableDesc).not.toMatch(/e\.g\.\s*calendar/);
    expect(tableExpressionDesc).toContain('non-date');
    expect(tableExpressionDesc).not.toContain('calendar');

    const daxDesc = byName('pbi_dax_query')?.description?.toLowerCase() ?? '';
    expect(daxDesc).toContain('not a date-table proof fallback');
    expect(daxDesc).toContain('does not authorize date writes');
    expect(daxDesc).toContain('pbi_date_table_create_governed');
  });

  it('registers star-schema apply as the batched deterministic shared-dimension path', () => {
    const tool = byName('pbi_model_apply_star_schema_join');
    expect(tool, 'pbi_model_apply_star_schema_join should be registered').toBeDefined();
    const desc = tool?.description?.toLowerCase() ?? '';
    expect(desc).toContain('batch-apply');
    expect(desc).toContain('dry-run');
    expect(desc).toContain('planner-backed');
    expect(desc).toContain('hides fact-side fk fields');
    expect(desc).not.toContain('prompting agents');
    const props = paramsOf('pbi_model_apply_star_schema_join');
    const required = requiredOf('pbi_model_apply_star_schema_join');
    expect(props.leftTable).toBeDefined();
    expect(props.rightTable).toBeDefined();
    expect(props.axes).toBeDefined();
    expect(props.dryRun).toBeDefined();
    expect(props.refreshAfterCreate).toBeDefined();
    expect(props.runModelCheck).toBeDefined();
    expect(required).toContain('leftTable');
    expect(required).toContain('rightTable');
    expect(required).toContain('axes');
    expect(tool?.annotations?.destructiveHint).toBe(false);
    expect(tool?.annotations?.idempotentHint).toBe(false);
  });

  it('registers actuals-targets join planning as a read-only combined workflow tool', () => {
    const tool = byName('pbi_model_plan_actuals_targets_join');
    expect(tool, 'pbi_model_plan_actuals_targets_join should be registered').toBeDefined();
    const desc = tool?.description?.toLowerCase() ?? '';
    expect(desc).toContain('actuals');
    expect(desc).toContain('targets');
    expect(desc).toContain('star-schema');
    expect(desc).toContain('date-grain');
    expect(desc).toContain('before asking');
    expect(desc).toContain('allocation');
    const props = paramsOf('pbi_model_plan_actuals_targets_join');
    const required = requiredOf('pbi_model_plan_actuals_targets_join');
    expect(props.leftTable).toBeDefined();
    expect(props.rightTable).toBeDefined();
    expect(props.axes).toBeDefined();
    expect(props.dateRefs).toBeDefined();
    expect(props.dateTable).toBeDefined();
    expect(props.dateColumn).toBeDefined();
    expect(required).toContain('leftTable');
    expect(required).toContain('rightTable');
    expect(required).not.toContain('axes');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.annotations?.destructiveHint).toBe(false);
  });

  it('registers live model refresh so agents do not ask users to refresh manually', () => {
    const tool = byName('pbi_model_refresh');
    expect(tool, 'pbi_model_refresh should be registered').toBeDefined();
    const desc = tool?.description?.toLowerCase() ?? '';
    expect(desc).toContain('refresh');
    expect(desc).toContain('instead of asking the user');
    expect(paramsOf('pbi_model_refresh').refreshType).toBeDefined();
    expect(tool?.annotations?.destructiveHint).toBe(false);
    expect(tool?.annotations?.idempotentHint).toBe(true);
  });

  it('registers regulated-enterprise model check with explicit evidence inputs', () => {
    const tool = byName('pbi_model_regulated_check');
    expect(tool, 'pbi_model_regulated_check should be registered').toBeDefined();
    const desc = tool?.description?.toLowerCase() ?? '';
    expect(desc).toContain('regulated');
    expect(desc).toContain('not captured');
    expect(desc).toContain('copilot');
    const props = paramsOf('pbi_model_regulated_check');
    expect(props.policyEvidence).toBeDefined();
    expect(props.model).toBeDefined();
    expect(props.modelPath).toBeDefined();
  });

  it('keeps pbi_measure_update expression optional for metadata-only updates', () => {
    const props = paramsOf('pbi_measure_update');
    const required = requiredOf('pbi_measure_update');
    expect(props.expression, 'pbi_measure_update should accept expression').toBeDefined();
    expect(props.measureIntent, 'pbi_measure_update should accept measureIntent').toBeDefined();
    expect(required).toContain('tableName');
    expect(required).toContain('name');
    expect(required).toContain('measureIntent');
    expect(required).not.toContain('expression');
  });

  it('requires confirmed measure intent evidence on measure creation', () => {
    const props = paramsOf('pbi_measure_create');
    const required = requiredOf('pbi_measure_create');
    expect(props.measureIntent, 'pbi_measure_create should accept measureIntent').toBeDefined();
    expect(required).toContain('measureIntent');
    const desc = byName('pbi_measure_create')?.description?.toLowerCase() ?? '';
    expect(desc).toContain('confirmed measure intent');
    expect(desc).toContain('time-intelligence');
  });

  it('refuses measure metadata updates without confirmed measure intent at the tool boundary', async () => {
    const result = await callTool('pbi_measure_update', {
      tableName: 'Measures',
      name: 'Planned Metric',
      formatString: '0.0',
    });
    expect(result.isError).toBe(true);
    expect(result.content.find((part) => part.type === 'text')?.text).toContain('measureIntent');
  });

  it('returns concise text content instead of duplicating structured JSON payloads', async () => {
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async listTableInventoryRaw() {
        return [
          {
            name: 'Fact',
            isHidden: false,
            isCalculated: false,
            isAutoDateTable: false,
            columnCount: 2,
            measureCount: 1,
          },
        ];
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await callTool('pbi_model_list_tables', {});
    const text = result.content.find((part) => part.type === 'text')?.text ?? '';

    expect(result.structuredContent).toMatchObject({
      mode: 'live',
      tables: [expect.objectContaining({ name: 'Fact' })],
    });
    expect(text).not.toBe(JSON.stringify(result.structuredContent, null, 2));
    expect(text.length).toBeLessThan(800);
  });

  it('refuses time-intelligence measure writes with unresolved date evidence', async () => {
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return {
          modelPath: '(live)',
          tables: [
            {
              name: 'FactLeft',
              columns: [
                {
                  table: 'FactLeft',
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
            {
              name: 'Date',
              columns: [
                {
                  table: 'Date',
                  name: 'Date',
                  dataType: 'date',
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
      async createMeasure() {
        throw new Error('createMeasure should not be called when Date evidence is invalid');
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await callTool('pbi_measure_create', {
      tableName: 'FactLeft',
      name: 'Amount YTD',
      expression: "TOTALYTD(SUM(FactLeft[Amount]), 'Date'[Date])",
      measureIntent: {
        measureName: 'Amount YTD',
        status: 'confirmed',
        owner: 'test',
        definition: 'Confirmed test definition.',
        sourceRefs: [{ table: 'FactLeft', column: 'Amount', kind: 'column', isHidden: false }],
        grain: 'day',
        additivity: 'additive',
        filters: [],
        format: '0',
        unit: 'units',
        caveats: [],
        timeIntelligence: {
          dateRefs: [{ table: 'Missing Date', column: 'Date', kind: 'column', isHidden: false }],
          dateTable: 'Date',
          dateColumn: 'Date',
          grain: 'day',
          calendarPolicy: 'calendar year',
          incompletePeriodBehavior: 'exclude incomplete periods',
        },
      },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      reason: 'measure-intent-date-ref-missing',
      measureName: 'Amount YTD',
    });
  });

  it('requires relationship ids on id-addressed relationship writes', () => {
    for (const name of [
      'pbi_relationship_update',
      'pbi_relationship_activate',
      'pbi_relationship_deactivate',
      'pbi_relationship_delete',
    ]) {
      expect(paramsOf(name).id, `${name} should expose id`).toBeDefined();
      expect(requiredOf(name), `${name} should require id`).toContain('id');
    }
  });

  it('requires deterministic planner and CRUD identity fields in schemas', () => {
    const requiredByTool: Record<string, readonly string[]> = {
      pbi_model_plan_date_grain: ['facts'],
      pbi_model_plan_star_schema_join: ['leftTable', 'rightTable'],
      pbi_table_create: ['name'],
      pbi_column_create: ['tableName', 'name'],
      pbi_column_update: ['tableName', 'name'],
      pbi_column_delete: ['tableName', 'name'],
      pbi_relationship_create: ['fromTable', 'fromColumn', 'toTable', 'toColumn'],
    };

    for (const [name, requiredFields] of Object.entries(requiredByTool)) {
      const props = paramsOf(name);
      const required = requiredOf(name);
      for (const field of requiredFields) {
        expect(props[field], `${name} should expose ${field}`).toBeDefined();
        expect(required, `${name} should require ${field}`).toContain(field);
      }
    }
  });

  it('requires pbi_model_export folderPath so live persistence is not guessed', () => {
    const props = paramsOf('pbi_model_export');
    const required = requiredOf('pbi_model_export');
    expect(props.folderPath, 'pbi_model_export should expose folderPath').toBeDefined();
    expect(required).toContain('folderPath');
  });
});

describe('model selector threading', () => {
  // Every live model tool must accept the optional `model` selector that fixes
  // the multi-instance connection bug.
  const MODEL_TOOLS = [
    'pbi_model_snapshot',
    'pbi_model_check',
    'pbi_model_list_tables',
    'pbi_model_list_columns',
    'pbi_model_list_measures',
    'pbi_model_list_relationships',
    'pbi_model_plan_star_schema_join',
    'pbi_model_plan_date_grain',
    'pbi_model_plan_date_table',
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
