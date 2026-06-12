import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, setModelDriverForTests } from '../src/server.js';

const tempRoots: string[] = [];

beforeEach(() => {
  process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
});

type ToolInfo = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: { readonly properties?: Record<string, unknown> };
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
  };
};

function twoFactSharedColumnModel(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pbi-star-plan-'));
  tempRoots.push(root);
  const definition = path.join(root, 'Fixture.SemanticModel', 'definition');
  const tables = path.join(definition, 'tables');
  mkdirSync(tables, { recursive: true });

  writeFileSync(
    path.join(tables, 'FactLeft.tmdl'),
    `table FactLeft
\tmeasure 'Total Left' = SUM(FactLeft[Amount])

\tcolumn SharedCode
\t\tdataType: string
\t\tsummarizeBy: none
\t\tsourceColumn: SharedCode

\tcolumn Amount
\t\tdataType: decimal
\t\tsummarizeBy: sum
\t\tsourceColumn: Amount
`,
  );

  writeFileSync(
    path.join(tables, 'FactRight.tmdl'),
    `table FactRight
\tmeasure 'Total Right' = SUM(FactRight[Amount])

\tcolumn SharedCode
\t\tdataType: string
\t\tsummarizeBy: none
\t\tsourceColumn: SharedCode

\tcolumn Amount
\t\tdataType: decimal
\t\tsummarizeBy: sum
\t\tsourceColumn: Amount
`,
  );

  return definition;
}

function singleFactMissingAmountModel(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pbi-star-plan-'));
  tempRoots.push(root);
  const definition = path.join(root, 'Fixture.SemanticModel', 'definition');
  const tables = path.join(definition, 'tables');
  mkdirSync(tables, { recursive: true });

  writeFileSync(
    path.join(tables, 'FactLeft.tmdl'),
    `table FactLeft
\tcolumn SharedCode
\t\tdataType: string
\t\tsummarizeBy: none
\t\tsourceColumn: SharedCode
`,
  );

  return definition;
}

afterEach(() => {
  // biome-ignore lint/performance/noDelete: tests must restore the process environment
  delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
  // biome-ignore lint/performance/noDelete: tests must restore the process environment
  delete process.env.PBI_MODELING_MCP_CONNECTION_STRING;
  setModelDriverForTests(null);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function jsonPayload(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, unknown>;
  }
  const text = result.content.find((c) => c.type === 'text')?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function confirmedMeasureIntent(
  measureName: string,
  sourceRef: { table: string; column: string },
): Record<string, unknown> {
  return {
    measureName,
    status: 'confirmed',
    owner: 'test',
    definition: 'Confirmed test measure definition.',
    sourceRefs: [{ ...sourceRef, kind: 'column', isHidden: false }],
    grain: 'test grain',
    additivity: 'additive',
    filters: [],
    format: '0',
    unit: 'units',
    caveats: [],
  };
}

type MutableColumn = {
  table: string;
  name: string;
  dataType?: string;
  summarizeBy?: string;
  isHidden: boolean;
  isKey: boolean;
  isCalculated: boolean;
};

type MutableTable = {
  name: string;
  columns: MutableColumn[];
  measures: unknown[];
  isHidden: boolean;
  isCalculated: boolean;
  isAutoDateTable: boolean;
};

type MutableRelationship = {
  id: string;
  identityProven?: boolean;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  isActive: boolean;
  crossFilteringBehavior: 'single' | 'both';
  cardinality: 'manyToOne';
};

type MutableModel = {
  modelPath: string;
  tables: MutableTable[];
  relationships: MutableRelationship[];
};

function liveTwoTableSnapshot() {
  return {
    modelPath: '(live)',
    tables: [
      {
        name: 'FactLeft',
        columns: [
          {
            table: 'FactLeft',
            name: 'SharedCode',
            dataType: 'String',
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
        name: 'FactRight',
        columns: [
          {
            table: 'FactRight',
            name: 'SharedCode',
            dataType: 'String',
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
}

function liveTwoTableSnapshotWithSharedDate() {
  const snapshot = structuredClone(liveTwoTableSnapshot());
  snapshot.tables[0]?.columns.push({
    table: 'FactLeft',
    name: 'TxnDate',
    dataType: 'dateTime',
    isHidden: false,
    isKey: false,
    isCalculated: false,
  });
  snapshot.tables[1]?.columns.push({
    table: 'FactRight',
    name: 'TxnDate',
    dataType: 'dateTime',
    isHidden: false,
    isKey: false,
    isCalculated: false,
  });
  snapshot.tables.push(
    {
      name: 'LocalDateTable_Left',
      columns: [
        {
          table: 'LocalDateTable_Left',
          name: 'Date',
          dataType: 'dateTime',
          isHidden: false,
          isKey: true,
          isCalculated: false,
        },
      ],
      measures: [],
      isHidden: true,
      isCalculated: true,
      isAutoDateTable: true,
    },
    {
      name: 'LocalDateTable_Right',
      columns: [
        {
          table: 'LocalDateTable_Right',
          name: 'Date',
          dataType: 'dateTime',
          isHidden: false,
          isKey: true,
          isCalculated: false,
        },
      ],
      measures: [],
      isHidden: true,
      isCalculated: true,
      isAutoDateTable: true,
    },
  );
  snapshot.relationships.push(
    {
      id: 'left-local-date',
      fromTable: 'FactLeft',
      fromColumn: 'TxnDate',
      toTable: 'LocalDateTable_Left',
      toColumn: 'Date',
      isActive: true,
      crossFilteringBehavior: 'single',
      cardinality: 'manyToOne',
    },
    {
      id: 'right-local-date',
      fromTable: 'FactRight',
      fromColumn: 'TxnDate',
      toTable: 'LocalDateTable_Right',
      toColumn: 'Date',
      isActive: true,
      crossFilteringBehavior: 'single',
      cardinality: 'manyToOne',
    },
  );
  return snapshot;
}

function liveTwoTableSnapshotWithGovernedDate(options: { withSource?: boolean } = {}) {
  const withSource = options.withSource !== false;
  const snapshot = liveTwoTableSnapshotWithSharedDate();
  const dateTable = {
    name: 'Date',
    dataCategory: 'Time',
    columns: [
      {
        table: 'Date',
        name: 'Date',
        dataType: 'dateTime',
        dataCategory: 'Time',
        isHidden: false,
        isKey: false,
        isCalculated: false,
      },
    ],
    measures: [],
    isHidden: false,
    isCalculated: true,
    isAutoDateTable: false,
    ...(withSource
      ? {
          partitionSources: [
            {
              kind: 'calculated',
              expression: [
                'CALENDAR(',
                '  MINX(',
                '    UNION(',
                '      SELECTCOLUMNS(FactLeft, "Date", FactLeft[TxnDate]),',
                '      SELECTCOLUMNS(FactRight, "Date", FactRight[TxnDate])',
                '    ),',
                '    [Date]',
                '  ),',
                '  MAXX(',
                '    UNION(',
                '      SELECTCOLUMNS(FactLeft, "Date", FactLeft[TxnDate]),',
                '      SELECTCOLUMNS(FactRight, "Date", FactRight[TxnDate])',
                '    ),',
                '    [Date]',
                '  )',
                ')',
              ].join('\n'),
            },
          ],
        }
      : {}),
  };
  snapshot.tables.push(dateTable);
  snapshot.relationships.push(
    {
      id: 'left-governed-date',
      fromTable: 'FactLeft',
      fromColumn: 'TxnDate',
      toTable: 'Date',
      toColumn: 'Date',
      isActive: true,
      crossFilteringBehavior: 'single',
      cardinality: 'manyToOne',
    },
    {
      id: 'right-governed-date',
      fromTable: 'FactRight',
      fromColumn: 'TxnDate',
      toTable: 'Date',
      toColumn: 'Date',
      isActive: true,
      crossFilteringBehavior: 'single',
      cardinality: 'manyToOne',
    },
  );
  return snapshot;
}

function blockedSharedDimensionSnapshot() {
  return {
    modelPath: '(live)',
    tables: [
      {
        name: 'FactLeft',
        columns: [
          {
            table: 'FactLeft',
            name: 'SharedCode',
            dataType: 'string',
            isHidden: false,
            isKey: false,
            isCalculated: false,
          },
          {
            table: 'FactLeft',
            name: 'LegacyCode',
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
      {
        name: 'FactRight',
        columns: [
          {
            table: 'FactRight',
            name: 'SharedCode',
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
      {
        name: 'SharedCode',
        columns: [
          {
            table: 'SharedCode',
            name: 'SharedCode',
            dataType: 'string',
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
    relationships: [
      {
        id: 'fact-right-shared',
        fromTable: 'FactRight',
        fromColumn: 'SharedCode',
        toTable: 'SharedCode',
        toColumn: 'SharedCode',
        isActive: true,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      },
      {
        id: 'fact-left-legacy-shared',
        fromTable: 'FactLeft',
        fromColumn: 'LegacyCode',
        toTable: 'SharedCode',
        toColumn: 'SharedCode',
        isActive: true,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      },
    ],
  };
}

function blockedNewSharedDimensionSnapshot() {
  return {
    modelPath: '(live)',
    tables: [
      {
        name: 'FactLeft',
        columns: [
          {
            table: 'FactLeft',
            name: 'SharedCode',
            dataType: 'string',
            isHidden: false,
            isKey: false,
            isCalculated: false,
          },
          {
            table: 'FactLeft',
            name: 'BridgeKey',
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
      {
        name: 'FactRight',
        columns: [
          {
            table: 'FactRight',
            name: 'SharedCode',
            dataType: 'string',
            isHidden: false,
            isKey: false,
            isCalculated: false,
          },
          {
            table: 'FactRight',
            name: 'BridgeKey',
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
      {
        name: 'Bridge',
        columns: [
          {
            table: 'Bridge',
            name: 'BridgeKey',
            dataType: 'string',
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
    relationships: [
      {
        id: 'fact-left-bridge',
        fromTable: 'FactLeft',
        fromColumn: 'BridgeKey',
        toTable: 'Bridge',
        toColumn: 'BridgeKey',
        isActive: true,
        crossFilteringBehavior: 'both',
        cardinality: 'manyToOne',
      },
      {
        id: 'fact-right-bridge',
        fromTable: 'FactRight',
        fromColumn: 'BridgeKey',
        toTable: 'Bridge',
        toColumn: 'BridgeKey',
        isActive: true,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      },
    ],
  };
}

function connectedFolderSnapshotWithAmount() {
  return {
    modelPath: '(connected-folder)',
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
    ],
    relationships: [],
  };
}

describe('star-schema join planner tool', () => {
  it('is registered as a deterministic read-only planning tool', async () => {
    const tools = await withClient(
      async (client) => (await client.listTools()).tools as ToolInfo[],
    );
    const found = tools.find((tool) => tool.name === 'pbi_model_plan_star_schema_join');

    expect(found, 'planner tool should be registered').toBeDefined();
    const desc = found?.description?.toLowerCase() ?? '';
    expect(desc).toContain('deterministic');
    expect(desc).toContain('star-schema');
    expect(desc).toContain('does not write');
    expect(found?.annotations?.readOnlyHint).toBe(true);
    expect(found?.annotations?.destructiveHint).toBe(false);

    const props = found?.inputSchema?.properties ?? {};
    expect(props.leftTable).toBeDefined();
    expect(props.rightTable).toBeDefined();
    expect(props.axes).toBeDefined();
    expect(props.folderPath).toBeDefined();
    expect(props.model).toBeDefined();
  });

  it('returns the structured deterministic plan for two fact-like tables with a shared column', async () => {
    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_star_schema_join',
        arguments: {
          folderPath: twoFactSharedColumnModel(),
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.mode).toBe('folder');
    const plan = payload.plan as Record<string, unknown> | undefined;

    expect(plan?.directFactRelationshipAllowed).toBe(false);
    expect(plan?.design).toBeDefined();
    expect(Array.isArray(plan?.blockers)).toBe(true);
    expect(Array.isArray(plan?.proposedDimensions)).toBe(true);
    expect(Array.isArray(plan?.relationshipWrites)).toBe(true);
    expect(Array.isArray(plan?.hideFkWrites)).toBe(true);
    expect(Array.isArray(plan?.keyColumnWrites)).toBe(true);
    expect((plan?.proposedDimensions as unknown[] | undefined)?.length).toBeGreaterThan(0);

    expect(plan?.proposedDimensions).toEqual([
      {
        name: 'SharedCode',
        axis: 'SharedCode',
        source: 'new-calculated-table',
        sourceTables: ['FactLeft', 'FactRight'],
        createTableWrite: {
          name: 'SharedCode',
          expression: [
            'DISTINCT(',
            '  UNION(',
            "    SELECTCOLUMNS('FactLeft', \"SharedCode\", 'FactLeft'[SharedCode]),",
            "    SELECTCOLUMNS('FactRight', \"SharedCode\", 'FactRight'[SharedCode])",
            '  )',
            ')',
          ].join('\n'),
        },
      },
    ]);
    expect(plan?.keyColumnWrites).toEqual([
      {
        tableName: 'SharedCode',
        name: 'SharedCode',
        summarizeBy: 'none',
        isKey: true,
      },
    ]);
    expect(plan?.relationshipWrites).toEqual([
      {
        fromTable: 'FactLeft',
        fromColumn: 'SharedCode',
        toTable: 'SharedCode',
        toColumn: 'SharedCode',
        cardinality: 'manyToOne',
        crossFilteringBehavior: 'single',
        isActive: true,
      },
      {
        fromTable: 'FactRight',
        fromColumn: 'SharedCode',
        toTable: 'SharedCode',
        toColumn: 'SharedCode',
        cardinality: 'manyToOne',
        crossFilteringBehavior: 'single',
        isActive: true,
      },
    ]);
    expect(plan?.hideFkWrites).toEqual([
      { tableName: 'FactLeft', name: 'SharedCode', isHidden: true },
      { tableName: 'FactRight', name: 'SharedCode', isHidden: true },
    ]);
  });

  it('surfaces governed Date requirements in general star-schema plans when shared temporal axes exist', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveTwoTableSnapshotWithSharedDate();
      },
      async createTable() {
        throw new Error('read-only plan must not create tables');
      },
      async createRelationship() {
        throw new Error('read-only plan must not create relationships');
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    const plan = payload.plan as Record<string, unknown> | undefined;
    expect(result.isError).not.toBe(true);
    expect(payload.mode).toBe('live');
    expect(plan?.relationshipWrites).toHaveLength(2);
    expect(plan?.dateAxisRequirement).toEqual({
      status: 'governed-date-table-required',
      reason:
        'Cross-fact modeling with temporal axes requires one governed Date table shared by every participating fact. Auto LocalDateTable relationships are per-column implementation details and do not provide a conformed report axis.',
      suggestedTool: 'pbi_date_table_create_governed',
      suggestedPlanTools: ['pbi_model_plan_date_table', 'pbi_model_plan_date_grain'],
      temporalAxes: ['TxnDate'],
      dateRefs: [
        { tableName: 'FactLeft', dateColumn: 'TxnDate' },
        { tableName: 'FactRight', dateColumn: 'TxnDate' },
      ],
    });
  });

  it('requires a governed shared Date axis for actuals-vs-targets joins even when local auto-date proof succeeds', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    let daxCalls = 0;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveTwoTableSnapshotWithSharedDate();
      },
      async daxQuery(query: string) {
        daxCalls += 1;
        expect(query).toContain('FactLeft');
        expect(query).toContain('FactRight');
        expect(query).toContain('TxnDate');
        return {
          results: [
            {
              tables: [
                {
                  rows: [
                    {
                      '[__table]': 'FactLeft',
                      '[__column]': 'TxnDate',
                      '[rowCount]': 20,
                      '[nonBlankDateCount]': 20,
                      '[distinctDateCount]': 10,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 9,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 10,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 10,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-10T00:00:00',
                    },
                    {
                      '[__table]': 'FactRight',
                      '[__column]': 'TxnDate',
                      '[rowCount]': 12,
                      '[nonBlankDateCount]': 12,
                      '[distinctDateCount]': 6,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 5,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 6,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 6,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-06T00:00:00',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
      async createTable() {
        throw new Error('read-only plan must not create tables');
      },
      async createRelationship() {
        throw new Error('read-only plan must not create relationships');
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_actuals_targets_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload.mode).toBe('live');
    expect(payload.status).toBe('needs-user-input');
    expect(payload.starSchemaPlan).toMatchObject({
      design: 'star-schema-shared-dimension',
      leftTable: 'FactLeft',
      rightTable: 'FactRight',
    });
    expect(payload.dateGrainPlan).toMatchObject({
      probeStatus: expect.objectContaining({ status: 'succeeded' }),
      facts: expect.arrayContaining([
        expect.objectContaining({
          tableName: 'FactLeft',
          dateColumn: 'TxnDate',
          observedGrain: 'day',
        }),
        expect.objectContaining({
          tableName: 'FactRight',
          dateColumn: 'TxnDate',
          observedGrain: 'day',
        }),
      ]),
    });
    expect(payload.dateAxisRequirement).toMatchObject({
      status: 'governed-date-table-required',
      reason:
        'Cross-fact modeling with temporal axes requires one governed Date table shared by every participating fact. Auto LocalDateTable relationships are per-column implementation details and do not provide a conformed report axis.',
      suggestedTool: 'pbi_date_table_create_governed',
      suggestedPlanTools: ['pbi_model_plan_date_table', 'pbi_model_plan_date_grain'],
      temporalAxes: ['TxnDate'],
      dateRefs: [
        { tableName: 'FactLeft', dateColumn: 'TxnDate' },
        { tableName: 'FactRight', dateColumn: 'TxnDate' },
      ],
    });
    expect(payload.requiredInputs).toEqual([
      expect.objectContaining({
        topic: 'governed-date-table',
      }),
    ]);
    expect(payload.remainingBusinessQuestions).toEqual([
      expect.objectContaining({ topic: 'allocation-or-missing-target-behavior' }),
    ]);
    expect(daxCalls).toBe(1);
  });

  it('auto-detects an existing governed shared Date axis for actuals-vs-targets readiness', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    let daxCalls = 0;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveTwoTableSnapshotWithGovernedDate();
      },
      async daxQuery(query: string) {
        daxCalls += 1;
        expect(query).toContain("'Date'");
        expect(query).toContain('FactLeft');
        expect(query).toContain('FactRight');
        return {
          results: [
            {
              tables: [
                {
                  rows: [
                    {
                      '[__kind]': 'date-table',
                      '[__table]': 'Date',
                      '[__column]': 'Date',
                      '[rowCount]': 10,
                      '[nonBlankDateCount]': 10,
                      '[distinctDateCount]': 10,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 9,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 10,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-10T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'FactLeft',
                      '[__column]': 'TxnDate',
                      '[rowCount]': 20,
                      '[nonBlankDateCount]': 20,
                      '[distinctDateCount]': 10,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 9,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 10,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 10,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-10T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'FactRight',
                      '[__column]': 'TxnDate',
                      '[rowCount]': 12,
                      '[nonBlankDateCount]': 12,
                      '[distinctDateCount]': 6,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 5,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 6,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 6,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-06T00:00:00',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_actuals_targets_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload.status).toBe('ready');
    expect(payload.requiredInputs).toBeUndefined();
    expect(payload.dateAxisRequirement).toMatchObject({
      status: 'governed-date-table-present',
      dateTable: 'Date',
      dateColumn: 'Date',
      source: 'existing-governed-relationships',
      temporalAxes: ['TxnDate'],
      dateRefs: [
        { tableName: 'FactLeft', dateColumn: 'TxnDate' },
        { tableName: 'FactRight', dateColumn: 'TxnDate' },
      ],
    });
    expect(payload.dateGrainPlan).toMatchObject({
      probeStatus: expect.objectContaining({ status: 'succeeded' }),
      dateTableCoverage: expect.objectContaining({ status: 'valid' }),
    });
    expect(daxCalls).toBe(1);
  });

  it('blocks actuals-vs-targets readiness when governed Date coverage is not valid', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveTwoTableSnapshotWithGovernedDate({ withSource: false });
      },
      async daxQuery() {
        return {
          results: [
            {
              tables: [
                {
                  rows: [
                    {
                      '[__kind]': 'date-table',
                      '[__table]': 'Date',
                      '[__column]': 'Date',
                      '[rowCount]': 10,
                      '[nonBlankDateCount]': 10,
                      '[distinctDateCount]': 10,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-10T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'FactLeft',
                      '[__column]': 'TxnDate',
                      '[rowCount]': 20,
                      '[nonBlankDateCount]': 20,
                      '[distinctDateCount]': 10,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 9,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 10,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 10,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-10T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'FactRight',
                      '[__column]': 'TxnDate',
                      '[rowCount]': 12,
                      '[nonBlankDateCount]': 12,
                      '[distinctDateCount]': 6,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 5,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 6,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 6,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-06T00:00:00',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_actuals_targets_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.status).toBe('blocked');
    expect(payload.blockers).toEqual([
      expect.objectContaining({
        source: 'date-table',
        code: 'calendar-source-proof-missing',
      }),
    ]);
  });

  it('does not expose executable normalized writes for a blocked axis', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return blockedSharedDimensionSnapshot();
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.mode).toBe('live');
    const plan = payload.plan as Record<string, unknown>;
    expect(plan.blockers).toEqual([
      expect.objectContaining({
        code: 'relationship-write-blocked',
        action: 'create-relationship',
      }),
    ]);
    expect(plan.relationshipWrites).toEqual([]);
    expect(plan.relationshipRepairWrites).toEqual([]);
    expect(plan.hideFkWrites).toEqual([]);
    expect(plan.keyColumnWrites).toEqual([]);
    expect(plan.plans).toEqual([
      expect.not.objectContaining({
        daxExpression: expect.any(String),
      }),
    ]);
    expect(plan.proposedDimensions).toEqual([]);
  });

  it('does not expose normalized writes for temporal shared axes', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
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
                  name: 'SharedDate',
                  dataType: 'dateTime',
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
              name: 'FactRight',
              columns: [
                {
                  table: 'FactRight',
                  name: 'SharedDate',
                  dataType: 'dateTime',
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
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedDate'],
        },
      }),
    );

    const payload = jsonPayload(result);
    const plan = payload.plan as Record<string, unknown>;
    expect(plan.relationshipWrites).toEqual([]);
    expect(plan.relationshipRepairWrites).toEqual([]);
    expect(plan.hideFkWrites).toEqual([]);
    expect(plan.keyColumnWrites).toEqual([]);
    expect(plan.proposedDimensions).toEqual([]);
    expect(plan.blockers).toEqual([
      expect.objectContaining({
        code: 'axis-unusable-on-left',
        axis: 'SharedDate',
        reason: 'temporal-axis',
      }),
      expect.objectContaining({
        code: 'no-usable-shared-axes',
      }),
    ]);
  });

  it('does not expose createTableWrite for a blocked calculated-dimension axis', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return blockedNewSharedDimensionSnapshot();
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    const plan = payload.plan as Record<string, unknown>;
    expect(plan.blockers).toEqual([
      expect.objectContaining({
        code: 'relationship-write-blocked',
        action: 'create-relationship',
      }),
    ]);
    expect(plan.relationshipWrites).toEqual([]);
    expect(plan.relationshipRepairWrites).toEqual([]);
    expect(plan.hideFkWrites).toEqual([]);
    expect(plan.keyColumnWrites).toEqual([]);
    expect(plan.proposedDimensions).toEqual([]);
  });

  it('uses a live model before resolving a stale folderPath', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    let ensureOpts: unknown;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection(opts: unknown) {
        ensureOpts = opts;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveTwoTableSnapshot();
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_star_schema_join',
        arguments: {
          folderPath: '/definitely/missing/Stale.SemanticModel/definition',
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toBeUndefined();
    expect(payload.mode).toBe('live');
    expect(ensureOpts).toEqual({
      folderPath: '/definitely/missing/Stale.SemanticModel/definition',
      model: undefined,
      livePreferred: true,
    });
  });

  it('uses an env-pinned live model before probing or resolving a stale folderPath', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    process.env.PBI_MODELING_MCP_CONNECTION_STRING = 'Data Source=localhost:61234;';
    let ensureOpts: unknown;
    let liveProbeCalls = 0;
    setModelDriverForTests({
      async listLiveInstances() {
        liveProbeCalls += 1;
        throw new Error('ListLocalInstances should not run for env-pinned live connections');
      },
      async ensureConnection(opts: unknown) {
        ensureOpts = opts;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveTwoTableSnapshot();
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_star_schema_join',
        arguments: {
          folderPath: '/definitely/missing/Stale.SemanticModel/definition',
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toBeUndefined();
    expect(payload.mode).toBe('live');
    expect(liveProbeCalls).toBe(0);
    expect(ensureOpts).toEqual({
      folderPath: '/definitely/missing/Stale.SemanticModel/definition',
      model: undefined,
      livePreferred: true,
    });
  });

  it('uses env-pinned live even when live probing is disabled', async () => {
    process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
    process.env.PBI_MODELING_MCP_CONNECTION_STRING = 'Data Source=localhost:61234;';
    let ensureOpts: unknown;
    let liveProbeCalls = 0;
    setModelDriverForTests({
      async listLiveInstances() {
        liveProbeCalls += 1;
        throw new Error('ListLocalInstances should not run for env-pinned live connections');
      },
      async ensureConnection(opts: unknown) {
        ensureOpts = opts;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveTwoTableSnapshot();
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_check',
        arguments: {
          modelPath: '/definitely/missing/Stale.SemanticModel/definition',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toBeUndefined();
    expect(payload.modelPath).toBe('(live)');
    expect(liveProbeCalls).toBe(0);
    expect(ensureOpts).toEqual({
      folderPath: '/definitely/missing/Stale.SemanticModel/definition',
      model: undefined,
      livePreferred: true,
    });
  });

  it('routes write tools to live before resolving a stale folderPath', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const ensureCalls: unknown[] = [];
    let createdMeasure: unknown;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection(opts: unknown) {
        ensureCalls.push(opts);
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveTwoTableSnapshot();
      },
      async createMeasure(definition: unknown) {
        createdMeasure = definition;
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_measure_create',
        arguments: {
          folderPath: '/definitely/missing/Stale.SemanticModel/definition',
          tableName: 'FactLeft',
          name: 'Constant Measure',
          expression: '1',
          measureIntent: confirmedMeasureIntent('Constant Measure', {
            table: 'FactLeft',
            column: 'SharedCode',
          }),
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toBeUndefined();
    expect(payload.mode).toBe('live');
    expect(ensureCalls).toEqual([
      {
        folderPath: '/definitely/missing/Stale.SemanticModel/definition',
        model: undefined,
        livePreferred: true,
      },
    ]);
    expect(createdMeasure).toMatchObject({
      tableName: 'FactLeft',
      name: 'Constant Measure',
      expression: '1',
    });
  });

  it('does not re-discover live between a folder write gate and the mutation', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live probing before folder fallback
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const folderPath = twoFactSharedColumnModel();
    const ensureCalls: unknown[] = [];
    let liveProbeCalls = 0;
    let createdMeasure: unknown;
    setModelDriverForTests({
      async listLiveInstances() {
        liveProbeCalls += 1;
        return liveProbeCalls === 1
          ? []
          : [{ connectionString: 'Data Source=localhost:61234;', databaseName: 'OtherModel' }];
      },
      async ensureConnection(opts: unknown) {
        ensureCalls.push(opts);
        return { mode: 'folder', folderPath };
      },
      async getCachedSnapshot() {
        throw new Error('folder write gate should parse TMDL directly');
      },
      async createMeasure(definition: unknown) {
        createdMeasure = definition;
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_measure_create',
        arguments: {
          folderPath,
          tableName: 'FactLeft',
          name: 'Amount Total',
          expression: 'SUM(FactLeft[Amount])',
          measureIntent: confirmedMeasureIntent('Amount Total', {
            table: 'FactLeft',
            column: 'Amount',
          }),
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toBeUndefined();
    expect(payload.mode).toBe('folder');
    expect(liveProbeCalls).toBe(1);
    expect(ensureCalls).toEqual([{ folderPath, model: undefined, forceFolder: true }]);
    expect(createdMeasure).toMatchObject({
      tableName: 'FactLeft',
      name: 'Amount Total',
      expression: 'SUM(FactLeft[Amount])',
    });
  });

  it('gates folder-mode writes against the resolved TMDL folder, not a stale driver snapshot', async () => {
    const folderPath = singleFactMissingAmountModel();
    let createdMeasure: unknown;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'folder', folderPath };
      },
      async getCachedSnapshot() {
        return connectedFolderSnapshotWithAmount();
      },
      async createMeasure(definition: unknown) {
        createdMeasure = definition;
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_measure_create',
        arguments: {
          folderPath,
          tableName: 'FactLeft',
          name: 'Amount Total',
          expression: 'SUM(FactLeft[Amount])',
          measureIntent: confirmedMeasureIntent('Amount Total', {
            table: 'FactLeft',
            column: 'SharedCode',
          }),
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toMatch(/references fields not present/);
    expect(createdMeasure).toBeUndefined();
  });

  it('routes model checks to live before resolving a stale modelPath', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    let ensureOpts: unknown;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection(opts: unknown) {
        ensureOpts = opts;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveTwoTableSnapshot();
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_check',
        arguments: {
          modelPath: '/definitely/missing/Stale.SemanticModel/definition',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toBeUndefined();
    expect(payload.modelPath).toBe('(live)');
    expect(ensureOpts).toEqual({
      folderPath: '/definitely/missing/Stale.SemanticModel/definition',
      model: undefined,
      livePreferred: true,
    });
  });

  it('batch-applies a planner-backed shared dimension, relationships, key metadata, and FK hiding', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const snapshot = structuredClone(liveTwoTableSnapshot()) as MutableModel;
    const operationLog: string[] = [];
    const createTableDefinitions: unknown[] = [];
    const updateColumnDefinitions: unknown[] = [];
    const createRelationshipDefinitions: unknown[] = [];

    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot;
      },
      async createTable(definition: unknown) {
        createTableDefinitions.push(definition);
        const def = definition as { name: string };
        operationLog.push(`create-table:${def.name}`);
        snapshot.tables.push({
          name: def.name,
          columns: [
            {
              table: def.name,
              name: def.name,
              dataType: 'unknown',
              summarizeBy: 'sum',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
          ],
          measures: [],
          isHidden: false,
          isCalculated: true,
          isAutoDateTable: false,
        });
        return { ok: true };
      },
      async refreshModel(refreshType: unknown) {
        operationLog.push(`refresh:${String(refreshType)}`);
        return { ok: true };
      },
      async updateColumn(definition: unknown) {
        updateColumnDefinitions.push(definition);
        const def = definition as {
          tableName: string;
          name: string;
          dataType?: string;
          summarizeBy?: string;
          isHidden?: boolean;
          isKey?: boolean;
        };
        operationLog.push(`update-column:${def.tableName}.${def.name}`);
        const table = snapshot.tables.find((candidate) => candidate.name === def.tableName);
        const column = table?.columns.find((candidate) => candidate.name === def.name);
        if (!column) throw new Error(`missing test column ${def.tableName}.${def.name}`);
        if (def.dataType !== undefined) column.dataType = def.dataType;
        if (def.summarizeBy !== undefined) column.summarizeBy = def.summarizeBy;
        if (def.isHidden !== undefined) column.isHidden = def.isHidden;
        if (def.isKey !== undefined) column.isKey = def.isKey;
        return { ok: true };
      },
      async createRelationship(definition: unknown) {
        createRelationshipDefinitions.push(definition);
        const def = definition as {
          fromTable: string;
          fromColumn: string;
          toTable: string;
          toColumn: string;
          cardinality?: string;
          crossFilteringBehavior?: string;
          isActive?: boolean;
        };
        operationLog.push(`create-relationship:${def.fromTable}.${def.fromColumn}`);
        snapshot.relationships.push({
          id: `${def.fromTable}_${def.fromColumn}_${def.toTable}_${def.toColumn}`,
          fromTable: def.fromTable,
          fromColumn: def.fromColumn,
          toTable: def.toTable,
          toColumn: def.toColumn,
          isActive: true,
          crossFilteringBehavior: def.crossFilteringBehavior === 'both' ? 'both' : 'single',
          cardinality: 'manyToOne',
        });
        return { ok: true };
      },
      async updateRelationship() {
        throw new Error('no relationship repair should be needed in this fixture');
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toBeUndefined();
    expect(payload.applied).toBe(true);
    expect(payload.mode).toBe('live');
    expect(operationLog).toEqual([
      'create-table:SharedCode',
      'refresh:Calculate',
      'update-column:SharedCode.SharedCode',
      'create-relationship:FactLeft.SharedCode',
      'create-relationship:FactRight.SharedCode',
      'update-column:FactLeft.SharedCode',
      'update-column:FactRight.SharedCode',
    ]);
    expect(createTableDefinitions).toEqual([
      {
        name: 'SharedCode',
        expression: [
          'DISTINCT(',
          '  UNION(',
          "    SELECTCOLUMNS('FactLeft', \"SharedCode\", 'FactLeft'[SharedCode]),",
          "    SELECTCOLUMNS('FactRight', \"SharedCode\", 'FactRight'[SharedCode])",
          '  )',
          ')',
        ].join('\n'),
      },
    ]);
    expect(createRelationshipDefinitions).toEqual([
      {
        fromTable: 'FactLeft',
        fromColumn: 'SharedCode',
        toTable: 'SharedCode',
        toColumn: 'SharedCode',
        cardinality: 'manyToOne',
        crossFilteringBehavior: 'single',
        isActive: true,
      },
      {
        fromTable: 'FactRight',
        fromColumn: 'SharedCode',
        toTable: 'SharedCode',
        toColumn: 'SharedCode',
        cardinality: 'manyToOne',
        crossFilteringBehavior: 'single',
        isActive: true,
      },
    ]);
    const dimensionColumn = snapshot.tables
      .find((table) => table.name === 'SharedCode')
      ?.columns.find((column) => column.name === 'SharedCode');
    expect(dimensionColumn).toMatchObject({
      dataType: 'String',
      summarizeBy: 'none',
      isKey: true,
    });
    expect(updateColumnDefinitions[0]).toMatchObject({
      tableName: 'SharedCode',
      name: 'SharedCode',
      dataType: 'String',
      summarizeBy: 'none',
      isKey: true,
    });
    expect(snapshot.tables.find((table) => table.name === 'FactLeft')?.columns[0]?.isHidden).toBe(
      true,
    );
    expect(snapshot.tables.find((table) => table.name === 'FactRight')?.columns[0]?.isHidden).toBe(
      true,
    );
    expect(snapshot.relationships).toHaveLength(2);
  });

  it('dry-runs star-schema apply without writing', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const writeCalls: string[] = [];

    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveTwoTableSnapshot();
      },
      async createTable() {
        writeCalls.push('create-table');
        return { ok: true };
      },
      async refreshModel() {
        writeCalls.push('refresh');
        return { ok: true };
      },
      async updateColumn() {
        writeCalls.push('update-column');
        return { ok: true };
      },
      async createRelationship() {
        writeCalls.push('create-relationship');
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
          dryRun: true,
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload).toMatchObject({
      applied: false,
      dryRun: true,
      mode: 'live',
    });
    expect((payload.plan as Record<string, unknown> | undefined)?.relationshipWrites).toHaveLength(
      2,
    );
    expect(payload.plannedOperations).toEqual([
      expect.objectContaining({ action: 'create-calculated-table', tableName: 'SharedCode' }),
      expect.objectContaining({ action: 'refresh-model', refreshType: 'Calculate' }),
      expect.objectContaining({
        action: 'configure-dimension-key',
        tableName: 'SharedCode',
        columnName: 'SharedCode',
        dataType: 'String',
      }),
      expect.objectContaining({ action: 'create-relationship' }),
      expect.objectContaining({ action: 'create-relationship' }),
      expect.objectContaining({ action: 'hide-source-column' }),
      expect.objectContaining({ action: 'hide-source-column' }),
    ]);
    expect(writeCalls).toEqual([]);
  });

  it('carries unresolved Date-axis requirements through star-schema apply dry-runs', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const writeCalls: string[] = [];

    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveTwoTableSnapshotWithSharedDate();
      },
      async createTable() {
        writeCalls.push('create-table');
        return { ok: true };
      },
      async refreshModel() {
        writeCalls.push('refresh');
        return { ok: true };
      },
      async updateColumn() {
        writeCalls.push('update-column');
        return { ok: true };
      },
      async createRelationship() {
        writeCalls.push('create-relationship');
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
          dryRun: true,
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload).toMatchObject({
      applied: false,
      dryRun: true,
      mode: 'live',
      completionStatus: 'shared-dimensions-planned-date-axis-incomplete',
      dateAxisRequirement: {
        status: 'governed-date-table-required',
        suggestedTool: 'pbi_date_table_create_governed',
        temporalAxes: ['TxnDate'],
        dateRefs: [
          { tableName: 'FactLeft', dateColumn: 'TxnDate' },
          { tableName: 'FactRight', dateColumn: 'TxnDate' },
        ],
      },
    });
    expect(writeCalls).toEqual([]);
  });

  it('reports categorical apply success as date-axis incomplete when shared temporal axes remain ungoverned', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const snapshot = structuredClone(liveTwoTableSnapshotWithSharedDate()) as MutableModel;
    const operationLog: string[] = [];

    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot;
      },
      async createTable(definition: unknown) {
        const def = definition as { name: string };
        operationLog.push(`create-table:${def.name}`);
        snapshot.tables.push({
          name: def.name,
          columns: [
            {
              table: def.name,
              name: def.name,
              dataType: 'unknown',
              summarizeBy: 'sum',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
          ],
          measures: [],
          isHidden: false,
          isCalculated: true,
          isAutoDateTable: false,
        });
        return { ok: true };
      },
      async refreshModel(refreshType: unknown) {
        operationLog.push(`refresh:${String(refreshType)}`);
        return { ok: true };
      },
      async updateColumn(definition: unknown) {
        const def = definition as {
          tableName: string;
          name: string;
          dataType?: string;
          summarizeBy?: string;
          isHidden?: boolean;
          isKey?: boolean;
        };
        operationLog.push(`update-column:${def.tableName}.${def.name}`);
        const table = snapshot.tables.find((candidate) => candidate.name === def.tableName);
        const column = table?.columns.find((candidate) => candidate.name === def.name);
        if (!column) throw new Error(`missing test column ${def.tableName}.${def.name}`);
        if (def.dataType !== undefined) column.dataType = def.dataType;
        if (def.summarizeBy !== undefined) column.summarizeBy = def.summarizeBy;
        if (def.isHidden !== undefined) column.isHidden = def.isHidden;
        if (def.isKey !== undefined) column.isKey = def.isKey;
        return { ok: true };
      },
      async createRelationship(definition: unknown) {
        const def = definition as {
          fromTable: string;
          fromColumn: string;
          toTable: string;
          toColumn: string;
          cardinality?: string;
          crossFilteringBehavior?: string;
        };
        operationLog.push(`create-relationship:${def.fromTable}.${def.fromColumn}`);
        snapshot.relationships.push({
          id: `${def.fromTable}_${def.fromColumn}_${def.toTable}_${def.toColumn}`,
          fromTable: def.fromTable,
          fromColumn: def.fromColumn,
          toTable: def.toTable,
          toColumn: def.toColumn,
          isActive: true,
          crossFilteringBehavior: def.crossFilteringBehavior === 'both' ? 'both' : 'single',
          cardinality: 'manyToOne',
        });
        return { ok: true };
      },
      async updateRelationship() {
        throw new Error('no relationship repair should be needed in this fixture');
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload.applied).toBe(true);
    expect(payload.completionStatus).toBe('shared-dimensions-applied-date-axis-incomplete');
    expect(payload.dateAxisRequirement).toMatchObject({
      status: 'governed-date-table-required',
      suggestedTool: 'pbi_date_table_create_governed',
      temporalAxes: ['TxnDate'],
      dateRefs: [
        { tableName: 'FactLeft', dateColumn: 'TxnDate' },
        { tableName: 'FactRight', dateColumn: 'TxnDate' },
      ],
    });
    expect(operationLog).toContain('create-table:SharedCode');
    expect(operationLog).toContain('create-relationship:FactLeft.SharedCode');
    expect(operationLog).toContain('create-relationship:FactRight.SharedCode');
  });

  it('batch-applies planner-backed relationship repairs by proven relationship id', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const snapshot: MutableModel = {
      modelPath: '(live)',
      tables: [
        {
          name: 'FactLeft',
          columns: [
            {
              table: 'FactLeft',
              name: 'SharedCode',
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
        {
          name: 'FactRight',
          columns: [
            {
              table: 'FactRight',
              name: 'SharedCode',
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
        {
          name: 'SharedCode',
          columns: [
            {
              table: 'SharedCode',
              name: 'SharedCode',
              dataType: 'string',
              summarizeBy: 'sum',
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
      relationships: [
        {
          id: 'inactive-left-shared',
          identityProven: true,
          fromTable: 'FactLeft',
          fromColumn: 'SharedCode',
          toTable: 'SharedCode',
          toColumn: 'SharedCode',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    };
    const updateRelationshipDefinitions: unknown[] = [];
    const createRelationshipDefinitions: unknown[] = [];

    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot;
      },
      async updateColumn(definition: unknown) {
        const def = definition as {
          tableName: string;
          name: string;
          dataType?: string;
          summarizeBy?: string;
          isHidden?: boolean;
          isKey?: boolean;
        };
        const table = snapshot.tables.find((candidate) => candidate.name === def.tableName);
        const column = table?.columns.find((candidate) => candidate.name === def.name);
        if (!column) throw new Error(`missing test column ${def.tableName}.${def.name}`);
        if (def.dataType !== undefined) column.dataType = def.dataType;
        if (def.summarizeBy !== undefined) column.summarizeBy = def.summarizeBy;
        if (def.isHidden !== undefined) column.isHidden = def.isHidden;
        if (def.isKey !== undefined) column.isKey = def.isKey;
        return { ok: true };
      },
      async updateRelationship(definition: unknown) {
        updateRelationshipDefinitions.push(definition);
        const def = definition as {
          id: string;
          cardinality?: 'manyToOne';
          crossFilteringBehavior?: 'single' | 'both';
          isActive?: boolean;
        };
        const relationship = snapshot.relationships.find((candidate) => candidate.id === def.id);
        if (!relationship) throw new Error(`missing test relationship ${def.id}`);
        if (def.isActive !== undefined) relationship.isActive = def.isActive;
        if (def.crossFilteringBehavior !== undefined) {
          relationship.crossFilteringBehavior = def.crossFilteringBehavior;
        }
        if (def.cardinality !== undefined) relationship.cardinality = def.cardinality;
        return { ok: true };
      },
      async createRelationship(definition: unknown) {
        createRelationshipDefinitions.push(definition);
        const def = definition as {
          fromTable: string;
          fromColumn: string;
          toTable: string;
          toColumn: string;
          cardinality?: 'manyToOne';
          crossFilteringBehavior?: 'single' | 'both';
          isActive?: boolean;
        };
        snapshot.relationships.push({
          id: `${def.fromTable}_${def.fromColumn}_${def.toTable}_${def.toColumn}`,
          identityProven: true,
          fromTable: def.fromTable,
          fromColumn: def.fromColumn,
          toTable: def.toTable,
          toColumn: def.toColumn,
          isActive: def.isActive !== false,
          crossFilteringBehavior: def.crossFilteringBehavior ?? 'single',
          cardinality: def.cardinality ?? 'manyToOne',
        });
        return { ok: true };
      },
      async createTable() {
        throw new Error('existing shared dimension should be reused');
      },
      async refreshModel() {
        throw new Error('no calculated table refresh should be needed');
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toBeUndefined();
    expect(payload.applied).toBe(true);
    expect(updateRelationshipDefinitions).toEqual([
      {
        id: 'inactive-left-shared',
        fromTable: 'FactLeft',
        fromColumn: 'SharedCode',
        toTable: 'SharedCode',
        toColumn: 'SharedCode',
        cardinality: 'manyToOne',
        crossFilteringBehavior: 'single',
        isActive: true,
      },
    ]);
    expect(createRelationshipDefinitions).toEqual([
      {
        fromTable: 'FactRight',
        fromColumn: 'SharedCode',
        toTable: 'SharedCode',
        toColumn: 'SharedCode',
        cardinality: 'manyToOne',
        crossFilteringBehavior: 'single',
        isActive: true,
      },
    ]);
    expect(snapshot.relationships).toEqual([
      expect.objectContaining({
        id: 'inactive-left-shared',
        isActive: true,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      }),
      expect.objectContaining({
        fromTable: 'FactRight',
        fromColumn: 'SharedCode',
        toTable: 'SharedCode',
        toColumn: 'SharedCode',
        isActive: true,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      }),
    ]);
  });

  it('refuses relationship repair when the current relationship id no longer matches the planned endpoints', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const snapshot: MutableModel = {
      modelPath: '(live)',
      tables: [
        {
          name: 'FactLeft',
          columns: [
            {
              table: 'FactLeft',
              name: 'SharedCode',
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
        {
          name: 'FactRight',
          columns: [
            {
              table: 'FactRight',
              name: 'SharedCode',
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
        {
          name: 'SharedCode',
          columns: [
            {
              table: 'SharedCode',
              name: 'SharedCode',
              dataType: 'string',
              summarizeBy: 'none',
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
      relationships: [
        {
          id: 'stale-repair-id',
          identityProven: true,
          fromTable: 'FactLeft',
          fromColumn: 'SharedCode',
          toTable: 'SharedCode',
          toColumn: 'SharedCode',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    };
    let snapshotReads = 0;
    let updateColumnCalls = 0;
    let updateRelationshipCalls = 0;

    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        snapshotReads += 1;
        if (snapshotReads === 2) {
          const rel = snapshot.relationships[0];
          if (rel) {
            rel.fromTable = 'FactRight';
            rel.fromColumn = 'SharedCode';
          }
        }
        return snapshot;
      },
      async updateColumn() {
        updateColumnCalls += 1;
        return { ok: true };
      },
      async updateRelationship() {
        updateRelationshipCalls += 1;
        return { ok: true };
      },
      async createRelationship() {
        return { ok: true };
      },
      async createTable() {
        throw new Error('existing shared dimension should be reused');
      },
      async refreshModel() {
        throw new Error('no calculated table refresh should be needed');
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toMatch(/relationship repair target changed/i);
    expect(payload.reason).toBe('relationship-repair-target-changed');
    expect(updateColumnCalls).toBe(0);
    expect(updateRelationshipCalls).toBe(0);
  });

  it('refuses the batched apply path when the deterministic planner has blockers', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    let createCalls = 0;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return blockedNewSharedDimensionSnapshot();
      },
      async createTable() {
        createCalls += 1;
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toMatch(/planner returned blockers/i);
    expect(payload.gate).toBe('star-schema-apply');
    expect(createCalls).toBe(0);
  });

  it('refuses stale relationship create gates before creating a calculated dimension', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const snapshot = structuredClone(liveTwoTableSnapshot()) as MutableModel;
    let snapshotReads = 0;
    let createTableCalls = 0;
    let refreshCalls = 0;
    let updateColumnCalls = 0;
    let createRelationshipCalls = 0;

    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        snapshotReads += 1;
        if (
          snapshotReads === 2 &&
          !snapshot.relationships.some((relationship) => relationship.id === 'stale-conflict')
        ) {
          snapshot.relationships.push({
            id: 'stale-conflict',
            identityProven: true,
            fromTable: 'FactLeft',
            fromColumn: 'SharedCode',
            toTable: 'SharedCode',
            toColumn: 'SharedCode',
            isActive: true,
            crossFilteringBehavior: 'single',
            cardinality: 'manyToOne',
          });
        }
        return snapshot;
      },
      async createTable() {
        createTableCalls += 1;
        return { ok: true };
      },
      async updateColumn() {
        updateColumnCalls += 1;
        return { ok: true };
      },
      async createRelationship() {
        createRelationshipCalls += 1;
        return { ok: true };
      },
      async refreshModel() {
        refreshCalls += 1;
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toMatch(/relationship create gate failed/i);
    expect(payload.reason).toBe('relationship-create-gate-failed');
    expect(createTableCalls).toBe(0);
    expect(refreshCalls).toBe(0);
    expect(updateColumnCalls).toBe(0);
    expect(createRelationshipCalls).toBe(0);
  });

  it('refuses star-schema apply with blank axes before writing', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    let createCalls = 0;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveTwoTableSnapshot();
      },
      async createTable() {
        createCalls += 1;
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: [' '],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toMatch(/explicit non-empty axes/i);
    expect(payload.reason).toBe('missing-explicit-axes');
    expect(createCalls).toBe(0);
  });

  it('refuses star-schema apply with duplicate axes before writing', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    let createCalls = 0;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveTwoTableSnapshot();
      },
      async createTable() {
        createCalls += 1;
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode', 'SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toMatch(/duplicate axes/i);
    expect(payload.reason).toBe('duplicate-axis');
    expect(createCalls).toBe(0);
  });

  it('refuses star-schema apply in folder mode instead of writing stale disk changes', async () => {
    const folderPath = twoFactSharedColumnModel();
    let createCalls = 0;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'folder', folderPath };
      },
      async createTable() {
        createCalls += 1;
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          folderPath,
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toMatch(/require[s]? a live Power BI Desktop model/i);
    expect(payload.reason).toBe('not-live');
    expect(createCalls).toBe(0);
  });

  it('fails final validation when dimension key summarizeBy metadata is not proven', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    const snapshot = structuredClone(liveTwoTableSnapshot()) as MutableModel;
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot;
      },
      async createTable(definition: unknown) {
        const def = definition as { name: string };
        snapshot.tables.push({
          name: def.name,
          columns: [
            {
              table: def.name,
              name: def.name,
              dataType: 'string',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
          ],
          measures: [],
          isHidden: false,
          isCalculated: true,
          isAutoDateTable: false,
        });
        return { ok: true };
      },
      async refreshModel() {
        return { ok: true };
      },
      async updateColumn(definition: unknown) {
        const def = definition as {
          tableName: string;
          name: string;
          dataType?: string;
          isHidden?: boolean;
          isKey?: boolean;
        };
        const table = snapshot.tables.find((candidate) => candidate.name === def.tableName);
        const column = table?.columns.find((candidate) => candidate.name === def.name);
        if (!column) throw new Error(`missing test column ${def.tableName}.${def.name}`);
        if (def.dataType !== undefined) column.dataType = def.dataType;
        if (def.isHidden !== undefined) column.isHidden = def.isHidden;
        if (def.isKey !== undefined) column.isKey = def.isKey;
        return { ok: true };
      },
      async createRelationship(definition: unknown) {
        const def = definition as {
          fromTable: string;
          fromColumn: string;
          toTable: string;
          toColumn: string;
          cardinality?: 'manyToOne';
          crossFilteringBehavior?: 'single' | 'both';
          isActive?: boolean;
        };
        snapshot.relationships.push({
          id: `${def.fromTable}_${def.fromColumn}_${def.toTable}_${def.toColumn}`,
          fromTable: def.fromTable,
          fromColumn: def.fromColumn,
          toTable: def.toTable,
          toColumn: def.toColumn,
          isActive: def.isActive !== false,
          crossFilteringBehavior: def.crossFilteringBehavior ?? 'single',
          cardinality: def.cardinality ?? 'manyToOne',
        });
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toMatch(/final validation did not pass/i);
    expect(payload.reason).toBe('post-write-validation-failed');
    expect(payload.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dimension-key-summarizeby-missing',
          tableName: 'SharedCode',
          columnName: 'SharedCode',
        }),
      ]),
    );
  });

  it('refuses to create a duplicate dimension when a prior same-name artifact lacks source DAX', async () => {
    // biome-ignore lint/performance/noDelete: this test exercises live-first behavior
    delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
    let createCalls = 0;
    const snapshot = liveTwoTableSnapshot();
    snapshot.tables.push({
      name: 'SharedCode',
      columns: [
        {
          table: 'SharedCode',
          name: 'SharedCode',
          dataType: 'string',
          isHidden: false,
          isKey: false,
          isCalculated: false,
        },
      ],
      measures: [],
      isHidden: false,
      isCalculated: true,
      isAutoDateTable: false,
    });
    setModelDriverForTests({
      async listLiveInstances() {
        return [{ connectionString: 'Data Source=localhost:61234;' }];
      },
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot;
      },
      async createTable() {
        createCalls += 1;
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_apply_star_schema_join',
        arguments: {
          leftTable: 'FactLeft',
          rightTable: 'FactRight',
          axes: ['SharedCode'],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.error).toMatch(/planned generated dimension table already exists/i);
    expect(payload.reason).toBe('partial-generated-dimension-artifact');
    expect(createCalls).toBe(0);
  });
});
