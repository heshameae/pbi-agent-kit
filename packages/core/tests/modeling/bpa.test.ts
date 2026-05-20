import { describe, expect, it } from 'vitest';
import { runBPA } from '../../src/modeling/bpa.js';
import type { TMDLModel } from '../../src/modeling/types.js';

function makeModel(overrides: Partial<TMDLModel> = {}): TMDLModel {
  return {
    modelPath: '/virtual',
    tables: [],
    relationships: [],
    ...overrides,
  };
}

describe('BPA: DAX001 — DIVIDE over /', () => {
  it('flags raw / in measure expression', () => {
    const model = makeModel({
      tables: [
        {
          name: 'T',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [],
          measures: [
            {
              table: 'T',
              name: 'Ratio',
              expression: '[Num] / [Den]',
              isHidden: false,
              annotations: {},
            },
          ],
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'DAX001')).toBeTruthy();
  });

  it('passes when DIVIDE is used', () => {
    const model = makeModel({
      tables: [
        {
          name: 'T',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [],
          measures: [
            {
              table: 'T',
              name: 'Ratio',
              expression: 'DIVIDE([Num], [Den])',
              isHidden: false,
              annotations: {},
            },
          ],
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'DAX001')).toBeFalsy();
  });
});

describe('BPA: FMT001 — missing formatString', () => {
  it('flags visible measure without formatString', () => {
    const model = makeModel({
      tables: [
        {
          name: 'T',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [],
          measures: [
            { table: 'T', name: 'X', expression: 'SUM(T[X])', isHidden: false, annotations: {} },
          ],
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'FMT001')).toBeTruthy();
  });

  it('passes on hidden measure without formatString', () => {
    const model = makeModel({
      tables: [
        {
          name: 'T',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [],
          measures: [
            { table: 'T', name: 'X', expression: 'SUM(T[X])', isHidden: true, annotations: {} },
          ],
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'FMT001')).toBeFalsy();
  });
});

describe('BPA: FMT002 — quoted formatString', () => {
  it('flags formatString wrapped in triple quotes', () => {
    const model = makeModel({
      tables: [
        {
          name: 'T',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [],
          measures: [
            {
              table: 'T',
              name: 'X',
              expression: 'SUM(T[X])',
              isHidden: false,
              formatString: '"""$#,0;($#,0);$#,0"""',
              annotations: {},
            },
          ],
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'FMT002')).toBeTruthy();
  });
});

describe('BPA: MOD001 — auto date table', () => {
  it('flags presence of LocalDateTable_* tables', () => {
    const model = makeModel({
      tables: [
        {
          name: 'LocalDateTable_abc',
          isHidden: true,
          isCalculated: false,
          isAutoDateTable: true,
          columns: [],
          measures: [],
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'MOD001')).toBeTruthy();
  });
});

describe('BPA: NAM001 — measure/column collision', () => {
  it('flags measure whose name equals a host-table column', () => {
    const model = makeModel({
      tables: [
        {
          name: 'T',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [
            {
              table: 'T',
              name: 'Sales',
              dataType: 'decimal',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
          ],
          measures: [
            {
              table: 'T',
              name: 'Sales',
              expression: 'SUM(T[Sales])',
              isHidden: false,
              annotations: {},
            },
          ],
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'NAM001')).toBeTruthy();
  });
});

describe('BPA: MOD006 — string column summarizeBy != none', () => {
  it('flags string column with summarizeBy=count', () => {
    const model = makeModel({
      tables: [
        {
          name: 'T',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [
            {
              table: 'T',
              name: 'Region',
              dataType: 'string',
              summarizeBy: 'count',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
          ],
          measures: [],
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'MOD006')).toBeTruthy();
  });
});

describe('BPA: MOD003/MOD004 — m:m and bidirectional', () => {
  it('flags m:m and bidirectional outside m:m bridge', () => {
    const model = makeModel({
      tables: [
        {
          name: 'A',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [
            {
              table: 'A',
              name: 'k',
              dataType: 'int64',
              isHidden: false,
              isKey: true,
              isCalculated: false,
            },
          ],
          measures: [],
        },
        {
          name: 'B',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [
            {
              table: 'B',
              name: 'k',
              dataType: 'int64',
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
          id: 'r1',
          fromTable: 'A',
          fromColumn: 'k',
          toTable: 'B',
          toColumn: 'k',
          isActive: true,
          crossFilteringBehavior: 'single',
          cardinality: 'manyToMany',
        },
        {
          id: 'r2',
          fromTable: 'A',
          fromColumn: 'k',
          toTable: 'B',
          toColumn: 'k',
          isActive: false,
          crossFilteringBehavior: 'both',
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'MOD003')).toBeTruthy();
    expect(v.find((x) => x.ruleId === 'MOD004')).toBeTruthy();
  });
});

describe('BPA: DAX005 — reference existence', () => {
  it('does not flag valid table-qualified column references on another table', () => {
    const model = makeModel({
      tables: [
        {
          name: 'A',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [],
          measures: [
            {
              table: 'A',
              name: 'X',
              expression: 'SUM(B[Value])',
              isHidden: false,
              annotations: {},
            },
          ],
        },
        {
          name: 'B',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [
            {
              table: 'B',
              name: 'Value',
              dataType: 'decimal',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
          ],
          measures: [],
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'DAX005')).toBeFalsy();
  });

  it('flags a missing table-qualified reference', () => {
    const model = makeModel({
      tables: [
        {
          name: 'A',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [],
          measures: [
            {
              table: 'A',
              name: 'X',
              expression: 'SUM(B[Missing])',
              isHidden: false,
              annotations: {},
            },
          ],
        },
        {
          name: 'B',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [],
          measures: [],
        },
      ],
    });
    const v = runBPA(model);
    expect(v.find((x) => x.ruleId === 'DAX005')).toBeTruthy();
  });
});
