# Mining findings: borghei/Claude-Skills — data-analytics/BI domain
Source: claude-skills-borghei.xml

## Relevance summary
This repo is a department-organized business-skills collection; for our purposes the `data-analytics/` skills (`business-intelligence`, `data-analyst`, `analytics-engineer`) plus four analytics-flavored siblings (`marketing/campaign-analytics`, `marketing/marketing-analyst`, `hr-operations/people-analytics`, `product-team/ab-test-setup`) carry genuine, reusable **BI/analytics domain methodology** — not Power BI authoring, but the upstream discipline our `data-analyst` agent and `bi-pattern-library` / `kpi-design-rules` / `audience-styles` skills are weak on. The highest-value content is process/framework prose: a 6-step "clarify the reporting need → define KPIs → design layout → semantic layer → automate → validate" BI workflow, a fill-in **KPI definition template** (owner/formula/granularity/RAG thresholds/caveats), an **audience-tiering / analytics-maturity model** (consumer→explorer→builder→modeler; operational→predictive→prescriptive), a rigorous **clarifying-question / hypothesis protocol** (ab-test "Because…we believe…will cause…for…" template + primary/secondary/guardrail metric split), and the Situation-Complication-Resolution / What-So What-Now What storytelling structure. All Python/dbt/scipy/sklearn code is reference-only (not Node/TS, not authoring). The benchmark/formula tables are domain-generic but several embed specific dollar/percent values and one example ("Monthly Recurring Revenue", AdventureWorks-free but still a concrete metric) — treat as illustrative templates, never hardcode.

## High-value extractions

### BI workflow + audience-first "clarify the reporting need" gate → maps to data-analyst agent, bi-pattern-library, audience-styles
- **What it is / why valuable**: The `business-intelligence` SKILL opens with a 6-step workflow whose step 1 is exactly our clarifying-question protocol, and it leads with **audience** as the first discriminator — the framing our `data-analyst` (plans dashboards, asks clarifying questions) agent should run before any modeling/authoring.
- **Key content** (reusable, generalized):
  - Workflow: (1) **Clarify the reporting need** — identify audience (executive / operational / self-service), the key questions the dashboard must answer, and the refresh cadence; validate required data sources exist and are accessible. (2) Define KPIs & metrics (formula, source, granularity, owner, RAG thresholds). (3) Design layout (visual hierarchy, chart-selection matrix, **5–8 visuals/page max**). (4) Build the semantic layer so consumers get consistent numbers. (5) Automate delivery + threshold alerts. (6) Validate KPI values against source-of-truth queries; load-time target < 5 s; iterate on feedback.
  - The three audience archetypes (executive / operational / self-service) are the seed for an `audience-styles` taxonomy.
- **Source path**: `data-analytics/business-intelligence/SKILL.md`
- **Quality**: 5 — directly maps to the clarifying-question protocol and audience framing; platform-agnostic prose.
- **Recommendation**: adapt (port step 1 verbatim into the data-analyst agent's intake; reuse the audience trichotomy in audience-styles).

### KPI / metric definition discipline (template + validation rules) → maps to kpi-design-rules, data-analyst agent
- **What it is / why valuable**: The single most directly reusable artifact for `kpi-design-rules`. A fill-in KPI contract plus a validator's notion of "complete" metric definitions and threshold logic. This is the metric-definition rigor our plugin lacks.
- **Key content** (paste/adapt; values are illustrative only):
  - KPI definition contract (every metric must declare): `name, owner, purpose, formula, data_source, granularity, target, warning_threshold (~90% of target), critical_threshold (~80%), dimensions[], caveats[]`. Example caveats: "Excludes one-time setup fees", "Currency normalized to USD at month-end rate".
  - RAG status colors (generic palette, adapt to theme): Green `#28A745` | Yellow `#FFC107` | Red `#DC3545` | Gray `#6C757D`.
  - Validation rules (`metric_validator` intent — adopt as kpi-design-rules lint checks): every KPI has a defined owner + target + RAG thresholds; warning/critical thresholds must be internally consistent (critical < warning < target); the declared formula must match the declared aggregation; flag seasonal mis-calibration of thresholds (use rolling baselines).
  - Anti-pattern flagged: KPI values differ between dashboard and source because the dashboard applies extra filters/currency/calculated fields → **centralize all metric logic in the semantic layer; remove report-level computed fields** (this is our "measures live in the model, not the visual" rule, stated as domain principle).
- **Source path**: `data-analytics/business-intelligence/SKILL.md` (KPI template, troubleshooting + success-criteria tables)
- **Quality**: 5. **Recommendation**: adapt (turn the contract into a kpi-design-rules checklist; the threshold-consistency + formula-matches-aggregation checks are good model/measure lint rules).

### "Frame the business question as a testable hypothesis" + What/So What/Now What delivery → maps to data-analyst agent (clarifying-question protocol + insight framing)
- **What it is / why valuable**: The `data-analyst` SKILL's Frame→Query→Explore→Analyze→Visualize→Deliver loop and its insight templates give our agent a concrete way to convert a vague stakeholder ask into a measurable spec and to frame the eventual narrative — both ends of the dashboard-planning conversation.
- **Key content** (reusable):
  - Step 1 framing rule: restate the stakeholder's question as a **testable hypothesis with a clear metric** — e.g. "Did campaign X increase 7-day retention by ≥ 5%?" Identify required data sources.
  - Insight delivery template (adopt for report-builder annotations / data-analyst summaries): `## [Headline: action-oriented finding]` then **What** (one-sentence observation) / **So What** (why it matters: revenue, retention, cost) / **Now What** (recommended action + expected impact) / **Evidence** (chart/table) / **Confidence** (High/Medium/Low).
  - Analysis framework skeleton: Business Question → Hypothesis → Data Sources → Methodology → Findings → Recommendations → Limitations → Next Steps.
  - Chart-selection matrix (generic, reinforces our table/kpi/layout design): trend→line(area); part-of-whole→donut(stacked bar); comparison→bar(column); distribution→histogram(box); correlation→scatter(heatmap); geographic→choropleth(bubble). Design rules: Y-axis at zero for bars, ≤ 7 colors, label axes, include benchmark/target for context, **avoid 3D and >5-slice pies**.
- **Source path**: `data-analytics/data-analyst/SKILL.md`
- **Quality**: 5 — the hypothesis-framing + What/So What/Now What is exactly the clarifying-question + insight protocol; chart matrix is a useful (if generic) cross-check.
- **Recommendation**: adapt (intake + insight templates → data-analyst agent; chart matrix → reference cross-check only, our bi-pattern-library/data-goblin sources are deeper).

### Semantic-layer = single source of truth (metric registration) → maps to analytics-engineering practices, tmdl-conventions, dax-patterns
- **What it is / why valuable**: The `analytics-engineer` SKILL frames the semantic layer as the governance boundary where metrics are registered once with time grains + dimension slices — the conceptual parallel to TMDL measures/calc-groups being the model's single source of truth. The dbt/SQL implementation is reference-only (not Node/TS), but the *principle and the metric-registration shape* transfer.
- **Key content** (concept, not code):
  - Workflow step "Define semantic-layer metrics": register metrics (sum / average / count_distinct) with **time grains and dimension slices** so BI consumers get one consistent number.
  - Metric definition shape (maps conceptually to a TMDL measure + its allowed dimensions/time intelligence): `name, label, model/table, calculation_method, expression, timestamp (date column), time_grains: [day,week,month,quarter,year], dimensions: [...], filters: [...]`.
  - Hard rule echoed across BI + analytics-engineer + marketing-analyst skills: **no ad-hoc metric calculations in BI tools** — if dashboard numbers diverge from the semantic layer, move the logic into the layer. (Reinforces our "calculate in the model" stance from the domain side.)
  - Materialization-strategy idea (loose analogy for aggregations/import-vs-direct-query, not a direct map): thin views for staging, table for small consumption marts, incremental for large facts.
- **Source path**: `data-analytics/analytics-engineer/SKILL.md` (semantic-layer metric definition section; success criteria "semantic-layer metrics are the single source of truth")
- **Quality**: 4 — strong principle; the metric-registration shape is a useful template for how we describe measures + their valid dimensions/time grains. dbt/Jinja/SQL bodies are reference-only.
- **Recommendation**: reference-only for code; **adapt** the "register a metric with its time grains + allowed dimension slices" shape and the single-source-of-truth principle into tmdl-conventions / dax-patterns / ai-readiness narrative.

### Analytics-maturity / self-service tiering → maps to audience-styles, ai-readiness, kpi-design-rules
- **What it is / why valuable**: Two complementary maturity ladders that give `audience-styles` a principled way to tune dashboards to consumer sophistication, and give `ai-readiness` a vocabulary for "what questions can this model answer."
- **Key content** (reusable verbatim, generalized):
  - BI self-service maturity (audience capability tiers): **L1 Consumers** (view & filter, export) → **L2 Explorers** (ad-hoc queries, basic charts) → **L3 Builders** (combine sources, calculated fields, publish) → **L4 Modelers** (define semantic models, metrics, optimize).
  - People-analytics maturity (question sophistication): **L1 Operational Reporting** ("how many?") → **L2 Advanced Reporting** (dashboards/trends/segmentation, "how has X changed?") → **L3 Analytics** (correlation/root cause, "what drives X?") → **L4 Predictive** ("who is likely to…?") → **L5 Prescriptive** ("what should we do?"). Map each level to "typical questions answered" — directly useful for ai-readiness scoring and for the data-analyst agent to set scope.
- **Source path**: `data-analytics/business-intelligence/SKILL.md` (Self-Service BI Maturity Model); `hr-operations/people-analytics/SKILL.md` (Analytics Maturity Model)
- **Quality**: 5 — clean, domain-generic ladders that fill a real gap in audience-styles / ai-readiness.
- **Recommendation**: adopt-as-is (as reference tables in audience-styles + ai-readiness, with our terminology).

### Clarifying-question / hypothesis rigor + guardrail-metric framework → maps to data-analyst agent (clarifying-question protocol), kpi-design-rules
- **What it is / why valuable**: `ab-test-setup` has the most disciplined "turn a fuzzy ask into a measurable spec" content in the corpus. Even though we don't run experiments, the **hypothesis template**, the **good-vs-bad question table**, and the **primary/secondary/guardrail metric split** are gold for the data-analyst agent's clarifying questions and for kpi-design-rules (a dashboard should declare what must NOT get worse, not just the headline metric).
- **Key content** (paste/adapt):
  - Hypothesis template: *"Because [observation/data], we believe [specific change] will cause [measurable outcome] for [defined audience]. We'll know this is true when [primary metric] changes by [minimum detectable effect]. We'll watch [guardrail metrics] to ensure no negative impact."*
  - Good-vs-bad framing (use to coach the agent's questions): bad = "button color might increase clicks" (no data basis, no target, no measurement plan); good = data-backed + specific change + measurable outcome + defined audience + guardrail.
  - Three metric roles every dashboard/analysis should name: **Primary** (1 only — determines success, tied to the question), **Secondary** (2–3 — explain *why* the primary moved), **Guardrail** (1–3 — must NOT get worse; e.g. error rate, load time, refund rate).
  - "Hypothesis sources" table (where dashboard requirements come from): analytics drop-offs, user research, support tickets, competitor analysis, sales objections — a useful prompt-list for the data-analyst's intake interview.
  - Analysis-discipline checks worth surfacing as caveats: effect-size-meaningfulness (a "significant" 0.1% lift may not be worth shipping), **Simpson's paradox** (aggregate hides segment reversal → always check key segments), survivorship bias (include all users from assignment point).
- **Source path**: `product-team/ab-test-setup/SKILL.md`
- **Quality**: 5 — the hypothesis template + primary/secondary/guardrail split directly upgrade the clarifying-question protocol and KPI discipline.
- **Recommendation**: adapt (bake hypothesis template + metric-role split into the data-analyst agent's clarifying-question flow; "declare guardrail metrics" → kpi-design-rules).

### Funnel & root-cause analysis framing + prioritization → maps to bi-pattern-library, data-analyst agent
- **What it is / why valuable**: `campaign-analytics` funnel framework + `people-analytics` root-cause example give `bi-pattern-library` named, reusable analytical *patterns* (funnel, cohort/retention, root-cause segmentation) and a way to prioritize what to build.
- **Key content** (reusable):
  - Standard funnel pattern: Awareness → Interest → Consideration → Intent → Purchase → Retention; each transition is a conversion point; identify the largest absolute and relative drop-offs (bottleneck detection). Bottleneck diagnosis loop: Quantify (vs history + benchmark + absolute lost) → Segment (channel/device/geo/cohort/campaign) → Identify root cause → Prioritize.
  - **ICE prioritization** (also in ab-test-setup) for choosing which pattern/fix to build: Score = (Impact + Confidence + Ease) / 3 — a lightweight ranking the data-analyst can use when scoping a dashboard backlog.
  - **2×2 Impact-vs-Score** matrix (people-analytics survey driver analysis) — "high impact, low score = priority" — a generic pattern for any prioritization visual.
  - Root-cause report skeleton (people-analytics): Question → Data (sources + n) → Analysis (segmentation + drivers) → Findings → Recommendations → Expected Impact (with ROI). A clean template for a data-analyst narrative.
  - Anti-patterns worth flagging as bi-pattern-library guidance: optimizing the wrong funnel stage; aggregate hides segment differences (segment before optimizing); single-metric focus (always track **paired metrics** — e.g. CTR with CPA, conversion-rate with volume).
- **Source path**: `marketing/campaign-analytics/references/funnel-optimization-framework.md`; `marketing/campaign-analytics/SKILL.md`; `hr-operations/people-analytics/SKILL.md`; `product-team/ab-test-setup/SKILL.md` (ICE)
- **Quality**: 4 — solid named patterns + prioritization; some content is marketing-specific but the structures generalize.
- **Recommendation**: adapt (add funnel / cohort / root-cause as named entries in bi-pattern-library with the diagnose→segment→prioritize loop; ICE + paired-metrics as agent heuristics).

### Data storytelling structure (S-C-R) → maps to data-analyst agent, report-builder, audience-styles
- **What it is / why valuable**: A consistent narrative spine for executive-facing output, complementing What/So What/Now What.
- **Key content**: Situation → Complication → Resolution. Example: "Last quarter we targeted 10% retention improvement" (situation) → "Enterprise churn rose 5%, driven by 30-day onboarding delays" (complication) → "Reducing onboarding to 14 days correlates with 40% lower churn, ~$2M/yr savings" (resolution). Pair with the "so what test": **every data point in an executive report must have an actionable insight** (marketing-analyst checkpoint).
- **Source path**: `data-analytics/business-intelligence/SKILL.md`; `marketing/marketing-analyst/SKILL.md` ("so what test")
- **Quality**: 4 — generic but a clean, adoptable narrative scaffold for exec dashboards/annotations.
- **Recommendation**: adapt (storytelling scaffold for report-builder narrative blocks + audience-styles "executive" profile).

### Domain KPI/metric formula glossaries + benchmark-contextualization discipline → maps to kpi-design-rules, bi-pattern-library (reference-only data)
- **What it is / why valuable**: Several skills carry compact metric-formula tables (acquisition/engagement/retention/revenue) and a benchmarks reference. The *formulas and the "how to use benchmarks" discipline* are reusable as a starter metric glossary and as RAG-threshold guidance; the specific numbers are illustrative and must stay out of any dataset-coupled logic.
- **Key content**:
  - Cross-skill business-metric formulas (generic): CAC = S&M spend / new customers; conversion rate = conversions / visitors; DAU/MAU = daily active / monthly active; churn = lost / total at period start; MRR = SUM(active subscription amounts); LTV = ARPU × gross margin × avg lifetime; NRR = (MRR − churn + expansion) / MRR; eNPS = promoters% − detractors%; LTV/CAC > 3:1 rule of thumb.
  - Benchmark-usage discipline (the transferable part of campaign-metrics-benchmarks): **compare against your own history first, then industry**; account for seasonality; consider funnel position; "do not treat benchmarks as absolute targets — your context matters"; "your own data is the best benchmark." This is exactly the right caveat language for kpi-design-rules' target/threshold setting.
- **Source path**: `data-analytics/data-analyst/SKILL.md`; `marketing/marketing-analyst/SKILL.md`; `hr-operations/people-analytics/SKILL.md`; `marketing/campaign-analytics/references/campaign-metrics-benchmarks.md`
- **Quality**: 3 — formulas are a fine generic glossary; the dense $/% benchmark tables are marketing-specific and value-laden (illustrative only).
- **Recommendation**: reference-only (lift the generic formulas + the "benchmark against yourself first" discipline; do NOT import the numeric benchmark tables into any logic — they are dataset/industry-specific and would violate the no-hardcoding rule).

## Cross-source overlap flags
- **KPI definition + RAG thresholds**: overlaps `awesome-copilot-pbi-data` (kpi-design content) and data-goblin report sources. This source's contribution is the **upstream contract** (owner/purpose/caveats/threshold-consistency + formula-matches-aggregation lint) and the **threshold-discipline** ("benchmark against your own history first") rather than visual KPI-card styling — complementary, not duplicative. Consolidator should merge into one kpi-design-rules: card styling from data-goblin/awesome-copilot, *definition contract + validation rules* from here.
- **Audience framing**: overlaps any data-goblin/awesome-copilot "report design by audience" content. This source adds two explicit **maturity ladders** (consumer→modeler; operational→prescriptive) that are more structured than the typical exec/analyst split — recommend these become the backbone of audience-styles, with styling specifics from the PBI sources layered on.
- **Chart-selection matrix**: appears here twice (BI + data-analyst) and certainly in data-goblin/awesome-copilot visual-design guidance. Ours should defer to the PBI-specific sources; this one is a generic cross-check only.
- **"Measures live in the model, not the visual"**: this source states it as a *domain governance principle* (semantic layer = single source of truth) across 3 skills; data-goblin/awesome-copilot state it as a *Power BI implementation rule*. Use this source for the "why" narrative in tmdl-conventions / dax-patterns / ai-readiness.
- **ICE / prioritization**: appears in both ab-test-setup and campaign-analytics — single canonical entry in bi-pattern-library.

## Discarded / not relevant
- **All dbt / SQL / Jinja code** (`analytics-engineer` staging/mart/incremental models, macros, materialization configs, `assets/*.sql|*.yml`, `scripts/*.py` impact_analyzer/schema_diff/quality_scorer): non-Node/TS and warehouse-transformation, not BI authoring — reference-only at most; the *principles* were extracted above.
- **`data-scientist` SKILL + scripts** (algorithm-selection matrix, feature engineering, model evaluation, scipy/sklearn): ML modeling, out of scope for a Power BI authoring plugin. Only its "define the problem as a measurable task" framing overlaps, already covered by data-analyst.
- **`ml-ops-engineer` SKILL + scripts** (model deployment, drift detection, model registry, pipeline validation, REFERENCE.md): production ML infra — fully out of scope.
- **All Python tool implementations + CLI flag/troubleshooting tables** across every skill (`kpi_tracker.py`, `dashboard_spec_generator.py`, `metric_validator.py`, `data_profiler.py`, `query_optimizer.py`, `report_generator.py`, `attribution_analyzer.py`, `funnel_analyzer.py`, `attrition_predictor.py`, etc.): standard-library Python utilities; the *intent/rules* of metric_validator and the funnel/attribution *models* were extracted as methodology, but the code is not portable to our stack.
- **Report-automation / scheduling / governance YAML** (cron report config, threshold-alert YAML, RLS security_model YAML in BI skill): operational delivery + tool-agnostic RLS sketch; thin and not aligned to TMDL RLS — our rls-patterns sources (awesome-copilot, data-goblin) are far deeper. Discarded.
- **Marketing attribution model mechanics** (first/last/linear/time-decay/position-based credit math, GA4/HubSpot/UTM integration notes, budget-mix optimizer): channel-marketing-specific; the *funnel/cohort patterns* generalized but attribution math itself does not map to any of our components.
- **HR-specific Python** (turnover RandomForest, pay-equity OLS, survey driver regression): the *root-cause report structure* and *maturity ladder* were extracted; the predictive ML code is out of scope.
- **Repo meta** (`agents/**` cs-* advisor personas, `docs/agents/*`, `bundles.json`, top-level `CLAUDE.md`/README index, persona definitions): org-structure/marketing for the skills collection — no BI domain content; the data-analytics/CLAUDE.md skill-selection guide was read for context but contributes only the (already-noted) overlap guidance between data-analyst vs BI vs analytics-engineer.
