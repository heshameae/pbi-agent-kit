import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJson, reportCreate, validateReportFull } from '../../src/index.js';

let tmp: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-scaffold-')));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('reportCreate: file layout', () => {
  it('produces the expected file tree', () => {
    const r = reportCreate({ targetPath: tmp, name: 'Demo' });
    expect(r.status).toBe('created');
    expect(r.name).toBe('Demo');

    expect(existsSync(path.join(tmp, 'Demo.pbip'))).toBe(true);
    expect(existsSync(path.join(tmp, 'Demo.Report', '.platform'))).toBe(true);
    expect(existsSync(path.join(tmp, 'Demo.Report', 'definition.pbir'))).toBe(true);
    expect(existsSync(path.join(tmp, 'Demo.Report', 'definition', 'report.json'))).toBe(true);
    expect(existsSync(path.join(tmp, 'Demo.Report', 'definition', 'version.json'))).toBe(true);
    expect(existsSync(path.join(tmp, 'Demo.Report', 'definition', 'pages', 'pages.json'))).toBe(
      true,
    );
  });

  it('scaffolds a blank SemanticModel when no datasetPath provided', () => {
    reportCreate({ targetPath: tmp, name: 'Demo' });
    expect(existsSync(path.join(tmp, 'Demo.SemanticModel', '.platform'))).toBe(true);
    expect(existsSync(path.join(tmp, 'Demo.SemanticModel', 'definition.pbism'))).toBe(true);
    expect(existsSync(path.join(tmp, 'Demo.SemanticModel', 'definition', 'model.tmdl'))).toBe(true);

    const tmdl = readFileSync(
      path.join(tmp, 'Demo.SemanticModel', 'definition', 'model.tmdl'),
      'utf-8',
    );
    expect(tmdl).toContain('model Model');
    expect(tmdl).toContain('culture: en-US');
    expect(tmdl).toContain('defaultPowerBIDataSourceVersion: powerBI_V3');
  });

  it('skips SemanticModel scaffold when datasetPath provided', () => {
    reportCreate({
      targetPath: tmp,
      name: 'Demo',
      datasetPath: '../SomeOtherModel.SemanticModel',
    });
    expect(existsSync(path.join(tmp, 'Demo.SemanticModel'))).toBe(false);

    const pbirRef = readJson(path.join(tmp, 'Demo.Report', 'definition.pbir')) as Record<
      string,
      unknown
    >;
    const ref = (pbirRef.datasetReference as Record<string, unknown>).byPath as Record<
      string,
      unknown
    >;
    expect(ref.path).toBe('../SomeOtherModel.SemanticModel');
  });
});

describe('reportCreate: content shape', () => {
  it('writes the right schemas in each file', () => {
    reportCreate({ targetPath: tmp, name: 'Demo' });
    const report = readJson(path.join(tmp, 'Demo.Report', 'definition', 'report.json')) as Record<
      string,
      unknown
    >;
    expect(report.$schema).toMatch(/report\/1\.2\.0/);

    const version = readJson(path.join(tmp, 'Demo.Report', 'definition', 'version.json')) as Record<
      string,
      unknown
    >;
    expect(version.$schema).toMatch(/versionMetadata\/1\.0\.0/);
    expect(version.version).toBe('2.0.0');

    const pages = readJson(
      path.join(tmp, 'Demo.Report', 'definition', 'pages', 'pages.json'),
    ) as Record<string, unknown>;
    expect(pages.$schema).toMatch(/pagesMetadata\/1\.0\.0/);
    expect(pages.pageOrder).toEqual([]);
  });

  it('embeds DEFAULT_BASE_THEME (CY24SU06)', () => {
    reportCreate({ targetPath: tmp, name: 'Demo' });
    const report = readJson(path.join(tmp, 'Demo.Report', 'definition', 'report.json')) as Record<
      string,
      unknown
    >;
    const tc = report.themeCollection as Record<string, unknown>;
    const baseTheme = tc.baseTheme as Record<string, unknown>;
    expect(baseTheme.name).toBe('CY24SU06');
    expect(baseTheme.reportVersionAtImport).toBe('5.55');
    expect(baseTheme.type).toBe('SharedResources');
  });

  it('embeds Desktop settings defaults in report.json', () => {
    reportCreate({ targetPath: tmp, name: 'Demo' });
    const report = readJson(path.join(tmp, 'Demo.Report', 'definition', 'report.json')) as Record<
      string,
      unknown
    >;
    const settings = report.settings as Record<string, unknown>;
    expect(settings.useStylableVisualContainerHeader).toBe(true);
    expect(settings.defaultDrillFilterOtherVisuals).toBe(true);
    expect(settings.useEnhancedTooltips).toBe(true);
  });

  it('writes the .pbip with artifacts.report.path', () => {
    reportCreate({ targetPath: tmp, name: 'Demo' });
    const pbip = readJson(path.join(tmp, 'Demo.pbip')) as Record<string, unknown>;
    expect(pbip.version).toBe('1.0');
    expect(pbip.artifacts).toEqual([{ report: { path: 'Demo.Report' } }]);
  });

  it('writes definition.pbir with the dataset reference and $schema', () => {
    reportCreate({ targetPath: tmp, name: 'Demo' });
    const pbir = readJson(path.join(tmp, 'Demo.Report', 'definition.pbir')) as Record<
      string,
      unknown
    >;
    expect(pbir.$schema).toMatch(/definitionProperties\/2\.0\.0/);
    expect(pbir.version).toBe('4.0');
    const ref = (pbir.datasetReference as Record<string, unknown>).byPath as Record<
      string,
      unknown
    >;
    expect(ref.path).toBe('../Demo.SemanticModel');
  });

  it('writes the .platform metadata', () => {
    reportCreate({ targetPath: tmp, name: 'Demo' });
    const plat = readJson(path.join(tmp, 'Demo.Report', '.platform')) as Record<string, unknown>;
    expect(plat.$schema).toMatch(/platformProperties\/2\.0\.0/);
    const metadata = plat.metadata as Record<string, unknown>;
    expect(metadata.type).toBe('Report');
    expect(metadata.displayName).toBe('Demo');
  });
});

describe('reportCreate: validates against our own validators', () => {
  it('newly scaffolded report passes structural validation', () => {
    const r = reportCreate({ targetPath: tmp, name: 'Demo' });
    const report = validateReportFull(r.definitionPath);
    expect(report.valid).toBe(true);
    expect(report.summary.errors).toBe(0);
  });
});
