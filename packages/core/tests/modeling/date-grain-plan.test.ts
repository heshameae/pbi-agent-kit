import { describe, expect, it } from 'vitest';
import {
  buildDateGrainProbeQuery,
  buildDateTableCoverageProbeQuery,
  classifyObservedDateGrain,
  deriveRequiredDateCoverageFacts,
  findCalendarSourceRisks,
  isDataProvenDailyKey,
  parseDateGrainProbeResult,
  parseDateTableCoverageProbeResult,
  planDateGrain,
  planDateTableCoverage,
  readGovernedDatePolicy,
} from '../../src/modeling/date-grain-plan.js';
import type {
  TMDLColumn,
  TMDLMeasure,
  TMDLModel,
  TMDLRelationship,
  TMDLTable,
} from '../../src/modeling/types.js';

function col(
  table: string,
  name: string,
  dataType: string,
  overrides: Partial<TMDLColumn> = {},
): TMDLColumn {
  return {
    table,
    name,
    dataType,
    isHidden: false,
    isKey: false,
    isCalculated: false,
    ...overrides,
  };
}

function measure(table: string, name: string, expression: string): TMDLMeasure {
  return {
    table,
    name,
    expression,
    isHidden: false,
    annotations: {},
  };
}

function tbl(
  name: string,
  columns: TMDLColumn[] = [],
  measures: TMDLMeasure[] = [],
  overrides: Partial<TMDLTable> = {},
): TMDLTable {
  return {
    name,
    columns,
    measures,
    isHidden: false,
    isCalculated: false,
    isAutoDateTable: false,
    ...overrides,
  };
}

function model(tables: TMDLTable[], relationships: TMDLRelationship[] = []): TMDLModel {
  return {
    modelPath: '/',
    tables,
    relationships: relationships.map((relationship) =>
      relationship.identityProven === undefined
        ? { ...relationship, identityProven: true }
        : relationship,
    ),
  };
}

const relationship: TMDLRelationship = {
  id: 'Forecast_Date_Calendar_Date',
  fromTable: 'Forecast',
  fromColumn: 'Forecast Date',
  toTable: 'Calendar',
  toColumn: 'Date',
  isActive: false,
  crossFilteringBehavior: 'single',
  cardinality: 'manyToOne',
};

describe('date grain planner', () => {
  it('builds one batched read-only DAX probe for multiple temporal fact date columns', () => {
    const m = model([
      tbl('Actual', [col('Actual', 'Event Date', 'dateTime')]),
      tbl('Forecast', [col('Forecast', 'Forecast Date', 'date')]),
    ]);

    const query = buildDateGrainProbeQuery(m, [
      { tableName: 'Actual', dateColumn: 'Event Date' },
      { tableName: 'Forecast', dateColumn: 'Forecast Date' },
    ]);

    expect(query).toContain('EVALUATE');
    expect(query).toContain('UNION(');
    expect(query).toContain("'Actual'[Event Date]");
    expect(query).toContain("'Forecast'[Forecast Date]");
    expect(query).toContain('distinctMonthStartCount');
    expect(query).toContain('nonMidnightTimeCount');
    expect(query).toMatch(/"gapCount",[\s\S]+,\n\s+"minDate"/);
  });

  it('accepts live PascalCase temporal and numeric metadata', () => {
    const m = model([
      tbl('Actual', [
        col('Actual', 'Event Date', 'DateTime'),
        col('Actual', 'Amount', 'Decimal', { summarizeBy: 'Sum' }),
      ]),
    ]);

    const result = planDateGrain(
      m,
      { facts: [{ tableName: 'Actual', dateColumn: 'Event Date' }] },
      [
        {
          tableName: 'Actual',
          dateColumn: 'Event Date',
          rowCount: 1,
          nonBlankDateCount: 1,
          distinctDateCount: 1,
          distinctMonthStartCount: 1,
          nonMonthStartDateCount: 0,
          monthsWithMultipleDates: 0,
          maxDistinctDatesPerMonth: 1,
        },
      ],
    );

    expect(result.blockers.map((blocker) => blocker.code)).not.toContain(
      'date-column-not-temporal',
    );
    expect(result.facts[0]?.metadata.dateCompatible).toBe(true);
  });

  it('classifies non-month-start fact dates as day grain and allows plain additive measures', () => {
    const m = model(
      [
        tbl('Forecast', [
          col('Forecast', 'Forecast Date', 'dateTime'),
          col('Forecast', 'Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [relationship],
    );

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
        dateTableCoverageEvidence: {
          dateTable: {
            tableName: 'Calendar',
            dateColumn: 'Date',
            rowCount: 59,
            nonBlankDateCount: 59,
            distinctDateCount: 59,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 0,
            nonMidnightTimeCount: 0,
            minDate: '2025-01-01T00:00:00',
            maxDate: '2025-02-28T00:00:00',
          },
          facts: [
            {
              tableName: 'Forecast',
              dateColumn: 'Forecast Date',
              rowCount: 59,
              nonBlankDateCount: 59,
              distinctDateCount: 59,
              distinctMonthStartCount: 2,
              nonMonthStartDateCount: 57,
              monthsWithMultipleDates: 2,
              maxDistinctDatesPerMonth: 31,
              blankDateCount: 0,
              duplicateDateCount: 0,
              gapCount: 0,
              nonMidnightTimeCount: 0,
              minDate: '2025-01-01T00:00:00',
              maxDate: '2025-02-28T00:00:00',
            },
          ],
        },
      },
      [
        {
          tableName: 'Forecast',
          dateColumn: 'Forecast Date',
          rowCount: 59,
          nonBlankDateCount: 59,
          distinctDateCount: 59,
          distinctMonthStartCount: 2,
          nonMonthStartDateCount: 57,
          monthsWithMultipleDates: 2,
          maxDistinctDatesPerMonth: 31,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-02-28T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.observedGrain).toBe('day');
    expect(result.facts[0]?.measureGuidance.plainSumSafe).toBe(true);
    expect(result.facts[0]?.measureGuidance.safeVisualDateGrain).toBe('day-or-above');
    expect(result.facts[0]?.writePlan).toEqual([
      {
        action: 'activate-date-relationship',
        id: 'Forecast_Date_Calendar_Date',
        description:
          'Observed day-level date values support activating the existing date relationship.',
      },
    ]);
  });

  it('emits the date-relationship write plan for an UNMARKED but data-proven Date table (Import no-op decoupling)', () => {
    // H-C: the dataCategory="Time" mark silently no-ops on Import, so the gate's outer
    // layers were decoupled to key off the data-proven key. buildWritePlan must agree:
    // an unmarked (no dataCategory) Date table whose key is proven from data must still
    // produce the activate/create write plan, or the active relationship deadlocks.
    const m = model(
      [
        tbl('Forecast', [
          col('Forecast', 'Forecast Date', 'dateTime'),
          col('Forecast', 'Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        // No dataCategory:'Time' and isKey:false — proven ONLY by the live probe below.
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime')]),
      ],
      [relationship],
    );
    const cleanDaily = {
      rowCount: 59,
      nonBlankDateCount: 59,
      distinctDateCount: 59,
      blankDateCount: 0,
      duplicateDateCount: 0,
      gapCount: 0,
      nonMidnightTimeCount: 0,
      minDate: '2025-01-01T00:00:00',
      maxDate: '2025-02-28T00:00:00',
    };
    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
        dateTableCoverageEvidence: {
          dateTable: { tableName: 'Calendar', dateColumn: 'Date', ...cleanDaily },
          facts: [
            {
              tableName: 'Forecast',
              dateColumn: 'Forecast Date',
              distinctMonthStartCount: 2,
              nonMonthStartDateCount: 57,
              monthsWithMultipleDates: 2,
              maxDistinctDatesPerMonth: 31,
              ...cleanDaily,
            },
          ],
        },
      },
      [
        {
          tableName: 'Forecast',
          dateColumn: 'Forecast Date',
          distinctMonthStartCount: 2,
          nonMonthStartDateCount: 57,
          monthsWithMultipleDates: 2,
          maxDistinctDatesPerMonth: 31,
          ...cleanDaily,
        },
      ],
    );

    // The key is proven from data even though the table is unmarked...
    expect(result.dateTableCoverage?.dateTable.keyProvenFromData).toBe(true);
    expect(result.dateTableCoverage?.dateTable.isMarkedDateTable).toBe(false);
    // ...so the write plan is still produced (not deadlocked on the missing mark).
    expect(result.facts[0]?.writePlan).toEqual([
      {
        action: 'activate-date-relationship',
        id: 'Forecast_Date_Calendar_Date',
        description:
          'Observed day-level date values support activating the existing date relationship.',
      },
    ]);
  });

  it('does not treat DateTime day-grain evidence as exact proof when time-component proof is missing', () => {
    const m = model(
      [
        tbl('Forecast', [
          col('Forecast', 'Forecast Date', 'dateTime'),
          col('Forecast', 'Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [relationship],
    );

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
        dateTableCoverageEvidence: {
          dateTable: {
            tableName: 'Calendar',
            dateColumn: 'Date',
            rowCount: 59,
            nonBlankDateCount: 59,
            distinctDateCount: 59,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 0,
            nonMidnightTimeCount: 0,
            minDate: '2025-01-01T00:00:00',
            maxDate: '2025-02-28T00:00:00',
          },
          facts: [
            {
              tableName: 'Forecast',
              dateColumn: 'Forecast Date',
              rowCount: 59,
              nonBlankDateCount: 59,
              distinctDateCount: 59,
              distinctMonthStartCount: 2,
              nonMonthStartDateCount: 57,
              monthsWithMultipleDates: 2,
              maxDistinctDatesPerMonth: 31,
              blankDateCount: 0,
              duplicateDateCount: 0,
              gapCount: 0,
              minDate: '2025-01-01T00:00:00',
              maxDate: '2025-02-28T00:00:00',
            },
          ],
        },
      },
      [
        {
          tableName: 'Forecast',
          dateColumn: 'Forecast Date',
          rowCount: 59,
          nonBlankDateCount: 59,
          distinctDateCount: 59,
          distinctMonthStartCount: 2,
          nonMonthStartDateCount: 57,
          monthsWithMultipleDates: 2,
          maxDistinctDatesPerMonth: 31,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-02-28T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.measureGuidance.plainSumSafe).toBe(false);
    expect(result.facts[0]?.writePlan).toEqual([]);
  });

  it('allows sparse day-level facts on day visuals and plain additive measures', () => {
    const m = model([
      tbl('Forecast', [
        col('Forecast', 'Forecast Date', 'dateTime'),
        col('Forecast', 'Amount', 'decimal', { summarizeBy: 'sum' }),
      ]),
    ]);

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
      },
      [
        {
          tableName: 'Forecast',
          dateColumn: 'Forecast Date',
          rowCount: 10,
          nonBlankDateCount: 10,
          distinctDateCount: 10,
          distinctMonthStartCount: 1,
          nonMonthStartDateCount: 9,
          monthsWithMultipleDates: 1,
          maxDistinctDatesPerMonth: 10,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 1,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-10T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.observedGrain).toBe('day');
    expect(result.facts[0]?.measureGuidance.plainSumSafe).toBe(true);
    expect(result.facts[0]?.measureGuidance.safeVisualDateGrain).toBe('day-or-above');
    expect(result.facts[0]?.writePlan).toEqual([]);
  });

  it('treats observed day grain as descriptive when DateTime keys include non-midnight times', () => {
    const m = model(
      [
        tbl('Forecast', [
          col('Forecast', 'Forecast Date', 'dateTime'),
          col('Forecast', 'Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [relationship],
    );

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
        dateTableCoverageEvidence: {
          dateTable: {
            tableName: 'Calendar',
            dateColumn: 'Date',
            rowCount: 31,
            nonBlankDateCount: 31,
            distinctDateCount: 31,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 0,
            nonMidnightTimeCount: 0,
            minDate: '2025-01-01T00:00:00',
            maxDate: '2025-01-31T00:00:00',
          },
          facts: [
            {
              tableName: 'Forecast',
              dateColumn: 'Forecast Date',
              rowCount: 31,
              nonBlankDateCount: 31,
              distinctDateCount: 31,
              distinctMonthStartCount: 1,
              nonMonthStartDateCount: 30,
              monthsWithMultipleDates: 1,
              maxDistinctDatesPerMonth: 31,
              blankDateCount: 0,
              duplicateDateCount: 0,
              gapCount: 0,
              nonMidnightTimeCount: 1,
              minDate: '2025-01-01T00:00:00',
              maxDate: '2025-01-31T13:15:00',
            },
          ],
        },
      },
      [
        {
          tableName: 'Forecast',
          dateColumn: 'Forecast Date',
          rowCount: 31,
          nonBlankDateCount: 31,
          distinctDateCount: 31,
          distinctMonthStartCount: 1,
          nonMonthStartDateCount: 30,
          monthsWithMultipleDates: 1,
          maxDistinctDatesPerMonth: 31,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          nonMidnightTimeCount: 1,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-31T13:15:00',
        },
      ],
    );

    expect(result.facts[0]?.observedGrain).toBe('day');
    expect(result.facts[0]?.measureGuidance.plainSumSafe).toBe(false);
    expect(result.facts[0]?.measureGuidance.safeVisualDateGrain).toBe('unknown');
    expect(result.facts[0]?.writePlan).toEqual([]);
    expect(result.dateTableCoverage?.blockers).toContainEqual(
      expect.objectContaining({
        code: 'fact-date-has-time-component',
        factTable: 'Forecast',
        factColumn: 'Forecast Date',
      }),
    );
  });

  it('classifies month-start-only fact dates separately and blocks daily-grain simplification', () => {
    const m = model(
      [
        tbl('Plan', [col('Plan', 'Plan Date', 'dateTime')]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [
        {
          ...relationship,
          id: 'Plan_Date_Calendar_Date',
          fromTable: 'Plan',
          fromColumn: 'Plan Date',
        },
      ],
    );

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Plan', dateColumn: 'Plan Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
      },
      [
        {
          tableName: 'Plan',
          dateColumn: 'Plan Date',
          rowCount: 12,
          nonBlankDateCount: 12,
          distinctDateCount: 12,
          distinctMonthStartCount: 12,
          nonMonthStartDateCount: 0,
          monthsWithMultipleDates: 0,
          maxDistinctDatesPerMonth: 1,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 323,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-12-01T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.observedGrain).toBe('month-start');
    expect(result.facts[0]?.measureGuidance.plainSumSafe).toBe(false);
    expect(result.facts[0]?.measureGuidance.safeVisualDateGrain).toBe('month-or-above');
    expect(result.facts[0]?.writePlan).toEqual([]);
  });

  it('does not emit date relationship writes without Date-table coverage proof', () => {
    const m = model(
      [
        tbl('Forecast', [
          col('Forecast', 'Forecast Date', 'dateTime'),
          col('Forecast', 'Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [relationship],
    );

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
      },
      [
        {
          tableName: 'Forecast',
          dateColumn: 'Forecast Date',
          rowCount: 45,
          nonBlankDateCount: 45,
          distinctDateCount: 40,
          distinctMonthStartCount: 2,
          nonMonthStartDateCount: 43,
          monthsWithMultipleDates: 2,
          maxDistinctDatesPerMonth: 21,
          blankDateCount: 0,
          duplicateDateCount: 5,
          gapCount: 19,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-02-28T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.observedGrain).toBe('day');
    expect(result.facts[0]?.writePlan).toEqual([]);
  });

  it('emits date relationship writes for sparse day-level facts when Date coverage is valid', () => {
    const m = model(
      [
        tbl('Forecast', [
          col('Forecast', 'Forecast Date', 'dateTime'),
          col('Forecast', 'Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [relationship],
    );

    const sparseFactEvidence = {
      tableName: 'Forecast',
      dateColumn: 'Forecast Date',
      rowCount: 45,
      nonBlankDateCount: 45,
      distinctDateCount: 40,
      distinctMonthStartCount: 2,
      nonMonthStartDateCount: 43,
      monthsWithMultipleDates: 2,
      maxDistinctDatesPerMonth: 21,
      blankDateCount: 0,
      duplicateDateCount: 5,
      gapCount: 19,
      nonMidnightTimeCount: 0,
      minDate: '2025-01-01T00:00:00',
      maxDate: '2025-02-28T00:00:00',
    };

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
        dateTableCoverageEvidence: {
          dateTable: {
            tableName: 'Calendar',
            dateColumn: 'Date',
            rowCount: 59,
            nonBlankDateCount: 59,
            distinctDateCount: 59,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 0,
            nonMidnightTimeCount: 0,
            minDate: '2025-01-01T00:00:00',
            maxDate: '2025-02-28T00:00:00',
          },
          facts: [sparseFactEvidence],
        },
      },
      [sparseFactEvidence],
    );

    expect(result.facts[0]?.observedGrain).toBe('day');
    expect(result.facts[0]?.measureGuidance.plainSumSafe).toBe(true);
    expect(result.facts[0]?.measureGuidance.safeVisualDateGrain).toBe('day-or-above');
    expect(result.facts[0]?.writePlan).toEqual([
      {
        action: 'activate-date-relationship',
        id: 'Forecast_Date_Calendar_Date',
        description:
          'Observed day-level date values support activating the existing date relationship.',
      },
    ]);
  });

  it('does not emit date relationship writes to an unmarked date endpoint', () => {
    const m = model(
      [
        tbl('Forecast', [col('Forecast', 'Forecast Date', 'dateTime')]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })]),
      ],
      [relationship],
    );

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
      },
      [
        {
          tableName: 'Forecast',
          dateColumn: 'Forecast Date',
          rowCount: 45,
          nonBlankDateCount: 45,
          distinctDateCount: 40,
          distinctMonthStartCount: 2,
          nonMonthStartDateCount: 43,
          monthsWithMultipleDates: 2,
          maxDistinctDatesPerMonth: 21,
          blankDateCount: 0,
          duplicateDateCount: 5,
          gapCount: 19,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-02-28T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.observedGrain).toBe('day');
    expect(result.facts[0]?.writePlan).toEqual([]);
  });

  it('classifies one non-start date per month as month-grain, not daily', () => {
    const m = model([
      tbl('Plan', [col('Plan', 'Plan Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })]),
    ]);

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Plan', dateColumn: 'Plan Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
      },
      [
        {
          tableName: 'Plan',
          dateColumn: 'Plan Date',
          rowCount: 12,
          nonBlankDateCount: 12,
          distinctDateCount: 12,
          distinctMonthStartCount: 12,
          nonMonthStartDateCount: 12,
          monthsWithMultipleDates: 0,
          maxDistinctDatesPerMonth: 1,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 323,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-15T00:00:00',
          maxDate: '2025-12-15T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.observedGrain).toBe('month-single-date');
    expect(result.facts[0]?.measureGuidance.plainSumSafe).toBe(false);
    expect(result.facts[0]?.measureGuidance.safeVisualDateGrain).toBe('month-or-above');
  });

  it('classifies one correction date inside a monthly table as submonthly, not daily', () => {
    const m = model(
      [
        tbl('Plan', [col('Plan', 'Plan Date', 'dateTime')]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [
        {
          ...relationship,
          id: 'Plan_Date_Calendar_Date',
          fromTable: 'Plan',
          fromColumn: 'Plan Date',
        },
      ],
    );

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Plan', dateColumn: 'Plan Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
      },
      [
        {
          tableName: 'Plan',
          dateColumn: 'Plan Date',
          rowCount: 13,
          nonBlankDateCount: 13,
          distinctDateCount: 13,
          distinctMonthStartCount: 12,
          nonMonthStartDateCount: 1,
          monthsWithMultipleDates: 1,
          maxDistinctDatesPerMonth: 2,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 322,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-12-15T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.observedGrain).toBe('submonthly');
    expect(result.facts[0]?.measureGuidance.plainSumSafe).toBe(false);
    expect(result.facts[0]?.writePlan).toEqual([]);
  });

  it('does not auto-activate an inactive role-playing date relationship', () => {
    const m = model(
      [
        tbl('Actual', [
          col('Actual', 'Order Date', 'dateTime'),
          col('Actual', 'Ship Date', 'dateTime'),
        ]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [
        {
          id: 'Actual_Order_Calendar',
          fromTable: 'Actual',
          fromColumn: 'Order Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
        {
          id: 'Actual_Ship_Calendar',
          fromTable: 'Actual',
          fromColumn: 'Ship Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Actual', dateColumn: 'Ship Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
      },
      [
        {
          tableName: 'Actual',
          dateColumn: 'Ship Date',
          rowCount: 40,
          nonBlankDateCount: 10,
          distinctDateCount: 10,
          distinctMonthStartCount: 1,
          nonMonthStartDateCount: 9,
          monthsWithMultipleDates: 1,
          maxDistinctDatesPerMonth: 10,
          blankDateCount: 30,
          duplicateDateCount: 0,
          gapCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-10T00:00:00',
        },
      ],
    );

    const relationship = result.facts[0]?.relationship;
    expect(relationship).toMatchObject({
      status: 'inactive',
      id: 'Actual_Ship_Calendar',
      canActivate: false,
      activationBlocking: [
        {
          code: 'ambiguous-active-path',
          message:
            'Another active relationship already exists between "Actual" and "Calendar". Only one active relationship is allowed per table pair; make this one inactive or deactivate the other.',
        },
      ],
    });
    expect(result.facts[0]?.writePlan).toEqual([]);
  });

  it('matches requested dateColumn against the dimension endpoint, not the fact endpoint', () => {
    const m = model(
      [
        tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
        tbl('Fiscal Calendar', [col('Fiscal Calendar', 'Fiscal Date', 'dateTime')]),
      ],
      [
        {
          id: 'Fact_Date_Fiscal',
          fromTable: 'Fact',
          fromColumn: 'Date',
          toTable: 'Fiscal Calendar',
          toColumn: 'Fiscal Date',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planDateGrain(m, {
      facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
      dateColumn: 'Date',
    });

    expect(result.facts[0]?.relationship).toEqual({
      status: 'unknown',
      reason: 'no matching date relationship found and dateTable/dateColumn were not supplied',
    });
  });

  it('reports auto date tables without treating them as the governed date dimension', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime')]),
      tbl('LocalDateTable_1', [col('LocalDateTable_1', 'Date', 'dateTime')], [], {
        isAutoDateTable: true,
      }),
    ]);

    const result = planDateGrain(m, {
      facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
      dateTable: 'Calendar',
      dateColumn: 'Date',
    });

    expect(result.autoDateTables).toEqual({
      count: 1,
      names: ['LocalDateTable_1'],
      recommendation:
        'Disable Auto Date/Time and use the governed date table; auto date tables add repeated calendar structures and slow model inspection.',
    });
  });

  it('detects date-truncating TREATAS candidates when observed dates are daily', () => {
    const m = model([
      tbl('Target', [col('Target', 'Target Date', 'dateTime')]),
      tbl(
        'Measures',
        [],
        [
          measure(
            'Measures',
            'Target Amount',
            "CALCULATE(SUM(Target[Amount]), TREATAS(SELECTCOLUMNS(VALUES('Calendar'[Date]), \"MonthKey\", DATE(YEAR('Target'[Target Date]), MONTH('Target'[Target Date]), 1)), Target[Target Date]))",
          ),
        ],
      ),
    ]);

    const result = planDateGrain(
      m,
      { facts: [{ tableName: 'Target', dateColumn: 'Target Date' }] },
      [
        {
          tableName: 'Target',
          dateColumn: 'Target Date',
          rowCount: 59,
          nonBlankDateCount: 59,
          distinctDateCount: 59,
          distinctMonthStartCount: 2,
          nonMonthStartDateCount: 57,
          monthsWithMultipleDates: 2,
          maxDistinctDatesPerMonth: 31,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-02-28T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.measureGuidance.removeDateTruncatingTreatas).toBe(true);
    expect(result.facts[0]?.measureGuidance.dateTruncatingMeasureCandidates).toEqual([
      {
        table: 'Measures',
        name: 'Target Amount',
        reason: 'treatas-date-truncation-pattern',
      },
    ]);
  });

  it('parses common DAX result envelopes and bracketed row keys', () => {
    const parsed = parseDateGrainProbeResult({
      results: [
        {
          tables: [
            {
              rows: [
                {
                  '[__table]': 'Target',
                  '[__column]': 'Target Date',
                  '[rowCount]': 42,
                  '[nonBlankDateCount]': 40,
                  '[distinctDateCount]': 35,
                  '[distinctMonthStartCount]': 2,
                  '[nonMonthStartDateCount]': 38,
                  '[monthsWithMultipleDates]': 2,
                  '[maxDistinctDatesPerMonth]': 18,
                  '[blankDateCount]': 2,
                  '[duplicateDateCount]': 5,
                  '[gapCount]': 23,
                  '[nonMidnightTimeCount]': 4,
                  '[minDate]': '2025-01-02T00:00:00',
                  '[maxDate]': '2025-02-28T00:00:00',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed).toEqual([
      {
        tableName: 'Target',
        dateColumn: 'Target Date',
        rowCount: 42,
        nonBlankDateCount: 40,
        distinctDateCount: 35,
        distinctMonthStartCount: 2,
        nonMonthStartDateCount: 38,
        monthsWithMultipleDates: 2,
        maxDistinctDatesPerMonth: 18,
        blankDateCount: 2,
        duplicateDateCount: 5,
        gapCount: 23,
        nonMidnightTimeCount: 4,
        minDate: '2025-01-02T00:00:00',
        maxDate: '2025-02-28T00:00:00',
      },
    ]);
    expect(classifyObservedDateGrain(parsed[0])).toBe('day');
  });

  it('builds one date-table coverage probe for the governed date key and facts', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
      }),
    ]);

    const query = buildDateTableCoverageProbeQuery(m, {
      dateTable: 'Calendar',
      dateColumn: 'Date',
      facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
    });

    expect(query).toContain('UNION(');
    expect(query).toContain('"__kind", "date-table"');
    expect(query).toContain('"blankDateCount"');
    expect(query).toContain('"gapCount"');
  });

  it('blocks a date table that does not cover observed fact min/max dates', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
      }),
    ]);

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
      },
      {
        dateTable: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          rowCount: 366,
          nonBlankDateCount: 366,
          distinctDateCount: 366,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          nonMidnightTimeCount: 0,
          minDate: '2020-01-01T00:00:00',
          maxDate: '2020-12-31T00:00:00',
        },
        facts: [
          {
            tableName: 'Fact',
            dateColumn: 'Date',
            rowCount: 100,
            nonBlankDateCount: 100,
            distinctDateCount: 100,
            distinctMonthStartCount: 12,
            nonMonthStartDateCount: 96,
            monthsWithMultipleDates: 12,
            maxDistinctDatesPerMonth: 10,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 1361,
            nonMidnightTimeCount: 2,
            minDate: '2017-01-03T00:00:00',
            maxDate: '2020-12-30T00:00:00',
          },
        ],
      },
    );

    expect(result.status).toBe('blocked');
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      'date-table-start-after-fact-min',
    );
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      'fact-date-has-time-component',
    );
    expect(result.factCoverage[0]).toMatchObject({
      tableName: 'Fact',
      dateColumn: 'Date',
      covered: false,
      factMinDate: '2017-01-03T00:00:00',
      factMaxDate: '2020-12-30T00:00:00',
    });
    expect(result.recommendedRange).toMatchObject({
      observedFactMinDate: '2017-01-03',
      observedFactMaxDate: '2020-12-30',
      calendarStartDate: '2017-01-03',
      calendarEndDate: '2020-12-30',
      requiresExplicitForecastHorizon: true,
    });
    expect(result.recommendedRange.message).toContain('observed fact min/max');
  });

  it('expands direct Date-table coverage plans to omitted model-derived fact dates', () => {
    const m = model(
      [
        tbl('Actual', [col('Actual', 'Actual Date', 'dateTime')]),
        tbl('Plan', [col('Plan', 'Plan Date', 'dateTime')]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [
        {
          id: 'Actual_Date_Calendar_Date',
          fromTable: 'Actual',
          fromColumn: 'Actual Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
        {
          id: 'Plan_Date_Calendar_Date',
          fromTable: 'Plan',
          fromColumn: 'Plan Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Actual', dateColumn: 'Actual Date' }],
      },
      {
        dateTable: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          rowCount: 366,
          nonBlankDateCount: 366,
          distinctDateCount: 366,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          nonMidnightTimeCount: 0,
          minDate: '2020-01-01T00:00:00',
          maxDate: '2020-12-31T00:00:00',
        },
        facts: [
          {
            tableName: 'Actual',
            dateColumn: 'Actual Date',
            rowCount: 366,
            nonBlankDateCount: 366,
            distinctDateCount: 366,
            distinctMonthStartCount: 12,
            nonMonthStartDateCount: 354,
            monthsWithMultipleDates: 12,
            maxDistinctDatesPerMonth: 31,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 0,
            minDate: '2020-01-01T00:00:00',
            maxDate: '2020-12-31T00:00:00',
          },
        ],
      },
    );

    expect(result.status).toBe('unknown');
    expect(result.factCoverage.map((coverage) => coverage.tableName)).toEqual(['Actual', 'Plan']);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({
        code: 'fact-date-proof-missing',
        factTable: 'Plan',
        factColumn: 'Plan Date',
      }),
    );
  });

  it('accepts a Time-category Date table with proven unique daily key when Import metadata lacks isKey', () => {
    const m = model(
      [
        tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: false })], [], {
          dataCategory: 'Time',
        }),
      ],
      [
        {
          id: 'Fact_Date_Calendar_Date',
          fromTable: 'Fact',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
      },
      {
        dateTable: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          rowCount: 31,
          nonBlankDateCount: 31,
          distinctDateCount: 31,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-31T00:00:00',
        },
        facts: [
          {
            tableName: 'Fact',
            dateColumn: 'Date',
            rowCount: 10,
            nonBlankDateCount: 10,
            distinctDateCount: 10,
            distinctMonthStartCount: 1,
            nonMonthStartDateCount: 9,
            monthsWithMultipleDates: 1,
            maxDistinctDatesPerMonth: 10,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 21,
            nonMidnightTimeCount: 0,
            minDate: '2025-01-01T00:00:00',
            maxDate: '2025-01-31T00:00:00',
          },
        ],
      },
    );

    expect(result.status).toBe('valid');
    expect(result.dateTable.isMarkedDateTable).toBe(true);
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain('date-column-not-key');
  });

  it('isDataProvenDailyKey requires complete, unique, gap-free, non-blank, midnight-only evidence', () => {
    const base = {
      tableName: 'Calendar',
      dateColumn: 'Date',
      rowCount: 31,
      nonBlankDateCount: 31,
      distinctDateCount: 31,
      blankDateCount: 0,
      duplicateDateCount: 0,
      gapCount: 0,
      nonMidnightTimeCount: 0,
      minDate: '2025-01-01T00:00:00',
      maxDate: '2025-01-31T00:00:00',
    };
    expect(isDataProvenDailyKey(base)).toBe(true);
    expect(isDataProvenDailyKey({ ...base, gapCount: 1 })).toBe(false);
    expect(isDataProvenDailyKey({ ...base, duplicateDateCount: 1 })).toBe(false);
    expect(isDataProvenDailyKey({ ...base, nonMidnightTimeCount: 1 })).toBe(false);
    expect(isDataProvenDailyKey({ ...base, distinctDateCount: 30 })).toBe(false);
    expect(isDataProvenDailyKey(undefined)).toBe(false);
    expect(isDataProvenDailyKey({ tableName: 'Calendar', dateColumn: 'Date' })).toBe(false);
  });

  // T1 — date serialization wire-shape matrix (exercises dateOnlyOrdinal via the public
  // proof predicate). The live host may serialize a DateTime cell in several shapes; the
  // proof must accept the unambiguous year-leading ones and FAIL CLOSED on ambiguous
  // day-leading locale forms (which would silently swap day/month and corrupt coverage).
  it('proves the key across ISO / slash-ISO / in-range serial, and fails closed on locale/out-of-range dates', () => {
    const base = {
      tableName: 'Calendar',
      dateColumn: 'Date',
      rowCount: 31,
      nonBlankDateCount: 31,
      distinctDateCount: 31,
      blankDateCount: 0,
      duplicateDateCount: 0,
      gapCount: 0,
      nonMidnightTimeCount: 0,
    };
    // Accepted, unambiguous (year-leading):
    expect(isDataProvenDailyKey({ ...base, minDate: '2025-01-01', maxDate: '2025-01-31' })).toBe(
      true,
    );
    expect(
      isDataProvenDailyKey({ ...base, minDate: '2025-01-01T00:00:00Z', maxDate: '2025-01-31' }),
    ).toBe(true);
    expect(isDataProvenDailyKey({ ...base, minDate: '2025/01/01', maxDate: '2025/01/31' })).toBe(
      true,
    );
    // OLE/DAX date serials within the plausible window (45658≈2025-01-01, 45688≈2025-01-31):
    expect(isDataProvenDailyKey({ ...base, minDate: '45658', maxDate: '45688' })).toBe(true);
    // Rejected — ambiguous day-leading locale forms (would mis-parse day/month):
    expect(isDataProvenDailyKey({ ...base, minDate: '01/03/2025', maxDate: '31/01/2025' })).toBe(
      false,
    );
    expect(isDataProvenDailyKey({ ...base, minDate: '1/3/2025', maxDate: '1/31/2025' })).toBe(
      false,
    );
    // Rejected — out-of-range year / serial (fail-closed, never a real-looking window):
    expect(isDataProvenDailyKey({ ...base, minDate: '1700-01-01', maxDate: '1700-01-31' })).toBe(
      false,
    );
    expect(isDataProvenDailyKey({ ...base, minDate: '45658', maxDate: '9999999' })).toBe(false);
  });

  // T2 — the probe must FORMAT date outputs to invariant ISO at the DAX source so every
  // host culture returns yyyy-MM-dd (the root-cause fix for the live deadlock).
  it('emits invariant FORMAT(...,"yyyy-MM-dd") for minDate/maxDate in the coverage probe', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
      }),
    ]);
    const query =
      buildDateTableCoverageProbeQuery(m, {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
      }) ?? '';
    expect(query).toMatch(/"minDate",\s*FORMAT\(MINX\(.*"yyyy-MM-dd"\)/);
    expect(query).toMatch(/"maxDate",\s*FORMAT\(MAXX\(.*"yyyy-MM-dd"\)/);
    // Both the date-table row and the fact row are built by the same function, so both FORMAT.
    expect((query.match(/FORMAT\(MINX/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  // T3 — regression lock for the live deadlock: a clean key whose min/max came back in a
  // locale (non-ISO) shape must NOT prove (old bug reproduced) — the FORMAT fix is what
  // makes the live path supply ISO so this case does not arise in practice.
  it('does NOT prove a clean key when min/max are non-ISO locale strings (deadlock regression)', () => {
    const localeEvidence = {
      tableName: 'Calendar',
      dateColumn: 'Date',
      rowCount: 31,
      nonBlankDateCount: 31,
      distinctDateCount: 31,
      blankDateCount: 0,
      duplicateDateCount: 0,
      gapCount: 0,
      nonMidnightTimeCount: 0,
      minDate: '1/1/2025 12:00:00 AM',
      maxDate: '1/31/2025 12:00:00 AM',
    };
    expect(isDataProvenDailyKey(localeEvidence)).toBe(false);
  });

  // T5 — bounded-safety regression: a POSITIVELY DIRTY key (blanks / dups / gaps / non-
  // midnight) is never data-proven and never demoted; F4's mark demotion must not fire.
  it('never proves or unblocks a positively-dirty date key (bounded-safety lock)', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime')]),
    ]);
    const cleanDateTable = {
      tableName: 'Calendar',
      dateColumn: 'Date',
      rowCount: 31,
      nonBlankDateCount: 31,
      distinctDateCount: 31,
      blankDateCount: 0,
      duplicateDateCount: 0,
      gapCount: 0,
      nonMidnightTimeCount: 0,
      minDate: '2025-01-01',
      maxDate: '2025-01-31',
    };
    const factEvidence = {
      tableName: 'Fact',
      dateColumn: 'Date',
      rowCount: 10,
      nonBlankDateCount: 10,
      distinctDateCount: 10,
      distinctMonthStartCount: 1,
      nonMonthStartDateCount: 9,
      monthsWithMultipleDates: 1,
      maxDistinctDatesPerMonth: 10,
      blankDateCount: 0,
      duplicateDateCount: 0,
      gapCount: 21,
      nonMidnightTimeCount: 0,
      minDate: '2025-01-01',
      maxDate: '2025-01-31',
    };
    for (const dirty of [
      { blankDateCount: 1 },
      { duplicateDateCount: 1 },
      { gapCount: 1 },
      { nonMidnightTimeCount: 1 },
      { distinctDateCount: 30 },
    ]) {
      const result = planDateTableCoverage(
        m,
        {
          dateTable: 'Calendar',
          dateColumn: 'Date',
          facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
        },
        { dateTable: { ...cleanDateTable, ...dirty }, facts: [factEvidence] },
      );
      expect(result.dateTable.keyProvenFromData).toBe(false);
      expect(result.markReadiness.ready).toBe(false);
      // The mark blocker stays a BLOCKER (not demoted to a warning) for a non-proven key.
      expect(result.blockers.map((b) => b.code)).toContain('date-table-not-marked');
      expect(result.warnings.map((w) => w.code)).not.toContain('date-table-mark-unobservable');
    }
  });

  it('proves date-key-ness from data on an unmarked table lacking isKey (P2/P3): suppresses date-column-not-key and reports markReadiness', () => {
    const m = model(
      [
        tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: false })]),
      ],
      [
        {
          id: 'Fact_Date_Calendar_Date',
          fromTable: 'Fact',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
      },
      {
        dateTable: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          rowCount: 31,
          nonBlankDateCount: 31,
          distinctDateCount: 31,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-31T00:00:00',
        },
        facts: [
          {
            tableName: 'Fact',
            dateColumn: 'Date',
            rowCount: 10,
            nonBlankDateCount: 10,
            distinctDateCount: 10,
            distinctMonthStartCount: 1,
            nonMonthStartDateCount: 9,
            monthsWithMultipleDates: 1,
            maxDistinctDatesPerMonth: 10,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 21,
            nonMidnightTimeCount: 0,
            minDate: '2025-01-01T00:00:00',
            maxDate: '2025-01-31T00:00:00',
          },
        ],
      },
    );

    expect(result.dateTable.keyProvenFromData).toBe(true);
    expect(result.dateTable.isTemporalKey).toBe(true);
    expect(result.blockers.map((b) => b.code)).not.toContain('date-column-not-key');
    // F4: when the key is PROVEN from data, the unobservable dataCategory="Time" mark is
    // NOT a blocker — it degrades to a warning, so a clean-but-unmarked Date table reports
    // status 'valid' (mark-independent) instead of deadlocking. The read-back mark is a
    // known Import no-op; gating on it blocked every date op on a clean Import Date table.
    expect(result.blockers.map((b) => b.code)).not.toContain('date-table-not-marked');
    expect(result.warnings.map((w) => w.code)).toContain('date-table-mark-unobservable');
    expect(result.status).toBe('valid');
    expect(result.markReadiness.dataProvenKey).toBe(true);
    expect(result.markReadiness.coversAllFacts).toBe(true);
    expect(result.markReadiness.blockingForMark.map((b) => b.code)).not.toContain(
      'date-table-not-marked',
    );
    expect(result.markReadiness.ready).toBe(true);
  });

  it('keeps date-column-not-key and blocks mark readiness when the key is NOT proven from data (gap)', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: false })]),
    ]);

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
      },
      {
        dateTable: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          rowCount: 30,
          nonBlankDateCount: 30,
          distinctDateCount: 30,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 1,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-31T00:00:00',
        },
        facts: [],
      },
    );

    expect(result.dateTable.keyProvenFromData).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain('date-table-has-gaps');
    expect(result.blockers.map((b) => b.code)).toContain('date-column-not-key');
    expect(result.markReadiness.dataProvenKey).toBe(false);
    expect(result.markReadiness.ready).toBe(false);
    expect(result.markReadiness.blockingForMark.map((b) => b.code)).toContain(
      'date-table-has-gaps',
    );
  });

  it('readGovernedDatePolicy parses the stamped governed policy and ignores unstamped/undefined tables', () => {
    const governed = tbl('Calendar', [], [], {
      annotations: {
        pbiAgentKit_governedByTool: 'true',
        pbiAgentKit_dateRangePolicy: 'observed-full-years',
        pbiAgentKit_futureHorizonDays: '0',
      },
    });
    expect(readGovernedDatePolicy(governed)).toEqual({
      governedByTool: true,
      rangePolicy: 'observed-full-years',
      futureHorizonDays: 0,
      allowCalendarEndAfterFactMax: true,
    });
    expect(readGovernedDatePolicy(tbl('Plain')).governedByTool).toBe(false);
    expect(readGovernedDatePolicy(undefined).governedByTool).toBe(false);
  });

  it('does not re-block a governed full-years Date table for end-after-fact-max when policy is persisted (P5)', () => {
    const cols = [col('Calendar', 'Date', 'dateTime', { isKey: true })];
    const evidence = {
      dateTable: {
        tableName: 'Calendar',
        dateColumn: 'Date',
        rowCount: 365,
        nonBlankDateCount: 365,
        distinctDateCount: 365,
        blankDateCount: 0,
        duplicateDateCount: 0,
        gapCount: 0,
        nonMidnightTimeCount: 0,
        minDate: '2025-01-01T00:00:00',
        maxDate: '2025-12-31T00:00:00',
      },
      facts: [
        {
          tableName: 'Fact',
          dateColumn: 'Date',
          rowCount: 5,
          nonBlankDateCount: 5,
          distinctDateCount: 5,
          distinctMonthStartCount: 1,
          nonMonthStartDateCount: 4,
          monthsWithMultipleDates: 1,
          maxDistinctDatesPerMonth: 5,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 100,
          nonMidnightTimeCount: 0,
          minDate: '2025-03-01T00:00:00',
          maxDate: '2025-06-30T00:00:00',
        },
      ],
    };
    const opts = {
      dateTable: 'Calendar',
      dateColumn: 'Date',
      facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
    };

    const governed = planDateTableCoverage(
      model([
        tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
        tbl('Calendar', cols, [], {
          dataCategory: 'Time',
          annotations: {
            pbiAgentKit_governedByTool: 'true',
            pbiAgentKit_dateRangePolicy: 'observed-full-years',
            pbiAgentKit_futureHorizonDays: '0',
          },
        }),
      ]),
      opts,
      evidence,
    );
    expect(governed.blockers.map((b) => b.code)).not.toContain(
      'date-table-end-after-fact-max-without-policy',
    );

    const plain = planDateTableCoverage(
      model([
        tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
        tbl('Calendar', cols, [], { dataCategory: 'Time' }),
      ]),
      opts,
      evidence,
    );
    expect(plain.blockers.map((b) => b.code)).toContain(
      'date-table-end-after-fact-max-without-policy',
    );
  });

  it('blocks volatile TODAY or NOW calendar anchors instead of accepting current-date bounds', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
        expression: 'CALENDAR(DATE(2017,1,1), DATE(YEAR(TODAY()) + 1, 12, 31))',
      }),
    ]);

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
      },
      {
        dateTable: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          minDate: '2017-01-01T00:00:00',
          maxDate: '2026-12-31T00:00:00',
        },
        facts: [
          {
            tableName: 'Fact',
            dateColumn: 'Date',
            minDate: '2017-01-03T00:00:00',
            maxDate: '2020-12-30T00:00:00',
          },
        ],
      },
    );

    expect(result.status).toBe('blocked');
    expect(result.dateTable.hasVolatileAnchor).toBe(true);
    expect(result.blockers.map((blocker) => blocker.code)).toContain('volatile-calendar-anchor');
  });

  it('blocks literal hardcoded calendar bounds in Date table source expressions', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
        expression: 'CALENDAR(DATE(2020,1,1), DATE(2026,12,31))',
      }),
    ]);

    const result = planDateTableCoverage(m, {
      dateTable: 'Calendar',
      dateColumn: 'Date',
      facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers.map((blocker) => blocker.code)).toContain('literal-calendar-range');
  });

  it('detects volatile and literal M date-generation sources', () => {
    const risks = findCalendarSourceRisks([
      {
        kind: 'm',
        expression:
          'let Source = List.Dates(#date(2020, 1, 1), Duration.Days(DateTime.LocalNow() - #date(2020, 1, 1)), #duration(1,0,0,0)) in Source',
      },
    ]);

    expect(risks.map((risk) => risk.code)).toEqual([
      'volatile-calendar-anchor',
      'literal-calendar-range',
    ]);
  });

  it('derives complete required fact-date coverage from relationships and fact-like tables', () => {
    const m = model(
      [
        tbl('Actual', [
          col('Actual', 'Date', 'dateTime'),
          col('Actual', 'Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        tbl('Target', [
          col('Target', 'Date', 'dateTime'),
          col('Target', 'Target Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [
        {
          id: 'Actual_Date_Calendar_Date',
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
          fromTable: 'Target',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    expect(
      deriveRequiredDateCoverageFacts(m, {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Actual', dateColumn: 'Date' }],
      }),
    ).toEqual([
      { tableName: 'Actual', dateColumn: 'Date' },
      { tableName: 'Target', dateColumn: 'Date' },
    ]);
  });

  it('derives required fact-date coverage from live PascalCase fact-like metadata', () => {
    const m = model([
      tbl('Target', [
        col('Target', 'Date', 'DateTime'),
        col('Target', 'Target Amount', 'Decimal', { summarizeBy: 'Sum' }),
      ]),
      tbl('Calendar', [col('Calendar', 'Date', 'DateTime', { isKey: true })], [], {
        dataCategory: 'Time',
      }),
    ]);

    expect(
      deriveRequiredDateCoverageFacts(m, {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [],
      }),
    ).toEqual([{ tableName: 'Target', dateColumn: 'Date' }]);
  });

  it('returns blocked, not unknown, when the requested governed date table is missing', () => {
    const m = model([tbl('Fact', [col('Fact', 'Date', 'dateTime')])]);

    const result = planDateTableCoverage(m, {
      dateTable: 'Calendar',
      dateColumn: 'Date',
      facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers.map((blocker) => blocker.code)).toContain('date-table-not-found');
  });

  it('does not report valid coverage when a requested fact date proof is missing', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
      }),
    ]);

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
      },
      {
        dateTable: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          minDate: '2017-01-01T00:00:00',
          maxDate: '2020-12-31T00:00:00',
        },
        facts: [],
      },
    );

    expect(result.status).toBe('unknown');
    expect(result.factCoverage[0]?.covered).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toContain('fact-date-proof-missing');
    expect(result.recommendedRange.requiresExplicitForecastHorizon).toBe(true);
    expect(result.recommendedRange.message).toContain('not fully proven');
  });

  it('parses date-table coverage proof rows separately from fact grain rows', () => {
    const parsed = parseDateTableCoverageProbeResult({
      results: [
        {
          tables: [
            {
              rows: [
                {
                  '[__kind]': 'date-table',
                  '[__table]': 'Calendar',
                  '[__column]': 'Date',
                  '[blankDateCount]': 0,
                  '[duplicateDateCount]': 0,
                  '[gapCount]': 0,
                  '[minDate]': '2017-01-01T00:00:00',
                  '[maxDate]': '2020-12-31T00:00:00',
                },
                {
                  '[__kind]': 'fact',
                  '[__table]': 'Fact',
                  '[__column]': 'Date',
                  '[distinctDateCount]': 10,
                  '[distinctMonthStartCount]': 1,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.dateTable).toMatchObject({
      tableName: 'Calendar',
      dateColumn: 'Date',
      blankDateCount: 0,
      duplicateDateCount: 0,
      gapCount: 0,
    });
    expect(parsed.facts).toHaveLength(1);
  });

  it('treats partial grain proof as unknown instead of inferring from defaults', () => {
    expect(
      classifyObservedDateGrain({
        tableName: 'Fact',
        dateColumn: 'Date',
        nonBlankDateCount: 10,
        distinctDateCount: 10,
      }),
    ).toBe('unknown');
  });

  it('blocks coverage when date-table proof is partial even if min/max are present', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
      }),
    ]);

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
      },
      {
        dateTable: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          minDate: '2020-01-01T00:00:00',
          maxDate: '2020-12-31T00:00:00',
        },
        facts: [
          {
            tableName: 'Fact',
            dateColumn: 'Date',
            rowCount: 10,
            nonBlankDateCount: 10,
            distinctDateCount: 10,
            distinctMonthStartCount: 1,
            nonMonthStartDateCount: 9,
            monthsWithMultipleDates: 1,
            maxDistinctDatesPerMonth: 10,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 0,
            minDate: '2020-01-01T00:00:00',
            maxDate: '2020-01-10T00:00:00',
          },
        ],
      },
    );

    expect(result.status).toBe('unknown');
    expect(result.blockers.map((blocker) => blocker.code)).toContain('date-table-proof-missing');
    expect(result.factCoverage[0]?.covered).toBe(false);
  });

  it('preserves caller-supplied fact dates and blocks missing fact metadata', () => {
    const m = model([
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
      }),
    ]);

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Missing Fact', dateColumn: 'Missing Date' }],
      },
      {
        dateTable: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          rowCount: 10,
          nonBlankDateCount: 10,
          distinctDateCount: 10,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-10T00:00:00',
        },
        facts: [],
      },
    );

    expect(result.status).toBe('blocked');
    expect(result.factCoverage).toEqual([
      expect.objectContaining({
        tableName: 'Missing Fact',
        dateColumn: 'Missing Date',
        covered: false,
      }),
    ]);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(['fact-table-not-found', 'fact-date-proof-missing']),
    );
  });

  it('derives hidden temporal fact columns so coverage cannot silently omit them', () => {
    const m = model(
      [
        tbl('Actual', [
          col('Actual', 'Date', 'dateTime', { isHidden: true }),
          col('Actual', 'Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [
        {
          id: 'Actual_Date_Calendar_Date',
          fromTable: 'Actual',
          fromColumn: 'Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    expect(
      deriveRequiredDateCoverageFacts(m, {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [],
      }),
    ).toEqual([{ tableName: 'Actual', dateColumn: 'Date' }]);
  });

  it('WARNS (does not block) live Date-table reliance when the source expression is merely unreadable', () => {
    const m = {
      ...model([
        tbl('Actual', [
          col('Actual', 'Date', 'dateTime'),
          col('Actual', 'Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ]),
      modelPath: '(live)',
    };

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [{ tableName: 'Actual', dateColumn: 'Date' }],
      },
      {
        dateTable: {
          tableName: 'Calendar',
          dateColumn: 'Date',
          rowCount: 10,
          nonBlankDateCount: 10,
          distinctDateCount: 10,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-10T00:00:00',
        },
        facts: [
          {
            tableName: 'Actual',
            dateColumn: 'Date',
            rowCount: 10,
            nonBlankDateCount: 10,
            distinctDateCount: 10,
            distinctMonthStartCount: 1,
            nonMonthStartDateCount: 9,
            monthsWithMultipleDates: 1,
            maxDistinctDatesPerMonth: 10,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 0,
            nonMidnightTimeCount: 0,
            minDate: '2025-01-01T00:00:00',
            maxDate: '2025-01-10T00:00:00',
          },
        ],
      },
    );

    // An unreadable calendar source on a live Import model is structurally unobservable
    // through the MS MCP (partitionSources is never populated live; a Power-Query Date table
    // has no table-level expression), so absence is NOT proof of a defect. It must degrade
    // to a relayed warning and the clean data probe must keep the table usable — otherwise
    // proving the key from data would self-arm the refusal and deadlock every Import Date
    // table. A positively-observed volatile/literal anchor is a separate blocker (covered
    // by the volatile-calendar-anchor / literal-calendar-range tests).
    expect(result.status).toBe('valid');
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain(
      'calendar-source-proof-missing',
    );
    expect(result.warnings.map((warning) => warning.code)).toContain('calendar-source-unproven');
    expect(result.markReadiness.ready).toBe(true);
  });

  it('rejects Date-table coverage proof for a different table identity', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
      }),
    ]);

    const result = planDateTableCoverage(
      m,
      {
        dateTable: 'Calendar',
        dateColumn: 'Date',
        facts: [],
      },
      {
        dateTable: {
          tableName: 'Other Calendar',
          dateColumn: 'Date',
          rowCount: 10,
          nonBlankDateCount: 10,
          distinctDateCount: 10,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          nonMidnightTimeCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-10T00:00:00',
        },
        facts: [],
      },
    );

    expect(result.status).toBe('blocked');
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(['date-table-proof-mismatch', 'date-table-proof-missing']),
    );
  });

  it('blocks literal hardcoded calendar bounds from partition source provenance', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
        partitionSources: [
          {
            kind: 'm',
            expression:
              'let Source = List.Dates(#date(2020, 1, 1), 366, #duration(1,0,0,0)) in Source',
          },
        ],
      }),
    ]);

    const result = planDateTableCoverage(m, {
      dateTable: 'Calendar',
      dateColumn: 'Date',
      facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers.map((blocker) => blocker.code)).toContain('literal-calendar-range');
  });

  it('blocks literal hardcoded calendar bounds in List.Generate date sources', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
        partitionSources: [
          {
            kind: 'm',
            expression:
              'let Source = List.Generate(() => #date(2020, 1, 1), each _ <= #date(2020, 12, 31), each Date.AddDays(_, 1)) in Source',
          },
        ],
      }),
    ]);

    const result = planDateTableCoverage(m, {
      dateTable: 'Calendar',
      dateColumn: 'Date',
      facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers.map((blocker) => blocker.code)).toContain('literal-calendar-range');
  });

  it('blocks literal hardcoded calendar bounds in List.Generate datetime sources', () => {
    const m = model([
      tbl('Fact', [col('Fact', 'Date', 'dateTime')]),
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
        partitionSources: [
          {
            kind: 'm',
            expression:
              'let Source = List.Generate(() => #datetime(2020, 1, 1, 0, 0, 0), each _ <= #datetimezone(2020, 12, 31, 0, 0, 0, 0, 0), each DateTime.AddZone(_, 0)) in Source',
          },
        ],
      }),
    ]);

    const result = planDateTableCoverage(m, {
      dateTable: 'Calendar',
      dateColumn: 'Date',
      facts: [{ tableName: 'Fact', dateColumn: 'Date' }],
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers.map((blocker) => blocker.code)).toContain('literal-calendar-range');
  });

  it('does not emit an activation write for a relationship without proven identity', () => {
    const m = model(
      [
        tbl('Forecast', [col('Forecast', 'Forecast Date', 'dateTime')]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [
        {
          ...relationship,
          id: 'rel_0',
          identityProven: false,
        },
      ],
    );

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
      },
      [
        {
          tableName: 'Forecast',
          dateColumn: 'Forecast Date',
          rowCount: 10,
          nonBlankDateCount: 10,
          distinctDateCount: 10,
          distinctMonthStartCount: 1,
          nonMonthStartDateCount: 9,
          monthsWithMultipleDates: 1,
          maxDistinctDatesPerMonth: 10,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-10T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.relationship).toEqual(
      expect.objectContaining({
        status: 'inactive',
        id: 'rel_0',
        canActivate: false,
        activationBlocking: expect.arrayContaining([
          expect.objectContaining({ code: 'relationship-id-missing' }),
        ]),
      }),
    );
    expect(result.facts[0]?.writePlan).toEqual([]);
  });

  it('does not emit an activation write when relationship identity provenance is omitted', () => {
    const m: TMDLModel = {
      modelPath: '/',
      tables: [
        tbl('Forecast', [col('Forecast', 'Forecast Date', 'dateTime')]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      relationships: [
        {
          id: 'rel_omitted',
          fromTable: 'Forecast',
          fromColumn: 'Forecast Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    };

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
      },
      [
        {
          tableName: 'Forecast',
          dateColumn: 'Forecast Date',
          rowCount: 10,
          nonBlankDateCount: 10,
          distinctDateCount: 10,
          distinctMonthStartCount: 1,
          nonMonthStartDateCount: 9,
          monthsWithMultipleDates: 1,
          maxDistinctDatesPerMonth: 10,
          blankDateCount: 0,
          duplicateDateCount: 0,
          gapCount: 0,
          minDate: '2025-01-01T00:00:00',
          maxDate: '2025-01-10T00:00:00',
        },
      ],
    );

    expect(result.facts[0]?.relationship).toMatchObject({
      status: 'inactive',
      canActivate: false,
      activationBlocking: expect.arrayContaining([
        expect.objectContaining({ code: 'relationship-id-missing' }),
      ]),
    });
    expect(result.facts[0]?.writePlan).toEqual([]);
  });

  it('does not emit date relationship writes when coverage proof omits another related fact', () => {
    const m = model(
      [
        tbl('Forecast', [col('Forecast', 'Forecast Date', 'dateTime')]),
        tbl('Actual', [col('Actual', 'Order Date', 'dateTime')]),
        tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
          dataCategory: 'Time',
        }),
      ],
      [
        relationship,
        {
          id: 'Actual_Date_Calendar_Date',
          fromTable: 'Actual',
          fromColumn: 'Order Date',
          toTable: 'Calendar',
          toColumn: 'Date',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const exactForecast = {
      tableName: 'Forecast',
      dateColumn: 'Forecast Date',
      rowCount: 10,
      nonBlankDateCount: 10,
      distinctDateCount: 10,
      distinctMonthStartCount: 1,
      nonMonthStartDateCount: 9,
      monthsWithMultipleDates: 1,
      maxDistinctDatesPerMonth: 10,
      blankDateCount: 0,
      duplicateDateCount: 0,
      gapCount: 0,
      minDate: '2025-01-01T00:00:00',
      maxDate: '2025-01-10T00:00:00',
    };

    const result = planDateGrain(
      m,
      {
        facts: [{ tableName: 'Forecast', dateColumn: 'Forecast Date' }],
        dateTable: 'Calendar',
        dateColumn: 'Date',
        dateTableCoverageEvidence: {
          dateTable: {
            tableName: 'Calendar',
            dateColumn: 'Date',
            rowCount: 10,
            nonBlankDateCount: 10,
            distinctDateCount: 10,
            blankDateCount: 0,
            duplicateDateCount: 0,
            gapCount: 0,
            nonMidnightTimeCount: 0,
            minDate: '2025-01-01T00:00:00',
            maxDate: '2025-01-10T00:00:00',
          },
          facts: [exactForecast],
        },
      },
      [exactForecast],
    );

    expect(result.facts[0]?.writePlan).toEqual([]);
  });
});

// Count parens outside of double-quoted DAX string literals. A non-zero result
// means the generated DAX is unbalanced and the engine will reject it.
function unbalancedParenDelta(dax: string): number {
  let delta = 0;
  let inString = false;
  for (let i = 0; i < dax.length; i += 1) {
    const ch = dax[i];
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '(') delta += 1;
    else if (ch === ')') delta -= 1;
  }
  return delta;
}

describe('generated probe DAX is syntactically balanced', () => {
  // Regression guard for the buildProbeRow paren imbalance: every probe ROW()
  // must be paren-balanced or the live DAX engine rejects the whole query and the
  // date/relationship proof gates fall over with "no rows".
  it('emits balanced parentheses for a single-fact grain probe', () => {
    const m = model([tbl('Actual', [col('Actual', 'Event Date', 'dateTime')])]);
    const query = buildDateGrainProbeQuery(m, [{ tableName: 'Actual', dateColumn: 'Event Date' }]);
    expect(query).toBeDefined();
    expect(unbalancedParenDelta(query as string)).toBe(0);
  });

  it('coalesces every count metric with "+ 0" so a clean key (zero blanks/non-midnight) does not serialize as BLANK', () => {
    // Regression for the zero-vs-BLANK serialization deadlock: COUNTROWS/MAXX return
    // BLANK (not 0) over an empty filter, BLANK -> "" on the wire -> numberValue undefined
    // -> incomplete proof -> keyProvenFromData:false -> every date gate deadlocks and the
    // agent keeps asking to refresh. Source-coalescing to 0 is the fix.
    const m = model([tbl('Actual', [col('Actual', 'Event Date', 'dateTime')])]);
    const query = buildDateGrainProbeQuery(m, [
      { tableName: 'Actual', dateColumn: 'Event Date' },
    ]) as string;
    const lines = query.split('\n');
    for (const metric of [
      'rowCount',
      'nonBlankDateCount',
      'distinctDateCount',
      'distinctMonthStartCount',
      'nonMonthStartDateCount',
      'monthsWithMultipleDates',
      'maxDistinctDatesPerMonth',
      'blankDateCount',
      'duplicateDateCount',
      'nonMidnightTimeCount',
      'gapCount',
    ]) {
      // each count metric is emitted on its own line and its value must be coalesced with `+ 0`
      const line = lines.find((l) => l.includes(`"${metric}",`));
      expect(line, `missing metric line for ${metric}`).toBeDefined();
      expect(line as string).toContain('+ 0');
    }
    // dates must NOT be coalesced — an all-blank key must keep minDate BLANK to stay blocked
    expect(query).toContain('FORMAT(MINX(');
    expect(query).toContain('FORMAT(MAXX(');
    expect(query).not.toMatch(/"minDate",[^,]*\+ 0/);
    expect(query).not.toMatch(/"maxDate",[^)]*\+ 0/);
    expect(unbalancedParenDelta(query)).toBe(0);
  });

  it('emits balanced parentheses for a multi-fact UNION coverage probe', () => {
    const m = model([
      tbl('Calendar', [col('Calendar', 'Date', 'dateTime', { isKey: true })], [], {
        dataCategory: 'Time',
      }),
      tbl('Actual', [col('Actual', 'Event Date', 'dateTime')]),
      tbl('Forecast', [col('Forecast', 'Forecast Date', 'date')]),
    ]);
    const query = buildDateTableCoverageProbeQuery(m, {
      dateTable: 'Calendar',
      dateColumn: 'Date',
      facts: [
        { tableName: 'Actual', dateColumn: 'Event Date' },
        { tableName: 'Forecast', dateColumn: 'Forecast Date' },
      ],
    });
    expect(query).toBeDefined();
    expect(query).toContain('UNION(');
    expect(unbalancedParenDelta(query as string)).toBe(0);
  });
});

describe('probe parsers accept the live columnar DAX shape', () => {
  // The local @microsoft/powerbi-modeling-mcp returns rows as POSITIONAL
  // array-of-arrays with a separate columns schema (NOT the array-of-objects of
  // the public Execute-Queries REST API). extractRows must zip these or every
  // live probe reads as empty.
  const columnarPayload = {
    columns: [
      { name: '[__kind]', dataType: 'String' },
      { name: '[__table]', dataType: 'String' },
      { name: '[__column]', dataType: 'String' },
      { name: '[rowCount]', dataType: 'Int64' },
      { name: '[nonBlankDateCount]', dataType: 'Int64' },
      { name: '[distinctDateCount]', dataType: 'Int64' },
      { name: '[blankDateCount]', dataType: 'Int64' },
      { name: '[duplicateDateCount]', dataType: 'Int64' },
      { name: '[gapCount]', dataType: 'Int64' },
      { name: '[nonMidnightTimeCount]', dataType: 'Int64' },
      { name: '[minDate]', dataType: 'DateTime' },
      { name: '[maxDate]', dataType: 'DateTime' },
    ],
    rows: [
      [
        'date-table',
        'Calendar',
        'Date',
        30,
        30,
        30,
        0,
        0,
        0,
        0,
        '2025-01-01T00:00:00',
        '2025-01-30T00:00:00',
      ],
      [
        'fact',
        'Actual',
        'Date',
        100,
        100,
        30,
        0,
        70,
        0,
        0,
        '2025-01-01T00:00:00',
        '2025-01-30T00:00:00',
      ],
    ],
    rowCount: 2,
  };

  it('extracts fact grain evidence from positional columnar rows', () => {
    const evidence = parseDateGrainProbeResult(columnarPayload);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      tableName: 'Actual',
      dateColumn: 'Date',
      rowCount: 100,
      distinctDateCount: 30,
      duplicateDateCount: 70,
    });
  });

  it('extracts date-table coverage evidence from positional columnar rows', () => {
    const coverage = parseDateTableCoverageProbeResult(columnarPayload);
    expect(coverage.dateTable).toMatchObject({
      tableName: 'Calendar',
      dateColumn: 'Date',
      rowCount: 30,
      distinctDateCount: 30,
    });
    expect(coverage.facts).toHaveLength(1);
    expect(coverage.facts[0]?.tableName).toBe('Actual');
  });

  it('still accepts the public Execute-Queries REST shape (array-of-objects)', () => {
    const restPayload = {
      results: [
        {
          tables: [
            {
              rows: [
                {
                  '[__table]': 'Actual',
                  '[__column]': 'Date',
                  '[rowCount]': 100,
                  '[distinctDateCount]': 30,
                },
              ],
            },
          ],
        },
      ],
    };
    const evidence = parseDateGrainProbeResult(restPayload);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ tableName: 'Actual', dateColumn: 'Date', rowCount: 100 });
  });
});
