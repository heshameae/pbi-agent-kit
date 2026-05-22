# Calculation Groups Reference

Calculation-group concepts, the time-intelligence / currency calculation-item DAX library, precedence and ordinal rules, `SELECTEDMEASURE` best practices, and the TMDL emission shape. All examples are adapted from the source skills and are dataset-agnostic — replace `Sales`, `Date`, `Exchange Rates`, etc. with the real names from the connected model.

**Source:** tabular-editor c-sharp-scripting (calculation-groups object-type + time_intelligence.csx + currency_conversion.csx) · fabric-authoring tmdl-advanced-features-guide · powerbi-master tmdl-mastery cookbook

---

## Concepts

Calculation groups apply dynamic calculations (time intelligence, currency conversion, etc.) across **all** measures, so you do not have to author one TI variant per base measure.

| Term | Definition |
|---|---|
| **Calculation Group** | A special table that contains calculation items |
| **Calculation Item** | A DAX expression that uses `SELECTEDMEASURE()` to transform whatever measure is in context |
| **Precedence** | Order of evaluation when multiple calculation groups apply (lower = evaluated first) |

A calculation group is a table holding `calculationItem` entries, a calculation-group column (the values that show in slicers), and a `calculationGroup` partition.

---

## The SELECTEDMEASURE Family

Calculation-item expressions run in the **filter context of the visual** and must reference the base measure via `SELECTEDMEASURE()`. Related functions:

| Function | Purpose |
|---|---|
| `SELECTEDMEASURE()` | The current measure the calc group is modifying |
| `SELECTEDMEASURENAME()` | Name of the current measure |
| `SELECTEDMEASUREFORMATSTRING()` | Format string of the current measure |
| `ISSELECTEDMEASURE(...)` | Test whether the current measure is one of a given list |

---

## Time-Intelligence Calculation-Item DAX Library

These are the calculation-item bodies for a Time Intelligence group. Inside a `calculationItem` use the `DATES*` table functions (not the `TOTAL*` form used for standalone measures).

```dax
-- Current (passthrough / default item)
SELECTEDMEASURE()

-- Year-to-Date
CALCULATE(SELECTEDMEASURE(), DATESYTD('Date'[Date]))

-- Quarter-to-Date
CALCULATE(SELECTEDMEASURE(), DATESQTD('Date'[Date]))

-- Month-to-Date
CALCULATE(SELECTEDMEASURE(), DATESMTD('Date'[Date]))

-- Prior Year
CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))

-- Prior Month
CALCULATE(SELECTEDMEASURE(), DATEADD('Date'[Date], -1, MONTH))

-- Year-over-Year %
VAR CurrentValue = SELECTEDMEASURE()
VAR PriorValue = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))
RETURN
    DIVIDE(CurrentValue - PriorValue, PriorValue)

-- Month-over-Month %
VAR CurrentValue = SELECTEDMEASURE()
VAR PriorValue = CALCULATE(SELECTEDMEASURE(), DATEADD('Date'[Date], -1, MONTH))
RETURN
    DIVIDE(CurrentValue - PriorValue, PriorValue)

-- Year-over-Year Absolute
VAR CurrentValue = SELECTEDMEASURE()
VAR PriorValue = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))
RETURN
    CurrentValue - PriorValue

-- Rolling 12 Months
CALCULATE(
    SELECTEDMEASURE(),
    DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -12, MONTH)
)
```

The percentage items (`YoY %`, `MoM %`) should carry their own format-string override (see Dynamic Format Strings below), since the base measure's format is typically currency, not a percentage.

---

## Currency-Conversion Calculation Items

A currency group multiplies the selected measure by an exchange rate. Pull the rate from a rate table with `SELECTEDVALUE(...)` and a default of `1` so an unfiltered context falls back to the base value.

```dax
-- Local / base currency (passthrough)
SELECTEDMEASURE()

-- Convert using a rate column, defaulting to 1
SELECTEDMEASURE() * SELECTEDVALUE('Exchange Rates'[Rate], 1)

-- Per-currency items can read a dedicated rate column
SELECTEDMEASURE() * SELECTEDVALUE('Exchange Rates'[USD Rate], 1)
SELECTEDMEASURE() * SELECTEDVALUE('Exchange Rates'[EUR Rate], 1)
```

A more dynamic variant resolves the target currency from a selector and looks up the rate, while a format-string expression switches the currency symbol to match:

```dax
-- Expression (calculation item "Convert to Target")
VAR TargetCurrency = SELECTEDVALUE('Currency Selector'[Currency], "USD")
VAR Rate =
    LOOKUPVALUE(
        'Exchange Rates'[Rate],
        'Exchange Rates'[ToCurrency], TargetCurrency,
        'Exchange Rates'[Date], MAX('Date'[Date])
    )
RETURN
    SELECTEDMEASURE() * Rate

-- Format-string expression (same item)
VAR TargetCurrency = SELECTEDVALUE('Currency Selector'[Currency], "USD")
RETURN
    SWITCH(
        TargetCurrency,
        "USD", "$#,##0.00",
        "EUR", "€#,##0.00",
        "GBP", "£#,##0.00",
        "JPY", "¥#,##0",
        "#,##0.00"
    )
```

---

## Precedence & Ordinal

Two distinct ordering concepts:

- **Precedence** (on the calculation *group*) controls evaluation order when more than one group applies. Lower precedence is evaluated first.
- **Ordinal** (on each calculation *item*) controls the item's sort order in slicers and lists.

Suggested precedence ranges:

| Range | Use Case |
|---|---|
| 1–10 | Core time intelligence |
| 11–20 | Currency conversion |
| 21–30 | Comparison calculations |
| 31+ | Presentation / formatting |

Leave gaps (10, 20, 30) so future groups can slot in without renumbering. Set an explicit `ordinal` on every item so the passthrough/default item (e.g. `Current`, `Local Currency`) sorts first at ordinal 0.

---

## Best Practices

1. **Hide the calc group** — set the group table to hidden to avoid confusing report authors.
2. **Always include a passthrough item** — a `Current` / `Local` item whose body is just `SELECTEDMEASURE()` so the group has a no-op default.
3. **Set Ordinal on every item** — controls slicer sort order.
4. **Use precedence deliberately** — order matters once groups combine.
5. **Document complex items** — add a description explaining non-obvious expressions.
6. **Always reference the base measure via `SELECTEDMEASURE()`** — never hardcode a specific measure; use variables for clarity in multi-step items and test against several base measures.
7. **Override format only where needed** — leave the base measure's format intact for passthrough/value items; override for percentages and currencies.

---

## TMDL Emission Shape

A calculation group is emitted as a table containing a `calculationGroup` block, the calculation items, the calculation-group column, an `Ordinal` sort column, and a `calculationGroup` partition.

```tmdl
table 'Time Intelligence'

	calculationGroup
		precedence: 1

	calculationItem Current = SELECTEDMEASURE()
		ordinal: 0

	calculationItem YTD =
			CALCULATE(SELECTEDMEASURE(), DATESYTD('Date'[Date]))
		ordinal: 1

	calculationItem QTD =
			CALCULATE(SELECTEDMEASURE(), DATESQTD('Date'[Date]))
		ordinal: 2

	calculationItem MTD =
			CALCULATE(SELECTEDMEASURE(), DATESMTD('Date'[Date]))
		ordinal: 3

	calculationItem PY =
			CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))
		ordinal: 4

	calculationItem 'YoY %' =
			VAR CurrentValue = SELECTEDMEASURE()
			VAR PriorYear = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))
			RETURN DIVIDE(CurrentValue - PriorYear, PriorYear)
		formatStringDefinition = "0.00%"
		ordinal: 5

	calculationItem 'YoY Abs' =
			VAR CurrentValue = SELECTEDMEASURE()
			VAR PriorYear = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))
			RETURN CurrentValue - PriorYear
		ordinal: 6

	column 'Time Calculation'
		dataType: string
		sourceColumn: Name
		sortByColumn: Ordinal

	column Ordinal
		dataType: int64
		sourceColumn: Ordinal
		summarizeBy: none
		isHidden

	partition 'Partition_Time Intelligence' = calculationGroup
```

### Currency group in TMDL

```tmdl
table 'Currency Conversion'

	calculationGroup
		precedence: 2

	calculationItem 'Local Currency' = SELECTEDMEASURE()
		ordinal: 0

	calculationItem USD =
			SELECTEDMEASURE() * SELECTEDVALUE('Exchange Rates'[USD Rate], 1)
		formatStringDefinition = "$ #,##0.00"
		ordinal: 1

	calculationItem EUR =
			SELECTEDMEASURE() * SELECTEDVALUE('Exchange Rates'[EUR Rate], 1)
		formatStringDefinition = "#,##0.00 EUR"
		ordinal: 2

	column 'Currency Display'
		dataType: string
		sourceColumn: Name

	column Ordinal
		dataType: int64
		sourceColumn: Ordinal
		summarizeBy: none
		isHidden

	partition 'Currency Conversion-Partition' = calculationGroup
```

### TMDL Key Rules

- `calculationGroup` is declared with **no name** — just the keyword indented under the table.
- Each `calculationItem <Name> = <DAX>` is indented under `calculationGroup`. Multi-line DAX uses the same continuation/triple-backtick style as measures.
- Use `formatStringDefinition` (not `formatString`) for items that override the base measure's format.
- The calculation-group `column` (often named for the table) holds the item names; set `sourceColumn: Name` and `sortByColumn: Ordinal`.
- Add a hidden `Ordinal` column (`dataType: int64`, `summarizeBy: none`, `sourceColumn: Ordinal`) to drive the sort.
- The partition type must be `= calculationGroup` (not `= m` or `= calculated`).
- `formatStringDefinition`, multi/empty-selection expressions, and related features need a recent compatibility level (1601+ recommended).

| TMDL keyword | TOM object | Expression language |
|---|---|---|
| `calculationGroup` | CalculationGroup | (none) |
| `calculationItem` | CalculationItem | DAX |
| `formatStringDefinition` | FormatStringDefinition | DAX (returns a format string) |

---

## Related: Field Parameters

Field parameters are a sibling pattern (a user-selectable list of measures/columns) and are sometimes paired with calculation groups. They emit as a **calculated** partition (not `calculationGroup`) plus a `ParameterMetadata` annotation:

```tmdl
table 'Revenue Metric'

	column 'Revenue Metric'
		dataType: string
		isHidden
		sourceColumn: Name
		sortByColumn: 'Revenue Metric Order'

	column 'Revenue Metric Fields'
		dataType: string
		isHidden
		sourceColumn: Name
		isDataTypeInferred

	column 'Revenue Metric Order'
		dataType: int64
		isHidden
		sourceColumn: Ordinal
		summarizeBy: none

	partition 'Revenue Metric-Partition' = calculated
		source = ```
			{
				("Revenue", NAMEOF([Sales Amount]), 0),
				("Profit", NAMEOF([Gross Profit]), 1),
				("Margin %", NAMEOF([Gross Margin %]), 2),
				("Units", NAMEOF([Total Quantity]), 3)
			}
			```

	annotation ParameterMetadata = ```
		{"version":3,"kind":2}
		```
```
