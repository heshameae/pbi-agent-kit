import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  pageAdd,
  readJson,
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
  const r = reportCreate({ targetPath: tmp, name: 'MyReport' });
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
      bindings: [{ role: 'Values', field: 'MyTable[MyMeasure]' }],
    });
    expect(r.bound).toBe(2);
    expect(r.visuals.sort()).toEqual(['card_a', 'card_b']);
  });

  it('validates every target before writing any binding', () => {
    const modelPath = path.join(tmp, 'BulkModel.SemanticModel', 'definition');
    writeBulkModel(modelPath);

    expect(() =>
      visualBulkBind(defn, PAGE, {
        visualType: 'card',
        modelPath,
        bindings: [{ role: 'Values', field: 'MyTable[MissingMeasure]', measure: true }],
      }),
    ).toThrow();

    expect(getProjectionCount('card_a', 'Values')).toBe(0);
    expect(getProjectionCount('card_b', 'Values')).toBe(0);
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

  it('returns count=0 when no visual matches the filter', () => {
    const r = visualBulkDelete(defn, PAGE, { whereType: 'kpi' });
    expect(r.deleted).toBe(0);
    expect(r.visuals).toEqual([]);
    expect(visualList(defn, PAGE)).toHaveLength(4);
  });
});

describe('visualBulkBind: zero-match', () => {
  it('returns count=0 when type has no matches', () => {
    const r = visualBulkBind(defn, PAGE, {
      visualType: 'kpi',
      bindings: [{ role: 'Indicator', field: 'MyTable[MyMeasure]' }],
    });
    expect(r.bound).toBe(0);
    expect(r.visuals).toEqual([]);
  });
});

describe('visualBulkUpdate: zero-match', () => {
  it('returns count=0 when type has no matches', () => {
    const r = visualBulkUpdate(defn, PAGE, {
      whereType: 'kpi',
      setWidth: 600,
    });
    expect(r.updated).toBe(0);
    expect(r.visuals).toEqual([]);
  });
});

function getProjectionCount(visualName: string, role: string): number {
  const data = readJson(
    path.join(defn, 'pages', PAGE, 'visuals', visualName, 'visual.json'),
  ) as Record<string, unknown>;
  const visual = data.visual as Record<string, unknown>;
  const query = visual.query as Record<string, unknown>;
  const queryState = query.queryState as Record<string, unknown>;
  const roleState = (queryState[role] as Record<string, unknown>) ?? {};
  return Array.isArray(roleState.projections) ? roleState.projections.length : 0;
}

function writeBulkModel(definitionPath: string): void {
  const tablesDir = path.join(definitionPath, 'tables');
  mkdirSync(tablesDir, { recursive: true });
  writeFileSync(path.join(definitionPath, 'database.tmdl'), 'database\n', 'utf8');
  writeFileSync(path.join(definitionPath, 'model.tmdl'), 'model Model\n', 'utf8');
  writeFileSync(
    path.join(tablesDir, 'MyTable.tmdl'),
    [
      'table MyTable',
      '\tcolumn MyValue',
      '\t\tdataType: decimal',
      '\t\tsummarizeBy: sum',
      '',
      '\tmeasure MyMeasure = SUM(MyTable[MyValue])',
      '\t\tformatString: #,##0',
      '',
    ].join('\n'),
    'utf8',
  );
}
