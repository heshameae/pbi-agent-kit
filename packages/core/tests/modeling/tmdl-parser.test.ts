import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseRelationshipsFile,
  parseTMDLFolder,
  parseTableFile,
} from '../../src/modeling/tmdl-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAR_GOOD = path.join(__dirname, 'fixtures', 'star-good');
const BRIDGE = path.join(__dirname, 'fixtures', 'bridge-mismatch');

describe('parseTableFile', () => {
  it('reads table name from quoted ident', () => {
    const tbl = parseTableFile("table 'My Fact Table'\n\tcolumn Foo\n\t\tdataType: string\n");
    expect(tbl?.name).toBe('My Fact Table');
  });

  it('parses a column block with properties', () => {
    const tbl = parseTableFile(
      'table T\n\tcolumn Foo\n\t\tdataType: int64\n\t\tsummarizeBy: sum\n\t\tisHidden: true\n\t\tisKey: true\n',
    );
    expect(tbl?.columns.length).toBe(1);
    const col = tbl?.columns[0];
    if (!col) throw new Error('Expected parsed column');
    expect(col.name).toBe('Foo');
    expect(col.dataType).toBe('int64');
    expect(col.summarizeBy).toBe('sum');
    expect(col.isHidden).toBe(true);
    expect(col.isKey).toBe(true);
  });

  it('parses a measure with inline expression and formatString', () => {
    const tbl = parseTableFile('table T\n\tmeasure Foo = SUM(T[X])\n\t\tformatString: #,0\n');
    expect(tbl?.measures.length).toBe(1);
    const m = tbl?.measures[0];
    if (!m) throw new Error('Expected parsed measure');
    expect(m.name).toBe('Foo');
    expect(m.expression).toBe('SUM(T[X])');
    expect(m.formatString).toBe('#,0');
  });

  it('parses measure annotations', () => {
    const tbl = parseTableFile(
      [
        'table FactBridgeFrom',
        '\tmeasure BridgeMetric = CALCULATE(SUM(FactBridgeTo[PlanMetric]), TREATAS(VALUES(FactBridgeFrom[SharedAxis]), FactBridgeTo[SharedAxis]))',
        '\t\tformatString: #,##0',
        '\t\tannotation pbi_bridge_from = FactBridgeFrom',
        '\t\tannotation pbi_bridge_to = FactBridgeTo',
        '\t\tannotation pbi_bridge_via = TREATAS',
        '\t\tannotation pbi_bridge_covers = "[\\"FactBridgeFrom[SharedAxis]\\"]"',
      ].join('\n'),
    );

    expect(tbl?.measures[0]?.annotations).toEqual({
      pbi_bridge_from: 'FactBridgeFrom',
      pbi_bridge_to: 'FactBridgeTo',
      pbi_bridge_via: 'TREATAS',
      pbi_bridge_covers: '["FactBridgeFrom[SharedAxis]"]',
    });
  });

  it('unquotes double-quoted annotation values and handles escapes', () => {
    const tbl = parseTableFile(
      [
        'table FactBridgeFrom',
        '\tmeasure BridgeMetric = SUM(FactBridgeFrom[ValueMetric])',
        '\t\tformatString: #,##0',
        '\t\tannotation pbi_bridge_from = "FactBridgeFrom"',
        '\t\tannotation pbi_bridge_to = "FactBridgeTo"',
        '\t\tannotation pbi_bridge_via = "TREATAS"',
        '\t\tannotation pbi_bridge_covers = "[\\"FactBridgeFrom[SharedAxis]\\"]"',
      ].join('\n'),
    );

    expect(tbl?.measures[0]?.annotations).toEqual({
      pbi_bridge_from: 'FactBridgeFrom',
      pbi_bridge_to: 'FactBridgeTo',
      pbi_bridge_via: 'TREATAS',
      pbi_bridge_covers: '["FactBridgeFrom[SharedAxis]"]',
    });
  });

  it('parses a measure with multi-line body expression', () => {
    const src =
      'table T\n' +
      '\tmeasure Foo =\n' +
      '\t\tCALCULATE(\n' +
      '\t\t  SUM(T[X]),\n' +
      '\t\t  T[Y] = 1\n' +
      '\t\t)\n' +
      '\t\tformatString: #,0\n';
    const tbl = parseTableFile(src);
    const m = tbl?.measures[0];
    if (!m) throw new Error('Expected parsed measure');
    expect(m.expression).toContain('CALCULATE');
    expect(m.expression).toContain('SUM(T[X])');
    expect(m.formatString).toBe('#,0');
  });

  it('detects auto date tables by name prefix', () => {
    const a = parseTableFile('table LocalDateTable_abc\n\tcolumn Date\n\t\tdataType: dateTime\n');
    const b = parseTableFile(
      'table DateTableTemplate_xyz\n\tcolumn Date\n\t\tdataType: dateTime\n',
    );
    const c = parseTableFile('table Calendar\n\tcolumn Date\n\t\tdataType: dateTime\n');
    expect(a?.isAutoDateTable).toBe(true);
    expect(b?.isAutoDateTable).toBe(true);
    expect(c?.isAutoDateTable).toBe(false);
  });
});

describe('parseRelationshipsFile', () => {
  it('parses unquoted and quoted column refs', () => {
    const rels = parseRelationshipsFile(
      "relationship r1\n\tfromColumn: A.B\n\ttoColumn: 'My Table'.'My Col'\n",
    );
    expect(rels.length).toBe(1);
    expect(rels[0]).toMatchObject({
      fromTable: 'A',
      fromColumn: 'B',
      toTable: 'My Table',
      toColumn: 'My Col',
      isActive: true,
    });
  });

  it('respects isActive and crossFilteringBehavior', () => {
    const rels = parseRelationshipsFile(
      'relationship r1\n\tfromColumn: A.B\n\ttoColumn: C.D\n\tisActive: false\n\tcrossFilteringBehavior: bothDirections\n',
    );
    expect(rels[0]?.isActive).toBe(false);
    expect(rels[0]?.crossFilteringBehavior).toBe('both');
  });
});

describe('parseTMDLFolder', () => {
  it('reads the star-good fixture with 3 tables and 2 relationships', () => {
    const model = parseTMDLFolder(STAR_GOOD);
    const names = model.tables.map((t) => t.name).sort();
    expect(names).toEqual(['Calendar', 'Product', 'Sales']);
    expect(model.relationships.length).toBe(2);
  });

  it('reads the bridge-mismatch fixture with 2 fact-style tables', () => {
    const model = parseTMDLFolder(BRIDGE);
    expect(model.tables.length).toBe(2);
    const actuals = model.tables.find((t) => t.name === 'Actuals');
    expect(actuals).toBeDefined();
    expect(actuals?.columns.map((c) => c.name).sort()).toEqual([
      'Amount',
      'Category',
      'Fine Grain Attribute',
      'Order Date',
      'Region',
    ]);
  });
});
