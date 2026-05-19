// Layout primitives — geometry-only operations that reposition existing
// visuals into rows / columns / grids on a page.
//
// All primitives are pure positioners: they update `position.{x,y,width,height}`
// on visuals that ALREADY exist. They never create visuals or bind data.
// To create + position in one step, use `pageLayoutApply` (patterns.ts).
//
// Coordinate system (Power BI PBIR):
//   Origin (0,0) is top-left of the page.
//   x increases rightward, y increases downward.
//   Default page size is 1280 × 720 unless overridden.

import { PbiCoreError } from '../errors.js';
import { pageGet } from '../report/pages.js';
import { visualGet, visualUpdate } from '../visual/backend.js';

export interface LayoutResult {
  readonly status: 'laid-out';
  readonly page: string;
  readonly count: number;
  readonly placements: ReadonlyArray<{
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
}

export interface LayoutGridOptions {
  readonly visuals: readonly string[];
  readonly rows: number;
  readonly cols: number;
  /** Top-left of the grid area. Defaults to (0, 0). */
  readonly x?: number;
  readonly y?: number;
  /** Total grid area dimensions. Defaults to page width/height minus margins. */
  readonly width?: number;
  readonly height?: number;
  /** Gap between cells in pixels. Defaults to 8. */
  readonly gap?: number;
}

/**
 * Arrange `visuals` into a `rows × cols` grid. Visuals fill row-major
 * (left-to-right, top-to-bottom). If `visuals.length < rows*cols`, trailing
 * cells stay empty; if `>`, excess visuals are silently ignored.
 */
export function layoutGrid(
  definitionPath: string,
  pageName: string,
  opts: LayoutGridOptions,
): LayoutResult {
  if (opts.rows < 1 || opts.cols < 1) {
    throw new PbiCoreError('rows and cols must be >= 1.');
  }
  if (opts.visuals.length === 0) {
    return { status: 'laid-out', page: pageName, count: 0, placements: [] };
  }

  const page = pageGet(definitionPath, pageName);
  const gap = opts.gap ?? 8;
  const areaX = opts.x ?? 0;
  const areaY = opts.y ?? 0;
  const areaW = opts.width ?? page.width - areaX;
  const areaH = opts.height ?? page.height - areaY;

  const cellW = Math.floor((areaW - gap * (opts.cols - 1)) / opts.cols);
  const cellH = Math.floor((areaH - gap * (opts.rows - 1)) / opts.rows);
  if (cellW < 1 || cellH < 1) {
    throw new PbiCoreError(
      `Grid cells would be smaller than 1px (${cellW}x${cellH}). Reduce rows/cols or increase area.`,
    );
  }

  const placements: Array<{ name: string; x: number; y: number; width: number; height: number }> =
    [];
  const slots = Math.min(opts.visuals.length, opts.rows * opts.cols);

  for (let i = 0; i < slots; i++) {
    const visualName = opts.visuals[i] as string;
    const row = Math.floor(i / opts.cols);
    const col = i % opts.cols;
    const x = areaX + col * (cellW + gap);
    const y = areaY + row * (cellH + gap);
    visualUpdate(definitionPath, pageName, visualName, {
      x,
      y,
      width: cellW,
      height: cellH,
    });
    placements.push({ name: visualName, x, y, width: cellW, height: cellH });
  }

  return { status: 'laid-out', page: pageName, count: slots, placements };
}

export interface LayoutRowOptions {
  readonly visuals: readonly string[];
  /** Top edge of the row. Defaults to 0. */
  readonly y?: number;
  /** Row height. Defaults to existing visual heights (each keeps its own). */
  readonly height?: number;
  /** Left edge of the row. Defaults to 0. */
  readonly x?: number;
  /** Total row width. Defaults to page width minus x. */
  readonly width?: number;
  /** Gap between visuals in pixels. Defaults to 8. */
  readonly gap?: number;
}

/**
 * Arrange `visuals` horizontally in a row. Each visual gets equal width.
 * If `height` is provided, all visuals get that height; otherwise each keeps its current.
 */
export function layoutRow(
  definitionPath: string,
  pageName: string,
  opts: LayoutRowOptions,
): LayoutResult {
  if (opts.visuals.length === 0) {
    return { status: 'laid-out', page: pageName, count: 0, placements: [] };
  }

  const page = pageGet(definitionPath, pageName);
  const gap = opts.gap ?? 8;
  const rowX = opts.x ?? 0;
  const rowY = opts.y ?? 0;
  const rowW = opts.width ?? page.width - rowX;

  const cellW = Math.floor((rowW - gap * (opts.visuals.length - 1)) / opts.visuals.length);
  if (cellW < 1) {
    throw new PbiCoreError(`Row cells would be smaller than 1px (${cellW}). Reduce visual count.`);
  }

  const placements: Array<{ name: string; x: number; y: number; width: number; height: number }> =
    [];
  for (let i = 0; i < opts.visuals.length; i++) {
    const visualName = opts.visuals[i] as string;
    const x = rowX + i * (cellW + gap);
    const detail =
      opts.height === undefined ? visualGet(definitionPath, pageName, visualName) : null;
    const h = opts.height ?? detail?.height ?? 100;
    visualUpdate(definitionPath, pageName, visualName, {
      x,
      y: rowY,
      width: cellW,
      height: h,
    });
    placements.push({ name: visualName, x, y: rowY, width: cellW, height: h });
  }

  return { status: 'laid-out', page: pageName, count: opts.visuals.length, placements };
}

export interface LayoutColumnOptions {
  readonly visuals: readonly string[];
  /** Left edge of the column. Defaults to 0. */
  readonly x?: number;
  /** Column width. Defaults to existing visual widths. */
  readonly width?: number;
  /** Top edge of the column. Defaults to 0. */
  readonly y?: number;
  /** Total column height. Defaults to page height minus y. */
  readonly height?: number;
  /** Gap between visuals in pixels. Defaults to 8. */
  readonly gap?: number;
}

/**
 * Arrange `visuals` vertically in a column. Each visual gets equal height.
 * If `width` is provided, all visuals get that width; otherwise each keeps its current.
 */
export function layoutColumn(
  definitionPath: string,
  pageName: string,
  opts: LayoutColumnOptions,
): LayoutResult {
  if (opts.visuals.length === 0) {
    return { status: 'laid-out', page: pageName, count: 0, placements: [] };
  }

  const page = pageGet(definitionPath, pageName);
  const gap = opts.gap ?? 8;
  const colX = opts.x ?? 0;
  const colY = opts.y ?? 0;
  const colH = opts.height ?? page.height - colY;

  const cellH = Math.floor((colH - gap * (opts.visuals.length - 1)) / opts.visuals.length);
  if (cellH < 1) {
    throw new PbiCoreError(
      `Column cells would be smaller than 1px (${cellH}). Reduce visual count.`,
    );
  }

  const placements: Array<{ name: string; x: number; y: number; width: number; height: number }> =
    [];
  for (let i = 0; i < opts.visuals.length; i++) {
    const visualName = opts.visuals[i] as string;
    const y = colY + i * (cellH + gap);
    const detail =
      opts.width === undefined ? visualGet(definitionPath, pageName, visualName) : null;
    const w = opts.width ?? detail?.width ?? 100;
    visualUpdate(definitionPath, pageName, visualName, {
      x: colX,
      y,
      width: w,
      height: cellH,
    });
    placements.push({ name: visualName, x: colX, y, width: w, height: cellH });
  }

  return { status: 'laid-out', page: pageName, count: opts.visuals.length, placements };
}
