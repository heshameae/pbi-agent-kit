import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PbiCoreError,
  filterAddCategorical,
  filterAddRelativeDate,
  filterAddTopN,
  filterClear,
  filterList,
  filterRemove,
  pageAdd,
  readJson,
  reportCreate,
  visualAdd,
} from '../../src/index.js';

let tmp: string;
let defn: string;
const PAGE = 'p1';

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-filter-')));
  const r = reportCreate({ targetPath: tmp, name: 'Demo' });
  defn = r.definitionPath;
  pageAdd(defn, { displayName: 'P', name: PAGE });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function readPageFilters(): Record<string, unknown>[] {
  const p = path.join(defn, 'pages', PAGE, 'page.json');
  const data = readJson(p) as Record<string, unknown>;
  const fc = (data.filterConfig as Record<string, unknown>) ?? {};
  return Array.isArray(fc.filters) ? (fc.filters as Record<string, unknown>[]) : [];
}

describe('filterAddCategorical', () => {
  it('adds a page-level categorical filter with howCreated', () => {
    const r = filterAddCategorical(defn, {
      page: PAGE,
      table: 'Geography',
      column: 'Region',
      values: ['West', 'East'],
    });
    expect(r.scope).toBe('page');
    const f = readPageFilters()[0] as Record<string, unknown>;
    expect(f.type).toBe('Categorical');
    expect(f.howCreated).toBe('User');
    expect(f.name).toBe(r.name);
  });

  it('omits howCreated for visual-scope', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const r = filterAddCategorical(defn, {
      page: PAGE,
      visual: 'v1',
      table: 'Geography',
      column: 'Region',
      values: ['West'],
    });
    expect(r.scope).toBe('visual');
    const vp = path.join(defn, 'pages', PAGE, 'visuals', 'v1', 'visual.json');
    const v = readJson(vp) as Record<string, unknown>;
    const fc = (v.filterConfig as Record<string, unknown>) ?? {};
    const f = (fc.filters as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(f).not.toHaveProperty('howCreated');
  });

  it('encodes Power BI literals correctly (int "L", double "D", quoted string)', () => {
    filterAddCategorical(defn, {
      page: PAGE,
      table: 'Sales',
      column: 'Year',
      values: ['2024', '3.14', 'Hello'],
    });
    const f = readPageFilters()[0] as Record<string, unknown>;
    const filter = f.filter as Record<string, unknown>;
    const where = (filter.Where as unknown[])[0] as Record<string, unknown>;
    const cond = where.Condition as Record<string, unknown>;
    const inOp = cond.In as Record<string, unknown>;
    const values = inOp.Values as unknown[];
    const literals = values.map((row) => {
      const r = (row as unknown[])[0] as Record<string, unknown>;
      const lit = r.Literal as Record<string, unknown>;
      return lit.Value;
    });
    expect(literals).toEqual(['2024L', '3.14D', "'Hello'"]);
  });
});

describe('filterAddTopN', () => {
  it('writes scope=page with howCreated and TopN direction=2 for Top', () => {
    const r = filterAddTopN(defn, {
      page: PAGE,
      table: 'Customer',
      column: 'Name',
      n: 10,
      orderByTable: 'Sales',
      orderByColumn: 'Revenue',
    });
    expect(r.direction).toBe('Top');
    const f = readPageFilters()[0] as Record<string, unknown>;
    expect(f.type).toBe('TopN');
    expect(f.howCreated).toBe('User');
  });

  it('rejects invalid direction', () => {
    expect(() =>
      filterAddTopN(defn, {
        page: PAGE,
        table: 'X',
        column: 'Y',
        n: 5,
        orderByTable: 'X',
        orderByColumn: 'Y',
        direction: 'Side' as unknown as 'Top',
      }),
    ).toThrow(PbiCoreError);
  });
});

describe('filterAddRelativeDate', () => {
  it('adds a months relative-date filter', () => {
    const r = filterAddRelativeDate(defn, {
      page: PAGE,
      table: 'Calendar',
      column: 'Date',
      amount: 6,
      timeUnit: 'months',
    });
    expect(r.timeUnit).toBe('months');
    const f = readPageFilters()[0] as Record<string, unknown>;
    expect(f.type).toBe('RelativeDate');
  });
});

describe('filterList / Remove / Clear', () => {
  it('lists added filters', () => {
    filterAddCategorical(defn, {
      page: PAGE,
      table: 'X',
      column: 'Y',
      values: ['a'],
      name: 'f1',
    });
    filterAddCategorical(defn, {
      page: PAGE,
      table: 'X',
      column: 'Y',
      values: ['b'],
      name: 'f2',
    });
    expect(filterList(defn, { page: PAGE })).toHaveLength(2);
  });

  it('removes a named filter; throws on missing', () => {
    filterAddCategorical(defn, {
      page: PAGE,
      table: 'X',
      column: 'Y',
      values: ['a'],
      name: 'f1',
    });
    filterRemove(defn, { page: PAGE }, 'f1');
    expect(filterList(defn, { page: PAGE })).toHaveLength(0);
    expect(() => filterRemove(defn, { page: PAGE }, 'missing')).toThrow(PbiCoreError);
  });

  it('clears all filters and reports count', () => {
    filterAddCategorical(defn, { page: PAGE, table: 'X', column: 'Y', values: ['a'] });
    filterAddCategorical(defn, { page: PAGE, table: 'X', column: 'Y', values: ['b'] });
    const r = filterClear(defn, { page: PAGE });
    expect(r.removed).toBe(2);
    expect(filterList(defn, { page: PAGE })).toHaveLength(0);
  });
});
