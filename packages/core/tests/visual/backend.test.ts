import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SIZES,
  PbiCoreError,
  SUPPORTED_VISUAL_TYPES,
  type VisualType,
  VisualTypeError,
  pageAdd,
  readJson,
  reportCreate,
  visualAdd,
  visualDelete,
  visualGet,
  visualList,
  visualSetContainer,
  visualUpdate,
} from '../../src/index.js';

let tmp: string;
let defn: string;
const page = 'p1';

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-vis-')));
  const r = reportCreate({ targetPath: tmp, name: 'Demo' });
  defn = r.definitionPath;
  pageAdd(defn, { displayName: 'Overview', name: page });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('visualAdd', () => {
  it('creates a visual folder with visual.json', () => {
    const r = visualAdd(defn, page, { visualType: 'barChart' });
    expect(r.status).toBe('created');
    expect(r.visualType).toBe('barChart');
    expect(r.name).toMatch(/^[0-9a-f]{20}$/);
    expect(existsSync(path.join(defn, 'pages', page, 'visuals', r.name, 'visual.json'))).toBe(true);
  });

  it('resolves user-friendly aliases', () => {
    const r = visualAdd(defn, page, { visualType: 'bar' });
    expect(r.visualType).toBe('barChart');
  });

  it('uses default sizes from DEFAULT_SIZES when omitted', () => {
    const r = visualAdd(defn, page, { visualType: 'card' });
    const [defaultW, defaultH] = DEFAULT_SIZES.card;
    expect(r.width).toBe(defaultW);
    expect(r.height).toBe(defaultH);
  });

  it('respects explicit position + size', () => {
    const r = visualAdd(defn, page, {
      visualType: 'barChart',
      name: 'v1',
      x: 100,
      y: 200,
      width: 500,
      height: 400,
    });
    expect(r).toMatchObject({ x: 100, y: 200, width: 500, height: 400, name: 'v1' });
  });

  it('throws VisualTypeError for unknown type', () => {
    expect(() => visualAdd(defn, page, { visualType: 'nope' })).toThrow(VisualTypeError);
  });

  it('throws when page does not exist', () => {
    expect(() => visualAdd(defn, 'missing', { visualType: 'barChart' })).toThrow(PbiCoreError);
  });

  it('embeds visualContainer 2.7.0 schema in the new visual.json', () => {
    const r = visualAdd(defn, page, { visualType: 'barChart', name: 'v1' });
    const data = readJson(
      path.join(defn, 'pages', page, 'visuals', r.name, 'visual.json'),
    ) as Record<string, unknown>;
    expect(data.$schema).toMatch(/visualContainer\/2\.7\.0/);
  });

  it('auto-stacks subsequent visuals downward', () => {
    const a = visualAdd(defn, page, { visualType: 'card', name: 'a' });
    const b = visualAdd(defn, page, { visualType: 'card', name: 'b' });
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  });

  it('auto-increments z-order', () => {
    visualAdd(defn, page, { visualType: 'card', name: 'a' });
    const b = visualAdd(defn, page, { visualType: 'card', name: 'b' });
    const bData = readJson(path.join(defn, 'pages', page, 'visuals', 'b', 'visual.json')) as {
      position: { z: number; tabOrder: number };
    };
    expect(bData.position.z).toBe(1);
    expect(bData.position.tabOrder).toBe(1);
  });
});

describe('visualAdd: every supported type renders a valid visual', () => {
  it.each(SUPPORTED_VISUAL_TYPES)('creates %s', (type: VisualType) => {
    const r = visualAdd(defn, page, { visualType: type });
    expect(r.visualType).toBe(type);
    const data = readJson(path.join(defn, 'pages', page, 'visuals', r.name, 'visual.json')) as {
      $schema: string;
      name: string;
      position: Record<string, number>;
    };
    expect(data.$schema).toMatch(/visualContainer\/2\.7\.0/);
    expect(data.name).toBe(r.name);
    expect(data.position.x).toBeGreaterThanOrEqual(0);
    expect(data.position.width).toBeGreaterThan(0);
  });
});

describe('visualList', () => {
  it('returns empty for a fresh page', () => {
    expect(visualList(defn, page)).toEqual([]);
  });

  it('returns added visuals sorted by folder name', () => {
    visualAdd(defn, page, { visualType: 'barChart', name: 'a-bar' });
    visualAdd(defn, page, { visualType: 'card', name: 'b-card' });
    const list = visualList(defn, page);
    expect(list.map((v) => v.name)).toEqual(['a-bar', 'b-card']);
    expect(list[0]?.visualType).toBe('barChart');
    expect(list[1]?.visualType).toBe('card');
  });
});

describe('visualGet', () => {
  it('returns details including empty bindings on fresh visual', () => {
    visualAdd(defn, page, { visualType: 'barChart', name: 'v1' });
    const detail = visualGet(defn, page, 'v1');
    expect(detail.name).toBe('v1');
    expect(detail.visualType).toBe('barChart');
    expect(detail.bindings).toEqual([]);
    expect(detail.isHidden).toBe(false);
  });

  it('throws when not found', () => {
    expect(() => visualGet(defn, page, 'missing')).toThrow(PbiCoreError);
  });
});

describe('visualUpdate', () => {
  it('changes position + size + hidden in place', () => {
    visualAdd(defn, page, { visualType: 'barChart', name: 'v1' });
    visualUpdate(defn, page, 'v1', { x: 999, y: 888, width: 600, height: 500, hidden: true });
    const detail = visualGet(defn, page, 'v1');
    expect(detail.x).toBe(999);
    expect(detail.y).toBe(888);
    expect(detail.width).toBe(600);
    expect(detail.height).toBe(500);
    expect(detail.isHidden).toBe(true);
  });

  it('throws when not found', () => {
    expect(() => visualUpdate(defn, page, 'missing', { x: 0 })).toThrow(PbiCoreError);
  });
});

describe('visualDelete', () => {
  it('removes the visual folder', () => {
    visualAdd(defn, page, { visualType: 'barChart', name: 'v1' });
    visualDelete(defn, page, 'v1');
    expect(existsSync(path.join(defn, 'pages', page, 'visuals', 'v1'))).toBe(false);
  });

  it('throws when not found', () => {
    expect(() => visualDelete(defn, page, 'missing')).toThrow(PbiCoreError);
  });
});

describe('visualSetContainer', () => {
  it('sets title, border, background in one call', () => {
    visualAdd(defn, page, { visualType: 'card', name: 'v1' });
    visualSetContainer(defn, page, 'v1', {
      title: 'Revenue',
      borderShow: true,
      backgroundShow: false,
    });
    const data = readJson(path.join(defn, 'pages', page, 'visuals', 'v1', 'visual.json')) as {
      visual: { visualContainerObjects: Record<string, unknown> };
    };
    expect(data.visual.visualContainerObjects).toBeDefined();
    expect(data.visual.visualContainerObjects.title).toBeDefined();
    expect(data.visual.visualContainerObjects.border).toBeDefined();
    expect(data.visual.visualContainerObjects.background).toBeDefined();
  });

  it('is a no-op when nothing changes', () => {
    visualAdd(defn, page, { visualType: 'card', name: 'v1' });
    const r = visualSetContainer(defn, page, 'v1', {});
    expect(r.status).toBe('no-op');
  });

  it('throws when visual missing', () => {
    expect(() => visualSetContainer(defn, page, 'missing', { title: 'x' })).toThrow(PbiCoreError);
  });
});
