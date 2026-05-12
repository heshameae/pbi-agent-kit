// Bookmarks — saved report views (active page + filter state + visibility).
//
// Ported from pbi-cli's core/bookmark_backend.py. Bookmarks live under
// `definition/bookmarks/` with two parts:
//   - `bookmarks/bookmarks.json` — the index listing all bookmarks
//   - `bookmarks/<name>.bookmark.json` — one file per bookmark with the
//     full explorationState
//
// Critical empirical detail: visibility inside a bookmark is signalled by
// the PRESENCE of `singleVisual.display = { mode: "hidden" }`. Showing a
// visual = REMOVING the `display` key, not setting it to a "visible" mode.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError } from '../errors.js';
import { generateId, readJson, writeJson } from '../pbir/io.js';
import { SCHEMA_BOOKMARK, SCHEMA_BOOKMARKS_METADATA } from '../pbir/schemas.js';

// -- Types -----------------------------------------------------------------

export interface BookmarkListItem {
  readonly name: string;
  readonly displayName: string;
  readonly activeSection: string | undefined;
}

export interface BookmarkAddResult {
  readonly status: 'created';
  readonly name: string;
  readonly displayName: string;
  readonly targetPage: string;
}

// -- Path helpers ----------------------------------------------------------

function bookmarksDir(definitionPath: string): string {
  return path.join(definitionPath, 'bookmarks');
}
function indexPath(definitionPath: string): string {
  return path.join(bookmarksDir(definitionPath), 'bookmarks.json');
}
function bookmarkPath(definitionPath: string, name: string): string {
  return path.join(bookmarksDir(definitionPath), `${name}.bookmark.json`);
}

// -- Operations ------------------------------------------------------------

/** List all bookmarks (returns empty array if no bookmarks folder/index). */
export function bookmarkList(definitionPath: string): BookmarkListItem[] {
  const idx = indexPath(definitionPath);
  if (!existsSync(idx)) return [];

  const index = readJson(idx) as Record<string, unknown>;
  const items = Array.isArray(index.items) ? index.items : [];

  const results: BookmarkListItem[] = [];
  for (const itemRaw of items) {
    const item = itemRaw as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name : '';
    if (!name) continue;
    const bmFile = bookmarkPath(definitionPath, name);
    if (!existsSync(bmFile)) continue;

    const bm = readJson(bmFile) as Record<string, unknown>;
    const exploration = (bm.explorationState as Record<string, unknown>) ?? {};
    results.push({
      name,
      displayName: typeof bm.displayName === 'string' ? bm.displayName : '',
      activeSection:
        typeof exploration.activeSection === 'string' ? exploration.activeSection : undefined,
    });
  }
  return results;
}

/** Get the full JSON for a bookmark by name. */
export function bookmarkGet(definitionPath: string, name: string): Record<string, unknown> {
  const bmFile = bookmarkPath(definitionPath, name);
  if (!existsSync(bmFile)) {
    throw new PbiCoreError(`Bookmark '${name}' not found.`);
  }
  return readJson(bmFile) as Record<string, unknown>;
}

/** Create a new bookmark pointing at `targetPage` (page name id). */
export function bookmarkAdd(
  definitionPath: string,
  displayName: string,
  targetPage: string,
  name?: string,
): BookmarkAddResult {
  const bmName = name ?? generateId();
  mkdirSync(bookmarksDir(definitionPath), { recursive: true });

  const idx = indexPath(definitionPath);
  const index = existsSync(idx)
    ? (readJson(idx) as Record<string, unknown>)
    : { $schema: SCHEMA_BOOKMARKS_METADATA, items: [] };

  const items = Array.isArray(index.items) ? [...(index.items as unknown[])] : [];
  items.push({ name: bmName });
  index.items = items;
  writeJson(idx, index);

  writeJson(bookmarkPath(definitionPath, bmName), {
    $schema: SCHEMA_BOOKMARK,
    displayName,
    name: bmName,
    options: { targetVisualNames: [] },
    explorationState: {
      version: '1.3',
      activeSection: targetPage,
    },
  });

  return { status: 'created', name: bmName, displayName, targetPage };
}

/** Delete a bookmark and remove it from the index. */
export function bookmarkDelete(
  definitionPath: string,
  name: string,
): { status: 'deleted'; name: string } {
  const idx = indexPath(definitionPath);
  if (!existsSync(idx)) {
    throw new PbiCoreError(`Bookmark '${name}' not found.`);
  }
  const index = readJson(idx) as Record<string, unknown>;
  const items = Array.isArray(index.items) ? (index.items as Record<string, unknown>[]) : [];
  if (!items.some((i) => i.name === name)) {
    throw new PbiCoreError(`Bookmark '${name}' not found.`);
  }

  const bmFile = bookmarkPath(definitionPath, name);
  if (existsSync(bmFile)) rmSync(bmFile, { force: true });

  index.items = items.filter((i) => i.name !== name);
  writeJson(idx, index);
  return { status: 'deleted', name };
}

/**
 * Set visibility of a specific visual inside a bookmark's explorationState.
 *
 * `hidden = true` writes `singleVisual.display = { mode: "hidden" }`.
 * `hidden = false` REMOVES the `display` key (presence of `display` is what
 * hides; absence = visible).
 *
 * Creates the
 *   explorationState.sections[page].visualContainers[visual]
 * path on demand if missing.
 */
export function bookmarkSetVisibility(
  definitionPath: string,
  name: string,
  pageName: string,
  visualName: string,
  hidden: boolean,
): {
  status: 'updated';
  bookmark: string;
  page: string;
  visual: string;
  hidden: boolean;
} {
  const bmFile = bookmarkPath(definitionPath, name);
  if (!existsSync(bmFile)) {
    throw new PbiCoreError(`Bookmark '${name}' not found.`);
  }
  const bm = readJson(bmFile) as Record<string, unknown>;

  const exploration: Record<string, unknown> = {
    ...((bm.explorationState as Record<string, unknown>) ?? {}),
  };
  const sections: Record<string, unknown> = {
    ...((exploration.sections as Record<string, unknown>) ?? {}),
  };
  const pageSection: Record<string, unknown> = {
    ...((sections[pageName] as Record<string, unknown>) ?? {}),
  };
  const visualContainers: Record<string, unknown> = {
    ...((pageSection.visualContainers as Record<string, unknown>) ?? {}),
  };
  const container: Record<string, unknown> = {
    ...((visualContainers[visualName] as Record<string, unknown>) ?? {}),
  };
  const singleVisual: Record<string, unknown> = {
    ...((container.singleVisual as Record<string, unknown>) ?? {}),
  };

  if (hidden) {
    singleVisual.display = { mode: 'hidden' };
  } else {
    singleVisual.display = undefined;
  }

  container.singleVisual = singleVisual;
  visualContainers[visualName] = container;
  pageSection.visualContainers = visualContainers;
  sections[pageName] = pageSection;
  exploration.sections = sections;
  bm.explorationState = exploration;

  writeJson(bmFile, bm);

  return {
    status: 'updated',
    bookmark: name,
    page: pageName,
    visual: visualName,
    hidden,
  };
}
