---
name: reviewing-models
description: "Use when reviewing, auditing, or checking the quality of a Power BI semantic model. Triggers on: review my model, check model quality, audit semantic model, AI-ready check, is my model Copilot-ready, post-write regression check, BPA violations, relationship errors, grain mismatches, validate model design, optimize my model, check for performance issues, run a best practice audit, pre-production audit."
user-invocable: false
---

# Reviewing Semantic Models

Structured evaluation of Power BI semantic models against quality, performance, and best practice standards. Produces actionable findings with prioritized recommendations.

## When to Use

- When the user asks to "review", "audit", or "check" a semantic model
- After writing measures, relationships, or structural changes (post-write regression check)
- When assessing AI/Copilot readiness of a model
- When validating a model before promotion to production
- When the user asks about BPA violations, relationship errors, or grain mismatches
- When the user asks to "optimize" a model for performance or size
- When the user asks "is my model ready for Copilot/data agents?"

## When NOT to Use

- Writing new measures or TMDL → load `modeling-semantic-model`
- DAX performance optimization of individual queries → load `authoring-measures`
- Report PBIR file authoring → no model review needed
- Planning dashboards or report scaffolding → load `planning-dashboards`

## Quick Reference

| Topic | Reference |
|---|---|
| Full 9-category audit checklist with 26+ checks and severity levels | `references/check-catalog.md` |
| Output format: Issue→Fix→Explain→Test, summary table, grouping rules | `references/output-format.md` |
| AI/Copilot readiness checklist (7 sections) | `../modeling-semantic-model/references/ai-readiness.md` |
| Performance tools matrix, cache states, testing methodology | `../modeling-semantic-model/references/performance.md` |
| Naming conventions, detection patterns, rename impact | `../modeling-semantic-model/references/naming.md` |

## Review Workflow

### Step 0: Gather Context

Before analyzing anything, collect metadata and understand the business context.

**Ask the user:**
- What business process does this model represent?
- Who are the primary consumers? (report developers, analysts, executives, AI/Copilot users?)
- Are they the developer of both the model and its reports, or only one?
- Is the model in development, testing, or production?
- Where should findings be documented?

Understanding the business context is critical. A model for 3 analysts has different requirements than one consumed by Copilot across the organization. The audit categories and their severity shift based on this context.

### Step 1: Run Deterministic Checks First

**Before reporting any finding**, run `pbi_model_check` to get ground-truth structural data from the live model. Attribute every finding to actual tool output. Do not infer or guess from partial context.

Use the available MCP tools to gather:
- `pbi_model_list_tables` — table inventory, storage mode, column counts, measure counts
- `pbi_model_list_columns` — column data types, cardinality signals, hidden/visible state
- `pbi_model_list_measures` — measure names, display folders, expressions
- `pbi_model_list_relationships` — cross-filter direction, cardinality, active/inactive
- `pbi_model_check` — structural validation pass (errors and warnings)
- `pbi_model_plan_star_schema_join` — deterministic star-schema/shared-dimension plan when findings involve conformed dimensions, MOD009/MOD010, or TREATAS bridge remediation
- `pbi_model_plan_date_table` — deterministic Date table coverage/key plan before recommending calendar range, marking, or auto-date cleanup changes
- `pbi_model_plan_date_grain` — deterministic live date-grain plan before recommending target/actual date relationship activation or removing date-truncating DAX

### Step 2: Audit Against Check Catalog

Evaluate findings across all applicable categories from `references/check-catalog.md`, ordered by severity. See that file for the complete 26-point checklist.

Quick category summary:
1. **Critical** — bidirectional rels, circular deps, missing data types, orphaned tables
2. **Memory and Size** — high-cardinality columns, unsplit DateTime, auto date/time, inappropriate types, calculated columns, unused columns
3. **Data Reduction** — unfiltered history, unnecessary columns, pre-summarization, upstream computation opportunities
4. **DAX Anti-Patterns** — table-level CALCULATE filters, missing DIVIDE(), nested iterators, ALL() misuse
5. **Measure Hygiene** — implicit measures, extension measures, duplicate/overlapping measures
6. **Documentation** — missing descriptions, missing display folders, naming convention violations
7. **Design** — star schema violations, missing/misconfigured date table, M:M without bridging, inactive orphaned relationships
8. **Direct Lake** — Delta table health, DirectQuery fallback risk
9. **AI and Copilot Readiness** — duplicate field names, missing AI instructions, inadequate descriptions

### Step 3: Performance Analysis

For performance-specific analysis, see `../modeling-semantic-model/references/performance.md`.

### Step 4: Report Findings

Produce output per the format in `references/output-format.md`:
- Summary table of finding counts by severity (Critical / Warning / Info)
- Per-finding: Issue → Fix → Explain → Test
- Errors grouped first, warnings by category, info as tally only
- Prioritized action list (critical first)

## Critical Rules

- **Deterministic-first:** Run `pbi_model_check` before reporting any model finding. Never report structural issues from intuition alone; if the tool is unavailable, report the review as blocked.
- **No Python/file-surgery fallback:** Never use `python`, `python3`, `pip`, Python one-liners, shell byte patches, or direct file edits to inspect data ranges, parse files, or mutate `.SemanticModel`, `.Report`, `.tmdl`, `.pbip`, CSV, or other Power BI project artifacts. Use MCP tools, deterministic planners, and repo-native Node/TypeScript tooling; if they cannot prove the issue or plan, report it as blocked.
- **Attribute findings to tool output:** Every finding must cite the tool or file that surfaced it. Do not infer relationship direction, cardinality, or measure expressions without reading them.
- **Context-sensitive severity:** A missing display folder is a Warning for an analyst-facing model and an Info for a private developer model. A missing AI instruction is Critical for a Copilot-facing model and irrelevant for a reports-only model.
- **No silent renames:** If the review surfaces naming issues, present the rename plan and get explicit user approval before applying. See `../modeling-semantic-model/references/naming.md` for downstream impact details.
- **Scope AI readiness to consumption intent:** Only audit AI readiness sections if the user has confirmed conversational BI is a target. See `../modeling-semantic-model/references/ai-readiness.md` for the before-investing gate questions.
- **Readiness vs. certification:** A clean, "passed", or "AI-ready" check is **not** a bank-safe, compliance-approved, or RLS-leakage-proven launch signal. `pbi_model_regulated_check` captures evidence and blocks when evidence is missing; it does not certify compliance or prove that RLS prevents data leakage. Copilot / data-agent exposure additionally requires AI schema scope, RLS leakage tests, tenant settings, and approved instructions — AI-readiness checks here are structural/metadata-only. Report readiness evidence, never compliance approval, and say formal sign-off plus RLS leakage validation remain the team's responsibility.
- **Star-schema planner:** When recommending conformed/shared dimensions, run `pbi_model_plan_star_schema_join` and use its deterministic plan. If it cannot run, mark the recommendation blocked. Say explicitly that the fix is a star-schema/shared-dimension design, do not invent `Dim X`, and do not recommend direct fact-to-fact relationships unless the plan explicitly allows them.
- **Date-table planner:** When reviewing Date table blanks, missing years, auto date cleanup, calendar bounds, or date-table marking, run `pbi_model_plan_date_table`. If it cannot run, mark the recommendation blocked. Do not infer date ranges from table names, file samples, or `TODAY()`/`NOW()`.
- **Date-grain planner:** When reviewing target-vs-actual joins, inactive date relationships, or measures with `TREATAS` plus date truncation, run `pbi_model_plan_date_table` and `pbi_model_plan_date_grain`. If they cannot run, mark the recommendation blocked. Use `scanMeasures: true` only when reviewing measure rewrites. Do not infer daily/monthly grain from table names, column names, or existing DAX workarounds.
