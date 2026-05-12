import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PbiCoreError,
  bookmarkAdd,
  bookmarkDelete,
  bookmarkGet,
  bookmarkList,
  bookmarkSetVisibility,
  pageAdd,
  reportCreate,
} from '../../src/index.js';

let tmp: string;
let defn: string;
const PAGE = 'overview';

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-bookmark-')));
  const r = reportCreate({ targetPath: tmp, name: 'Demo' });
  defn = r.definitionPath;
  pageAdd(defn, { displayName: 'Overview', name: PAGE });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('bookmarkAdd / list / get / delete', () => {
  it('creates a bookmark folder + index on first add', () => {
    const r = bookmarkAdd(defn, 'B1', PAGE, 'bm1');
    expect(r).toMatchObject({ status: 'created', name: 'bm1', targetPage: PAGE });
    expect(existsSync(path.join(defn, 'bookmarks', 'bookmarks.json'))).toBe(true);
    expect(existsSync(path.join(defn, 'bookmarks', 'bm1.bookmark.json'))).toBe(true);
  });

  it('lists with name + displayName + activeSection', () => {
    bookmarkAdd(defn, 'B1', PAGE, 'bm1');
    bookmarkAdd(defn, 'B2', PAGE, 'bm2');
    const list = bookmarkList(defn);
    expect(list).toHaveLength(2);
    expect(list[0]?.displayName).toBe('B1');
    expect(list[0]?.activeSection).toBe(PAGE);
  });

  it('get returns the full JSON', () => {
    bookmarkAdd(defn, 'B1', PAGE, 'bm1');
    const bm = bookmarkGet(defn, 'bm1');
    expect(bm.displayName).toBe('B1');
    const exp = bm.explorationState as Record<string, unknown>;
    expect(exp.version).toBe('1.3');
  });

  it('deletes and removes from index', () => {
    bookmarkAdd(defn, 'B1', PAGE, 'bm1');
    bookmarkDelete(defn, 'bm1');
    expect(bookmarkList(defn)).toHaveLength(0);
    expect(existsSync(path.join(defn, 'bookmarks', 'bm1.bookmark.json'))).toBe(false);
  });

  it('throws on missing', () => {
    expect(() => bookmarkGet(defn, 'missing')).toThrow(PbiCoreError);
    expect(() => bookmarkDelete(defn, 'missing')).toThrow(PbiCoreError);
  });
});

describe('bookmarkSetVisibility', () => {
  it('writes singleVisual.display = {mode:"hidden"} when hidden=true', () => {
    bookmarkAdd(defn, 'B1', PAGE, 'bm1');
    bookmarkSetVisibility(defn, 'bm1', PAGE, 'v_card', true);
    const bm = bookmarkGet(defn, 'bm1');
    const exp = bm.explorationState as Record<string, unknown>;
    const sections = exp.sections as Record<string, unknown>;
    const page = sections[PAGE] as Record<string, unknown>;
    const containers = page.visualContainers as Record<string, unknown>;
    const container = containers.v_card as Record<string, unknown>;
    const single = container.singleVisual as Record<string, unknown>;
    expect(single.display).toEqual({ mode: 'hidden' });
  });

  it('removes display key when hidden=false (visibility = absence of display)', () => {
    bookmarkAdd(defn, 'B1', PAGE, 'bm1');
    bookmarkSetVisibility(defn, 'bm1', PAGE, 'v_card', true);
    bookmarkSetVisibility(defn, 'bm1', PAGE, 'v_card', false);
    const bm = bookmarkGet(defn, 'bm1');
    const exp = bm.explorationState as Record<string, unknown>;
    const sections = exp.sections as Record<string, unknown>;
    const page = sections[PAGE] as Record<string, unknown>;
    const containers = page.visualContainers as Record<string, unknown>;
    const container = containers.v_card as Record<string, unknown>;
    const single = container.singleVisual as Record<string, unknown>;
    expect(single).not.toHaveProperty('display');
  });

  it('throws on missing bookmark', () => {
    expect(() => bookmarkSetVisibility(defn, 'missing', PAGE, 'v', true)).toThrow(PbiCoreError);
  });
});
