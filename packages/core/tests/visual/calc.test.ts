import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PbiCoreError,
  pageAdd,
  reportCreate,
  visualAdd,
  visualCalcAdd,
  visualCalcDelete,
  visualCalcList,
} from '../../src/index.js';

let tmp: string;
let defn: string;
const PAGE = 'p1';

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-calc-')));
  const r = reportCreate({ targetPath: tmp, name: 'MyReport' });
  defn = r.definitionPath;
  pageAdd(defn, { displayName: 'P', name: PAGE });
  visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('visualCalcAdd / list / delete', () => {
  it('adds, lists, deletes a single calc on Y role', () => {
    visualCalcAdd(defn, PAGE, 'v1', 'RunningTotal', 'RUNNINGSUM([MyMeasure])');
    let list = visualCalcList(defn, PAGE, 'v1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'RunningTotal',
      expression: 'RUNNINGSUM([MyMeasure])',
      role: 'Y',
      queryRef: 'select',
    });

    visualCalcDelete(defn, PAGE, 'v1', 'RunningTotal');
    list = visualCalcList(defn, PAGE, 'v1');
    expect(list).toHaveLength(0);
  });

  it('is idempotent: re-adding with same name replaces', () => {
    visualCalcAdd(defn, PAGE, 'v1', 'C', 'A');
    visualCalcAdd(defn, PAGE, 'v1', 'C', 'B');
    const list = visualCalcList(defn, PAGE, 'v1');
    expect(list).toHaveLength(1);
    expect(list[0]?.expression).toBe('B');
  });

  it('supports calcs on non-default roles', () => {
    visualCalcAdd(defn, PAGE, 'v1', 'X', '1', 'Category');
    const list = visualCalcList(defn, PAGE, 'v1');
    expect(list[0]?.role).toBe('Category');
  });

  it('throws when deleting non-existent calc', () => {
    expect(() => visualCalcDelete(defn, PAGE, 'v1', 'missing')).toThrow(PbiCoreError);
  });

  it('throws when adding to non-existent visual', () => {
    expect(() => visualCalcAdd(defn, PAGE, 'missing', 'C', '1')).toThrow(PbiCoreError);
  });
});
