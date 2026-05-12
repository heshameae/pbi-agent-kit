---
description: Create, list, delete, and configure bookmarks in Power BI reports. Bookmarks save a report view (active page + visual visibility). Use when the user mentions a bookmark, "save the current view", "navigate to this state", "hide visual in bookmark", or wants to toggle visual visibility per bookmark.
allowed-tools: mcp__pbi-report__pbi_bookmark_list mcp__pbi-report__pbi_bookmark_get mcp__pbi-report__pbi_bookmark_add mcp__pbi-report__pbi_bookmark_delete mcp__pbi-report__pbi_bookmark_set_visibility
---

# Power BI Bookmarks Skill

Bookmarks live in `definition/bookmarks/`:
- `bookmarks.json` — index listing all bookmarks
- `<name>.bookmark.json` — one file per bookmark (full explorationState)

## Add a bookmark

"Create a bookmark for the Q4 view targeting the overview page":
```
pbi_bookmark_add(displayName: "Q4 View", targetPage: <pageId>)
```

The returned `name` is the bookmark id (auto-generated 20-char hex unless `name:` is provided).

## Toggle visual visibility

A bookmark can hide specific visuals when applied:
```
pbi_bookmark_set_visibility(name: <bookmarkId>, page: <pageId>,
  visual: <visualId>, hidden: true)
```

Empirical detail: hiding a visual in a bookmark means writing `singleVisual.display = { mode: "hidden" }` into the bookmark's explorationState. Showing a visual REMOVES the `display` key entirely — there is no explicit "visible" mode.

## List / get / delete

- `pbi_bookmark_list` — all bookmarks with displayName and target page
- `pbi_bookmark_get(name)` — full JSON for one bookmark
- `pbi_bookmark_delete(name)` — remove file + index entry

## What bookmarks don't include (yet)

The bookmark created here is a minimal stub — it captures the active page but not filter state or scroll position. Power BI Desktop will augment the bookmark with full state when the user touches it interactively.

For programmatic state capture (filter values, sorts, slicer selections), the report must already be open in Desktop and the user must save through Desktop — we don't have a way to capture that from disk alone.
