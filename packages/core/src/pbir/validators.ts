// Enhanced PBIR validation beyond basic structure checks.
//
// Ported from pbi-cli's core/pbir_validators.py. Three tiers:
//   1. Structural — folder layout and file existence (in path.ts)
//   2. Schema    — required fields, valid types, cross-file consistency
//   3. Model-aware — field bindings against a connected semantic model
//
// Lands early (Phase 1) so every downstream write phase can run validators
// after each operation.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { validateReportStructure } from './path.js';

export type ValidationLevel = 'error' | 'warning' | 'info';

export interface ValidationResult {
  readonly level: ValidationLevel;
  readonly file: string;
  readonly message: string;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<{ readonly file: string; readonly message: string }>;
  readonly warnings: ReadonlyArray<{ readonly file: string; readonly message: string }>;
  readonly info: ReadonlyArray<{ readonly file: string; readonly message: string }>;
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
    readonly info: number;
  };
}

export interface ModelTable {
  readonly name: string;
  readonly columns?: ReadonlyArray<{ readonly name: string }>;
  readonly measures?: ReadonlyArray<{ readonly name: string }>;
}

// -- Public API ------------------------------------------------------------

/**
 * Run all validation tiers and return a structured report.
 * Mirrors pbi-cli's `validate_report_full`.
 */
export function validateReportFull(definitionPath: string): ValidationReport {
  const findings: ValidationResult[] = [];

  // Tier 1: structural (reuse existing).
  for (const msg of validateReportStructure(definitionPath)) {
    findings.push({ level: 'error', file: '', message: msg });
  }

  if (!isDirectory(definitionPath)) {
    return buildResult(findings);
  }

  // Tier 2: JSON syntax across all files.
  findings.push(...validateJsonSyntax(definitionPath));

  // Tier 2: schema-aware per file type.
  findings.push(...validateReportJson(definitionPath));
  findings.push(...validateVersionJson(definitionPath));
  findings.push(...validatePagesMetadata(definitionPath));
  findings.push(...validateAllPages(definitionPath));
  findings.push(...validateAllVisuals(definitionPath));

  // Tier 2: cross-file consistency.
  findings.push(...validatePageOrderConsistency(definitionPath));
  findings.push(...validateVisualNameUniqueness(definitionPath));

  return buildResult(findings);
}

/**
 * Tier 3: cross-reference visual field bindings against a model.
 * Returns findings with level='warning' for missing fields.
 * Mirrors pbi-cli's `validate_bindings_against_model`.
 */
export function validateBindingsAgainstModel(
  definitionPath: string,
  modelTables: readonly ModelTable[],
): ValidationResult[] {
  const findings: ValidationResult[] = [];

  const validFields = new Set<string>();
  for (const table of modelTables) {
    for (const col of table.columns ?? []) {
      validFields.add(`${table.name}[${col.name}]`);
    }
    for (const mea of table.measures ?? []) {
      validFields.add(`${table.name}[${mea.name}]`);
    }
  }

  const pagesDir = path.join(definitionPath, 'pages');
  if (!isDirectory(pagesDir)) return findings;

  for (const pageEntry of readdirSync(pagesDir).sort()) {
    const pageDir = path.join(pagesDir, pageEntry);
    if (!isDirectory(pageDir)) continue;
    const visualsDir = path.join(pageDir, 'visuals');
    if (!isDirectory(visualsDir)) continue;

    for (const visualEntry of readdirSync(visualsDir).sort()) {
      const vdir = path.join(visualsDir, visualEntry);
      if (!isDirectory(vdir)) continue;
      const vfile = path.join(vdir, 'visual.json');
      if (!existsSync(vfile)) continue;

      try {
        const data = JSON.parse(readFileSync(vfile, 'utf-8')) as Record<string, unknown>;
        const visualConfig = (data.visual as Record<string, unknown>) ?? {};
        const query = (visualConfig.query as Record<string, unknown>) ?? {};
        const commands = Array.isArray(query.Commands) ? query.Commands : [];

        for (const cmd of commands as Array<Record<string, unknown>>) {
          const semanticCmd = (cmd.SemanticQueryDataShapeCommand as Record<string, unknown>) ?? {};
          const sq = (semanticCmd.Query as Record<string, unknown>) ?? {};
          const fromList = Array.isArray(sq.From) ? sq.From : [];
          const sources: Record<string, string> = {};
          for (const s of fromList as Array<Record<string, unknown>>) {
            if (typeof s.Name === 'string' && typeof s.Entity === 'string') {
              sources[s.Name] = s.Entity;
            }
          }
          const selectList = Array.isArray(sq.Select) ? sq.Select : [];
          for (const sel of selectList as Array<Record<string, unknown>>) {
            const ref = extractFieldRef(sel, sources);
            if (ref && !validFields.has(ref)) {
              const rel = `${pageEntry}/visuals/${visualEntry}`;
              findings.push({
                level: 'warning',
                file: rel,
                message: `Field '${ref}' not found in semantic model`,
              });
            }
          }
        }
      } catch {}
    }
  }

  return findings;
}

// -- Tier 2: JSON syntax ---------------------------------------------------

function validateJsonSyntax(definitionPath: string): ValidationResult[] {
  const findings: ValidationResult[] = [];
  for (const jsonFile of walkJsonFiles(definitionPath)) {
    try {
      JSON.parse(readFileSync(jsonFile, 'utf-8'));
    } catch (e) {
      const rel = path.relative(definitionPath, jsonFile);
      findings.push({
        level: 'error',
        file: rel,
        message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return findings;
}

// -- Tier 2: per-file-type schema checks -----------------------------------

function validateReportJson(definitionPath: string): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const reportJson = path.join(definitionPath, 'report.json');
  if (!existsSync(reportJson)) return findings;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(reportJson, 'utf-8')) as Record<string, unknown>;
  } catch {
    return findings;
  }

  if (!('$schema' in data)) {
    findings.push({ level: 'warning', file: 'report.json', message: 'Missing $schema reference' });
  }
  if (!('themeCollection' in data)) {
    findings.push({
      level: 'error',
      file: 'report.json',
      message: "Missing required 'themeCollection'",
    });
  } else {
    const tc = data.themeCollection as Record<string, unknown>;
    if (!('baseTheme' in tc)) {
      findings.push({
        level: 'warning',
        file: 'report.json',
        message: "themeCollection missing 'baseTheme'",
      });
    }
  }
  return findings;
}

function validateVersionJson(definitionPath: string): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const versionJson = path.join(definitionPath, 'version.json');
  if (!existsSync(versionJson)) return findings;

  try {
    const data = JSON.parse(readFileSync(versionJson, 'utf-8')) as Record<string, unknown>;
    if (!('version' in data)) {
      findings.push({
        level: 'error',
        file: 'version.json',
        message: "Missing required 'version'",
      });
    }
  } catch {
    // syntax-error path is covered by validateJsonSyntax
  }
  return findings;
}

function validatePagesMetadata(definitionPath: string): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const pagesJson = path.join(definitionPath, 'pages', 'pages.json');
  if (!existsSync(pagesJson)) return findings;

  try {
    const data = JSON.parse(readFileSync(pagesJson, 'utf-8')) as Record<string, unknown>;
    if ('pageOrder' in data && !Array.isArray(data.pageOrder)) {
      findings.push({
        level: 'error',
        file: 'pages/pages.json',
        message: "'pageOrder' must be an array",
      });
    }
  } catch {
    // covered by validateJsonSyntax
  }
  return findings;
}

const VALID_DISPLAY_OPTIONS = new Set([
  'FitToPage',
  'FitToWidth',
  'ActualSize',
  'ActualSizeTopLeft',
  'DeprecatedDynamic',
]);

function validateAllPages(definitionPath: string): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const pagesDir = path.join(definitionPath, 'pages');
  if (!isDirectory(pagesDir)) return findings;

  for (const pageEntry of readdirSync(pagesDir).sort()) {
    const pageDir = path.join(pagesDir, pageEntry);
    if (!isDirectory(pageDir)) continue;
    const pageJson = path.join(pageDir, 'page.json');
    if (!existsSync(pageJson)) continue;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(readFileSync(pageJson, 'utf-8')) as Record<string, unknown>;
    } catch {
      continue;
    }

    const rel = `pages/${pageEntry}/page.json`;
    for (const req of ['name', 'displayName', 'displayOption']) {
      if (!(req in data)) {
        findings.push({ level: 'error', file: rel, message: `Missing required '${req}'` });
      }
    }

    const opt = data.displayOption;
    if (typeof opt === 'string' && !VALID_DISPLAY_OPTIONS.has(opt)) {
      findings.push({ level: 'warning', file: rel, message: `Unknown displayOption '${opt}'` });
    }
    if (opt !== 'DeprecatedDynamic') {
      if (!('width' in data)) {
        findings.push({ level: 'error', file: rel, message: "Missing required 'width'" });
      }
      if (!('height' in data)) {
        findings.push({ level: 'error', file: rel, message: "Missing required 'height'" });
      }
    }

    const name = data.name;
    if (typeof name === 'string' && name.length > 50) {
      findings.push({
        level: 'warning',
        file: rel,
        message: `Name exceeds 50 chars: '${name.slice(0, 20)}...'`,
      });
    }
  }
  return findings;
}

function validateAllVisuals(definitionPath: string): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const pagesDir = path.join(definitionPath, 'pages');
  if (!isDirectory(pagesDir)) return findings;

  for (const pageEntry of readdirSync(pagesDir).sort()) {
    const pageDir = path.join(pagesDir, pageEntry);
    if (!isDirectory(pageDir)) continue;
    const visualsDir = path.join(pageDir, 'visuals');
    if (!isDirectory(visualsDir)) continue;

    for (const visualEntry of readdirSync(visualsDir).sort()) {
      const vdir = path.join(visualsDir, visualEntry);
      if (!isDirectory(vdir)) continue;
      const vfile = path.join(vdir, 'visual.json');
      if (!existsSync(vfile)) continue;

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(readFileSync(vfile, 'utf-8')) as Record<string, unknown>;
      } catch {
        continue;
      }

      const rel = `pages/${pageEntry}/visuals/${visualEntry}/visual.json`;

      if (!('name' in data)) {
        findings.push({ level: 'error', file: rel, message: "Missing required 'name'" });
      }
      if (!('position' in data)) {
        findings.push({ level: 'error', file: rel, message: "Missing required 'position'" });
      } else {
        const pos = data.position as Record<string, unknown>;
        for (const req of ['x', 'y', 'width', 'height']) {
          if (!(req in pos)) {
            findings.push({
              level: 'error',
              file: rel,
              message: `Position missing required '${req}'`,
            });
          }
        }
      }

      const visualConfig = (data.visual as Record<string, unknown>) ?? {};
      const vtype = typeof visualConfig.visualType === 'string' ? visualConfig.visualType : '';
      if (!vtype && !('visualGroup' in data)) {
        findings.push({
          level: 'warning',
          file: rel,
          message: "Missing 'visual.visualType' (not a visual group either)",
        });
      }
    }
  }
  return findings;
}

// -- Tier 2: cross-file consistency ----------------------------------------

function validatePageOrderConsistency(definitionPath: string): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const pagesJson = path.join(definitionPath, 'pages', 'pages.json');
  if (!existsSync(pagesJson)) return findings;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(pagesJson, 'utf-8')) as Record<string, unknown>;
  } catch {
    return findings;
  }

  const pageOrder = Array.isArray(data.pageOrder) ? (data.pageOrder as string[]) : [];
  const pagesDir = path.join(definitionPath, 'pages');

  const actualPages = new Set<string>();
  if (isDirectory(pagesDir)) {
    for (const entry of readdirSync(pagesDir)) {
      const pageDir = path.join(pagesDir, entry);
      if (isDirectory(pageDir) && existsSync(path.join(pageDir, 'page.json'))) {
        actualPages.add(entry);
      }
    }
  }

  for (const name of pageOrder) {
    if (!actualPages.has(name)) {
      findings.push({
        level: 'warning',
        file: 'pages/pages.json',
        message: `pageOrder references '${name}' but no such page folder exists`,
      });
    }
  }

  const listed = new Set(pageOrder);
  const unlisted = [...actualPages].filter((p) => !listed.has(p)).sort();
  for (const name of unlisted) {
    findings.push({
      level: 'info',
      file: 'pages/pages.json',
      message: `Page '${name}' exists but is not listed in pageOrder`,
    });
  }

  return findings;
}

function validateVisualNameUniqueness(definitionPath: string): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const pagesDir = path.join(definitionPath, 'pages');
  if (!isDirectory(pagesDir)) return findings;

  for (const pageEntry of readdirSync(pagesDir).sort()) {
    const pageDir = path.join(pagesDir, pageEntry);
    if (!isDirectory(pageDir)) continue;
    const visualsDir = path.join(pageDir, 'visuals');
    if (!isDirectory(visualsDir)) continue;

    const namesSeen: Record<string, string> = {};
    for (const visualEntry of readdirSync(visualsDir).sort()) {
      const vdir = path.join(visualsDir, visualEntry);
      if (!isDirectory(vdir)) continue;
      const vfile = path.join(vdir, 'visual.json');
      if (!existsSync(vfile)) continue;

      try {
        const data = JSON.parse(readFileSync(vfile, 'utf-8')) as Record<string, unknown>;
        const name = typeof data.name === 'string' ? data.name : '';
        if (name && name in namesSeen) {
          const rel = `pages/${pageEntry}/visuals/${visualEntry}/visual.json`;
          findings.push({
            level: 'error',
            file: rel,
            message: `Duplicate visual name '${name}' (also in ${namesSeen[name]})`,
          });
        } else if (name) {
          namesSeen[name] = visualEntry;
        }
      } catch {}
    }
  }
  return findings;
}

// -- Helpers ---------------------------------------------------------------

function buildResult(findings: ValidationResult[]): ValidationReport {
  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warning');
  const infos = findings.filter((f) => f.level === 'info');
  return {
    valid: errors.length === 0,
    errors: errors.map((f) => ({ file: f.file, message: f.message })),
    warnings: warnings.map((f) => ({ file: f.file, message: f.message })),
    info: infos.map((f) => ({ file: f.file, message: f.message })),
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      info: infos.length,
    },
  };
}

function extractFieldRef(
  selectItem: Record<string, unknown>,
  sources: Record<string, string>,
): string | null {
  for (const kind of ['Column', 'Measure'] as const) {
    if (kind in selectItem) {
      const item = selectItem[kind] as Record<string, unknown>;
      const expression = (item.Expression as Record<string, unknown>) ?? {};
      const sourceRef = (expression.SourceRef as Record<string, unknown>) ?? {};
      const sourceName = typeof sourceRef.Source === 'string' ? sourceRef.Source : '';
      const prop = typeof item.Property === 'string' ? item.Property : '';
      const table = sources[sourceName] ?? sourceName;
      if (table && prop) {
        return `${table}[${prop}]`;
      }
    }
  }
  return null;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function* walkJsonFiles(dir: string): Generator<string> {
  if (!isDirectory(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        yield* walkJsonFiles(full);
      } else if (st.isFile() && entry.endsWith('.json')) {
        yield full;
      }
    } catch {}
  }
}
