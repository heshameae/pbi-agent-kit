// Report metadata summary.
//
// Ported from pbi-cli's report_backend.py `report_info` (lines 59-97).

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { readJson } from '../pbir/io.js';

export interface ReportInfoPage {
  readonly name: string;
  readonly displayName: string;
  readonly ordinal: number;
  readonly visualCount: number;
}

export interface ReportInfo {
  readonly pageCount: number;
  readonly theme: string;
  readonly pages: readonly ReportInfoPage[];
  readonly totalVisuals: number;
  readonly path: string;
}

/**
 * Return a summary of a PBIR report: page count, theme, per-page visual
 * counts, and the resolved definition path.
 */
export function reportInfo(definitionPath: string): ReportInfo {
  const reportData = readJson(path.join(definitionPath, 'report.json')) as Record<string, unknown>;
  const pagesDir = path.join(definitionPath, 'pages');

  const pages: ReportInfoPage[] = [];
  if (isDirectory(pagesDir)) {
    for (const entry of readdirSync(pagesDir).sort()) {
      const pageDir = path.join(pagesDir, entry);
      if (!isDirectory(pageDir)) continue;
      const pageJson = path.join(pageDir, 'page.json');
      if (!existsSync(pageJson)) continue;

      const pageData = readJson(pageJson) as Record<string, unknown>;
      const visualsDir = path.join(pageDir, 'visuals');
      let visualCount = 0;
      if (isDirectory(visualsDir)) {
        for (const v of readdirSync(visualsDir)) {
          const vDir = path.join(visualsDir, v);
          if (isDirectory(vDir) && existsSync(path.join(vDir, 'visual.json'))) {
            visualCount++;
          }
        }
      }
      pages.push({
        name: typeof pageData.name === 'string' ? pageData.name : entry,
        displayName: typeof pageData.displayName === 'string' ? pageData.displayName : '',
        ordinal: typeof pageData.ordinal === 'number' ? pageData.ordinal : 0,
        visualCount,
      });
    }
  }

  const themeCollection = (reportData.themeCollection as Record<string, unknown>) ?? {};
  const baseTheme = (themeCollection.baseTheme as Record<string, unknown>) ?? {};
  const theme = typeof baseTheme.name === 'string' ? baseTheme.name : 'Default';

  return {
    pageCount: pages.length,
    theme,
    pages,
    totalVisuals: pages.reduce((sum, p) => sum + p.visualCount, 0),
    path: definitionPath,
  };
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
