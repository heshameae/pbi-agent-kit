# Audience Styles Reference

How to *style and design* a Power BI report for its audience: per-persona visual emphasis, color and typography treatment, density, and the data-storytelling structure that frames the page. The audience determines not just *what* you show but *how* you present it -- the same metric is styled very differently for an executive scanning for exceptions versus an analyst drilling for cause. All examples use generic placeholders (Sales, Region, Product, Date).

> **Scope note.** This file covers the report *design/styling* side only. The *planning-side* audience archetypes (primary questions, detail level), the Situation-Complication-Resolution intake arc, and the self-service maturity ladder used to set dashboard scope live in `skills/planning-dashboards/references/intake-protocol.md`. Identify the audience and its maturity level there during intake; come here to translate that into styling. Cross-reference rather than duplicate.

**Source:** Mined from `business-intelligence/SKILL.md` (audience archetypes, visual hierarchy, RAG colors, self-service maturity model, Situation-Complication-Resolution, What/So What/Now What), `power-bi-report-design-consultation/SKILL.md` and `power-bi-report-design-best-practices.instructions.md` (per-persona design patterns, color/typography hierarchy, mobile/operational specifics), and `data-storytelling/SKILL.md` (narrative arc, headline formula, contrast/annotation techniques).

## Persona Styling Patterns

Three recurring archetypes drive three distinct styling treatments. (Their *questions* and *detail level* are defined in the intake protocol; below is how to style for each.)

### Executive

- High-level KPIs prominently displayed; minimal text, maximum insight density.
- Exception-based highlighting with RAG (red/yellow/green) status -- color carries the "needs attention" signal.
- Trend indicators with clear direction arrows.
- Clean, uncluttered layout with plenty of white space.
- Round aggressively at summary level; let the headline insight lead.

### Analytical

- Multiple levels of detail with drill-down / drill-through capability.
- Comparative analysis built in (period-over-period, vs target).
- Interactive filtering and exploration options.
- Detailed data tables where needed; comprehensive legends and context information.

### Operational

- Real-time or near-real-time data display.
- Action-oriented design with clear status indicators and exception-based alerts/notifications.
- Mobile-optimized for field use (portrait, large touch targets, simple chart types).
- Quick refresh and update cadence.

## Visual Hierarchy (applies to all personas)

1. Most important metrics at top-left.
2. Summary cards flow into trend charts flow into detail tables (top to bottom) -- the detail gradient.
3. Related metrics grouped; white space separates logical sections.
4. Information architecture by importance: **Primary** = key metrics/KPIs (top-left, header); **Secondary** = supporting trends/comparisons (main body); **Tertiary** = filters, controls, navigation (sidebars, footers).

A representative executive layout (summary cards across the top, trend + composition in the middle band, detail table + RAG status cards at the bottom):

```
+------------------------------------------------------------+
|                   EXECUTIVE SUMMARY                         |
|  KPI card   |   KPI card   |   KPI card   |   KPI card     |
+------------------------------+-----------------------------+
| REVENUE TREND (line)         | REVENUE BY SEGMENT (donut)  |
+------------------------------+-----------------------------+
| TOP ACCOUNTS (table)         | KPI STATUS (RAG cards)      |
+------------------------------+-----------------------------+
```

## Color Treatment by Audience

- **RAG status** is the executive/operational workhorse -- reserve red/yellow/green for status meaning, never decoration. Representative RAG palette: Green `#28A745` | Yellow `#FFC107` | Red `#DC3545` | Gray `#6C757D` (gray for inactive/reference). A semantic mapping from the consultation source: Green = positive/on-target/growth; Red = negative/alert/below-target; Blue = neutral/base metrics; Orange = warning/attention; Gray = inactive/disabled.
- **Accessibility is non-negotiable across personas:** minimum 4.5:1 contrast for text; colorblind-friendly palette (avoid red-green-only distinctions); pattern/shape alternatives to color; high-contrast-mode compatibility; alt text for screen readers.
- Use a primary brand color for key metrics/headers, a secondary palette for categorization, neutral grays for backgrounds/borders, and accent colors only for highlights and interactions.

## Accessibility: Alt Text

Data visuals should carry descriptive alt text for screen-reader users. Set it on the visual's `general` object — a literal string or a DAX-driven expression:

```json
"visualContainerObjects": {
  "general": [{
    "properties": {
      "altText": {
        "expr": {"Literal": {"Value": "'Line chart showing monthly sales trend across the year'"}}
      }
    }
  }]
}
```

Decorative shapes/images do not need alt text; data visuals (charts, KPIs, tables) do.

## Typography Hierarchy

A consistent type scale signals importance and keeps pages scannable. Use at most two font families; left-align body text; reserve centered alignment for titles.

| Element | Size | Weight |
|---|---|---|
| Report title | 20-24pt | Bold |
| Page title | 16-18pt | Semi-bold |
| Section header | 14-16pt | Semi-bold |
| Visual title | 12-14pt | Medium |
| Data labels | 10-12pt | Regular |
| Footnotes / captions | 9-10pt | Light |

Maintain sufficient line and letter spacing and adequate white space around text. (For report-wide font choice and theme cascade, defer to the theme rather than per-visual overrides.)

## Data Storytelling Structure

Style serves a narrative. Frame the page or readout so the insight leads and the action closes.

### Narrative Arc (6 beats)

For a presented analysis, walk the reader through six beats:

1. **Hook** -- grab attention with a surprising insight.
2. **Context** -- establish the baseline.
3. **Rising Action** -- build through data points.
4. **Climax** -- the key insight.
5. **Resolution** -- recommendations.
6. **Call to Action** -- next steps.

This rests on three pillars working together: **Data** (evidence: numbers, trends, comparisons), **Narrative** (meaning: context, causation, implications), and **Visuals** (clarity: charts, highlights). A simpler framing of the same arc is **Setup -> Conflict -> Resolution** (context/baseline -> the problem or opportunity -> insights and recommendations).

### Situation-Complication-Resolution

For a multi-finding readout (a QBR, an executive summary), wrap findings in S-C-R -- the same arc used during planning intake:

1. **Situation** -- the baseline goal (e.g., "Last quarter we targeted a 10% retention improvement").
2. **Complication** -- what went wrong and why (e.g., "Enterprise churn rose 5%, driven by 30-day onboarding delays").
3. **Resolution** -- the quantified fix (e.g., "Cutting onboarding to 14 days correlates with 40% lower churn").

### What / So What / Now What

Every individual insight should resolve all three: **What** (the finding) -> **So What** (why it matters / quantified impact) -> **Now What** (the action). Always include quantified impact.

### Headline Formula

Lead each page or slide with a headline, not a topic label:

```
[Specific Number] + [Business Impact] + [Actionable Context]
```

| Weak (topic label) | Strong (headline) |
|---|---|
| "[Period] [Metric] Analysis" | "[Confirmed metric change] -- [actionable context]" |
| "[Business process] Report" | "[Confirmed loss/opportunity] -- [recommended action]" |
| "[Channel] Performance" | "[Confirmed comparison] -- [decision implication]" |

### Styling Techniques That Carry the Story

- **Progressive reveal:** start with a simple chart, then layer (trend -> growth-rate overlay -> segment breakdown) so the audience follows the logic.
- **Contrast and compare:** before/after blocks and side-by-side tiles make the difference the message.
- **Annotation and highlight:** annotate key events on a chart, shade a notable region, and add a dashed threshold/target line so the eye lands on the point.

### Storytelling Do's and Don'ts

| Do | Don't |
|---|---|
| Start with the "so what" -- lead with insight | Data-dump -- curate ruthlessly |
| Use the rule of three (three points/comparisons) | Bury the insight -- front-load key findings |
| Show, don't tell -- let data speak | Use jargon -- match audience vocabulary |
| Make it personal -- connect to audience goals | Show methodology first -- context, then method |
| End with action -- clear next steps | Forget the narrative -- numbers need meaning |

## Density and Performance per Audience

Limit to 5-8 visualizations per page (the broader design guidance allows up to 12-15 before performance degrades, but executive and mobile/operational pages should stay nearer the lower bound). Higher-maturity, analytical audiences tolerate denser, more interactive pages; executive and operational/mobile audiences need fewer, larger, more opinionated visuals. For the visual-cost ranking and mobile-friendly visual list, see `chart-selection.md`.

## Cross-References

- Audience archetypes (questions, detail level), S-C-R intake arc, and self-service maturity ladder used to scope a dashboard: `skills/planning-dashboards/references/intake-protocol.md`.
- Choosing the visual type and the mobile-friendly / visual-performance lists: `chart-selection.md`.
- KPI card targets, gaps, and trends (the executive top band): `kpi-cards.md`.
- Detail-table styling at the bottom of the detail gradient: `tables.md`.
