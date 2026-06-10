# Chart Selection Reference

How to choose the right visual for a question in a Power BI report, when to reach for a custom visual instead of a native one, and how to rank visuals by rendering cost. Make smart, intentional choices about what visual to use for each scenario -- visual vocabulary is essential. When a request would produce a poor choice (a pie chart with 15 slices, a 3D column chart), push back and explain the better alternative. All examples use generic placeholders (Sales, Product, Region, Date); apply the rules to whatever the connected model exposes.

**Source:** Mined from `pbi-report-design/SKILL.md` and `pbi-report-design/references/visual-colors.md` (selection rules, axis/sort/color), `deneb-visuals/SKILL.md` and `svg-visuals/SKILL.md` (custom-visual routing), `power-bi-report-design-best-practices.instructions.md` and `power-bi-report-design-consultation/SKILL.md` (chart-by-relationship + visual-performance ranking), and `business-intelligence/SKILL.md` (chart-selection matrix).

## Question-to-Visual Matrix

Start from the data question, not the visual. Combining the consultation and BI sources, the relationship the data expresses drives the choice.

| Data question / relationship | Primary visual | Alternative | Notes |
|---|---|---|---|
| Comparison across categories / ranking | Bar or Column | Bullet, Dot plot | Horizontal bars when category names are long |
| Performance against a target | Bullet chart | KPI visual | Bullet packs actual + target + bands compactly |
| Trend over continuous time | Line | Area | Use consistent time intervals |
| Multiple metrics over time | Line (multi-series) | Small multiples | Different line styles per series |
| Cumulative / composition over time | Area | Stacked area | |
| Part of whole | Donut / Treemap | Stacked bar (often clearer) | Max 5-7 slices for pie/donut |
| Composition + comparison across categories | Stacked bar | Clustered bar | 100% stacked when proportions matter most |
| Sequential change / bridge | Waterfall | -- | New / expansion / contraction style breakdowns |
| Distribution / frequency | Histogram | Box plot | Box plot summarizes statistical spread |
| Relationship between two measures | Scatter | Bubble (size = 3rd dimension) | Add trend line; label outliers |
| Two-dimensional categorical pattern | Heat map | Matrix with CF | Colorblind-friendly color scale |
| Geographic distribution | Choropleth / Filled map | Bubble map | |
| Inline trend in a row/cell | Sparkline | -- | See `tables.md` |

### Axis and Sort Rules

- **Bar/Column:** start the value axis at zero for accurate comparison; sort categories by value for ranking; limit to roughly 7-10 categories for readability.
- **Line:** use consistent time intervals; start the Y-axis at zero when showing absolute values; use data-point markers for sparse data.
- **General charts:** sort by value descending unless the visual is time-based (then sort by time ascending). Minimize gridlines and axis clutter; use muted colors for non-essential elements; highlight key data points sparingly.

### Composition Caution

Pie and donut charts make it hard to compare similar-sized segments, do not scale to many categories, and can't show change over time. Prefer a stacked bar (or a sorted bar) when readability matters. Keep any pie/donut to 5-7 categories at most.

## Avoid List

| Avoid | Why | Use instead |
|---|---|---|
| Pie/donut with >7 slices | Segments indistinguishable | Sorted bar or treemap |
| Comparing similar-sized pie slices | Eye can't judge angle precisely | Bar chart |
| Truncated (non-zero) axis on bar/column | Exaggerates differences | Start axis at zero |
| Rainbow / too many colors (>6-8 per visual) | Cognitive overload | Muted palette, highlight sparingly |
| Red/green only encoding | Fails colorblind readers | Blue/orange; pair color with icon/text/shape |
| Dense matrix on mobile, complex scatter on mobile | Unreadable at small size | Cards, simple bar/column, large gauges |
| Visual with no field bindings | No reason to exist | Bind real model fields or remove |

## Color in Charts

Prefer theme colors over hard-coded hex in visuals; reserve literal hex for extension measures.

```json
// Good - theme color
"expr": { "ThemeDataColor": { "ColorId": 1, "Percent": 0 } }
// Avoid in visuals - literal hex (use only in extension measures)
"expr": { "Literal": { "Value": "'#118DFF'" } }
```

- Colors should be muted and soft; colors that implicitly encode meaning (red=bad, green=good) should be avoided **unless** that is the intended encoding.
- Maximum 6-8 distinct colors per visual; reserve bright/accent colors for important data only.
- Use accessible pairings (Blue + Orange instead of Red + Green; Blue + Yellow; dark/light variants of one hue).
- Always pair color with a secondary cue (icon, pattern, text label, shape) -- never color alone.
- Use dark gray (`#333`) rather than pure black.
- Semantic tokens for extension measures returning sentiment: `"good"`, `"bad"`, `"neutral"`, plus `"minColor"`/`"midColor"`/`"maxColor"` for gradients. Theme tokens mean a theme change cascades to all conditional formatting.

## Native vs Custom Visual Routing

Native Power BI visuals cover most needs. Reach for a custom visual only when native ones can't express the chart, and pick the lightest tool that does the job.

| Need | Tool | Why | Trade-off |
|---|---|---|---|
| Advanced interactive chart (cross-filter, tooltips, hover); chart type not available natively (bullet, beeswarm, sankey); fine-grained encoding/animation; vector rendering | **Deneb** (Vega / Vega-Lite) | Declarative specs, certified custom visual, crisp at any size | Requires custom-visual registration in `report.json`; spec authoring + escaping overhead |
| Simple inline graphics in table/matrix/card cells (sparkline, data bar, progress bar, status indicator, KPI micro-chart) | **SVG via DAX measures** | Lightweight; renders in native visuals; no registration needed | No interactivity; DAX string-concatenation maintenance |
| Statistical visualizations (distribution, regression, correlation) where analytical rigor matters more than interactivity | **Python (matplotlib/seaborn) or R (ggplot2)** | Mature statistical ecosystems | Static PNG, no interactivity; requires script visuals (non-Node runtime) |

**Routing summary**

- **Deneb** is the preferred choice for *advanced, interactive* custom visuals that go beyond native capabilities. Prefer Vega-Lite unless Vega-only features are needed (signals, event streams, custom projections, force/voronoi layouts).
- **SVG measures** are preferred for *simple inline* graphics inside tables, matrices, cards, and image visuals where interactivity is not needed -- they work with native visuals and need no custom-visual registration. An SVG measure returns a string prefixed with `data:image/svg+xml;utf8,` and has its `dataCategory` set to `ImageUrl`; store it as an extension measure.
- **Python / R** are preferred for *statistical* charts (distributions, regressions, correlations); they produce static images, not interactive visuals.

> P2 / adapt: Deneb and SVG are advanced routes. For most pages, exhaust native visuals first; only escalate to a custom visual when a specific question genuinely can't be answered with native ones.

## Visual Performance Ranking

More visuals and heavier visual types cost render time. Keep to roughly 6-8 visuals per page for optimal performance (the broader design guidance allows up to 12-15 before performance degrades). Rank from cheapest to most expensive to render:

| Tier | Visuals | Cost |
|---|---|---|
| Fast | Card, KPI, Gauge (simple aggregations) | Lowest |
| Moderate | Bar, Column, Line (standard aggregations) | Low |
| Slower | Scatter, Maps, Custom visuals (complex calculations) | Higher |
| Slowest | Matrix / Table with many columns (detailed data) | Highest |

Practical levers: apply filters early; use page-level filters for common scenarios; avoid high-cardinality fields in slicers; pre-filter large datasets; push calculation logic into the semantic layer rather than report-level visual calculations; use summary views with drill-through instead of cramming detail onto a landing page.

## Mobile Considerations

Some visual choices fail on small screens. Prefer mobile-friendly types and avoid the rest when a mobile layout is in scope.

- **Mobile-friendly:** Card visuals for KPIs, simple bar/column charts, line charts with few data points, large gauge/KPI visuals.
- **Mobile-challenging:** dense matrices and tables, complex scatter plots, multi-series area charts, small-multiple visuals.
- Vertical scrolling is acceptable; horizontal scrolling is problematic. Increase font sizes for mobile readability and ensure touch targets are at least ~44px.

## Named Analytical Patterns

Some questions map to a recognized analytical *pattern* rather than a single chart. Each pattern below names when to use it, the visual(s) that express it, and the pitfall to avoid. These are dataset-agnostic: substitute whatever stages, segments, and measures the connected model exposes (a "stage" might be order status, support-ticket lifecycle, application steps, etc. -- not just a marketing funnel).

### Funnel / Conversion-Stage

- **When to use it:** A process moves entities through ordered stages and you want to see how many survive each transition -- a sequential drop-off where each stage is a subset of the prior one (e.g., Stage 1 -> Stage 2 -> ... -> Outcome). Each transition is a conversion point; the goal is to find where the largest drop-off occurs.
- **Visual(s):** A funnel visual (stage on the category axis, count/volume as the value, sorted largest-to-smallest top-to-bottom). A stacked or sequential bar works as an alternative; a waterfall can express the absolute counts lost at each step.
- **Pitfall to avoid:** Optimizing the wrong stage. Always read the full funnel before acting on any single transition -- a low bottom-stage rate may really be caused by thin volume entering at the top, and top-of-funnel changes have a multiplied downstream effect.

### Segment Decomposition (Root-Cause)

- **When to use it:** An aggregate metric (a stage rate, a KPI) looks off and you need to find *which slice* is driving it. Decompose the metric by a dimension -- segment, channel, device, geography, time/cohort -- to localize the cause before proposing a fix.
- **Visual(s):** Small multiples or a clustered/grouped bar with the metric split by the suspect dimension; a matrix with conditional formatting to scan many segment x stage cells; pair a symptom-to-cause lookup (a reference table) with the chart so each observed pattern routes to a diagnostic action.
- **Pitfall to avoid:** Stopping at the headline number. Decompose by at least one meaningful dimension before concluding -- and ensure segments have comparable volume so a tiny slice doesn't masquerade as a trend.

### Cohort Comparison

- **When to use it:** You want to know whether behavior differs across groups defined by a shared starting point or window (e.g., a cohort month) -- "has this changed over time / across entry groups?"
- **Visual(s):** A matrix/heat map of cohort (rows) x period or stage (columns) with a colorblind-friendly color scale; or grouped lines, one per cohort.
- **Pitfall to avoid:** Comparing cohorts of wildly different size. Don't pit a 100-entity cohort against a 10,000-entity one, and look for stage-specific differences -- two cohorts can share an overall rate yet have entirely different bottlenecks.
- *Lightly sourced:* the sources reference cohort only as a comparison/segmentation dimension, not as a fully developed standalone chart pattern; treat this entry as guidance extrapolated from the segment-comparison rules.

### Paired Metrics

- **When to use it:** Any metric that can be gamed by moving a single number in isolation. Show it next to its counter-metric so a "win" on one doesn't hide a loss on the other (e.g., a rate alongside the volume it's drawn from, or efficiency alongside total cost).
- **Visual(s):** A combo chart (one metric as columns, the paired metric as a line on a secondary axis), two adjacent cards/KPIs, or a scatter that plots the two measures against each other to expose the trade-off.
- **Pitfall to avoid:** Single-metric focus -- optimizing a rate while ignoring the volume behind it, or one cost ratio while ignoring totals. Always track the paired metric together.

### Aggregation / Hidden-Segment Anti-Pattern

- **When to use it (as a check):** Before trusting any single aggregate number, ask whether the aggregate could be masking opposing behavior across segments -- one segment performing well while another is broken, with the blend looking merely "average."
- **Visual(s):** Don't rely on a lone aggregate card. Pair it with a segment breakdown (small multiples or grouped bar) so a viewer can see the spread behind the headline number.
- **Pitfall to avoid:** Reporting a blended aggregate as the whole story. Aggregate metrics can hide that segments diverge; always segment before drawing a conclusion or setting a target.
- *Note:* the sources describe this as an aggregation / "ignoring segment differences" anti-pattern; they do **not** name it "Simpson's paradox." The requested *named* Simpson's-paradox pattern is therefore omitted as unsourced, and this generalized aggregation caution is included in its place.

---

## Cross-References

- Table and matrix selection, formatting, and CF: `tables.md`.
- KPI card vs `kpi` visual selection and target/trend design: `kpi-cards.md`.
- Audience-driven visual emphasis (executive vs analytical vs operational styling): `audience-styles.md`.
