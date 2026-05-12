import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  pageAdd,
  reportCreate,
  visualAdd,
  visualBulkBind,
  visualBulkDelete,
  visualBulkUpdate,
  visualList,
  visualWhere,
} from '../../src/index.js';

let tmp: string;
let defn: string;
const PAGE = 'p1';

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-bulk-')));
  const r = reportCreate({ targetPath: tmp, name: 'Demo' });
  defn = r.definitionPath;
  pageAdd(defn, { displayName: 'P', name: PAGE });
  // 4 visuals: 2 cards, 1 bar, 1 table; names use a pattern
  visualAdd(defn, PAGE, { visualType: 'card', name: 'card_a' });
  visualAdd(defn, PAGE, { visualType: 'card', name: 'card_b' });
  visualAdd(defn, PAGE, { visualType: 'barChart', name: 'bar_x' });
  visualAdd(defn, PAGE, { visualType: 'tableEx', name: 'tbl_y' });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('visualWhere', () => {
  it('returns all when no filter applied', () => {
    expect(visualWhere(defn, PAGE)).toHaveLength(4);
  });

  it('filters by visualType (canonical and alias)', () => {
    expect(visualWhere(defn, PAGE, { visualType: 'card' })).toHaveLength(2);
    expect(visualWhere(defn, PAGE, { visualType: 'bar' })).toHaveLength(1);
  });

  it('filters by name glob pattern', () => {
    const matches = visualWhere(defn, PAGE, { namePattern: 'card_*' });
    expect(matches.map((v) => v.name).sort()).toEqual(['card_a', 'card_b']);
  });

  it('filters by position bounds', () => {
    const all = visualList(defn, PAGE);
    const max = Math.max(...all.map((v) => v.y));
    const matches = visualWhere(defn, PAGE, { yMin: max });
    expect(matches).toHaveLength(1);
  });
});

describe('visualBulkBind', () => {
  it('binds the same fields to every card', () => {
    const r = visualBulkBind(defn, PAGE, {
      visualType: 'card',
      bindings: [{ role: 'Values', field: 'Sales[Revenue]' }],
    });
    expect(r.bound).toBe(2);
    expect(r.visuals.sort()).toEqual(['card_a', 'card_b']);
  });
});

describe('visualBulkUpdate', () => {
  it('updates width on every card', () => {
    const r = visualBulkUpdate(defn, PAGE, {
      whereType: 'card',
      setWidth: 600,
    });
    expect(r.updated).toBe(2);
    const cards = visualList(defn, PAGE).filter((v) => v.visualType === 'card');
    for (const c of cards) expect(c.width).toBe(600);
  });

  it('refuses no-op (no set* arg)', () => {
    expect(() => visualBulkUpdate(defn, PAGE, { whereType: 'card' })).toThrow();
  });
});

describe('visualBulkDelete', () => {
  it('deletes every card', () => {
    const r = visualBulkDelete(defn, PAGE, { whereType: 'card' });
    expect(r.deleted).toBe(2);
    const remaining = visualList(defn, PAGE);
    expect(remaining.map((v) => v.name).sort()).toEqual(['bar_x', 'tbl_y']);
  });

  it('refuses unfiltered bulk delete (safety)', () => {
    expect(() => visualBulkDelete(defn, PAGE, {})).toThrow();
  });
});
