# Time Intelligence Reference

Standalone TI measures (TOTAL* functions), calculation-group TI items (DATES* functions), off-by-one rules, date-table requirements, and DAX fusion guidance.

**Source:** dg4-te-fabric-desktop-root · ruiromano powerbi-agentic-plugins · dg3-semantic-models

**Identifier guard:** Concrete table, column, and measure names in examples are illustrative only. Production DAX must resolve identifiers from live model metadata, deterministic planner output, the validated user spec, or explicit user confirmation; never copy example names into a user model.

---

## Critical Rule: TOTAL* vs DATES*

| Context | Functions to use |
|---|---|
| **Standalone measures** (written with `pbi_measure_create`) | `TOTALYTD`, `TOTALQTD`, `TOTALMTD` |
| **Calculation group items** (inside a `calculationItem` expression) | `DATESYTD`, `DATESQTD`, `DATESMTD` |

Using `DATESYTD` in a standalone measure instead of `TOTALYTD` is valid but produces different filter-context semantics. Use TOTAL* for standalone measures unless you specifically need the table-expression form.

---

## Date Table Requirements

A date table that violates any rule below causes TI functions to return BLANK silently — no error, wrong numbers:

| Rule | Detail |
|---|---|
| Clean `pbi_model_plan_date_table` result | Required proof before TI functions rely on the table |
| Contiguous daily rows, no gaps | Even one missing date breaks DATESYTD/TOTALYTD |
| Full span of fact data | Must cover every date that appears in fact tables |
| Single-column relationship to fact | Multiple date columns in a fact each need their own relationship; only one can be active |
| `pbi_table_mark_as_date` applied after clean proof | Marks the governed Date table/key through the coverage gate |
| `sortByColumn` for month name → month number | Prevents alphabetical sort in visuals |

---

## Standalone TI Measures (TOTAL* Pattern)

Use when creating individual measures for each TI period. Suffix convention: ` YTD`, ` MTD`, ` QTD`, ` PY`, ` YoY%`, ` R12M`.

```dax
-- Year-to-Date
[ValueMetric YTD] = TOTALYTD([ValueMetric], 'Date'[Date])

-- Quarter-to-Date
[ValueMetric QTD] = TOTALQTD([ValueMetric], 'Date'[Date])

-- Month-to-Date
[ValueMetric MTD] = TOTALMTD([ValueMetric], 'Date'[Date])

-- Prior Year
[ValueMetric PY] = CALCULATE([ValueMetric], SAMEPERIODLASTYEAR('Date'[Date]))

-- Year-over-Year %
[ValueMetric YoY%] =
VAR _Current = [ValueMetric]
VAR _Prior   = CALCULATE([ValueMetric], SAMEPERIODLASTYEAR('Date'[Date]))
RETURN DIVIDE(_Current - _Prior, _Prior)

-- Month-over-Month %
[ValueMetric MoM%] =
VAR _Current = [ValueMetric]
VAR _Prior   = CALCULATE([ValueMetric], DATEADD('Date'[Date], -1, MONTH))
RETURN DIVIDE(_Current - _Prior, _Prior)

-- Prior Month
[ValueMetric PM] = CALCULATE([ValueMetric], DATEADD('Date'[Date], -1, MONTH))

-- Rolling 12 Months
[ValueMetric R12M] = CALCULATE([ValueMetric], DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -12, MONTH))
```

---

## DATESINPERIOD Off-by-One Rule

The negative period offset must precisely match the number of periods required:

| Window | Correct offset | Wrong offset |
|---|---|---|
| 12-month rolling | `-12` | `-11` (off by one month) |
| 3-month rolling | `-3` | `-2` |
| 52-week rolling | `-52` | `-51` |

Using `-11` for a 12-month window silently includes only 11 months. No error is raised.

---

## Calculation Group TI Items (DATES* Pattern)

Use inside a `calculationGroup` in TMDL. The `SELECTEDMEASURE()` function applies the calc item's expression to whichever measure is in filter context. Use `DATES*` variants (not `TOTAL*`) here.

**9 standard TI items with ordinals:**

| Ordinal | Item Name | DAX Expression |
|---|---|---|
| 0 | Current | `SELECTEDMEASURE()` |
| 1 | YTD | `CALCULATE(SELECTEDMEASURE(), DATESYTD('Date'[Date]))` |
| 2 | MTD | `CALCULATE(SELECTEDMEASURE(), DATESMTD('Date'[Date]))` |
| 3 | QTD | `CALCULATE(SELECTEDMEASURE(), DATESQTD('Date'[Date]))` |
| 4 | PY | `CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))` |
| 5 | YoY % | VAR pattern (see below) |
| 6 | MoM % | VAR pattern (see below) |
| 7 | PM | `CALCULATE(SELECTEDMEASURE(), DATEADD('Date'[Date], -1, MONTH))` |
| 8 | R12M | `CALCULATE(SELECTEDMEASURE(), DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -12, MONTH))` |

**YoY % item (requires formatStringDefinition):**
```dax
VAR _Current = SELECTEDMEASURE()
VAR _Prior   = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))
RETURN DIVIDE(_Current - _Prior, _Prior)
```

**MoM % item:**
```dax
VAR _Current = SELECTEDMEASURE()
VAR _Prior   = CALCULATE(SELECTEDMEASURE(), DATEADD('Date'[Date], -1, MONTH))
RETURN DIVIDE(_Current - _Prior, _Prior)
```

---

## Calculation Group TMDL Emission

```tmdl
table 'Time Intelligence'
	lineageTag: abc-123

	calculationGroup
		precedence: 10

		calculationItem Current = SELECTEDMEASURE()
			ordinal: 0

		calculationItem YTD = ```
				CALCULATE (
				    SELECTEDMEASURE(),
				    DATESYTD ( 'Date'[Date] )
				)
				```
			ordinal: 1
			formatStringDefinition = SELECTEDMEASUREFORMATSTRING()

		calculationItem 'YoY %' = ```
				VAR _Current = SELECTEDMEASURE()
				VAR _Prior = CALCULATE ( SELECTEDMEASURE(), SAMEPERIODLASTYEAR ( 'Date'[Date] ) )
				RETURN
				DIVIDE ( _Current - _Prior, _Prior )
				```
			ordinal: 5
			formatStringDefinition = "0.00%"

	column Name
		dataType: string
		lineageTag: def-456
		sourceColumn: Name
		summarizeBy: none

	partition 'Time Intelligence' = calculationGroup
		mode: import
		source
			precedence: 10
```

**Critical TMDL rules for calc groups:**
- Partition `source` type is `calculationGroup` — NOT `m` or `calculated`
- `precedence` declared at both `calculationGroup` and partition `source` levels
- `IsHidden = true` recommended to avoid confusion in Fields pane — set `isHidden` on the table
- `SELECTEDMEASUREFORMATSTRING()` for passthrough format; explicit `"0.00%"` for % items
- Always include a `Current` passthrough item at ordinal 0

---

## Precedence Guidelines (Multiple Calc Groups)

| Range | Use Case |
|---|---|
| 1–10 | Core time intelligence |
| 11–20 | Currency conversion |
| 21–30 | Comparison calculations |
| 31+ | Presentation/formatting |

Lower precedence values are evaluated first.

---

## TI and SE Fusion

Standalone TI measures break vertical fusion because each measure applies a different TI function → each gets its own SE query. See DAX019 and DAX020 in `references/dax-performance.md`:

- **DAX019:** Keep base measures TI-free; apply TI once in an outer CALCULATE wrapper
- **DAX020:** Keep only column-slice filters inside base measures; lift TI to a consuming measure

Using a calculation group is the preferred pattern for widespread TI: the engine applies one calc item expression rather than materializing a separate TI measure per base measure.

---

## ~35-Function TI Detector

The following function names in a measure expression indicate time-intelligence usage. Cross-check with date-table requirements before authoring:

`TOTALYTD`, `TOTALQTD`, `TOTALMTD`, `DATESYTD`, `DATESQTD`, `DATESMTD`, `DATESINPERIOD`, `DATEADD`, `SAMEPERIODLASTYEAR`, `PARALLELPERIOD`, `PREVIOUSYEAR`, `PREVIOUSQUARTER`, `PREVIOUSMONTH`, `PREVIOUSDAY`, `NEXTYEAR`, `NEXTQUARTER`, `NEXTMONTH`, `NEXTDAY`, `STARTOFYEAR`, `STARTOFQUARTER`, `STARTOFMONTH`, `ENDOFYEAR`, `ENDOFQUARTER`, `ENDOFMONTH`, `FIRSTDATE`, `LASTDATE`, `FIRSTNONBLANK`, `LASTNONBLANK`, `OPENINGBALANCEYEAR`, `OPENINGBALANCEQUARTER`, `OPENINGBALANCEMONTH`, `CLOSINGBALANCEYEAR`, `CLOSINGBALANCEQUARTER`, `CLOSINGBALANCEMONTH`, `DATESMTD`

If any of these appear in a measure, call `pbi_model_plan_date_table` before authoring. If marking is needed, use `pbi_table_mark_as_date` after a clean proof; do not set Date-table metadata directly.
