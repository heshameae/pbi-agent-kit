import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PbiCoreError,
  formatBackgroundConditional,
  formatBackgroundGradient,
  formatBackgroundMeasure,
  formatClear,
  formatGet,
  pageAdd,
  readJson,
  reportCreate,
  visualAdd,
} from '../../src/index.js';

let tmp: string;
let defn: string;
const PAGE = 'p1';

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-format-')));
  const r = reportCreate({ targetPath: tmp, name: 'Demo' });
  defn = r.definitionPath;
  pageAdd(defn, { displayName: 'P', name: PAGE });
  visualAdd(defn, PAGE, { visualType: 'tableEx', name: 'v1' });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function readValues(): Record<string, unknown>[] {
  const vp = path.join(defn, 'pages', PAGE, 'visuals', 'v1', 'visual.json');
  const v = readJson(vp) as Record<string, unknown>;
  const visual = v.visual as Record<string, unknown>;
  const objects = (visual.objects as Record<string, unknown>) ?? {};
  return Array.isArray(objects.values) ? (objects.values as Record<string, unknown>[]) : [];
}

describe('formatBackgroundGradient', () => {
  it('adds a values entry with FillRule.linearGradient2', () => {
    formatBackgroundGradient(defn, PAGE, 'v1', {
      inputTable: 'Sales',
      inputColumn: 'Profit',
      fieldQueryRef: 'Sum(Sales.Profit)',
    });
    const [entry] = readValues();
    expect(entry).toBeDefined();
    const selector = entry?.selector as Record<string, unknown>;
    expect(selector.metadata).toBe('Sum(Sales.Profit)');
  });

  it('replaces an entry with same fieldQueryRef instead of appending', () => {
    formatBackgroundGradient(defn, PAGE, 'v1', {
      inputTable: 'Sales',
      inputColumn: 'Profit',
      fieldQueryRef: 'Sum(Sales.Profit)',
    });
    formatBackgroundGradient(defn, PAGE, 'v1', {
      inputTable: 'Sales',
      inputColumn: 'Profit',
      fieldQueryRef: 'Sum(Sales.Profit)',
      minColor: '#FF0000',
    });
    expect(readValues()).toHaveLength(1);
  });
});

describe('formatBackgroundConditional', () => {
  it('encodes ComparisonKind=2 for gt and threshold with D suffix', () => {
    formatBackgroundConditional(defn, PAGE, 'v1', {
      inputTable: 'Sales',
      inputColumn: 'Profit',
      threshold: 1000,
      colorHex: '#00FF00',
    });
    const [entry] = readValues();
    const props = entry?.properties as Record<string, unknown>;
    const backColor = props.backColor as Record<string, unknown>;
    const solid = backColor.solid as Record<string, unknown>;
    const color = solid.color as Record<string, unknown>;
    const expr = color.expr as Record<string, unknown>;
    const cond = expr.Conditional as Record<string, unknown>;
    const cases = cond.Cases as unknown[];
    const case0 = cases[0] as Record<string, unknown>;
    const condition = case0.Condition as Record<string, unknown>;
    const comparison = condition.Comparison as Record<string, unknown>;
    expect(comparison.ComparisonKind).toBe(2);
    const right = comparison.Right as Record<string, unknown>;
    const lit = right.Literal as Record<string, unknown>;
    expect(lit.Value).toBe('1000D');
  });

  it('rejects invalid comparison', () => {
    expect(() =>
      formatBackgroundConditional(defn, PAGE, 'v1', {
        inputTable: 'X',
        inputColumn: 'Y',
        threshold: 1,
        colorHex: '#000',
        comparison: 'wat' as unknown as 'gt',
      }),
    ).toThrow(PbiCoreError);
  });
});

describe('formatBackgroundMeasure', () => {
  it('wraps the color in a Measure expression', () => {
    formatBackgroundMeasure(defn, PAGE, 'v1', {
      measureTable: 'Sales',
      measureProperty: 'ColorMeasure',
      fieldQueryRef: 'Sum(Sales.Profit)',
    });
    const [entry] = readValues();
    const props = entry?.properties as Record<string, unknown>;
    const backColor = props.backColor as Record<string, unknown>;
    const solid = backColor.solid as Record<string, unknown>;
    const color = solid.color as Record<string, unknown>;
    const expr = color.expr as Record<string, unknown>;
    expect(expr).toHaveProperty('Measure');
  });
});

describe('formatGet / formatClear', () => {
  it('returns the objects block and clears it', () => {
    formatBackgroundGradient(defn, PAGE, 'v1', {
      inputTable: 'S',
      inputColumn: 'P',
      fieldQueryRef: 'r1',
    });
    const before = formatGet(defn, PAGE, 'v1');
    expect(before.objects.values as unknown[]).toHaveLength(1);
    formatClear(defn, PAGE, 'v1');
    const after = formatGet(defn, PAGE, 'v1');
    expect(after.objects).toEqual({});
  });
});
