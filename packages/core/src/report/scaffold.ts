// Report scaffolding — builds a complete .pbip + .Report + (optional)
// .SemanticModel project from scratch.
//
// File shapes mirror what Power BI Desktop 2.152 (March 2026) produces
// when saving a brand-new empty report with the "enhanced report format
// (PBIR)" preview feature enabled. Verified against a Desktop-saved
// reference project (`dashboard/Truth.pbip` in this repo, kept around
// as a regression fixture).
//
// Previous versions of this scaffold mirrored pbi-cli's (older) output,
// which March 2026 Desktop rejects with:
//   ReportDefinition: Required artifact is missing in definition.pbir.

import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from '../pbir/io.js';
import {
  DEFAULT_BASE_THEME,
  SCHEMA_PAGES_METADATA,
  SCHEMA_PLATFORM,
  SCHEMA_REPORT,
  SCHEMA_VERSION,
} from '../pbir/schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_TEMPLATES_DIR = path.join(__dirname, 'templates');

export interface ReportCreateOptions {
  /** Directory under which `<name>.Report` will be created. */
  readonly targetPath: string;
  /** Logical report name. Becomes `<name>.pbip` and `<name>.Report/` */
  readonly name: string;
  /**
   * Path (relative or absolute) to an existing `.SemanticModel` folder. If
   * omitted, a blank `<name>.SemanticModel/` is scaffolded alongside the
   * report and referenced via the default `../<name>.SemanticModel` path.
   */
  readonly datasetPath?: string;
}

export interface ReportCreateResult {
  readonly status: 'created';
  readonly name: string;
  readonly path: string;
  readonly definitionPath: string;
}

/**
 * Scaffold a new PBIR report project.
 *
 * File layout (matches Desktop output):
 *   <targetPath>/<name>.pbip
 *   <targetPath>/<name>.Report/.platform
 *   <targetPath>/<name>.Report/definition.pbir
 *   <targetPath>/<name>.Report/definition/report.json
 *   <targetPath>/<name>.Report/definition/version.json
 *   <targetPath>/<name>.Report/definition/pages/pages.json
 *   <targetPath>/<name>.Report/StaticResources/SharedResources/BaseThemes/CY26SU02.json
 *   <targetPath>/<name>.SemanticModel/...   (when datasetPath omitted)
 */
export function reportCreate(opts: ReportCreateOptions): ReportCreateResult {
  const targetPath = path.resolve(opts.targetPath);
  const reportFolder = path.join(targetPath, `${opts.name}.Report`);
  const definitionDir = path.join(reportFolder, 'definition');
  const pagesDir = path.join(definitionDir, 'pages');
  mkdirSync(pagesDir, { recursive: true });

  // -- definition/version.json
  writeJson(path.join(definitionDir, 'version.json'), {
    $schema: SCHEMA_VERSION,
    version: '2.0.0',
  });

  // -- definition/report.json — matches Desktop's default for a new report.
  writeJson(path.join(definitionDir, 'report.json'), {
    $schema: SCHEMA_REPORT,
    themeCollection: {
      baseTheme: { ...DEFAULT_BASE_THEME },
    },
    objects: {
      section: [
        {
          properties: {
            verticalAlignment: { expr: { Literal: { Value: "'Top'" } } },
          },
        },
      ],
    },
    resourcePackages: [
      {
        name: 'SharedResources',
        type: 'SharedResources',
        items: [
          {
            name: DEFAULT_BASE_THEME.name,
            path: `BaseThemes/${DEFAULT_BASE_THEME.name}.json`,
            type: 'BaseTheme',
          },
        ],
      },
    ],
    settings: {
      useStylableVisualContainerHeader: true,
      exportDataMode: 'AllowSummarized',
      defaultDrillFilterOtherVisuals: true,
      allowChangeFilterTypes: true,
      useEnhancedTooltips: true,
      useDefaultAggregateDisplayName: true,
    },
  });

  // -- definition/pages/pages.json — empty page order.
  writeJson(path.join(pagesDir, 'pages.json'), {
    $schema: SCHEMA_PAGES_METADATA,
    pageOrder: [],
  });

  // -- StaticResources/SharedResources/BaseThemes/<theme>.json — required
  // because report.json's resourcePackages references it. Copy verbatim
  // from our bundled template (Desktop's exact theme JSON).
  const themeDestDir = path.join(reportFolder, 'StaticResources', 'SharedResources', 'BaseThemes');
  mkdirSync(themeDestDir, { recursive: true });
  copyFileSync(
    path.join(REPORT_TEMPLATES_DIR, `${DEFAULT_BASE_THEME.name}.json`),
    path.join(themeDestDir, `${DEFAULT_BASE_THEME.name}.json`),
  );

  // -- Resolve dataset path; scaffold a blank semantic model if needed.
  let datasetPath = opts.datasetPath;
  if (!datasetPath) {
    datasetPath = `../${opts.name}.SemanticModel`;
    scaffoldBlankSemanticModel(targetPath, opts.name);
  }

  // -- definition.pbir — NO $schema field (Desktop doesn't write one).
  writeJson(path.join(reportFolder, 'definition.pbir'), {
    version: '4.0',
    datasetReference: {
      byPath: { path: datasetPath },
    },
  });

  // -- .platform — Fabric git-integration metadata. logicalId is a real
  // UUID (Desktop generates one; all-zero may trigger validator quirks).
  writeJson(path.join(reportFolder, '.platform'), {
    $schema: SCHEMA_PLATFORM,
    metadata: {
      type: 'Report',
      displayName: opts.name,
    },
    config: {
      version: '2.0',
      logicalId: randomUUID(),
    },
  });

  // -- <name>.pbip — top-level project file.
  writeJson(path.join(targetPath, `${opts.name}.pbip`), {
    version: '1.0',
    artifacts: [{ report: { path: `${opts.name}.Report` } }],
    settings: {
      enableAutoRecovery: true,
    },
  });

  return {
    status: 'created',
    name: opts.name,
    path: reportFolder,
    definitionPath: definitionDir,
  };
}

/**
 * Create a blank TMDL semantic model that Desktop accepts.
 *
 * Matches Desktop's output for a new empty model:
 *   <name>.SemanticModel/.platform
 *   <name>.SemanticModel/definition.pbism
 *   <name>.SemanticModel/diagramLayout.json
 *   <name>.SemanticModel/definition/model.tmdl
 *   <name>.SemanticModel/definition/database.tmdl
 *   <name>.SemanticModel/definition/cultures/en-US.tmdl
 */
export function scaffoldBlankSemanticModel(targetPath: string, name: string): void {
  const modelDir = path.join(targetPath, `${name}.SemanticModel`);
  const defnDir = path.join(modelDir, 'definition');
  const culturesDir = path.join(defnDir, 'cultures');
  mkdirSync(culturesDir, { recursive: true });

  // -- definition/model.tmdl — full Desktop-style scaffold.
  writeFileSync(
    path.join(defnDir, 'model.tmdl'),
    [
      'model Model',
      '\tculture: en-US',
      '\tdefaultPowerBIDataSourceVersion: powerBI_V3',
      '\tsourceQueryCulture: en-US',
      '\tdataAccessOptions',
      '\t\tlegacyRedirects',
      '\t\treturnErrorValuesAsNull',
      '',
      'annotation __PBI_TimeIntelligenceEnabled = 1',
      '',
      'annotation PBI_ProTooling = ["DevMode"]',
      '',
      'ref cultureInfo en-US',
      '',
      '',
    ].join('\n'),
    'utf-8',
  );

  // -- definition/database.tmdl
  writeFileSync(
    path.join(defnDir, 'database.tmdl'),
    'database\n\tcompatibilityLevel: 1600\n\n',
    'utf-8',
  );

  // -- definition/cultures/en-US.tmdl
  writeFileSync(path.join(culturesDir, 'en-US.tmdl'), 'cultureInfo en-US\n\n', 'utf-8');

  // -- diagramLayout.json (Desktop writes a default empty diagram)
  writeJson(path.join(modelDir, 'diagramLayout.json'), {
    version: '1.1.0',
    diagrams: [
      {
        ordinal: 0,
        scrollPosition: { x: 0, y: 0 },
        nodes: [],
        name: 'All tables',
        zoomValue: 100,
        pinKeyFieldsToTop: false,
        showExtraHeaderInfo: false,
        hideKeyFieldsWhenCollapsed: false,
        tablesLocked: false,
      },
    ],
    selectedDiagram: 'All tables',
    defaultDiagram: 'All tables',
  });

  // -- .platform
  writeJson(path.join(modelDir, '.platform'), {
    $schema: SCHEMA_PLATFORM,
    metadata: {
      type: 'SemanticModel',
      displayName: name,
    },
    config: {
      version: '2.0',
      logicalId: randomUUID(),
    },
  });

  // -- definition.pbism — Desktop currently writes version 4.2.
  writeJson(path.join(modelDir, 'definition.pbism'), {
    version: '4.2',
    settings: {},
  });
}
