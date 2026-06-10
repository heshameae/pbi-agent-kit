import { describe, expect, it } from 'vitest';
import { checkRelationships, relationshipCheck } from '../../src/modeling/relationship-check.js';
import type {
  CrossFilteringBehavior,
  TMDLColumn,
  TMDLModel,
  TMDLRelationship,
  TMDLTable,
} from '../../src/modeling/types.js';

function col(table: string, name: string, dataType: string, isKey = false): TMDLColumn {
  return { table, name, dataType, isHidden: false, isKey, isCalculated: false };
}

function tbl(name: string, columns: TMDLColumn[]): TMDLTable {
  return {
    name,
    columns,
    measures: [],
    isHidden: false,
    isCalculated: false,
    isAutoDateTable: false,
  };
}

describe('checkRelationships', () => {
  it('flags missing fromColumn', () => {
    const model: TMDLModel = {
      modelPath: '/',
      tables: [tbl('A', [col('A', 'x', 'int64')]), tbl('B', [col('B', 'y', 'int64')])],
      relationships: [
        {
          id: 'r1',
          fromTable: 'A',
          fromColumn: 'doesNotExist',
          toTable: 'B',
          toColumn: 'y',
          isActive: true,
          crossFilteringBehavior: 'single',
        },
      ],
    };
    const findings = checkRelationships(model);
    expect(
      findings.find((f) => f.relationshipId === 'r1' && /does not exist/.test(f.message)),
    ).toBeTruthy();
  });

  it('flags type mismatch between key columns', () => {
    const model: TMDLModel = {
      modelPath: '/',
      tables: [tbl('A', [col('A', 'k', 'string')]), tbl('B', [col('B', 'k', 'int64')])],
      relationships: [
        {
          id: 'r1',
          fromTable: 'A',
          fromColumn: 'k',
          toTable: 'B',
          toColumn: 'k',
          isActive: true,
          crossFilteringBehavior: 'single',
        },
      ],
    };
    const findings = checkRelationships(model);
    expect(findings.find((f) => /Key data types differ/.test(f.message))).toBeTruthy();
  });

  it('treats numerics as compatible', () => {
    const model: TMDLModel = {
      modelPath: '/',
      tables: [tbl('A', [col('A', 'k', 'int64')]), tbl('B', [col('B', 'k', 'decimal')])],
      relationships: [
        {
          id: 'r1',
          fromTable: 'A',
          fromColumn: 'k',
          toTable: 'B',
          toColumn: 'k',
          isActive: true,
          crossFilteringBehavior: 'single',
        },
      ],
    };
    const findings = checkRelationships(model);
    expect(findings.find((f) => /Key data types differ/.test(f.message))).toBeFalsy();
  });

  it('flags multiple active relationships between same pair', () => {
    const model: TMDLModel = {
      modelPath: '/',
      tables: [
        tbl('A', [col('A', 'k1', 'int64'), col('A', 'k2', 'int64')]),
        tbl('B', [col('B', 'k', 'int64')]),
      ],
      relationships: [
        {
          id: 'r1',
          fromTable: 'A',
          fromColumn: 'k1',
          toTable: 'B',
          toColumn: 'k',
          isActive: true,
          crossFilteringBehavior: 'single',
        },
        {
          id: 'r2',
          fromTable: 'A',
          fromColumn: 'k2',
          toTable: 'B',
          toColumn: 'k',
          isActive: true,
          crossFilteringBehavior: 'single',
        },
      ],
    };
    const findings = checkRelationships(model);
    expect(findings.filter((f) => /Multiple active relationships/.test(f.message)).length).toBe(2);
  });
});

// FactPrimary[SharedKey:int64, ValueMetric:decimal] ←→ DimShared[SharedAxis:int64, Label:string].
function starModel(extraRels: TMDLRelationship[] = []): TMDLModel {
  return {
    modelPath: '/',
    tables: [
      tbl('FactPrimary', [
        col('FactPrimary', 'SharedKey', 'int64'),
        col('FactPrimary', 'ValueMetric', 'decimal'),
      ]),
      tbl('DimShared', [
        col('DimShared', 'SharedAxis', 'int64'),
        col('DimShared', 'Label', 'string'),
      ]),
    ],
    relationships: extraRels,
  };
}

function rel(id: string, overrides: Partial<TMDLRelationship> = {}): TMDLRelationship {
  return {
    id,
    fromTable: 'FactPrimary',
    fromColumn: 'SharedKey',
    toTable: 'DimShared',
    toColumn: 'SharedAxis',
    isActive: true,
    crossFilteringBehavior: 'single',
    ...overrides,
  };
}

describe('relationshipCheck (single candidate)', () => {
  it('accepts a valid 1:N candidate', () => {
    const result = relationshipCheck(
      {
        fromTable: 'FactPrimary',
        fromColumn: 'SharedKey',
        toTable: 'DimShared',
        toColumn: 'SharedAxis',
      },
      starModel(),
    );
    expect(result.valid).toBe(true);
    expect(result.blocking).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('blocks when the from-table is missing', () => {
    const result = relationshipCheck(
      {
        fromTable: 'NotATable',
        fromColumn: 'SharedKey',
        toTable: 'DimShared',
        toColumn: 'SharedAxis',
      },
      starModel(),
    );
    expect(result.valid).toBe(false);
    expect(result.blocking.map((b) => b.code)).toContain('from-table-missing');
  });

  it('blocks when the to-column is missing', () => {
    const result = relationshipCheck(
      {
        fromTable: 'FactPrimary',
        fromColumn: 'SharedKey',
        toTable: 'DimShared',
        toColumn: 'NotAColumn',
      },
      starModel(),
    );
    expect(result.valid).toBe(false);
    expect(result.blocking.map((b) => b.code)).toContain('to-column-missing');
  });

  it('blocks on a type mismatch (int64 → string)', () => {
    const result = relationshipCheck(
      {
        fromTable: 'FactPrimary',
        fromColumn: 'SharedKey',
        toTable: 'DimShared',
        toColumn: 'Label',
      },
      starModel(),
    );
    expect(result.valid).toBe(false);
    expect(result.blocking.map((b) => b.code)).toContain('type-mismatch');
  });

  it('treats numeric widening (int64 → decimal) as compatible', () => {
    // ValueMetric is decimal; SharedAxis is int64 — both numeric, so typesCompatible passes.
    const result = relationshipCheck(
      {
        fromTable: 'FactPrimary',
        fromColumn: 'ValueMetric',
        toTable: 'DimShared',
        toColumn: 'SharedAxis',
      },
      starModel(),
    );
    expect(result.blocking.map((b) => b.code)).not.toContain('type-mismatch');
    expect(result.valid).toBe(true);
  });

  it('blocks direct relationships between fact-like tables', () => {
    const model: TMDLModel = {
      modelPath: '/',
      tables: [
        {
          ...tbl('FactPrimary', [
            { ...col('FactPrimary', 'SharedKey', 'int64'), summarizeBy: 'none' },
            { ...col('FactPrimary', 'Amount', 'decimal'), summarizeBy: 'sum' },
          ]),
          measures: [
            {
              table: 'FactPrimary',
              name: 'Primary Amount',
              expression: 'SUM(FactPrimary[Amount])',
              isHidden: false,
              annotations: {},
            },
          ],
        },
        {
          ...tbl('FactSecondary', [
            { ...col('FactSecondary', 'SharedKey', 'int64'), summarizeBy: 'none' },
            { ...col('FactSecondary', 'Amount', 'decimal'), summarizeBy: 'sum' },
          ]),
          measures: [
            {
              table: 'FactSecondary',
              name: 'Secondary Amount',
              expression: 'SUM(FactSecondary[Amount])',
              isHidden: false,
              annotations: {},
            },
          ],
        },
      ],
      relationships: [],
    };

    const result = relationshipCheck(
      {
        fromTable: 'FactPrimary',
        fromColumn: 'SharedKey',
        toTable: 'FactSecondary',
        toColumn: 'SharedKey',
      },
      model,
    );

    expect(result.valid).toBe(false);
    expect(result.blocking.map((b) => b.code)).toContain('direct-fact-to-fact');
  });

  it('does not treat a dimension as fact-like only because it hosts a helper measure', () => {
    const model: TMDLModel = {
      modelPath: '/',
      tables: [
        {
          ...tbl('FactPrimary', [
            { ...col('FactPrimary', 'SharedKey', 'int64'), summarizeBy: 'none' },
            { ...col('FactPrimary', 'Amount', 'decimal'), summarizeBy: 'sum' },
          ]),
        },
        {
          ...tbl('DimShared', [
            { ...col('DimShared', 'SharedAxis', 'int64'), summarizeBy: 'none' },
            col('DimShared', 'Label', 'string'),
          ]),
          measures: [
            {
              table: 'DimShared',
              name: 'Visible Members',
              expression: 'COUNTROWS(DimShared)',
              isHidden: false,
              annotations: {},
            },
          ],
        },
      ],
      relationships: [],
    };

    const result = relationshipCheck(
      {
        fromTable: 'FactPrimary',
        fromColumn: 'SharedKey',
        toTable: 'DimShared',
        toColumn: 'SharedAxis',
      },
      model,
    );

    expect(result.valid).toBe(true);
    expect(result.blocking.map((b) => b.code)).not.toContain('direct-fact-to-fact');
  });

  it('blocks a second active path on the same table pair', () => {
    const result = relationshipCheck(
      {
        fromTable: 'FactPrimary',
        fromColumn: 'SharedKey',
        toTable: 'DimShared',
        toColumn: 'SharedAxis',
      },
      starModel([rel('existing')]),
    );
    expect(result.valid).toBe(false);
    expect(result.blocking.map((b) => b.code)).toContain('ambiguous-active-path');
  });

  it('ignoreRelationshipId bypasses the active-path ambiguity check', () => {
    const result = relationshipCheck(
      {
        fromTable: 'FactPrimary',
        fromColumn: 'SharedKey',
        toTable: 'DimShared',
        toColumn: 'SharedAxis',
      },
      starModel([rel('editing')]),
      { ignoreRelationshipId: 'editing' },
    );
    expect(result.valid).toBe(true);
    expect(result.blocking.map((b) => b.code)).not.toContain('ambiguous-active-path');
  });

  it('warns (but stays valid) on bidirectional cross-filtering', () => {
    const both: CrossFilteringBehavior = 'both';
    const result = relationshipCheck(
      {
        fromTable: 'FactPrimary',
        fromColumn: 'SharedKey',
        toTable: 'DimShared',
        toColumn: 'SharedAxis',
        crossFilteringBehavior: both,
      },
      starModel(),
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('bidirectional');
  });

  it('blocks a self-loop (same table + column both ends)', () => {
    const result = relationshipCheck(
      {
        fromTable: 'FactPrimary',
        fromColumn: 'SharedKey',
        toTable: 'FactPrimary',
        toColumn: 'SharedKey',
      },
      starModel(),
    );
    expect(result.valid).toBe(false);
    expect(result.blocking.map((b) => b.code)).toContain('self-loop');
  });
});

// --- diamond pre-write gate ----------------------------------------------
// A 4-table chain A→B→D, A→C where the candidate C→D would close a diamond
// (A reaches D via B and via C). The pre-write gate must block it with
// `ambiguous-diamond-path` (distinct from the same-pair ambiguous-active-path).
function diamondBase(extraRels: TMDLRelationship[] = []): TMDLModel {
  return {
    modelPath: '/',
    tables: [
      tbl('A', [col('A', 'k', 'int64', true)]),
      tbl('B', [col('B', 'k', 'int64', true)]),
      tbl('C', [col('C', 'k', 'int64', true)]),
      tbl('D', [col('D', 'k', 'int64', true)]),
    ],
    relationships: extraRels,
  };
}

describe('relationshipCheck — diamond (multi-hop) gate', () => {
  it('blocks a candidate that closes a diamond through different intermediates', () => {
    // Existing active edges: A→B, A→C, B→D. Candidate C→D would give D two
    // routes to A (via B and via C).
    const model = diamondBase([
      {
        id: 'rAB',
        fromTable: 'A',
        fromColumn: 'k',
        toTable: 'B',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
      {
        id: 'rAC',
        fromTable: 'A',
        fromColumn: 'k',
        toTable: 'C',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
      {
        id: 'rBD',
        fromTable: 'B',
        fromColumn: 'k',
        toTable: 'D',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
    ]);
    const result = relationshipCheck(
      { fromTable: 'C', fromColumn: 'k', toTable: 'D', toColumn: 'k' },
      model,
    );
    expect(result.valid).toBe(false);
    expect(result.blocking.map((b) => b.code)).toContain('ambiguous-diamond-path');
  });

  it('allows the candidate when it would be inactive', () => {
    const model = diamondBase([
      {
        id: 'rAB',
        fromTable: 'A',
        fromColumn: 'k',
        toTable: 'B',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
      {
        id: 'rAC',
        fromTable: 'A',
        fromColumn: 'k',
        toTable: 'C',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
      {
        id: 'rBD',
        fromTable: 'B',
        fromColumn: 'k',
        toTable: 'D',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
    ]);
    const result = relationshipCheck(
      { fromTable: 'C', fromColumn: 'k', toTable: 'D', toColumn: 'k', isActive: false },
      model,
    );
    expect(result.blocking.map((b) => b.code)).not.toContain('ambiguous-diamond-path');
  });

  it('does not flag a clean chain with no pre-existing alternate path', () => {
    // Only A→B, A→C exist; candidate C→D adds D for the first time — no diamond.
    const model = diamondBase([
      {
        id: 'rAB',
        fromTable: 'A',
        fromColumn: 'k',
        toTable: 'B',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
      {
        id: 'rAC',
        fromTable: 'A',
        fromColumn: 'k',
        toTable: 'C',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
    ]);
    const result = relationshipCheck(
      { fromTable: 'C', fromColumn: 'k', toTable: 'D', toColumn: 'k' },
      model,
    );
    expect(result.blocking.map((b) => b.code)).not.toContain('ambiguous-diamond-path');
    expect(result.valid).toBe(true);
  });

  it('an inactive existing edge does not count toward the diamond', () => {
    // B→D is inactive, so the alternate route via B is dead; candidate C→D is fine.
    const model = diamondBase([
      {
        id: 'rAB',
        fromTable: 'A',
        fromColumn: 'k',
        toTable: 'B',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
      {
        id: 'rAC',
        fromTable: 'A',
        fromColumn: 'k',
        toTable: 'C',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
      {
        id: 'rBD',
        fromTable: 'B',
        fromColumn: 'k',
        toTable: 'D',
        toColumn: 'k',
        isActive: false,
        crossFilteringBehavior: 'single',
      },
    ]);
    const result = relationshipCheck(
      { fromTable: 'C', fromColumn: 'k', toTable: 'D', toColumn: 'k' },
      model,
    );
    expect(result.blocking.map((b) => b.code)).not.toContain('ambiguous-diamond-path');
  });

  it('does NOT block a galaxy/conformed-dimension schema (2nd fact → 2nd shared dim)', () => {
    // Textbook galaxy: two facts, two shared (conformed) dimensions. With
    // Sales→Date, Sales→Product, Returns→Date already present, adding
    // Returns→Product relates the 2nd fact to the 2nd shared dim — correct star
    // design (exactly what MOD010 advises), NOT a diamond. The undirected gate
    // false-positived here because Returns reaches Product via Date→Sales→Product;
    // the directed MOD017 detector correctly leaves it alone (no pair gains two
    // edge-disjoint routes differing by intermediate).
    const model: TMDLModel = {
      modelPath: '/',
      tables: [
        tbl('Sales', [col('Sales', 'DateKey', 'int64'), col('Sales', 'ProductKey', 'int64')]),
        tbl('Returns', [col('Returns', 'DateKey', 'int64'), col('Returns', 'ProductKey', 'int64')]),
        tbl('Date', [col('Date', 'DateKey', 'int64', true)]),
        tbl('Product', [col('Product', 'ProductKey', 'int64', true)]),
      ],
      relationships: [
        {
          id: 'rSalesDate',
          fromTable: 'Sales',
          fromColumn: 'DateKey',
          toTable: 'Date',
          toColumn: 'DateKey',
          isActive: true,
          crossFilteringBehavior: 'single',
        },
        {
          id: 'rSalesProduct',
          fromTable: 'Sales',
          fromColumn: 'ProductKey',
          toTable: 'Product',
          toColumn: 'ProductKey',
          isActive: true,
          crossFilteringBehavior: 'single',
        },
        {
          id: 'rReturnsDate',
          fromTable: 'Returns',
          fromColumn: 'DateKey',
          toTable: 'Date',
          toColumn: 'DateKey',
          isActive: true,
          crossFilteringBehavior: 'single',
        },
      ],
    };
    const result = relationshipCheck(
      {
        fromTable: 'Returns',
        fromColumn: 'ProductKey',
        toTable: 'Product',
        toColumn: 'ProductKey',
      },
      model,
    );
    expect(result.blocking.map((b) => b.code)).not.toContain('ambiguous-diamond-path');
    expect(result.valid).toBe(true);
  });

  it('blocks a diamond whose apex sits UPSTREAM of the candidate edge', () => {
    // Existing active rels (fromTable→toTable): B→D, C→D, A→B. Candidate A→C.
    // Post-write directed filter edges (to→from): D→B, D→C, B→A, plus candidate
    // C→A. That gives D two edge-disjoint routes to A (D→B→A and D→C→A) — a genuine
    // diamond on pair (D,A) whose apex D sits UPSTREAM of the candidate edge. A
    // forward-only walk from the candidate's endpoints {A,C} never reaches D, so the
    // earlier gate let this write through while MOD017 flagged it. The all-pairs
    // detector must block it.
    const model = diamondBase([
      {
        id: 'rBD',
        fromTable: 'B',
        fromColumn: 'k',
        toTable: 'D',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
      {
        id: 'rCD',
        fromTable: 'C',
        fromColumn: 'k',
        toTable: 'D',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
      {
        id: 'rAB',
        fromTable: 'A',
        fromColumn: 'k',
        toTable: 'B',
        toColumn: 'k',
        isActive: true,
        crossFilteringBehavior: 'single',
      },
    ]);
    const result = relationshipCheck(
      { fromTable: 'A', fromColumn: 'k', toTable: 'C', toColumn: 'k' },
      model,
    );
    expect(result.valid).toBe(false);
    expect(result.blocking.map((b) => b.code)).toContain('ambiguous-diamond-path');
  });
});
