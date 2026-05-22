# KPI Cards Reference

How to design KPI and card visuals that a reader can judge without thinking: targets, gaps, and trends; the display-unit selection algorithm; target-source DAX; and the PBIR visual.json shapes for `kpi` and `card`. Examples use generic placeholders (Sales, Revenue, Target); substitute the model's real measures.

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

| Element | Purpose | Example |
|---|---|---|
| **Actual value** | Shows magnitude | 518M |
| **Target / comparison** | Establishes the benchmark | Target: 483M |
| **Gap (delta)** | Explicitly answers "good or bad?" | +35.4M (+7.3%) |

Express the gap in **both** absolute and percentage terms — the absolute shows scale, the percentage shows relative significance. Without a gap, readers must do mental arithmetic while processing other KPIs.

**Always label the target.** "Target: 483M" is ambiguous. Set `goals.goalText` to what the comparison actually is — `"1YP"`, `"Budget"`, `"3M Avg"` — so the reader knows what they're comparing against without looking it up.

## Sourcing Targets

Every KPI needs a target. Prefer adding the target as a model measure (reusable across reports, evaluated server-side); fall back to a report extension measure only when the target is report-specific. If no clear target exists, ask the user — never leave a KPI bare.

| Target source | When to use | Example DAX (placeholder) |
|---|---|---|
| **Prior year (1YP)** | Default when no budget exists | `CALCULATE([Measure], DATEADD('Date'[Date], -1, YEAR))` |
| **Prior month/period** | Short-term operational metrics | `CALCULATE([Measure], DATEADD('Date'[Date], -1, MONTH))` |
| **Budget / forecast** | When budgets exist in the model | Direct measure reference |
| **Rolling average** | Smoothing volatile metrics | `CALCULATE([Measure], DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -3, MONTH))` |

Gap and color extension measures (placeholder names):

```dax
// Variance, formatted with sign in both absolute and percent terms
Revenue vs Target =
VAR _actual = [Revenue]
VAR _target = [Revenue Target]
VAR _gap = _actual - _target
RETURN FORMAT(_gap, "+#,##0;-#,##0") & " (" & FORMAT(DIVIDE(_gap, _target), "+0.0%;-0.0%") & ")"

// Conditional-formatting color for the GAP (returns a theme token, never hex)
Revenue vs Target Color = IF([Revenue] >= [Revenue Target], "good", "bad")
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

Round aggressively at the KPI level — **"518M" beats "517,893,412"**. Precision belongs in detail tables. Keep decimals and units consistent across all cards on a page.

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

A common background-color scheme for percent-of-target (pair color with a secondary cue for accessibility):

| Achievement | Background |
|---|---|
| > 110% of target | Green (`good`) |
| 90-110% of target | Yellow (`neutral`) |
| < 90% of target | Red (`bad`) |

## PBIR visual.json Shapes

### `kpi` — built-in Indicator / Goal / TrendLine roles

The `kpi` visual supports all three KPI elements natively. Bind `Indicator` (the actual), `Goal` (the target), and `TrendLine` (a date column). Set the display unit in `objects.indicator.indicatorDisplayUnits`:

```json
{
  "visual": {
    "visualType": "kpi",
    "query": { "queryState": {
      "Indicator": { "projections": [{ "queryRef": "Sales.Revenue" }] },
      "Goal":      { "projections": [{ "queryRef": "Sales.Revenue Target" }] },
      "TrendLine": { "projections": [{ "queryRef": "Date.Calendar Month" }] }
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
      "Values": { "projections": [{ "queryRef": "Sales.Revenue" }] }
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
- [ ] Each card has a target or comparison value
- [ ] Gap shown in both absolute and percentage terms
- [ ] Conditional formatting applied to the gap, not the primary value
- [ ] Color paired with a secondary cue (arrow/icon) for accessibility
- [ ] Numbers rounded for summary level; display units set explicitly (not Auto)
- [ ] Subtitles hidden; title and category label not both shown
- [ ] Font size hierarchy: value > gap > label > trend
- [ ] Consistent units and formatting across all cards on the page
- [ ] Minimum card height 130-150px
