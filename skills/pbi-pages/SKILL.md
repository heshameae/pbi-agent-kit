---
description: Manage pages in a Power BI report — list, add, get details, delete, set background colour, hide/show. Use when the user mentions adding a page, deleting a page, listing pages, page background, hiding a page, drillthrough page, page tab. Trigger phrases include "add page", "new tab", "delete page", "list pages", "page background", "hide page", "show page", "make this page hidden".
allowed-tools: mcp__pbi-report__pbi_page_list mcp__pbi-report__pbi_page_get mcp__pbi-report__pbi_page_add mcp__pbi-report__pbi_page_delete mcp__pbi-report__pbi_page_set_background mcp__pbi-report__pbi_page_set_visibility
---

# Power BI Pages Skill

CRUD + display options for pages in a PBIR report.

## Tools

| User says... | Use |
|---|---|
| "List pages" / "what tabs are in this report" | `pbi_page_list` |
| "Add a page called Sales Overview" | `pbi_page_add` with `displayName: "Sales Overview"` |
| "Show the X page" | `pbi_page_get` with `name: <id>` |
| "Delete the Old Detail page" | `pbi_page_delete` |
| "Make the page background light grey" | `pbi_page_set_background` with `color: "#F5F5F5"` |
| "Hide this page" / "make it a drillthrough page" | `pbi_page_set_visibility` with `hidden: true` |

## Page naming

Pages have two names:
- **`name`** — internal id (folder name). Either a 20-char hex id (auto-generated) or a short user-chosen slug ("overview"). Used in `pbi_page_get`, `pbi_page_delete` etc.
- **`displayName`** — human-readable label shown on the page tab in Desktop. Set via `displayName` field.

When the user says "the X page", figure out whether they mean the displayName or the id by checking `pbi_page_list` first.

## Sizes

Default page size is 1280×720. To change: pass `width` + `height` to `pbi_page_add`. Common alternatives:
- 1920×1080 — full HD desktop
- 1280×720 — default web
- 320×640 — phone layout

## Background

`pbi_page_set_background` requires:
- `color` — hex (`#F8F9FA`)
- `transparency` — 0 (opaque) to 100 (fully transparent), default 0

Setting transparency to 100 makes the background invisible regardless of `color`. Always write transparency explicitly — Desktop's default is 100, which is the opposite of what users usually want.

## Visibility

`hidden: true` writes `"visibility": "HiddenInViewMode"` — the page is excluded from the tab bar in view mode but reachable via drillthrough or bookmark navigation. Useful for tooltip pages, drillthrough targets, and parameter pages.
