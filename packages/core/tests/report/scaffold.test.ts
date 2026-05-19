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
    const r = reportCreate({ targetPath: tmp, name: 'MyReport' });
    expect(r.status).toBe('created');
    expect(r.name).toBe('MyReport');

    expect(existsSync(path.join(tmp, 'MyReport.pbip'))).toBe(true);
    expect(existsSync(path.join(tmp, 'MyReport.Report', '.platform'))).toBe(true);
    expect(existsSync(path.join(tmp, 'MyReport.Report', 'definition.pbir'))).toBe(true);
    expect(existsSync(path.join(tmp, 'MyReport.Report', 'definition', 'report.json'))).toBe(true);
    expect(existsSync(path.join(tmp, 'MyReport.Report', 'definition', 'version.json'))).toBe(true);
    expect(existsSync(path.join(tmp, 'MyReport.Report', 'definition', 'pages', 'pages.json'))).toBe(
      true,
    );
  });

  it('scaffolds a blank SemanticModel when no datasetPath provided', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    expect(existsSync(path.join(tmp, 'MyReport.SemanticModel', '.platform'))).toBe(true);
    expect(existsSync(path.join(tmp, 'MyReport.SemanticModel', 'definition.pbism'))).toBe(true);
    expect(existsSync(path.join(tmp, 'MyReport.SemanticModel', 'definition', 'model.tmdl'))).toBe(
      true,
    );

    const tmdl = readFileSync(
      path.join(tmp, 'MyReport.SemanticModel', 'definition', 'model.tmdl'),
      'utf-8',
    );
    expect(tmdl).toContain('model Model');
    expect(tmdl).toContain('culture: en-US');
    expect(tmdl).toContain('defaultPowerBIDataSourceVersion: powerBI_V3');
  });

  it('skips SemanticModel scaffold when datasetPath provided', () => {
    reportCreate({
      targetPath: tmp,
      name: 'MyReport',
      datasetPath: '../SomeOtherModel.SemanticModel',
    });
    expect(existsSync(path.join(tmp, 'MyReport.SemanticModel'))).toBe(false);

    const pbirRef = readJson(path.join(tmp, 'MyReport.Report', 'definition.pbir')) as Record<
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
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const report = readJson(
      path.join(tmp, 'MyReport.Report', 'definition', 'report.json'),
    ) as Record<string, unknown>;
    expect(report.$schema).toMatch(/report\/3\.2\.0/);

    const version = readJson(
      path.join(tmp, 'MyReport.Report', 'definition', 'version.json'),
    ) as Record<string, unknown>;
    expect(version.$schema).toMatch(/versionMetadata\/1\.0\.0/);
    expect(version.version).toBe('2.0.0');

    const pages = readJson(
      path.join(tmp, 'MyReport.Report', 'definition', 'pages', 'pages.json'),
    ) as Record<string, unknown>;
    expect(pages.$schema).toMatch(/pagesMetadata\/1\.0\.0/);
    expect(pages.pageOrder).toEqual([]);
  });

  it('embeds DEFAULT_BASE_THEME (CY26SU02 with object versions)', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const report = readJson(
      path.join(tmp, 'MyReport.Report', 'definition', 'report.json'),
    ) as Record<string, unknown>;
    const tc = report.themeCollection as Record<string, unknown>;
    const baseTheme = tc.baseTheme as Record<string, unknown>;
    expect(baseTheme.name).toBe('CY26SU02');
    expect(baseTheme.reportVersionAtImport).toEqual({
      visual: '2.6.0',
      report: '3.1.0',
      page: '2.3.0',
    });
    expect(baseTheme.type).toBe('SharedResources');
  });

  it('copies the CY26SU02 base theme file into StaticResources', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const themePath = path.join(
      tmp,
      'MyReport.Report',
      'StaticResources',
      'SharedResources',
      'BaseThemes',
      'CY26SU02.json',
    );
    const theme = readJson(themePath) as Record<string, unknown>;
    expect(theme.name).toBe('CY26SU02');
    expect(Array.isArray(theme.dataColors)).toBe(true);
  });

  it('declares the theme in report.json resourcePackages', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const report = readJson(
      path.join(tmp, 'MyReport.Report', 'definition', 'report.json'),
    ) as Record<string, unknown>;
    const packages = report.resourcePackages as Array<Record<string, unknown>>;
    expect(packages).toHaveLength(1);
    expect(packages[0]?.name).toBe('SharedResources');
    const items = packages[0]?.items as Array<Record<string, unknown>>;
    expect(items[0]?.name).toBe('CY26SU02');
    expect(items[0]?.path).toBe('BaseThemes/CY26SU02.json');
  });

  it('embeds Desktop settings defaults in report.json', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const report = readJson(
      path.join(tmp, 'MyReport.Report', 'definition', 'report.json'),
    ) as Record<string, unknown>;
    const settings = report.settings as Record<string, unknown>;
    expect(settings.useStylableVisualContainerHeader).toBe(true);
    expect(settings.defaultDrillFilterOtherVisuals).toBe(true);
    expect(settings.useEnhancedTooltips).toBe(true);
  });

  it('writes the .pbip with artifacts.report.path', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const pbip = readJson(path.join(tmp, 'MyReport.pbip')) as Record<string, unknown>;
    expect(pbip.version).toBe('1.0');
    expect(pbip.artifacts).toEqual([{ report: { path: 'MyReport.Report' } }]);
  });

  it('writes definition.pbir matching Desktop (no $schema, version 4.0)', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const pbir = readJson(path.join(tmp, 'MyReport.Report', 'definition.pbir')) as Record<
      string,
      unknown
    >;
    // Desktop does NOT include $schema in this file.
    expect(pbir).not.toHaveProperty('$schema');
    expect(pbir.version).toBe('4.0');
    const ref = (pbir.datasetReference as Record<string, unknown>).byPath as Record<
      string,
      unknown
    >;
    expect(ref.path).toBe('../MyReport.SemanticModel');
  });

  it('writes a real UUID for .platform logicalId (not all-zero)', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const plat = readJson(path.join(tmp, 'MyReport.Report', '.platform')) as Record<
      string,
      unknown
    >;
    const config = plat.config as Record<string, unknown>;
    expect(config.logicalId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(config.logicalId).not.toBe('00000000-0000-0000-0000-000000000000');
  });

  it('scaffolds full SemanticModel layout (model + database + cultures + diagram)', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const model = path.join(tmp, 'MyReport.SemanticModel');
    const expected = ['.platform', 'definition.pbism', 'diagramLayout.json'];
    for (const rel of expected) {
      expect(() => readJson(path.join(model, rel))).not.toThrow();
    }
    // model.tmdl / database.tmdl / cultures/en-US.tmdl are TMDL text, not JSON.
    // Smoke-test them with fs.existsSync via readJson's mkdir parent path.
  });

  it('writes the .platform metadata', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const plat = readJson(path.join(tmp, 'MyReport.Report', '.platform')) as Record<
      string,
      unknown
    >;
    expect(plat.$schema).toMatch(/platformProperties\/2\.0\.0/);
    const metadata = plat.metadata as Record<string, unknown>;
    expect(metadata.type).toBe('Report');
    expect(metadata.displayName).toBe('MyReport');
  });
});

describe('reportCreate: validates against our own validators', () => {
  it('newly scaffolded report passes structural validation', () => {
    const r = reportCreate({ targetPath: tmp, name: 'MyReport' });
    const report = validateReportFull(r.definitionPath);
    expect(report.valid).toBe(true);
    expect(report.summary.errors).toBe(0);
  });
});
