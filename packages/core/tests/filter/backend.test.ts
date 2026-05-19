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
  const r = reportCreate({ targetPath: tmp, name: 'MyReport' });
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
      table: 'MyTable',
      column: 'MyColumn',
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
      table: 'MyTable',
      column: 'MyColumn',
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
      table: 'MyTable',
      column: 'MyColumn',
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

  // -- Literal encoding edge cases (matches Python's int()/float() semantics) --
  it.each([
    // ints
    ['0', '0L'],
    ['123', '123L'],
    ['-3', '-3L'],
    ['007', '007L'],
    // floats
    ['3.14', '3.14D'],
    ['-3.14', '-3.14D'],
    ['3.0', '3.0D'],
    // scientific notation — Python float("1e5") = 100000.0
    ['1e5', '1e5D'],
    ['1E5', '1E5D'],
    ['-2.5e10', '-2.5e10D'],
    // leading-/trailing-dot floats — Python float("3.") = 3.0
    ['3.', '3.D'],
    ['.5', '.5D'],
    // special float values — Python float("nan")/float("inf") succeed
    ['nan', 'nanD'],
    ['inf', 'infD'],
    ['infinity', 'infinityD'],
    ['-inf', '-infD'],
    // strings
    ['Hello', "'Hello'"],
    ['', "''"],
    ['0xFF', "'0xFF'"],
    ['1 2', "'1 2'"],
    // ".0" alone parses as 0.0 in Python via float(".0")
    ['.0', '.0D'],
  ])('encodes %s → %s', (input, expected) => {
    filterAddCategorical(defn, {
      page: PAGE,
      table: 'X',
      column: 'Y',
      values: [input],
    });
    const f = readPageFilters().at(-1) as Record<string, unknown>;
    const where = ((f.filter as Record<string, unknown>).Where as unknown[])[0] as Record<
      string,
      unknown
    >;
    const inOp = (where.Condition as Record<string, unknown>).In as Record<string, unknown>;
    const value = ((inOp.Values as unknown[])[0] as unknown[])[0] as Record<string, unknown>;
    const lit = (value.Literal as Record<string, unknown>).Value;
    expect(lit).toBe(expected);
  });
});

describe('filterAddTopN', () => {
  it('writes scope=page with howCreated and TopN direction=2 for Top', () => {
    const r = filterAddTopN(defn, {
      page: PAGE,
      table: 'MyCategoryTable',
      column: 'MyCategoryColumn',
      n: 10,
      orderByTable: 'MyFactTable',
      orderByColumn: 'MyFactColumn',
    });
    expect(r.direction).toBe('Top');
    const f = readPageFilters()[0] as Record<string, unknown>;
    expect(f.type).toBe('TopN');
    expect(f.howCreated).toBe('User');
  });

  it('avoids alias collision when table + orderByTable share first letter', () => {
    // Both "Things" and "Themes" start with 't' — alias collision logic
    // appends "2" to the ordinal alias to disambiguate.
    filterAddTopN(defn, {
      page: PAGE,
      table: 'Things',
      column: 'MyColumn',
      n: 5,
      orderByTable: 'Themes',
      orderByColumn: 'OtherColumn',
    });
    const f = readPageFilters()[0] as Record<string, unknown>;
    const filter = f.filter as Record<string, unknown>;
    const fromList = filter.From as Array<Record<string, unknown>>;
    // Inner subquery From should contain BOTH aliases without collision.
    const subquery = fromList[0]?.Expression as Record<string, unknown>;
    const sq = (subquery.Subquery as Record<string, unknown>).Query as Record<string, unknown>;
    const innerFrom = sq.From as Array<Record<string, unknown>>;
    const aliases = innerFrom.map((f) => f.Name);
    expect(aliases).toContain('t'); // Things
    expect(aliases).toContain('t2'); // Themes (collision-resolved)
  });

  it('uses single alias when orderByTable === table (no subquery duplication)', () => {
    filterAddTopN(defn, {
      page: PAGE,
      table: 'MyTable',
      column: 'MyColumn',
      n: 5,
      orderByTable: 'MyTable',
      orderByColumn: 'MyMeasure',
    });
    const f = readPageFilters()[0] as Record<string, unknown>;
    const filter = f.filter as Record<string, unknown>;
    const fromList = filter.From as Array<Record<string, unknown>>;
    const subquery = fromList[0]?.Expression as Record<string, unknown>;
    const sq = (subquery.Subquery as Record<string, unknown>).Query as Record<string, unknown>;
    const innerFrom = sq.From as Array<Record<string, unknown>>;
    expect(innerFrom).toHaveLength(1); // Only one entry when same table
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

  it('encodes orderBy as Measure (no Aggregation wrap) when orderByMeasure=true', () => {
    // Critical: when ranking by a DAX measure, the OrderBy Expression must be
    // `{ Measure: { Expression, Property } }` — NOT `{ Aggregation: { Column,
    // Function:0 } }`. Desktop silently rejects the latter for measure refs.
    filterAddTopN(defn, {
      page: PAGE,
      table: 'MyTable',
      column: 'MyColumn',
      n: 5,
      orderByTable: 'MyTable',
      orderByColumn: 'MyMeasure',
      orderByMeasure: true,
    });
    const f = readPageFilters()[0] as Record<string, unknown>;
    const filter = f.filter as Record<string, unknown>;
    const subquery = (filter.From as Array<Record<string, unknown>>)[0]?.Expression as Record<
      string,
      unknown
    >;
    const sq = (subquery.Subquery as Record<string, unknown>).Query as Record<string, unknown>;
    const orderBy = (sq.OrderBy as Array<Record<string, unknown>>)[0];
    const expr = orderBy?.Expression as Record<string, unknown>;
    expect(expr).toHaveProperty('Measure');
    expect(expr).not.toHaveProperty('Aggregation');
    const measure = expr.Measure as Record<string, unknown>;
    expect(measure.Property).toBe('MyMeasure');
  });

  it('keeps the Aggregation/Column shape when orderByMeasure is omitted (default)', () => {
    filterAddTopN(defn, {
      page: PAGE,
      table: 'MyTable',
      column: 'MyColumn',
      n: 5,
      orderByTable: 'MyTable',
      orderByColumn: 'MyOtherColumn',
    });
    const f = readPageFilters()[0] as Record<string, unknown>;
    const filter = f.filter as Record<string, unknown>;
    const subquery = (filter.From as Array<Record<string, unknown>>)[0]?.Expression as Record<
      string,
      unknown
    >;
    const sq = (subquery.Subquery as Record<string, unknown>).Query as Record<string, unknown>;
    const orderBy = (sq.OrderBy as Array<Record<string, unknown>>)[0];
    const expr = orderBy?.Expression as Record<string, unknown>;
    expect(expr).toHaveProperty('Aggregation');
    expect(expr).not.toHaveProperty('Measure');
  });
});

describe('filterAddRelativeDate', () => {
  it('adds a months relative-date filter', () => {
    const r = filterAddRelativeDate(defn, {
      page: PAGE,
      table: 'MyDateTable',
      column: 'MyDateColumn',
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
