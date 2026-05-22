# Tables & Matrices Reference

Design guidance for table and matrix visuals in Power BI reports. Tables and matrices sit at the bottom of the detail gradient (3-30-300 rule) -- they provide drill-down detail beyond what KPIs and charts convey. "Easy to create" is not the same as "easy to read": a well-formatted table answers a specific reader question; a poorly formatted one is a wall of numbers nobody uses. All examples use generic placeholders (Sales, Product, Region, Date); apply the rules to whatever the connected model actually exposes.

**Source:** Mined from `pbi-report-design/references/tables-and-matrices.md` and `pbi-report-design/SKILL.md` (table/matrix design principles), plus the `pbir-cli` formatted-visual examples `tableEx-gradient.json` and `pivotTable-bullet-kpi.json` (PBIR visual.json structure).

## Decision-Making First

Content selection and decision-making come first; formatting only amplifies the signal. Before creating a table or matrix, answer:

1. **What question does this table answer?** (e.g., "Which products are behind target?")
2. **Who reads it and what action do they take?** (e.g., "Category managers re-allocate stock")
3. **What columns are essential to answer that question?** Remove everything else.
4. **What should the reader see first?** This determines sort order and emphasis.

Tables are valid visualizations when readers need precise numerical values, comparisons across many dimensions, or specific row lookups. Human perception excels at visual pattern recognition but struggles with large numerical grids requiring mental calculation -- formatting must offload cognitive work from memory to visual perception.

## Table vs Matrix: When to Use Which

| Scenario | Visual type | Why |
|---|---|---|
| Flat list of records, no grouping | `tableEx` | Simple rows, no hierarchy needed |
| Hierarchical categories (e.g., Region > Country > City) | `pivotTable` (matrix) | Rows expand/collapse, subtotals per level |
| Cross-tab / pivot (categories on both axes) | `pivotTable` | Row headers + column headers + values |
| Two or more categorical columns that form a natural hierarchy | `pivotTable` | Avoids repeating parent values in every row |

**Rule of thumb:** If the table has 2+ categorical columns where one is a parent of the other (Region > Category > Product), use a matrix. Expand/collapse reduces clutter and lets readers drill into relevant sections without scrolling thousands of flat rows. A flat table with repeating parent values is one of the most common anti-patterns.

## Column Selection

Include only columns that serve the question. Every column competes for horizontal space and reader attention. If the question is "which products are behind target?", the variance column matters most -- showing separate actual and target columns alongside it may be redundant.

- **Leading columns:** the primary dimension(s) the reader groups by (customer, product, date)
- **Measure columns:** the KPIs that matter for this page -- typically the same measures shown in the KPI cards above
- **Avoid:** internal IDs, keys, redundant names, measures unrelated to the page question, or columns derivable from others already shown

## Column Ordering

Order columns by importance, left to right:

1. **Row labels / hierarchy** (leftmost) -- what the reader scans first
2. **Primary measure** -- the metric that answers the page question
3. **Secondary measures** -- supporting metrics
4. **Variance / delta columns** -- if applicable (vs PY, vs Budget)

## Sorting

**Always sort by the most important measure, descending.** Alphabetical sorting rarely answers useful questions. The top rows should show the largest/most significant items -- often the variance or gap column rather than the absolute value. This aligns with how business users read tables: top contributors or biggest deviations first.

Set the sort in the visual.json `query` block via `sortDefinition.sort` with the sort field and `"direction": "Descending"`. For time-based detail tables (e.g., a daily breakdown), sort ascending by date instead.

## Formatting Philosophy: Subtract, Don't Add

The default Power BI table styling includes gridlines, banded rows, and borders that compete with the data. The recommended approach is to **remove visual noise and let whitespace do the separation work** -- counterintuitive, since many designers add elements to "improve" tables. Better tables result from removing clutter:

- Strip or minimize gridlines (horizontal only, if any)
- Remove banded-row shading (or use an extremely subtle tint, 2-3% opacity)
- Reduce border complexity
- Increase row padding to let whitespace separate rows naturally

### Theme-First Approach

Most table formatting should come from the theme. Only override at the visual level for genuinely one-off cases. Check what the theme already provides by inspecting the theme.json `visualStyles` for `tableEx` and `pivotTable` entries (grid, columnHeaders, values properties).

### Key Formatting Properties

| Property | Recommended | Notes |
|---|---|---|
| Grid lines | Horizontal only, or none | Vertical lines add clutter; let column spacing separate. Horizontal lines aid row scanning when rows are dense |
| Banded rows | Off or extremely subtle (2-3% opacity) | Heavy banding competes with data; whitespace is better |
| Row padding | 6-10px | More breathing room than default |
| Header font | Segoe UI Semibold, 10-12pt | Distinguishable from values but not dominant |
| Value font | Segoe UI, 10-12pt | Consistent across all value columns |
| Column width | Auto or proportional | Avoid truncation; let measures be narrower than text columns |
| Borders | Minimal or none | Let content structure speak for itself |

### Number Formatting

Unlike KPI cards, tables should show **more precision** -- this is where readers go for detail:

- Measures: use the model's format string (e.g., `#,##0` for integers, `#,##0.0%` for percentages)
- Do **not** apply display units (thousands/millions) in tables -- show full values
- Align numbers right, text left (Power BI default)

## Conditional Formatting Strategy

Conditional formatting (CF) offloads cognitive work from the reader's memory to visual perception -- but applied to every column it creates overload where nothing stands out. Apply it strategically.

| Column type | Formatting | Rationale |
|---|---|---|
| Primary measure | Data bars | Magnitude comparison without reading numbers |
| Variance / delta | Color scale or font color | Instantly signals good/bad performance |
| Status indicators (on-time %, quality) | Color when above/below threshold | Only when the threshold matters for decisions |
| Dimension columns | None | Text labels need no emphasis |
| Secondary measures | None | Formatting everything means formatting nothing |

### Data Bars

Apply data bars to the **primary measure column** (revenue, volume, lines). Data bars turn a column of numbers into a scannable pattern. Configure via the `dataBar` property on the relevant measure column in the visual.json `objects`.

### Color Scales on Variance Columns

Apply color scales to **variance/delta columns only** -- not to absolute values. Use an intuitive diverging scheme:

- Red/warm tones for negative/underperformance
- Blue/cool tones for positive/overperformance (avoid green for accessibility)

Prefer a measure-driven approach: create an extension measure that returns a theme sentiment token, then bind it as a CF rule for `values.fontColor`:

```dax
On-Time Color = IF([On-Time % (Lines)] >= 0.9, "good", IF([On-Time % (Lines)] >= 0.8, "neutral", "bad"))
```

### Directional Indicators

Triangle or arrow symbols with color coding indicate direction (up/down) alongside magnitude -- especially effective on variance columns where direction of change matters as much as size. Always pair color with a secondary cue for accessibility.

## Sparklines and Inline Trends

Sparklines add temporal context that answers "is this improving or declining?" -- information a single number cannot convey. They distinguish a product that is behind target but improving from one that is declining. Add a native sparkline by binding a measure to the `Values` role with a sparkline date field in the query block.

For richer inline visuals (dumbbell charts, bullet charts, progress bars), use SVG extension measures (see `chart-selection.md` for custom-visual routing). The trade-off: higher development/maintenance overhead vs. richer context. Use only when benefits justify the complexity.

## Matrix-Specific Guidance

- **Row hierarchy:** bind categories broadest to most granular (e.g., `Rows: Region`, `Rows: Category`, `Rows: Product`) so the matrix can roll up cleanly.
- **Subtotals:** matrices show subtotals at each level by default -- usually desirable. For very deep hierarchies (4+ levels), consider hiding intermediate subtotals to save space.
- **Expand/collapse:** matrices start collapsed to the top level by default -- the preferred behavior, respecting the detail gradient. Readers expand only the rows they care about.
- **Column hierarchy (pivot):** use column headers for time periods or categorical pivots (e.g., `Columns: Calendar Quarter`).

## Sizing

- **Minimum height:** 180-200px (header + 5-8 visible rows)
- **Width:** tables/matrices typically span the full page width (margin to margin)
- **Pagination:** Power BI handles pagination automatically; ensure enough height for meaningful density

### Auto-Size Width Gotcha

**Turn off auto-size width when the table/matrix shares a row with another visual** (i.e., is not full page width). Auto-size calculates column widths from content, which can exceed the container width and produce a horizontal scrollbar -- bad practice that hides columns, breaks scannability, and signals the visual doesn't fit. When auto-size is off, columns distribute proportionally; long text may truncate, but truncation with a tooltip beats a scrollbar that hides whole columns off-screen.

```
columnHeaders.autoSizeColumnWidth = false  -> columns fit container proportionally
columnWidth.value = <pixels>               -> fixed width (only when autoSize is off)
```

**Rule of thumb:** full-width (margin to margin) table -> auto-size is usually fine. Table sharing a row with another visual (e.g., bar chart left, matrix right) -> disable auto-size width.

## PBIR visual.json: Table with Gradient CF (`tableEx`)

A `tableEx` with a dimension column, a primary measure, a prior-period measure, and two variance columns, sorted by the primary measure descending. Variance columns carry diverging gradients (warm = negative, cool = positive); the primary measure uses horizontal gridlines and increased row padding. Condensed from the mined example:

```json
{
  "name": "<id>",
  "position": { "x": 272, "y": 192, "z": 0, "height": 320, "width": 736 },
  "visual": {
    "visualType": "tableEx",
    "query": {
      "queryState": {
        "Values": {
          "projections": [
            { "field": { "Column": { "Expression": { "SourceRef": { "Entity": "Product" } }, "Property": "Category" } }, "queryRef": "Product.Category" },
            { "field": { "Measure": { "Expression": { "SourceRef": { "Entity": "Sales" } }, "Property": "Sales Amount" } }, "queryRef": "Sales.Sales Amount" },
            { "field": { "Measure": { "Expression": { "SourceRef": { "Entity": "Sales" } }, "Property": "Sales Amount (PY)" } }, "queryRef": "Sales.Sales Amount (PY)" },
            { "field": { "Measure": { "Expression": { "SourceRef": { "Entity": "Sales" } }, "Property": "Sales Amount vs. PY (%)" } }, "queryRef": "Sales.Sales Amount vs. PY (%)" }
          ]
        }
      },
      "sortDefinition": {
        "sort": [
          { "field": { "Measure": { "Expression": { "SourceRef": { "Entity": "Sales" } }, "Property": "Sales Amount" } }, "direction": "Descending" }
        ]
      }
    },
    "objects": {
      "grid": [
        { "properties": {
          "gridHorizontal": { "expr": { "Literal": { "Value": "true" } } },
          "rowPadding": { "expr": { "Literal": { "Value": "5D" } } }
        } }
      ],
      "values": [
        { "properties": {
          "fontColor": { "solid": { "color": { "expr": { "FillRule": {
            "Input": { "Measure": { "Expression": { "SourceRef": { "Entity": "Sales" } }, "Property": "Sales Amount vs. PY (%)" } },
            "FillRule": { "linearGradient3": {
              "min": { "color": { "Literal": { "Value": "'#ad5129'" } } },
              "mid": { "color": { "Literal": { "Value": "'#000000'" } }, "value": { "Literal": { "Value": "0D" } } },
              "max": { "color": { "Literal": { "Value": "'#0d6abf'" } } }
            } }
          } } } } } },
          "selector": { "data": [ { "dataViewWildcard": { "matchingOption": 1 } } ], "metadata": "Sales.Sales Amount vs. PY (%)" }
        } }
      ]
    }
  }
}
```

The gradient `min`/`mid`/`max` colors here are illustrative hex; prefer theme sentiment tokens (`"bad"`, `"neutral"`, `"good"` or `"minColor"`/`"midColor"`/`"maxColor"`) so a theme change cascades to all CF.

## PBIR visual.json: Bullet-KPI Matrix (`pivotTable`)

A `pivotTable` rendering an SVG bullet-KPI measure per dimension row, sorted descending. Note the subtract-formatting choices: `autoSizeColumnWidth = false`, banded rows off, outline style 0, vertical gridlines off / horizontal on, tight row padding, and Segoe UI / Segoe UI Semibold fonts. The Values slot holds an SVG extension measure (see `chart-selection.md`). Condensed shape:

```json
{
  "visual": {
    "visualType": "pivotTable",
    "query": {
      "queryState": {
        "Rows": { "projections": [ { "field": { "Column": { "Expression": { "SourceRef": { "Entity": "Region" } }, "Property": "Region" } }, "queryRef": "Region.Region", "active": true } ] },
        "Values": { "projections": [ { "field": { "Measure": { "Expression": { "SourceRef": { "Schema": "extension", "Entity": "Sales" } }, "Property": "Bullet KPI SVG" } }, "queryRef": "Sales.Bullet KPI SVG" } ] }
      },
      "sortDefinition": { "sort": [ { "field": { "Measure": { "Expression": { "SourceRef": { "Schema": "extension", "Entity": "Sales" } }, "Property": "Bullet KPI SVG" } }, "direction": "Descending" } ] }
    },
    "objects": {
      "columnHeaders": [ { "properties": {
        "fontFamily": { "expr": { "Literal": { "Value": "'''Segoe UI Semibold'', wf_segoe-ui_semibold, helvetica, arial, sans-serif'" } } },
        "autoSizeColumnWidth": { "expr": { "Literal": { "Value": "false" } } },
        "outlineStyle": { "expr": { "Literal": { "Value": "0D" } } }
      } } ],
      "values": [ { "properties": {
        "fontFamily": { "expr": { "Literal": { "Value": "'''Segoe UI'', wf_segoe-ui_normal, helvetica, arial, sans-serif'" } } },
        "bandedRowHeaders": { "expr": { "Literal": { "Value": "false" } } },
        "outlineStyle": { "expr": { "Literal": { "Value": "0D" } } }
      } } ],
      "grid": [ { "properties": {
        "gridVertical": { "expr": { "Literal": { "Value": "false" } } },
        "gridHorizontal": { "expr": { "Literal": { "Value": "true" } } },
        "rowPadding": { "expr": { "Literal": { "Value": "2D" } } }
      } } ]
    }
  }
}
```

## Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Skipping the decision-making phase | Table shows data without answering a question | Define question, audience, and action before building |
| Flat table with repeating parent values | Redundant data, hard to scan | Use a matrix with hierarchy |
| Too many columns (>8) | Horizontal scroll, cognitive overload | Remove non-essential columns; disable auto-size width if constrained |
| Alphabetical sort | Rarely answers useful questions | Sort by primary measure or variance descending |
| Conditional formatting on every column | Visual overload, nothing stands out | Data bars on primary measure; color on variance only |
| Heavy gridlines + banded rows | Visual noise competes with data | Remove gridlines; use whitespace to separate rows |
| Display units in tables | Loses the detail readers came for | Show full precision |
| Same title as page title | Redundant information | Use a differentiating title (e.g., "by Region and Product") |
| Unformatted data dump | Nobody scans raw number walls | Apply the full formatting workflow |
| Showing actual + target + variance | Redundant when variance alone answers the question | Show variance; drop actual/target if not needed |

## Checklist

- [ ] Question defined: what does this table answer, and for whom?
- [ ] Visual type matches data structure (`tableEx` for flat, `pivotTable` for hierarchical)
- [ ] Only essential columns included (no redundant or derived columns)
- [ ] Sorted by most important measure or variance descending
- [ ] Column order: dimensions left, primary measure next, variance right
- [ ] Visual noise removed: minimal gridlines, no heavy banding, adequate whitespace
- [ ] Data bars on primary measure column for magnitude scanning
- [ ] Color scales on variance columns only (not on every column)
- [ ] Number formatting shows appropriate detail (no display units)
- [ ] Sparklines added where temporal context matters
- [ ] Subtitle hidden; title differentiates from page title
- [ ] Auto-size width disabled if the visual shares a row with another visual
- [ ] Height sufficient for 5-8 visible rows minimum
