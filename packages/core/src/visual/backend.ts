// Visual CRUD operations.
//
// Ported from pbi-cli's core/visual_backend.py (visual_list, visual_get,
// visual_add, visual_update, visual_delete, visual_set_container).
// Uses the template loader + role tables landed in Phase 1.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError, VisualTypeError } from '../errors.js';
import { generateId, readJson, writeJson } from '../pbir/io.js';
import { getVisualDir, getVisualsDir } from '../pbir/path.js';
import { type VisualType, resolveVisualType } from '../pbir/schemas.js';
import { fillTemplate } from './templates.js';

// -- Default sizes per visual type (from real Desktop exports) -------------

export const DEFAULT_SIZES: Readonly<Record<VisualType, readonly [number, number]>> = {
  // Original 9
  barChart: [400, 300],
  lineChart: [400, 300],
  card: [200, 120],
  tableEx: [500, 350],
  pivotTable: [500, 350],
  slicer: [200, 300],
  kpi: [250, 150],
  gauge: [300, 250],
  donutChart: [350, 300],
  // v3.1.0
  columnChart: [400, 300],
  areaChart: [400, 300],
  ribbonChart: [400, 300],
  waterfallChart: [450, 300],
  scatterChart: [400, 350],
  funnelChart: [350, 300],
  multiRowCard: [300, 200],
  treemap: [400, 300],
  cardNew: [200, 120],
  stackedBarChart: [400, 300],
  lineStackedColumnComboChart: [500, 300],
  // v3.4.0
  cardVisual: [217, 87],
  actionButton: [51, 22],
  // v3.5.0
  clusteredColumnChart: [400, 300],
  clusteredBarChart: [400, 300],
  textSlicer: [200, 50],
  listSlicer: [200, 300],
  // v3.6.0
  image: [200, 150],
  shape: [300, 200],
  textbox: [300, 100],
  pageNavigator: [120, 400],
  advancedSlicerVisual: [280, 280],
  // v3.8.0
  azureMap: [500, 400],
};

// -- Types -----------------------------------------------------------------

export interface VisualListItem {
  readonly name: string;
  readonly visualType: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface VisualBindingSummary {
  readonly role: string;
  readonly queryRef: string;
  readonly field: string;
}

export interface VisualDetail {
  readonly name: string;
  readonly visualType: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bindings: readonly VisualBindingSummary[];
  readonly isHidden: boolean;
}

export interface VisualAddOptions {
  readonly visualType: string;
  readonly name?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface VisualAddResult {
  readonly status: 'created';
  readonly name: string;
  readonly visualType: VisualType;
  readonly page: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface VisualUpdateOptions {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly hidden?: boolean;
}

// -- Operations ------------------------------------------------------------

/** List all visuals on a page. Group containers report visualType="group". */
export function visualList(definitionPath: string, pageName: string): VisualListItem[] {
  const visualsDir = path.join(definitionPath, 'pages', pageName, 'visuals');
  if (!isDirectory(visualsDir)) return [];

  const results: VisualListItem[] = [];
  for (const entry of readdirSync(visualsDir).sort()) {
    const vdir = path.join(visualsDir, entry);
    if (!isDirectory(vdir)) continue;
    const vfile = path.join(vdir, 'visual.json');
    if (!existsSync(vfile)) continue;

    const data = readJson(vfile) as Record<string, unknown>;

    // Group containers use "visualGroup" rather than "visual".
    if ('visualGroup' in data && !('visual' in data)) {
      results.push({
        name: typeof data.name === 'string' ? data.name : entry,
        visualType: 'group',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      continue;
    }

    const pos = (data.position as Record<string, unknown>) ?? {};
    const visualConfig = (data.visual as Record<string, unknown>) ?? {};
    results.push({
      name: typeof data.name === 'string' ? data.name : entry,
      visualType: typeof visualConfig.visualType === 'string' ? visualConfig.visualType : 'unknown',
      x: typeof pos.x === 'number' ? pos.x : 0,
      y: typeof pos.y === 'number' ? pos.y : 0,
      width: typeof pos.width === 'number' ? pos.width : 0,
      height: typeof pos.height === 'number' ? pos.height : 0,
    });
  }
  return results;
}

/** Get detailed info for a visual including a binding summary. */
export function visualGet(
  definitionPath: string,
  pageName: string,
  visualName: string,
): VisualDetail {
  const visualDir = getVisualDir(definitionPath, pageName, visualName);
  const vfile = path.join(visualDir, 'visual.json');
  if (!existsSync(vfile)) {
    throw new PbiCoreError(`Visual '${visualName}' not found on page '${pageName}'.`);
  }

  const data = readJson(vfile) as Record<string, unknown>;
  const pos = (data.position as Record<string, unknown>) ?? {};
  const visualConfig = (data.visual as Record<string, unknown>) ?? {};
  const query = (visualConfig.query as Record<string, unknown>) ?? {};
  const queryState = (query.queryState as Record<string, unknown>) ?? {};

  const bindings: VisualBindingSummary[] = [];
  for (const [role, stateValue] of Object.entries(queryState)) {
    const state = (stateValue as Record<string, unknown>) ?? {};
    const projections = Array.isArray(state.projections) ? state.projections : [];
    for (const projRaw of projections) {
      const proj = (projRaw as Record<string, unknown>) ?? {};
      const field = (proj.field as Record<string, unknown>) ?? {};
      const queryRef = typeof proj.queryRef === 'string' ? proj.queryRef : '';
      bindings.push({ role, queryRef, field: summarizeField(field) });
    }
  }

  return {
    name: typeof data.name === 'string' ? data.name : visualName,
    visualType: typeof visualConfig.visualType === 'string' ? visualConfig.visualType : 'unknown',
    x: typeof pos.x === 'number' ? pos.x : 0,
    y: typeof pos.y === 'number' ? pos.y : 0,
    width: typeof pos.width === 'number' ? pos.width : 0,
    height: typeof pos.height === 'number' ? pos.height : 0,
    bindings,
    isHidden: data.isHidden === true,
  };
}

/**
 * Add a new visual to a page. Template-driven — uses the bundled visual JSON
 * templates plus the empirical default sizes from Desktop exports.
 *
 * - `x` defaults to 50
 * - `y` defaults to the next vertical slot below existing visuals (+20px gap)
 * - `width`/`height` default to DEFAULT_SIZES[type]
 * - `z` and `tabOrder` auto-increment
 */
export function visualAdd(
  definitionPath: string,
  pageName: string,
  opts: VisualAddOptions,
): VisualAddResult {
  const pageDir = path.join(definitionPath, 'pages', pageName);
  if (!isDirectory(pageDir)) {
    throw new PbiCoreError(`Page '${pageName}' not found.`);
  }

  const resolved = resolveVisualType(opts.visualType);
  if (resolved === null) {
    throw new VisualTypeError(opts.visualType);
  }
  const visualName = opts.name ?? generateId();

  const [defaultW, defaultH] = DEFAULT_SIZES[resolved];
  const finalX = opts.x ?? 50;
  const finalY = opts.y ?? nextYPosition(definitionPath, pageName);
  const finalW = opts.width ?? defaultW;
  const finalH = opts.height ?? defaultH;
  const z = nextZOrder(definitionPath, pageName);

  const visualData = fillTemplate(resolved, {
    visualName,
    x: finalX,
    y: finalY,
    width: finalW,
    height: finalH,
    z,
    tabOrder: z,
  });

  const visualDir = path.join(getVisualsDir(definitionPath, pageName), visualName);
  mkdirSync(visualDir, { recursive: true });
  writeJson(path.join(visualDir, 'visual.json'), visualData);

  return {
    status: 'created',
    name: visualName,
    visualType: resolved,
    page: pageName,
    x: finalX,
    y: finalY,
    width: finalW,
    height: finalH,
  };
}

/** Update position, size, or hidden state of a visual. */
export function visualUpdate(
  definitionPath: string,
  pageName: string,
  visualName: string,
  opts: VisualUpdateOptions,
): { status: 'updated'; name: string; page: string; position: Record<string, number> } {
  const vfile = path.join(getVisualDir(definitionPath, pageName, visualName), 'visual.json');
  if (!existsSync(vfile)) {
    throw new PbiCoreError(`Visual '${visualName}' not found on page '${pageName}'.`);
  }

  const data = readJson(vfile) as Record<string, unknown>;
  const pos = { ...((data.position as Record<string, unknown>) ?? {}) };

  if (opts.x !== undefined) pos.x = opts.x;
  if (opts.y !== undefined) pos.y = opts.y;
  if (opts.width !== undefined) pos.width = opts.width;
  if (opts.height !== undefined) pos.height = opts.height;
  data.position = pos;

  if (opts.hidden !== undefined) data.isHidden = opts.hidden;

  writeJson(vfile, data);

  return {
    status: 'updated',
    name: visualName,
    page: pageName,
    position: {
      x: typeof pos.x === 'number' ? pos.x : 0,
      y: typeof pos.y === 'number' ? pos.y : 0,
      width: typeof pos.width === 'number' ? pos.width : 0,
      height: typeof pos.height === 'number' ? pos.height : 0,
    },
  };
}

/** Delete a visual folder entirely. */
export function visualDelete(
  definitionPath: string,
  pageName: string,
  visualName: string,
): { status: 'deleted'; name: string; page: string } {
  const visualDir = getVisualDir(definitionPath, pageName, visualName);
  if (!existsSync(visualDir)) {
    throw new PbiCoreError(`Visual '${visualName}' not found on page '${pageName}'.`);
  }
  rmSync(visualDir, { recursive: true, force: true });
  return { status: 'deleted', name: visualName, page: pageName };
}

export interface VisualSetContainerOptions {
  readonly borderShow?: boolean;
  readonly backgroundShow?: boolean;
  readonly title?: string;
}

/**
 * Set container-chrome props (border, background, title). Operates on
 * `visual.visualContainerObjects` — distinct from `visual.objects` which
 * controls the visual's own internal formatting.
 */
export function visualSetContainer(
  definitionPath: string,
  pageName: string,
  visualName: string,
  opts: VisualSetContainerOptions,
): {
  status: 'updated' | 'no-op';
  visual: string;
  page: string;
  borderShow: boolean | null;
  backgroundShow: boolean | null;
  title: string | null;
} {
  const vfile = path.join(getVisualDir(definitionPath, pageName, visualName), 'visual.json');
  if (!existsSync(vfile)) {
    throw new PbiCoreError(`Visual '${visualName}' not found on page '${pageName}'.`);
  }

  const data = readJson(vfile) as Record<string, unknown>;
  const visual = data.visual as Record<string, unknown> | undefined;
  if (visual === undefined) {
    throw new PbiCoreError(`Visual '${visualName}' has invalid JSON -- missing 'visual' key.`);
  }

  if (
    opts.borderShow === undefined &&
    opts.backgroundShow === undefined &&
    opts.title === undefined
  ) {
    return {
      status: 'no-op',
      visual: visualName,
      page: pageName,
      borderShow: null,
      backgroundShow: null,
      title: null,
    };
  }

  const vco: Record<string, unknown> = {
    ...((visual.visualContainerObjects as Record<string, unknown>) ?? {}),
  };

  const boolEntry = (value: boolean): Array<Record<string, unknown>> => [
    { properties: { show: { expr: { Literal: { Value: value ? 'true' : 'false' } } } } },
  ];

  if (opts.borderShow !== undefined) vco.border = boolEntry(opts.borderShow);
  if (opts.backgroundShow !== undefined) vco.background = boolEntry(opts.backgroundShow);
  if (opts.title !== undefined) {
    vco.title = [{ properties: { text: { expr: { Literal: { Value: `'${opts.title}'` } } } } }];
  }

  const updatedVisual = { ...visual, visualContainerObjects: vco };
  writeJson(vfile, { ...data, visual: updatedVisual });

  return {
    status: 'updated',
    visual: visualName,
    page: pageName,
    borderShow: opts.borderShow ?? null,
    backgroundShow: opts.backgroundShow ?? null,
    title: opts.title ?? null,
  };
}

// -- Internal helpers ------------------------------------------------------

/** Compute next y position to avoid overlap with existing visuals. */
function nextYPosition(definitionPath: string, pageName: string): number {
  const visualsDir = path.join(definitionPath, 'pages', pageName, 'visuals');
  if (!isDirectory(visualsDir)) return 50;

  let maxBottom = 50;
  for (const entry of readdirSync(visualsDir)) {
    const vdir = path.join(visualsDir, entry);
    if (!isDirectory(vdir)) continue;
    const vfile = path.join(vdir, 'visual.json');
    if (!existsSync(vfile)) continue;
    try {
      const data = readJson(vfile) as Record<string, unknown>;
      const pos = (data.position as Record<string, unknown>) ?? {};
      const y = typeof pos.y === 'number' ? pos.y : 0;
      const h = typeof pos.height === 'number' ? pos.height : 0;
      const bottom = y + h;
      if (bottom > maxBottom) maxBottom = bottom;
    } catch {
      // skip malformed files
    }
  }
  return maxBottom + 20;
}

/** Compute next z-order for a new visual. */
function nextZOrder(definitionPath: string, pageName: string): number {
  const visualsDir = path.join(definitionPath, 'pages', pageName, 'visuals');
  if (!isDirectory(visualsDir)) return 0;

  let maxZ = -1;
  for (const entry of readdirSync(visualsDir)) {
    const vdir = path.join(visualsDir, entry);
    if (!isDirectory(vdir)) continue;
    const vfile = path.join(vdir, 'visual.json');
    if (!existsSync(vfile)) continue;
    try {
      const data = readJson(vfile) as Record<string, unknown>;
      const pos = (data.position as Record<string, unknown>) ?? {};
      const z = typeof pos.z === 'number' ? pos.z : 0;
      if (z > maxZ) maxZ = z;
    } catch {
      // skip malformed files
    }
  }
  return maxZ + 1;
}

/** Human-readable summary of a query-state field expression. */
function summarizeField(field: Record<string, unknown>): string {
  for (const kind of ['Column', 'Measure'] as const) {
    const item = field[kind] as Record<string, unknown> | undefined;
    if (item === undefined) continue;
    const expression = (item.Expression as Record<string, unknown>) ?? {};
    const sourceRef = (expression.SourceRef as Record<string, unknown>) ?? {};
    // queryState uses Entity, legacy Commands uses Source.
    const source =
      typeof sourceRef.Entity === 'string'
        ? sourceRef.Entity
        : typeof sourceRef.Source === 'string'
          ? sourceRef.Source
          : '?';
    const prop = typeof item.Property === 'string' ? item.Property : '?';
    return kind === 'Measure' ? `${source}.[${prop}]` : `${source}.${prop}`;
  }
  return JSON.stringify(field);
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
