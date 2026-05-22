# Layout Grid Reference

How to arrange visuals on a Power BI report page: the detail gradient, page dimensions, the spacing arithmetic that guarantees alignment, page hygiene limits, and default layout templates. Examples use generic placeholders (Sales, Region, Date); substitute the model's real fields.

**Source:** Mined from the `pbi-report-design` (`layout-guidelines.md`, SKILL), `pbir-cli` (`layout.md`, `MENTAL-MODEL.md`), and `create-pbi-report` (`layout-example.md`, SKILL) report-design skills, plus the `pbir-format` mental model and the `canvas-design` `design-principles.md` (UI-grid principles translated to the Power BI canvas).

## The 3-30-300 Detail Gradient

Arrange content so the reader can engage at the depth they need. The most important, least detailed information sits top-left; the least important, most detailed sits bottom-right.

| Time budget | What the reader gets | Where it lives |
|---|---|---|
| 3 seconds | The headline message | KPIs, cards, and titles at the top-left |
| 30 seconds | Context and supporting trends | Charts and comparisons in the middle |
| 300 seconds | Granular detail for exploration | Tables, matrices, and drill-through at the bottom-right |

### Zone bands (1280×720 standard page)

```
+--------------------------------------------------+
|  Zone 1: Summary (cards, KPIs, slicers)          |  y: 24 - ~200
|  Most important, least detail                     |
+--------------------------------------------------+
|  Zone 2: Analysis (charts, trends, maps)         |  y: ~216 - ~600
|  Context, patterns, comparisons                   |
+--------------------------------------------------+
|  Zone 3: Detail (tables, matrices)               |  y: ~616 - bottom
|  Precise values, drill-down                       |
+--------------------------------------------------+
```

| Zone | Purpose | Height | Visual types |
|---|---|---|---|
| 1 | Summary | 150-200px | `cardVisual`, `kpi`, slicers |
| 2 | Analysis | 350-450px | Charts, maps, gauges |
| 3 | Detail | 350-450px | `tableEx`, `pivotTable` |

## Page Dimensions

Always query the actual page dimensions before placing visuals. Do not assume 1280×720 — templates and existing reports vary, and the object model rejects positions that exceed page bounds. When resizing, set `width`/`height` before `x`/`y` to avoid an intermediate state that overflows.

| Type | Width | Height | Use case |
|---|---|---|---|
| Standard | 1280 | 720 | Desktop (PBI default), 16:9 |
| Full HD | 1920 | 1080 | High-resolution displays, presentations |
| Letter | 816 | 1056 | Print, portrait |
| 4:3 | 1280 | 960 | Legacy displays |

## Margins, Gaps, and the Grid

```
Page margins:        24-32px (all sides, equal)
Gap between visuals: 16px minimum, 24px recommended
Grid alignment:      8px or 16px increments (positions 0, 16, 32, 48...)
```

The 8px grid keeps the canvas on a consistent rhythm — it scales cleanly across screen densities and is the same spatial discipline behind well-built UI layouts. Snap every position and size to a multiple of 8.

### Symmetrical spacing (critical)

**All gaps between visuals must be equal, and every page margin must be equal.** Uneven spacing creates visual tension and reads as misalignment even when visuals are technically placed correctly — it is one of the most visible quality signals in a report. Differences as small as 4-8px are jarring.

Calculate a row of equal-width visuals arithmetically:

```
content_width = page_width - (2 * margin)
total_gaps    = gap * (num_visuals_in_row - 1)
visual_width  = (content_width - total_gaps) / num_visuals_in_row
```

Example — 4 equal visuals on a 1280px page, 24px margins, 16px gaps:

```
content_width = 1280 - 48 = 1232
total_gaps    = 16 * 3   = 48
visual_width  = (1232 - 48) / 4 = 296

x positions: 24, 336, 648, 960
```

For visuals of different widths sharing a row (e.g., a KPI + a chart), the gap between them must still match every other adjacent pair. Verify: `visual_B.x - (visual_A.x + visual_A.width)` is identical for all adjacent pairs.

### Vertical column alignment across rows (critical)

When visuals in different rows share a vertical split, the column boundaries must line up across rows — the gutters must form continuous vertical lines from top to bottom.

```
RIGHT (aligned split):                    WRONG (misaligned split):
+----- 608px -----+--16--+--- 608px ---+   +----- 648px -----+--16--+--- 568px ---+   Row 1
+----- 608px -----+--16--+--- 608px ---+   +---- 500px ----+--16--+---- 716px ----+   Row 2
                  ^                                          ^      ^
            same column edge                          edges don't align
```

If row 1 splits at x=648/664 (16px gap), row 2 must split at the same x=648/664. The widths of the row-2 visuals may differ, but the gap position is identical.

### Z-order

| Layer | z range |
|---|---|
| Base visuals | 0-999 |
| Overlays / highlights | 1000-1999 |
| Tooltips / popups | 2000+ |

## Page Hygiene

A report is a tool for solving a specific business problem, not a narrative. Every visual should earn its place by answering a question related to that problem; visuals that don't serve the problem are noise. The page layout follows the detail gradient so readers can engage at the depth they need.

| Limit | Value |
|---|---|
| Visuals per page | ≤12-15 (performance impact above this) |
| KPIs / cards at top | 4-6 |
| Slicers per page | Max 2-3 — use the filter pane for the rest |
| Page title | Required (textbox visual, or a title in the background image) |
| Overlap | None — visuals must not overlap |

### Visual count vs. render performance

| Count | Level | Notes |
|---|---|---|
| 6-8 | Optimal | Best render performance |
| 9-12 | Acceptable | Slight impact |
| 13-15 | Warning | Noticeable delay |
| 16+ | Critical | Performance issues |

Simple visuals — textboxes, images, shapes, buttons — have minimal performance impact and don't count toward these limits.

### Title hierarchy

Distribute meaning across the title hierarchy to avoid redundancy:

- **Page title** (textbox): the subject/metric (e.g., "Order Volume")
- **Visual titles**: context that differentiates the visual (e.g., "by Region", "Monthly Trend")
- **Subtitles**: almost always redundant — hide by default when a visual title is set

Bad: page title "Sales by Region" + visual title "Sales by Region" + subtitle "Sales by Region" says the same thing three times. Good: page title "Sales" + visual titles "by Region", "Monthly Trend" — each adds unique information. Hide axis titles when the axis label is self-evident (month names need no "Month" axis title).

## Default Layout Templates

### Standard executive dashboard (KPI row + trend + breakdown + detail table)

The most broadly useful pattern; it follows the 3-30-300 gradient. On a 1280×720 page with margin=24 and gap=16:

```
+--------------------------------------------------+
|  Page title (textbox)                            |  y: 16, h: 56
+--------+--------+--------+------------------------+
|  KPI   |  KPI   |  KPI   |                        |  y: 88, h: 160
+--------+--------+--------+------------------------+
|     Trend chart        |     Breakdown chart      |  y: 264, h: 220
+------------------------+--------------------------+
|                    Detail table                   |  y: 500, h: 196
+--------------------------------------------------+
```

Spacing verification (each gap must come out to the chosen 16/24px):

```
Title bottom:  16+56  = 72.   Gap to KPIs:    88-72   = 16  [ok]
KPI bottom:    88+160 = 248.  Gap to charts:  264-248 = 16  [ok]
Chart bottom:  264+220= 484.  Gap to table:   500-484 = 16  [ok]
Table bottom:  500+196= 696.  Bottom margin:  720-696 = 24  [ok]
Left margin:   24.  Right edge: 24+1232=1256.  Right margin: 1280-1256 = 24  [ok]
```

### Analysis layout (main + supporting)

Main chart on the left (≈2/3 width), supporting card + chart stacked on the right (≈1/3 width).

### KPI-heavy dashboard

Large KPI cards in a 2×2 grid filling the upper canvas, with a full-width trend chart below.

## Common Visual Sizes

| Visual | Width | Height | Notes |
|---|---|---|---|
| Card / KPI | 200-300 | 100-150 | Min height ~130px for value + label |
| Chart (small) | 400 | 300 | Side-by-side pair |
| Chart (medium) | 600 | 400 | Standard single chart |
| Chart (large) | 900 | 500 | Primary analysis chart |
| Chart (full-width) | content_width | 400-500 | Spanning the page |
| Table / matrix | content_width | 300-500 | Usually full width |
| Slicer (horizontal) | 200-400 | 56-80 | Button or dropdown |
| Slicer (vertical) | 150-200 | 200-400 | List style |

## Inferring Time Granularity for Trend Visuals

When adding a trend visual, match the time axis to the active filter context so the grain fits the decision cadence:

| Active filter | Trend granularity | Date column to use |
|---|---|---|
| Year | Monthly | Calendar Month / Calendar Month-Year |
| Quarter | Monthly or weekly | Calendar Month / Calendar Week |
| Month | Daily or weekly | Date / Calendar Week |
| No date filter | Monthly or quarterly | Calendar Month-Year / Calendar Quarter-Year |

If unsure, default to monthly — it works well for most business reporting contexts.

## Positioning Verification

After placing visuals, verify before considering the page done:

- All horizontal gaps are equal
- All vertical gaps are equal
- Column edges align across rows
- No visuals extend beyond page bounds
- Margins are consistent on all sides
- No visuals overlap
