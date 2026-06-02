import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runBPA } from '../../src/modeling/bpa.js';
import {
  parseRelationshipsFile,
  parseRoleFile,
  parseTMDLFolder,
  parseTableFile,
} from '../../src/modeling/tmdl-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAR_GOOD = path.join(__dirname, 'fixtures', 'star-good');
const BRIDGE = path.join(__dirname, 'fixtures', 'bridge-mismatch');
const RLS_MODEL = path.join(__dirname, 'fixtures', 'rls-model');

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

  it('parses dataCategory and formatString on a column', () => {
    const tbl = parseTableFile(
      [
        'table Date',
        '\tcolumn TheDate',
        '\t\tdataType: dateTime',
        '\t\tdataCategory: Time',
        '',
        '\tcolumn Amount',
        '\t\tdataType: decimal',
        '\t\tsummarizeBy: sum',
        '\t\tformatString: #,0.00',
        '',
      ].join('\n'),
    );
    const date = tbl?.columns.find((c) => c.name === 'TheDate');
    const amount = tbl?.columns.find((c) => c.name === 'Amount');
    expect(date?.dataCategory).toBe('Time');
    expect(amount?.formatString).toBe('#,0.00');
    // Absent → undefined (not empty string).
    expect(date?.formatString).toBeUndefined();
    expect(amount?.dataCategory).toBeUndefined();
  });

  // M1 — calculated-column expression (inline `column 'X' = <DAX>` form).
  it('parses an inline calculated column expression and marks isCalculated', () => {
    const tbl = parseTableFile(
      'table T\n\tcolumn Margin = [Price] - [Cost]\n\t\tformatString: #,0\n',
    );
    const col = tbl?.columns[0];
    if (!col) throw new Error('Expected parsed column');
    expect(col.name).toBe('Margin');
    expect(col.isCalculated).toBe(true);
    expect(col.expression).toBe('[Price] - [Cost]');
    expect(col.formatString).toBe('#,0');
  });

  // M1 — multi-line calc column (`column X =` then indented continuation).
  it('parses a multi-line calculated column expression', () => {
    const tbl = parseTableFile(
      [
        'table T',
        '\tcolumn Margin =',
        '\t\t[Price] -',
        '\t\t[Cost]',
        '\t\tformatString: #,0',
        '',
      ].join('\n'),
    );
    const col = tbl?.columns[0];
    if (!col) throw new Error('Expected parsed column');
    expect(col.isCalculated).toBe(true);
    expect(col.expression).toContain('[Price]');
    expect(col.expression).toContain('[Cost]');
    expect(col.formatString).toBe('#,0');
  });

  // M1 negative — a plain data column has no expression and is not calculated;
  // the sawCalcSignal guard must keep a stray body line out of `expression`.
  it('does not treat a plain data column as calculated', () => {
    const tbl = parseTableFile(
      'table T\n\tcolumn Foo\n\t\tdataType: int64\n\t\tsourceColumn: Foo\n',
    );
    const col = tbl?.columns[0];
    if (!col) throw new Error('Expected parsed column');
    expect(col.isCalculated).toBe(false);
    expect(col.expression).toBeUndefined();
  });

  // M3 — sortByColumn + isAvailableInMDX on a column.
  it('parses sortByColumn and isAvailableInMDX (false) on a column', () => {
    const tbl = parseTableFile(
      'table T\n\tcolumn Month\n\t\tdataType: string\n\t\tsortByColumn: MonthNo\n\t\tisAvailableInMDX: false\n',
    );
    const col = tbl?.columns[0];
    expect(col?.sortByColumn).toBe('MonthNo');
    expect(col?.isAvailableInMdx).toBe(false);
  });

  // M3 — absent properties stay undefined (isAvailableInMdx must NOT default to true).
  it('leaves sortByColumn and isAvailableInMDX undefined when absent', () => {
    const tbl = parseTableFile('table T\n\tcolumn Month\n\t\tdataType: string\n');
    const col = tbl?.columns[0];
    expect(col?.sortByColumn).toBeUndefined();
    expect(col?.isAvailableInMdx).toBeUndefined();
  });

  // M4 — column description via the `///` above-header form and the body line.
  it('parses column descriptions from both the /// form and a body description: line', () => {
    const tbl = parseTableFile(
      [
        'table T',
        '\t/// Doc for A.',
        '\tcolumn A',
        '\t\tdataType: string',
        '',
        '\tcolumn B',
        '\t\tdataType: string',
        '\t\tdescription: Doc for B.',
        '',
      ].join('\n'),
    );
    expect(tbl?.columns.find((c) => c.name === 'A')?.description).toBe('Doc for A.');
    expect(tbl?.columns.find((c) => c.name === 'B')?.description).toBe('Doc for B.');
  });

  // M4 — table description via the `///` above-header form and a body line.
  it('parses a table description from the /// form and a body description: line', () => {
    const viaSlashes = parseTableFile(
      '/// Table doc.\ntable T\n\tcolumn A\n\t\tdataType: string\n',
    );
    expect(viaSlashes?.description).toBe('Table doc.');
    const viaBody = parseTableFile(
      'table T\n\tdescription: Body table doc.\n\tcolumn A\n\t\tdataType: string\n',
    );
    expect(viaBody?.description).toBe('Body table doc.');
  });

  // M5 — column displayFolder.
  it('parses displayFolder on a column', () => {
    const tbl = parseTableFile(
      'table T\n\tcolumn A\n\t\tdataType: string\n\t\tdisplayFolder: Attributes\n',
    );
    expect(tbl?.columns[0]?.displayFolder).toBe('Attributes');
  });

  // M6 — storageMode from a partition `mode:` sub-block.
  it('parses table storageMode from a partition mode: line', () => {
    const dq = parseTableFile(
      'table T\n\tpartition T = m\n\t\tmode: DirectQuery\n\t\tsource = let x = 1 in x\n\tcolumn A\n\t\tdataType: string\n',
    );
    expect(dq?.storageMode).toBe('directQuery');
    const imp = parseTableFile(
      'table T\n\tpartition T = m\n\t\tmode: Import\n\t\tsource = let x = 1 in x\n',
    );
    expect(imp?.storageMode).toBe('import');
    // Absent → undefined.
    const none = parseTableFile('table T\n\tcolumn A\n\t\tdataType: string\n');
    expect(none?.storageMode).toBeUndefined();
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

  // M5 — measure displayFolder (regression: the parser previously dropped it).
  it('captures displayFolder on a measure (previously discarded)', () => {
    const tbl = parseTableFile(
      'table T\n\tmeasure Foo = SUM(T[X])\n\t\tformatString: #,0\n\t\tdisplayFolder: KPIs\n',
    );
    expect(tbl?.measures[0]?.displayFolder).toBe('KPIs');
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

  it('derives manyToOne from fromCardinality: many + toCardinality: one', () => {
    const rels = parseRelationshipsFile(
      [
        'relationship r1',
        '\tfromColumn: Sales.ProductKey',
        '\ttoColumn: Product.ProductKey',
        '\tfromCardinality: many',
        '\ttoCardinality: one',
        '',
      ].join('\n'),
    );
    expect(rels[0]?.cardinality).toBe('manyToOne');
  });

  it('derives oneToMany, oneToOne, and manyToMany from both sides', () => {
    const oneToMany = parseRelationshipsFile(
      'relationship r\n\tfromColumn: A.K\n\ttoColumn: B.K\n\tfromCardinality: one\n\ttoCardinality: many\n',
    );
    const oneToOne = parseRelationshipsFile(
      'relationship r\n\tfromColumn: A.K\n\ttoColumn: B.K\n\tfromCardinality: one\n\ttoCardinality: one\n',
    );
    const manyToMany = parseRelationshipsFile(
      'relationship r\n\tfromColumn: A.K\n\ttoColumn: B.K\n\tfromCardinality: many\n\ttoCardinality: many\n',
    );
    expect(oneToMany[0]?.cardinality).toBe('oneToMany');
    expect(oneToOne[0]?.cardinality).toBe('oneToOne');
    expect(manyToMany[0]?.cardinality).toBe('manyToMany');
  });

  it('defaults to manyToOne when cardinality is absent (PBI default)', () => {
    const rels = parseRelationshipsFile('relationship r\n\tfromColumn: A.K\n\ttoColumn: B.K\n');
    expect(rels[0]?.cardinality).toBe('manyToOne');
  });

  // M6 — relyOnReferentialIntegrity (Assume RI) on a relationship.
  it('captures relyOnReferentialIntegrity when set, undefined when absent', () => {
    const withRi = parseRelationshipsFile(
      'relationship r\n\tfromColumn: A.K\n\ttoColumn: B.K\n\trelyOnReferentialIntegrity: true\n',
    );
    expect(withRi[0]?.relyOnReferentialIntegrity).toBe(true);
    const withoutRi = parseRelationshipsFile(
      'relationship r\n\tfromColumn: A.K\n\ttoColumn: B.K\n',
    );
    expect(withoutRi[0]?.relyOnReferentialIntegrity).toBeUndefined();
  });

  // REGRESSION (the headline fix): a normal 1:many relationship must NOT be
  // mislabeled manyToMany and therefore must NOT trip MOD003. The old parser
  // set manyToMany on seeing `many` on either side, false-positiving every real
  // star-schema edge.
  it('a normal many+one relationship does NOT trigger MOD003', () => {
    const relationships = parseRelationshipsFile(
      [
        'relationship rel_sales_product',
        '\tfromColumn: Sales.ProductKey',
        '\ttoColumn: Product.ProductKey',
        '\tfromCardinality: many',
        '\ttoCardinality: one',
        '',
      ].join('\n'),
    );
    expect(relationships[0]?.cardinality).toBe('manyToOne');

    const model = {
      modelPath: '/virtual',
      tables: [
        {
          name: 'Sales',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [
            {
              table: 'Sales',
              name: 'ProductKey',
              dataType: 'int64',
              isHidden: false,
              isKey: false,
              isCalculated: false,
            },
          ],
          measures: [],
        },
        {
          name: 'Product',
          isHidden: false,
          isCalculated: false,
          isAutoDateTable: false,
          columns: [
            {
              table: 'Product',
              name: 'ProductKey',
              dataType: 'int64',
              isHidden: false,
              isKey: true,
              isCalculated: false,
            },
          ],
          measures: [],
        },
      ],
      relationships,
    };
    const violations = runBPA(model);
    expect(violations.find((v) => v.ruleId === 'MOD003')).toBeFalsy();
  });
});

// M2 — RLS role file parsing.
describe('parseRoleFile', () => {
  it('parses a role name and an inline tablePermission filter', () => {
    const role = parseRoleFile(
      'role Manager\n\tmodelPermission: read\n\ttablePermission Sales = \'Sales\'[Region] = "West"\n',
    );
    expect(role).toEqual({
      name: 'Manager',
      tablePermissions: [{ table: 'Sales', filterExpression: '\'Sales\'[Region] = "West"' }],
    });
  });

  it('unquotes a quoted role name and parses a multi-line tablePermission filter', () => {
    const role = parseRoleFile(
      "role 'Sales Manager'\n\ttablePermission Customer =\n\t\t'Customer'[Country] IN VALUES(X)\n",
    );
    expect(role?.name).toBe('Sales Manager');
    expect(role?.tablePermissions[0]?.table).toBe('Customer');
    expect(role?.tablePermissions[0]?.filterExpression).toBe("'Customer'[Country] IN VALUES(X)");
  });

  it('treats a static role (no tablePermission lines) as empty permissions', () => {
    const role = parseRoleFile('role Static\n\tmodelPermission: read\n');
    expect(role).toEqual({ name: 'Static', tablePermissions: [] });
  });

  it('returns null when there is no role header', () => {
    expect(parseRoleFile('modelPermission: read\n')).toBeNull();
  });
});

describe('parseTMDLFolder', () => {
  it('reads the star-good fixture with 3 tables and 2 relationships', () => {
    const model = parseTMDLFolder(STAR_GOOD);
    const names = model.tables.map((t) => t.name).sort();
    expect(names).toEqual(['Calendar', 'Product', 'Sales']);
    expect(model.relationships.length).toBe(2);
  });

  // M2 — omit `roles` entirely when the model has no roles/ directory.
  it('leaves roles undefined for a model with no roles directory', () => {
    const model = parseTMDLFolder(STAR_GOOD);
    expect(model.roles).toBeUndefined();
  });

  // M1/M2/M4/M5/M6 end-to-end via the rls-model fixture (1 fact, 1 dim, 1 role).
  it('reads the rls-model fixture: roles, calc column, descriptions, and Assume-RI', () => {
    const model = parseTMDLFolder(RLS_MODEL);
    expect(model.tables.map((t) => t.name).sort()).toEqual(['Customer', 'Sales']);

    // M2 — the role and its dynamic-ish permission are captured.
    expect(model.roles).toBeDefined();
    expect(model.roles?.length).toBe(1);
    const role = model.roles?.[0];
    expect(role?.name).toBe('Sales Manager');
    expect(role?.tablePermissions[0]?.table).toBe('Customer');
    expect(role?.tablePermissions[0]?.filterExpression).toContain('[Region]');

    // M1 — the calculated column's expression + isCalculated.
    const sales = model.tables.find((t) => t.name === 'Sales');
    const netAmount = sales?.columns.find((c) => c.name === 'Net Amount');
    expect(netAmount?.isCalculated).toBe(true);
    expect(netAmount?.expression).toBe('Sales[Amount] * 0.9');
    expect(netAmount?.displayFolder).toBe('Calculations');

    // M4 — table description (///) and column description (body line).
    expect(sales?.description).toBe('Sales fact table (one row per order line).');
    const region = model.tables
      .find((t) => t.name === 'Customer')
      ?.columns.find((c) => c.name === 'Region');
    expect(region?.description).toBe('Sales region the customer belongs to.');

    // M5 — measure displayFolder.
    expect(sales?.measures.find((m) => m.name === 'Total Amount')?.displayFolder).toBe('KPIs');

    // M6 — relationship relyOnReferentialIntegrity.
    expect(model.relationships[0]?.relyOnReferentialIntegrity).toBe(true);
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
