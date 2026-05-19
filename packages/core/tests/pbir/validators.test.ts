import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ModelTable,
  type ValidationReport,
  validateBindingsAgainstModel,
  validateReportFull,
  writeJson,
} from '../../src/index.js';

let tmp: string;
let defn: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-val-')));
  defn = path.join(tmp, 'MyReport.Report', 'definition');
  mkdirSync(path.join(defn, 'pages'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeReport(extra: Record<string, unknown> = {}): void {
  writeJson(path.join(defn, 'report.json'), {
    $schema: 'https://x',
    themeCollection: { baseTheme: { name: 'CY24SU06' } },
    ...extra,
  });
}

function writeVersion(): void {
  writeJson(path.join(defn, 'version.json'), { $schema: 'https://x', version: '2.0.0' });
}

function writePagesIndex(pageOrder: string[]): void {
  writeJson(path.join(defn, 'pages', 'pages.json'), {
    $schema: 'https://x',
    pageOrder,
  });
}

function writePage(name: string, overrides: Record<string, unknown> = {}): void {
  const pageDir = path.join(defn, 'pages', name);
  mkdirSync(pageDir, { recursive: true });
  writeJson(path.join(pageDir, 'page.json'), {
    $schema: 'https://x',
    name,
    displayName: 'Page',
    ordinal: 0,
    width: 1280,
    height: 720,
    displayOption: 'FitToPage',
    ...overrides,
  });
}

function writeVisual(
  pageName: string,
  visualName: string,
  overrides: Record<string, unknown> = {},
): void {
  const vdir = path.join(defn, 'pages', pageName, 'visuals', visualName);
  mkdirSync(vdir, { recursive: true });
  writeJson(path.join(vdir, 'visual.json'), {
    $schema: 'https://x',
    name: visualName,
    position: { x: 0, y: 0, width: 100, height: 100, z: 0, tabOrder: 0 },
    visual: { visualType: 'barChart' },
    ...overrides,
  });
}

describe('validateReportFull: valid scaffold', () => {
  it('is valid with minimal complete content', () => {
    writeReport();
    writeVersion();
    writePagesIndex(['p1']);
    writePage('p1');
    writeVisual('p1', 'v1');

    const r: ValidationReport = validateReportFull(defn);
    expect(r.valid).toBe(true);
    expect(r.summary.errors).toBe(0);
  });
});

describe('validateReportFull: report.json', () => {
  it('flags missing themeCollection', () => {
    writeJson(path.join(defn, 'report.json'), { $schema: 'https://x' });
    writeVersion();
    const r = validateReportFull(defn);
    expect(r.errors.some((e) => e.message.includes('themeCollection'))).toBe(true);
  });

  it('warns on missing $schema', () => {
    writeJson(path.join(defn, 'report.json'), { themeCollection: { baseTheme: {} } });
    writeVersion();
    const r = validateReportFull(defn);
    expect(r.warnings.some((w) => w.message.includes('$schema'))).toBe(true);
  });

  it('warns on themeCollection without baseTheme', () => {
    writeJson(path.join(defn, 'report.json'), {
      $schema: 'https://x',
      themeCollection: {},
    });
    writeVersion();
    const r = validateReportFull(defn);
    expect(r.warnings.some((w) => w.message.includes('baseTheme'))).toBe(true);
  });
});

describe('validateReportFull: version.json', () => {
  it('flags missing version field', () => {
    writeReport();
    writeJson(path.join(defn, 'version.json'), { $schema: 'https://x' });
    const r = validateReportFull(defn);
    expect(r.errors.some((e) => e.file === 'version.json')).toBe(true);
  });
});

describe('validateReportFull: pages', () => {
  it('flags missing required fields on a page', () => {
    writeReport();
    writeVersion();
    const pageDir = path.join(defn, 'pages', 'p1');
    mkdirSync(pageDir, { recursive: true });
    writeJson(path.join(pageDir, 'page.json'), { ordinal: 0 });
    const r = validateReportFull(defn);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('warns on unknown displayOption', () => {
    writeReport();
    writeVersion();
    writePage('p1', { displayOption: 'Bogus' });
    const r = validateReportFull(defn);
    expect(r.warnings.some((w) => w.message.includes('displayOption'))).toBe(true);
  });

  it('allows DeprecatedDynamic without width/height', () => {
    writeReport();
    writeVersion();
    const pageDir = path.join(defn, 'pages', 'p1');
    mkdirSync(pageDir, { recursive: true });
    writeJson(path.join(pageDir, 'page.json'), {
      $schema: 'https://x',
      name: 'p1',
      displayName: 'Page',
      displayOption: 'DeprecatedDynamic',
    });
    const r = validateReportFull(defn);
    // No errors about width/height
    expect(r.errors.some((e) => e.message.includes('width'))).toBe(false);
    expect(r.errors.some((e) => e.message.includes('height'))).toBe(false);
  });

  it('warns on name longer than 50 chars', () => {
    writeReport();
    writeVersion();
    const longName = 'a'.repeat(60);
    writePage('p1', { name: longName });
    const r = validateReportFull(defn);
    expect(r.warnings.some((w) => w.message.includes('exceeds 50'))).toBe(true);
  });
});

describe('validateReportFull: visuals', () => {
  it('flags missing position', () => {
    writeReport();
    writeVersion();
    writePage('p1');
    const vdir = path.join(defn, 'pages', 'p1', 'visuals', 'v1');
    mkdirSync(vdir, { recursive: true });
    writeJson(path.join(vdir, 'visual.json'), { name: 'v1', visual: { visualType: 'card' } });
    const r = validateReportFull(defn);
    expect(r.errors.some((e) => e.message.includes('position'))).toBe(true);
  });

  it('flags duplicate visual names on the same page', () => {
    writeReport();
    writeVersion();
    writePage('p1');
    writeVisual('p1', 'v1', { name: 'shared' });
    writeVisual('p1', 'v2', { name: 'shared' });
    const r = validateReportFull(defn);
    expect(r.errors.some((e) => e.message.includes('Duplicate visual name'))).toBe(true);
  });

  it('does not flag duplicate names across different pages', () => {
    writeReport();
    writeVersion();
    writePage('p1');
    writePage('p2');
    writeVisual('p1', 'v1', { name: 'shared' });
    writeVisual('p2', 'v2', { name: 'shared' });
    const r = validateReportFull(defn);
    expect(r.errors.some((e) => e.message.includes('Duplicate visual name'))).toBe(false);
  });
});

describe('validateReportFull: pageOrder consistency', () => {
  it('warns on pageOrder referencing non-existent page', () => {
    writeReport();
    writeVersion();
    writePagesIndex(['missing']);
    writePage('p1');
    const r = validateReportFull(defn);
    expect(r.warnings.some((w) => w.message.includes("'missing'"))).toBe(true);
  });

  it('emits info on pages not listed in pageOrder', () => {
    writeReport();
    writeVersion();
    writePagesIndex([]);
    writePage('p1');
    const r = validateReportFull(defn);
    expect(r.info.some((i) => i.message.includes("'p1'"))).toBe(true);
  });
});

describe('validateReportFull: JSON syntax', () => {
  it('flags an invalid JSON file', () => {
    writeReport();
    writeVersion();
    writePage('p1');
    writeFileSync(path.join(defn, 'broken.json'), '{ this is not json');
    const r = validateReportFull(defn);
    expect(r.errors.some((e) => e.message.startsWith('Invalid JSON'))).toBe(true);
  });
});

describe('validateBindingsAgainstModel', () => {
  it('warns when a visual references an unknown field', () => {
    writeReport();
    writeVersion();
    writePage('p1');
    writeVisual('p1', 'v1', {
      visual: {
        visualType: 'barChart',
        query: {
          Commands: [
            {
              SemanticQueryDataShapeCommand: {
                Query: {
                  From: [{ Name: 's', Entity: 'MyTable' }],
                  Select: [
                    { Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Unknown' } },
                  ],
                },
              },
            },
          ],
        },
      },
    });

    const model: ModelTable[] = [
      { name: 'MyTable', columns: [{ name: 'MyColumn' }], measures: [] },
    ];
    const findings = validateBindingsAgainstModel(defn, model);
    expect(findings.some((f) => f.message.includes('MyTable[Unknown]'))).toBe(true);
  });

  it('returns no findings when all fields exist in the model', () => {
    writeReport();
    writeVersion();
    writePage('p1');
    writeVisual('p1', 'v1', {
      visual: {
        visualType: 'barChart',
        query: {
          Commands: [
            {
              SemanticQueryDataShapeCommand: {
                Query: {
                  From: [{ Name: 's', Entity: 'MyTable' }],
                  Select: [
                    {
                      Measure: {
                        Expression: { SourceRef: { Source: 's' } },
                        Property: 'MyMeasure',
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });

    const model: ModelTable[] = [
      { name: 'MyTable', columns: [], measures: [{ name: 'MyMeasure' }] },
    ];
    const findings = validateBindingsAgainstModel(defn, model);
    expect(findings).toEqual([]);
  });
});
