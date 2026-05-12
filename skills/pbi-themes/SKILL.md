---
description: Configure visual conditional formatting and theme-related operations in Power BI reports. Use when the user mentions conditional formatting, "colour by value", "gradient background", "highlight if greater than", a measure-driven colour, theme JSON, brand colours, or wants to clear visual formatting.
allowed-tools: mcp__pbi-report__pbi_format_get mcp__pbi-report__pbi_format_clear mcp__pbi-report__pbi_format_background_gradient mcp__pbi-report__pbi_format_background_conditional mcp__pbi-report__pbi_format_background_measure
---

# Power BI Themes & Conditional Formatting Skill

Currently covers **visual-level conditional formatting** (`visual.objects.values[]`). The report's base theme is set by `pbi_report_create` to Desktop's current default (CY26SU02). Theme replacement is a future feature.

## Three formatting rule types

### 1. Gradient (continuous colour scale)

"Colour the profit cells with a green→red gradient":
```
pbi_format_background_gradient(page, name: <visualId>,
  inputTable: "Sales", inputColumn: "Profit",
  fieldQueryRef: "Sum(Sales.Profit)",
  minColor: "#FF0000", maxColor: "#00FF00")
```

The aggregated value of `inputColumn` determines where on the gradient each cell falls.

### 2. Conditional (rule-based)

"Highlight cells where revenue > 1000 in green":
```
pbi_format_background_conditional(page, name: <visualId>,
  inputTable: "Sales", inputColumn: "Revenue",
  threshold: 1000,
  colorHex: "#00FF00",
  comparison: "gt")   // eq | neq | gt | gte | lt | lte
```

Default comparison is `gt`. Threshold must be numeric.

### 3. Measure-driven

"Use my DAX measure ColorByCategory to colour the cells":
```
pbi_format_background_measure(page, name: <visualId>,
  measureTable: "Sales", measureProperty: "ColorByCategory",
  fieldQueryRef: "Sum(Sales.Profit)")
```

The measure must return a hex colour string per row.

## `fieldQueryRef` — selecting the target column

`fieldQueryRef` is the `queryRef` of the visual column the rule applies to (`selector.metadata` in PBIR). For a column bound to a Measure named Revenue, it's typically `"Sum(Sales.Revenue)"`.

If unsure, call `pbi_visual_get(page, name)` and look at the `bindings[].queryRef` for the column you want to format. Pass that exact string.

## Replace, don't append

Each formatting tool replaces any existing rule on the same `fieldQueryRef` rather than stacking. To clear all rules on a visual: `pbi_format_clear(page, name)`.

## Inspect current state

`pbi_format_get(page, name)` returns the visual's `objects` block. Use this before adding rules to see what's already there.
