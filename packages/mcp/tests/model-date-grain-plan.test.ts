import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer, setModelDriverForTests } from '../src/server.js';

type ToolInfo = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: { readonly properties?: Record<string, unknown> };
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
  };
};

const TRUTH_SEMANTIC_MODEL = fileURLToPath(
  new URL('../../../dashboard/Truth.SemanticModel', import.meta.url),
);

afterEach(() => {
  // biome-ignore lint/performance/noDelete: tests must restore the process environment
  delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
  setModelDriverForTests(null);
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

const DATE_PROOF_FORBIDDEN_FALLBACK_TOOLS = [
  'pbi_dax_query',
  'pbi_model_refresh',
  'pbi_table_create',
  'pbi_table_update',
  'pbi_table_mark_as_date',
  'pbi_column_create',
  'pbi_column_update',
  'pbi_relationship_create',
  'pbi_relationship_update',
  'pbi_relationship_activate',
];

function expectDateProofParseShapeStopGuidance(value: unknown): void {
  const payload = value as Record<string, unknown>;
  expect(payload.blockedAction).toBe('stop-before-date-write');
  expect(payload.forbiddenFallbackTools).toEqual(
    expect.arrayContaining(DATE_PROOF_FORBIDDEN_FALLBACK_TOOLS),
  );
  expect(payload.forbiddenFallbackInputs).toEqual(expect.arrayContaining(['probeData:false']));
  expect(payload.forbiddenFallbackModes).toEqual(
    expect.arrayContaining([
      'manual DAX',
      'probeData:false',
      'model processing',
      'Desktop restart',
      'primitive Date writes',
      'primitive relationship writes',
    ]),
  );
  const nextStep = String(payload.nextStep ?? '');
  expect(nextStep).toMatch(/stop/i);
  expect(nextStep).toContain('pbi_dax_query');
  expect(nextStep).toContain('pbi_model_refresh');
  expect(nextStep).toContain('probeData:false');
}

function liveSnapshot() {
  return {
    modelPath: '(live)',
    tables: [
      {
        name: 'Actual',
        columns: [
          {
            table: 'Actual',
            name: 'Date',
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
        name: 'Target',
        columns: [
          {
            table: 'Target',
            name: 'Date',
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
        name: 'Calendar',
        columns: [
          {
            table: 'Calendar',
            name: 'Date',
            dataType: 'dateTime',
            isHidden: false,
            isKey: true,
            isCalculated: false,
          },
        ],
        measures: [],
        isHidden: false,
        isCalculated: false,
        isAutoDateTable: false,
        dataCategory: 'Time',
        partitionSources: [
          {
            kind: 'calculated',
            expression: "CALENDAR(MINX('Actual', 'Actual'[Date]), MAXX('Target', 'Target'[Date]))",
          },
        ],
      },
      {
        name: 'LocalDateTable_1',
        columns: [],
        measures: [],
        isHidden: true,
        isCalculated: false,
        isAutoDateTable: true,
      },
    ],
    relationships: [
      {
        id: 'Actual_Date_Calendar_Date',
        identityProven: true,
        fromTable: 'Actual',
        fromColumn: 'Date',
        toTable: 'Calendar',
        toColumn: 'Date',
        isActive: true,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      },
      {
        id: 'Target_Date_Calendar_Date',
        identityProven: true,
        fromTable: 'Target',
        fromColumn: 'Date',
        toTable: 'Calendar',
        toColumn: 'Date',
        isActive: false,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      },
    ],
  };
}

describe('date grain planner tool', () => {
  it('is registered as a deterministic read-only planning tool', async () => {
    const tools = await withClient(
      async (client) => (await client.listTools()).tools as ToolInfo[],
    );
    const found = tools.find((tool) => tool.name === 'pbi_model_plan_date_grain');

    expect(found, 'date-grain planner tool should be registered').toBeDefined();
    const desc = found?.description?.toLowerCase() ?? '';
    expect(desc).toContain('deterministic');
    expect(desc).toContain('date-grain');
    expect(desc).toContain('read-only dax probe');
    expect(found?.annotations?.readOnlyHint).toBe(true);
    expect(found?.annotations?.destructiveHint).toBe(false);

    const props = found?.inputSchema?.properties ?? {};
    expect(props.facts).toBeDefined();
    expect(props.dateTable).toBeDefined();
    expect(props.dateColumn).toBeDefined();
    expect(props.probeData).toBeDefined();
    expect(props.scanMeasures).toBeDefined();
    expect(props.model).toBeDefined();
  });

  it('registers the deterministic date-table coverage planner', async () => {
    const tools = await withClient(
      async (client) => (await client.listTools()).tools as ToolInfo[],
    );
    const found = tools.find((tool) => tool.name === 'pbi_model_plan_date_table');

    expect(found, 'date-table planner tool should be registered').toBeDefined();
    const desc = found?.description?.toLowerCase() ?? '';
    expect(desc).toContain('deterministic');
    expect(desc).toContain('coverage');
    expect(desc).toContain('today');
    expect(found?.annotations?.readOnlyHint).toBe(true);
    expect(found?.annotations?.destructiveHint).toBe(false);

    const props = found?.inputSchema?.properties ?? {};
    expect(props.dateTable).toBeDefined();
    expect(props.dateColumn).toBeDefined();
    expect(props.facts).toBeDefined();
    expect(props.probeData).toBeDefined();
  });

  it('runs one live DAX probe for all facts and returns observed grain evidence', async () => {
    process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
    const daxQueries: string[] = [];
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async daxQuery(query: string) {
        daxQueries.push(query);
        return {
          results: [
            {
              tables: [
                {
                  rows: [
                    {
                      '[__kind]': 'date-table',
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 30,
                      '[nonBlankDateCount]': 30,
                      '[distinctDateCount]': 30,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-30T00:00:00',
                    },
                    {
                      '[__table]': 'Actual',
                      '[__column]': 'Date',
                      '[rowCount]': 100,
                      '[nonBlankDateCount]': 100,
                      '[distinctDateCount]': 30,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 29,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 30,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 70,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-30T00:00:00',
                    },
                    {
                      '[__table]': 'Target',
                      '[__column]': 'Date',
                      '[rowCount]': 20,
                      '[nonBlankDateCount]': 20,
                      '[distinctDateCount]': 20,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 19,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 20,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-20T00:00:00',
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
        name: 'pbi_model_plan_date_grain',
        arguments: {
          facts: [
            { tableName: 'Actual', dateColumn: 'Date' },
            { tableName: 'Target', dateColumn: 'Date' },
          ],
          dateTable: 'Calendar',
          dateColumn: 'Date',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.mode).toBe('live');
    expect(payload.probeStatus).toMatchObject({
      status: 'succeeded',
      evidenceRows: 2,
      expectedEvidenceRows: 2,
      queriedFacts: 2,
      probeMode: 'proof',
    });
    expect((payload.probeStatus as Record<string, unknown>).durationMs).toEqual(expect.any(Number));
    expect(daxQueries).toHaveLength(1);
    expect(daxQueries[0]).toContain('UNION(');

    const plan = payload.plan as Record<string, unknown>;
    expect(plan.autoDateTables).toEqual({
      count: 1,
      names: ['LocalDateTable_1'],
      recommendation:
        'Disable Auto Date/Time and use the governed date table; auto date tables add repeated calendar structures and slow model inspection.',
    });

    const facts = plan.facts as Record<string, unknown>[];
    expect(facts.map((fact) => fact.observedGrain)).toEqual(['day', 'day']);
    expect(facts[1]?.writePlan).toEqual([
      {
        action: 'activate-date-relationship',
        id: 'Target_Date_Calendar_Date',
        description:
          'Observed day-level date values support activating the existing date relationship.',
      },
    ]);
  });

  it('reports sparse day-level proof as day-or-above visual safe without enabling writes', async () => {
    process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async daxQuery() {
        return {
          results: [
            {
              tables: [
                {
                  rows: [
                    {
                      '[__table]': 'Target',
                      '[__column]': 'Date',
                      '[rowCount]': 20,
                      '[nonBlankDateCount]': 20,
                      '[distinctDateCount]': 10,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 9,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 10,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 10,
                      '[gapCount]': 5,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-15T00:00:00',
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
        name: 'pbi_model_plan_date_grain',
        arguments: {
          facts: [{ tableName: 'Target', dateColumn: 'Date' }],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.probeStatus).toMatchObject({
      status: 'succeeded',
      evidenceRows: 1,
      expectedEvidenceRows: 1,
      queriedFacts: 1,
      probeMode: 'proof',
    });
    const facts = (payload.plan as Record<string, unknown>).facts as Record<string, unknown>[];
    expect(facts[0]?.observedGrain).toBe('day');
    expect(facts[0]?.writePlan).toEqual([]);
    expect(facts[0]?.measureGuidance).toMatchObject({
      plainSumSafe: true,
      safeVisualDateGrain: 'day-or-above',
    });
  });

  it('fails closed in metadata-only mode instead of inventing date grain', async () => {
    process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
    let daxCalls = 0;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async daxQuery() {
        daxCalls += 1;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_date_grain',
        arguments: {
          facts: [{ tableName: 'Target', dateColumn: 'Date' }],
          dateTable: 'Calendar',
          dateColumn: 'Date',
          probeData: false,
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(daxCalls).toBe(0);
    expect(payload.probeStatus).toMatchObject({
      status: 'skipped',
      reason: 'probeData=false',
      queriedFacts: 0,
      probeMode: 'proof',
    });
    const facts = (payload.plan as Record<string, unknown>).facts as Record<string, unknown>[];
    expect(facts[0]?.observedGrain).toBe('unknown');
    expect(facts[0]?.writePlan).toEqual([]);
  });

  it('reports a parse-shape defect when an expected ROW proof normalizes to zero rows', async () => {
    process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async daxQuery() {
        return {
          columns: ['[__table]', '[rowCount]'],
          rows: [],
          rowCount: 0,
          rawDiagnostics: {
            payloadType: 'object',
            shape: {
              node0: { path: '$', type: 'object' },
            },
          },
        };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_date_grain',
        arguments: {
          facts: [{ tableName: 'Target', dateColumn: 'Date' }],
          dateTable: 'Calendar',
          dateColumn: 'Date',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.probeStatus).toMatchObject({
      status: 'parse-shape-unrecognized',
      reason: 'proof-parse-shape-unrecognized',
      evidenceRows: 0,
      expectedEvidenceRows: 1,
      queriedFacts: 1,
      diagnostics: {
        rowCount: 0,
        rawDiagnostics: {
          payloadType: 'object',
          shape: {
            node0: { path: '$', type: 'object' },
          },
        },
      },
    });
    expectDateProofParseShapeStopGuidance(payload.probeStatus);
    expect(JSON.stringify(payload.probeStatus).toLowerCase()).not.toMatch(/no data|reopen/);
    const facts = (payload.plan as Record<string, unknown>).facts as Record<string, unknown>[];
    expect(facts[0]?.observedGrain).toBe('unknown');
  });

  it('reports a parse-shape defect when raw proof rows exist but no evidence parses', async () => {
    process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async daxQuery() {
        return { results: [{ tables: [{ rows: [{ unexpectedShape: true }] }] }] };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_date_grain',
        arguments: {
          facts: [{ tableName: 'Target', dateColumn: 'Date' }],
          dateTable: 'Calendar',
          dateColumn: 'Date',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.probeStatus).toMatchObject({
      status: 'parse-shape-unrecognized',
      reason: 'proof-parse-shape-unrecognized',
      evidenceRows: 0,
      expectedEvidenceRows: 1,
      queriedFacts: 1,
      diagnostics: {
        rowCount: 1,
        sampleRow: { unexpectedShape: true },
      },
    });
    expectDateProofParseShapeStopGuidance(payload.probeStatus);
    expect(String((payload.probeStatus as Record<string, unknown>).rationale)).toMatch(/ROW\(\)/);
    expect(JSON.stringify(payload.probeStatus).toLowerCase()).not.toMatch(/no data|reopen/);
  });

  it('runs one live date-table coverage proof and blocks uncovered fact dates', async () => {
    process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
    const daxQueries: string[] = [];
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async daxQuery(query: string) {
        daxQueries.push(query);
        return {
          results: [
            {
              tables: [
                {
                  rows: [
                    {
                      '[__kind]': 'date-table',
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 366,
                      '[nonBlankDateCount]': 366,
                      '[distinctDateCount]': 366,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2020-01-01T00:00:00',
                      '[maxDate]': '2020-12-31T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Actual',
                      '[__column]': 'Date',
                      '[rowCount]': 100,
                      '[nonBlankDateCount]': 100,
                      '[distinctDateCount]': 100,
                      '[distinctMonthStartCount]': 10,
                      '[nonMonthStartDateCount]': 96,
                      '[monthsWithMultipleDates]': 10,
                      '[maxDistinctDatesPerMonth]': 12,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 1361,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2017-01-03T00:00:00',
                      '[maxDate]': '2020-12-30T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Target',
                      '[__column]': 'Date',
                      '[rowCount]': 100,
                      '[nonBlankDateCount]': 100,
                      '[distinctDateCount]': 100,
                      '[distinctMonthStartCount]': 10,
                      '[nonMonthStartDateCount]': 96,
                      '[monthsWithMultipleDates]': 10,
                      '[maxDistinctDatesPerMonth]': 12,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 1361,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2017-01-03T00:00:00',
                      '[maxDate]': '2020-12-30T00:00:00',
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
        name: 'pbi_model_plan_date_table',
        arguments: {
          dateTable: 'Calendar',
          dateColumn: 'Date',
          facts: [{ tableName: 'Actual', dateColumn: 'Date' }],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(payload.mode).toBe('live');
    expect(payload.probeStatus).toMatchObject({
      status: 'succeeded',
      evidenceRows: 3,
      expectedEvidenceRows: 3,
      queriedFacts: 2,
      probeMode: 'proof',
    });
    expect(daxQueries).toHaveLength(1);
    expect(daxQueries[0]).toContain('"__kind", "date-table"');
    const plan = payload.plan as Record<string, unknown>;
    expect(plan.status).toBe('blocked');
    expect(plan.recommendedRange).toMatchObject({
      observedFactMinDate: '2017-01-03',
      observedFactMaxDate: '2020-12-30',
      calendarStartDate: '2017-01-03',
      calendarEndDate: '2020-12-30',
    });
    const blockers = plan.blockers as Record<string, unknown>[];
    expect(blockers.map((blocker) => blocker.code)).toContain('date-table-start-after-fact-min');
  });

  it('reports a date-table parse-shape defect when raw coverage rows exist but no evidence parses', async () => {
    process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async daxQuery() {
        return { results: [{ tables: [{ rows: [{ unexpectedCoverageShape: true }] }] }] };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_date_table',
        arguments: {
          dateTable: 'Calendar',
          dateColumn: 'Date',
          facts: [{ tableName: 'Actual', dateColumn: 'Date' }],
        },
      }),
    );

    const payload = jsonPayload(result);

    expect(payload.probeStatus).toMatchObject({
      status: 'parse-shape-unrecognized',
      reason: 'proof-parse-shape-unrecognized',
      evidenceRows: 0,
      diagnostics: {
        rowCount: 1,
        sampleRow: { unexpectedCoverageShape: true },
      },
    });
    expectDateProofParseShapeStopGuidance(payload.probeStatus);
  });

  it('reports a parse-shape defect when expected coverage proof normalizes to zero rows', async () => {
    process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async daxQuery() {
        return { results: [{ tables: [{ rows: [] }] }] };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_plan_date_table',
        arguments: {
          dateTable: 'Calendar',
          dateColumn: 'Date',
          facts: [{ tableName: 'Actual', dateColumn: 'Date' }],
        },
      }),
    );

    const payload = jsonPayload(result);

    expect(payload.probeStatus).toMatchObject({
      status: 'parse-shape-unrecognized',
      reason: 'proof-parse-shape-unrecognized',
      evidenceRows: 0,
      expectedEvidenceRows: 3,
      diagnostics: { rowCount: 0 },
    });
    expectDateProofParseShapeStopGuidance(payload.probeStatus);
  });

  it('refuses volatile TODAY/NOW calendar table creation before connecting to a model', async () => {
    let connected = false;
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        connected = true;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async createTable() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_create',
        arguments: {
          name: 'Calendar',
          expression: 'CALENDAR(DATE(2017,1,1), DATE(YEAR(TODAY()) + 1, 12, 31))',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('date-table-create-gate');
    expect(payload.reason).toBe('volatile-calendar-anchor');
    expect(connected).toBe(false);
    expect(created).toBe(false);
  });

  it('refuses volatile TODAY/NOW calculated table creation outside CALENDAR()', async () => {
    let connected = false;
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        connected = true;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async createTable() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_create',
        arguments: {
          name: 'Generated Dates',
          expression: 'GENERATESERIES(DATE(2017,1,1), TODAY(), 1)',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('volatile-calendar-anchor');
    expect(connected).toBe(false);
    expect(created).toBe(false);
  });

  it('refuses literal hardcoded Date/calendar table creation before connecting to a model', async () => {
    let connected = false;
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        connected = true;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async createTable() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_create',
        arguments: {
          name: 'Calendar',
          expression: 'CALENDAR(DATE(2020,1,1), DATE(2026,12,31))',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('date-table-create-gate');
    expect(payload.reason).toBe('literal-calendar-range');
    expect(connected).toBe(false);
    expect(created).toBe(false);
  });

  it('refuses nonliteral calendar table creation through generic table create', async () => {
    let connected = false;
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        connected = true;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async createTable() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_create',
        arguments: {
          name: 'Calendar',
          expression: "CALENDAR(MINX('Actual', 'Actual'[Date]), MAXX('Target', 'Target'[Date]))",
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('date-table-create-gate');
    expect(payload.reason).toBe('date-table-create-requires-coverage-proof');
    expect(connected).toBe(false);
    expect(created).toBe(false);
  });

  it('governed Date table create asks for policy before connecting or writing', async () => {
    let connected = false;
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        connected = true;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async createTable() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_date_table_create_governed',
        arguments: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          facts: [
            { tableName: 'Actual', dateColumn: 'Date' },
            { tableName: 'Target', dateColumn: 'Date' },
          ],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload.status).toBe('needs-user-input');
    expect(payload.clarifyingQuestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'date_range_policy',
        }),
        expect.objectContaining({
          id: 'refresh_before_probe',
        }),
      ]),
    );
    expect(connected).toBe(false);
    expect(created).toBe(false);
  });

  it('creates a governed Date table with dynamic fact-anchored bounds and explicit refresh', async () => {
    const refreshes: string[] = [];
    const relationships: unknown[] = [];
    let createdExpression = '';
    let marked = false;
    let calendarExists = false;
    let calendarMarked = false;
    const calendarColumnNames = [
      'Date',
      'Year',
      'Quarter',
      'Quarter No',
      'Month No',
      'Month Name',
      'Month Short',
      'Year Month',
      'Day',
      'Day Of Week',
      'Day Of Week No',
      'Is Weekend',
    ];
    const calendarColumnMetadata = new Map<string, Record<string, unknown>>(
      calendarColumnNames.map((name) => [name, { dataType: 'unknown' }]),
    );
    const columnMetadataUpdates: unknown[] = [];
    const snapshot = () => ({
      modelPath: '(live)',
      tables: [
        {
          name: 'Actual',
          columns: [
            {
              table: 'Actual',
              name: 'Date',
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
          name: 'Target',
          columns: [
            {
              table: 'Target',
              name: 'Date',
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
          name: 'Forecast',
          columns: [
            {
              table: 'Forecast',
              name: 'Date',
              dataType: 'dateTime',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
            {
              table: 'Forecast',
              name: 'Amount',
              dataType: 'decimal',
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
        ...(calendarExists
          ? [
              {
                name: 'Calendar',
                columns: calendarColumnNames.map((name) => {
                  const metadata = calendarColumnMetadata.get(name) ?? {};
                  return {
                    table: 'Calendar',
                    name,
                    dataType: typeof metadata.dataType === 'string' ? metadata.dataType : 'unknown',
                    isHidden: false,
                    isKey: name === 'Date' ? calendarMarked : false,
                    isCalculated: false,
                    ...(typeof metadata.summarizeBy === 'string'
                      ? { summarizeBy: metadata.summarizeBy }
                      : {}),
                    ...(typeof metadata.formatString === 'string'
                      ? { formatString: metadata.formatString }
                      : {}),
                    ...(typeof metadata.sortByColumn === 'string'
                      ? { sortByColumn: metadata.sortByColumn }
                      : {}),
                    ...(calendarMarked && name === 'Date' ? { dataCategory: 'Time' } : {}),
                  };
                }),
                measures: [],
                isHidden: false,
                isCalculated: true,
                isAutoDateTable: false,
                ...(calendarMarked ? { dataCategory: 'Time' } : {}),
                expression: createdExpression,
              },
            ]
          : []),
      ],
      relationships: relationships.map((relationship, index) => ({
        id: `rel_${index}`,
        identityProven: true,
        isActive: true,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
        ...(relationship as Record<string, unknown>),
      })),
    });
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot();
      },
      async refreshModel(refreshType: string) {
        refreshes.push(refreshType);
        return { refreshType };
      },
      async createTable(definition: { expression?: string }) {
        createdExpression = definition.expression ?? '';
        calendarExists = true;
        return { created: true };
      },
      async updateColumn(definition: { name: string }) {
        columnMetadataUpdates.push(definition);
        calendarColumnMetadata.set(definition.name, {
          ...(calendarColumnMetadata.get(definition.name) ?? {}),
          ...definition,
        });
        return { updated: true };
      },
      async markAsDateTable(tableName: string, dateColumn: string) {
        marked = tableName === 'Calendar' && dateColumn === 'Date';
        calendarMarked = true;
        return { marked };
      },
      async createRelationship(definition: unknown) {
        relationships.push(definition);
        return { created: true };
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 30,
                      '[nonBlankDateCount]': 30,
                      '[distinctDateCount]': 30,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-30T00:00:00',
                    },
                    {
                      '[__table]': 'Actual',
                      '[__column]': 'Date',
                      '[rowCount]': 100,
                      '[nonBlankDateCount]': 100,
                      '[distinctDateCount]': 30,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 29,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 30,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 70,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-30T00:00:00',
                    },
                    {
                      '[__table]': 'Target',
                      '[__column]': 'Date',
                      '[rowCount]': 20,
                      '[nonBlankDateCount]': 20,
                      '[distinctDateCount]': 20,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 19,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 20,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-20T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Forecast',
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
        name: 'pbi_date_table_create_governed',
        arguments: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          facts: [
            { tableName: 'Actual', dateColumn: 'Date' },
            { tableName: 'Target', dateColumn: 'Date' },
          ],
          rangePolicy: 'observed-min-max',
          refreshBeforeProbe: true,
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError, JSON.stringify(payload, null, 2)).not.toBe(true);
    expect(payload.status).toBe('created');
    expect(createdExpression).toContain('MINX(__FactDates, [__date])');
    expect(createdExpression).toContain('MAXX(__FactDates, [__date])');
    expect(createdExpression).toContain("'Actual'[Date]");
    expect(createdExpression).toContain("'Target'[Date]");
    expect(createdExpression).toContain("'Forecast'[Date]");
    expect(createdExpression).not.toMatch(/\bDATE\s*\(\s*\d{4}\s*,/i);
    expect(createdExpression).not.toMatch(/\b(?:TODAY|NOW)\s*\(/i);
    expect(refreshes).toEqual(['Automatic', 'Calculate']);
    expect(columnMetadataUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: 'Calendar',
          name: 'Date',
          dataType: 'dateTime',
          summarizeBy: 'none',
        }),
        expect.objectContaining({
          tableName: 'Calendar',
          name: 'Year',
          dataType: 'int64',
          summarizeBy: 'none',
        }),
        expect.objectContaining({
          tableName: 'Calendar',
          name: 'Month Name',
          dataType: 'string',
          summarizeBy: 'none',
          sortByColumn: 'Month No',
        }),
      ]),
    );
    expect(marked).toBe(true);
    expect(relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromTable: 'Actual',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
        }),
        expect.objectContaining({
          fromTable: 'Target',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
        }),
        expect.objectContaining({
          fromTable: 'Forecast',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
        }),
      ]),
    );
  });

  it('creates governed Date relationships for sparse Import facts without requiring manual isKey repair', async () => {
    const relationships: unknown[] = [];
    let calendarExists = false;
    let calendarMarked = false;
    const calendarColumnNames = [
      'Date',
      'Year',
      'Quarter',
      'Quarter No',
      'Month No',
      'Month Name',
      'Month Short',
      'Year Month',
      'Day',
      'Day Of Week',
      'Day Of Week No',
      'Is Weekend',
    ];
    const calendarColumnMetadata = new Map<string, Record<string, unknown>>(
      calendarColumnNames.map((name) => [name, { dataType: 'unknown' }]),
    );
    const snapshot = () => ({
      modelPath: '(live)',
      tables: [
        {
          name: 'Fact',
          columns: [
            {
              table: 'Fact',
              name: 'Order Date',
              dataType: 'dateTime',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
            {
              table: 'Fact',
              name: 'Ship Date',
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
          name: 'Target',
          columns: [
            {
              table: 'Target',
              name: 'Date',
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
        ...(calendarExists
          ? [
              {
                name: 'Calendar',
                columns: calendarColumnNames.map((name) => {
                  const metadata = calendarColumnMetadata.get(name) ?? {};
                  return {
                    table: 'Calendar',
                    name,
                    dataType: typeof metadata.dataType === 'string' ? metadata.dataType : 'unknown',
                    isHidden: false,
                    isKey: false,
                    isCalculated: false,
                    ...(typeof metadata.summarizeBy === 'string'
                      ? { summarizeBy: metadata.summarizeBy }
                      : {}),
                    ...(calendarMarked && name === 'Date' ? { dataCategory: 'Time' } : {}),
                  };
                }),
                measures: [],
                isHidden: false,
                isCalculated: true,
                isAutoDateTable: false,
                ...(calendarMarked ? { dataCategory: 'Time' } : {}),
              },
            ]
          : []),
      ],
      relationships: relationships.map((relationship, index) => ({
        id: `date_rel_${index}`,
        identityProven: true,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
        ...(relationship as Record<string, unknown>),
      })),
    });
    const factRows = [
      {
        '[__kind]': 'fact',
        '[__table]': 'Fact',
        '[__column]': 'Order Date',
        '[rowCount]': 20,
        '[nonBlankDateCount]': 20,
        '[distinctDateCount]': 10,
        '[distinctMonthStartCount]': 1,
        '[nonMonthStartDateCount]': 9,
        '[monthsWithMultipleDates]': 1,
        '[maxDistinctDatesPerMonth]': 10,
        '[blankDateCount]': 0,
        '[duplicateDateCount]': 10,
        '[gapCount]': 5,
        '[nonMidnightTimeCount]': 0,
        '[minDate]': '2025-01-01T00:00:00',
        '[maxDate]': '2025-01-15T00:00:00',
      },
      {
        '[__kind]': 'fact',
        '[__table]': 'Fact',
        '[__column]': 'Ship Date',
        '[rowCount]': 20,
        '[nonBlankDateCount]': 20,
        '[distinctDateCount]': 10,
        '[distinctMonthStartCount]': 1,
        '[nonMonthStartDateCount]': 9,
        '[monthsWithMultipleDates]': 1,
        '[maxDistinctDatesPerMonth]': 10,
        '[blankDateCount]': 0,
        '[duplicateDateCount]': 10,
        '[gapCount]': 5,
        '[nonMidnightTimeCount]': 0,
        '[minDate]': '2025-01-02T00:00:00',
        '[maxDate]': '2025-01-16T00:00:00',
      },
      {
        '[__kind]': 'fact',
        '[__table]': 'Target',
        '[__column]': 'Date',
        '[rowCount]': 20,
        '[nonBlankDateCount]': 20,
        '[distinctDateCount]': 10,
        '[distinctMonthStartCount]': 1,
        '[nonMonthStartDateCount]': 9,
        '[monthsWithMultipleDates]': 1,
        '[maxDistinctDatesPerMonth]': 10,
        '[blankDateCount]': 0,
        '[duplicateDateCount]': 10,
        '[gapCount]': 5,
        '[nonMidnightTimeCount]': 0,
        '[minDate]': '2025-01-01T00:00:00',
        '[maxDate]': '2025-01-15T00:00:00',
      },
    ];
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot();
      },
      async refreshModel() {
        return { refreshed: true };
      },
      async createTable() {
        calendarExists = true;
        return { created: true };
      },
      async updateColumn(definition: { name: string }) {
        calendarColumnMetadata.set(definition.name, {
          ...(calendarColumnMetadata.get(definition.name) ?? {}),
          ...definition,
        });
        return { updated: true };
      },
      async markAsDateTable() {
        calendarMarked = true;
        return {
          marked: true,
          columnKeySkipped: true,
          columnKeyWarning: 'Setting IsKey property is only supported for DirectQuery mode tables.',
        };
      },
      async createRelationship(definition: unknown) {
        relationships.push(definition);
        return { created: true };
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 16,
                      '[nonBlankDateCount]': 16,
                      '[distinctDateCount]': 16,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-16T00:00:00',
                    },
                    ...factRows,
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
        name: 'pbi_date_table_create_governed',
        arguments: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          facts: [
            { tableName: 'Fact', dateColumn: 'Order Date' },
            { tableName: 'Fact', dateColumn: 'Ship Date' },
            { tableName: 'Target', dateColumn: 'Date' },
          ],
          rangePolicy: 'observed-min-max',
          refreshBeforeProbe: true,
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError, JSON.stringify(payload, null, 2)).not.toBe(true);
    expect(payload.status).toBe('created');
    expect(payload.markResult).toMatchObject({ columnKeySkipped: true });
    expect(relationships).toEqual([
      expect.objectContaining({
        fromTable: 'Fact',
        fromColumn: 'Order Date',
        toTable: 'Calendar',
        toColumn: 'Date',
        isActive: true,
      }),
      expect.objectContaining({
        fromTable: 'Fact',
        fromColumn: 'Ship Date',
        toTable: 'Calendar',
        toColumn: 'Date',
        isActive: false,
      }),
      expect.objectContaining({
        fromTable: 'Target',
        fromColumn: 'Date',
        toTable: 'Calendar',
        toColumn: 'Date',
        isActive: true,
      }),
    ]);
  });

  it('surfaces proof-parse-shape-unrecognized when post-write governed coverage rows are unparseable', async () => {
    let calendarExists = false;
    let marked = false;
    let daxCalls = 0;
    const snapshot = () => {
      const base = liveSnapshot();
      return {
        ...base,
        tables: [
          ...base.tables,
          ...(calendarExists
            ? [
                {
                  name: 'Date',
                  columns: [
                    {
                      table: 'Date',
                      name: 'Date',
                      dataType: 'dateTime',
                      summarizeBy: 'none',
                      dataCategory: marked ? 'Time' : undefined,
                      isHidden: false,
                      isKey: marked,
                      isCalculated: false,
                    },
                  ],
                  measures: [],
                  isHidden: false,
                  isCalculated: true,
                  isAutoDateTable: false,
                  ...(marked ? { dataCategory: 'Time' } : {}),
                },
              ]
            : []),
        ],
      };
    };
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot();
      },
      async createTable() {
        calendarExists = true;
        return { created: true };
      },
      async refreshModel() {
        return { refreshed: true };
      },
      async updateColumn() {
        return { updated: true };
      },
      async markAsDateTable() {
        marked = true;
        return { marked: true };
      },
      async daxQuery() {
        daxCalls += 1;
        if (daxCalls === 1) {
          return {
            results: [
              {
                tables: [
                  {
                    rows: [
                      {
                        '[__kind]': 'fact',
                        '[__table]': 'Actual',
                        '[__column]': 'Date',
                        '[rowCount]': 1,
                        '[nonBlankDateCount]': 1,
                        '[distinctDateCount]': 1,
                        '[distinctMonthStartCount]': 1,
                        '[nonMonthStartDateCount]': 0,
                        '[monthsWithMultipleDates]': 0,
                        '[maxDistinctDatesPerMonth]': 1,
                        '[blankDateCount]': 0,
                        '[duplicateDateCount]': 0,
                        '[gapCount]': 0,
                        '[nonMidnightTimeCount]': 0,
                        '[minDate]': '2025-01-01T00:00:00',
                        '[maxDate]': '2025-01-01T00:00:00',
                      },
                    ],
                  },
                ],
              },
            ],
          };
        }
        if (daxCalls === 2) {
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
                        '[rowCount]': 1,
                        '[nonBlankDateCount]': 1,
                        '[distinctDateCount]': 1,
                        '[blankDateCount]': 0,
                        '[duplicateDateCount]': 0,
                        '[gapCount]': 0,
                        '[nonMidnightTimeCount]': 0,
                        '[minDate]': '2025-01-01T00:00:00',
                        '[maxDate]': '2025-01-01T00:00:00',
                      },
                      {
                        '[__kind]': 'fact',
                        '[__table]': 'Actual',
                        '[__column]': 'Date',
                        '[rowCount]': 1,
                        '[nonBlankDateCount]': 1,
                        '[distinctDateCount]': 1,
                        '[distinctMonthStartCount]': 1,
                        '[nonMonthStartDateCount]': 0,
                        '[monthsWithMultipleDates]': 0,
                        '[maxDistinctDatesPerMonth]': 1,
                        '[blankDateCount]': 0,
                        '[duplicateDateCount]': 0,
                        '[gapCount]': 0,
                        '[nonMidnightTimeCount]': 0,
                        '[minDate]': '2025-01-01T00:00:00',
                        '[maxDate]': '2025-01-01T00:00:00',
                      },
                    ],
                  },
                ],
              },
            ],
          };
        }
        return { results: [{ tables: [{ rows: [{ unexpectedCoverageShape: true }] }] }] };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_date_table_create_governed',
        arguments: {
          tableName: 'Date',
          dateColumn: 'Date',
          facts: [{ tableName: 'Actual', dateColumn: 'Date' }],
          rangePolicy: 'observed-min-max',
          refreshBeforeProbe: false,
        },
      }),
    );

    const payload = jsonPayload(result);

    expect(payload.status).toBe('blocked');
    expect(payload).toMatchObject({
      reason: 'proof-parse-shape-unrecognized',
      code: 'proof-parse-shape-unrecognized',
      evidenceRows: 0,
      probeDiagnostics: {
        rowCount: 1,
        sampleRow: { unexpectedCoverageShape: true },
      },
    });
    expect(String(payload.message)).toMatch(/tool\/parse defect/i);
    expectDateProofParseShapeStopGuidance(payload);
    expect(String(payload.nextStep)).toMatch(/report the structured/i);
    expect(String(payload.nextStep)).not.toMatch(/reopen/i);
    expect(calendarExists).toBe(true);
    expect(marked).toBe(true);
  });

  it('surfaces a structured probe-failed error (with the DAX message) when the probe throws', async () => {
    // daxQuery throws on a DAX engine error / non-tabular result. Governed create
    // must prove fact-date evidence before any table/metadata/relationship write,
    // then surface the underlying DAX message as a structured block.
    let calendarExists = false;
    let columnMetadataUpdated = false;
    let marked = false;
    let relationshipCreated = false;
    const snapshot = () => ({
      modelPath: '(live)',
      tables: [
        {
          name: 'Sales',
          columns: [
            {
              table: 'Sales',
              name: 'Order Date',
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
        ...(calendarExists
          ? [
              {
                name: 'Date',
                columns: [
                  {
                    table: 'Date',
                    name: 'Date',
                    dataType: 'dateTime',
                    summarizeBy: 'none',
                    dataCategory: 'Time',
                    isHidden: false,
                    isKey: true,
                    isCalculated: false,
                  },
                ],
                measures: [],
                isHidden: false,
                isCalculated: true,
                isAutoDateTable: false,
                dataCategory: 'Time',
              },
            ]
          : []),
      ],
      relationships: [],
    });
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot();
      },
      async refreshModel(refreshType: string) {
        return { refreshType };
      },
      async createTable() {
        calendarExists = true;
        return { created: true };
      },
      async updateColumn() {
        columnMetadataUpdated = true;
        return { updated: true };
      },
      async markAsDateTable() {
        marked = true;
        return { marked: true };
      },
      async createRelationship() {
        relationshipCreated = true;
        return { created: true };
      },
      async daxQuery() {
        throw new Error('DAX query failed: Query (1, 9) The syntax for the function is incorrect.');
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_date_table_create_governed',
        arguments: {
          tableName: 'Date',
          dateColumn: 'Date',
          facts: [{ tableName: 'Sales', dateColumn: 'Order Date' }],
          rangePolicy: 'observed-min-max',
          refreshBeforeProbe: false,
        },
      }),
    );

    const payload = jsonPayload(result);
    // A throwing probe must yield a structured, actionable block — not a raw crash
    // — and the underlying DAX engine message must reach the caller.
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('governed-date-table-create');
    expect(payload.status).toBe('blocked');
    expect(payload.reason).toBe('probe-failed');
    expect(payload.error).toMatch(/syntax/i);
    expect(payload.error).not.toMatch(/Data Source=/i);
    expect(payload.blockedAction).toBe('stop-before-date-write');
    expect(payload.nextStep).toMatch(/refreshBeforeProbe:true/i);
    expect(payload.nextStep).toMatch(/do not run manual dax probes/i);
    expect(payload.forbiddenFallbackTools).toEqual(
      expect.arrayContaining(DATE_PROOF_FORBIDDEN_FALLBACK_TOOLS),
    );
    expect(payload.forbiddenFallbackInputs).toEqual(expect.arrayContaining(['probeData:false']));
    expect(calendarExists).toBe(false);
    expect(columnMetadataUpdated).toBe(false);
    expect(marked).toBe(false);
    expect(relationshipCreated).toBe(false);
  });

  it('surfaces proof-parse-shape-unrecognized when governed create receives unparseable proof rows', async () => {
    let calendarExists = false;
    let columnMetadataUpdated = false;
    let marked = false;
    let relationshipCreated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async createTable() {
        calendarExists = true;
        return { created: true };
      },
      async updateColumn() {
        columnMetadataUpdated = true;
        return { updated: true };
      },
      async markAsDateTable() {
        marked = true;
        return { marked: true };
      },
      async createRelationship() {
        relationshipCreated = true;
        return { created: true };
      },
      async daxQuery() {
        return { results: [{ tables: [{ rows: [{ unexpectedShape: true }] }] }] };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_date_table_create_governed',
        arguments: {
          tableName: 'Date',
          dateColumn: 'Date',
          facts: [{ tableName: 'Actual', dateColumn: 'Date' }],
          rangePolicy: 'observed-min-max',
          refreshBeforeProbe: false,
        },
      }),
    );

    const payload = jsonPayload(result);
    const serialized = JSON.stringify(payload).toLowerCase();

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      gate: 'governed-date-table-create',
      status: 'blocked',
      reason: 'proof-parse-shape-unrecognized',
      code: 'proof-parse-shape-unrecognized',
      evidenceRows: 0,
      probeDiagnostics: {
        rowCount: 1,
        sampleRow: { unexpectedShape: true },
      },
    });
    expect(String(payload.message)).toMatch(/tool\/parse defect/i);
    expect(String(payload.nextStep)).toMatch(/do not request model processing/i);
    expectDateProofParseShapeStopGuidance(payload);
    expect(serialized).not.toMatch(/no data|reopen/);
    expect(calendarExists).toBe(false);
    expect(columnMetadataUpdated).toBe(false);
    expect(marked).toBe(false);
    expect(relationshipCreated).toBe(false);
  });

  it('keeps governed create on proof-parse-shape-unrecognized when expected proof rows normalize empty', async () => {
    let calendarExists = false;
    let columnMetadataUpdated = false;
    let marked = false;
    let relationshipCreated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async createTable() {
        calendarExists = true;
        return { created: true };
      },
      async updateColumn() {
        columnMetadataUpdated = true;
        return { updated: true };
      },
      async markAsDateTable() {
        marked = true;
        return { marked: true };
      },
      async createRelationship() {
        relationshipCreated = true;
        return { created: true };
      },
      async daxQuery() {
        return { results: [{ tables: [{ rows: [] }] }] };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_date_table_create_governed',
        arguments: {
          tableName: 'Date',
          dateColumn: 'Date',
          facts: [{ tableName: 'Actual', dateColumn: 'Date' }],
          rangePolicy: 'observed-min-max',
          refreshBeforeProbe: false,
        },
      }),
    );

    const payload = jsonPayload(result);

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      gate: 'governed-date-table-create',
      status: 'blocked',
      reason: 'proof-parse-shape-unrecognized',
      code: 'proof-parse-shape-unrecognized',
      evidenceRows: 0,
      probeDiagnostics: { rowCount: 0 },
    });
    expect(String(payload.message)).toMatch(/tool\/parse defect/i);
    expectDateProofParseShapeStopGuidance(payload);
    expect(calendarExists).toBe(false);
    expect(columnMetadataUpdated).toBe(false);
    expect(marked).toBe(false);
    expect(relationshipCreated).toBe(false);
  });

  it('caps governed future-horizon Date table end dates at the explicit horizon', async () => {
    let createdExpression = '';
    let calendarExists = false;
    let calendarMarked = false;
    const calendarColumnNames = [
      'Date',
      'Year',
      'Quarter',
      'Quarter No',
      'Month No',
      'Month Name',
      'Month Short',
      'Year Month',
      'Day',
      'Day Of Week',
      'Day Of Week No',
      'Is Weekend',
    ];
    const calendarColumnMetadata = new Map<string, Record<string, unknown>>(
      calendarColumnNames.map((name) => [name, { dataType: 'unknown' }]),
    );
    const snapshot = () => ({
      modelPath: '(live)',
      tables: [
        {
          name: 'Fact',
          columns: [
            {
              table: 'Fact',
              name: 'Date',
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
        ...(calendarExists
          ? [
              {
                name: 'Calendar',
                columns: calendarColumnNames.map((name) => {
                  const metadata = calendarColumnMetadata.get(name) ?? {};
                  return {
                    table: 'Calendar',
                    name,
                    dataType: typeof metadata.dataType === 'string' ? metadata.dataType : 'unknown',
                    isHidden: false,
                    isKey: name === 'Date' ? calendarMarked : false,
                    isCalculated: false,
                    ...(typeof metadata.summarizeBy === 'string'
                      ? { summarizeBy: metadata.summarizeBy }
                      : {}),
                    ...(calendarMarked && name === 'Date' ? { dataCategory: 'Time' } : {}),
                  };
                }),
                measures: [],
                isHidden: false,
                isCalculated: true,
                isAutoDateTable: false,
                ...(calendarMarked ? { dataCategory: 'Time' } : {}),
                expression: createdExpression,
              },
            ]
          : []),
      ],
      relationships: [],
    });
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot();
      },
      async refreshModel() {
        return { refreshed: true };
      },
      async createTable(definition: { expression?: string }) {
        createdExpression = definition.expression ?? '';
        calendarExists = true;
        return { created: true };
      },
      async updateColumn(definition: { name: string }) {
        calendarColumnMetadata.set(definition.name, {
          ...(calendarColumnMetadata.get(definition.name) ?? {}),
          ...definition,
        });
        return { updated: true };
      },
      async markAsDateTable() {
        calendarMarked = true;
        return { marked: true };
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 31,
                      '[nonBlankDateCount]': 31,
                      '[distinctDateCount]': 31,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-31T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Fact',
                      '[__column]': 'Date',
                      '[rowCount]': 1,
                      '[nonBlankDateCount]': 1,
                      '[distinctDateCount]': 1,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 0,
                      '[monthsWithMultipleDates]': 0,
                      '[maxDistinctDatesPerMonth]': 1,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-01T00:00:00',
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
        name: 'pbi_date_table_create_governed',
        arguments: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
          rangePolicy: 'observed-full-years-plus-future-horizon',
          futureHorizonDays: 30,
          refreshBeforeProbe: true,
          createRelationships: false,
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError, JSON.stringify(payload, null, 2)).not.toBe(true);
    expect(createdExpression).toContain('VAR __EndDate = __MaxDate + 30');
    expect(createdExpression).not.toContain('DATE(YEAR(__MaxDate + 30), 12, 31)');
  });

  it('refuses governed Date relationship creation when the fact date grain has no matching write plan', async () => {
    let calendarExists = false;
    let calendarMarked = false;
    let relationshipCreates = 0;
    const calendarColumnNames = [
      'Date',
      'Year',
      'Quarter',
      'Quarter No',
      'Month No',
      'Month Name',
      'Month Short',
      'Year Month',
      'Day',
      'Day Of Week',
      'Day Of Week No',
      'Is Weekend',
    ];
    const calendarColumnMetadata = new Map<string, Record<string, unknown>>(
      calendarColumnNames.map((name) => [name, { dataType: 'unknown' }]),
    );
    const snapshot = () => ({
      modelPath: '(live)',
      tables: [
        {
          name: 'Target',
          columns: [
            {
              table: 'Target',
              name: 'Date',
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
        ...(calendarExists
          ? [
              {
                name: 'Calendar',
                columns: calendarColumnNames.map((name) => {
                  const metadata = calendarColumnMetadata.get(name) ?? {};
                  return {
                    table: 'Calendar',
                    name,
                    dataType: typeof metadata.dataType === 'string' ? metadata.dataType : 'unknown',
                    isHidden: false,
                    isKey: name === 'Date' ? calendarMarked : false,
                    isCalculated: false,
                    ...(typeof metadata.summarizeBy === 'string'
                      ? { summarizeBy: metadata.summarizeBy }
                      : {}),
                    ...(calendarMarked && name === 'Date' ? { dataCategory: 'Time' } : {}),
                  };
                }),
                measures: [],
                isHidden: false,
                isCalculated: true,
                isAutoDateTable: false,
                ...(calendarMarked ? { dataCategory: 'Time' } : {}),
              },
            ]
          : []),
      ],
      relationships: [],
    });
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot();
      },
      async refreshModel() {
        return { refreshed: true };
      },
      async createTable() {
        calendarExists = true;
        return { created: true };
      },
      async updateColumn(definition: { name: string }) {
        calendarColumnMetadata.set(definition.name, {
          ...(calendarColumnMetadata.get(definition.name) ?? {}),
          ...definition,
        });
        return { updated: true };
      },
      async markAsDateTable() {
        calendarMarked = true;
        return { marked: true };
      },
      async createRelationship() {
        relationshipCreates += 1;
        return { created: true };
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 365,
                      '[nonBlankDateCount]': 365,
                      '[distinctDateCount]': 365,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-12-31T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Target',
                      '[__column]': 'Date',
                      '[rowCount]': 12,
                      '[nonBlankDateCount]': 12,
                      '[distinctDateCount]': 12,
                      '[distinctMonthStartCount]': 12,
                      '[nonMonthStartDateCount]': 0,
                      '[monthsWithMultipleDates]': 0,
                      '[maxDistinctDatesPerMonth]': 1,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 323,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-12-01T00:00:00',
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
        name: 'pbi_date_table_create_governed',
        arguments: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          facts: [{ tableName: 'Target', dateColumn: 'Date' }],
          rangePolicy: 'observed-full-years',
          refreshBeforeProbe: true,
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('governed-date-table-create');
    expect(payload.reason).toBe('date-grain-write-plan-blocked');
    expect(relationshipCreates).toBe(0);
  });

  it('refuses compound date table names through generic table create', async () => {
    let connected = false;
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        connected = true;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async createTable() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    for (const name of ['DateTable', 'CalendarTable', 'DimCalendar', 'DateDimension']) {
      const result = await withClient((client) =>
        client.callTool({
          name: 'pbi_table_create',
          arguments: {
            name,
            expression: "SELECTCOLUMNS('Source', \"Date\", 'Source'[Date])",
          },
        }),
      );

      const payload = jsonPayload(result);
      expect(result.isError).toBe(true);
      expect(payload.gate).toBe('date-table-create-gate');
      expect(payload.reason).toBe('date-table-create-requires-coverage-proof');
    }
    expect(connected).toBe(false);
    expect(created).toBe(false);
  });

  it('refuses volatile M date table creation before connecting to a model', async () => {
    let connected = false;
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        connected = true;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async createTable() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_create',
        arguments: {
          name: 'Calendar',
          mExpression:
            'let Source = List.Dates(#date(2020, 1, 1), Duration.Days(DateTime.LocalNow() - #date(2020, 1, 1)), #duration(1,0,0,0)) in Source',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('date-table-create-gate');
    expect(payload.reason).toBe('volatile-calendar-anchor');
    expect(connected).toBe(false);
    expect(created).toBe(false);
  });

  it('refuses literal M date table creation before connecting to a model', async () => {
    let connected = false;
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        connected = true;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async createTable() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_create',
        arguments: {
          name: 'Calendar',
          mExpression:
            'let Source = List.Dates(#date(2020, 1, 1), 366, #duration(1,0,0,0)) in Source',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('date-table-create-gate');
    expect(payload.reason).toBe('literal-calendar-range');
    expect(connected).toBe(false);
    expect(created).toBe(false);
  });

  it('refuses table create without exactly one source expression', async () => {
    let connected = false;
    setModelDriverForTests({
      async ensureConnection() {
        connected = true;
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_create',
        arguments: { name: 'No Source' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('tool-input-validation');
    expect(payload.reason).toBe('invalid-source-expression-count');
    expect(connected).toBe(false);
  });

  it('allows metadata-only measure update without requiring an expression', async () => {
    let updatedDefinition: unknown;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async updateMeasure(definition: unknown) {
        updatedDefinition = definition;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_measure_update',
        arguments: {
          tableName: 'Actual',
          name: 'Existing Measure',
          formatString: '#,0',
          description: 'Updated description',
          measureIntent: {
            measureName: 'Existing Measure',
            status: 'confirmed',
            owner: 'test',
            definition: 'Confirmed metadata-only update intent.',
            sourceRefs: [{ table: 'Actual', column: 'Date', kind: 'column', isHidden: false }],
            grain: 'day',
            additivity: 'non-additive',
            filters: [],
            format: '#,0',
            unit: 'units',
            caveats: [],
          },
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload.updated).toBe(true);
    expect(updatedDefinition).toMatchObject({
      tableName: 'Actual',
      name: 'Existing Measure',
      formatString: '#,0',
      description: 'Updated description',
    });
  });

  it('refuses live model export because Desktop persistence is Ctrl+S', async () => {
    let exported = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async exportToTmdlFolder() {
        exported = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_export',
        arguments: { folderPath: TRUTH_SEMANTIC_MODEL },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('live-mode-refused');
    expect(exported).toBe(false);
  });

  it('exports folder-mode models to the resolved folder path', async () => {
    let exportPath: string | undefined;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'folder', folderPath: '/resolved/Model.SemanticModel/definition' };
      },
      async exportToTmdlFolder(folderPath?: string) {
        exportPath = folderPath;
        return { ok: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_model_export',
        arguments: { folderPath: TRUTH_SEMANTIC_MODEL },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload).toMatchObject({
      exported: true,
      mode: 'folder',
      folderPath: '/resolved/Model.SemanticModel/definition',
      result: { ok: true },
    });
    expect(exportPath).toBe('/resolved/Model.SemanticModel/definition');
  });

  it('refuses direct table dataCategory Time writes that bypass mark-as-date coverage', async () => {
    let updated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveSnapshot();
      },
      async updateTable() {
        updated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_update',
        arguments: { name: 'Calendar', dataCategory: 'Time' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('direct-date-table-metadata-gate');
    expect(updated).toBe(false);
  });

  it('refuses direct column date-category writes that bypass mark-as-date coverage', async () => {
    let updated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveSnapshot();
      },
      async updateColumn() {
        updated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_column_update',
        arguments: { tableName: 'Calendar', name: 'Date', dataCategory: 'Time' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('direct-date-table-metadata-gate');
    expect(updated).toBe(false);
  });

  it('refuses direct column datatype writes that complete existing Date-table metadata', async () => {
    const snapshot = liveSnapshot();
    snapshot.tables = snapshot.tables.map((table) =>
      table.name === 'Calendar'
        ? {
            ...table,
            columns: table.columns.map((column) =>
              column.name === 'Date' ? { ...column, dataType: 'string', isKey: true } : column,
            ),
          }
        : table,
    );
    let updated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
      },
      async updateColumn() {
        updated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_column_update',
        arguments: { tableName: 'Calendar', name: 'Date', dataType: 'dateTime' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('direct-date-table-metadata-gate');
    expect(updated).toBe(false);
  });

  it('refuses direct expression updates on an existing governed Date key', async () => {
    let updated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveSnapshot();
      },
      async updateColumn() {
        updated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_column_update',
        arguments: {
          tableName: 'Calendar',
          name: 'Date',
          expression: 'TODAY()',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('direct-date-table-metadata-gate');
    expect(payload.reason).toBe('date-key-expression-update-refused');
    expect(updated).toBe(false);
  });

  it('refuses direct isKey writes on an existing time-category date column', async () => {
    const snapshot = liveSnapshot();
    snapshot.tables = snapshot.tables.map((table) =>
      table.name === 'Calendar'
        ? {
            ...table,
            dataCategory: undefined,
            columns: table.columns.map((column) =>
              column.name === 'Date' ? { ...column, dataCategory: 'Time', isKey: false } : column,
            ),
          }
        : table,
    );
    let updated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
      },
      async updateColumn() {
        updated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_column_update',
        arguments: { tableName: 'Calendar', name: 'Date', isKey: true },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('direct-date-table-metadata-gate');
    expect(updated).toBe(false);
  });

  it('refuses direct column create that would create a marked Date key', async () => {
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
      },
      async createColumn() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_column_create',
        arguments: {
          tableName: 'Calendar',
          name: 'Date Copy',
          dataType: 'dateTime',
          sourceColumn: 'Date Copy',
          isKey: true,
          dataCategory: 'Time',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('direct-date-table-metadata-gate');
    expect(created).toBe(false);
  });

  it('refuses activating a date relationship to an unmarked temporal endpoint', async () => {
    const snapshot = liveSnapshot();
    snapshot.tables = snapshot.tables.map((table) =>
      table.name === 'Calendar' ? { ...table, dataCategory: undefined } : table,
    );
    let probed = false;
    let activated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
      },
      async daxQuery() {
        probed = true;
        return { results: [] };
      },
      async activateRelationship() {
        activated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_activate',
        arguments: { id: 'Target_Date_Calendar_Date' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('date-endpoint-not-governed');
    expect(probed).toBe(false);
    expect(activated).toBe(false);
  });

  it('refuses activating a date relationship to an auto-date endpoint', async () => {
    const snapshot = liveSnapshot();
    snapshot.tables = snapshot.tables.map((table) =>
      table.name === 'LocalDateTable_1'
        ? {
            ...table,
            columns: [
              {
                table: 'LocalDateTable_1',
                name: 'Date',
                dataType: 'dateTime',
                isHidden: false,
                isKey: false,
                isCalculated: false,
              },
            ],
          }
        : table,
    );
    snapshot.relationships = [
      ...snapshot.relationships,
      {
        id: 'Target_Date_Local_Date',
        identityProven: true,
        fromTable: 'Target',
        fromColumn: 'Date',
        toTable: 'LocalDateTable_1',
        toColumn: 'Date',
        isActive: false,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      },
    ];
    let probed = false;
    let activated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
      },
      async daxQuery() {
        probed = true;
        return { results: [] };
      },
      async activateRelationship() {
        activated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_activate',
        arguments: { id: 'Target_Date_Local_Date' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('date-endpoint-not-governed');
    expect(probed).toBe(false);
    expect(activated).toBe(false);
  });

  it('requires live proof before inactive temporal relationship creation', async () => {
    const snapshot = liveSnapshot();
    snapshot.tables = [
      ...snapshot.tables,
      {
        name: 'Forecast',
        columns: [
          {
            table: 'Forecast',
            name: 'Date',
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
    ];
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
      },
      async createRelationship() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_create',
        arguments: {
          fromTable: 'Forecast',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: false,
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('probe-failed');
    expect(created).toBe(false);
  });

  it('creates inactive role-playing Date relationships after live proof succeeds', async () => {
    const snapshot = {
      modelPath: '(live)',
      tables: [
        {
          name: 'Forecast',
          columns: [
            {
              table: 'Forecast',
              name: 'Date',
              dataType: 'dateTime',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
            {
              table: 'Forecast',
              name: 'Amount',
              dataType: 'decimal',
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
        {
          name: 'Calendar',
          columns: [
            {
              table: 'Calendar',
              name: 'Date',
              dataType: 'dateTime',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
          ],
          measures: [],
          isHidden: false,
          isCalculated: true,
          isAutoDateTable: false,
          dataCategory: 'Time',
          partitionSources: [
            {
              kind: 'calculated',
              expression:
                "CALENDAR(MINX('Forecast', 'Forecast'[Date]), MAXX('Forecast', 'Forecast'[Date]))",
            },
          ],
        },
      ],
      relationships: [],
    };
    let createdDefinition: unknown;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 59,
                      '[nonBlankDateCount]': 59,
                      '[distinctDateCount]': 59,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-02-28T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Forecast',
                      '[__column]': 'Date',
                      '[rowCount]': 45,
                      '[nonBlankDateCount]': 45,
                      '[distinctDateCount]': 40,
                      '[distinctMonthStartCount]': 2,
                      '[nonMonthStartDateCount]': 43,
                      '[monthsWithMultipleDates]': 2,
                      '[maxDistinctDatesPerMonth]': 21,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 5,
                      '[gapCount]': 19,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-02-28T00:00:00',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
      async createRelationship(definition: unknown) {
        createdDefinition = definition;
        return { created: true };
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_create',
        arguments: {
          fromTable: 'Forecast',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: false,
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError, JSON.stringify(payload, null, 2)).not.toBe(true);
    expect(payload.created).toBe(true);
    expect(createdDefinition).toMatchObject({
      fromTable: 'Forecast',
      fromColumn: 'Date',
      toTable: 'Calendar',
      toColumn: 'Date',
      isActive: false,
    });
  });

  it('refuses bidirectional active date relationship creation before live proof', async () => {
    const snapshot = liveSnapshot();
    snapshot.tables = [
      ...snapshot.tables,
      {
        name: 'Forecast',
        columns: [
          {
            table: 'Forecast',
            name: 'Date',
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
    ];
    let probed = false;
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
      },
      async daxQuery() {
        probed = true;
        return { results: [] };
      },
      async createRelationship() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_create',
        arguments: {
          fromTable: 'Forecast',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          crossFilteringBehavior: 'both',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('unsupported-cross-filter');
    expect(probed).toBe(false);
    expect(created).toBe(false);
  });

  it('refuses active date relationship creation when live proof is incomplete', async () => {
    const snapshot = liveSnapshot();
    snapshot.tables = [
      ...snapshot.tables,
      {
        name: 'Forecast',
        columns: [
          {
            table: 'Forecast',
            name: 'Date',
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
    ];
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
      },
      async daxQuery() {
        return { results: [{ tables: [{ rows: [] }] }] };
      },
      async createRelationship() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_create',
        arguments: {
          fromTable: 'Forecast',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('proof-parse-shape-unrecognized');
    expect(payload.code).toBe('proof-parse-shape-unrecognized');
    expect(payload.probeDiagnostics).toMatchObject({ rowCount: 0 });
    expectDateProofParseShapeStopGuidance(payload);
    expect(created).toBe(false);
  });

  it('refuses direct relationship creation between fact-like tables', async () => {
    let created = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return {
          modelPath: '(live)',
          tables: [
            {
              name: 'FactPrimary',
              columns: [
                {
                  table: 'FactPrimary',
                  name: 'SharedKey',
                  dataType: 'int64',
                  isHidden: false,
                  isKey: false,
                  isCalculated: false,
                  summarizeBy: 'none',
                },
                {
                  table: 'FactPrimary',
                  name: 'Amount',
                  dataType: 'decimal',
                  isHidden: false,
                  isKey: false,
                  isCalculated: false,
                  summarizeBy: 'sum',
                },
              ],
              measures: [
                {
                  table: 'FactPrimary',
                  name: 'Primary Amount',
                  expression: 'SUM(FactPrimary[Amount])',
                  isHidden: false,
                  annotations: {},
                },
              ],
              isHidden: false,
              isCalculated: false,
              isAutoDateTable: false,
            },
            {
              name: 'FactSecondary',
              columns: [
                {
                  table: 'FactSecondary',
                  name: 'SharedKey',
                  dataType: 'int64',
                  isHidden: false,
                  isKey: false,
                  isCalculated: false,
                  summarizeBy: 'none',
                },
                {
                  table: 'FactSecondary',
                  name: 'Amount',
                  dataType: 'decimal',
                  isHidden: false,
                  isKey: false,
                  isCalculated: false,
                  summarizeBy: 'sum',
                },
              ],
              measures: [
                {
                  table: 'FactSecondary',
                  name: 'Secondary Amount',
                  expression: 'SUM(FactSecondary[Amount])',
                  isHidden: false,
                  annotations: {},
                },
              ],
              isHidden: false,
              isCalculated: false,
              isAutoDateTable: false,
            },
          ],
          relationships: [],
        };
      },
      async createRelationship() {
        created = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_create',
        arguments: {
          fromTable: 'FactPrimary',
          fromColumn: 'SharedKey',
          toTable: 'FactSecondary',
          toColumn: 'SharedKey',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('relationship-check');
    expect((payload.blocking as Record<string, unknown>[]).map((b) => b.code)).toContain(
      'direct-fact-to-fact',
    );
    expect(created).toBe(false);
  });

  it('refuses activating an inactive direct relationship between fact-like tables', async () => {
    let activated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return {
          modelPath: '(live)',
          tables: [
            {
              name: 'FactPrimary',
              columns: [
                {
                  table: 'FactPrimary',
                  name: 'SharedKey',
                  dataType: 'int64',
                  isHidden: false,
                  isKey: false,
                  isCalculated: false,
                  summarizeBy: 'none',
                },
                {
                  table: 'FactPrimary',
                  name: 'Amount',
                  dataType: 'decimal',
                  isHidden: false,
                  isKey: false,
                  isCalculated: false,
                  summarizeBy: 'sum',
                },
              ],
              measures: [
                {
                  table: 'FactPrimary',
                  name: 'Primary Amount',
                  expression: 'SUM(FactPrimary[Amount])',
                  isHidden: false,
                  annotations: {},
                },
              ],
              isHidden: false,
              isCalculated: false,
              isAutoDateTable: false,
            },
            {
              name: 'FactSecondary',
              columns: [
                {
                  table: 'FactSecondary',
                  name: 'SharedKey',
                  dataType: 'int64',
                  isHidden: false,
                  isKey: false,
                  isCalculated: false,
                  summarizeBy: 'none',
                },
                {
                  table: 'FactSecondary',
                  name: 'Amount',
                  dataType: 'decimal',
                  isHidden: false,
                  isKey: false,
                  isCalculated: false,
                  summarizeBy: 'sum',
                },
              ],
              measures: [
                {
                  table: 'FactSecondary',
                  name: 'Secondary Amount',
                  expression: 'SUM(FactSecondary[Amount])',
                  isHidden: false,
                  annotations: {},
                },
              ],
              isHidden: false,
              isCalculated: false,
              isAutoDateTable: false,
            },
          ],
          relationships: [
            {
              id: 'inactive-fact-link',
              fromTable: 'FactPrimary',
              fromColumn: 'SharedKey',
              toTable: 'FactSecondary',
              toColumn: 'SharedKey',
              isActive: false,
              crossFilteringBehavior: 'single',
              cardinality: 'manyToOne',
              identityProven: true,
            },
          ],
        };
      },
      async activateRelationship() {
        activated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_activate',
        arguments: { id: 'inactive-fact-link' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('relationship-check');
    expect((payload.blocking as Record<string, unknown>[]).map((b) => b.code)).toContain(
      'direct-fact-to-fact',
    );
    expect(activated).toBe(false);
  });

  it('refuses changing an active date relationship to bidirectional', async () => {
    let updated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveSnapshot();
      },
      async updateRelationship() {
        updated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_update',
        arguments: {
          id: 'Actual_Date_Calendar_Date',
          crossFilteringBehavior: 'both',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('unsupported-cross-filter');
    expect(updated).toBe(false);
  });

  it('refuses relationship update when the id is missing from the snapshot', async () => {
    let updated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveSnapshot();
      },
      async updateRelationship() {
        updated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_update',
        arguments: { id: 'missing-relationship', crossFilteringBehavior: 'single' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('relationship-not-found');
    expect(updated).toBe(false);
  });

  it('refuses relationship update that re-points to an active date endpoint without proof', async () => {
    const snapshot = liveSnapshot();
    snapshot.tables = [
      ...snapshot.tables,
      {
        name: 'Lookup',
        columns: [
          {
            table: 'Lookup',
            name: 'Code',
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
    ];
    snapshot.tables = snapshot.tables.map((table) =>
      table.name === 'Target'
        ? {
            ...table,
            columns: [
              ...table.columns,
              {
                table: 'Target',
                name: 'Code',
                dataType: 'string',
                isHidden: false,
                isKey: false,
                isCalculated: false,
              },
            ],
          }
        : table,
    );
    snapshot.relationships = [
      ...snapshot.relationships,
      {
        id: 'Target_Code_Lookup_Code',
        identityProven: true,
        fromTable: 'Target',
        fromColumn: 'Code',
        toTable: 'Lookup',
        toColumn: 'Code',
        isActive: true,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      },
    ];
    let updated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
      },
      async daxQuery() {
        return { results: [{ tables: [{ rows: [] }] }] };
      },
      async updateRelationship() {
        updated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_update',
        arguments: {
          id: 'Target_Code_Lookup_Code',
          fromTable: 'Target',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('proof-parse-shape-unrecognized');
    expect(payload.code).toBe('proof-parse-shape-unrecognized');
    expect(payload.probeDiagnostics).toMatchObject({ rowCount: 0 });
    expectDateProofParseShapeStopGuidance(payload);
    expect(updated).toBe(false);
  });

  it('refuses relationship activation when the id is missing from the snapshot', async () => {
    let activated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveSnapshot();
      },
      async activateRelationship() {
        activated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_activate',
        arguments: { id: 'missing-relationship' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('relationship-not-found');
    expect(activated).toBe(false);
  });

  it('refuses relationship activation when the snapshot id is synthetic', async () => {
    let activated = false;
    const snapshot = liveSnapshot();
    snapshot.relationships = snapshot.relationships.map((relationship) =>
      relationship.id === 'Target_Date_Calendar_Date'
        ? { ...relationship, id: 'rel_0', identityProven: false }
        : relationship,
    );
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
      },
      async activateRelationship() {
        activated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_activate',
        arguments: { id: 'rel_0' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('relationship-id-missing');
    expect(activated).toBe(false);
  });

  it('refuses relationship update when the snapshot id is synthetic', async () => {
    let updated = false;
    const snapshot = liveSnapshot();
    snapshot.relationships = snapshot.relationships.map((relationship) =>
      relationship.id === 'Target_Date_Calendar_Date'
        ? { ...relationship, id: 'rel_0', identityProven: false }
        : relationship,
    );
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot;
      },
      async updateRelationship() {
        updated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_update',
        arguments: { id: 'rel_0', crossFilteringBehavior: 'single' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('relationship-id-missing');
    expect(updated).toBe(false);
  });

  it('refuses relationship deactivation when the snapshot id is synthetic', async () => {
    let deactivated = false;
    const snapshot = liveSnapshot();
    snapshot.relationships = snapshot.relationships.map((relationship) =>
      relationship.id === 'Actual_Date_Calendar_Date'
        ? { ...relationship, id: 'rel_0', identityProven: false }
        : relationship,
    );
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot;
      },
      async deactivateRelationship() {
        deactivated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_deactivate',
        arguments: { id: 'rel_0' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('relationship-id-missing');
    expect(deactivated).toBe(false);
  });

  it('refuses relationship delete when the snapshot id is synthetic', async () => {
    let deleted = false;
    const snapshot = liveSnapshot();
    snapshot.relationships = snapshot.relationships.map((relationship) =>
      relationship.id === 'Actual_Date_Calendar_Date'
        ? { ...relationship, id: 'rel_0', identityProven: false }
        : relationship,
    );
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return snapshot;
      },
      async deleteRelationship() {
        deleted = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_delete',
        arguments: { id: 'rel_0' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('relationship-id-missing');
    expect(deleted).toBe(false);
  });

  it('refuses mark-as-date when the Date table has a volatile calendar anchor', async () => {
    const snapshot = liveSnapshot();
    snapshot.tables = snapshot.tables.map((table) =>
      table.name === 'Calendar'
        ? {
            ...table,
            expression: 'CALENDAR(DATE(2017,1,1), DATE(YEAR(TODAY()) + 1, 12, 31))',
          }
        : table,
    );
    let marked = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 1431,
                      '[nonBlankDateCount]': 1431,
                      '[distinctDateCount]': 1431,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2017-01-01T00:00:00',
                      '[maxDate]': '2020-12-01T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Actual',
                      '[__column]': 'Date',
                      '[minDate]': '2017-01-03T00:00:00',
                      '[maxDate]': '2020-12-30T00:00:00',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
      async markAsDateTable() {
        marked = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_mark_as_date',
        arguments: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          facts: [{ tableName: 'Actual', dateColumn: 'Date' }],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('mark-as-date-table-gate');
    expect(
      ((payload.blockers as Record<string, unknown>[]) ?? []).map((blocker) => blocker.code),
    ).toContain('volatile-calendar-anchor');
    expect(marked).toBe(false);
  });

  it('refuses mark-as-date when any model-derived fact date proof is missing', async () => {
    let marked = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveSnapshot();
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 30,
                      '[nonBlankDateCount]': 30,
                      '[distinctDateCount]': 30,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-30T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Target',
                      '[__column]': 'Date',
                      '[rowCount]': 30,
                      '[nonBlankDateCount]': 30,
                      '[distinctDateCount]': 30,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 29,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 30,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-30T00:00:00',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
      async markAsDateTable() {
        marked = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_mark_as_date',
        arguments: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          facts: [{ tableName: 'Target', dateColumn: 'Date' }],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.gate).toBe('mark-as-date-table-gate');
    expect(
      ((payload.blockers as Record<string, unknown>[]) ?? []).map((blocker) => blocker.code),
    ).toContain('fact-date-proof-missing');
    expect(marked).toBe(false);
  });

  it('returns structured mark-as-date probe failures instead of raw driver errors', async () => {
    let marked = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveSnapshot();
      },
      async daxQuery() {
        throw new Error('probe transport failed');
      },
      async markAsDateTable() {
        marked = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_mark_as_date',
        arguments: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          facts: [{ tableName: 'Target', dateColumn: 'Date' }],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      gate: 'mark-as-date-table-gate',
      status: 'blocked',
      reason: 'probe-failed',
      error: 'probe transport failed',
    });
    expect(marked).toBe(false);
  });

  it('refuses mark-as-date when post-write snapshot does not show the table as marked', async () => {
    const snapshot = liveSnapshot();
    snapshot.tables = snapshot.tables.map((table) =>
      table.name === 'Calendar'
        ? {
            ...table,
            dataCategory: undefined,
            columns: table.columns.map((column) =>
              column.name === 'Date'
                ? { ...column, isKey: false, dataCategory: undefined }
                : column,
            ),
          }
        : table,
    );
    let marked = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 366,
                      '[nonBlankDateCount]': 366,
                      '[distinctDateCount]': 366,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2020-01-01T00:00:00',
                      '[maxDate]': '2020-12-31T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Target',
                      '[__column]': 'Date',
                      '[rowCount]': 366,
                      '[nonBlankDateCount]': 366,
                      '[distinctDateCount]': 366,
                      '[distinctMonthStartCount]': 12,
                      '[nonMonthStartDateCount]': 354,
                      '[monthsWithMultipleDates]': 12,
                      '[maxDistinctDatesPerMonth]': 31,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2020-01-01T00:00:00',
                      '[maxDate]': '2020-12-31T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Actual',
                      '[__column]': 'Date',
                      '[rowCount]': 366,
                      '[nonBlankDateCount]': 366,
                      '[distinctDateCount]': 366,
                      '[distinctMonthStartCount]': 12,
                      '[nonMonthStartDateCount]': 354,
                      '[monthsWithMultipleDates]': 12,
                      '[maxDistinctDatesPerMonth]': 31,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2020-01-01T00:00:00',
                      '[maxDate]': '2020-12-31T00:00:00',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
      async markAsDateTable() {
        marked = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_table_mark_as_date',
        arguments: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          facts: [{ tableName: 'Actual', dateColumn: 'Date' }],
        },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ reason: 'post-write-verification-failed' });
    expect(marked).toBe(true);
  });

  it('allows date relationship activation with governed endpoint, valid coverage, and daily proof', async () => {
    let activated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getModelSnapshot() {
        return liveSnapshot();
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 30,
                      '[nonBlankDateCount]': 30,
                      '[distinctDateCount]': 30,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-30T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Actual',
                      '[__column]': 'Date',
                      '[rowCount]': 30,
                      '[nonBlankDateCount]': 30,
                      '[distinctDateCount]': 30,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 29,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 30,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-30T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Target',
                      '[__column]': 'Date',
                      '[rowCount]': 30,
                      '[nonBlankDateCount]': 30,
                      '[distinctDateCount]': 30,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 29,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 30,
                      '[nonMidnightTimeCount]': 0,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[minDate]': '2025-01-01T00:00:00',
                      '[maxDate]': '2025-01-30T00:00:00',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
      async activateRelationship() {
        activated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_activate',
        arguments: { id: 'Target_Date_Calendar_Date' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).not.toBe(true);
    expect(payload.updated).toBe(true);
    expect(activated).toBe(true);
  });

  it('refuses date relationship activation when Date-table coverage is blocked', async () => {
    let activated = false;
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return liveSnapshot();
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 366,
                      '[nonBlankDateCount]': 366,
                      '[distinctDateCount]': 366,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2020-01-01T00:00:00',
                      '[maxDate]': '2020-12-31T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Target',
                      '[__column]': 'Date',
                      '[rowCount]': 100,
                      '[nonBlankDateCount]': 100,
                      '[distinctDateCount]': 90,
                      '[distinctMonthStartCount]': 12,
                      '[nonMonthStartDateCount]': 78,
                      '[monthsWithMultipleDates]': 12,
                      '[maxDistinctDatesPerMonth]': 12,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 10,
                      '[gapCount]': 1361,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2017-01-03T00:00:00',
                      '[maxDate]': '2020-12-30T00:00:00',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
      async activateRelationship() {
        activated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_activate',
        arguments: { id: 'Target_Date_Calendar_Date' },
      }),
    );

    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('date-table-coverage-blocked');
    const coverage = payload.coverage as Record<string, unknown>;
    expect(((coverage.blockers as Record<string, unknown>[]) ?? []).map((b) => b.code)).toContain(
      'fact-date-proof-missing',
    );
    expect(activated).toBe(false);
  });

  it('refuses date relationship activation when live proof is not daily grain', async () => {
    process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
    let activated = false;
    const snapshot = liveSnapshot();
    setModelDriverForTests({
      async ensureConnection() {
        return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
      },
      async getCachedSnapshot() {
        return snapshot;
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
                      '[__table]': 'Calendar',
                      '[__column]': 'Date',
                      '[rowCount]': 1431,
                      '[nonBlankDateCount]': 1431,
                      '[distinctDateCount]': 1431,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2017-01-01T00:00:00',
                      '[maxDate]': '2020-12-01T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Actual',
                      '[__column]': 'Date',
                      '[rowCount]': 30,
                      '[nonBlankDateCount]': 30,
                      '[distinctDateCount]': 30,
                      '[distinctMonthStartCount]': 1,
                      '[nonMonthStartDateCount]': 29,
                      '[monthsWithMultipleDates]': 1,
                      '[maxDistinctDatesPerMonth]': 30,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 0,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2017-01-01T00:00:00',
                      '[maxDate]': '2020-12-01T00:00:00',
                    },
                    {
                      '[__kind]': 'fact',
                      '[__table]': 'Target',
                      '[__column]': 'Date',
                      '[rowCount]': 12,
                      '[nonBlankDateCount]': 12,
                      '[distinctDateCount]': 12,
                      '[distinctMonthStartCount]': 12,
                      '[nonMonthStartDateCount]': 0,
                      '[monthsWithMultipleDates]': 0,
                      '[maxDistinctDatesPerMonth]': 1,
                      '[blankDateCount]': 0,
                      '[duplicateDateCount]': 0,
                      '[gapCount]': 1419,
                      '[nonMidnightTimeCount]': 0,
                      '[minDate]': '2017-01-01T00:00:00',
                      '[maxDate]': '2020-12-01T00:00:00',
                    },
                  ],
                },
              ],
            },
          ],
        };
      },
      async activateRelationship() {
        activated = true;
        return {};
      },
    } as unknown as Parameters<typeof setModelDriverForTests>[0]);

    const result = await withClient((client) =>
      client.callTool({
        name: 'pbi_relationship_activate',
        arguments: { id: 'Target_Date_Calendar_Date' },
      }),
    );
    const payload = jsonPayload(result);
    expect(result.isError).toBe(true);
    expect(payload.error).toMatch(/Date relationship write refused/);
    expect(payload.gate).toBe('date-grain-write-gate');
    expect(payload.observedGrain).toBe('month-start');
    expect(activated).toBe(false);
  });
});
