import { describe, expect, it } from 'vitest';
import { daxReferenceCheck } from '../../src/modeling/dax-reference-check.js';
import type { TMDLModel } from '../../src/modeling/types.js';

function model(): TMDLModel {
  return {
    modelPath: '/virtual',
    relationships: [],
    tables: [
      {
        name: 'FactPrimary',
        isHidden: false,
        isCalculated: false,
        isAutoDateTable: false,
        columns: [
          {
            table: 'FactPrimary',
            name: 'ValueMetric',
            dataType: 'decimal',
            isHidden: false,
            isKey: false,
            isCalculated: false,
          },
        ],
        measures: [
          {
            table: 'FactPrimary',
            name: 'BaseMeasure',
            expression: 'SUM(FactPrimary[ValueMetric])',
            formatString: '#,##0',
            isHidden: false,
            annotations: {},
          },
        ],
      },
      {
        name: 'FactSecondary',
        isHidden: false,
        isCalculated: false,
        isAutoDateTable: false,
        columns: [
          {
            table: 'FactSecondary',
            name: 'PlanMetric',
            dataType: 'decimal',
            isHidden: false,
            isKey: false,
            isCalculated: false,
          },
        ],
        measures: [
          {
            table: 'FactSecondary',
            name: 'BaseMeasure',
            expression: 'SUM(FactSecondary[PlanMetric])',
            formatString: '#,##0',
            isHidden: false,
            annotations: {},
          },
        ],
      },
    ],
  };
}

describe('daxReferenceCheck assumeUnknownMeasuresExist', () => {
  it('allows an unknown measure reference when measures are not enumerable', () => {
    // [Total Profit] is not in the (incompletely enumerated) model.
    const lenient = daxReferenceCheck('CALCULATE([Total Profit], ALL(FactPrimary))', model(), {
      hostTable: 'FactPrimary',
      assumeUnknownMeasuresExist: true,
    });
    expect(lenient.valid).toBe(true);
    // Without the flag, the same unknown measure ref is refused (default behavior).
    const strict = daxReferenceCheck('CALCULATE([Total Profit], ALL(FactPrimary))', model(), {
      hostTable: 'FactPrimary',
    });
    expect(strict.valid).toBe(false);
  });

  it('still catches a missing TABLE even when measures are not enumerable', () => {
    const result = daxReferenceCheck("SUM('NoSuchTable'[X])", model(), {
      hostTable: 'FactPrimary',
      assumeUnknownMeasuresExist: true,
    });
    expect(result.valid).toBe(false);
    expect(result.missing.some((m) => m.raw === 'NoSuchTable[X]')).toBe(true);
  });
});

describe('daxReferenceCheck', () => {
  it('passes existing qualified columns and same-table bare measures', () => {
    expect(
      daxReferenceCheck('SUM(FactPrimary[ValueMetric]) + [BaseMeasure]', model(), {
        hostTable: 'FactPrimary',
      }).valid,
    ).toBe(true);
  });

  it('reports missing qualified references', () => {
    const result = daxReferenceCheck('SUM(FactPrimary[MissingField])', model(), {
      hostTable: 'FactPrimary',
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContainEqual({
      table: 'FactPrimary',
      name: 'MissingField',
      raw: 'FactPrimary[MissingField]',
    });
  });

  it('reports ambiguous bare measures', () => {
    const result = daxReferenceCheck('[BaseMeasure]', model());
    expect(result.valid).toBe(false);
    expect(result.ambiguous[0]?.name).toBe('BaseMeasure');
  });

  it('ignores references in strings and comments', () => {
    const result = daxReferenceCheck(
      '"FactPrimary[MissingField]" // [AlsoMissing]\nSUM(FactPrimary[ValueMetric])',
      model(),
      { hostTable: 'FactPrimary' },
    );
    expect(result.valid).toBe(true);
  });

  it('accepts uncommitted measures in the same connection batch', () => {
    const result = daxReferenceCheck('[NewMeasureA] + 1', model(), {
      hostTable: 'FactPrimary',
      uncommittedMeasures: [{ table: 'FactPrimary', name: 'NewMeasureA' }],
    });
    expect(result.valid).toBe(true);
  });
});
