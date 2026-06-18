import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildGrainReport,
  dimColumnsOf,
  inferGrain,
  isDateLikeColumn,
  isKeyLikeColumn,
  validateBridge,
} from '../../src/modeling/grain.js';
import { parseTMDLFolder } from '../../src/modeling/tmdl-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAR_GOOD = path.join(__dirname, 'fixtures', 'star-good');
const BRIDGE = path.join(__dirname, 'fixtures', 'bridge-mismatch');

describe('isDateLikeColumn / isKeyLikeColumn', () => {
  it('flags dateTime data type as date-like', () => {
    expect(
      isDateLikeColumn({
        table: 'T',
        name: 'X',
        dataType: 'dateTime',
        isHidden: false,
        isKey: false,
        isCalculated: false,
      }),
    ).toBe(true);
  });

  it('flags live PascalCase DateTime data type as date-like', () => {
    expect(
      isDateLikeColumn({
        table: 'T',
        name: 'X',
        dataType: 'DateTime',
        isHidden: false,
        isKey: false,
        isCalculated: false,
      }),
    ).toBe(true);
  });

  it('flags name containing Date / Year / Month as date-like', () => {
    expect(
      isDateLikeColumn({
        table: 'T',
        name: 'Order Date',
        dataType: 'string',
        isHidden: false,
        isKey: false,
        isCalculated: false,
      }),
    ).toBe(true);
  });

  it('flags Id / Key / Code / SKU / Number suffix as key-like', () => {
    for (const name of ['OrderId', 'ProductKey', 'ZipCode', 'ItemSKU', 'OrderNumber']) {
      expect(
        isKeyLikeColumn({
          table: 'T',
          name,
          dataType: 'int64',
          isHidden: false,
          isKey: false,
          isCalculated: false,
        }),
      ).toBe(true);
    }
  });
});

describe('dimColumnsOf', () => {
  it('excludes hidden columns and aggregated numeric measures-shaped columns', () => {
    const model = parseTMDLFolder(STAR_GOOD);
    const sales = model.tables.find((t) => t.name === 'Sales');
    if (!sales) throw new Error('Expected Sales table in fixture');
    const dimNames = dimColumnsOf(sales)
      .map((c) => c.name)
      .sort();
    expect(dimNames).toEqual(['DateKey']);
  });

  it('excludes live PascalCase aggregated Decimal columns from dimensions', () => {
    const dims = dimColumnsOf({
      name: 'Fact',
      columns: [
        {
          table: 'Fact',
          name: 'Business Axis',
          dataType: 'String',
          isHidden: false,
          isKey: false,
          isCalculated: false,
        },
        {
          table: 'Fact',
          name: 'Amount',
          dataType: 'Decimal',
          summarizeBy: 'Sum',
          isHidden: false,
          isKey: false,
          isCalculated: false,
        },
      ],
      measures: [],
      isHidden: false,
      isCalculated: false,
      isAutoDateTable: false,
    });

    expect(dims.map((column) => column.name)).toEqual(['Business Axis']);
  });

  it('keeps an explicit capitalized summarizeBy:None numeric (e.g. FiscalYear) as a dimension column', () => {
    // Power BI Desktop / TMDL serialize the enum capitalized ("None"); a case-sensitive
    // check would treat this as an aggregated measure and wrongly drop the surrogate key
    // from the grain/axis set. Must stay a dimension column, consistent with the
    // fact-classifier / field-index case-insensitive handling.
    const dims = dimColumnsOf({
      name: 'Dim',
      columns: [
        {
          table: 'Dim',
          name: 'FiscalYear',
          dataType: 'Int64',
          summarizeBy: 'None',
          isHidden: false,
          isKey: false,
          isCalculated: false,
        },
      ],
      measures: [],
      isHidden: false,
      isCalculated: false,
      isAutoDateTable: false,
    });
    expect(dims.map((column) => column.name)).toEqual(['FiscalYear']);
  });
});

describe('inferGrain', () => {
  it('returns key-like columns when present', () => {
    const model = parseTMDLFolder(STAR_GOOD);
    const product = model.tables.find((t) => t.name === 'Product');
    if (!product) throw new Error('Expected Product table in fixture');
    expect(inferGrain(product)).toContain('Product Name');
  });
});

describe('isKeyLikeColumn (grain heuristic)', () => {
  const col = (name: string, isKey = false) => ({
    table: 'T',
    name,
    dataType: 'int64',
    isHidden: false,
    isKey,
    isCalculated: false,
  });

  // grain uses a deliberately simple suffix heuristic for its display-only grain report
  // (NOT the canonical key matcher used by the gates — see naming.ts; routing grain
  // through the stricter measure-like notion regressed surrogate-key axis detection).
  it('matches the id/key/code/sku/number name suffixes', () => {
    expect(isKeyLikeColumn(col('CustomerKey'))).toBe(true);
    expect(isKeyLikeColumn(col('PostalCode'))).toBe(true);
    expect(isKeyLikeColumn(col('ProductSku'))).toBe(true);
  });

  it('still honors the explicit isKey flag regardless of name', () => {
    expect(isKeyLikeColumn(col('Whatever', true))).toBe(true);
  });
});

describe('validateBridge', () => {
  it('detects bridge_blocked_axes for grain mismatch', () => {
    const model = parseTMDLFolder(BRIDGE);
    const result = validateBridge(model, 'Actuals', 'Targets', ['Region', 'Fine Grain Attribute']);

    expect(result.bridgeCovers.sort()).toEqual(['Category', 'Order Date']);
    expect(result.bridgeUncovered.sort()).toEqual(['Fine Grain Attribute', 'Region']);
    expect(result.bridgeBlockedAxes.sort()).toEqual(['Fine Grain Attribute', 'Region']);
  });

  it('returns empty intersection when no shared columns', () => {
    const model = parseTMDLFolder(STAR_GOOD);
    const result = validateBridge(model, 'Sales', 'Product');
    expect(result.bridgeCovers).toEqual([]);
  });

  it('does not treat live PascalCase additive Decimal columns as bridge axes', () => {
    const model = {
      modelPath: '(live)',
      tables: [
        {
          name: 'Actuals',
          columns: [
            {
              table: 'Actuals',
              name: 'Category',
              dataType: 'String',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
            {
              table: 'Actuals',
              name: 'Amount',
              dataType: 'Decimal',
              summarizeBy: 'Sum',
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
          name: 'Targets',
          columns: [
            {
              table: 'Targets',
              name: 'Category',
              dataType: 'String',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
            {
              table: 'Targets',
              name: 'Amount',
              dataType: 'Decimal',
              summarizeBy: 'Sum',
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
      ],
      relationships: [],
    };

    const result = validateBridge(model, 'Actuals', 'Targets');

    expect(result.bridgeCovers).toEqual(['Category']);
    expect(result.bridgeBlockedAxes).toEqual([]);
  });

  it('throws on unknown table', () => {
    const model = parseTMDLFolder(STAR_GOOD);
    expect(() => validateBridge(model, 'Sales', 'NotARealTable')).toThrow();
  });
});

describe('buildGrainReport', () => {
  it('returns a row per non-auto-date table', () => {
    const model = parseTMDLFolder(STAR_GOOD);
    const r = buildGrainReport(model);
    expect(Object.keys(r.tableGrains).sort()).toEqual(['Calendar', 'Product', 'Sales']);
  });
});
