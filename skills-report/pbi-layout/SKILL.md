---
description: Arrange existing Power BI visuals into grids, rows, or columns. Use when the user mentions arranging visuals, "make a grid", "put these in a row", "stack these vertically", "lay them out", or "tidy up the page". For composing a whole dashboard from scratch, use the `report-builder` agent instead.
allowed-tools: mcp__pbi-report__pbi_layout_grid mcp__pbi-report__pbi_layout_row mcp__pbi-report__pbi_layout_column mcp__pbi-report__pbi_visual_list mcp__pbi-report__pbi_page_get
---

# Power BI Layout Skill

This skill is **geometry-only** — it positions existing visuals. It does not create visuals, bind data, or pick a dashboard composition. For composition, route to the `report-builder` agent.

## Three primitives

| Tool | Use when |
|---|---|
| `pbi_layout_grid` | The user wants N visuals in a `rows × cols` grid (e.g. 2×2 KPI grid, 3×4 small multiples). |
| `pbi_layout_row` | Multiple visuals at the same y, side by side. |
| `pbi_layout_column` | Multiple visuals at the same x, stacked vertically. |

## Workflow for "arrange these visuals"

1. **Find the targets.** Call `pbi_visual_list` for the page to see what's there. The user often names visuals informally ("the KPI cards", "the bar chart") — match by `visualType` or `name` substring.
2. **Pick the right primitive.** Grid for uniform layouts; row/column when alignment matters more than equal sizing.
3. **Compute geometry.** If the user gave dimensions, use them; otherwise call `pbi_page_get` to get the page width/height and lay out the full page minus a small margin (default 16px).
4. **Call the tool.** Pass the visual **names** (not display names). Default gap is 8px.

## Workflow for "scaffold a [pattern] page"

1. **Ensure the page exists.** If not, create with `pbi_page_add`.
2. **Apply the pattern** with `pbi_page_layout_apply({ page, pattern: "overview" | "kpi-grid" | "drill" | "trends" })`.
3. **Bind data afterwards.** The pattern creates EMPTY visuals — they need `pbi_visual_bind` to show data. Use the wrapper model inventory tools (`pbi_model_list_tables`, `pbi_model_list_columns`, and `pbi_model_list_measures`) to discover fields, then bind each created visual.

## Named patterns at a glance

- **overview** — 3 KPI cards across the top, main bar chart (left, 60%) + secondary line chart (right, 40%) in the middle, wide table at the bottom. Good for executive summaries.
- **kpi-grid** — 2×3 grid of 6 KPI cards. Good for metric dashboards.
- **drill** — Slicer (left, 30%) + 2 KPI cards (right) across a header band; wide detail table below. Good for "filter then drill" workflows.
- **trends** — 3 KPI cards across top, full-width line chart in the middle, full-width bar chart at the bottom. Good for time-series storytelling.

## Geometry conventions

- Coordinates are top-left origin, pixels. Page defaults are 1280 × 720.
- Patterns reserve a 16px outer margin and 8px inter-visual gaps.
- All primitives accept explicit `x`/`y`/`width`/`height` to limit the layout area — pass these if the user wants to leave space for other content.

## When NOT to use this skill

- For binding data to visuals → `pbi-visuals` skill.
- For styling (colors, fonts, themes) → `pbi-themes` skill.
- For container chrome (title, border, background) → `pbi_visual_set_container` (in `pbi-visuals`).
- For a single one-off visual at known coordinates → just call `pbi_visual_add` with `x`/`y`/`width`/`height` directly; no need to load this skill.
