# Power BI Modeling Beta

An AI modeling analyst that works with your team inside Power BI.

The beta helps teams build, review, and improve the semantic model behind Power BI: measures, relationships, dates, business definitions, and governance signals.

## What Teams Get

### 1. Build Models
Create and update the core semantic-model objects teams rely on: measures, tables, columns, relationships, and shared dimensions.

Includes:

- Measures, tables, columns, and relationships.
- Shared dimensions for comparing multiple fact tables.
- Live edits against the model open in Power BI Desktop.

### 2. Review Models
Run model reviews that highlight quality issues before they become reporting problems.

Includes:

- Relationship and filter-path checks.
- Missing descriptions, formatting, and metadata.
- Naming issues, including reserved DAX names.
- Date model and time-intelligence readiness.
- Captured vs not-captured security, governance, and readiness metadata.

### 3. Live Measure Authoring
Create and refine DAX measures while capturing the business meaning, source fields, formatting, and descriptions that make them usable.

Includes:

- Business intent and source-field checks.
- DAX reference checks before measure writes.
- Format strings, descriptions, and folders.
- Common DAX hygiene checks such as duplicate logic, debug functions, risky blank handling, and incorrect reference style.

### 4. Guided Analysis
Turn business questions into model-aware analysis by checking what fields, measures, and relationships actually exist before recommending changes.

Includes:

- Model discovery before recommendations.
- Clarifying questions when meaning is ambiguous.
- Optional business dictionary context.
- Separation between model readiness and business approval.

### 5. Time Intelligence And Period Analysis
Prepare models for actuals, targets, budgets, forecasts, year-to-date, prior-period, and other time-based comparisons.

Includes:

- Date table review and creation.
- Date grain checks across actuals, targets, budgets, and forecasts.
- Time-intelligence measure support.
- Period comparison readiness.

### 6. Model Performance Improvement
Identify modeling and DAX patterns that make reports harder to trust, maintain, or scale, then guide cleaner model design.

Includes:

- DAX pattern review.
- Explicit measures over implicit aggregation.
- Numeric key and auto-summarization checks.
- Relationship patterns that can make reports slow or confusing.

### 7. Relationship And Star Schema Design
Improve how tables connect, including shared dimensions across multiple fact tables for cleaner cross-business reporting.

Includes:

- Relationship validation before changes.
- Star-schema guidance.
- Shared dimensions across facts.
- Detection of direct fact-to-fact joins and fragile virtual relationships.

### 8. Governance And Best Practices
Surface missing metadata, unclear ownership, security evidence gaps, readiness gaps, and areas that need business approval.

Includes:

- Regulated-readiness evidence checks.
- Copilot and AI-readiness signals.
- RLS role metadata capture status and required RLS test-evidence gaps.
- Clear distinction between readiness evidence and formal approval.

> **Readiness is not proof.** A clean structural model check is *not* a bank-safe, compliance-approved, or RLS-leakage-proven launch signal. `pbi_model_regulated_check` captures evidence and blocks when evidence is missing; it does not certify compliance or prove that RLS prevents data leakage. The Copilot and AI-readiness signals above are structural/metadata-only — they are not evidence that the model is safe for Copilot or data-agent exposure, which additionally requires AI schema scope, RLS leakage tests, tenant settings, and approved instructions. See **Beta Boundaries** below for the full scope limits.

### 9. Live Power BI Desktop Workflow
Work with the model already open in Power BI Desktop so supported changes can be reviewed in the same workflow.

Includes:

- Live model inspection.
- Live supported edits.
- Refresh support for model changes.
- Offline folder inspection as a fallback.

## Why It Matters

- Better Power BI models before reports are built.
- Clearer business definitions behind key metrics.
- Faster review cycles for analysts and BI teams.
- Cleaner relationships across business data.
- Earlier visibility into governance and readiness gaps.

## Beta Boundaries

This beta focuses on the Power BI model layer.

It does not build report pages, visuals, layouts, or dashboards. It does not certify compliance or approve business definitions. RLS support is read/evidence-only in this beta: it does not create or edit roles, assign users or groups, run View-as/impersonation tests, or prove that RLS prevents leakage. It helps teams make the model stronger before those decisions and experiences depend on it.
