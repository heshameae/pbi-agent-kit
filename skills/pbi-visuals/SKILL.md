---
description: Add, configure, bind data to, and manage visuals (charts, cards, tables, slicers, etc.) on Power BI report pages. Use whenever the user mentions adding a chart, bar chart, line chart, card, KPI, gauge, scatter, table visual, matrix, slicer, combo chart, binding data, resizing visuals, hiding a visual, or visual calculations. Supports all 32 PBIR visual types.
allowed-tools: mcp__pbi-report__pbi_visual_list mcp__pbi-report__pbi_visual_get mcp__pbi-report__pbi_visual_add mcp__pbi-report__pbi_visual_update mcp__pbi-report__pbi_visual_delete mcp__pbi-report__pbi_visual_set_container mcp__pbi-report__pbi_visual_bind mcp__pbi-report__pbi_visual_calc_add mcp__pbi-report__pbi_visual_calc_list mcp__pbi-report__pbi_visual_calc_delete
---

# Power BI Visuals Skill

The biggest surface in the plugin. Covers adding visuals, binding data, container chrome, and visual calculations.

## Common workflows

### "Add a bar chart of revenue by region"

Two-step sequence — always.

1. **Add the visual** (empty placeholder):
   ```
   pbi_visual_add(page: <pageId>, visualType: "bar")
   ```
2. **Bind data**:
   ```
   pbi_visual_bind(page: <pageId>, name: <visualId>, bindings: [
     { role: "Category", field: "Geography[Region]" },
     { role: "Y",        field: "Sales[Revenue]"   },
   ])
   ```

Without step 2, the visual appears in Desktop as an empty placeholder.

### "Add a card showing total revenue"

```
pbi_visual_add(page, visualType: "card")  → name=<id>
pbi_visual_bind(page, name, bindings: [
  { role: "Values", field: "Sales[Revenue]" }
])
```

## Visual type aliases

The `visualType` field accepts canonical names OR friendly aliases:

| Alias | Canonical |
|---|---|
| `bar`, `bar_chart` | `barChart` |
| `line` | `lineChart` |
| `card` | `card` |
| `table` | `tableEx` |
| `matrix` | `pivotTable` |
| `slicer` | `slicer` |
| `pie`, `donut` | `donutChart` |
| `combo` | `lineStackedColumnComboChart` |
| `kpi` | `kpi` |
| `gauge` | `gauge` |
| `scatter` | `scatterChart` |
| `map` | `azureMap` |

All 32 PBIR types are supported — see the full list in `pbir/schemas.ts:SUPPORTED_VISUAL_TYPES`.

## Field references

Format: `Table[Column]` — single brackets, table name on the left, column/measure name on the right.

- `Sales[Revenue]` ← measure or column on Sales
- `Geography[Region]` ← column on Geography
- `Sample - Superstore_Orders[Sales]` ← table names with spaces/dashes are fine

## Roles and Measure-vs-Column

Each visual type has a set of roles (Category, Y, Legend, Values, Rows, Columns, etc.). Use **canonical role names** when known, or these **friendly aliases**:

| Alias | Resolves to (depends on visual) |
|---|---|
| `category` | `Category` |
| `value` | `Y` (bar/line) or `Values` (card/table) or `Indicator` (kpi) |
| `legend` | `Legend` |
| `row` | `Rows` (matrix) |
| `column` | `Columns` (matrix) |
| `field` | `Values` or `Fields` (card variants) |

**Measure vs Column inference:** `Y`, `Values`, `Fields`, `Indicator`, `Goal`, `Size`, `MaxValue`, `Data`, `X`, `ColumnY`, `LineY` → treated as Measures. Others → Columns. Pass `measure: true` on the binding to force.

## Container chrome

`pbi_visual_set_container` controls border, background, and title (separate from the visual's own data styling):

```
pbi_visual_set_container(page, name, {
  title: "Revenue by Region",
  borderShow: true,
  backgroundShow: false
})
```

## Visual calculations

DAX expressions that run inside a visual's scope (rolling totals, % of total, etc.):

```
pbi_visual_calc_add(page, name, calcName: "RunningTotal", expression: "RUNNINGSUM([Revenue])")
pbi_visual_calc_list(page, name)
pbi_visual_calc_delete(page, name, calcName: "RunningTotal")
```

Idempotent — re-adding with the same `calcName` replaces.

## Position and size

If `x`/`y`/`width`/`height` are omitted, `pbi_visual_add` auto-stacks below existing visuals. To override later: `pbi_visual_update`.

Default sizes per type are tuned to real Desktop exports — usually leave them.
