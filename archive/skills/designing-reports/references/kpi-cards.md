# KPI Cards Reference

How to design KPI and card visuals that a reader can judge without thinking: targets, gaps, and trends; the display-unit selection algorithm; target-source DAX; and the PBIR visual.json shapes for `kpi` and `card`. Examples use placeholders such as `<MeasureTable>`, `<Metric>`, and `<Target>`; substitute only fields confirmed by the model/spec/user.

**Source:** Mined from the `pbi-report-design` `cards-and-kpis.md` reference, the `pbir-cli` formatted visual examples (`kpi.json`, `card.json`, `cardVisual.json`), and the awesome-copilot `power-bi-report-design-best-practices.instructions.md` (CF thresholds).

## Card Doctrine

Cards and KPIs occupy the most prominent position on a page (top-left, per the 3-30-300 gradient). A bare number lacks meaning — human cognition judges magnitude through comparison, not in isolation. Every KPI earning dashboard space must answer two questions without making the reader think:

1. **"Is this good or bad?"** — answered by a target and gap
2. **"Is it getting better or worse?"** — answered by a trend

### Limit quantity

Working memory holds ~3-4 chunks. A page with 4 KPIs lets readers retain the whole picture; 12 cards force exhausting scan-forget-rescan loops. **5 is a practical ceiling.** Selection is driven by the page's central question — every KPI must serve it; the rest is noise.

### Choose actionable, not vanity, metrics

Vanity metrics describe activity but don't drive decisions (a running total that only ever increases). Actionable metrics create decision forks. The test: *"If this number changed 20%, should someone act differently?"* If no, it hasn't earned its space. Comparative metrics (vs. prior year) beat absolute ones because they immediately signal relative performance.

## The Three Elements of a Good KPI

| Element | Purpose | Placeholder example |
|---|---|---|
| **Actual value** | Shows magnitude | `[<Metric>]` formatted with verified display units |
| **Target / comparison** | Establishes the benchmark | `[<Metric Target>]` only when confirmed |
| **Gap (delta)** | Explicitly answers "good or bad?" | `[<Metric>] - [<Metric Target>]` only when target exists |

Express the gap in **both** absolute and percentage terms — the absolute shows scale, the percentage shows relative significance. Without a gap, readers must do mental arithmetic while processing other KPIs.

**Always label confirmed comparisons.** Generic text such as "Target" is ambiguous. Set `goals.goalText` to the confirmed comparison label, such as a validated budget, prior period, or rolling-average definition, so the reader knows what they are comparing against without looking it up.

## Sourcing Targets

Use a target only when it exists in the model/spec or the user explicitly requests and defines the comparison. Prefer adding a confirmed target as a model measure (reusable across reports, evaluated server-side); fall back to a report extension measure only when the target is report-specific. If no target/comparison exists, ask or render the KPI as actual-only; never invent a prior-year, budget, or rolling-average target.

| Target source | When to use | Example DAX (placeholder) |
|---|---|---|
| **Prior year (1YP)** | When explicitly requested or specified by the validated spec | `CALCULATE([Measure], DATEADD('<DateTable>'[<DateKey>], -1, YEAR))` |
| **Prior month/period** | Short-term operational metrics when specified | `CALCULATE([Measure], DATEADD('<DateTable>'[<DateKey>], -1, MONTH))` |
| **Budget / forecast** | When budgets exist in the model | Direct measure reference |
| **Rolling average** | Smoothing volatile metrics when specified | `CALCULATE([Measure], DATESINPERIOD('<DateTable>'[<DateKey>], MAX('<DateTable>'[<DateKey>]), -3, MONTH))` |

Gap and color extension measures (placeholder names):

```dax
// Variance, formatted with sign in both absolute and percent terms
<Metric> vs <Target> =
VAR _actual = [<Metric>]
VAR _target = [<Metric Target>]
VAR _gap = _actual - _target
RETURN FORMAT(_gap, "+#,##0;-#,##0") & " (" & FORMAT(DIVIDE(_gap, _target), "+0.0%;-0.0%") & ")"

// Conditional-formatting color for the GAP (returns a theme token, never hex)
<Metric> vs <Target> Color = IF([<Metric>] >= [<Metric Target>], "good", "bad")
```

## Formatting with Intent

### Size hierarchy

The eye should follow: headline number (largest, boldest) → verdict/gap (medium, colored) → supporting context (target, trend; smallest, muted).

### Color the gap, not the value

Apply conditional formatting to the gap — the judgment indicator — not the primary value. Loud color on the primary value distracts from the judgment. Pair color with a directional symbol (arrow) so the message survives color blindness. Bind the card's `labels.color` to the color extension measure. Configure accessible sentiment colors in the theme (e.g. `good: "#2B7A78"`, `bad: "#D4602E"`).

### Title vs. category label — show one, not both

Card visuals name the metric in two places: the visual *title* (top) and the *category label* (below the value). Showing both is redundant and wastes vertical space. Preferred: hide the title and keep the category label, which reads naturally as "3.8M Order Lines". Alternatively keep the title and set `categoryLabels.show: false`. Hide auto-generated subtitles (`subtitle.show: false`) — they repeat field names.

**Card sizing:** minimum height **130-150px** for value + category label. If the value or label clips, increase height before reducing font size.

## Display Units and Number Formatting

Round aggressively at the KPI level — a compact display-unit value beats a long raw number. Precision belongs in detail tables. Keep decimals and units consistent across all cards on a page.

> **"Auto" display units do not work reliably** when a measure has a custom format string (e.g. `#,##0`) — the format string overrides Auto and you get raw, unrounded numbers. Query the actual value with the report's active filters, then set the display unit explicitly per visual.

### Selection algorithm

Pick the largest unit where the displayed integer part is ≥ 1 (goal: 2-3 visible digits, no leading zero):

```
value = query result with active filters
if value >= 1,000,000,000,000:  unit = 1000000000000 (Trillions)
elif value >= 1,000,000,000:    unit = 1000000000    (Billions)
elif value >= 1,000,000:        unit = 1000000       (Millions)
elif value >= 1,000:            unit = 1000          (Thousands)
else:                           unit = 1             (None)
```

Then set precision from the digit count of `value / unit`: 1 digit → precision 1 (3.8M); 2+ digits → precision 0 (35bn, 338K). Percentage measures always use `unit = 1` (None) with precision 1 — the format string supplies the `%`.

Worked examples: `3,768,335` → Millions, "3.8M" (precision 1); `35,312,992,122` → Billions, "35bn" (precision 0); `0.719` → None, "71.9%".

### `indicatorDisplayUnits` enum

| Value | Label |
|---|---|
| 0 | Auto (unreliable with custom format strings — avoid) |
| 1 | None |
| 1000 | Thousands |
| 1000000 | Millions |
| 1000000000 | Billions |
| 1000000000000 | Trillions |

## CF Thresholds for Target Achievement

Use achievement thresholds only when the target and bands are confirmed by the model/spec/user. Pair color with a secondary cue for accessibility.

| Achievement | Background |
|---|---|
| Above confirmed upper band | Green (`good`) |
| Within confirmed warning band | Yellow (`neutral`) |
| Below confirmed critical band | Red (`bad`) |

## PBIR visual.json Shapes

### `kpi` — built-in Indicator / Goal / TrendLine roles

The `kpi` visual supports all three KPI elements natively. Bind `Indicator` (the actual), `Goal` (the target), and `TrendLine` (a date column). Set the display unit in `objects.indicator.indicatorDisplayUnits`:

```json
{
  "visual": {
    "visualType": "kpi",
    "query": { "queryState": {
      "Indicator": { "projections": [{ "queryRef": "<MeasureTable>.<Metric>" }] },
      "Goal":      { "projections": [{ "queryRef": "<MeasureTable>.<Metric Target>" }] },
      "TrendLine": { "projections": [{ "queryRef": "<DateTable>.<DateAxis>" }] }
    }},
    "objects": {
      "indicator": [{ "properties": {
        "indicatorDisplayUnits": { "expr": { "Literal": { "Value": "1000000D" } } }
      }}]
    }
  }
}
```

(`projections` carry the full field expression in practice; `queryRef` is shown here for brevity.) The `goals` container also holds `goalText` (the comparison label) and `showDistance`.

### `card` — headline number with extension measures

A `card` shows one measure. Add gap and color via extension measures, set the value font large, hide the category label or the title (not both):

```json
{
  "visual": {
    "visualType": "card",
    "query": { "queryState": {
      "Values": { "projections": [{ "queryRef": "<MeasureTable>.<Metric>" }] }
    }},
    "objects": {
      "labels": [{ "properties": {
        "fontSize": { "expr": { "Literal": { "Value": "48D" } } }
      }}],
      "categoryLabels": [{ "properties": {
        "show": { "expr": { "Literal": { "Value": "false" } } }
      }}]
    }
  }
}
```

The modern `cardVisual` (New Card) supports `goals.goalText` and `value.labelDisplayUnits` directly; it does not share container names with the legacy `card` (see `theme-cascade.md` container gotchas).

## Visual Type Selection

| Scenario | Visual type | Notes |
|---|---|---|
| Value + target + trend line | `kpi` | Built-in support for all three elements |
| Simple headline number | `card` | Add extension measures for gap and color |
| Multiple related metrics | `multiRowCard` | Groups related KPIs compactly |
| Custom layout with sparkline / icons | `card` + SVG measure | Maximum control, higher complexity |

## Review Checklist

- [ ] Each card answers the page's central question
- [ ] Maximum 5 cards per page
- [ ] Each comparison card has a confirmed target/comparison value; actual-only cards are allowed when no confirmed comparison exists
- [ ] Gap shown in both absolute and percentage terms when a confirmed comparison exists
- [ ] Conditional formatting applied to the gap, not the primary value
- [ ] Color paired with a secondary cue (arrow/icon) for accessibility
- [ ] Numbers rounded for summary level; display units set explicitly (not Auto)
- [ ] Subtitles hidden; title and category label not both shown
- [ ] Font size hierarchy: value > gap > label > trend
- [ ] Consistent units and formatting across all cards on the page
- [ ] Minimum card height 130-150px
