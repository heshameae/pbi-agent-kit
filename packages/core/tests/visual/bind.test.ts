import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PbiCoreError,
  pageAdd,
  parseFieldRef,
  readJson,
  reportCreate,
  visualAdd,
  visualBind,
} from '../../src/index.js';

let tmp: string;
let defn: string;
const PAGE = 'p1';

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-bind-')));
  const r = reportCreate({ targetPath: tmp, name: 'MyReport' });
  defn = r.definitionPath;
  pageAdd(defn, { displayName: 'P', name: PAGE });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('parseFieldRef', () => {
  it.each([
    ['MyTable[MyMeasure]', 'MyTable', 'MyMeasure'],
    ['MyOtherTable[My Column With Spaces]', 'MyOtherTable', 'My Column With Spaces'],
    ['  MyTable[MyMeasure]  ', 'MyTable', 'MyMeasure'],
  ])('parses "%s" → %s / %s', (ref, table, column) => {
    expect(parseFieldRef(ref)).toEqual({ table, column });
  });

  it.each(['MyTable', 'MyTable.MyMeasure', '[MyMeasure]', 'MyTable]', ''])(
    'rejects "%s"',
    (ref) => {
      expect(() => parseFieldRef(ref)).toThrow(PbiCoreError);
    },
  );
});

function getProjections(visualName: string, role: string): unknown[] {
  const vfile = path.join(defn, 'pages', PAGE, 'visuals', visualName, 'visual.json');
  const data = readJson(vfile) as Record<string, unknown>;
  const visual = data.visual as Record<string, unknown>;
  const query = visual.query as Record<string, unknown>;
  const queryState = query.queryState as Record<string, unknown>;
  const roleState = (queryState[role] as Record<string, unknown>) ?? {};
  return Array.isArray(roleState.projections) ? roleState.projections : [];
}

describe('visualBind: measure shape', () => {
  it('writes a Measure projection for Y role on barChart', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [{ role: 'Y', field: 'MyTable[My Measure With Spaces]' }]);

    const [proj] = getProjections('v1', 'Y') as [Record<string, unknown>];
    expect(proj.queryRef).toBe('MyTable.My Measure With Spaces');
    expect(proj.nativeQueryRef).toBe('My Measure With Spaces');
    expect(proj).not.toHaveProperty('active'); // Measures must NOT have active.

    const field = proj.field as Record<string, unknown>;
    expect(field).toHaveProperty('Measure');
    expect(field).not.toHaveProperty('Column');
    const m = field.Measure as Record<string, unknown>;
    expect(m.Property).toBe('My Measure With Spaces');
    expect(
      ((m.Expression as Record<string, unknown>).SourceRef as Record<string, unknown>).Entity,
    ).toBe('MyTable');
  });

  it('respects an alias: "value" → "Y" on barChart', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [{ role: 'value', field: 'MyTable[MyMeasure]' }]);
    expect(getProjections('v1', 'Y')).toHaveLength(1);
  });
});

describe('visualBind: column shape', () => {
  it('writes a Column projection for Category role on barChart', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [{ role: 'Category', field: 'MyOtherTable[MyColumn]' }]);

    const [proj] = getProjections('v1', 'Category') as [Record<string, unknown>];
    expect(proj.queryRef).toBe('MyOtherTable.MyColumn');
    expect(proj.nativeQueryRef).toBe('MyColumn');
    expect(proj.active).toBe(true); // Columns MUST have active=true.

    const field = proj.field as Record<string, unknown>;
    expect(field).toHaveProperty('Column');
    expect(field).not.toHaveProperty('Measure');
  });

  it('respects an alias: "category" → "Category" on barChart', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [{ role: 'category', field: 'MyOtherTable[MyColumn]' }]);
    expect(getProjections('v1', 'Category')).toHaveLength(1);
  });
});

describe('visualBind: explicit measure override', () => {
  it('forces a Column-role field to be treated as Measure when measure=true', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [
      { role: 'Category', field: 'MyTable[MyMeasure]', measure: true },
    ]);
    const [proj] = getProjections('v1', 'Category') as [Record<string, unknown>];
    expect(proj).not.toHaveProperty('active');
    expect((proj.field as Record<string, unknown>).Measure).toBeDefined();
  });
});

describe('visualBind: aggregated column (for summable columns in measure-style roles)', () => {
  it('wraps a column in Aggregation{Sum} when aggregation:"sum" is passed', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [
      { role: 'Values', field: 'MyTable[MyNumColumn]', measure: false, aggregation: 'sum' },
    ]);
    const [proj] = getProjections('v1', 'Values') as [Record<string, unknown>];
    const field = proj.field as Record<string, unknown>;
    expect(field).toHaveProperty('Aggregation');
    const agg = field.Aggregation as Record<string, unknown>;
    expect(agg.Function).toBe(0); // Sum = 0
    const inner = agg.Expression as Record<string, unknown>;
    expect(inner).toHaveProperty('Column');
    const col = inner.Column as Record<string, unknown>;
    expect(col.Property).toBe('MyNumColumn');
    // queryRef + nativeQueryRef should reflect the aggregation
    expect(proj.queryRef).toBe('Sum(MyTable.MyNumColumn)');
    expect(proj.nativeQueryRef).toBe('Sum of MyNumColumn');
    // Aggregated columns still get active:true
    expect(proj.active).toBe(true);
  });

  it('maps aggregation kinds to the correct PBI Function codes', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'v1' });
    const kinds = ['sum', 'avg', 'count', 'min', 'max'] as const;
    const expectedCodes = [0, 1, 2, 3, 4];
    for (let i = 0; i < kinds.length; i++) {
      visualBind(defn, PAGE, 'v1', [
        {
          role: `R${i}`,
          field: `MyTable[MyCol${i}]`,
          measure: false,
          aggregation: kinds[i],
        },
      ]);
    }
    for (let i = 0; i < kinds.length; i++) {
      const [proj] = getProjections('v1', `R${i}`) as [Record<string, unknown>];
      const agg = (proj.field as Record<string, unknown>).Aggregation as Record<string, unknown>;
      expect(agg.Function).toBe(expectedCodes[i]);
    }
  });

  it('throws when aggregation is set on a Measure-typed binding', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'v1' });
    expect(() =>
      visualBind(defn, PAGE, 'v1', [
        { role: 'Values', field: 'MyTable[MyMeasure]', measure: true, aggregation: 'sum' },
      ]),
    ).toThrow(/Measure/);
  });

  it('omitting aggregation on measure:false still produces raw Column (identity)', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [
      { role: 'Category', field: 'MyTable[MyDimColumn]', measure: false },
    ]);
    const [proj] = getProjections('v1', 'Category') as [Record<string, unknown>];
    const field = proj.field as Record<string, unknown>;
    expect(field).toHaveProperty('Column');
    expect(field).not.toHaveProperty('Aggregation');
  });
});

describe('visualBind: appending and multi-role', () => {
  it('appends to existing role projections', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'c1' });
    visualBind(defn, PAGE, 'c1', [{ role: 'Values', field: 'MyTable[FieldA]' }]);
    visualBind(defn, PAGE, 'c1', [{ role: 'Values', field: 'MyTable[FieldB]' }]);
    expect(getProjections('c1', 'Values')).toHaveLength(2);
  });

  it('binds multiple roles in one call', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const r = visualBind(defn, PAGE, 'v1', [
      { role: 'Category', field: 'MyOtherTable[MyColumn]' },
      { role: 'Y', field: 'MyTable[MyMeasure]' },
      { role: 'Legend', field: 'MyThirdTable[MyOtherColumn]' },
    ]);
    expect(r.bindings).toHaveLength(3);
    expect(getProjections('v1', 'Category')).toHaveLength(1);
    expect(getProjections('v1', 'Y')).toHaveLength(1);
    expect(getProjections('v1', 'Legend')).toHaveLength(1);
  });
});

describe('visualBind: error paths', () => {
  it('throws on unknown visual', () => {
    expect(() => visualBind(defn, PAGE, 'missing', [{ role: 'Y', field: 'T[c]' }])).toThrow(
      PbiCoreError,
    );
  });

  it('throws on malformed field reference', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    expect(() => visualBind(defn, PAGE, 'v1', [{ role: 'Y', field: 'bogus' }])).toThrow(
      PbiCoreError,
    );
  });
});

describe('visualBind: roles that need passes-through', () => {
  it('preserves unknown-role names verbatim (not in ROLE_ALIASES)', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [{ role: 'CustomThing', field: 'MyTable[MyMeasure]' }]);
    expect(getProjections('v1', 'CustomThing')).toHaveLength(1);
  });
});
