# Intake Protocol

Discipline for turning vague dashboard requests into a validated plan before building anything.

## When to Route Here

Route here when the user's prompt lacks **two or more** of:
- Specific measures or KPIs to show
- A target audience or decision context ("for the CFO", "for weekly ops review")
- Structural preferences (page count, visual types, layout)
- Formatting direction (colors, style, brand)

Prompts like "create a sales dashboard", "build me a report with some KPIs", or "make a fancy executive dashboard" all qualify.

---

## Step 1 — Acknowledge and Reframe

Do not lecture or refuse to work. Explain briefly that a few specifics will dramatically improve the result, then ask targeted questions. Frame it as collaboration, not gatekeeping.

> "I can build this; a few details will make it much better. What decisions should this report help someone make? And which 2–3 numbers matter most?"

---

## Step 2 — Ask the Minimum Viable Questions

**Three questions are enough to start.** Do not interview the user with 10 questions.

1. **What decisions does this report support?** This reveals audience, KPIs, and appropriate level of detail.
2. **Which 2–3 measures matter most?** If the user can't name them, explore the model and propose candidates.
3. **Any style or brand preferences?** Colors, fonts, existing reports to match. If none, apply the professional default.

If the user still deflects ("just make it look good"), proceed with sensible defaults — but flag the result as a starting point to iterate on, not a finished product.

---

## Step 3 — Apply Sensible Defaults

| Decision | Default | Rationale |
|---|---|---|
| Theme | Check if a theme is applied; if not, apply the standard professional theme | Typography and colors |
| Layout | Executive dashboard pattern (KPI row → trend chart → breakdown → detail table) | Most broadly useful; follows 3-30-300 |
| Page size | 1280×720 | Standard 16:9 |
| KPI selection | Top measures by business importance from the model | Explore and propose before building |
| Time granularity | Monthly if yearly filter context; weekly/daily if monthly | Match grain to decision cadence |
| Conditional formatting | Gap/variance columns only; theme sentiment colors | Formatting everything means formatting nothing |

---

## Step 4 — Propose Before Building

Always present a concrete proposal before executing. Include:
- Which KPI cards and what measures they display
- What chart types and what dimensions they break down by
- What detail table or matrix columns to include
- How filters scope the data
- The theme and color approach

**Revising a plan is cheap; rebuilding visuals is expensive.**

---

## Audience Archetypes

| Audience | Primary questions | Visual preference | Detail level |
|---|---|---|---|
| Executive | "Are we on track?" "What needs my attention?" | KPI cards, RAG status, 1–2 trend lines | Summary only |
| Analytical | "Why is this happening?" "What's the breakdown?" | Tables, small multiples, drill-through | Full detail |
| Operational | "What do I act on today?" "Who needs follow-up?" | Real-time lists, status indicators, mobile-friendly | Action-oriented |

---

## What Not to Do

- Do not refuse to work because the prompt is vague
- Do not generate a 10-question interview; three targeted questions are enough
- Do not build a generic report and call it done; iterate toward specifics
- Do not assume the user's reluctance means they don't care; they likely can't yet articulate it in report-design terms

---

## Insight Delivery

A finding is only useful once it is framed for a decision. Structure every insight using **What / So What / Now What**, backed by evidence and a confidence rating. Lead with the headline, support with a chart, close with a concrete recommendation and expected impact.

| Part | Meaning |
|---|---|
| **Headline** | An action-oriented statement of the finding, not a topic label |
| **What** | One-sentence description of the observation |
| **So What** | Why it matters to the business — revenue, retention, cost |
| **Now What** | Recommended action with expected impact |
| **Evidence** | The chart or table that supports the finding |
| **Confidence** | High / Medium / Low |

Template:

> **[Headline: action-oriented finding]**
> **What:** One-sentence description of the observation.
> **So What:** Why this matters to the business.
> **Now What:** Recommended action with expected impact.
> **Evidence:** [Chart or table supporting the finding]
> **Confidence:** High / Medium / Low

**Headlines are claims, not labels.** Use the formula `[Specific Number] + [Business Impact] + [Actionable Context]`.

> BAD: "Q4 Sales Analysis"
> GOOD: "Q4 Sales beat target by 23% — here's why"

For a multi-finding narrative (a QBR, an executive readout), wrap the insights in a **Situation → Complication → Resolution** arc:

1. **Situation** — the context and baseline ("Last quarter we targeted a 10% improvement in retention").
2. **Complication** — the problem or opportunity the data surfaces.
3. **Resolution** — the insight and the recommended action, quantified.

A longer presentation can follow the 6-beat narrative arc: **Hook → Context → Rising Action → Climax → Resolution → Call to Action.** Open with the surprising insight, establish the baseline, build through the data, land the key finding, recommend, then ask for the decision.

---

## Analysis Skeleton

The ordered workflow an analyst follows when turning a business question into a delivered answer. Do not skip ahead to visuals before the question is framed and the data is profiled.

1. **Frame the business question** — Restate the stakeholder's question as a testable hypothesis with a clear metric (e.g., "Did the new campaign increase 7-day retention by ≥ 5%?"). Identify the required data sources.
2. **Write and validate the query** — Filter early, aggregate late. Verify the query is correct and performant before trusting its output.
3. **Explore and profile the data** — Compute descriptive statistics (count, mean, median, quartiles). Check for nulls, duplicates, and outliers before drawing conclusions.
4. **Analyze** — Apply the method that fits the question: cohort analysis for retention, funnel analysis for conversion, hypothesis testing for group comparisons, regression for relationships.
5. **Visualize** — Select the chart type that fits the data question. Start bar-chart Y-axes at zero, use ≤ 7 colors, label axes, and add benchmarks or targets for context.
6. **Deliver the insight** — Frame the result as What / So What / Now What, leading with the headline and closing with a recommendation and expected impact.

A written analysis artifact mirrors this skeleton:

> # Analysis: [Topic]
> ## Business Question — what are we trying to answer?
> ## Hypothesis — what do we expect to find?
> ## Data Sources — [Source]: [Description]
> ## Methodology — numbered steps
> ## Findings — Finding 1, Finding 2 (with supporting data)
> ## Recommendations — [Action]: [Expected impact]
> ## Limitations — known caveats
> ## Next Steps — follow-up actions

---

## Maturity Model

The self-service BI maturity ladder sets scope and expectations: who the audience is determines what they can do with the dashboard, and therefore how much you build for them versus enable them to build themselves.

| Level | Persona | Users can... |
|---|---|---|
| **L1 — Consumers** | View & filter | Open dashboards, apply filters, export data |
| **L2 — Explorers** | Ad-hoc queries | Write simple queries, create basic charts, share findings |
| **L3 — Builders** | Design dashboards | Combine data sources, create calculated fields, publish reports |
| **L4 — Modelers** | Define data models | Create semantic models, define metrics, optimize performance |

Plan to the audience's level. L1 consumers need a finished, opinionated dashboard with clear defaults; L3–L4 builders need a clean semantic layer and consistent metrics they can extend. Pitching above the audience's level produces dashboards no one uses.
