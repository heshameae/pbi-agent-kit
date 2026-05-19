import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ReportNotFoundError,
  getPageDir,
  getPagesDir,
  getVisualDir,
  getVisualsDir,
  resolveReportPath,
  validateReportStructure,
} from '../../src/index.js';

let tmp: string;
let originalCwd: string;

beforeEach(() => {
  // realpathSync resolves /var → /private/var on macOS so comparisons match
  // what process.cwd() returns after chdir().
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-path-')));
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});

function scaffoldReport(root: string, name = 'MyReport'): string {
  const reportFolder = path.join(root, `${name}.Report`);
  const defn = path.join(reportFolder, 'definition');
  const pages = path.join(defn, 'pages');
  mkdirSync(pages, { recursive: true });
  writeFileSync(path.join(defn, 'report.json'), '{}\n');
  writeFileSync(path.join(defn, 'version.json'), '{}\n');
  writeFileSync(path.join(root, `${name}.pbip`), '{}\n');
  return defn;
}

describe('resolveReportPath: explicit', () => {
  it('accepts the definition folder directly', () => {
    const defn = scaffoldReport(tmp);
    expect(resolveReportPath(defn)).toBe(defn);
  });

  it('accepts the .Report folder', () => {
    const defn = scaffoldReport(tmp);
    const reportFolder = path.dirname(defn);
    expect(resolveReportPath(reportFolder)).toBe(defn);
  });

  it('accepts a parent containing a .Report child', () => {
    const defn = scaffoldReport(tmp);
    expect(resolveReportPath(tmp)).toBe(defn);
  });

  it('throws ReportNotFoundError for a non-PBIR path', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'pbi-empty-'));
    expect(() => resolveReportPath(empty)).toThrow(ReportNotFoundError);
    rmSync(empty, { recursive: true, force: true });
  });

  it('throws ReportNotFoundError for nonexistent path', () => {
    expect(() => resolveReportPath('/nonexistent/path/here')).toThrow(ReportNotFoundError);
  });
});

describe('resolveReportPath: walk-up from cwd', () => {
  it('finds the report when cwd is the parent', () => {
    const defn = scaffoldReport(tmp);
    process.chdir(tmp);
    expect(resolveReportPath()).toBe(defn);
  });

  it('finds the report when cwd is a sibling subdir', () => {
    const defn = scaffoldReport(tmp);
    const sibling = path.join(tmp, 'src');
    mkdirSync(sibling, { recursive: true });
    process.chdir(sibling);
    expect(resolveReportPath()).toBe(defn);
  });

  it('throws when no .Report or .pbip is reachable', () => {
    process.chdir(tmp);
    expect(() => resolveReportPath()).toThrow(ReportNotFoundError);
  });
});

describe('path helpers', () => {
  it('getPagesDir creates if missing', () => {
    const defn = scaffoldReport(tmp);
    // Remove pages dir to test re-creation
    rmSync(path.join(defn, 'pages'), { recursive: true });
    const pages = getPagesDir(defn);
    expect(pages).toBe(path.join(defn, 'pages'));
  });

  it('getPageDir builds the right path', () => {
    expect(getPageDir('/x/definition', 'abc')).toBe('/x/definition/pages/abc');
  });

  it('getVisualDir builds the right path', () => {
    expect(getVisualDir('/x/definition', 'p', 'v')).toBe('/x/definition/pages/p/visuals/v');
  });

  it('getVisualsDir creates the visuals folder', () => {
    const defn = scaffoldReport(tmp);
    const v = getVisualsDir(defn, 'page-001');
    expect(v).toBe(path.join(defn, 'pages', 'page-001', 'visuals'));
  });
});

describe('validateReportStructure', () => {
  it('returns empty for a clean scaffold', () => {
    const defn = scaffoldReport(tmp);
    expect(validateReportStructure(defn)).toEqual([]);
  });

  it('flags missing report.json', () => {
    const defn = scaffoldReport(tmp);
    rmSync(path.join(defn, 'report.json'));
    expect(validateReportStructure(defn)).toContain('Missing required file: report.json');
  });

  it('flags missing version.json', () => {
    const defn = scaffoldReport(tmp);
    rmSync(path.join(defn, 'version.json'));
    expect(validateReportStructure(defn)).toContain('Missing required file: version.json');
  });

  it('flags missing page.json in a page folder', () => {
    const defn = scaffoldReport(tmp);
    mkdirSync(path.join(defn, 'pages', 'mypage'), { recursive: true });
    const errors = validateReportStructure(defn);
    expect(errors).toContain("Page folder 'mypage' missing page.json");
  });

  it('flags missing visual.json in a visual folder', () => {
    const defn = scaffoldReport(tmp);
    const visualDir = path.join(defn, 'pages', 'mypage', 'visuals', 'myvis');
    mkdirSync(visualDir, { recursive: true });
    writeFileSync(path.join(defn, 'pages', 'mypage', 'page.json'), '{}\n');
    const errors = validateReportStructure(defn);
    expect(errors).toContain("Visual folder 'mypage/visuals/myvis' missing visual.json");
  });

  it('flags nonexistent definition folder', () => {
    const errors = validateReportStructure('/no/such/path');
    expect(errors[0]).toMatch(/Definition folder does not exist/);
  });
});
