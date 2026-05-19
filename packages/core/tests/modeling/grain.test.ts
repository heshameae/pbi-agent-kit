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
});

describe('inferGrain', () => {
  it('returns key-like columns when present', () => {
    const model = parseTMDLFolder(STAR_GOOD);
    const product = model.tables.find((t) => t.name === 'Product');
    if (!product) throw new Error('Expected Product table in fixture');
    expect(inferGrain(product)).toContain('Product Name');
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
