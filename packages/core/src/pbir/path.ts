// PBIR report folder resolution and path utilities.
//
// Ported from pbi-cli's core/pbir_path.py. Resolution heuristic:
//   1. Explicit path provided → normalize to the .Report/definition/ folder.
//   2. Walk up from cwd looking for *.Report/definition/report.json.
//   3. Look for a .pbip sibling and derive the .Report folder.
//   4. Throw ReportNotFoundError.

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ReportNotFoundError } from '../errors.js';

const MAX_WALK_UP = 5;

/**
 * Resolve a PBIR report's `definition/` folder.
 *
 * If `explicitPath` is provided, it can point at any of:
 *   - the `definition/` folder directly
 *   - the `.Report` folder containing it
 *   - a parent folder containing a `.Report` child
 *
 * If `explicitPath` is null/undefined, walk up from cwd, then fall back to
 * a `.pbip` sibling lookup. Throws `ReportNotFoundError` if nothing matches.
 */
export function resolveReportPath(explicitPath?: string | null): string {
  if (explicitPath !== undefined && explicitPath !== null) {
    return resolveExplicit(path.resolve(explicitPath));
  }

  const cwd = process.cwd();
  const walkUp = findDefinitionWalkUp(cwd);
  if (walkUp !== null) return walkUp;

  const fromPbip = findFromPbip(cwd);
  if (fromPbip !== null) return fromPbip;

  throw new ReportNotFoundError();
}

function resolveExplicit(targetPath: string): string {
  if (!existsSync(targetPath)) {
    throw new ReportNotFoundError(
      `No PBIR definition found at '${targetPath}'. Path does not exist.`,
    );
  }

  // User pointed directly at the definition folder.
  if (
    path.basename(targetPath) === 'definition' &&
    existsSync(path.join(targetPath, 'report.json'))
  ) {
    return targetPath;
  }

  // User pointed at the .Report folder.
  const defn = path.join(targetPath, 'definition');
  if (isDirectory(defn) && existsSync(path.join(defn, 'report.json'))) {
    return defn;
  }

  // User pointed at a parent containing a .Report child.
  if (isDirectory(targetPath)) {
    for (const child of readdirSync(targetPath)) {
      if (child.endsWith('.Report')) {
        const childPath = path.join(targetPath, child);
        if (isDirectory(childPath)) {
          const childDefn = path.join(childPath, 'definition');
          if (existsSync(path.join(childDefn, 'report.json'))) {
            return childDefn;
          }
        }
      }
    }
  }

  throw new ReportNotFoundError(
    `No PBIR definition found at '${targetPath}'. Expected a folder containing definition/report.json.`,
  );
}

function findDefinitionWalkUp(start: string): string | null {
  let current = path.resolve(start);
  for (let i = 0; i < MAX_WALK_UP; i++) {
    if (!isDirectory(current)) break;
    try {
      for (const child of readdirSync(current)) {
        if (child.endsWith('.Report')) {
          const childPath = path.join(current, child);
          if (isDirectory(childPath)) {
            const defn = path.join(childPath, 'definition');
            if (existsSync(path.join(defn, 'report.json'))) {
              return defn;
            }
          }
        }
      }
    } catch {
      // Permission error or similar — try parent.
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function findFromPbip(start: string): string | null {
  if (!isDirectory(start)) return null;
  try {
    for (const item of readdirSync(start)) {
      if (item.endsWith('.pbip')) {
        const stem = item.slice(0, -'.pbip'.length);
        const reportFolder = path.join(start, `${stem}.Report`);
        const defn = path.join(reportFolder, 'definition');
        if (existsSync(path.join(defn, 'report.json'))) {
          return defn;
        }
      }
    }
  } catch {
    return null;
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

// -- Path helpers (mirror Python get_*_dir functions) ----------------------

export function getPagesDir(definitionPath: string): string {
  const pagesDir = path.join(definitionPath, 'pages');
  mkdirSync(pagesDir, { recursive: true });
  return pagesDir;
}

export function getPageDir(definitionPath: string, pageName: string): string {
  return path.join(definitionPath, 'pages', pageName);
}

export function getVisualsDir(definitionPath: string, pageName: string): string {
  const visualsDir = path.join(definitionPath, 'pages', pageName, 'visuals');
  mkdirSync(visualsDir, { recursive: true });
  return visualsDir;
}

export function getVisualDir(definitionPath: string, pageName: string, visualName: string): string {
  return path.join(definitionPath, 'pages', pageName, 'visuals', visualName);
}

/**
 * Check that the PBIR folder structure is valid.
 * Returns a list of error messages (empty array = valid).
 *
 * Ports `validate_report_structure` from pbir_path.py.
 */
export function validateReportStructure(definitionPath: string): string[] {
  const errors: string[] = [];

  if (!isDirectory(definitionPath)) {
    errors.push(`Definition folder does not exist: ${definitionPath}`);
    return errors;
  }

  if (!existsSync(path.join(definitionPath, 'report.json'))) {
    errors.push('Missing required file: report.json');
  }
  if (!existsSync(path.join(definitionPath, 'version.json'))) {
    errors.push('Missing required file: version.json');
  }

  const pagesDir = path.join(definitionPath, 'pages');
  if (isDirectory(pagesDir)) {
    for (const pageEntry of readdirSync(pagesDir).sort()) {
      const pageDir = path.join(pagesDir, pageEntry);
      if (!isDirectory(pageDir)) continue;
      const pageJson = path.join(pageDir, 'page.json');
      if (!existsSync(pageJson)) {
        errors.push(`Page folder '${pageEntry}' missing page.json`);
      }
      const visualsDir = path.join(pageDir, 'visuals');
      if (isDirectory(visualsDir)) {
        for (const visualEntry of readdirSync(visualsDir).sort()) {
          const visualDir = path.join(visualsDir, visualEntry);
          if (!isDirectory(visualDir)) continue;
          if (!existsSync(path.join(visualDir, 'visual.json'))) {
            errors.push(`Visual folder '${pageEntry}/visuals/${visualEntry}' missing visual.json`);
          }
        }
      }
    }
  }

  return errors;
}
