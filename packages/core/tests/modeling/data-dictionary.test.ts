import { describe, expect, it } from 'vitest';
import { buildDataDictionary } from '../../src/modeling/data-dictionary.js';
import type { TMDLModel } from '../../src/modeling/types.js';

function modelFixture(): TMDLModel {
  return {
    modelPath: '/semantic-model/definition',
    tables: [
      {
        name: 'Visible Table',
        isHidden: false,
        isCalculated: false,
        isAutoDateTable: false,
        description: 'Visible table description',
        columns: [
          {
            table: 'Visible Table',
            name: 'Visible Column',
            dataType: 'string',
            summarizeBy: 'none',
            sourceColumn: 'VisibleColumn',
            isHidden: false,
            isKey: false,
            isCalculated: false,
            description: 'Visible column description',
          },
          {
            table: 'Visible Table',
            name: 'Hidden Column',
            dataType: 'int64',
            summarizeBy: 'sum',
            sourceColumn: 'HiddenColumn',
            isHidden: true,
            isKey: false,
            isCalculated: false,
          },
          {
            table: 'Visible Table',
            name: 'Calculated Column',
            dataType: 'int64',
            summarizeBy: 'sum',
            isHidden: false,
            isKey: false,
            isCalculated: true,
            expression: '[Visible Measure] + 1',
          },
        ],
        measures: [
          {
            table: 'Visible Table',
            name: 'Visible Measure',
            expression: 'COUNTROWS(' + "'Visible Table'" + ')',
            formatString: '#,0',
            isHidden: false,
            annotations: {},
          },
          {
            table: 'Visible Table',
            name: 'Hidden Measure',
            expression: '[Visible Measure]',
            isHidden: true,
            annotations: {},
          },
        ],
      },
      {
        name: 'Other Table',
        isHidden: false,
        isCalculated: false,
        isAutoDateTable: false,
        columns: [
          {
            table: 'Other Table',
            name: 'Other Key',
            dataType: 'int64',
            summarizeBy: 'none',
            isHidden: false,
            isKey: true,
            isCalculated: false,
          },
        ],
        measures: [],
      },
    ],
    relationships: [
      {
        id: 'rel-visible-other',
        fromTable: 'Visible Table',
        fromColumn: 'Visible Column',
        toTable: 'Other Table',
        toColumn: 'Other Key',
        isActive: true,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      },
      {
        id: 'rel-hidden-other',
        fromTable: 'Visible Table',
        fromColumn: 'Hidden Column',
        toTable: 'Other Table',
        toColumn: 'Other Key',
        isActive: false,
        crossFilteringBehavior: 'single',
        cardinality: 'manyToOne',
      },
    ],
  };
}

describe('buildDataDictionary', () => {
  it('excludes hidden columns and measures by default and omits expressions', () => {
    const dictionary = buildDataDictionary(modelFixture());

    expect(dictionary.counts).toEqual({
      tables: 2,
      fields: 3,
      measures: 1,
      relationships: 1,
    });
    // Tables are emitted in canonical code-unit name order ("Other Table" < "Visible
    // Table"), so fields flatten in that order; within a table, column order is preserved.
    expect(dictionary.fields.map((field) => field.name)).toEqual([
      'Other Key',
      'Visible Column',
      'Calculated Column',
    ]);
    expect(dictionary.measures.map((measure) => measure.name)).toEqual(['Visible Measure']);
    expect(dictionary.fields.some((field) => field.name === 'Hidden Column')).toBe(false);
    expect(dictionary.measures.some((measure) => measure.name === 'Hidden Measure')).toBe(false);
    expect(
      dictionary.fields.find((field) => field.name === 'Calculated Column'),
    ).not.toHaveProperty('expression');
    expect(dictionary.measures[0]).not.toHaveProperty('expression');
    expect(dictionary.tables[0]?.fields).toEqual([]);
    expect(dictionary.tables[0]?.measures).toEqual([]);
    expect(dictionary.relationships.map((relationship) => relationship.id)).toEqual([
      'rel-visible-other',
    ]);
  });

  it('can include hidden fields, measures, and relationships', () => {
    const dictionary = buildDataDictionary(modelFixture(), { includeHidden: true });

    expect(dictionary.counts).toMatchObject({
      fields: 4,
      measures: 2,
      relationships: 2,
    });
    expect(dictionary.fields.map((field) => field.name)).toContain('Hidden Column');
    expect(dictionary.measures.map((measure) => measure.name)).toContain('Hidden Measure');
    expect(dictionary.relationships.map((relationship) => relationship.fromRef)).toContain(
      'Visible Table[Hidden Column]',
    );
  });

  it('can include nested table fields and measures when requested', () => {
    const dictionary = buildDataDictionary(modelFixture(), { includeNested: true });

    // Tables are sorted by name; find the Visible Table rather than assuming index 0.
    const visible = dictionary.tables.find((table) => table.name === 'Visible Table');
    expect(visible?.fields.map((field) => field.name)).toEqual([
      'Visible Column',
      'Calculated Column',
    ]);
    expect(visible?.measures.map((measure) => measure.name)).toEqual(['Visible Measure']);
  });

  it('can filter the payload to selected tables', () => {
    const dictionary = buildDataDictionary(modelFixture(), { tableNames: ['Other Table'] });

    expect(dictionary.counts).toEqual({
      tables: 1,
      fields: 1,
      measures: 0,
      relationships: 0,
    });
    expect(dictionary.tables.map((table) => table.name)).toEqual(['Other Table']);
    expect(dictionary.fields.map((field) => field.ref)).toEqual(['Other Table[Other Key]']);
  });

  it('can filter the payload to selected refs', () => {
    const dictionary = buildDataDictionary(modelFixture(), {
      refs: ['Visible Table[Visible Measure]', 'Other Table[Other Key]'],
    });

    expect(dictionary.counts).toEqual({
      tables: 2,
      fields: 1,
      measures: 1,
      relationships: 0,
    });
    expect(dictionary.tables.map((table) => table.name)).toEqual(['Other Table', 'Visible Table']);
    expect(dictionary.fields.map((field) => field.ref)).toEqual(['Other Table[Other Key]']);
    expect(dictionary.measures.map((measure) => measure.ref)).toEqual([
      'Visible Table[Visible Measure]',
    ]);
  });

  it('can include DAX expressions', () => {
    const dictionary = buildDataDictionary(modelFixture(), { includeExpressions: true });

    expect(dictionary.fields.find((field) => field.name === 'Calculated Column')?.expression).toBe(
      '[Visible Measure] + 1',
    );
    expect(
      dictionary.measures.find((measure) => measure.name === 'Visible Measure')?.expression,
    ).toBe("COUNTROWS('Visible Table')");
  });

  it('returns canonical field and relationship refs as Table[Field]', () => {
    const dictionary = buildDataDictionary(modelFixture());

    expect(dictionary.fields.map((field) => field.ref)).toEqual([
      'Other Table[Other Key]',
      'Visible Table[Visible Column]',
      'Visible Table[Calculated Column]',
    ]);
    expect(dictionary.measures[0]?.ref).toBe('Visible Table[Visible Measure]');
    expect(dictionary.relationships[0]).toMatchObject({
      fromRef: 'Visible Table[Visible Column]',
      toRef: 'Other Table[Other Key]',
    });
  });
});
