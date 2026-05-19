import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PbiCoreError,
  pageAdd,
  pageDelete,
  pageGet,
  pageList,
  pageSetBackground,
  pageSetVisibility,
  readJson,
  reportCreate,
  reportInfo,
} from '../../src/index.js';

let tmp: string;
let defn: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-pages-')));
  const r = reportCreate({ targetPath: tmp, name: 'MyReport' });
  defn = r.definitionPath;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('pageAdd', () => {
  it('creates a page folder with page.json and visuals/', () => {
    const r = pageAdd(defn, { displayName: 'Overview' });
    expect(r.status).toBe('created');
    expect(r.displayName).toBe('Overview');
    expect(r.name).toMatch(/^[0-9a-f]{20}$/);

    const pageDir = path.join(defn, 'pages', r.name);
    expect(existsSync(path.join(pageDir, 'page.json'))).toBe(true);
    expect(existsSync(path.join(pageDir, 'visuals'))).toBe(true);
  });

  it('writes page.json with the right schema and fields', () => {
    const r = pageAdd(defn, { displayName: 'Overview', width: 1920, height: 1080 });
    const page = readJson(path.join(defn, 'pages', r.name, 'page.json')) as Record<string, unknown>;
    expect(page.$schema).toMatch(/page\/2\.1\.0/);
    expect(page.name).toBe(r.name);
    expect(page.displayName).toBe('Overview');
    expect(page.width).toBe(1920);
    expect(page.height).toBe(1080);
    expect(page.displayOption).toBe('FitToPage');
  });

  it('respects an explicit name', () => {
    const r = pageAdd(defn, { displayName: 'Overview', name: 'mypage' });
    expect(r.name).toBe('mypage');
    expect(existsSync(path.join(defn, 'pages', 'mypage', 'page.json'))).toBe(true);
  });

  it('rejects duplicate names', () => {
    pageAdd(defn, { displayName: 'A', name: 'mypage' });
    expect(() => pageAdd(defn, { displayName: 'B', name: 'mypage' })).toThrow(PbiCoreError);
  });

  it('appends to pages.json:pageOrder', () => {
    const a = pageAdd(defn, { displayName: 'A' });
    const b = pageAdd(defn, { displayName: 'B' });
    const meta = readJson(path.join(defn, 'pages', 'pages.json')) as Record<string, unknown>;
    expect(meta.pageOrder).toEqual([a.name, b.name]);
  });

  it('sets activePageName to the first page on initial add', () => {
    const a = pageAdd(defn, { displayName: 'A' });
    pageAdd(defn, { displayName: 'B' });
    const meta = readJson(path.join(defn, 'pages', 'pages.json')) as Record<string, unknown>;
    expect(meta.activePageName).toBe(a.name);
  });
});

describe('pageDelete', () => {
  it('removes the page folder and updates pageOrder', () => {
    const a = pageAdd(defn, { displayName: 'A' });
    const b = pageAdd(defn, { displayName: 'B' });
    const r = pageDelete(defn, a.name);
    expect(r.status).toBe('deleted');
    expect(existsSync(path.join(defn, 'pages', a.name))).toBe(false);

    const meta = readJson(path.join(defn, 'pages', 'pages.json')) as Record<string, unknown>;
    expect(meta.pageOrder).toEqual([b.name]);
    expect(meta.activePageName).toBe(b.name);
  });

  it('removes activePageName when deleting the last page', () => {
    const a = pageAdd(defn, { displayName: 'A' });
    pageDelete(defn, a.name);
    const meta = readJson(path.join(defn, 'pages', 'pages.json')) as Record<string, unknown>;
    expect(meta.pageOrder).toEqual([]);
    expect('activePageName' in meta).toBe(false);
  });

  it('throws when the page does not exist', () => {
    expect(() => pageDelete(defn, 'missing')).toThrow(PbiCoreError);
  });

  it('falls back activePageName to first remaining when active page is deleted', () => {
    // Add 3 pages; "p2" becomes active (because pageAdd makes the first the
    // active; after 3 adds, activePageName is still p1)
    const a = pageAdd(defn, { displayName: 'A', name: 'p1' });
    pageAdd(defn, { displayName: 'B', name: 'p2' });
    pageAdd(defn, { displayName: 'C', name: 'p3' });

    let meta = readJson(path.join(defn, 'pages', 'pages.json')) as Record<string, unknown>;
    expect(meta.activePageName).toBe(a.name);

    // Delete the active page → should fall back to the next survivor in order
    pageDelete(defn, a.name);
    meta = readJson(path.join(defn, 'pages', 'pages.json')) as Record<string, unknown>;
    expect(meta.pageOrder).toEqual(['p2', 'p3']);
    expect(meta.activePageName).toBe('p2'); // first remaining
  });

  it('keeps activePageName intact when deleting a non-active page', () => {
    pageAdd(defn, { displayName: 'A', name: 'p1' });
    const b = pageAdd(defn, { displayName: 'B', name: 'p2' });
    pageDelete(defn, b.name);
    const meta = readJson(path.join(defn, 'pages', 'pages.json')) as Record<string, unknown>;
    expect(meta.activePageName).toBe('p1');
    expect(meta.pageOrder).toEqual(['p1']);
  });
});

describe('pageGet', () => {
  it('returns page details including counts', () => {
    const a = pageAdd(defn, { displayName: 'Overview', name: 'p1' });
    const detail = pageGet(defn, a.name);
    expect(detail.name).toBe('p1');
    expect(detail.displayName).toBe('Overview');
    expect(detail.visualCount).toBe(0);
    expect(detail.isHidden).toBe(false);
    expect(detail.displayOption).toBe('FitToPage');
  });

  it('throws when the page does not exist', () => {
    expect(() => pageGet(defn, 'missing')).toThrow(PbiCoreError);
  });
});

describe('pageList', () => {
  it('returns pages in pageOrder', () => {
    const a = pageAdd(defn, { displayName: 'A' });
    const b = pageAdd(defn, { displayName: 'B' });
    const list = pageList(defn);
    expect(list.map((p) => p.name)).toEqual([a.name, b.name]);
  });

  it('returns empty array for a new report', () => {
    expect(pageList(defn)).toEqual([]);
  });
});

describe('pageSetBackground', () => {
  it('writes the background object with transparency 0 by default', () => {
    const a = pageAdd(defn, { displayName: 'A', name: 'p1' });
    const r = pageSetBackground(defn, a.name, '#F8F9FA');
    expect(r.transparency).toBe(0);
    const page = readJson(path.join(defn, 'pages', 'p1', 'page.json')) as Record<string, unknown>;
    const objects = page.objects as Record<string, unknown>;
    expect(objects.background).toBeDefined();
  });

  it('writes the transparency literal as Nd format', () => {
    const a = pageAdd(defn, { displayName: 'A', name: 'p1' });
    pageSetBackground(defn, a.name, '#FFFFFF', 50);
    const page = readJson(path.join(defn, 'pages', 'p1', 'page.json')) as Record<string, unknown>;
    const objects = page.objects as Record<string, unknown>;
    const bg = (objects.background as unknown[])[0] as Record<string, unknown>;
    const props = bg.properties as Record<string, unknown>;
    const trans = props.transparency as Record<string, unknown>;
    const expr = trans.expr as Record<string, unknown>;
    const lit = expr.Literal as Record<string, unknown>;
    expect(lit.Value).toBe('50D');
  });

  it('rejects invalid hex colour', () => {
    pageAdd(defn, { displayName: 'A', name: 'p1' });
    expect(() => pageSetBackground(defn, 'p1', 'red')).toThrow(/Invalid color/);
  });

  it('rejects transparency outside 0-100', () => {
    pageAdd(defn, { displayName: 'A', name: 'p1' });
    expect(() => pageSetBackground(defn, 'p1', '#FFFFFF', 150)).toThrow(/transparency/);
  });
});

describe('pageSetVisibility', () => {
  it('hides a page', () => {
    pageAdd(defn, { displayName: 'A', name: 'p1' });
    pageSetVisibility(defn, 'p1', true);
    const detail = pageGet(defn, 'p1');
    expect(detail.isHidden).toBe(true);
  });

  it('unhides a page', () => {
    pageAdd(defn, { displayName: 'A', name: 'p1' });
    pageSetVisibility(defn, 'p1', true);
    pageSetVisibility(defn, 'p1', false);
    const detail = pageGet(defn, 'p1');
    expect(detail.isHidden).toBe(false);
  });
});

describe('reportInfo after pages added', () => {
  it('counts pages and visuals correctly', () => {
    pageAdd(defn, { displayName: 'A', name: 'p1' });
    pageAdd(defn, { displayName: 'B', name: 'p2' });
    const info = reportInfo(defn);
    expect(info.pageCount).toBe(2);
    expect(info.totalVisuals).toBe(0);
    expect(info.theme).toBe('CY26SU02');
    expect(info.pages.map((p) => p.name).sort()).toEqual(['p1', 'p2']);
  });
});
