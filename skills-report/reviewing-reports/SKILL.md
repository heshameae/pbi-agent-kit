---
name: reviewing-reports
description: "Use when reviewing, auditing, or checking the quality of a Power BI report. Triggers on: review my report, audit a report, report health check, report design review, check accessibility, contrast/WCAG check, thin-vs-thick report, broken field bindings, empty visuals, too many visuals, theme compliance, stale formatting overrides, report performance review, slow visuals, pre-release report gate, report-side BPA violations."
user-invocable: false
---

# Reviewing Power BI Reports

Structured evaluation of Power BI reports against design, data-binding, accessibility, performance, and governance standards. Produces actionable findings with prioritized recommendations. This is the report-side counterpart to `reviewing-models`.

## When to Use

- When the user asks to "review", "audit", or "check" a report
- Before a release or handoff (pre-publish gate)
- When assessing whether an existing report is worth maintaining
- When investigating slow visuals or report load times
- When checking accessibility, contrast, or colour-vision-deficiency safety
- When checking theme compliance or stale formatting overrides
- When the user asks about broken bindings, empty visuals, or thin-vs-thick reports

## When NOT to Use

- Authoring or modifying report visuals/pages → load the report authoring skills
- Reviewing the semantic model behind the report → load `reviewing-models`
- DAX measure optimization → load `authoring-measures`
- Planning a new dashboard from scratch → load `planning-dashboards`

## Quick Reference

| Topic | Reference |
|---|---|
| Full review check catalog (six dimensions, severity levels, WCAG, BPA) | `references/check-catalog.md` |
| Output format: severity-count table, grouped findings, two-stage review | `references/output-format.md` |
| Semantic model review (run in parallel when model is in scope) | `../reviewing-models/SKILL.md` |

## Review Workflow

### Step 0: Scope and Context

Before evaluating anything, clarify what the user wants reviewed.

**Ask the user:**
- Single report or workspace-wide audit?
- Which dimensions matter most? (usage, design, performance, accessibility, all?)
- Is there a specific concern prompting the review?
- Do they have access to the underlying semantic model, and are they the developer of both the report and model, or only one?
- Where should findings be documented?

Then determine the report's lifecycle stage — this gates which dimensions apply:

| Stage | Usage data? | What to review |
|---|---|---|
| **Development** | No | Design, data binding, performance, accessibility, structure |
| **Testing** | Partial | All of the above + verify testers are actually testing |
| **Production** | Yes | All dimensions including full usage, distribution, and export analysis |

Many report symptoms ((Blank) values, slow visuals, missing fields) originate in the model. If the model is in scope, run `reviewing-models` in parallel.

### Step 1: Run Deterministic Checks First

**Before reporting any finding**, run the deterministic tooling to get ground-truth structural data. Attribute every finding to actual tool output — do not infer from intuition.

- `pbi_report_validate` — JSON schema + PBIR structure + field references against the connected model (broken/orphaned bindings, hidden fields)
- `pbi_spec_validate` — spec-compliance pass (Stage 1 of the two-stage review)
- The report-side BPA surface — layout, accessibility, formatting-hygiene, and field-binding rule sweep
- `pbi_report_info` / `pbi_visual_list` / `pbi_theme_get` — inventory of pages, visuals, bindings, and the active theme

### Step 2: Two-Stage Review

Run the review in two stages (see `references/output-format.md`):

1. **Stage 1 — Spec compliance.** Does the report match the agreed spec / requirements? Validate structure, bindings, and that every required element is present and resolves before any quality judgement.
2. **Stage 2 — Quality.** Only once compliance passes, evaluate design, accessibility, performance, and governance against the check catalog.

### Step 3: Audit Against Check Catalog

Walk through each applicable dimension in `references/check-catalog.md`, scoring each finding by severity P0–P3. The six dimensions:

1. **Usage and Adoption** — the most objective signal of report value (production only)
2. **Design and Layout** — titles, spacing, 3/30/300 gradient, chart selection, ≤12–15 visuals, no empty visuals, sort, theme
3. **Data Model Binding** — thin report, bindings resolve, extension measures sparingly, measures-vs-columns, no stray visual-level filters
4. **Performance** — load-time percentiles, visual complexity, hidden query overhead
5. **Report Metadata and Governance** — thin/thick, endorsement, sensitivity, pipeline, distribution
6. **Accessibility, Standards, and Documentation** — WCAG contrast, colour-not-alone, alt text, font legibility

### Step 4: Report Findings

Produce output per `references/output-format.md`:
- Summary table of finding counts by severity (P0/Critical → P3/Low)
- Per-finding: `[Category]` + location + concrete fix
- Errors grouped first, then by dimension; lead with the most impactful findings
- Prioritized action list

## Critical Rules

- **Deterministic-first:** Run `pbi_report_validate` and the report-side BPA sweep before reporting any structural finding. Never report bindings, hidden fields, or layout issues from intuition alone. Attribute findings to the tool and use its output verbatim — do not re-walk a folder the validator already covered.
- **Cannot assert "looks good":** An agent cannot certify that a report "looks good" or "is good." Present deviations from best practice as observations and suggestions, ask whether each is intentional, and spar with the user rather than gatekeep. Best practices are defaults, not mandates.
- **Confirm font sizes:** Always confirm font-size readability with the user — the agent tends to underestimate whether fonts are large enough. Never assert design competence from a screenshot alone.
- **Watch for anomalies:** When viewing the report, keep a keen eye for (Blank) values, repeating/inflated values, and query errors — but flag model-origin symptoms for model-level investigation rather than asserting a verdict.
- **No evidence-free performance claims:** Do not recommend performance optimizations without evidence. Offer to infer the visual's query and test it; test multiple times; revert if testing shows no meaningful improvement.
- **Context-sensitive severity:** A missing page title is higher severity for a production executive report than a private draft. Do not apply rigid thresholds; scope severity to audience, purpose, and lifecycle stage.
