# Audit Output Format

Standard format for model review outputs. Apply this format when producing findings from the `reviewing-models` workflow.

## Per-Finding Structure

Each individual finding must follow this structure:

```
### [Check ID] — [Finding Title]

**Issue:** One-sentence statement of what is wrong and where.

**Fix:** Concrete, actionable remediation step. Reference the specific object (table name, measure name, relationship) where possible.

**Explain:** Why this matters -- performance impact, correctness risk, or AI/user experience consequence.

**Test:** How to verify the fix worked. Reference a tool call, a DAX query, or an observable outcome.
```

**Example:**

```
### Check 2.2 — Unsplit DateTime Column: 'Sales'[Order Timestamp]

**Issue:** The column 'Sales'[Order Timestamp] uses dataType: dateTime with second-level precision, creating near-unique cardinality and a large dictionary.

**Fix:** Split into 'Sales'[Order Date] (dataType: date) and 'Sales'[Order Time] (dataType: time). If the combined value is needed for display, create a DAX measure rather than a calculated column.

**Explain:** Near-unique DateTime columns can consume the majority of model memory. Splitting reduces dictionary size by 90%+ and improves refresh time.

**Test:** Run VertiPaq Analyzer in Tabular Editor 3 before and after the split. Confirm the dictionary size for the date column is significantly smaller. Confirm no existing measures or visuals reference 'Sales'[Order Timestamp] directly (or update them first).
```

---

## Summary Table

Every audit report must open with a summary table before any detailed findings:

```markdown
## Summary

| Severity | Category | Count |
|---|---|---|
| Critical | [list categories with critical findings] | X |
| Warning | Memory and Size | X |
| Warning | Data Reduction | X |
| Warning | DAX Anti-Patterns | X |
| Warning | Measure Hygiene | X |
| Warning | Documentation | X |
| Warning | Design | X |
| Warning | Direct Lake | X |
| Warning | AI and Copilot Readiness | X |
| Info | [any info-level tallies] | X |
| **Total** | | **X** |
```

Omit rows with 0 findings. Add a one-line note after the table if any category was skipped due to scope (e.g. "Direct Lake checks skipped — model uses Import storage mode").

---

## Grouping Rules

1. **Errors (Critical severity) first** — listed before all warnings, regardless of category
2. **Warnings grouped by category** — in the order: Memory and Size, Data Reduction, DAX Anti-Patterns, Measure Hygiene, Documentation, Design, Direct Lake, AI and Copilot Readiness
3. **Info findings as tally only** — do not list individual Info findings inline; summarize as "3 Info findings: 2 missing display folders, 1 excessive columns (see full list below)" and append a collapsed list at the end
4. **Prioritized action list at the end** — numbered list of the top fixes by impact, starting with Critical, then highest-impact Warnings

---

## Full Report Template

```markdown
# Semantic Model Audit Report

**Model:** [Model Name]
**Workspace:** [Workspace Name / path]
**Audit Date:** [Date]
**Scope:** [Full audit / Post-write regression / AI readiness only / etc.]

## Summary

| Severity | Category | Count |
|---|---|---|
| Critical | ... | X |
| Warning | ... | X |
| Info | ... | X |
| **Total** | | **X** |

## Critical Issues

### [Check ID] — [Finding Title]
**Issue:** ...
**Fix:** ...
**Explain:** ...
**Test:** ...

## Warning: Memory and Size

### [Check ID] — [Finding Title]
...

## Warning: Data Reduction
...

## Warning: DAX Anti-Patterns
...

## Warning: Measure Hygiene
...

## Warning: Documentation
...

## Warning: Design
...

## Warning: Direct Lake
...

## Warning: AI and Copilot Readiness
...

## Prioritized Action List

1. [Highest impact fix — usually Critical]
2. [Second priority]
3. ...

## Info Findings (Tally)

- [Count] missing display folders: [list of measure names]
- [Count] excessive column tables: [list of table names]
- ...
```

---

## What the Reviewer Cannot Catch

The following issues are outside the scope of a structural model audit. Acknowledge these limitations when relevant:

- **Semantic errors** — A measure may be syntactically correct DAX but compute the wrong business value. Only a domain expert reviewing actual data can catch this.
- **Cross-report binding issues** — Report visuals referencing model fields by name will break if fields are renamed. The model audit does not inspect PBIR files; use the `pbi_report_validate` tool separately.
- **Data freshness and completeness** — Whether source data is up to date, complete, or correctly loaded is outside model structure analysis.
- **Visual calc logic** — Calculations defined inside report visuals (visual calculations) are not part of the semantic model and are not audited here.
- **Runtime query performance without tooling** — Performance findings from this audit are structural heuristics only. Actual query timing requires DAX Studio or Performance Analyzer with the live model. See `../modeling-semantic-model/references/performance.md`.
- **AI instruction quality** — The audit can confirm whether AI instructions are present and non-empty, but cannot evaluate whether they are accurate or effective. Testing with actual Copilot/data agent interactions is the only way to validate AI instruction quality.
