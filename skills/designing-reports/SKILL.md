---
name: designing-reports
description: "Use when designing or laying out a Power BI report page — placing visuals on the canvas, the 3-30-300 detail gradient, page margins/gaps/grid arithmetic, choosing chart types, KPI card design with targets and gaps, display-unit selection, authoring or auditing theme JSON, the 4-level formatting cascade, sentiment colors, and table/matrix formatting"
user-invocable: false
---

# Designing Reports

Report-design knowledge base for Power BI report pages: canvas layout, the detail gradient, visual selection, KPI cards, theme cascade, and formatting. This skill governs how a page looks and reads — not the semantic model behind it.

## When to Use

- Before placing, sizing, or repositioning any visual on a report page
- When deciding which visual type answers the reader's question
- When designing KPI cards (targets, gaps, trends, display units)
- When authoring, modifying, or auditing a report theme JSON
- When formatting tables, matrices, or applying conditional formatting
- When matching a report to an audience or brand style

## When NOT to Use

- Authoring TMDL, measures, or relationships → load `modeling-semantic-model`
- DAX performance / measure logic → load `authoring-measures`
- Running or interpreting report quality checks → load `reviewing-reports`
- Power Query M transformations → load the `power-query` skill

## Quick Reference

| Topic | Reference |
|---|---|
| 3-30-300 detail gradient, zone bands, page/visual sizes, margin+gap arithmetic, column-alignment, page hygiene, default layout templates, time-granularity inference | `references/layout-grid.md` |
| Choosing a visual type by the reader's question, when native visuals fall short | `references/chart-selection.md` |
| Table and matrix formatting, column headers, banding, grid lines, totals | `references/tables.md` |
| KPI card doctrine (target + gap + trend), display-unit selection, target-source DAX, `kpi`/`card` visual.json shapes, CF thresholds | `references/kpi-cards.md` |
| 4-level formatting cascade, top-level theme keys, textClasses, sentiment colors, compliance audit, container-name gotchas | `references/theme-cascade.md` |
| Matching colors, typography, and density to the audience and brand | `references/audience-styles.md` |
| Page titles — textbox `paragraphs`/`textRuns` JSON, multi-run/multi-paragraph formatting, dynamic titles via DAX (`SELECTEDVALUE`, last-refresh), full-width title-bar spec, title positioning/sizing | `references/page-titles.md` |

## Critical Rules (no exceptions)

- **3-30-300 detail gradient** — most important / least detailed at top-left (KPIs, cards), least important / most detailed at bottom-right (tables) → `references/layout-grid.md`
- **Equal spacing is mandatory** — every gap between adjacent visuals and every page margin must be the same value; calculate positions arithmetically from (margin, gap, page width) → `references/layout-grid.md`
- **Query page dimensions first** — never assume 1280×720; set `width`/`height` before `x`/`y` to avoid intermediate out-of-bounds states → `references/layout-grid.md`
- **Every page needs a title** — use a `textbox` visual (or a title in the page background)
- **Max 2-3 slicers per page** — use the filter pane for the rest
- **≤12-15 visuals per page** — textboxes, images, shapes, and buttons don't count toward the limit
- **Push formatting up the cascade** — global style → theme; visual.json holds only field bindings, position, and conditional formatting → `references/theme-cascade.md`
- **Never read a full theme JSON** — files run 75KB+/2000+ lines; use serialize/build or targeted `jq` → `references/theme-cascade.md`
- **Every KPI needs a target and a gap** — a bare number cannot be judged good or bad; color the gap, not the value → `references/kpi-cards.md`
- **Sentiment colors via theme tokens** — conditional formatting returns `"good"`/`"bad"`/`"neutral"`, never hardcoded hex; prefer accessible blue/orange over red/green and always pair color with a secondary cue → `references/theme-cascade.md`
- **Prefer Segoe UI / Segoe UI Semibold** — custom fonts are not guaranteed to render on consumers' machines
