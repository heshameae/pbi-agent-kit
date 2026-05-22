---
name: planning-dashboards
description: "Use when planning a Power BI dashboard — clarifying what measures are needed, defining KPIs with targets and RAG thresholds, discovering what the model can support via INFO.* queries, or translating a business question into a validated DashboardSpec before writing any measures"
user-invocable: false
---

# Planning Dashboards

Read-only planning discipline: clarify the need, define the KPI contract, discover the model, emit a `DashboardSpec`. Never build before the plan is validated.

## When to Use

- User asks "plan a dashboard", "what measures do I need for X", "help me design a report"
- Before any dashboard build — intake and KPI definition must precede any `pbi_measure_create` call
- When handling a vague prompt ("make me a nice dashboard" / "create something with KPIs")
- During model discovery (understanding what tables, measures, relationships exist)
- When producing a `DashboardSpec` for the `model-builder` agent to consume

## When NOT to Use

- Actual visual binding or report building → `report-builder` agent
- Authoring DAX measures → load `authoring-measures`
- TMDL structure authoring → load `modeling-semantic-model`
- Model quality review → load `reviewing-models`

## Quick Reference

| Topic | Reference |
|---|---|
| Clarifying questions, propose-before-building, sensible defaults | `references/intake-protocol.md` |
| KPI definition template, metric triads, threshold lint | `references/metric-contract.md` |
| INFO.* model discovery queries, anti-fabrication invariant | `references/model-discovery.md` |

## Minimum Viable Questions

When a prompt lacks ≥2 of: specific measures, audience/decision context, structure, formatting — ask only three:

1. **What decisions does this report support?** (reveals audience, KPIs, level of detail)
2. **Which 2–3 measures matter most?** (if the user can't name them, probe the model)
3. **Any style or brand preferences?** (if none, apply the professional default)

If the user deflects ("just make it look good"), proceed with sensible defaults — but flag the result as a starting point.

## Sensible Defaults

| Decision | Default | Rationale |
|---|---|---|
| Theme | Professional default (check if one exists) | Consistent typography |
| Layout | KPI row → trend chart → breakdown → detail table | Follows 3-30-300 |
| Page size | 1280×720 | Standard 16:9 |
| KPI selection | Top measures by business importance from the model | Propose before building |
| Time granularity | Monthly if yearly filter context; weekly/daily if monthly | Match grain to decision cadence |
| Conditional formatting | Gap/variance columns only | Formatting everything = formatting nothing |
