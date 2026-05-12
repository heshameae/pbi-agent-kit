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
  const r = reportCreate({ targetPath: tmp, name: 'Demo' });
  defn = r.definitionPath;
  pageAdd(defn, { displayName: 'P', name: PAGE });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('parseFieldRef', () => {
  it.each([
    ['Sales[Revenue]', 'Sales', 'Revenue'],
    ['Geography[Region Name]', 'Geography', 'Region Name'],
    ['  Sales[Revenue]  ', 'Sales', 'Revenue'],
  ])('parses "%s" → %s / %s', (ref, table, column) => {
    expect(parseFieldRef(ref)).toEqual({ table, column });
  });

  it.each(['Sales', 'Sales.Revenue', '[Revenue]', 'Sales]', ''])('rejects "%s"', (ref) => {
    expect(() => parseFieldRef(ref)).toThrow(PbiCoreError);
  });
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
    visualBind(defn, PAGE, 'v1', [{ role: 'Y', field: 'Sales[Total Revenue]' }]);

    const [proj] = getProjections('v1', 'Y') as [Record<string, unknown>];
    expect(proj.queryRef).toBe('Sales.Total Revenue');
    expect(proj.nativeQueryRef).toBe('Total Revenue');
    expect(proj).not.toHaveProperty('active'); // Measures must NOT have active.

    const field = proj.field as Record<string, unknown>;
    expect(field).toHaveProperty('Measure');
    expect(field).not.toHaveProperty('Column');
    const m = field.Measure as Record<string, unknown>;
    expect(m.Property).toBe('Total Revenue');
    expect(
      ((m.Expression as Record<string, unknown>).SourceRef as Record<string, unknown>).Entity,
    ).toBe('Sales');
  });

  it('respects an alias: "value" → "Y" on barChart', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [{ role: 'value', field: 'Sales[Revenue]' }]);
    expect(getProjections('v1', 'Y')).toHaveLength(1);
  });
});

describe('visualBind: column shape', () => {
  it('writes a Column projection for Category role on barChart', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [{ role: 'Category', field: 'Geography[Region]' }]);

    const [proj] = getProjections('v1', 'Category') as [Record<string, unknown>];
    expect(proj.queryRef).toBe('Geography.Region');
    expect(proj.nativeQueryRef).toBe('Region');
    expect(proj.active).toBe(true); // Columns MUST have active=true.

    const field = proj.field as Record<string, unknown>;
    expect(field).toHaveProperty('Column');
    expect(field).not.toHaveProperty('Measure');
  });

  it('respects an alias: "category" → "Category" on barChart', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [{ role: 'category', field: 'Geography[Region]' }]);
    expect(getProjections('v1', 'Category')).toHaveLength(1);
  });
});

describe('visualBind: explicit measure override', () => {
  it('forces a Column-role field to be treated as Measure when measure=true', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    visualBind(defn, PAGE, 'v1', [{ role: 'Category', field: 'Sales[Revenue]', measure: true }]);
    const [proj] = getProjections('v1', 'Category') as [Record<string, unknown>];
    expect(proj).not.toHaveProperty('active');
    expect((proj.field as Record<string, unknown>).Measure).toBeDefined();
  });
});

describe('visualBind: appending and multi-role', () => {
  it('appends to existing role projections', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'c1' });
    visualBind(defn, PAGE, 'c1', [{ role: 'Values', field: 'Sales[A]' }]);
    visualBind(defn, PAGE, 'c1', [{ role: 'Values', field: 'Sales[B]' }]);
    expect(getProjections('c1', 'Values')).toHaveLength(2);
  });

  it('binds multiple roles in one call', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const r = visualBind(defn, PAGE, 'v1', [
      { role: 'Category', field: 'Geography[Region]' },
      { role: 'Y', field: 'Sales[Revenue]' },
      { role: 'Legend', field: 'Product[Category]' },
    ]);
    expect(r.bindings).toHaveLength(3);
    expect(getProjections('v1', 'Category')).toHaveLength(1);
    expect(getProjections('v1', 'Y')).toHaveLength(1);
    expect(getProjections('v1', 'Legend')).toHaveLength(1);
  });
});

describe('visualBind: error paths', () => {
  it('throws on unknown visual', () => {
    expect(() => visualBind(defn, PAGE, 'missing', [{ role: 'Y', field: 'S[r]' }])).toThrow(
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
    visualBind(defn, PAGE, 'v1', [{ role: 'CustomThing', field: 'Sales[Revenue]' }]);
    expect(getProjections('v1', 'CustomThing')).toHaveLength(1);
  });
});
