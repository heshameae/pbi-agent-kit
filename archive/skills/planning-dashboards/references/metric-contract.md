# Metric Contract

KPI definition template, metric triad, threshold lint, and hypothesis framing for Power BI dashboards.

**Source:** claude-skills-borghei business-intelligence · planning-dashboards design principles

---

## KPI Definition Template

Fill one block per metric. Every metric in a `DashboardSpec` must have a complete contract before measures are authored.

```yaml
kpi:
  name: "<Business Metric>"
  owner: "<Business Owner>"
  purpose: "<Decision this metric supports>"
  formula: "<Confirmed model measure or source-field formula>"
  data_source: "<Confirmed table/source>"
  granularity: "<Confirmed grain>"
  target: "<Confirmed target, if one exists>"
  warning_threshold: "<Confirmed warning threshold, if applicable>"
  critical_threshold: "<Confirmed critical threshold, if applicable>"
  dimensions: ["<Confirmed dimension 1>", "<Confirmed dimension 2>"]
  caveats:
    - "<Known caveat or empty list>"
```

**Required fields:** `name`, `owner`, `purpose`, `formula`, `data_source`, `granularity`, `dimensions`, `caveats`.

`target`, `warning_threshold`, and `critical_threshold` are required only when a target/comparison exists in the model/spec/user request. Never invent them.

## Measure Intent Status

Every KPI contract maps to a measure intent with `draft` or `confirmed` status. `draft` means the metric can be discussed but not written or bound; keep the `DashboardSpec` at `needs-user-input` and include `clarifyingQuestions`. `confirmed` requires user confirmation or a governed data dictionary/glossary plus live model evidence for source refs.

Do not infer formulas from column names, domain terms, or existing DAX. Time-intelligence metrics require confirmed Date policy, Date table proof, grain proof where relevant, fiscal/calendar policy, and incomplete-period behavior before measure writes.

---

## Metric Triad

Every dashboard should identify three metric levels. Never include more than 3 primary metrics on one page.

| Level | Role | Characteristics |
|---|---|---|
| **Primary** | The headline number the audience cares most about | One per page; drives the visual hierarchy |
| **Secondary** | Context or breakdown that explains the primary | 2–4; support cards or trend charts |
| **Guardrail** | A metric that must stay healthy; not the focus but monitored | 1–2; shown as small KPI cards or conditional-format columns |

**Example — Metric triad shape:**
- Primary: `<Headline Metric>` (with target only if confirmed)
- Secondary: `<Metric by Confirmed Axis>`, `<Metric Period Comparison if confirmed>`
- Guardrail: `<Risk/Quality Metric>` (monitors unintended side effects)

---

## Threshold Lint Rules

Surface these as spec warnings before emitting a `DashboardSpec`:

| Rule | Check |
|---|---|
| Warning ≥ Critical | `warning_threshold` must be closer to target than `critical_threshold` (for "lower is bad" metrics) |
| Target = 0 | A target of exactly 0 is almost certainly a placeholder — ask the user for the real target |
| Granularity mismatch | If the requested metric grain and date axis may differ, run the model/date-grain planner and block or document the metric until the intended grain is proven. Do not infer the fix from prompt wording. |
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

**Placeholder example:**
```
We believe that [audience] needs to know [confirmed metric]
because it drives [confirmed decision].
We will know this is valuable when [observable outcome].
Success threshold: [confirmed target], warning [confirmed warning], critical [confirmed critical].
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
