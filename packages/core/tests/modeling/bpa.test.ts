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

// --- compact builders for the new (Tier 1-3) rule tests -------------------

interface ColOpts {
  dataType?: string;
  summarizeBy?: string;
  sourceColumn?: string;
  dataCategory?: string;
  formatString?: string;
  isHidden?: boolean;
  isKey?: boolean;
  isCalculated?: boolean;
  // Wave 2 optional metadata.
  expression?: string;
  description?: string;
  displayFolder?: string;
  sortByColumn?: string;
  isAvailableInMdx?: boolean;
}
function c(table: string, name: string, o: ColOpts = {}) {
  return {
    table,
    name,
    dataType: o.dataType ?? 'string',
    summarizeBy: o.summarizeBy,
    sourceColumn: o.sourceColumn,
    dataCategory: o.dataCategory,
    formatString: o.formatString,
    isHidden: o.isHidden ?? false,
    isKey: o.isKey ?? false,
    isCalculated: o.isCalculated ?? false,
    expression: o.expression,
    description: o.description,
    displayFolder: o.displayFolder,
    sortByColumn: o.sortByColumn,
    isAvailableInMdx: o.isAvailableInMdx,
  };
}
interface MeasOpts {
  formatString?: string;
  isHidden?: boolean;
  description?: string;
  displayFolder?: string;
}
function meas(table: string, name: string, expression: string, o: MeasOpts = {}) {
  return {
    table,
    name,
    expression,
    formatString: o.formatString,
    isHidden: o.isHidden ?? false,
    description: o.description,
    displayFolder: o.displayFolder,
    annotations: {},
  };
}
interface TblOpts {
  columns?: ReturnType<typeof c>[];
  measures?: ReturnType<typeof meas>[];
  isHidden?: boolean;
  isCalculated?: boolean;
  isAutoDateTable?: boolean;
  description?: string;
  storageMode?: 'import' | 'directQuery' | 'dual' | 'directLake';
  dataCategory?: string;
  expression?: string;
  partitionSources?: ReadonlyArray<{ readonly kind?: string; readonly expression: string }>;
}
function tbl(name: string, o: TblOpts = {}) {
  return {
    name,
    columns: o.columns ?? [],
    measures: o.measures ?? [],
    isHidden: o.isHidden ?? false,
    isCalculated: o.isCalculated ?? false,
    isAutoDateTable: o.isAutoDateTable ?? false,
    description: o.description,
    storageMode: o.storageMode,
    dataCategory: o.dataCategory,
    expression: o.expression,
    partitionSources: o.partitionSources,
  };
}
function rel(
  id: string,
  fromTable: string,
  fromColumn: string,
  toTable: string,
  toColumn: string,
  o: {
    cardinality?: 'manyToOne' | 'oneToMany' | 'oneToOne' | 'manyToMany';
    cross?: 'single' | 'both';
    isActive?: boolean;
    relyOnReferentialIntegrity?: boolean;
  } = {},
) {
  return {
    id,
    fromTable,
    fromColumn,
    toTable,
    toColumn,
    isActive: o.isActive ?? true,
    crossFilteringBehavior: o.cross ?? ('single' as const),
    cardinality: o.cardinality ?? ('manyToOne' as const),
    relyOnReferentialIntegrity: o.relyOnReferentialIntegrity,
  };
}
// A reusable single-dimension fact (many side + summarizable column + a measure).
function factTable(name: string, opts: { extraCols?: ReturnType<typeof c>[] } = {}) {
  return tbl(name, {
    columns: [
      c(name, 'DimKey', { dataType: 'int64', summarizeBy: 'none' }),
      c(name, 'Amount', { dataType: 'decimal', summarizeBy: 'sum', formatString: '#,0' }),
      ...(opts.extraCols ?? []),
    ],
    measures: [meas(name, `Total ${name}`, `SUM(${name}[Amount])`, { formatString: '#,0' })],
  });
}
function dimTable(name: string, extraCols: ReturnType<typeof c>[] = []) {
  return tbl(name, {
    columns: [c(name, 'DimKey', { dataType: 'int64', isKey: true }), ...extraCols],
  });
}
const has = (vs: ReturnType<typeof runBPA>, id: string) => vs.find((x) => x.ruleId === id);

describe('BPA severity recalibrations (FINAL contract)', () => {
  it('FMT001 (missing measure format) is now error', () => {
    const model = makeModel({
      tables: [tbl('T', { measures: [meas('T', 'X', 'SUM(T[X])')] })],
    });
    const f = has(runBPA(model), 'FMT001');
    expect(f?.severity).toBe('error');
  });

  it('MOD002 (inactive rel, no USERELATIONSHIP) is now warning', () => {
    const model = makeModel({
      tables: [dimTable('A'), dimTable('B')],
      relationships: [rel('r', 'A', 'DimKey', 'B', 'DimKey', { isActive: false })],
    });
    const f = has(runBPA(model), 'MOD002');
    expect(f?.severity).toBe('warning');
  });

  it('MOD005 (visible FK) is now warning', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', { columns: [c('Fact', 'DimKey', { dataType: 'int64', isHidden: false })] }),
        tbl('Dim', {
          columns: [c('Dim', 'DimKey', { dataType: 'int64', isKey: true, isHidden: true })],
        }),
      ],
      relationships: [rel('r', 'Fact', 'DimKey', 'Dim', 'DimKey')],
    });
    const f = has(runBPA(model), 'MOD005');
    expect(f?.severity).toBe('warning');
  });

  it('MOD005 escalates duplicate visible fact-side FK fields to error', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', { columns: [c('Fact', 'Business Axis', { dataType: 'string' })] }),
        tbl('Business Axis', {
          columns: [c('Business Axis', 'Business Axis', { dataType: 'string', isKey: true })],
        }),
      ],
      relationships: [rel('r', 'Fact', 'Business Axis', 'Business Axis', 'Business Axis')],
    });

    const f = has(runBPA(model), 'MOD005');
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain('source-of-truth');
  });

  it('DAX003 (IFERROR) is now warning', () => {
    const model = makeModel({
      tables: [tbl('T', { measures: [meas('T', 'X', 'IFERROR(1/0, 0)', { formatString: '0' })] })],
    });
    const f = has(runBPA(model), 'DAX003');
    expect(f?.severity).toBe('warning');
  });
});

describe('BPA MOD003 — m:m fold (A9)', () => {
  it('escalates an unbridged bidirectional m:m to error (between two dimTables)', () => {
    // INTENDED behavior change (Wave 2): a bidirectional m:m with NEITHER
    // endpoint a real bridge table is now an ERROR (ambiguous propagation that
    // corrupts results), not a warning. Neither dimTable here is a bridge (only
    // one relationship touches them), so this escalates.
    const model = makeModel({
      tables: [dimTable('A'), dimTable('B')],
      relationships: [
        rel('r', 'A', 'DimKey', 'B', 'DimKey', { cardinality: 'manyToMany', cross: 'both' }),
      ],
    });
    const f = has(runBPA(model), 'MOD003');
    expect(f).toBeTruthy();
    expect(f?.severity).toBe('error');
    expect(f?.message).toMatch(/single-direction/i);
    expect(f?.message).toMatch(/bidirectional/i);
  });

  it('keeps a bidirectional m:m through a proper bridge table as a warning', () => {
    // Bridge = to-side of EXACTLY two relationships, no measures, all key-like
    // columns. A bidi m:m INTO such a bridge stays a warning (the legitimate
    // many-to-many-via-bridge pattern).
    const model = makeModel({
      tables: [
        dimTable('Customer'),
        dimTable('Account'),
        tbl('CustomerAccountBridge', {
          columns: [
            c('CustomerAccountBridge', 'CustomerKey', { dataType: 'int64', summarizeBy: 'none' }),
            c('CustomerAccountBridge', 'AccountKey', { dataType: 'int64', summarizeBy: 'none' }),
          ],
        }),
      ],
      relationships: [
        // The bridge is the to-side of two relationships.
        rel('r1', 'Customer', 'DimKey', 'CustomerAccountBridge', 'CustomerKey', {
          cardinality: 'manyToMany',
          cross: 'both',
        }),
        rel('r2', 'Account', 'DimKey', 'CustomerAccountBridge', 'AccountKey'),
      ],
    });
    const m2m = runBPA(model).filter((x) => x.ruleId === 'MOD003');
    expect(m2m.length).toBeGreaterThanOrEqual(1);
    expect(m2m.every((f) => f.severity === 'warning')).toBe(true);
  });
});

describe('BPA MOD008 — orphan table (tri-state)', () => {
  it('does not flag a fully connected star', () => {
    const model = makeModel({
      tables: [factTable('FactPrimary'), dimTable('DimShared')],
      relationships: [rel('r', 'FactPrimary', 'DimKey', 'DimShared', 'DimKey')],
    });
    expect(has(runBPA(model), 'MOD008')).toBeFalsy();
  });

  it('error for a fully disconnected fact-like table (measures + quantity columns)', () => {
    // FactOrphan carries a measure + an aggregatable quantity column but sits on
    // no relationship → an isolated data island (error). An orphan can never
    // satisfy the relationship-based classifier, so MOD008 uses INTRINSIC
    // fact-likeness (shape only).
    const model = makeModel({
      tables: [
        factTable('FactPrimary'),
        dimTable('DimShared'),
        tbl('FactOrphan', {
          columns: [
            c('FactOrphan', 'OtherKey', { dataType: 'int64', summarizeBy: 'none' }),
            c('FactOrphan', 'Qty', {
              dataType: 'decimal',
              summarizeBy: 'sum',
              formatString: '#,0',
            }),
          ],
          measures: [
            meas('FactOrphan', 'Total Qty', 'SUM(FactOrphan[Qty])', { formatString: '#,0' }),
          ],
        }),
      ],
      relationships: [rel('r', 'FactPrimary', 'DimKey', 'DimShared', 'DimKey')],
    });
    const orphan = has(runBPA(model), 'MOD008');
    expect(orphan?.object).toContain('FactOrphan');
    expect(orphan?.severity).toBe('error');
  });

  it('info for a deliberate single-column disconnected table', () => {
    const model = makeModel({
      tables: [
        factTable('FactPrimary'),
        dimTable('DimShared'),
        tbl('WhatIfParam', { columns: [c('WhatIfParam', 'Value', { dataType: 'decimal' })] }),
      ],
      relationships: [rel('r', 'FactPrimary', 'DimKey', 'DimShared', 'DimKey')],
    });
    const f = has(runBPA(model), 'MOD008');
    expect(f?.object).toContain('WhatIfParam');
    expect(f?.severity).toBe('info');
  });

  it('warning for a non-fact, non-deliberate orphan', () => {
    const model = makeModel({
      tables: [
        factTable('FactPrimary'),
        dimTable('DimShared'),
        tbl('LooseDim', {
          columns: [c('LooseDim', 'A'), c('LooseDim', 'B'), c('LooseDim', 'C')],
        }),
      ],
      relationships: [rel('r', 'FactPrimary', 'DimKey', 'DimShared', 'DimKey')],
    });
    const f = has(runBPA(model), 'MOD008');
    expect(f?.object).toContain('LooseDim');
    expect(f?.severity).toBe('warning');
  });
});

describe('BPA MOD009 — fact-to-fact', () => {
  it('errors when both endpoints are fact-like', () => {
    // Two facts directly related to each other (and each also to a dim so they
    // classify as facts via fan-out + summarizable columns).
    const model = makeModel({
      tables: [
        factTable('FactA', {
          extraCols: [c('FactA', 'BKey', { dataType: 'int64', summarizeBy: 'none' })],
        }),
        factTable('FactB'),
        dimTable('DimShared'),
      ],
      relationships: [
        rel('r1', 'FactA', 'DimKey', 'DimShared', 'DimKey'),
        rel('r2', 'FactB', 'DimKey', 'DimShared', 'DimKey'),
        // direct fact-to-fact edge
        rel('r3', 'FactA', 'BKey', 'FactB', 'DimKey'),
      ],
    });
    const f = has(runBPA(model), 'MOD009');
    expect(f).toBeTruthy();
    expect(f?.severity).toBe('error');
  });
});

describe('BPA MOD010 — missing conformed dimension', () => {
  it('warns when two facts share a categorical column with no path', () => {
    const model = makeModel({
      tables: [
        tbl('FactA', {
          columns: [
            c('FactA', 'AKeyDim', { dataType: 'int64', summarizeBy: 'none' }),
            c('FactA', 'Amount', { dataType: 'decimal', summarizeBy: 'sum', formatString: '#,0' }),
            c('FactA', 'Region', { dataType: 'string' }),
          ],
          measures: [meas('FactA', 'Total A', 'SUM(FactA[Amount])', { formatString: '#,0' })],
        }),
        tbl('FactB', {
          columns: [
            c('FactB', 'BKeyDim', { dataType: 'int64', summarizeBy: 'none' }),
            c('FactB', 'Amount', { dataType: 'decimal', summarizeBy: 'sum', formatString: '#,0' }),
            c('FactB', 'Region', { dataType: 'string' }),
          ],
          measures: [meas('FactB', 'Total B', 'SUM(FactB[Amount])', { formatString: '#,0' })],
        }),
        dimTable('DimA'),
        dimTable('DimB'),
      ],
      relationships: [
        rel('r1', 'FactA', 'AKeyDim', 'DimA', 'DimKey'),
        rel('r2', 'FactB', 'BKeyDim', 'DimB', 'DimKey'),
      ],
    });
    const f = has(runBPA(model), 'MOD010');
    expect(f).toBeTruthy();
    expect(f?.severity).toBe('warning');
    expect(f?.message).toMatch(/Region/);
  });
});

describe('BPA MOD011 — strict relationship datatype mismatch', () => {
  it('warns on int64 vs decimal (compatible-to-write but mismatched)', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', { columns: [c('Fact', 'K', { dataType: 'int64' })] }),
        tbl('Dim', { columns: [c('Dim', 'K', { dataType: 'decimal', isKey: true })] }),
      ],
      relationships: [rel('r', 'Fact', 'K', 'Dim', 'K')],
    });
    const f = has(runBPA(model), 'MOD011');
    expect(f).toBeTruthy();
    expect(f?.severity).toBe('warning');
  });

  it('does not flag identical types', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', { columns: [c('Fact', 'K', { dataType: 'int64' })] }),
        tbl('Dim', { columns: [c('Dim', 'K', { dataType: 'int64', isKey: true })] }),
      ],
      relationships: [rel('r', 'Fact', 'K', 'Dim', 'K')],
    });
    expect(has(runBPA(model), 'MOD011')).toBeFalsy();
  });
});

describe('BPA MOD012 — snowflake', () => {
  it('warns on a dim that is both from-side and to-side', () => {
    const model = makeModel({
      tables: [
        factTable('Fact', {
          extraCols: [c('Fact', 'SubKey', { dataType: 'int64', summarizeBy: 'none' })],
        }),
        tbl('SubCategory', {
          columns: [
            c('SubCategory', 'SubKey', { dataType: 'int64', isKey: true }),
            c('SubCategory', 'CatKey', { dataType: 'int64', summarizeBy: 'none' }),
          ],
        }),
        dimTable('Category'),
        dimTable('DimShared'),
      ],
      relationships: [
        rel('r0', 'Fact', 'DimKey', 'DimShared', 'DimKey'),
        rel('r1', 'Fact', 'SubKey', 'SubCategory', 'SubKey'),
        rel('r2', 'SubCategory', 'CatKey', 'Category', 'DimKey'),
      ],
    });
    const f = has(runBPA(model), 'MOD012');
    expect(f).toBeTruthy();
    expect(f?.object).toContain('SubCategory');
    expect(f?.severity).toBe('warning');
  });
});

describe('BPA MOD013 — excessive bidi/m2m ratio', () => {
  it('emits one model-level finding when >30% of rels are bidi/m2m', () => {
    const model = makeModel({
      tables: [dimTable('A'), dimTable('B'), dimTable('C')],
      relationships: [
        rel('r1', 'A', 'DimKey', 'B', 'DimKey', { cross: 'both' }),
        rel('r2', 'B', 'DimKey', 'C', 'DimKey'),
      ],
    });
    const findings = runBPA(model).filter((x) => x.ruleId === 'MOD013');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
  });
});

describe('BPA MOD014 — numeric key summarizeBy', () => {
  it('errors on a visible numeric key column that aggregates', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', {
          columns: [c('Fact', 'ProductKey', { dataType: 'int64', summarizeBy: 'sum' })],
        }),
      ],
    });
    const f = has(runBPA(model), 'MOD014');
    expect(f).toBeTruthy();
    expect(f?.severity).toBe('error');
  });

  it('does not flag a real measure-able quantity (non key-like name)', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', {
          columns: [
            c('Fact', 'Revenue', { dataType: 'decimal', summarizeBy: 'sum', formatString: '#,0' }),
          ],
        }),
      ],
    });
    expect(has(runBPA(model), 'MOD014')).toBeFalsy();
  });
});

describe('BPA FMT003 / FMT004 — column formatting', () => {
  it('FMT003 warns on a visible numeric column without a format', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', {
          columns: [c('Fact', 'Amount', { dataType: 'decimal', summarizeBy: 'sum' })],
        }),
      ],
    });
    const f = has(runBPA(model), 'FMT003');
    expect(f?.severity).toBe('warning');
  });

  it('FMT004 warns on a double column', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', {
          columns: [c('Fact', 'Ratio', { dataType: 'double', formatString: '0.00' })],
        }),
      ],
    });
    const f = has(runBPA(model), 'FMT004');
    expect(f?.severity).toBe('warning');
  });
});

describe('BPA MODB1 / MODB2 — date table', () => {
  it('MODB1 warns when there is a date column but no marked date table', () => {
    const model = makeModel({
      tables: [tbl('Sales', { columns: [c('Sales', 'OrderDate', { dataType: 'dateTime' })] })],
    });
    const f = has(runBPA(model), 'MODB1');
    expect(f?.severity).toBe('warning');
  });

  it('MODB1 passes when a table is marked dataCategory Time with a date key', () => {
    const model = makeModel({
      tables: [
        tbl('Date', {
          columns: [c('Date', 'TheDate', { dataType: 'dateTime', isKey: true })],
          dataCategory: 'Time',
        }),
      ],
    });
    expect(has(runBPA(model), 'MODB1')).toBeFalsy();
    expect(has(runBPA(model), 'MODB2')).toBeFalsy();
  });

  it('MODB1 passes when a date column is marked dataCategory Time', () => {
    const model = makeModel({
      tables: [
        tbl('Date', {
          columns: [c('Date', 'TheDate', { dataType: 'dateTime', dataCategory: 'Time' })],
        }),
      ],
    });
    expect(has(runBPA(model), 'MODB1')).toBeFalsy();
  });

  it('MODB2 warns on a Calendar-named table not marked as date table', () => {
    const model = makeModel({
      tables: [tbl('Calendar', { columns: [c('Calendar', 'TheDate', { dataType: 'dateTime' })] })],
    });
    const f = has(runBPA(model), 'MODB2');
    expect(f?.severity).toBe('warning');
  });
});

describe('BPA MOD029 — date table calendar bounds', () => {
  it('errors when a date table uses literal hardcoded CALENDAR bounds', () => {
    const model = makeModel({
      tables: [
        tbl('Calendar', {
          dataCategory: 'Time',
          columns: [
            c('Calendar', 'Date', { dataType: 'dateTime', isKey: true, dataCategory: 'Time' }),
          ],
          expression: 'CALENDAR(DATE(2020,1,1), DATE(2026,12,31))',
        }),
      ],
    });

    const f = has(runBPA(model), 'MOD029');
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain('literal hardcoded calendar bounds');
  });

  it('reports one MOD029 finding when the same Date source appears with different source-kind metadata', () => {
    const model = makeModel({
      tables: [
        tbl('Calendar', {
          dataCategory: 'Time',
          columns: [c('Calendar', 'Date', { dataType: 'dateTime', isKey: true })],
          expression: 'CALENDAR(DATE(2020, 1, 1), DATE(2026, 12, 31))',
          partitionSources: [
            { expression: 'CALENDAR(DATE(2020, 1, 1), DATE(2026, 12, 31))' },
            { kind: 'm', expression: 'CALENDAR(DATE(2020, 1, 1), DATE(2026, 12, 31))' },
          ],
        }),
      ],
    });

    expect(runBPA(model).filter((finding) => finding.ruleId === 'MOD029')).toHaveLength(1);
  });

  it('errors when a date table uses TODAY/NOW as a volatile calendar anchor', () => {
    const model = makeModel({
      tables: [
        tbl('Calendar', {
          dataCategory: 'Time',
          columns: [c('Calendar', 'Date', { dataType: 'dateTime', isKey: true })],
          expression: "CALENDAR(MIN('Events'[EventDate]), DATE(YEAR(TODAY()) + 1, 12, 31))",
        }),
      ],
    });

    const f = has(runBPA(model), 'MOD029');
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain('volatile current-date anchor');
  });

  it('passes when a date table is anchored to observed fact min/max expressions', () => {
    const model = makeModel({
      tables: [
        tbl('Events', { columns: [c('Events', 'EventDate', { dataType: 'dateTime' })] }),
        tbl('Calendar', {
          dataCategory: 'Time',
          columns: [c('Calendar', 'Date', { dataType: 'dateTime', isKey: true })],
          expression:
            "CALENDAR(MINX('Events', 'Events'[EventDate]), MAXX('Events', 'Events'[EventDate]))",
        }),
      ],
    });

    expect(has(runBPA(model), 'MOD029')).toBeFalsy();
  });

  it('does not flag literal dates on non-calendar business tables', () => {
    const model = makeModel({
      tables: [
        tbl('Rates', {
          expression: 'ROW("EffectiveDate", DATE(2020,1,1), "Rate", 0.15)',
          columns: [c('Rates', 'EffectiveDate', { dataType: 'dateTime' })],
        }),
      ],
    });

    expect(has(runBPA(model), 'MOD029')).toBeFalsy();
  });
});

describe('BPA NAM002 — name hygiene', () => {
  it('errors on a leading/trailing space in a name', () => {
    const model = makeModel({ tables: [tbl(' Sales ')] });
    const f = has(runBPA(model), 'NAM002');
    expect(f?.severity).toBe('error');
  });

  it('warns on a Fact/Dim prefix', () => {
    const model = makeModel({ tables: [tbl('FactSales')] });
    const f = has(runBPA(model), 'NAM002');
    expect(f?.severity).toBe('warning');
  });

  it('passes a clean business name', () => {
    const model = makeModel({ tables: [tbl('Sales')] });
    expect(has(runBPA(model), 'NAM002')).toBeFalsy();
  });
});

describe('BPA E1 / E2 — error prevention', () => {
  it('E1 errors on a data column without sourceColumn when the model uses sourceColumn', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          columns: [
            c('T', 'Good', { sourceColumn: 'Good' }),
            c('T', 'Bad'), // no sourceColumn, not calculated
          ],
        }),
      ],
    });
    const e1 = runBPA(model).filter((x) => x.ruleId === 'E1');
    expect(e1).toHaveLength(1);
    expect(e1[0]?.object).toContain('Bad');
    expect(e1[0]?.severity).toBe('error');
  });

  it('E1 stays silent when the model expresses no column sources at all', () => {
    const model = makeModel({ tables: [tbl('T', { columns: [c('T', 'A'), c('T', 'B')] })] });
    expect(has(runBPA(model), 'E1')).toBeFalsy();
  });

  it('E2 errors on a measure with a blank expression', () => {
    const model = makeModel({ tables: [tbl('T', { measures: [meas('T', 'Empty', '   ')] })] });
    const f = has(runBPA(model), 'E2');
    expect(f?.severity).toBe('error');
  });
});

describe('BPA DAX006-011 — expression hygiene', () => {
  it('DAX006 errors on an unqualified column reference', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [c('Sales', 'Amount', { dataType: 'decimal', summarizeBy: 'sum' })],
          // [Amount] is a column, referenced bare → must be qualified.
          measures: [meas('Sales', 'Total', 'SUM([Amount])', { formatString: '#,0' })],
        }),
      ],
    });
    const f = has(runBPA(model), 'DAX006');
    expect(f?.severity).toBe('error');
  });

  it('DAX007 errors on a table-qualified measure reference', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [
            c('Sales', 'Amount', { dataType: 'decimal', summarizeBy: 'sum', formatString: '#,0' }),
          ],
          measures: [
            meas('Sales', 'Total', "SUM('Sales'[Amount])", { formatString: '#,0' }),
            // references the measure [Total] but qualifies it — disallowed.
            meas('Sales', 'Double', "'Sales'[Total] * 2", { formatString: '#,0' }),
          ],
        }),
      ],
    });
    const f = has(runBPA(model), 'DAX007');
    expect(f?.severity).toBe('error');
  });

  it('DAX008 warns on duplicate measure definitions', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [
            c('Sales', 'Amount', { dataType: 'decimal', summarizeBy: 'sum', formatString: '#,0' }),
          ],
          measures: [
            meas('Sales', 'A', "SUM('Sales'[Amount])", { formatString: '#,0' }),
            meas('Sales', 'B', "SUM( 'Sales'[Amount] )", { formatString: '#,0' }),
          ],
        }),
      ],
    });
    const dups = runBPA(model).filter((x) => x.ruleId === 'DAX008');
    expect(dups.length).toBeGreaterThanOrEqual(2);
    expect(dups[0]?.severity).toBe('warning');
  });

  it('DAX009 warns on INTERSECT', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          measures: [
            meas('T', 'X', "COUNTROWS(INTERSECT(VALUES('T'[A]), VALUES('T'[B])))", {
              formatString: '0',
            }),
          ],
        }),
      ],
    });
    expect(has(runBPA(model), 'DAX009')?.severity).toBe('warning');
  });

  it('DAX010 warns on a measure that is a direct reference to another measure', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [
            c('Sales', 'Amount', { dataType: 'decimal', summarizeBy: 'sum', formatString: '#,0' }),
          ],
          measures: [
            meas('Sales', 'Total', "SUM('Sales'[Amount])", { formatString: '#,0' }),
            meas('Sales', 'Alias', '[Total]', { formatString: '#,0' }),
          ],
        }),
      ],
    });
    const f = has(runBPA(model), 'DAX010');
    expect(f?.severity).toBe('warning');
    expect(f?.object).toContain('Alias');
  });

  it('DAX011 warns on a whole-table FILTER inside CALCULATE', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [
            c('Sales', 'Amount', { dataType: 'decimal', summarizeBy: 'sum', formatString: '#,0' }),
          ],
          measures: [
            meas(
              'Sales',
              'X',
              "CALCULATE(SUM('Sales'[Amount]), FILTER('Sales', 'Sales'[Amount] > 0))",
              {
                formatString: '#,0',
              },
            ),
          ],
        }),
      ],
    });
    expect(has(runBPA(model), 'DAX011')?.severity).toBe('warning');
  });
});

describe('BPA MOD015 / MOD016 — info-level relationship smells', () => {
  it('MOD015 flags a non-integer relationship key as info', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', { columns: [c('Fact', 'K', { dataType: 'string' })] }),
        tbl('Dim', { columns: [c('Dim', 'K', { dataType: 'string', isKey: true })] }),
      ],
      relationships: [rel('r', 'Fact', 'K', 'Dim', 'K')],
    });
    const f = has(runBPA(model), 'MOD015');
    expect(f?.severity).toBe('info');
  });

  it('MOD016 flags a TREATAS bridge between two facts as info', () => {
    const model = makeModel({
      tables: [
        tbl('FactA', {
          columns: [
            c('FactA', 'DimKey', { dataType: 'int64', summarizeBy: 'none' }),
            c('FactA', 'SharedAxis', { dataType: 'string' }),
            c('FactA', 'Amount', { dataType: 'decimal', summarizeBy: 'sum', formatString: '#,0' }),
          ],
          measures: [
            meas(
              'FactA',
              'Bridged',
              'CALCULATE(SUM(FactB[Plan]), TREATAS(VALUES(FactA[SharedAxis]), FactB[SharedAxis]))',
              { formatString: '#,0' },
            ),
          ],
        }),
        tbl('FactB', {
          columns: [
            c('FactB', 'OtherKey', { dataType: 'int64', summarizeBy: 'none' }),
            c('FactB', 'SharedAxis', { dataType: 'string' }),
            c('FactB', 'Plan', { dataType: 'decimal', summarizeBy: 'sum', formatString: '#,0' }),
          ],
          measures: [meas('FactB', 'Total Plan', 'SUM(FactB[Plan])', { formatString: '#,0' })],
        }),
        dimTable('DimA'),
        dimTable('DimB'),
      ],
      relationships: [
        rel('r1', 'FactA', 'DimKey', 'DimA', 'DimKey'),
        rel('r2', 'FactB', 'OtherKey', 'DimB', 'DimKey'),
      ],
    });
    const f = has(runBPA(model), 'MOD016');
    expect(f?.severity).toBe('info');
  });
});

describe('BPA review-fix regressions (false positives caught in review)', () => {
  // B1: additive counts ("Number of Orders", "No of Items") are NOT identifiers —
  // MOD014 must not flag them (regression for the over-broad number/no tokens).
  it('MOD014 does not flag additive counts named "Number/No of ..."', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [
            c('Sales', 'Number of Orders', { dataType: 'int64', summarizeBy: 'sum' }),
            c('Sales', 'No of Items', { dataType: 'int64', summarizeBy: 'sum' }),
          ],
        }),
      ],
    });
    expect(has(runBPA(model), 'MOD014')).toBeFalsy();
  });

  // S2: an all-caps ID suffix ("ProductID") that aggregates IS a MOD014 error.
  it('MOD014 flags a summed all-caps ID column (ProductID)', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [c('Sales', 'ProductID', { dataType: 'int64', summarizeBy: 'sum' })],
        }),
      ],
    });
    expect(has(runBPA(model), 'MOD014')?.severity).toBe('error');
  });

  // B2: real words "Dimension"/"Factory" are not Dim/Fact tech prefixes.
  it('NAM002 does not flag the words "Dimension" or "Factory"', () => {
    const model = makeModel({ tables: [tbl('Dimension'), tbl('Factory')] });
    expect(has(runBPA(model), 'NAM002')).toBeFalsy();
  });
  it('NAM002 still flags camelCase Dim/Fact tech prefixes', () => {
    const model = makeModel({ tables: [tbl('DimProduct'), tbl('FactSales')] });
    expect(has(runBPA(model), 'NAM002')?.severity).toBe('warning');
  });

  // N1: the business connectors "&" and "/" are allowed in friendly names.
  it('NAM002 allows "&" and "/" in friendly names', () => {
    const model = makeModel({ tables: [tbl('Profit & Loss'), tbl('A/B Test')] });
    expect(has(runBPA(model), 'NAM002')).toBeFalsy();
  });
});

// ======================= Wave 2 rule fixtures ============================

// A marked date dimension (a column with dataCategory Time) for grain/TI tests.
function dateDim(name: string, extraCols: ReturnType<typeof c>[] = []) {
  return tbl(name, {
    columns: [
      c(name, 'DateKey', { dataType: 'date', dataCategory: 'Time', isKey: true }),
      ...extraCols,
    ],
  });
}

describe('BPA MOD017 — ambiguous diamond filter path', () => {
  it('errors on a diamond: A reaches D via B and via C (all active single)', () => {
    // A→B, A→C, B→D, C→D — D reaches A through two different intermediates.
    // Modeled as fact[FK]→dim[key] single edges; directed filter flow is
    // dim(to)→fact(from), so we build the diamond on the to→from direction.
    const model = makeModel({
      tables: [dimTable('A'), dimTable('B'), dimTable('C'), dimTable('D')],
      relationships: [
        rel('rAB', 'A', 'DimKey', 'B', 'DimKey'),
        rel('rAC', 'A', 'DimKey', 'C', 'DimKey'),
        rel('rBD', 'B', 'DimKey', 'D', 'DimKey'),
        rel('rCD', 'C', 'DimKey', 'D', 'DimKey'),
      ],
    });
    const f = has(runBPA(model), 'MOD017');
    expect(f).toBeTruthy();
    expect(f?.severity).toBe('error');
  });

  it('does not flag a clean star (single dim fanning to two facts is not a diamond)', () => {
    const model = makeModel({
      tables: [factTable('FactA'), factTable('FactB'), dimTable('DimShared')],
      relationships: [
        rel('r1', 'FactA', 'DimKey', 'DimShared', 'DimKey'),
        rel('r2', 'FactB', 'DimKey', 'DimShared', 'DimKey'),
      ],
    });
    expect(has(runBPA(model), 'MOD017')).toBeFalsy();
  });

  it('stays silent when one of the two diamond paths is inactive', () => {
    const model = makeModel({
      tables: [dimTable('A'), dimTable('B'), dimTable('C'), dimTable('D')],
      relationships: [
        rel('rAB', 'A', 'DimKey', 'B', 'DimKey'),
        rel('rAC', 'A', 'DimKey', 'C', 'DimKey'),
        rel('rBD', 'B', 'DimKey', 'D', 'DimKey'),
        rel('rCD', 'C', 'DimKey', 'D', 'DimKey', { isActive: false }),
      ],
    });
    expect(has(runBPA(model), 'MOD017')).toBeFalsy();
  });
});

describe('BPA MOD018 — time intelligence without a marked date table', () => {
  it('errors when a measure uses TOTALYTD and no date table is marked', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [c('Sales', 'OrderDate', { dataType: 'date' })],
          measures: [meas('Sales', 'YTD', "TOTALYTD(SUM('Sales'[Amount]), 'Sales'[OrderDate])")],
        }),
      ],
    });
    const f = has(runBPA(model), 'MOD018');
    expect(f).toBeTruthy();
    expect(f?.severity).toBe('error');
  });

  it('passes when a table-level dataCategory Time date key is present', () => {
    const model = makeModel({
      tables: [
        tbl('Date', {
          columns: [c('Date', 'DateKey', { dataType: 'date', isKey: true })],
          dataCategory: 'Time',
        }),
        tbl('Sales', {
          measures: [meas('Sales', 'YTD', "TOTALYTD(SUM('Sales'[Amount]), 'Date'[DateKey])")],
        }),
      ],
    });
    expect(has(runBPA(model), 'MOD018')).toBeFalsy();
  });

  it('does not match a [Previous Year] measure reference (no function call)', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          measures: [
            meas('Sales', 'Previous Year', 'SUM(Sales[Amount])'),
            meas('Sales', 'Delta', '[Previous Year]'),
          ],
        }),
      ],
    });
    expect(has(runBPA(model), 'MOD018')).toBeFalsy();
  });
});

describe('BPA MOD019 — grain mismatch (heuristic warning)', () => {
  it('warns when one fact is day-grain and another is coarse-grain on the same date dim', () => {
    const model = makeModel({
      tables: [
        // Date dim with a day-grain key (DateKey: date) and a coarse "Month"
        // attribute (int64; the bare token "Month" reads as coarse grain).
        dateDim('Date', [c('Date', 'Month', { dataType: 'int64' })]),
        factTable('Actuals'),
        tbl('Targets', {
          columns: [
            c('Targets', 'MonthKey', { dataType: 'int64', summarizeBy: 'none' }),
            c('Targets', 'TargetAmt', {
              dataType: 'decimal',
              summarizeBy: 'sum',
              formatString: '#,0',
            }),
          ],
          measures: [
            meas('Targets', 'Total Target', 'SUM(Targets[TargetAmt])', { formatString: '#,0' }),
          ],
        }),
        dimTable('Region'),
      ],
      relationships: [
        // Actuals → Date day-grain (DateKey is date); + a second dim so it classifies as a fact.
        rel('rA', 'Actuals', 'DimKey', 'Date', 'DateKey'),
        rel('rA2', 'Actuals', 'DimKey', 'Region', 'DimKey'),
        // Targets → Date coarse-grain (the int64 "Month" attribute) + a second dim.
        rel('rT', 'Targets', 'MonthKey', 'Date', 'Month'),
        rel('rT2', 'Targets', 'MonthKey', 'Region', 'DimKey'),
      ],
    });
    const f = has(runBPA(model), 'MOD019');
    expect(f).toBeTruthy();
    expect(f?.severity).toBe('warning');
    expect(f?.object).toContain('Targets');
  });

  it('does not fire when both facts use the same to-column', () => {
    const model = makeModel({
      tables: [dateDim('Date'), factTable('Actuals'), factTable('Plan'), dimTable('Region')],
      relationships: [
        rel('rA', 'Actuals', 'DimKey', 'Date', 'DateKey'),
        rel('rA2', 'Actuals', 'DimKey', 'Region', 'DimKey'),
        rel('rP', 'Plan', 'DimKey', 'Date', 'DateKey'),
        rel('rP2', 'Plan', 'DimKey', 'Region', 'DimKey'),
      ],
    });
    expect(has(runBPA(model), 'MOD019')).toBeFalsy();
  });
});

describe('BPA MOD020 — mark primary keys', () => {
  it('info when a one-side relationship column is not marked isKey', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', {
          columns: [c('Fact', 'CustKey', { dataType: 'int64', summarizeBy: 'none' })],
        }),
        tbl('Customer', { columns: [c('Customer', 'CustKey', { dataType: 'int64' })] }),
      ],
      relationships: [rel('r', 'Fact', 'CustKey', 'Customer', 'CustKey')],
    });
    const f = has(runBPA(model), 'MOD020');
    expect(f?.severity).toBe('info');
    expect(f?.object).toContain('Customer');
  });

  it('skips when the to-column is already a key, m:m, or a date table', () => {
    const keyed = makeModel({
      tables: [
        tbl('Fact', {
          columns: [c('Fact', 'CustKey', { dataType: 'int64', summarizeBy: 'none' })],
        }),
        tbl('Customer', {
          columns: [c('Customer', 'CustKey', { dataType: 'int64', isKey: true })],
        }),
      ],
      relationships: [rel('r', 'Fact', 'CustKey', 'Customer', 'CustKey')],
    });
    expect(has(runBPA(keyed), 'MOD020')).toBeFalsy();

    const dateSide = makeModel({
      tables: [
        tbl('Fact', { columns: [c('Fact', 'DateKey', { dataType: 'date', summarizeBy: 'none' })] }),
        tbl('Date', {
          columns: [c('Date', 'DateKey', { dataType: 'date', dataCategory: 'Time' })],
        }),
      ],
      relationships: [rel('r', 'Fact', 'DateKey', 'Date', 'DateKey')],
    });
    expect(has(runBPA(dateSide), 'MOD020')).toBeFalsy();
  });
});

describe('BPA MOD021 — one-to-one advisory', () => {
  it('info on a oneToOne relationship', () => {
    const model = makeModel({
      tables: [dimTable('Customer'), dimTable('CustomerPII')],
      relationships: [
        rel('r', 'Customer', 'DimKey', 'CustomerPII', 'DimKey', { cardinality: 'oneToOne' }),
      ],
    });
    expect(has(runBPA(model), 'MOD021')?.severity).toBe('info');
  });

  it('does not fire on a manyToOne relationship', () => {
    const model = makeModel({
      tables: [factTable('Fact'), dimTable('Dim')],
      relationships: [rel('r', 'Fact', 'DimKey', 'Dim', 'DimKey')],
    });
    expect(has(runBPA(model), 'MOD021')).toBeFalsy();
  });
});

describe('BPA MOD022 — general numeric summarizeBy advisory', () => {
  it('info on a non-key numeric column that aggregates (object = the table, column listed)', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [c('Sales', 'Amount', { dataType: 'decimal', summarizeBy: 'sum' })],
        }),
      ],
    });
    const f = has(runBPA(model), 'MOD022');
    expect(f?.severity).toBe('info');
    // Rolled up per table: object is the table, the column name is in the message.
    expect(f?.object).toBe('Table.Sales');
    expect(f?.message).toContain('Amount');
  });

  it('rolls up to ONE finding per table even with multiple additive columns', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [
            c('Sales', 'Amount', { dataType: 'decimal', summarizeBy: 'sum' }),
            c('Sales', 'Quantity', { dataType: 'int64', summarizeBy: 'sum' }),
            c('Sales', 'Discount', { dataType: 'decimal', summarizeBy: 'sum' }),
          ],
        }),
      ],
    });
    const v = runBPA(model).filter((x) => x.ruleId === 'MOD022');
    expect(v.length).toBe(1);
    expect(v[0]?.message).toContain('Amount');
    expect(v[0]?.message).toContain('Quantity');
    expect(v[0]?.message).toContain('Discount');
  });

  it('is silent on a none/hidden numeric column', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [
            c('Sales', 'NoneCol', { dataType: 'decimal', summarizeBy: 'none' }),
            c('Sales', 'HiddenCol', { dataType: 'decimal', summarizeBy: 'sum', isHidden: true }),
          ],
        }),
      ],
    });
    expect(has(runBPA(model), 'MOD022')).toBeFalsy();
  });

  it('does NOT double-report with MOD014 (key-named columns are MOD014-only)', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', {
          columns: [c('Fact', 'ProductKey', { dataType: 'int64', summarizeBy: 'sum' })],
        }),
      ],
    });
    expect(has(runBPA(model), 'MOD014')).toBeTruthy();
    expect(has(runBPA(model), 'MOD022')).toBeFalsy();
  });

  it('on additive counts, MOD014 stays silent while MOD022 fires (info)', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [c('Sales', 'Number of Orders', { dataType: 'int64', summarizeBy: 'sum' })],
        }),
      ],
    });
    expect(has(runBPA(model), 'MOD014')).toBeFalsy();
    expect(has(runBPA(model), 'MOD022')?.severity).toBe('info');
  });
});

describe('BPA MOD023 — USERELATIONSHIP + RLS on the same table', () => {
  const roles = [
    { name: 'R', tablePermissions: [{ table: 'Sales', filterExpression: '[Region]="W"' }] },
  ];
  it('errors when a measure USERELATIONSHIPs a secured table', () => {
    const model = makeModel({
      tables: [
        factTable('Sales', { extraCols: [c('Sales', 'ShipDate', { dataType: 'dateTime' })] }),
        dateDim('Date'),
      ],
      relationships: [rel('r', 'Sales', 'DimKey', 'Date', 'DateKey', { isActive: false })],
      roles,
    });
    // measure references Sales as a USERELATIONSHIP operand table.
    model.tables[0]?.measures.push(
      meas(
        'Sales',
        'Shipped',
        "CALCULATE(SUM('Sales'[Amount]), USERELATIONSHIP('Sales'[ShipDate], 'Date'[DateKey]))",
        {
          formatString: '#,0',
        },
      ),
    );
    const f = has(runBPA(model), 'MOD023');
    expect(f?.severity).toBe('error');
  });

  it('stays silent when there are no roles', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [c('Sales', 'ShipDate', { dataType: 'dateTime' })],
          measures: [
            meas(
              'Sales',
              'Shipped',
              "CALCULATE(SUM('Sales'[Amount]), USERELATIONSHIP('Sales'[ShipDate], 'Date'[DateKey]))",
            ),
          ],
        }),
        dateDim('Date'),
      ],
    });
    expect(has(runBPA(model), 'MOD023')).toBeFalsy();
  });

  it('stays silent when the secured table is not a USERELATIONSHIP operand', () => {
    // Secure a third table (Region) that the USERELATIONSHIP call never touches;
    // the call's operands are Sales and Date, neither of which is secured.
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [c('Sales', 'ShipDate', { dataType: 'dateTime' })],
          measures: [
            meas(
              'Sales',
              'Shipped',
              "CALCULATE(SUM('Sales'[Amount]), USERELATIONSHIP('Sales'[ShipDate], 'Date'[DateKey]))",
            ),
          ],
        }),
        dateDim('Date'),
        dimTable('Region'),
      ],
      roles: [
        { name: 'R', tablePermissions: [{ table: 'Region', filterExpression: '[Area]="W"' }] },
      ],
    });
    expect(has(runBPA(model), 'MOD023')).toBeFalsy();
  });
});

describe('BPA MOD024 — m:m on a dynamic-RLS table', () => {
  it('warns when an m:m endpoint uses USERPRINCIPALNAME RLS', () => {
    const model = makeModel({
      tables: [dimTable('Bridge'), dimTable('SecDim')],
      relationships: [
        rel('r', 'Bridge', 'DimKey', 'SecDim', 'DimKey', { cardinality: 'manyToMany' }),
      ],
      roles: [
        {
          name: 'R',
          tablePermissions: [{ table: 'SecDim', filterExpression: '[Email]=USERPRINCIPALNAME()' }],
        },
      ],
    });
    expect(has(runBPA(model), 'MOD024')?.severity).toBe('warning');
  });

  it('stays silent for static RLS (no user function) and for no roles', () => {
    const staticRls = makeModel({
      tables: [dimTable('Bridge'), dimTable('SecDim')],
      relationships: [
        rel('r', 'Bridge', 'DimKey', 'SecDim', 'DimKey', { cardinality: 'manyToMany' }),
      ],
      roles: [
        { name: 'R', tablePermissions: [{ table: 'SecDim', filterExpression: '[Region]="W"' }] },
      ],
    });
    expect(has(runBPA(staticRls), 'MOD024')).toBeFalsy();

    const noRoles = makeModel({
      tables: [dimTable('Bridge'), dimTable('SecDim')],
      relationships: [
        rel('r', 'Bridge', 'DimKey', 'SecDim', 'DimKey', { cardinality: 'manyToMany' }),
      ],
    });
    expect(has(runBPA(noRoles), 'MOD024')).toBeFalsy();
  });
});

describe('BPA MOD025 — bidirectional into a secured table', () => {
  it('warns on a both-direction relationship whose endpoint has RLS', () => {
    const model = makeModel({
      tables: [factTable('Sales'), dimTable('Customer')],
      relationships: [rel('r', 'Sales', 'DimKey', 'Customer', 'DimKey', { cross: 'both' })],
      roles: [
        { name: 'R', tablePermissions: [{ table: 'Customer', filterExpression: '[Region]="W"' }] },
      ],
    });
    expect(has(runBPA(model), 'MOD025')?.severity).toBe('warning');
  });

  it('stays silent for single direction, empty filter, or no roles', () => {
    const single = makeModel({
      tables: [factTable('Sales'), dimTable('Customer')],
      relationships: [rel('r', 'Sales', 'DimKey', 'Customer', 'DimKey', { cross: 'single' })],
      roles: [
        { name: 'R', tablePermissions: [{ table: 'Customer', filterExpression: '[Region]="W"' }] },
      ],
    });
    expect(has(runBPA(single), 'MOD025')).toBeFalsy();

    const emptyFilter = makeModel({
      tables: [factTable('Sales'), dimTable('Customer')],
      relationships: [rel('r', 'Sales', 'DimKey', 'Customer', 'DimKey', { cross: 'both' })],
      roles: [{ name: 'R', tablePermissions: [{ table: 'Customer', filterExpression: '' }] }],
    });
    expect(has(runBPA(emptyFilter), 'MOD025')).toBeFalsy();
  });
});

describe('BPA MOD026 — visible object with no description (gated)', () => {
  it('info on an undescribed visible measure when the model expresses descriptions', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          measures: [
            meas('Sales', 'Documented', 'SUM(Sales[A])', { description: 'A real description' }),
            meas('Sales', 'Bare', 'SUM(Sales[B])'),
          ],
        }),
      ],
    });
    const v = runBPA(model).filter((x) => x.ruleId === 'MOD026');
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v.every((f) => f.severity === 'info')).toBe(true);
    expect(v.some((f) => f.object.includes('Bare'))).toBe(true);
    expect(v.some((f) => f.object.includes('Documented'))).toBe(false);
  });

  it('stays silent when NO object anywhere has a description (convention not captured)', () => {
    const model = makeModel({
      tables: [tbl('Sales', { measures: [meas('Sales', 'Bare', 'SUM(Sales[B])')] })],
    });
    expect(has(runBPA(model), 'MOD026')).toBeFalsy();
  });

  it('never flags hidden objects', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          measures: [
            meas('Sales', 'Documented', 'SUM(Sales[A])', { description: 'desc' }),
            meas('Sales', 'HiddenBare', 'SUM(Sales[B])', { isHidden: true }),
          ],
        }),
      ],
    });
    const v = runBPA(model).filter((x) => x.ruleId === 'MOD026');
    expect(v.some((f) => f.object.includes('HiddenBare'))).toBe(false);
  });
});

describe('BPA MOD027 — >10 visible measures none foldered (gated)', () => {
  it('info when >10 visible measures lack a folder (and the convention is captured)', () => {
    const many = [];
    for (let i = 0; i < 11; i++) many.push(meas('Sales', `M${i}`, 'SUM(Sales[A])'));
    const model = makeModel({
      tables: [
        tbl('Sales', { measures: many }),
        // A different table proves the displayFolder convention is captured.
        tbl('Other', {
          measures: [meas('Other', 'Foldered', 'SUM(Other[A])', { displayFolder: 'KPIs' })],
        }),
      ],
    });
    const f = has(runBPA(model), 'MOD027');
    expect(f?.severity).toBe('info');
    expect(f?.object).toContain('Sales');
  });

  it('stays silent when no measure expresses a displayFolder (convention not captured)', () => {
    const many = [];
    for (let i = 0; i < 11; i++) many.push(meas('Sales', `M${i}`, 'SUM(Sales[A])'));
    const model = makeModel({ tables: [tbl('Sales', { measures: many })] });
    expect(has(runBPA(model), 'MOD027')).toBeFalsy();
  });

  it('does not fire under the threshold', () => {
    const few = [
      meas('Sales', 'A', 'SUM(Sales[X])'),
      meas('Sales', 'B', 'SUM(Sales[Y])', { displayFolder: 'K' }),
    ];
    const model = makeModel({ tables: [tbl('Sales', { measures: few })] });
    expect(has(runBPA(model), 'MOD027')).toBeFalsy();
  });
});

describe('BPA MOD028 — Assume RI into DirectQuery (double-gated)', () => {
  it('warns when relyOnReferentialIntegrity is true AND an endpoint is DirectQuery', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [c('Sales', 'CustKey', { dataType: 'int64', summarizeBy: 'none' })],
          storageMode: 'directQuery',
        }),
        dimTable('Customer'),
      ],
      relationships: [
        rel('r', 'Sales', 'CustKey', 'Customer', 'DimKey', { relyOnReferentialIntegrity: true }),
      ],
    });
    expect(has(runBPA(model), 'MOD028')?.severity).toBe('warning');
  });

  it('stays silent on an Import model or when the RI flag is absent', () => {
    const importModel = makeModel({
      tables: [
        tbl('Sales', {
          columns: [c('Sales', 'CustKey', { dataType: 'int64', summarizeBy: 'none' })],
        }),
        dimTable('Customer'),
      ],
      relationships: [
        rel('r', 'Sales', 'CustKey', 'Customer', 'DimKey', { relyOnReferentialIntegrity: true }),
      ],
    });
    expect(has(runBPA(importModel), 'MOD028')).toBeFalsy();

    const noFlag = makeModel({
      tables: [
        tbl('Sales', {
          columns: [c('Sales', 'CustKey', { dataType: 'int64', summarizeBy: 'none' })],
          storageMode: 'directQuery',
        }),
        dimTable('Customer'),
      ],
      relationships: [rel('r', 'Sales', 'CustKey', 'Customer', 'DimKey')],
    });
    expect(has(runBPA(noFlag), 'MOD028')).toBeFalsy();
  });
});

describe('BPA DAX012-014 — measure DAX hygiene', () => {
  it('DAX012 warns on EVALUATEANDLOG', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          measures: [meas('T', 'X', 'EVALUATEANDLOG(SUM(T[A]))', { formatString: '0' })],
        }),
      ],
    });
    expect(has(runBPA(model), 'DAX012')?.severity).toBe('warning');
  });

  it('DAX013 warns on 1-(SUM(...)/...) and 1-DIVIDE(...) but not a plain measure minus DIVIDE', () => {
    const sumForm = makeModel({
      tables: [
        tbl('T', {
          measures: [
            meas('T', 'Margin', "1 - (SUM('T'[Cost]) / SUM('T'[Rev]))", { formatString: '0%' }),
          ],
        }),
      ],
    });
    expect(has(runBPA(sumForm), 'DAX013')?.severity).toBe('warning');

    const divideForm = makeModel({
      tables: [
        tbl('T', {
          measures: [meas('T', 'Margin', '1 - DIVIDE([Cost], [Rev])', { formatString: '0%' })],
        }),
      ],
    });
    expect(has(runBPA(divideForm), 'DAX013')?.severity).toBe('warning');

    const plain = makeModel({
      tables: [
        tbl('T', {
          measures: [meas('T', 'Net', '[Gross] - DIVIDE([Cost], [Rev])', { formatString: '0' })],
        }),
      ],
    });
    expect(has(runBPA(plain), 'DAX013')).toBeFalsy();
  });

  it('DAX014 warns on +0 / COALESCE(...,0) / IF(ISBLANK,0,...), not on +IF(NOT ISEMPTY,0)', () => {
    const plusZero = makeModel({
      tables: [tbl('T', { measures: [meas('T', 'X', 'SUM(T[A]) + 0', { formatString: '0' })] })],
    });
    expect(has(runBPA(plusZero), 'DAX014')?.severity).toBe('warning');

    const coalesce = makeModel({
      tables: [tbl('T', { measures: [meas('T', 'X', 'COALESCE([A], 0)', { formatString: '0' })] })],
    });
    expect(has(runBPA(coalesce), 'DAX014')?.severity).toBe('warning');

    const gated = makeModel({
      tables: [
        tbl('T', {
          measures: [meas('T', 'X', 'SUM(T[A]) + IF(NOT ISEMPTY(T), 0)', { formatString: '0' })],
        }),
      ],
    });
    expect(has(runBPA(gated), 'DAX014')).toBeFalsy();
  });
});

describe('BPA FMT005-007 — formatting', () => {
  it('FMT005 warns on a %-named measure with no % in its format string', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          measures: [meas('T', 'Margin %', 'DIVIDE([A], [B])', { formatString: '0.00' })],
        }),
      ],
    });
    expect(has(runBPA(model), 'FMT005')?.severity).toBe('warning');
  });

  it('FMT005 does NOT flag "Exchange Rate" with a currency format (Rate dropped)', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          measures: [meas('T', 'Exchange Rate', 'AVERAGE(T[R])', { formatString: '$#,0.00' })],
        }),
      ],
    });
    expect(has(runBPA(model), 'FMT005')).toBeFalsy();
  });

  it('FMT005 passes a %-named measure that already has a % format', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          measures: [meas('T', 'Growth %', 'DIVIDE([A], [B])', { formatString: '0.0%' })],
        }),
      ],
    });
    expect(has(runBPA(model), 'FMT005')).toBeFalsy();
  });

  it('FMT006 info on a geography string column and a lat/long numeric column with no dataCategory', () => {
    const model = makeModel({
      tables: [
        tbl('Geo', {
          columns: [
            c('Geo', 'Country', { dataType: 'string' }),
            c('Geo', 'Latitude', { dataType: 'double' }),
          ],
        }),
      ],
    });
    const v = runBPA(model).filter((x) => x.ruleId === 'FMT006');
    expect(v.length).toBe(2);
    expect(v.every((f) => f.severity === 'info')).toBe(true);
  });

  it('FMT006 skips when dataCategory is already set', () => {
    const model = makeModel({
      tables: [
        tbl('Geo', {
          columns: [c('Geo', 'Country', { dataType: 'string', dataCategory: 'Country' })],
        }),
      ],
    });
    expect(has(runBPA(model), 'FMT006')).toBeFalsy();
  });

  it('FMT006 does NOT match numeric columns that merely start with lat/long (exact name only)', () => {
    // "Latency"/"Longshore"/"Long Term Value" are numeric but not geography —
    // the old prefix regex false-positived; the exact /^(lat|long|...)$/i must not.
    const model = makeModel({
      tables: [
        tbl('Metrics', {
          columns: [
            c('Metrics', 'Latency', { dataType: 'double' }),
            c('Metrics', 'Longshore', { dataType: 'decimal' }),
            c('Metrics', 'Long Term Value', { dataType: 'double' }),
          ],
        }),
      ],
    });
    expect(has(runBPA(model), 'FMT006')).toBeFalsy();
  });

  it('FMT007 warns on a string Month column with no sortByColumn; passes when sorted or plural', () => {
    const unsorted = makeModel({
      tables: [tbl('Date', { columns: [c('Date', 'Month', { dataType: 'string' })] })],
    });
    expect(has(runBPA(unsorted), 'FMT007')?.severity).toBe('warning');

    const sorted = makeModel({
      tables: [
        tbl('Date', {
          columns: [c('Date', 'Month', { dataType: 'string', sortByColumn: 'MonthNo' })],
        }),
      ],
    });
    expect(has(runBPA(sorted), 'FMT007')).toBeFalsy();

    const plural = makeModel({
      tables: [tbl('Date', { columns: [c('Date', 'Months', { dataType: 'string' })] })],
    });
    expect(has(runBPA(plural), 'FMT007')).toBeFalsy();

    const numeric = makeModel({
      tables: [tbl('Date', { columns: [c('Date', 'MonthNo', { dataType: 'int64' })] })],
    });
    expect(has(runBPA(numeric), 'FMT007')).toBeFalsy();
  });
});

describe('BPA E3 — calc column blank expression (gated)', () => {
  it('errors on a blank-expression calc column when another calc column has an expression', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          columns: [
            c('T', 'Good', { isCalculated: true, expression: '1+1' }),
            c('T', 'Bad', { isCalculated: true }),
          ],
        }),
      ],
    });
    const f = has(runBPA(model), 'E3');
    expect(f?.severity).toBe('error');
    expect(f?.object).toContain('Bad');
  });

  it('stays silent when no calc column has an expression (convention not captured)', () => {
    const model = makeModel({
      tables: [tbl('T', { columns: [c('T', 'Bad', { isCalculated: true })] })],
    });
    expect(has(runBPA(model), 'E3')).toBeFalsy();
  });

  it('never flags a plain data column with no expression', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          columns: [
            c('T', 'Calc', { isCalculated: true, expression: '1' }),
            c('T', 'Data', { sourceColumn: 'Data' }),
          ],
        }),
      ],
    });
    const v = runBPA(model).filter((x) => x.ruleId === 'E3');
    expect(v.some((f) => f.object.includes('Data'))).toBe(false);
  });
});

describe('BPA E4 — isAvailableInMDX=false on a sort-by target', () => {
  it('errors on the sort-by target column when it is MDX-unavailable', () => {
    const model = makeModel({
      tables: [
        tbl('Date', {
          columns: [
            c('Date', 'Month', { dataType: 'string', sortByColumn: 'MonthNo' }),
            c('Date', 'MonthNo', { dataType: 'int64', isAvailableInMdx: false }),
          ],
        }),
      ],
    });
    const f = has(runBPA(model), 'E4');
    expect(f?.severity).toBe('error');
    expect(f?.object).toContain('MonthNo');
  });

  it('stays silent when the target is MDX-available or undefined', () => {
    const available = makeModel({
      tables: [
        tbl('Date', {
          columns: [
            c('Date', 'Month', { dataType: 'string', sortByColumn: 'MonthNo' }),
            c('Date', 'MonthNo', { dataType: 'int64', isAvailableInMdx: true }),
          ],
        }),
      ],
    });
    expect(has(runBPA(available), 'E4')).toBeFalsy();

    const undef = makeModel({
      tables: [
        tbl('Date', {
          columns: [
            c('Date', 'Month', { dataType: 'string', sortByColumn: 'MonthNo' }),
            c('Date', 'MonthNo', { dataType: 'int64' }),
          ],
        }),
      ],
    });
    expect(has(runBPA(undef), 'E4')).toBeFalsy();
  });

  it('does not flag an MDX-unavailable column that is not a sort-by target', () => {
    const model = makeModel({
      tables: [
        tbl('T', { columns: [c('T', 'Hidden', { dataType: 'int64', isAvailableInMdx: false })] }),
      ],
    });
    expect(has(runBPA(model), 'E4')).toBeFalsy();
  });
});

describe('BPA E5 — control chars in a measure description', () => {
  it('errors on a NUL/control char in a description', () => {
    const model = makeModel({
      tables: [
        tbl('T', { measures: [meas('T', 'X', 'SUM(T[A])', { description: 'bad\x00desc' })] }),
      ],
    });
    expect(has(runBPA(model), 'E5')?.severity).toBe('error');
  });

  it('stays silent on a multi-line (newline/tab) description — load-bearing negative', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          measures: [meas('T', 'X', 'SUM(T[A])', { description: 'line one\nline two\twith tab' })],
        }),
      ],
    });
    expect(has(runBPA(model), 'E5')).toBeFalsy();
  });
});

describe('BPA MOD002 STRENGTHEN — role-playing escalation', () => {
  it('errors when an inactive rel has a sibling active rel on different columns (same pair)', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [
            c('Sales', 'OrderDateKey', { dataType: 'date', summarizeBy: 'none' }),
            c('Sales', 'ShipDateKey', { dataType: 'date', summarizeBy: 'none' }),
          ],
        }),
        dateDim('Date'),
      ],
      relationships: [
        rel('rActive', 'Sales', 'OrderDateKey', 'Date', 'DateKey'),
        rel('rInactive', 'Sales', 'ShipDateKey', 'Date', 'DateKey', { isActive: false }),
      ],
    });
    const f = has(runBPA(model), 'MOD002');
    expect(f?.severity).toBe('error');
  });

  it('stays a warning for a lone inactive rel with no sibling active rel', () => {
    const model = makeModel({
      tables: [dimTable('A'), dimTable('B')],
      relationships: [rel('r', 'A', 'DimKey', 'B', 'DimKey', { isActive: false })],
    });
    expect(has(runBPA(model), 'MOD002')?.severity).toBe('warning');
  });
});

describe('BPA MOD011 STRENGTHEN — severity split', () => {
  it('errors on a hard-incompatible mismatch (string vs int64)', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', { columns: [c('Fact', 'K', { dataType: 'string' })] }),
        tbl('Dim', { columns: [c('Dim', 'K', { dataType: 'int64', isKey: true })] }),
      ],
      relationships: [rel('r', 'Fact', 'K', 'Dim', 'K')],
    });
    expect(has(runBPA(model), 'MOD011')?.severity).toBe('error');
  });

  it('warns on a widening mismatch (int64 vs decimal) — unchanged', () => {
    const model = makeModel({
      tables: [
        tbl('Fact', { columns: [c('Fact', 'K', { dataType: 'int64' })] }),
        tbl('Dim', { columns: [c('Dim', 'K', { dataType: 'decimal', isKey: true })] }),
      ],
      relationships: [rel('r', 'Fact', 'K', 'Dim', 'K')],
    });
    expect(has(runBPA(model), 'MOD011')?.severity).toBe('warning');
  });
});

describe('BPA NAM002 STRENGTHEN — reserved words', () => {
  it('warns on a table named exactly "Date"', () => {
    const model = makeModel({ tables: [tbl('Date')] });
    expect(has(runBPA(model), 'NAM002')?.severity).toBe('warning');
  });

  it('does not flag non-reserved business names', () => {
    const model = makeModel({ tables: [tbl('Calendar Date'), tbl('Sales')] });
    expect(has(runBPA(model), 'NAM002')).toBeFalsy();
  });
});

describe('BPA DAX001 / DAX005 EXTEND — over calculated columns', () => {
  it('DAX001 flags a raw "/" in a calc-column expression', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          columns: [
            c('T', 'Num', { dataType: 'decimal' }),
            c('T', 'Den', { dataType: 'decimal' }),
            c('T', 'Ratio', {
              isCalculated: true,
              dataType: 'decimal',
              expression: '[Num] / [Den]',
            }),
          ],
        }),
      ],
    });
    const f = has(runBPA(model), 'DAX001');
    expect(f?.object).toBe("'T'[Ratio]");
  });

  it('DAX001 passes a calc column using DIVIDE', () => {
    const model = makeModel({
      tables: [
        tbl('T', {
          columns: [
            c('T', 'Num', { dataType: 'decimal' }),
            c('T', 'Den', { dataType: 'decimal' }),
            c('T', 'Ratio', {
              isCalculated: true,
              dataType: 'decimal',
              expression: 'DIVIDE([Num], [Den])',
            }),
          ],
        }),
      ],
    });
    expect(has(runBPA(model), 'DAX001')).toBeFalsy();
  });

  it('DAX005 flags a missing reference inside a calc-column expression', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [
            c('Sales', 'Amount', { dataType: 'decimal' }),
            c('Sales', 'Bad', {
              isCalculated: true,
              dataType: 'decimal',
              expression: "SUM('Sales'[Nope])",
            }),
          ],
        }),
      ],
    });
    const v = runBPA(model).filter((x) => x.ruleId === 'DAX005');
    expect(v.some((f) => f.object === "'Sales'[Bad]")).toBe(true);
  });

  it('DAX005 passes a calc column whose references all resolve', () => {
    const model = makeModel({
      tables: [
        tbl('Sales', {
          columns: [
            c('Sales', 'Amount', { dataType: 'decimal' }),
            c('Sales', 'Double', {
              isCalculated: true,
              dataType: 'decimal',
              expression: "'Sales'[Amount] * 2",
            }),
          ],
        }),
      ],
    });
    const v = runBPA(model).filter((x) => x.ruleId === 'DAX005' && x.object === "'Sales'[Double]");
    expect(v).toHaveLength(0);
  });
});
