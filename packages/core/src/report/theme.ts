// Theme operations — apply / inspect / diff custom Power BI theme JSON.
//
// Ported from pbi-cli's core/report_backend.py:488-660 (theme_set, theme_get,
// theme_diff). A custom theme is a single JSON file installed under the
// report's StaticResources/RegisteredResources/ tree and referenced from
// report.json's `resourcePackages[]` + `themeCollection.customTheme`.

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError } from '../errors.js';
import { readJson, writeJson } from '../pbir/io.js';

// -- Types -----------------------------------------------------------------

export interface ThemeSetResult {
  readonly status: 'applied';
  readonly theme: string;
  readonly file: string;
}

export interface ThemeGetResult {
  readonly baseTheme: string;
  readonly customTheme: string | null;
  readonly themeData: Record<string, unknown> | null;
}

export interface ThemeDiffResult {
  readonly current: string;
  readonly proposed: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

// -- Operations ------------------------------------------------------------

/**
 * Apply a custom theme JSON to the report.
 *
 * 1. Reads the theme file from `themePath`.
 * 2. Copies it into `<report>/StaticResources/RegisteredResources/`.
 * 3. Sets `themeCollection.customTheme` in report.json.
 * 4. Adds/updates the entry in `resourcePackages[RegisteredResources].items[]`.
 */
export function themeSet(definitionPath: string, themePath: string): ThemeSetResult {
  if (!existsSync(themePath)) {
    throw new PbiCoreError(`Theme file not found: ${themePath}`);
  }

  const themeData = readJson(themePath) as Record<string, unknown>;
  const themeBasename = path.basename(themePath);
  const themeName =
    typeof themeData.name === 'string' ? themeData.name : path.parse(themePath).name;

  const reportJsonPath = path.join(definitionPath, 'report.json');
  const reportData = readJson(reportJsonPath) as Record<string, unknown>;

  // Set custom theme on themeCollection.
  const themeCollection: Record<string, unknown> = {
    ...((reportData.themeCollection as Record<string, unknown>) ?? {}),
  };
  themeCollection.customTheme = {
    name: themeName,
    reportVersionAtImport: '5.55',
    type: 'RegisteredResources',
  };
  reportData.themeCollection = themeCollection;

  // Copy the theme file into RegisteredResources.
  const reportFolder = path.dirname(definitionPath);
  const resourcesDir = path.join(reportFolder, 'StaticResources', 'RegisteredResources');
  mkdirSync(resourcesDir, { recursive: true });
  const themeDest = path.join(resourcesDir, themeBasename);
  writeJson(themeDest, themeData);

  // Update resourcePackages[] in report.json.
  const resourcePackages = Array.isArray(reportData.resourcePackages)
    ? [...(reportData.resourcePackages as Record<string, unknown>[])]
    : [];

  const registeredIdx = resourcePackages.findIndex((p) => p.name === 'RegisteredResources');
  if (registeredIdx === -1) {
    resourcePackages.push({
      name: 'RegisteredResources',
      type: 'RegisteredResources',
      items: [
        {
          name: themeBasename,
          type: 202,
          path: `BaseThemes/${themeBasename}`,
        },
      ],
    });
  } else {
    const pkg = { ...resourcePackages[registeredIdx] } as Record<string, unknown>;
    const items = Array.isArray(pkg.items) ? [...(pkg.items as Record<string, unknown>[])] : [];
    if (!items.some((i) => i.name === themeBasename)) {
      items.push({ name: themeBasename, type: 202, path: `BaseThemes/${themeBasename}` });
    }
    pkg.items = items;
    resourcePackages[registeredIdx] = pkg;
  }
  reportData.resourcePackages = resourcePackages;

  writeJson(reportJsonPath, reportData);

  return {
    status: 'applied',
    theme: themeName,
    file: themeDest,
  };
}

/**
 * Return current theme info: base name, custom name (if any), and the full
 * custom theme JSON (if the file is reachable in RegisteredResources).
 */
export function themeGet(definitionPath: string): ThemeGetResult {
  const reportJsonPath = path.join(definitionPath, 'report.json');
  if (!existsSync(reportJsonPath)) {
    throw new PbiCoreError('report.json not found — is this a valid PBIR definition folder?');
  }
  const reportData = readJson(reportJsonPath) as Record<string, unknown>;
  const themeCollection = (reportData.themeCollection as Record<string, unknown>) ?? {};
  const baseTheme = (themeCollection.baseTheme as Record<string, unknown>) ?? {};
  const customThemeInfo = themeCollection.customTheme as Record<string, unknown> | undefined;

  const baseName = typeof baseTheme.name === 'string' ? baseTheme.name : '';
  let customName: string | null = null;
  let themeData: Record<string, unknown> | null = null;

  if (customThemeInfo) {
    customName = typeof customThemeInfo.name === 'string' ? customThemeInfo.name : null;
    // Try to load the JSON from RegisteredResources.
    const reportFolder = path.dirname(definitionPath);
    const resourcesDir = path.join(reportFolder, 'StaticResources', 'RegisteredResources');
    if (existsSync(resourcesDir)) {
      for (const entry of readdirSync(resourcesDir)) {
        if (!entry.endsWith('.json')) continue;
        try {
          const parsed = readJson(path.join(resourcesDir, entry)) as Record<string, unknown>;
          if (parsed.name === customName) {
            themeData = parsed;
            break;
          }
        } catch {
          // skip malformed files
        }
      }
    }
  }

  return {
    baseTheme: baseName,
    customTheme: customName,
    themeData,
  };
}

/**
 * Diff a proposed theme file against the currently applied theme.
 * Returns added/removed/changed key paths (dot-notation).
 */
export function themeDiff(definitionPath: string, themePath: string): ThemeDiffResult {
  if (!existsSync(themePath)) {
    throw new PbiCoreError(`Proposed theme file not found: ${themePath}`);
  }

  const currentInfo = themeGet(definitionPath);
  const currentData: Record<string, unknown> = currentInfo.themeData ?? {};
  const proposedData = readJson(themePath) as Record<string, unknown>;

  const currentName = currentInfo.customTheme ?? currentInfo.baseTheme ?? '(none)';
  const proposedName =
    typeof proposedData.name === 'string' ? proposedData.name : path.parse(themePath).name;

  const [added, removed, changed] = dictDiff(currentData, proposedData);

  return {
    current: currentName,
    proposed: proposedName,
    added,
    removed,
    changed,
  };
}

// -- Helpers ---------------------------------------------------------------

/**
 * Recursive dict diff. Returns three lists of dot-notation key paths:
 * - added: in `proposed` but not in `current`
 * - removed: in `current` but not in `proposed`
 * - changed: in both but values differ
 */
function dictDiff(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  prefix = '',
): [string[], string[], string[]] {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  const allKeys = new Set<string>([...Object.keys(current), ...Object.keys(proposed)]);
  const sortedKeys = [...allKeys].sort();

  for (const key of sortedKeys) {
    const fullPath = prefix === '' ? key : `${prefix}.${key}`;
    const inCurrent = key in current;
    const inProposed = key in proposed;
    if (!inCurrent) {
      added.push(fullPath);
    } else if (!inProposed) {
      removed.push(fullPath);
    } else if (isPlainObject(current[key]) && isPlainObject(proposed[key])) {
      const [a, r, c] = dictDiff(
        current[key] as Record<string, unknown>,
        proposed[key] as Record<string, unknown>,
        fullPath,
      );
      added.push(...a);
      removed.push(...r);
      changed.push(...c);
    } else if (!deepEqual(current[key], proposed[key])) {
      changed.push(fullPath);
    }
  }

  return [added, removed, changed];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}
