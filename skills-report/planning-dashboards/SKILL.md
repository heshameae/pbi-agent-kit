---
name: planning-dashboards
description: "Use when planning a Power BI dashboard — clarifying what measures are needed, defining KPIs with targets and RAG thresholds, discovering what the model can support via INFO.* queries, or translating a business question into a validated DashboardSpec before writing any measures"
user-invocable: false
---

# Planning Dashboards

Read-only planning discipline: clarify the need, define the KPI contract, discover the model, emit a `DashboardSpec`. Never build before the plan is validated. Never use Python or file scripts to inspect Power BI data/model/report artifacts; use MCP discovery and deterministic planners.

## When to Use

- User asks "plan a dashboard", "what measures do I need for X", "help me design a report"
- Before any dashboard build — intake and KPI definition must precede any `pbi_measure_create` call
- When handling a vague prompt ("make me a nice dashboard" / "create something with KPIs")
- During model discovery (understanding what tables, measures, relationships exist)
- When producing a `DashboardSpec` for the `model-builder` agent to consume

## When NOT to Use

- Actual visual binding or report building → in the modeling-only beta, say report/PBIR authoring is unavailable and offer modeling-only preparation. Internal dogfood full-profile report builds route to `report-builder`.
- Authoring DAX measures → load `authoring-measures`
- TMDL structure authoring → load `modeling-semantic-model`
- Model quality review → load `reviewing-models`

## Quick Reference

| Topic | Reference |
|---|---|
| Clarifying questions, propose-before-building, layout/theme defaults | `references/intake-protocol.md` |
| KPI definition template, metric triads, threshold lint | `references/metric-contract.md` |
| INFO.* model discovery queries, anti-fabrication invariant | `references/model-discovery.md` |
| Confirmed measure intent, data dictionary/glossary grounding, draft vs confirmed status | `../authoring-measures/references/measure-intent-contract.md` |
| Banking KPI ambiguity prompts; question bank, not a formula library | `references/banking-kpi-guidance.md` |

## Minimum Viable Questions

Always run the semantic clarification gate before model or report writes. If any answer would change the numbers, model shape, date table, filters, or visual interpretation, ask before building. If live discovery and the validated spec already prove the answer, state the proven assumption instead of asking.

Measure planning must produce measure intent evidence. Use live model discovery plus any user-owned data dictionary/glossary to separate `draft` from `confirmed` definitions. A planned measure, target, RAG threshold, or time-intelligence comparison that is still `draft` keeps the `DashboardSpec` at `needs-user-input`; never infer the formula, source refs, grain, filters, additivity, or fiscal/calendar behavior from names or domain convention.

When a prompt lacks ≥2 of: specific measures, audience/decision context, structure, formatting — ask only three:

1. **What decisions does this report support?** (reveals audience, KPIs, level of detail)
2. **Which 2–3 measures matter most?** (if the user can't name them, probe the model)
3. **Any style or brand preferences?** (if none, apply the professional default)

If the user deflects ("just make it look good"), use defaults only for layout/theme. KPI selection, fields, and filters must come from live model discovery or a validated spec. Date policy must be explicit before a new Date table is created; the builder should use `pbi_date_table_create_governed`, not generic table creation. Date grain must come from `pbi_model_plan_date_table` / `pbi_model_plan_date_grain` proof when semantic-model date fields are involved; otherwise return `needs-user-input` or `blocked`. If Date proof is blocked, do not use `pbi_dax_query` as a fallback and do not provide manual DAX; keep the spec blocked.

## Semantic Integrity Questions

For actuals-vs-targets, budget-vs-actuals, forecast comparisons, date-table work, or any request that changes relationships/measures used by visuals, ask the missing questions from this checklist before any write:

1. **Source of actuals and targets:** Which model-confirmed table/measure/column is the actual, and which is the target/budget/forecast?
2. **Date policy:** Should the Date table cover observed fact min/max only, full calendar years around observed data, a future horizon with explicit `futureHorizonDays`, or a user-specified range?
3. **Grain and missing dates:** What grain should the comparison respect (day, week, month, fiscal period), and should missing target dates show blank, zero, allocation, or carry-forward?
4. **Source-of-truth dimensions:** Which shared dimensions should report authors use for slicing, and which duplicate fact-side keys should be hidden?
5. **Audience and decision:** Who will use the dashboard, and what decision should the visual support?
6. **Measure intent evidence:** Which measure definitions are confirmed, which are draft, and what data dictionary/glossary or user confirmation proves the business meaning?

Keep it short: ask only the unanswered items that can change results. Use `clarifyingQuestions` in the `DashboardSpec` when blocked by missing semantics.

Do not ask for confirmation of facts already proven by deterministic tools. Do ask when the only evidence is a prompt phrase, an existing workaround measure, a sample row, or a field name.

Never invent arbitrary Date bounds, literal `CALENDAR(DATE(...), DATE(...))` examples, `TODAY()` anchors, fiscal settings, target allocation logic, or target source columns to avoid asking.

## Sensible Defaults

| Decision | Default | Rationale |
|---|---|---|
| Theme | Professional default (check if one exists) | Consistent typography |
| Layout | KPI row → trend chart → breakdown → detail table | Follows 3-30-300 |
| Page size | 1280×720 | Standard 16:9 |
| KPI selection | From validated spec, live model discovery, or explicit user confirmation | Never invent KPIs |
| Time granularity | From `pbi_model_plan_date_table` / `pbi_model_plan_date_grain` proof for semantic-model date fields; otherwise preserve validated spec grain and block if proof is unavailable. Do not use `pbi_dax_query` as a fallback or provide manual DAX. | Never default to monthly |
| Conditional formatting | Gap/variance columns only | Formatting everything = formatting nothing |
