import { describe, expect, it } from 'vitest';
import { checkRelationships } from '../../src/modeling/relationship-check.js';
import type { TMDLColumn, TMDLModel, TMDLTable } from '../../src/modeling/types.js';

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
