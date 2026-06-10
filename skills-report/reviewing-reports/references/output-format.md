# Report Review Output Format

Standard format for report review outputs. Apply this format when producing findings from the `reviewing-reports` workflow.

## Reviewing Philosophy

An LLM or agent **cannot assert that a report "looks good" or "is good."** Provide evaluation and suggestions for possible improvements, but aim to spar with the user — steer them in the right direction and augment them with the appropriate skills, rather than gatekeep.

**Best practices are defaults, not mandates.** They are recognized standards providing a helpful starting point for most scenarios — not optimizations, which are situation-specific. When flagging a deviation, present it as an observation and a suggestion, not a failure, and **ask the user whether the deviation is intentional.** Do not over-extrapolate from one scenario to another or assume the audience or purpose.

**Confirm font sizes.** Always confirm font-size readability with the user — the agent tends to underestimate whether fonts are large enough. Never assert design competence from a screenshot or a single interaction.

**Watch for anomalies.** When viewing a report (screenshot, devtools, or browser MCP), keep a keen eye for `(Blank)` values, repeating/inflated values, and query errors. These are usually model-origin symptoms — flag them for model-level investigation rather than asserting a report-side verdict.

**Performance needs evidence.** Do not recommend optimizations without evidence. Offer to infer the visual's query from its field bindings and test it against the model; test multiple times when comparing (a single test is misleading); revert to the simpler approach if testing shows no meaningful improvement.

---

## Two-Stage Review

Run every review in two stages. Do not begin Stage 2 until Stage 1 passes.

### Stage 1 — Spec Compliance (deterministic-first)

Does the report match the agreed spec / requirements? This stage is about correctness and presence, not taste.

- Run `pbi_report_validate` (schema + structure + field references) and `pbi_spec_validate`.
- Run the report-side BPA sweep. Use its output verbatim; attribute findings to the tool. Do not re-walk a folder the validator already covered.
- Confirm every required page, visual, and binding is present and resolves.

Report Stage 1 blockers (broken bindings, schema errors, missing required elements) before any quality discussion.

### Stage 2 — Quality

Only once compliance passes, evaluate design, accessibility, performance, and governance against `check-catalog.md`. This is where best-practice deviations are surfaced as suggestions and confirmed for intent.

---

## Per-Finding Structure

Each finding is one grouped line with category tag, location, and a concrete fix:

```
- [Category] <Location> — <what is wrong>. Fix: <concrete remediation>.
```

- **Category** is the dimension or sub-area: `Usage`, `Design`, `Binding`, `Performance`, `Governance`, `Accessibility`, `Standards`, `Theme`, `BPA`.
- **Location** is the specific page / visual / object (use generic placeholders such as `Overview` page, `Revenue` card — never a real client name).
- **Fix** is actionable and references the specific object.

For complex findings, expand to Issue → Fix → Explain → Test:

```
### [Check 4.3] — Hidden Slicer Filtering Silently: 'Region' slicer on the 'Detail' page

**Issue:** A hidden slicer on 'Detail'[Region] is set to a single value, silently filtering all visuals on the page with no visible cause.

**Fix:** Remove the hidden slicer and replace it with a page-level filter on Region, or make the slicer visible.

**Explain:** Hidden slicers still execute queries and apply filters invisibly, so consumers see filtered data with no way to tell why — a common support burden.

**Test:** Re-run pbi_report_validate; confirm the slicer is gone or visible. Open the page and confirm the totals match an unfiltered query.
```

---

## Summary Table

Every review report opens with a severity-count summary table before any detailed findings:

```markdown
## Summary

| Severity | Dimensions | Count |
|---|---|---|
| P0 / Critical | [dimensions with P0 findings] | X |
| P1 / High | [dimensions with P1 findings] | X |
| P2 / Medium | [dimensions with P2 findings] | X |
| P3 / Low | [dimensions with P3 findings] | X |
| **Total** | | **X** |
```

Omit rows with 0 findings. Add a one-line note after the table if any dimension was skipped due to scope (e.g. "Usage and Adoption skipped — report is local-only / in development").

---

## Grouping Rules

1. **Stage 1 blockers first** — spec-compliance failures (broken bindings, schema errors, missing required elements) before any quality findings.
2. **Then P0/Critical, regardless of dimension** — broken functionality, security risk, completely unused report.
3. **Then by severity, grouped by dimension within each** — P1 → P2 → P3, in dimension order: Usage and Adoption, Design and Layout, Data Model Binding, Performance, Report Metadata and Governance, Accessibility/Standards/Documentation.
4. **Lead with the most impactful findings** in each group.
5. **P3 / Low as a tally** — do not list every minor item inline; summarize as "4 Low findings: 2 unlabelled visuals, 1 default theme, 1 redundant page (see list below)" and append a collapsed list.
6. **Prioritized action list at the end** — numbered, starting with Stage 1 blockers and P0, then highest-impact items.

---

## Full Report Template

```
REPORT REVIEW: <Report Name>
===============================

Report:     <name>
Format:     PBIR / PBIX
Type:       Thin / Thick
Model:      <model name> (Import / DirectQuery / Direct Lake)
Stage:      Development / Testing / Production
Scope:      <dimensions reviewed>

USAGE SIGNAL (production only)
  Views (28d): <n>  |  Viewers: <n>  |  Reach: <n>%
  Top pages: <page> (<n>%), ...
  Load time P50: <n>s  |  P90: <n>s

STAGE 1 — SPEC COMPLIANCE
  - [Binding] <visual> has a broken field reference to a removed measure. Fix: rebind or remove.

P0 / CRITICAL
  - [Governance] Publish-to-web is active on a report with internal data. Fix: revoke via the admin portal.

P1 / HIGH
  - [Design] No page titles on 2 of 3 pages. Fix: add descriptive titles.
  - [Accessibility] Data text contrast 2.9:1 on the KPI band. Fix: darken text to reach 4.5:1.

P2 / MEDIUM
  - [Design] Inconsistent margins between visuals. Fix: align to an equal grid.
  - [Theme] 12 line charts carry a stale axis-font override. Fix: clear the override; theme already sets it.

P3 / LOW (Tally)
  - 4 Low findings: 2 unlabelled visuals, 1 default theme, 1 redundant blank page.

PRIORITIZED ACTION LIST
  1. <Stage 1 blocker or P0>
  2. <highest-impact P1>
  3. ...
```

---

## What the Reviewer Cannot Catch

The following are outside the scope of a structural report review. Acknowledge these limitations when relevant:

- **Whether the report "looks good"** — design competence cannot be asserted from metadata, a screenshot, or a single interaction. Present suggestions and confirm intent with the user.
- **Whether a deviation is intentional** — many best-practice deviations are deliberate. Ask before flagging as a failure.
- **Semantic correctness of measures** — a binding can resolve and still show the wrong business value. Only a domain expert reviewing actual data can catch this.
- **Model-origin issues** — `(Blank)` values, repeating/inflated values, and slow visuals usually originate in the semantic model. Flag for model-level review; run `reviewing-models` in parallel. The report review does not audit model structure.
- **Runtime performance without tooling** — load-time and complexity findings are heuristics. Actual timing requires inferring the visual's query and running it against the live model, multiple times.
- **Whether usage is "healthy"** — there is no universal threshold; it depends entirely on the report's audience, purpose, and lifecycle stage. Reports with 0 views are not necessarily bad (new, seasonal, subscription- or embed-consumed).
- **A clean BPA run is not a verdict** — it means the report does not trip the structural rules, not that it is well-designed. Pair BPA with the design judgement in the check catalog.
