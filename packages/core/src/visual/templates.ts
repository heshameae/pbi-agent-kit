// Visual template loader.
//
// Templates ship in src/visual/templates/<type>.json as text files containing
// placeholders (__VISUAL_NAME__, __X__, __Y__, __WIDTH__, __HEIGHT__, __Z__,
// __TAB_ORDER__). They are NOT valid JSON until filled — load as text, replace
// placeholders, then parse.
//
// Build copies src/visual/templates/ → dist/visual/templates/ so loading works
// from the compiled output too (see scripts/copy-templates.mjs).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VisualType } from '../pbir/schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, 'templates');

const RAW_CACHE = new Map<VisualType, string>();

/** Read the raw template text for a visual type (with placeholders intact). */
export function loadTemplateRaw(type: VisualType): string {
  const cached = RAW_CACHE.get(type);
  if (cached !== undefined) return cached;
  const filePath = path.join(TEMPLATES_DIR, `${type}.json`);
  const content = readFileSync(filePath, 'utf-8');
  RAW_CACHE.set(type, content);
  return content;
}

export interface TemplatePlaceholders {
  visualName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z?: number;
  tabOrder?: number;
}

/**
 * Fill template placeholders and parse the result as JSON.
 *
 * Mirrors pbi-cli's `_build_visual_json` (visual_backend.py:196). Position
 * numbers are floored to integers — Power BI Desktop rejects non-integer
 * pixel positions in some visual schemas.
 */
export function fillTemplate(type: VisualType, p: TemplatePlaceholders): unknown {
  const raw = loadTemplateRaw(type);
  const filled = raw
    .replaceAll('__VISUAL_NAME__', p.visualName)
    .replaceAll('__X__', String(Math.floor(p.x)))
    .replaceAll('__Y__', String(Math.floor(p.y)))
    .replaceAll('__WIDTH__', String(Math.floor(p.width)))
    .replaceAll('__HEIGHT__', String(Math.floor(p.height)))
    .replaceAll('__Z__', String(p.z ?? 0))
    .replaceAll('__TAB_ORDER__', String(p.tabOrder ?? 0));
  return JSON.parse(filled);
}
