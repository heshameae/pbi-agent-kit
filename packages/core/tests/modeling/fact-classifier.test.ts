import { describe, expect, it } from 'vitest';
import { classifyTable } from '../../src/modeling/fact-classifier.js';
import type {
  TMDLColumn,
  TMDLModel,
  TMDLRelationship,
  TMDLTable,
} from '../../src/modeling/types.js';

function col(table: string, name: string, overrides: Partial<TMDLColumn> = {}): TMDLColumn {
  return {
    table,
    name,
    dataType: 'string',
    isHidden: false,
    isKey: false,
    isCalculated: false,
    ...overrides,
  };
}

function table(name: string, overrides: Partial<TMDLTable> = {}): TMDLTable {
  return {
    name,
    columns: [],
    measures: [],
    isHidden: false,
    isCalculated: false,
    isAutoDateTable: false,
    ...overrides,
  };
}

function rel(
  id: string,
  fromTable: string,
  fromColumn: string,
  toTable: string,
  toColumn: string,
): TMDLRelationship {
  return {
    id,
    fromTable,
    fromColumn,
    toTable,
    toColumn,
    isActive: true,
    crossFilteringBehavior: 'single',
    cardinality: 'manyToOne',
  };
}

function model(tables: TMDLTable[], relationships: TMDLRelationship[] = []): TMDLModel {
  return { modelPath: '/virtual', tables, relationships };
}

describe('classifyTable', () => {
  it('classifies a fact table (many side + summarizable column)', () => {
    const m = model(
      [
        table('Sales', {
          columns: [
            col('Sales', 'ProductKey', { dataType: 'int64', summarizeBy: 'none' }),
            col('Sales', 'Amount', { dataType: 'decimal', summarizeBy: 'sum' }),
          ],
        }),
        table('Product', {
          columns: [col('Product', 'ProductKey', { dataType: 'int64', isKey: true })],
        }),
      ],
      [rel('r1', 'Sales', 'ProductKey', 'Product', 'ProductKey')],
    );
    const c = classifyTable(m, 'Sales');
    expect(c.kind).toBe('fact');
    expect(c.confidence).toBeGreaterThan(0.5);
  });

  it('classifies a fact via fan-out to multiple dimensions (no summarizable column)', () => {
    const m = model(
      [
        table('FactPrimary', {
          columns: [
            col('FactPrimary', 'ProductKey', { dataType: 'int64', summarizeBy: 'none' }),
            col('FactPrimary', 'CustomerKey', { dataType: 'int64', summarizeBy: 'none' }),
          ],
        }),
        table('Product', { columns: [col('Product', 'ProductKey', { isKey: true })] }),
        table('Customer', { columns: [col('Customer', 'CustomerKey', { isKey: true })] }),
      ],
      [
        rel('r1', 'FactPrimary', 'ProductKey', 'Product', 'ProductKey'),
        rel('r2', 'FactPrimary', 'CustomerKey', 'Customer', 'CustomerKey'),
      ],
    );
    expect(classifyTable(m, 'FactPrimary').kind).toBe('fact');
  });

  it('does NOT classify a conformed dimension as a fact via oneToMany fan-out', () => {
    // A shared dimension authored as the ONE side of >= 2 oneToMany edges is on the
    // from-side of those relationships, but the from-side is the ONE side — counting
    // it as fan-out would misclassify it as a fact (and propose a duplicate dim).
    const oneToMany = (
      id: string,
      fromTable: string,
      fromColumn: string,
      toTable: string,
      toColumn: string,
    ): TMDLRelationship => ({
      ...rel(id, fromTable, fromColumn, toTable, toColumn),
      cardinality: 'oneToMany',
    });
    const m = model(
      [
        table('SharedDim', {
          columns: [col('SharedDim', 'DimKey', { dataType: 'int64', isKey: true })],
        }),
        table('FactA', { columns: [col('FactA', 'DimKey', { dataType: 'int64' })] }),
        table('FactB', { columns: [col('FactB', 'DimKey', { dataType: 'int64' })] }),
      ],
      [
        oneToMany('r1', 'SharedDim', 'DimKey', 'FactA', 'DimKey'),
        oneToMany('r2', 'SharedDim', 'DimKey', 'FactB', 'DimKey'),
      ],
    );
    expect(classifyTable(m, 'SharedDim').kind).not.toBe('fact');
  });

  it('classifies a dimension (only a to-side, no measures)', () => {
    const m = model(
      [
        table('Sales', {
          columns: [
            col('Sales', 'ProductKey', { dataType: 'int64', summarizeBy: 'none' }),
            col('Sales', 'Amount', { dataType: 'decimal', summarizeBy: 'sum' }),
          ],
        }),
        table('Product', {
          columns: [
            col('Product', 'ProductKey', { dataType: 'int64', isKey: true }),
            col('Product', 'Category'),
          ],
        }),
      ],
      [rel('r1', 'Sales', 'ProductKey', 'Product', 'ProductKey')],
    );
    const c = classifyTable(m, 'Product');
    expect(c.kind).toBe('dimension');
    expect(c.confidence).toBeGreaterThan(0.5);
  });

  it('classifies a disconnected attribute-only table as a dimension (0 numerics + 0 measures)', () => {
    const m = model([table('DimShared', { columns: [col('DimShared', 'SharedAxis')] })]);
    expect(classifyTable(m, 'DimShared').kind).toBe('dimension');
  });

  it('returns unknown for an ambiguous table (numerics but no relationships, no measures)', () => {
    const m = model([
      table('Loose', {
        columns: [
          col('Loose', 'Label'),
          col('Loose', 'SomeValue', { dataType: 'decimal', summarizeBy: 'sum' }),
        ],
      }),
    ]);
    // It has a numeric column (so not the 0-numeric dimension branch) but is on
    // neither side of any relationship → cannot be confirmed fact or dim.
    expect(classifyTable(m, 'Loose').kind).toBe('unknown');
  });

  it('returns unknown with 0 confidence for a table not in the model', () => {
    const m = model([table('Sales')]);
    const c = classifyTable(m, 'DoesNotExist');
    expect(c.kind).toBe('unknown');
    expect(c.confidence).toBe(0);
  });
});
