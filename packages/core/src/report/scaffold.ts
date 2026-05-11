// Report scaffolding — builds a complete .pbip + .Report + (optional)
// .SemanticModel project from scratch.
//
// Ported from pbi-cli's report_backend.py `report_create` and
// `_scaffold_blank_semantic_model` (lines 100-217, 739-777).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writeJson } from '../pbir/io.js';
import {
  DEFAULT_BASE_THEME,
  SCHEMA_PAGES_METADATA,
  SCHEMA_REPORT,
  SCHEMA_VERSION,
} from '../pbir/schemas.js';

const PLATFORM_SCHEMA =
  'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json';

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
 * Scaffold a new PBIR report project structure.
 *
 * Produces:
 *   <targetPath>/<name>.pbip                                — project file
 *   <targetPath>/<name>.Report/.platform                    — Fabric metadata
 *   <targetPath>/<name>.Report/definition.pbir              — datasetReference
 *   <targetPath>/<name>.Report/definition/report.json       — top-level config
 *   <targetPath>/<name>.Report/definition/version.json      — version stamp
 *   <targetPath>/<name>.Report/definition/pages/pages.json  — empty page index
 *   (optional, when datasetPath is omitted):
 *   <targetPath>/<name>.SemanticModel/...                   — blank TMDL stub
 */
export function reportCreate(opts: ReportCreateOptions): ReportCreateResult {
  const targetPath = path.resolve(opts.targetPath);
  const reportFolder = path.join(targetPath, `${opts.name}.Report`);
  const definitionDir = path.join(reportFolder, 'definition');
  const pagesDir = path.join(definitionDir, 'pages');
  mkdirSync(pagesDir, { recursive: true });

  // version.json
  writeJson(path.join(definitionDir, 'version.json'), {
    $schema: SCHEMA_VERSION,
    version: '2.0.0',
  });

  // report.json — matches Desktop defaults verbatim.
  writeJson(path.join(definitionDir, 'report.json'), {
    $schema: SCHEMA_REPORT,
    themeCollection: {
      baseTheme: { ...DEFAULT_BASE_THEME },
    },
    layoutOptimization: 'None',
    settings: {
      useStylableVisualContainerHeader: true,
      defaultDrillFilterOtherVisuals: true,
      allowChangeFilterTypes: true,
      useEnhancedTooltips: true,
      useDefaultAggregateDisplayName: true,
    },
    slowDataSourceSettings: {
      isCrossHighlightingDisabled: false,
      isSlicerSelectionsButtonEnabled: false,
      isFilterSelectionsButtonEnabled: false,
      isFieldWellButtonEnabled: false,
      isApplyAllButtonEnabled: false,
    },
  });

  // pages.json — empty page order.
  writeJson(path.join(pagesDir, 'pages.json'), {
    $schema: SCHEMA_PAGES_METADATA,
    pageOrder: [],
  });

  // Resolve dataset path, scaffolding a blank semantic model if needed.
  let datasetPath = opts.datasetPath;
  if (!datasetPath) {
    datasetPath = `../${opts.name}.SemanticModel`;
    scaffoldBlankSemanticModel(targetPath, opts.name);
  }

  // definition.pbir — datasetReference is REQUIRED by Desktop.
  writeJson(path.join(reportFolder, 'definition.pbir'), {
    version: '4.0',
    datasetReference: {
      byPath: { path: datasetPath },
    },
  });

  // .platform — Fabric git-integration metadata.
  writeJson(path.join(reportFolder, '.platform'), {
    $schema: PLATFORM_SCHEMA,
    metadata: {
      type: 'Report',
      displayName: opts.name,
    },
    config: {
      version: '2.0',
      logicalId: '00000000-0000-0000-0000-000000000000',
    },
  });

  // .pbip — top-level project file.
  writeJson(path.join(targetPath, `${opts.name}.pbip`), {
    version: '1.0',
    artifacts: [{ report: { path: `${opts.name}.Report` } }],
  });

  return {
    status: 'created',
    name: opts.name,
    path: reportFolder,
    definitionPath: definitionDir,
  };
}

/**
 * Create a minimal TMDL semantic model so Desktop can open the report.
 *
 * Mirrors pbi-cli's `_scaffold_blank_semantic_model`. The TMDL is written as
 * plain text (not JSON), so it does not go through writeJson.
 */
export function scaffoldBlankSemanticModel(targetPath: string, name: string): void {
  const modelDir = path.join(targetPath, `${name}.SemanticModel`);
  const defnDir = path.join(modelDir, 'definition');
  mkdirSync(defnDir, { recursive: true });

  // model.tmdl — minimal valid TMDL.
  writeFileSync(
    path.join(defnDir, 'model.tmdl'),
    'model Model\n  culture: en-US\n  defaultPowerBIDataSourceVersion: powerBI_V3\n',
    'utf-8',
  );

  // .platform — required by Desktop.
  writeJson(path.join(modelDir, '.platform'), {
    $schema: PLATFORM_SCHEMA,
    metadata: {
      type: 'SemanticModel',
      displayName: name,
    },
    config: {
      version: '2.0',
      logicalId: '00000000-0000-0000-0000-000000000000',
    },
  });

  // definition.pbism — matches Desktop format.
  writeJson(path.join(modelDir, 'definition.pbism'), {
    version: '4.1',
    settings: {},
  });
}
