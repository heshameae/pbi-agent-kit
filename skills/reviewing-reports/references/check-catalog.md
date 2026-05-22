# Report Review Check Catalog

Full checklist for Power BI report reviews. Six dimensions, scored on a P0–P3 severity scale. Use this catalog when running `reviewing-reports` — every finding must be attributed to actual tool output. This catalog frames what the report-side review surface checks; the report-side BPA rule predicates themselves live in the engine at `packages/core/src/modeling/bpa.ts`.

## Severity Scale

| Severity | Meaning |
|---|---|
| **P0 / Critical** | Broken functionality, security risk, content disappearance, or a completely unused report consuming capacity |
| **P1 / High** | Performance issues impacting users, major design violations, missing/broken data bindings, unreadable text, inoperable controls |
| **P2 / Medium** | Design inconsistencies, moderate performance concerns, partial accessibility gaps, alignment/spacing issues |
| **P3 / Low** | Minor polish, style preferences, slight positioning/colour variations, optimization opportunities |

## Lifecycle Gate

The report's lifecycle stage gates which dimensions apply. A report's success lives and dies on whether it is being used and delivering value; design, performance, and structure can be reviewed proactively, but usage is the only objective measure.

| Stage | Usage data? | Dimensions in scope |
|---|---|---|
| **Development** | No | Design, Data Binding, Performance, Accessibility, structure |
| **Testing** | Partial | All of Development + verify the test audience is actually testing |
| **Production** | Yes | All six dimensions including full usage, distribution, export |

Do not apply rigid thresholds. A report for 3 analysts has different expectations than one for 300 executives. Scope severity to audience, purpose, and lifecycle stage.

---

## Dimension 1: Usage and Adoption

The most objective signal of report value. A report nobody views is a maintenance liability regardless of design quality. Only applicable once the report is published (Testing/Production). Reports with 0 views are not necessarily bad — they may be new, seasonal, or consumed via subscriptions or embedding not captured in telemetry.

### Check 1.1 — Audience Reach

**Problem:** A report that does not reach the people with access to it is not delivering value.

**Check:** What percentage of users with access have viewed the report in the last 7, 28, and 60 days? Exclude non-consumer users (service principals, developers, IT/support) from the denominator.

**Severity:** P1 (low reach in production) / N/A (development)

### Check 1.2 — Completely Unused Report

**Problem:** A published report with no views and no active subscriptions consumes capacity and maintenance effort for no return.

**Check:** Cross-reference view counts with last-visited timestamps and active subscriptions. A report with 0 views but active subscriptions is consumed passively.

**Severity:** P0 (unused report consuming capacity)

### Check 1.3 — Routine Export to Excel

**Problem:** Frequent export-to-Excel signals the report is being used as a data-extraction pipeline rather than an analytical tool — often meaning the model lacks needed measures, the design can't answer the question, or users must reshape data elsewhere. It is also a governance risk: exported data leaves the governed environment, so sensitivity labels, RLS, and audit controls no longer apply.

**Check:** Review `ExportReport` activity (Fabric Activity Events API) for the report. High or rising export volume on a table/matrix is the signal — pair it with the design and binding findings to locate the unmet need. (Telemetry-dependent: Testing/Production only.)

**Severity:** P2 (analytical gap + governance risk) / N/A (development)

---

## Dimension 2: Design and Layout

Visual design and information architecture. An agent cannot assert a report "looks good" — present every deviation as an observation and ask whether it is intentional.

### Check 2.1 — Missing or Non-Descriptive Page Titles

**Problem:** Pages without a clear, descriptive title leave consumers without context.

**Check:** Each page should have a clear and descriptive title.

**Severity:** P1

### Check 2.2 — Inconsistent Spacing and Sizing

**Problem:** Unequal gaps between visuals and between visuals and page edges, or inconsistent visual sizes, make a report look disorganized.

**Check:** Visuals should be consistent in size with equal spacing between them and equal margins to the page edge.

**Severity:** P2

### Check 2.3 — 3/30/300 Detail Gradient Not Followed

**Problem:** Detailed/dense visuals placed top-left and headline KPIs buried bottom-right invert the reading order.

**Check:** Simplest, most important information (KPIs, cards, titles) top-left; supporting trends in the middle; granular detail (tables, matrices, drill-through) bottom-right.

| Time | What the user should grasp | Placement |
|---|---|---|
| 3 seconds | The headline insight | KPIs/cards top-left |
| 30 seconds | Context and supporting trends | Charts in the middle |
| 300 seconds | Granular detail for exploration | Tables/matrices bottom-right |

**Severity:** P2

### Check 2.4 — Gratuitous or Inaccessible Colour

**Problem:** Colour used as decoration rather than as a data-encoding channel creates cognitive burden. Red/green for categories fails colour-vision-deficient users.

**Check:** Every colour should mean something. Reserve saturated/bright colours for emphasis and alerts; use muted/pastel palettes elsewhere. Reds/oranges/yellows for bad and green/blue for good are sentiment encodings, not categorical. Limit the palette to 5–7 colours. Test for red-green colour blindness; prefer blue-orange or blue-red diverging scales. Do not rely on colour alone.

**Severity:** P2 (gratuitous colour) / P1 (colour-only encoding of critical meaning)

### Check 2.5 — Inconsistent Fonts and Sizes

**Problem:** Inconsistent font family, size, weight, or colour signals randomness rather than hierarchy. Custom fonts are not guaranteed to render on all devices.

**Check:** Use Segoe UI / Segoe UI Semibold or other Power BI built-in fonts. Keep font properties consistent; variation should signal hierarchy. Minimum sizes: 9pt for data values, 12pt for labels and titles. **Always confirm with the user whether sizes are large enough** — the agent tends to underestimate this.

**Severity:** P2

### Check 2.6 — Excessive Visual Count

**Problem:** Too many visuals on one page hurt performance and UX; each visual generates a separate DAX query.

**Check:** Loosely 12–15 visuals max per page (depends on complexity). KPIs/cards limited to roughly <5 per page. Pages with >5–7 pages overall may be better split into focused reports.

**Severity:** P1 (well over the threshold with performance impact) / P2 (mild)

### Check 2.7 — Empty Visuals

**Problem:** A visual with no field bindings renders nothing and confuses consumers.

**Check:** All visuals should have field bindings.

**Severity:** P1

### Check 2.8 — Blank or Redundant Pages

**Problem:** Blank pages without visuals or background images add navigation noise.

**Check:** Remove blank pages. Confirm hidden/aesthetic pages are intentional.

**Severity:** P3

### Check 2.9 — Default Theme Applied

**Problem:** Default Power BI themes are poor quality. A custom theme is the simplest way to improve a report.

**Check:** A custom theme should be applied (not the default). If the report has the default theme plus bespoke visual formatting, recommend pushing the formatting into the theme.

**Severity:** P3

### Check 2.10 — Chart Axes Not Starting at Zero

**Problem:** Bar/column axes that do not start at zero mislead by exaggerating differences.

**Check:** Axes should start at 0, except line charts focused on overall trend (note this in the subtitle if a line chart does not start at 0).

**Severity:** P2

### Check 2.11 — Missing Default Sort Order

**Problem:** Visuals without an explicit sort default to alphabetical or insertion order, which is almost never correct.

**Check:** Charts and tables should sort by the primary measure descending, unless a natural order exists (time ascending, ordinal categories). Date fields sort categorically.

**Severity:** P2

### Check 2.12 — Inappropriate Chart Type

**Problem:** The visualization type does not match the analytical question.

**Check:** Match the visual to the question (card/KPI for current value; bar — horizontal preferred — for comparison; line for trend; scatter for relationship). Anti-patterns: pie/donut with >3–7 slices, dual-axis charts with differing scales, gauges, too many custom/macgyvered (SVG/R/Python) visuals.

**Severity:** P2

### Check 2.13 — Unlabelled Objects in the Selection Pane

**Problem:** Generic visual names in the selection pane make a report unmaintainable.

**Check:** Visual objects should be labelled clearly and grouped with descriptive names.

**Severity:** P3

### Check 2.14 — Default or Unintentional Interactions

**Problem:** Cross-filtering/highlighting left at defaults — or modified without an explicit reason — confuses users and other developers.

**Check:** Interactions should be intentional. Set/modified interactions are generally avoided unless there is an explicit reason. Verify cross-filtering works as expected.

**Severity:** P2

### Check 2.15 — Slicer Overuse and Unsynchronized Slicers

**Problem:** Slicers take up valuable real estate; too many create inefficient UX. Identical slicers on different pages that are not synchronized show unfiltered data after navigation.

**Check:** Maximum 2–3 simple slicers on a page; the rest belong in the filter pane. Synchronize slicers on the same field across pages, or prefer report-level filters for fields that should filter consistently.

**Severity:** P2

---

## Dimension 3: Data Model Binding

The connection between the report and its underlying semantic model. A thin report connects to a published model; a thick report embeds its own.

### Check 3.1 — Thick Report (Embedded Model)

**Problem:** A thick report cannot share its model, does not benefit from central model changes, and inflates storage.

**Check:** The report should connect to a published semantic model ("thin report") rather than embedding its own.

**Severity:** P2 (governance) — see Dimension 5 for detection heuristics

### Check 3.2 — Broken or Orphaned Field References

**Problem:** Visual bindings to renamed or removed columns/measures break visuals silently.

**Check:** All field bindings must resolve to existing model columns/measures. `pbi_report_validate` with field validation surfaces these against the connected model.

**Severity:** P0 (visual broken)

### Check 3.3 — Hidden Fields Left Behind

**Problem:** Fields bound to a visual with `hidden: true` participate in the query but are not displayed. Legitimate when a visual calculation depends on the field; wasteful when left over from a redesign.

**Check:** `pbi_report_validate` reports these as HIDDEN_FIELDS warnings. Investigate each to confirm it is intentionally hidden for a visual calculation, not forgotten.

**Severity:** P3 (confirm) / P2 (orphaned, wasting query)

### Check 3.4 — Orphaned Fields After Visual Type Change

**Problem:** When a visual's type is changed, old query-state and role bindings can persist in the JSON even though the new type does not use those roles, generating unnecessary queries.

**Check:** Spot-check raw visual JSON for roles/projections that do not exist for the current visual type.

**Severity:** P2

### Check 3.5 — Extension Measures Overused

**Problem:** Extension (thin-report) measures are invisible to other reports and harder to discover. They have governance issues.

**Check:** Extension measures are acceptable for report-specific formatting/rendering (conditional-formatting theme tokens, latest-data-point labels, conditionally rendered values). General business logic (revenue, margin, YoY growth) should be promoted to the semantic model.

**Severity:** P2

### Check 3.6 — Inappropriate Measures vs. Columns

**Problem:** Using a column where a measure is needed (or vice versa) produces wrong aggregation context.

**Check:** Appropriate use of measures vs. columns in visuals for the intended aggregation context.

**Severity:** P1 (wrong totals) / P2

### Check 3.7 — Stray Visual-Level Filters

**Problem:** Visual-level filters are invisible to users and a common source of confusion; developers forget about them.

**Check:** Separate filters should not be active at the visual level without reason. Prefer page-level or report-level filters. Document any visual-level filter explicitly.

**Severity:** P2

### Check 3.8 — Model-Origin Symptoms Surfacing in the Report

**Problem:** Many report symptoms originate in the model: (Blank) values from referential-integrity violations or wrong relationships; repeating/inflated values from many-to-many or bidirectional relationships; slow visuals from expensive DAX; missing fields from renamed/removed columns.

**Check:** When these symptoms appear, flag them for model-level investigation rather than asserting a report-side verdict. Run `reviewing-models` in parallel if the model is in scope.

**Severity:** Note only (flag for model review)

---

## Dimension 4: Performance

Report performance is almost always caused by what the visuals ask the model to compute. Do not recommend optimizations without evidence; offer to infer and test the queries, test multiple times, and revert if no meaningful improvement.

### Check 4.1 — Slow Load Times

**Problem:** Load times exceeding the audience's tolerance degrade adoption.

**Check:** P50 (typical) and P90 (worst-case) load times. Loose targets: P50 <3s (investigate >5s), P90 <8s (investigate >15s). A large P50-to-P90 gap indicates inconsistent performance (geography, device, filter-dependent query complexity, cache misses). Do not apply rigid thresholds.

**Severity:** P1 (clearly impacting users) / P2

### Check 4.2 — Visual Complexity Hotspots

**Problem:** Each visual generates a separate DAX query. Wide queries, many grouping columns, and complex extension measures multiply cost.

**Check:** Visual count per page; field count per visual; grouping-column count (multiplies cardinality); extension-measure complexity; tooltip pages (extra queries on hover); cross-filtering chains (cascading re-queries).

**Severity:** P2

### Check 4.3 — Hidden Visuals Executing Queries

**Problem:** Hidden visuals still execute queries against the model, degrading performance while invisible to users. Hidden slicers silently apply filters, causing confusion.

**Check:** Flag all hidden visuals; recommend removing or replacing with report/page-level filters. Hidden slicers are especially dangerous.

**Severity:** P1 (hidden slicer filtering silently) / P2

### Check 4.4 — Hidden Query Overhead

**Problem:** Not all computation is visible in the field wells. Conditional formatting (measure-driven is most expensive; rule-based and gradient still add rendering cost), custom tooltip fields, sort-by-column, and dynamic data labels all add query columns.

**Check:** Inspect for measure-driven conditional formatting, tooltip-bound measures, sort-by-column dependencies, and dynamic label formats.

**Severity:** P2 / P3

---

## Dimension 5: Report Metadata and Governance

The report's governance posture. Detection of thick/thin and endorsement requires service-side metadata.

### Check 5.1 — Thick vs. Thin (Detection)

**Problem:** Thick reports embed their own model. Detection has no direct API field.

**Check:** Heuristics — same-name model in the same workspace (likely thick, auto-generated from .pbix); `datasetWorkspaceId` matching the report's workspace (may be thick); a 1:1 report-to-model ratio (suggests thick). A healthy workspace has more reports than models.

**Severity:** P2

### Check 5.2 — Endorsement Status Inappropriate for Audience

**Problem:** Production reports that are unendorsed lack a quality signal.

**Check:** Certified for production, Promoted for team use. Unendorsed reports in production workspaces may need review.

**Severity:** P3

### Check 5.3 — Missing Sensitivity Label

**Problem:** Reports without a sensitivity label in a tenant that requires them violate governance policy. High-sensitivity reports must not have publish-to-web enabled.

**Check:** Sensitivity label applied if tenant policy requires it; label matches the data classification of the underlying model.

**Severity:** P2

### Check 5.4 — Not in a Deployment Pipeline

**Problem:** Production reports outside a CI/CD pipeline lack a governed dev → test → prod promotion process and change management.

**Check:** Reports in production workspaces should be part of a deployment pipeline.

**Severity:** P3

### Check 5.5 — Risky Distribution

**Problem:** Direct links, publish-to-web, and individual-user assignments are hard to audit and may over-expose data.

**Check:** Distribute via workspace app or org app, not direct links or publish-to-web. Grant access via security groups, not individual users. View-only (Viewer) for consumers; edit access only for developers. Flag any active publish-to-web on non-public reports as critical.

**Severity:** P0 (publish-to-web on internal data) / P2 (individual-user assignments)

---

## Dimension 6: Accessibility, Standards, and Documentation

Whether the report meets accessibility, organizational standards, and documentation requirements. WCAG ratios below are adapted from the WCAG 2.x AA contrast standards to Power BI; px/web-specific guidance (touch targets, focus rings, keyboard traps) does not transfer to the Power BI canvas.

### Check 6.1 — Insufficient Colour Contrast (WCAG)

**Problem:** Low contrast makes text and chart elements unreadable for low-vision users.

**Check:** Text contrast ratio ≥ 4.5:1 (≥ 3:1 for large text — 18pt+, or 14pt+ bold). UI components, chart elements, borders, and graphical objects ≥ 3:1 against adjacent colours.

**Severity:** P1 (data text below 4.5:1) / P2 (UI/chart below 3:1)

### Check 6.2 — Reliance on Colour Alone

**Problem:** Information conveyed only by colour is lost to colour-vision-deficient users.

**Check:** Encode information by shape and text in addition to colour, not by colour alone. Charts and diagrams must consider colour-vision diversity; status/error meaning must not rely solely on colour.

**Severity:** P1

### Check 6.3 — Missing Alt Text

**Problem:** Data visuals without alt text are inaccessible to screen-reader users.

**Check:** Alt text present on data visuals. (Good practice but rare in practice — note rather than fail unless the audience requires it.)

**Severity:** P2 / P3

### Check 6.4 — Illegible Font Sizes

**Problem:** Fonts below the legibility floor exclude many users.

**Check:** Minimum 9pt for data values, 12pt for labels/titles. Confirm legibility with the user.

**Severity:** P1 (below floor) / P2

### Check 6.5 — Drop Shadows and Excessive Animation

**Problem:** Drop shadows create accessibility issues for users with vestibular disabilities; unnecessary animations do the same.

**Check:** Replace drop shadows with a flat layout plus sufficient background contrast. No unnecessary animations.

**Severity:** P2 / P3

### Check 6.6 — Tab and Layer Order Not Established

**Problem:** Without an explicit tab/layer order, keyboard and screen-reader navigation is illogical.

**Check:** Tab order and visual layer order established.

**Severity:** P2

### Check 6.7 — Missing Standards and Documentation

**Problem:** Reports handed over without documentation are unmaintainable.

**Check:** Naming conventions followed (report, page, visual titles); a feedback/issue link provided; filter combinations tested. For handover/production: a purpose statement (what business questions the report answers), intended audience, atypical features documented (visual-level filters, hidden slicers, bookmarks, custom visuals), support personnel identified, and training/adoption materials available.

**Severity:** P3 (standards) / P2 (production handover without docs)

---

## Theme Compliance (cross-cutting)

A report is theme-compliant when its visuals inherit formatting from the theme rather than carrying redundant or conflicting bespoke overrides. Non-compliance accumulates through manual Desktop formatting, copy-pasted visuals, and theme switches where old overrides were never cleared. Classify each override:

| Category | Action |
|---|---|
| **Stale** — duplicates what the theme already sets with the same value | Remove; it is noise and blocks future theme changes |
| **Conflicting** — overrides the theme with a different value for no documented reason | Promote to theme if it should apply broadly, or document the exception |
| **Intentional exception** — legitimately differs for a specific reason | Keep; annotate if possible |
| **Conditional formatting** — expression-based formatting | Keep; never clear CF expressions |

Severity guidance:
- **P0/Critical-equivalent:** container chrome (title/border/background) differing from the theme wildcard across multiple visuals of the same type; `dropShadow.show: true` when the theme sets false; hardcoded hex in `dataPoint` not matching theme `dataColors`.
- **P2/Warning-equivalent:** padding/border-radius or axis font differing on individual visuals; per-visual legend position where a type-level default would be cleaner.
- **P3/Suggestion-equivalent:** override keys holding null/empty values; `objects` keys for properties the visual does not render; redundant `general` container objects.

Static formatting should ideally live in the theme, not in bespoke visual overrides, so theme changes propagate to all downstream visuals. Some overrides are inevitable, but the theme should carry the baseline.

---

## Report-Side BPA (cross-cutting)

The report-side Best Practice Analyzer runs a rule sweep over the report and reports violations grouped by rule with affected visual/page paths and severity (info/warning/error). It is the structural counterpart to schema/JSON validation. Its rule predicates live in the engine at `packages/core/src/modeling/bpa.ts`; this catalog frames what that surface checks. Coverage:

- **Filters** — too many TopN or Advanced filters on a single visual; broken or unreachable filter references
- **Visual sizing** — visuals below readable thresholds, overflowing page bounds, inconsistent dimensions across a row
- **Accessibility** — contrast issues, missing alt text on image visuals, missing titles on data visuals
- **Formatting hygiene** — drop shadows enabled, default font styles, formatting that should live in the theme
- **Field bindings** — roles bound to fields that do not match the role's expected data type
- **Layout** — overlapping visuals, visuals positioned outside the canvas

BPA is a starting point, not a verdict. A clean BPA run means the report does not trip the structural rules — not that it is well-designed. Pair BPA findings with the design judgement in the dimensions above. Safe automatic fixes can be applied in place, but review the diff before publishing; unsafe or judgment-call fixes are reported, not applied.
