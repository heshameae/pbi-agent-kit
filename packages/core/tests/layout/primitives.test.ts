import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PbiCoreError,
  layoutColumn,
  layoutGrid,
  layoutRow,
  pageAdd,
  reportCreate,
  visualAdd,
  visualGet,
} from '../../src/index.js';

let tmp: string;
let defn: string;
const PAGE = 'p1';

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-layout-')));
  const r = reportCreate({ targetPath: tmp, name: 'MyReport' });
  defn = r.definitionPath;
  pageAdd(defn, { displayName: 'P', name: PAGE, width: 1280, height: 720 });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function addCards(n: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = visualAdd(defn, PAGE, { visualType: 'card', name: `v${i + 1}` });
    names.push(r.name);
  }
  return names;
}

describe('layoutGrid', () => {
  it('places 4 visuals into a 2×2 grid with equal cells', () => {
    const names = addCards(4);
    const r = layoutGrid(defn, PAGE, { visuals: names, rows: 2, cols: 2, gap: 0 });
    expect(r.count).toBe(4);
    const w = 1280 / 2;
    const h = 720 / 2;
    expect(r.placements[0]).toMatchObject({ x: 0, y: 0, width: w, height: h });
    expect(r.placements[1]).toMatchObject({ x: w, y: 0, width: w, height: h });
    expect(r.placements[2]).toMatchObject({ x: 0, y: h, width: w, height: h });
    expect(r.placements[3]).toMatchObject({ x: w, y: h, width: w, height: h });
  });

  it('respects gap between cells', () => {
    const names = addCards(2);
    layoutGrid(defn, PAGE, { visuals: names, rows: 1, cols: 2, gap: 20 });
    const a = visualGet(defn, PAGE, names[0] as string);
    const b = visualGet(defn, PAGE, names[1] as string);
    expect(b.x - (a.x + a.width)).toBe(20);
  });

  it('respects x/y/width/height area opts', () => {
    const names = addCards(2);
    layoutGrid(defn, PAGE, {
      visuals: names,
      rows: 1,
      cols: 2,
      x: 100,
      y: 50,
      width: 600,
      height: 400,
      gap: 0,
    });
    const a = visualGet(defn, PAGE, names[0] as string);
    expect(a.x).toBe(100);
    expect(a.y).toBe(50);
    expect(a.width).toBe(300);
    expect(a.height).toBe(400);
  });

  it('ignores excess visuals beyond rows*cols', () => {
    const names = addCards(5);
    const r = layoutGrid(defn, PAGE, { visuals: names, rows: 2, cols: 2, gap: 0 });
    expect(r.count).toBe(4);
    expect(r.placements).toHaveLength(4);
  });

  it('returns empty result on no visuals (no throw)', () => {
    const r = layoutGrid(defn, PAGE, { visuals: [], rows: 2, cols: 2 });
    expect(r.count).toBe(0);
    expect(r.placements).toEqual([]);
  });

  it('throws on rows<1 or cols<1', () => {
    expect(() => layoutGrid(defn, PAGE, { visuals: ['v1'], rows: 0, cols: 2 })).toThrow(
      PbiCoreError,
    );
    expect(() => layoutGrid(defn, PAGE, { visuals: ['v1'], rows: 2, cols: 0 })).toThrow(
      PbiCoreError,
    );
  });

  it('throws when the area is too small for the requested grid', () => {
    const names = addCards(2);
    expect(() =>
      layoutGrid(defn, PAGE, {
        visuals: names,
        rows: 1,
        cols: 2,
        width: 10,
        gap: 20, // gap alone exceeds width
      }),
    ).toThrow(PbiCoreError);
  });
});

describe('layoutRow', () => {
  it('places 3 visuals across the full page width by default', () => {
    const names = addCards(3);
    const r = layoutRow(defn, PAGE, { visuals: names, y: 0, height: 100, gap: 0 });
    expect(r.count).toBe(3);
    const w = Math.floor(1280 / 3);
    expect(r.placements[0]?.x).toBe(0);
    expect(r.placements[1]?.x).toBe(w);
    expect(r.placements[2]?.x).toBe(2 * w);
    for (const p of r.placements) {
      expect(p.height).toBe(100);
      expect(p.y).toBe(0);
    }
  });

  it('preserves each visual height when height opt is omitted', () => {
    const names = addCards(2);
    layoutRow(defn, PAGE, { visuals: names, y: 100, gap: 0 });
    const a = visualGet(defn, PAGE, names[0] as string);
    // Default card height should still be intact (DEFAULT_SIZES tunes per type)
    expect(a.height).toBeGreaterThan(0);
  });
});

describe('layoutColumn', () => {
  it('stacks 3 visuals vertically with equal heights', () => {
    const names = addCards(3);
    const r = layoutColumn(defn, PAGE, { visuals: names, x: 0, width: 200, gap: 0 });
    expect(r.count).toBe(3);
    const h = Math.floor(720 / 3);
    expect(r.placements[0]?.y).toBe(0);
    expect(r.placements[1]?.y).toBe(h);
    expect(r.placements[2]?.y).toBe(2 * h);
    for (const p of r.placements) {
      expect(p.width).toBe(200);
    }
  });
});
