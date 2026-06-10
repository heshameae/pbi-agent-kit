import { describe, expect, it } from 'vitest';
import { planStarSchemaSharedDimensions } from '../../src/modeling/star-schema-plan.js';
import type {
  TMDLColumn,
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

function tbl(name: string, columns: TMDLColumn[] = []): TMDLTable {
  return {
    name,
    columns,
    measures: [],
    isHidden: false,
    isCalculated: false,
    isAutoDateTable: false,
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

describe('planStarSchemaSharedDimensions', () => {
  it('plans a calculated shared dimension instead of a direct source-to-source relationship', () => {
    const leftTable = "Ledger's Source";
    const rightTable = 'Planning Source';
    const axis = 'Shared] Key';
    const m = model([
      tbl(leftTable, [col(leftTable, axis, 'int64', { isKey: true })]),
      tbl(rightTable, [col(rightTable, axis, 'decimal', { isKey: true })]),
    ]);

    const result = planStarSchemaSharedDimensions(m, leftTable, rightTable);

    expect(result.design).toBe('star-schema-shared-dimension');
    expect(result.directFactRelationshipAllowed).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(result.plans).toHaveLength(1);

    const plan = result.plans[0];
    expect(plan).toMatchObject({
      axis,
      leftTable,
      rightTable,
      proposedDimensionTableName: axis,
      daxExpression: [
        'DISTINCT(',
        '  UNION(',
        "    SELECTCOLUMNS('Ledger''s Source', \"Shared] Key\", 'Ledger''s Source'[Shared]] Key]),",
        "    SELECTCOLUMNS('Planning Source', \"Shared] Key\", 'Planning Source'[Shared]] Key])",
        '  )',
        ')',
      ].join('\n'),
    });
    expect(plan.writePlan.map((item) => item.action)).toEqual([
      'create-calculated-table',
      'configure-dimension-key',
      'create-relationships',
      'hide-source-columns',
    ]);
    expect(plan.writePlan[1]).toMatchObject({
      action: 'configure-dimension-key',
      tableName: axis,
      columnName: axis,
      summarizeBy: 'none',
      isKey: true,
    });
    expect(plan.writePlan[2]).toMatchObject({
      action: 'create-relationships',
      relationships: [
        {
          fromTable: leftTable,
          fromColumn: axis,
          toTable: axis,
          toColumn: axis,
          cardinality: 'manyToOne',
          crossFilteringBehavior: 'single',
          isActive: true,
        },
        {
          fromTable: rightTable,
          fromColumn: axis,
          toTable: axis,
          toColumn: axis,
          cardinality: 'manyToOne',
          crossFilteringBehavior: 'single',
          isActive: true,
        },
      ],
    });
  });

  it('treats live-cased metadata data types as valid shared axes', () => {
    const m = model([
      tbl('Actual Source', [
        col('Actual Source', 'Category', 'String'),
        col('Actual Source', 'Segment', 'String'),
        col('Actual Source', 'Amount', 'Decimal', { summarizeBy: 'Sum' }),
      ]),
      tbl('Target Source', [
        col('Target Source', 'Category', 'String'),
        col('Target Source', 'Segment', 'String'),
        col('Target Source', 'Target Amount', 'Decimal', { summarizeBy: 'Sum' }),
      ]),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Actual Source', 'Target Source');

    expect(result.plans.map((plan) => plan.axis)).toEqual(['Category', 'Segment']);
    expect(result.blockers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'axis-unusable-on-left',
          reason: 'unsupported-data-type',
          dataType: 'String',
        }),
      ]),
    );
  });

  it('uses only requested axes and returns blockers for missing or incompatible axes', () => {
    const m = model([
      tbl('Observed', [
        col('Observed', 'Shared Code', 'string'),
        col('Observed', 'Only Observed', 'string'),
        col('Observed', 'Mixed Type', 'decimal', { isKey: true }),
      ]),
      tbl('Forecast', [
        col('Forecast', 'Shared Code', 'string'),
        col('Forecast', 'Mixed Type', 'string'),
        col('Forecast', 'Implicit Shared', 'string'),
      ]),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Observed', 'Forecast', {
      axes: ['Shared Code', 'Only Observed', 'Mixed Type'],
    });

    expect(result.plans.map((plan) => plan.axis)).toEqual(['Shared Code']);
    expect(result.blockers).toEqual([
      {
        code: 'axis-missing-on-right',
        axis: 'Only Observed',
        message: 'Axis "Only Observed" does not exist on table "Forecast".',
      },
      {
        code: 'axis-type-mismatch',
        axis: 'Mixed Type',
        leftDataType: 'decimal',
        rightDataType: 'string',
        message:
          'Axis "Mixed Type" has incompatible data types: Observed[Mixed Type]=decimal vs Forecast[Mixed Type]=string.',
      },
    ]);
  });

  it('plans hidden key columns but rejects calculated and measure-like shared columns', () => {
    const m = model([
      tbl('Left Source', [
        col('Left Source', 'Hidden Key', 'string', { isHidden: true }),
        col('Left Source', 'Calculated Key', 'string', {
          isCalculated: true,
          expression: '"A"',
        }),
        col('Left Source', 'Amount', 'decimal', { summarizeBy: 'sum' }),
      ]),
      tbl('Right Source', [
        col('Right Source', 'Hidden Key', 'string'),
        col('Right Source', 'Calculated Key', 'string'),
        col('Right Source', 'Amount', 'decimal', { summarizeBy: 'sum' }),
      ]),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Left Source', 'Right Source');

    expect(result.plans.map((plan) => plan.axis)).toEqual(['Hidden Key']);
    expect(result.plans[0]?.writePlan[3]).toMatchObject({
      action: 'hide-source-columns',
      columns: [
        { table: 'Left Source', column: 'Hidden Key' },
        { table: 'Right Source', column: 'Hidden Key' },
      ],
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      'axis-unusable-on-left',
      'axis-unusable-on-left',
    ]);
    expect(
      result.blockers.map((blocker) => ('reason' in blocker ? blocker.reason : undefined)),
    ).toEqual(expect.arrayContaining(['calculated', 'measure-like']));
  });

  it('allows numeric identifier-like axes even when summarizeBy is incorrectly enabled', () => {
    const m = model([
      tbl('Source A', [
        col('Source A', 'CustomerKey', 'int64', { summarizeBy: 'sum' }),
        col('Source A', 'Amount', 'decimal', { summarizeBy: 'sum' }),
      ]),
      tbl('Source B', [
        col('Source B', 'CustomerKey', 'int64', { summarizeBy: 'sum' }),
        col('Source B', 'Amount', 'decimal', { summarizeBy: 'sum' }),
      ]),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B');

    expect(result.plans.map((plan) => plan.axis)).toEqual(['CustomerKey']);
    expect(
      result.blockers.map((blocker) => ('axis' in blocker ? blocker.axis : undefined)),
    ).toEqual(['Amount']);
    expect(
      result.blockers.map((blocker) => ('reason' in blocker ? blocker.reason : undefined)),
    ).toEqual(['measure-like']);
  });

  it('rejects numeric non-key axes when summarizeBy metadata is absent', () => {
    const m = model([
      tbl('Source A', [col('Source A', 'Amount', 'decimal')]),
      tbl('Source B', [col('Source B', 'Amount', 'decimal')]),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B');

    expect(result.plans).toEqual([]);
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      'axis-unusable-on-left',
      'no-usable-shared-axes',
    ]);
    expect(
      result.blockers.map((blocker) => ('reason' in blocker ? blocker.reason : undefined)),
    ).toContain('measure-like');
  });

  it('chooses a business-friendly deterministic dimension table name when the axis name is taken', () => {
    const m = model([
      tbl('Source A', [col('Source A', 'Region', 'string')]),
      tbl('Source B', [col('Source B', 'Region', 'string')]),
      tbl('Region'),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    expect(result.plans[0]?.proposedDimensionTableName).toBe('Region Shared');
    expect(result.plans[0]?.proposedDimensionTableName).not.toMatch(/^Dim\b/i);
  });

  it('does not reuse a disconnected same-name key table without relationship coverage proof', () => {
    const m = model([
      tbl('Source A', [col('Source A', 'Region', 'string')]),
      tbl('Source B', [col('Source B', 'Region', 'string')]),
      tbl('Region', [col('Region', 'Region', 'string', { isKey: true })]),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    const plan = result.plans[0];
    expect(plan?.source).toBe('new-calculated-table');
    expect(plan?.proposedDimensionTableName).toBe('Region Shared');
    expect(plan?.daxExpression).toBeDefined();
    expect(plan?.writePlan.map((item) => item.action)).toEqual([
      'create-calculated-table',
      'configure-dimension-key',
      'create-relationships',
      'hide-source-columns',
    ]);
  });

  it('does not reuse a disconnected same-name table unless the key is proven', () => {
    const m = model([
      tbl('Source A', [col('Source A', 'Region', 'string')]),
      tbl('Source B', [col('Source B', 'Region', 'string')]),
      tbl('Region', [col('Region', 'Region', 'string')]),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    const plan = result.plans[0];
    expect(plan?.source).toBe('new-calculated-table');
    expect(plan?.proposedDimensionTableName).toBe('Region Shared');
    expect(plan?.daxExpression).toBeDefined();
  });

  it('blocks temporal shared axes so Date planners own date relationships', () => {
    const m = model([
      tbl('Source A', [col('Source A', 'EventDate', 'dateTime')]),
      tbl('Source B', [col('Source B', 'EventDate', 'dateTime')]),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['EventDate'],
    });

    expect(result.plans).toEqual([]);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({
        code: 'axis-unusable-on-left',
        axis: 'EventDate',
        reason: 'temporal-axis',
      }),
    );
  });

  it('blocks time-category shared axes even when the physical type is not temporal', () => {
    const m = model([
      tbl('Source A', [col('Source A', 'PeriodKey', 'int64', { dataCategory: 'Time' })]),
      tbl('Source B', [col('Source B', 'PeriodKey', 'int64')]),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['PeriodKey'],
    });

    expect(result.plans).toEqual([]);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({
        code: 'axis-unusable-on-left',
        axis: 'PeriodKey',
        reason: 'temporal-axis',
      }),
    );
  });

  it('does not block unmarked temporal-looking surrogate axes by structural name alone', () => {
    for (const axis of ['MonthKey', 'OrderDateKey', 'ShipDateId', 'TimeKey']) {
      const m = model([
        tbl('Source A', [col('Source A', axis, 'int64')]),
        tbl('Source B', [col('Source B', axis, 'int64')]),
      ]);

      const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
        axes: [axis],
      });

      expect(result.plans).toEqual([
        expect.objectContaining({
          axis,
          source: 'new-calculated-table',
          dimensionKeyColumn: axis,
        }),
      ]);
      expect(result.blockers).not.toContainEqual(
        expect.objectContaining({ axis, reason: 'temporal-axis' }),
      );
    }
  });

  it('does not reuse a disconnected dimension-named key table without relationship coverage proof', () => {
    const m = model([
      tbl('Source A', [col('Source A', 'Region', 'string')]),
      tbl('Source B', [col('Source B', 'Region', 'string')]),
      tbl('Dim Region', [col('Dim Region', 'Region', 'string', { isKey: true })]),
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    const plan = result.plans[0];
    expect(plan?.source).toBe('new-calculated-table');
    expect(plan?.proposedDimensionTableName).toBe('Region');
    expect(plan?.daxExpression).toBeDefined();
  });

  it('does not reuse high-confidence fact-like tables as shared dimensions', () => {
    const regionFact: TMDLTable = {
      ...tbl('Region', [
        col('Region', 'Region', 'string'),
        col('Region', 'LookupKey', 'int64', { isKey: true }),
        col('Region', 'Amount', 'decimal', { summarizeBy: 'sum' }),
      ]),
      measures: [
        {
          table: 'Region',
          name: 'Total Amount',
          expression: 'SUM(Region[Amount])',
          isHidden: false,
          annotations: {},
        },
      ],
    };
    const m = model(
      [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        regionFact,
        tbl('Lookup', [col('Lookup', 'LookupKey', 'int64', { isKey: true })]),
      ],
      [
        {
          id: 'region-to-lookup',
          fromTable: 'Region',
          fromColumn: 'LookupKey',
          toTable: 'Lookup',
          toColumn: 'LookupKey',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    const plan = result.plans[0];
    expect(plan?.source).toBe('new-calculated-table');
    expect(plan?.proposedDimensionTableName).toBe('Region Shared');
  });

  it('does not reuse lower-confidence fact-like tables as shared dimensions', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Region', [
          col('Region', 'Region', 'string'),
          col('Region', 'LookupKey', 'int64', { isKey: true }),
          col('Region', 'Quantity', 'int64', { summarizeBy: 'sum' }),
        ]),
        tbl('Lookup', [col('Lookup', 'LookupKey', 'int64', { isKey: true })]),
      ],
      [
        {
          id: 'region-to-lookup',
          fromTable: 'Region',
          fromColumn: 'LookupKey',
          toTable: 'Lookup',
          toColumn: 'LookupKey',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    const plan = result.plans[0];
    expect(plan?.source).toBe('new-calculated-table');
    expect(plan?.proposedDimensionTableName).toBe('Region Shared');
  });

  it('does not reuse disconnected intrinsically fact-like tables as shared dimensions', () => {
    const m = model([
      tbl('Source A', [col('Source A', 'Region', 'string')]),
      tbl('Source B', [col('Source B', 'Region', 'string')]),
      {
        ...tbl('Region', [
          col('Region', 'Region', 'string'),
          col('Region', 'Amount', 'decimal', { summarizeBy: 'sum' }),
        ]),
        measures: [
          {
            table: 'Region',
            name: 'Total Amount',
            expression: 'SUM(Region[Amount])',
            isHidden: false,
            annotations: {},
          },
        ],
      },
    ]);

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    const plan = result.plans[0];
    expect(plan?.source).toBe('new-calculated-table');
    expect(plan?.proposedDimensionTableName).toBe('Region Shared');
  });

  it('does not prefer a disconnected name-ranked table over stale relationship evidence', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Region', [col('Region', 'Region', 'string', { isKey: true })]),
        tbl('Managed Domain', [col('Managed Domain', 'Region', 'string', { isKey: true })]),
      ],
      [
        {
          id: 'stale-source-a-domain',
          fromTable: 'Source A',
          fromColumn: 'Region',
          toTable: 'Managed Domain',
          toColumn: 'Region',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToMany',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    const plan = result.plans[0];
    expect(plan?.source).toBe('existing-dimension');
    expect(plan?.proposedDimensionTableName).toBe('Managed Domain');
    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'relationship-repair-unsupported',
        relationshipId: 'stale-source-a-domain',
        reason: 'wrong-cardinality',
      }),
    ]);
    expect(plan?.writePlan).toEqual([]);
  });

  it('omits relationship writes that already exist on a reused dimension', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Dim Region', [col('Dim Region', 'Region', 'string', { isKey: true })]),
      ],
      [
        {
          id: 'source-a-region',
          fromTable: 'Source A',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    const createRelationships = result.plans[0]?.writePlan.find(
      (item) => item.action === 'create-relationships',
    );
    expect(createRelationships).toMatchObject({
      action: 'create-relationships',
      relationships: [
        {
          fromTable: 'Source B',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          cardinality: 'manyToOne',
          crossFilteringBehavior: 'single',
          isActive: true,
        },
      ],
    });
  });

  it('reuses a governed dimension named from the key stem when relationship coverage identifies it', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'CustomerKey', 'int64', { isKey: true })]),
        tbl('Source B', [col('Source B', 'CustomerKey', 'int64', { isKey: true })]),
        {
          ...tbl('Customer', [col('Customer', 'CustomerKey', 'int64', { isKey: true })]),
          measures: [
            {
              table: 'Customer',
              name: 'Customer Count',
              expression: 'COUNTROWS(Customer)',
              isHidden: false,
              annotations: {},
            },
          ],
        },
      ],
      [
        {
          id: 'source-a-customer',
          fromTable: 'Source A',
          fromColumn: 'CustomerKey',
          toTable: 'Customer',
          toColumn: 'CustomerKey',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['CustomerKey'],
    });

    const plan = result.plans[0];
    expect(plan?.source).toBe('existing-dimension');
    expect(plan?.proposedDimensionTableName).toBe('Customer');
    expect(plan?.writePlan.find((item) => item.action === 'create-relationships')).toMatchObject({
      action: 'create-relationships',
      relationships: [
        {
          fromTable: 'Source B',
          fromColumn: 'CustomerKey',
          toTable: 'Customer',
          toColumn: 'CustomerKey',
        },
      ],
    });
  });

  it('reuses a governed dimension through relationship key columns even when the key name differs from the fact axis', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'CustomerId', 'int64', { isKey: true })]),
        tbl('Source B', [col('Source B', 'CustomerId', 'int64', { isKey: true })]),
        tbl('Customer', [col('Customer', 'CustomerKey', 'int64', { isKey: true })]),
      ],
      [
        {
          id: 'source-a-customer',
          fromTable: 'Source A',
          fromColumn: 'CustomerId',
          toTable: 'Customer',
          toColumn: 'CustomerKey',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['CustomerId'],
    });

    const plan = result.plans[0];
    expect(plan?.source).toBe('existing-dimension');
    expect(plan?.proposedDimensionTableName).toBe('Customer');
    expect(plan?.dimensionKeyColumn).toBe('CustomerKey');
    expect(plan?.writePlan.find((item) => item.action === 'configure-dimension-key')).toMatchObject(
      {
        action: 'configure-dimension-key',
        tableName: 'Customer',
        columnName: 'CustomerKey',
      },
    );
    expect(plan?.writePlan.find((item) => item.action === 'create-relationships')).toMatchObject({
      action: 'create-relationships',
      relationships: [
        {
          fromTable: 'Source B',
          fromColumn: 'CustomerId',
          toTable: 'Customer',
          toColumn: 'CustomerKey',
        },
      ],
    });
  });

  it('reuses a governed dimension identified only by a nonconforming existing relationship', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'CustomerKey', 'int64', { isKey: true })]),
        tbl('Source B', [col('Source B', 'CustomerKey', 'int64', { isKey: true })]),
        tbl('Managed Domain', [col('Managed Domain', 'CustomerKey', 'int64', { isKey: true })]),
      ],
      [
        {
          id: 'inactive-source-a-customer',
          fromTable: 'Source A',
          fromColumn: 'CustomerKey',
          toTable: 'Managed Domain',
          toColumn: 'CustomerKey',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['CustomerKey'],
    });

    const plan = result.plans[0];
    expect(plan?.source).toBe('existing-dimension');
    expect(plan?.proposedDimensionTableName).toBe('Managed Domain');
    expect(plan?.writePlan.find((item) => item.action === 'repair-relationships')).toMatchObject({
      action: 'repair-relationships',
      relationships: [
        {
          id: 'inactive-source-a-customer',
          fromTable: 'Source A',
          fromColumn: 'CustomerKey',
          toTable: 'Managed Domain',
          toColumn: 'CustomerKey',
          reason: 'inactive',
        },
      ],
    });
    expect(plan?.writePlan.find((item) => item.action === 'create-relationships')).toMatchObject({
      action: 'create-relationships',
      relationships: [
        {
          fromTable: 'Source B',
          fromColumn: 'CustomerKey',
          toTable: 'Managed Domain',
          toColumn: 'CustomerKey',
        },
      ],
    });
  });

  it('plans repairs instead of duplicate creates for inactive or non-single existing relationships', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Dim Region', [col('Dim Region', 'Region', 'string', { isKey: true })]),
      ],
      [
        {
          id: 'inactive-source-a-region',
          fromTable: 'Source A',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
        {
          id: 'both-source-b-region',
          fromTable: 'Source B',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: true,
          crossFilteringBehavior: 'both',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    expect(result.plans[0]?.writePlan.find((item) => item.action === 'create-relationships')).toBe(
      undefined,
    );
    expect(
      result.plans[0]?.writePlan.find((item) => item.action === 'repair-relationships'),
    ).toMatchObject({
      action: 'repair-relationships',
      relationships: [
        {
          id: 'inactive-source-a-region',
          fromTable: 'Source A',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          reason: 'inactive',
        },
        {
          id: 'both-source-b-region',
          fromTable: 'Source B',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          reason: 'bidirectional',
        },
      ],
    });
  });

  it('blocks wrong-cardinality existing relationships instead of advertising executable repairs', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Dim Region', [col('Dim Region', 'Region', 'string', { isKey: true })]),
      ],
      [
        {
          id: 'many-to-many-source-a-region',
          fromTable: 'Source A',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToMany',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'relationship-repair-unsupported',
        axis: 'Region',
        relationshipId: 'many-to-many-source-a-region',
        reason: 'wrong-cardinality',
        fromTable: 'Source A',
        fromColumn: 'Region',
        toTable: 'Dim Region',
        toColumn: 'Region',
      }),
    ]);
    expect(
      result.plans[0]?.writePlan.find((item) => item.action === 'repair-relationships'),
    ).toBeUndefined();
  });

  it('blocks unknown-cardinality existing relationships instead of treating them as safe', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Dim Region', [col('Dim Region', 'Region', 'string', { isKey: true })]),
      ],
      [
        {
          id: 'unknown-cardinality-source-a-region',
          fromTable: 'Source A',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: true,
          crossFilteringBehavior: 'single',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'relationship-repair-unsupported',
        relationshipId: 'unknown-cardinality-source-a-region',
        reason: 'wrong-cardinality',
      }),
    ]);
    expect(
      result.plans[0]?.writePlan.find((item) => item.action === 'repair-relationships'),
    ).toBeUndefined();
  });

  it('blocks inactive and bidirectional wrong-cardinality relationships instead of repairing them', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Dim Region', [col('Dim Region', 'Region', 'string', { isKey: true })]),
      ],
      [
        {
          id: 'inactive-many-to-many',
          fromTable: 'Source A',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToMany',
        },
        {
          id: 'bidirectional-many-to-many',
          fromTable: 'Source B',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: true,
          crossFilteringBehavior: 'both',
          cardinality: 'manyToMany',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'relationship-repair-unsupported',
        relationshipId: 'inactive-many-to-many',
        reason: 'wrong-cardinality',
      }),
      expect.objectContaining({
        code: 'relationship-repair-unsupported',
        relationshipId: 'bidirectional-many-to-many',
        reason: 'wrong-cardinality',
      }),
    ]);
    expect(
      result.plans[0]?.writePlan.find((item) => item.action === 'repair-relationships'),
    ).toBeUndefined();
  });

  it('blocks reversed relationships because the current write path cannot safely repair orientation', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Dim Region', [col('Dim Region', 'Region', 'string', { isKey: true })]),
      ],
      [
        {
          id: 'reversed-inactive-one-to-many',
          fromTable: 'Dim Region',
          fromColumn: 'Region',
          toTable: 'Source A',
          toColumn: 'Region',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'oneToMany',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'relationship-repair-unsupported',
        relationshipId: 'reversed-inactive-one-to-many',
        reason: 'wrong-direction',
      }),
    ]);
    expect(
      result.plans[0]?.writePlan.find((item) => item.action === 'repair-relationships'),
    ).toBeUndefined();
  });

  it('blocks same-endpoint relationship repair when the relationship id is not proven', () => {
    const m = model(
      [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Dim Region', [col('Dim Region', 'Region', 'string', { isKey: true })]),
      ],
      [
        {
          id: 'rel_0',
          identityProven: false,
          fromTable: 'Source A',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'relationship-repair-unsupported',
        relationshipId: 'rel_0',
        reason: 'relationship-id-missing',
      }),
    ]);
    expect(
      result.plans[0]?.writePlan.find((item) => item.action === 'repair-relationships'),
    ).toBeUndefined();
  });

  it('blocks same-endpoint relationship repair when identity provenance is omitted', () => {
    const m: TMDLModel = {
      modelPath: '/',
      tables: [
        tbl('Source A', [col('Source A', 'Region', 'string')]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Dim Region', [col('Dim Region', 'Region', 'string', { isKey: true })]),
      ],
      relationships: [
        {
          id: 'rel_omitted',
          fromTable: 'Source A',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: false,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    };

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'relationship-repair-unsupported',
        relationshipId: 'rel_omitted',
        reason: 'relationship-id-missing',
      }),
    ]);
    expect(
      result.plans[0]?.writePlan.find((item) => item.action === 'repair-relationships'),
    ).toBeUndefined();
  });

  it('blocks relationship writes that would fail the relationship pre-write gate', () => {
    const m = model(
      [
        tbl('Source A', [
          col('Source A', 'Region', 'string'),
          col('Source A', 'Legacy Region', 'string'),
        ]),
        tbl('Source B', [col('Source B', 'Region', 'string')]),
        tbl('Dim Region', [col('Dim Region', 'Region', 'string', { isKey: true })]),
      ],
      [
        {
          id: 'source-b-region',
          fromTable: 'Source B',
          fromColumn: 'Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
        {
          id: 'source-a-legacy-region',
          fromTable: 'Source A',
          fromColumn: 'Legacy Region',
          toTable: 'Dim Region',
          toColumn: 'Region',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToOne',
        },
      ],
    );

    const result = planStarSchemaSharedDimensions(m, 'Source A', 'Source B', {
      axes: ['Region'],
    });

    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: 'relationship-write-blocked',
        action: 'create-relationship',
        fromTable: 'Source A',
        fromColumn: 'Region',
        toTable: 'Dim Region',
        toColumn: 'Region',
        blocking: [
          expect.objectContaining({
            code: 'ambiguous-active-path',
          }),
        ],
      }),
    ]);
    expect(
      result.plans[0]?.writePlan.find((item) => item.action === 'create-relationships'),
    ).toBeUndefined();
    expect(
      result.plans[0]?.writePlan.find((item) => item.action === 'hide-source-columns'),
    ).toBeUndefined();
  });

  it('returns blockers when either source table is missing', () => {
    const m = model([tbl('Present Source', [col('Present Source', 'Shared Code', 'string')])]);

    const result = planStarSchemaSharedDimensions(m, 'Present Source', 'Missing Source');

    expect(result.plans).toEqual([]);
    expect(result.blockers).toEqual([
      {
        code: 'table-not-found',
        table: 'Missing Source',
        message: 'Table not found: Missing Source',
      },
    ]);
  });
});
