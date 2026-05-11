// Page CRUD operations.
//
// Ported from pbi-cli's report_backend.py page_* functions (lines 276-481).
// Operates on the `definition/pages/<page>/page.json` files and keeps the
// `pages.json` page-order index in sync.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError } from '../errors.js';
import { generateId, readJson, writeJson } from '../pbir/io.js';
import { getPageDir, getPagesDir } from '../pbir/path.js';
import { SCHEMA_PAGE, SCHEMA_PAGES_METADATA } from '../pbir/schemas.js';

// -- Types -----------------------------------------------------------------

export interface PageListItem {
  readonly name: string;
  readonly displayName: string;
  readonly ordinal: number;
  readonly width: number;
  readonly height: number;
  readonly displayOption: string;
  readonly visualCount: number;
  readonly isHidden: boolean;
  readonly pageType: string;
}

export interface PageAddOptions {
  readonly displayName: string;
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly displayOption?: string;
}

export interface PageAddResult {
  readonly status: 'created';
  readonly name: string;
  readonly displayName: string;
}

export interface PageDetail extends PageListItem {
  readonly filterConfig: unknown;
  readonly visualInteractions: unknown;
  readonly pageBinding: unknown;
}

// -- Operations ------------------------------------------------------------

/** List all pages in the report, sorted by pages.json pageOrder if present. */
export function pageList(definitionPath: string): PageListItem[] {
  const pagesDir = path.join(definitionPath, 'pages');
  if (!isDirectory(pagesDir)) return [];

  // Read explicit page order if available.
  let pageOrder: string[] = [];
  const pagesMeta = path.join(pagesDir, 'pages.json');
  if (existsSync(pagesMeta)) {
    const meta = readJson(pagesMeta) as Record<string, unknown>;
    if (Array.isArray(meta.pageOrder)) pageOrder = meta.pageOrder as string[];
  }

  const results: PageListItem[] = [];
  for (const entry of readdirSync(pagesDir).sort()) {
    const pageDir = path.join(pagesDir, entry);
    if (!isDirectory(pageDir)) continue;
    const pageJson = path.join(pageDir, 'page.json');
    if (!existsSync(pageJson)) continue;

    const data = readJson(pageJson) as Record<string, unknown>;
    let visualCount = 0;
    const visualsDir = path.join(pageDir, 'visuals');
    if (isDirectory(visualsDir)) {
      for (const v of readdirSync(visualsDir)) {
        const vd = path.join(visualsDir, v);
        if (isDirectory(vd) && existsSync(path.join(vd, 'visual.json'))) {
          visualCount++;
        }
      }
    }

    results.push({
      name: typeof data.name === 'string' ? data.name : entry,
      displayName: typeof data.displayName === 'string' ? data.displayName : '',
      ordinal: typeof data.ordinal === 'number' ? data.ordinal : 0,
      width: typeof data.width === 'number' ? data.width : 1280,
      height: typeof data.height === 'number' ? data.height : 720,
      displayOption: typeof data.displayOption === 'string' ? data.displayOption : 'FitToPage',
      visualCount,
      isHidden: data.visibility === 'HiddenInViewMode',
      pageType: typeof data.type === 'string' ? data.type : 'Default',
    });
  }

  // Sort: pageOrder takes precedence, fallback to ordinal field.
  if (pageOrder.length > 0) {
    const orderMap = new Map(pageOrder.map((n, i) => [n, i]));
    results.sort((a, b) => (orderMap.get(a.name) ?? 9999) - (orderMap.get(b.name) ?? 9999));
  } else {
    results.sort((a, b) => a.ordinal - b.ordinal);
  }
  return results;
}

/** Add a new page. Generates an ID if `name` not provided. */
export function pageAdd(definitionPath: string, opts: PageAddOptions): PageAddResult {
  const pageName = opts.name ?? generateId();
  const pagesDir = getPagesDir(definitionPath);
  const pageDir = path.join(pagesDir, pageName);

  if (existsSync(pageDir)) {
    throw new PbiCoreError(`Page '${pageName}' already exists.`);
  }

  mkdirSync(path.join(pageDir, 'visuals'), { recursive: true });

  // No ordinal field — pages.json:pageOrder is the source of truth.
  writeJson(path.join(pageDir, 'page.json'), {
    $schema: SCHEMA_PAGE,
    name: pageName,
    displayName: opts.displayName,
    displayOption: opts.displayOption ?? 'FitToPage',
    height: opts.height ?? 720,
    width: opts.width ?? 1280,
  });

  updatePageOrder(definitionPath, pageName, 'add');

  return {
    status: 'created',
    name: pageName,
    displayName: opts.displayName,
  };
}

/** Delete a page and all its visuals. */
export function pageDelete(
  definitionPath: string,
  pageName: string,
): { status: 'deleted'; name: string } {
  const pageDir = getPageDir(definitionPath, pageName);
  if (!existsSync(pageDir)) {
    throw new PbiCoreError(`Page '${pageName}' not found.`);
  }
  rmSync(pageDir, { recursive: true, force: true });
  updatePageOrder(definitionPath, pageName, 'remove');
  return { status: 'deleted', name: pageName };
}

/** Get full details for a single page including filter/binding configs. */
export function pageGet(definitionPath: string, pageName: string): PageDetail {
  const pageDir = getPageDir(definitionPath, pageName);
  const pageJson = path.join(pageDir, 'page.json');
  if (!existsSync(pageJson)) {
    throw new PbiCoreError(`Page '${pageName}' not found.`);
  }
  const data = readJson(pageJson) as Record<string, unknown>;

  let visualCount = 0;
  const visualsDir = path.join(pageDir, 'visuals');
  if (isDirectory(visualsDir)) {
    for (const v of readdirSync(visualsDir)) {
      const vd = path.join(visualsDir, v);
      if (isDirectory(vd) && existsSync(path.join(vd, 'visual.json'))) {
        visualCount++;
      }
    }
  }

  return {
    name: typeof data.name === 'string' ? data.name : pageName,
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    ordinal: typeof data.ordinal === 'number' ? data.ordinal : 0,
    width: typeof data.width === 'number' ? data.width : 1280,
    height: typeof data.height === 'number' ? data.height : 720,
    displayOption: typeof data.displayOption === 'string' ? data.displayOption : 'FitToPage',
    visualCount,
    isHidden: data.visibility === 'HiddenInViewMode',
    pageType: typeof data.type === 'string' ? data.type : 'Default',
    filterConfig: data.filterConfig,
    visualInteractions: data.visualInteractions,
    pageBinding: data.pageBinding,
  };
}

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/;

/**
 * Set the background color of a page. `color` must be hex (`#F8F9FA`).
 * `transparency` is 0 (opaque) to 100 (fully transparent). Always written
 * explicitly — Desktop defaults missing transparency to invisible.
 */
export function pageSetBackground(
  definitionPath: string,
  pageName: string,
  color: string,
  transparency = 0,
): { status: 'updated'; page: string; backgroundColor: string; transparency: number } {
  if (!HEX_COLOR_RE.test(color)) {
    throw new PbiCoreError(`Invalid color '${color}' -- expected hex format like '#F8F9FA'.`);
  }
  if (transparency < 0 || transparency > 100) {
    throw new PbiCoreError(`Invalid transparency '${transparency}' -- must be 0-100.`);
  }

  const pageDir = getPageDir(definitionPath, pageName);
  const pageJsonPath = path.join(pageDir, 'page.json');
  if (!existsSync(pageJsonPath)) {
    throw new PbiCoreError(`Page '${pageName}' not found.`);
  }

  const pageData = readJson(pageJsonPath) as Record<string, unknown>;
  const backgroundEntry = {
    properties: {
      color: { solid: { color: { expr: { Literal: { Value: `'${color}'` } } } } },
      transparency: { expr: { Literal: { Value: `${transparency}D` } } },
    },
  };
  const existingObjects = (pageData.objects as Record<string, unknown>) ?? {};
  const objects = { ...existingObjects, background: [backgroundEntry] };
  writeJson(pageJsonPath, { ...pageData, objects });

  return {
    status: 'updated',
    page: pageName,
    backgroundColor: color,
    transparency,
  };
}

/** Show or hide a page in the report navigation. */
export function pageSetVisibility(
  definitionPath: string,
  pageName: string,
  hidden: boolean,
): { status: 'updated'; page: string; hidden: boolean } {
  const pageDir = getPageDir(definitionPath, pageName);
  const pageJsonPath = path.join(pageDir, 'page.json');
  if (!existsSync(pageJsonPath)) {
    throw new PbiCoreError(`Page '${pageName}' not found.`);
  }

  const pageData = readJson(pageJsonPath) as Record<string, unknown>;
  if (hidden) {
    writeJson(pageJsonPath, { ...pageData, visibility: 'HiddenInViewMode' });
  } else {
    const { visibility: _, ...rest } = pageData;
    void _;
    writeJson(pageJsonPath, rest);
  }
  return { status: 'updated', page: pageName, hidden };
}

// -- Helpers ---------------------------------------------------------------

/** Update pages.json:pageOrder + activePageName after add/remove. */
function updatePageOrder(definitionPath: string, pageName: string, action: 'add' | 'remove'): void {
  const pagesMetaPath = path.join(definitionPath, 'pages', 'pages.json');
  let meta: Record<string, unknown>;
  if (existsSync(pagesMetaPath)) {
    meta = readJson(pagesMetaPath) as Record<string, unknown>;
  } else {
    meta = { $schema: SCHEMA_PAGES_METADATA };
  }

  let order = Array.isArray(meta.pageOrder) ? (meta.pageOrder as string[]) : [];
  if (action === 'add' && !order.includes(pageName)) {
    order = [...order, pageName];
  } else if (action === 'remove' && order.includes(pageName)) {
    order = order.filter((p) => p !== pageName);
  }
  meta.pageOrder = order;

  // Desktop requires activePageName when there's at least one page.
  if (order.length > 0) {
    const current = typeof meta.activePageName === 'string' ? meta.activePageName : '';
    if (!current || !order.includes(current)) {
      meta.activePageName = order[0];
    }
  } else if ('activePageName' in meta) {
    meta.activePageName = undefined;
  }

  writeJson(pagesMetaPath, meta);
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
