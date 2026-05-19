import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PbiCoreError,
  readJson,
  reportCreate,
  themeDiff,
  themeGet,
  themeSet,
  writeJson,
} from '../../src/index.js';

let tmp: string;
let defn: string;
let reportFolder: string;
let themeFile: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-theme-')));
  const r = reportCreate({ targetPath: tmp, name: 'MyReport' });
  defn = r.definitionPath;
  reportFolder = r.path;
  // A minimal custom theme.
  themeFile = path.join(tmp, 'Brand.json');
  writeJson(themeFile, {
    name: 'Brand',
    dataColors: ['#FF0000', '#00FF00'],
    background: '#FFFFFF',
  });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('themeSet', () => {
  it('copies the file into StaticResources/RegisteredResources and sets customTheme', () => {
    const r = themeSet(defn, themeFile);
    expect(r.status).toBe('applied');
    expect(r.theme).toBe('Brand');

    const dest = path.join(reportFolder, 'StaticResources', 'RegisteredResources', 'Brand.json');
    expect(existsSync(dest)).toBe(true);

    const report = readJson(path.join(defn, 'report.json')) as Record<string, unknown>;
    const tc = report.themeCollection as Record<string, unknown>;
    const custom = tc.customTheme as Record<string, unknown>;
    expect(custom.name).toBe('Brand');
    expect(custom.type).toBe('RegisteredResources');
  });

  it('adds an entry to resourcePackages[] for RegisteredResources', () => {
    themeSet(defn, themeFile);
    const report = readJson(path.join(defn, 'report.json')) as Record<string, unknown>;
    const pkgs = report.resourcePackages as Array<Record<string, unknown>>;
    const registered = pkgs.find((p) => p.name === 'RegisteredResources');
    expect(registered).toBeDefined();
    const items = registered?.items as Array<Record<string, unknown>>;
    expect(items.some((i) => i.name === 'Brand.json')).toBe(true);
  });

  it('throws when the theme file is missing', () => {
    expect(() => themeSet(defn, '/no/such/theme.json')).toThrow(PbiCoreError);
  });
});

describe('themeGet', () => {
  it('returns the baseTheme name with no customTheme initially', () => {
    const r = themeGet(defn);
    expect(r.baseTheme).toBe('CY26SU02');
    expect(r.customTheme).toBeNull();
    expect(r.themeData).toBeNull();
  });

  it('after themeSet, returns the customTheme name and full data', () => {
    themeSet(defn, themeFile);
    const r = themeGet(defn);
    expect(r.customTheme).toBe('Brand');
    expect(r.themeData).toBeDefined();
    expect((r.themeData as Record<string, unknown>).name).toBe('Brand');
  });
});

describe('themeDiff', () => {
  it('reports proposed as all-added when no current custom theme', () => {
    const proposed = path.join(tmp, 'Other.json');
    writeJson(proposed, { name: 'Other', dataColors: ['#000'], extra: 'x' });
    const r = themeDiff(defn, proposed);
    expect(r.current).toBe('CY26SU02');
    expect(r.proposed).toBe('Other');
    expect(r.added.length).toBeGreaterThan(0);
    expect(r.removed).toEqual([]);
  });

  it('reports changed for differing values', () => {
    themeSet(defn, themeFile);
    const proposed = path.join(tmp, 'Brand2.json');
    writeJson(proposed, {
      name: 'Brand',
      dataColors: ['#0000FF', '#FFFF00'],
      background: '#FFFFFF',
    });
    const r = themeDiff(defn, proposed);
    expect(r.changed).toContain('dataColors');
  });

  it('reports removed when proposed lacks a current key', () => {
    themeSet(defn, themeFile);
    const proposed = path.join(tmp, 'Trimmed.json');
    writeJson(proposed, { name: 'Brand', dataColors: ['#FF0000', '#00FF00'] });
    const r = themeDiff(defn, proposed);
    expect(r.removed).toContain('background');
  });

  it('reports nested differences with dot-notation paths', () => {
    // Apply a theme that already has nested structure, then propose one with
    // a change inside the nested object.
    const initial = path.join(tmp, 'Initial.json');
    writeJson(initial, {
      name: 'Brand',
      textClasses: { callout: { fontSize: 24, color: '#000' } },
    });
    themeSet(defn, initial);

    const proposed = path.join(tmp, 'Proposed.json');
    writeJson(proposed, {
      name: 'Brand',
      textClasses: { callout: { fontSize: 32, color: '#000' } },
    });
    const r = themeDiff(defn, proposed);
    expect(r.changed).toContain('textClasses.callout.fontSize');
    expect(r.changed).not.toContain('textClasses.callout.color');
  });

  it('lists newly-added top-level keys without recursing into them (matches Python)', () => {
    themeSet(defn, themeFile);
    const proposed = path.join(tmp, 'Nested.json');
    writeJson(proposed, {
      name: 'Brand',
      dataColors: ['#FF0000', '#00FF00'],
      background: '#FFFFFF',
      textClasses: { callout: { fontSize: 24 } },
    });
    const r = themeDiff(defn, proposed);
    // pbi-cli's Python _dict_diff appends the key path WITHOUT recursing
    // when the key is missing from one side. We match that semantic.
    expect(r.added).toContain('textClasses');
  });
});
