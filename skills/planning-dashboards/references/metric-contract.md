# Metric Contract

KPI definition template, metric triad, threshold lint, and hypothesis framing for Power BI dashboards.

**Source:** claude-skills-borghei business-intelligence · planning-dashboards design principles

---

## KPI Definition Template

Fill one block per metric. Every metric in a `DashboardSpec` must have a complete contract before measures are authored.

```yaml
kpi:
  name: "Monthly Recurring Revenue"
  owner: "Finance"
  purpose: "Track subscription revenue health vs target"
  formula: "SUM(subscription_amount) WHERE status = 'active'"
  data_source: "billing.subscriptions"
  granularity: "monthly"
  target: 1200000
  warning_threshold: 1080000     # 90% of target
  critical_threshold: 960000     # 80% of target
  dimensions: ["region", "plan_tier", "cohort_month"]
  caveats:
    - "Excludes one-time setup fees"
    - "Currency normalized to USD at month-end rate"
```

**11 required fields:** `name`, `owner`, `purpose`, `formula`, `data_source`, `granularity`, `target`, `warning_threshold`, `critical_threshold`, `dimensions`, `caveats`

---

## Metric Triad

Every dashboard should identify three metric levels. Never include more than 3 primary metrics on one page.

| Level | Role | Characteristics |
|---|---|---|
| **Primary** | The headline number the audience cares most about | One per page; drives the visual hierarchy |
| **Secondary** | Context or breakdown that explains the primary | 2–4; support cards or trend charts |
| **Guardrail** | A metric that must stay healthy; not the focus but monitored | 1–2; shown as small KPI cards or conditional-format columns |

**Example — Revenue dashboard:**
- Primary: Total Revenue (vs. target)
- Secondary: Revenue by Region, Revenue YoY%
- Guardrail: Gross Margin % (ensure growth isn't at margin cost), Return Rate

---

## Threshold Lint Rules

Surface these as spec warnings before emitting a `DashboardSpec`:

| Rule | Check |
|---|---|
| Warning ≥ Critical | `warning_threshold` must be closer to target than `critical_threshold` (for "lower is bad" metrics) |
| Target = 0 | A target of exactly 0 is almost certainly a placeholder — ask the user for the real target |
| Granularity mismatch | If `granularity: "monthly"` but the date table has daily rows, the measure will need a CALCULATE wrapper |
| Missing caveats | Metrics with "excluding" language in the formula that have no `caveats` entry are likely missing documentation |
| Dimension not in model | Every dimension listed must have a corresponding column verified by `pbi_dax_reference_check` |

---

## RAG Threshold Conventions

Standard RAG colors and logic for Power BI conditional formatting:

```
Green  (#28A745): actual ≥ warning_threshold
Yellow (#FFC107): critical_threshold ≤ actual < warning_threshold
Red    (#DC3545): actual < critical_threshold
Gray   (#6C757D): data unavailable or measure is BLANK
```

For "lower is better" metrics (e.g., error rate, churn %): invert the thresholds.

---

## Self-Service BI Maturity Model

Used to calibrate dashboard complexity to audience capability:

| Level | Capability | Dashboard implications |
|---|---|---|
| L1 — Consumers | View and filter | Pre-filtered views, no complex slicers, PDF export |
| L2 — Explorers | Ad-hoc queries | Slicers, drill-through, basic what-if |
| L3 — Builders | Design dashboards | Editable reports, calculated fields, bookmarks |
| L4 — Modelers | Define data models | Semantic layer, measures, RLS, calculated tables |

---

## Chart Selection Matrix

| Data question | Primary chart | Alternative |
|---|---|---|
| Trend over time | Line | Area |
| Part of whole | Donut / Treemap | Stacked bar |
| Comparison across categories | Bar / Column | Bullet chart |
| Distribution | Histogram | Box plot |
| Relationship | Scatter | Bubble |
| Geographic | Choropleth | Filled map |
| KPI vs target | Card with trend sparkline | Gauge |

---

## Hypothesis Framing Template

Use when the purpose field is vague. Frames the metric as a testable business question:

```
We believe that [audience] needs to know [metric name]
because [decision it supports].
We will know this is valuable when [observable outcome].
Success threshold: [target / warning / critical values].
```

**Example:**
```
We believe that the sales leadership team needs to know Monthly Win Rate
because it drives territory headcount and quota decisions.
We will know this is valuable when leaders can identify underperforming regions
before the monthly review cycle.
Success threshold: target 35%, warning 30%, critical 25%.
```

---

## Dashboard Layout Default

Apply unless user specifies a different structure:

```
+--------------------------------------------------------------+
|  [Primary KPI card]  [Secondary KPI]  [Secondary KPI]       |
+--------------------------------------------------------------+
|  [Trend chart — primary metric, 12 months]                   |
+--------------------------------------------------------------+
|  [Breakdown by top dimension]  |  [Guardrail metric cards]  |
+--------------------------------------------------------------+
|  [Detail table with export]                                   |
+--------------------------------------------------------------+
```

- KPI row top-left
- Summary → trend → breakdown → detail (top to bottom)
- 5–8 visualizations per page maximum
- Related metrics grouped; white space separates logical sections
