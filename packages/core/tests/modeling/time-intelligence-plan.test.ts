import { describe, expect, it } from 'vitest';
import {
  type TimeIntelligencePeriod,
  buildTimeIntelligenceMeasureExpression,
  calendarOvershootsFactDay,
  detectCalendarMaxAnchorCap,
  isYearEndDateLiteral,
  parseBarePeriodToDate,
  parseTimeIntelligencePeriod,
} from '../../src/modeling/time-intelligence-plan.js';

// Guard against any hardcoded date literal leaking into generated DAX.
const DATE_LITERAL = /\b\d{4}-\d{2}-\d{2}\b|DATE\s*\(\s*\d/i;

describe('buildTimeIntelligenceMeasureExpression — shape (A) plain', () => {
  it('emits a bare TOTAL*TD over the date key with no guard', () => {
    const dax = buildTimeIntelligenceMeasureExpression({
      period: 'YTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
    });
    expect(dax).toBe("TOTALYTD([Total Sales], 'Date'[Date])");
    expect(dax).not.toContain('VAR');
    expect(dax).not.toContain('REMOVEFILTERS');
  });

  it('maps each period to the correct TOTAL function', () => {
    const fns: Record<TimeIntelligencePeriod, string> = {
      YTD: 'TOTALYTD',
      QTD: 'TOTALQTD',
      MTD: 'TOTALMTD',
    };
    for (const period of ['YTD', 'QTD', 'MTD'] as TimeIntelligencePeriod[]) {
      const dax = buildTimeIntelligenceMeasureExpression({
        period,
        baseExpression: '[Total Sales]',
        dateTable: 'Calendar',
        dateKeyColumn: 'Date',
      });
      expect(dax.startsWith(fns[period])).toBe(true);
    }
  });

  it('threads a fiscal year-end only for YTD', () => {
    const ytd = buildTimeIntelligenceMeasureExpression({
      period: 'YTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      yearEndDate: '"06-30"',
    });
    expect(ytd).toBe('TOTALYTD([Total Sales], \'Date\'[Date], "06-30")');
    const qtd = buildTimeIntelligenceMeasureExpression({
      period: 'QTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      yearEndDate: '"06-30"',
    });
    expect(qtd).toBe("TOTALQTD([Total Sales], 'Date'[Date])");
  });

  it('quotes table names with spaces and escapes embedded quotes', () => {
    const dax = buildTimeIntelligenceMeasureExpression({
      period: 'MTD',
      baseExpression: '[Total Sales]',
      dateTable: "Bob's Calendar",
      dateKeyColumn: 'Date',
    });
    expect(dax).toBe("TOTALMTD([Total Sales], 'Bob''s Calendar'[Date])");
  });
});

describe('buildTimeIntelligenceMeasureExpression — shape (B) last-data-period cap', () => {
  it('anchors the cap at the measure-relative last NON-BLANK date, not the calendar max', () => {
    const dax = buildTimeIntelligenceMeasureExpression({
      period: 'YTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      capToLastDataPeriod: true,
    });
    // Anchor iterates the Date axis and keeps only dates where THIS measure is
    // non-blank (forced context transition), then takes the max — the last DATA date.
    expect(dax).toContain('NOT ISBLANK(CALCULATE([Total Sales]))');
    expect(dax).toContain("FILTER(VALUES('Date'[Date])");
    expect(dax).toContain("REMOVEFILTERS('Date')");
    // ceiling lowered only when context overshoots; user selection preserved
    expect(dax).toContain("VAR _CtxMax = MAX('Date'[Date])");
    expect(dax).toContain('VAR _AsOf = MIN(_CtxMax, _LastData)');
    // upper-bound-only filter — never re-injects a fixed year or REMOVEFILTERS the slicer
    // CRITICAL: the cap wraps TOTALYTD on the OUTSIDE (CALCULATE(TOTALYTD(...), <= _AsOf)),
    // NOT as TOTALYTD's inner filter arg — the inner form blanks in default context.
    expect(dax).toContain(
      "CALCULATE(TOTALYTD([Total Sales], 'Date'[Date]), 'Date'[Date] <= _AsOf)",
    );
    expect(dax).not.toContain("TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)");
    expect(dax).not.toContain('YEAR(');
    // CRITICAL: the anchor must NOT be the calendar end. Detecting the anti-pattern on
    // the generator's own output must be false.
    expect(detectCalendarMaxAnchorCap(dax, 'Date', 'Date')).toBe(false);
  });

  it('is measure-relative: two measures over the same calendar each anchor at their own data', () => {
    const sales = buildTimeIntelligenceMeasureExpression({
      period: 'YTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      capToLastDataPeriod: true,
    });
    const target = buildTimeIntelligenceMeasureExpression({
      period: 'YTD',
      baseExpression: '[Total Target]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      capToLastDataPeriod: true,
    });
    expect(sales).toContain('NOT ISBLANK(CALCULATE([Total Sales]))');
    expect(target).toContain('NOT ISBLANK(CALCULATE([Total Target]))');
    // No fact date column is named anywhere — fully role-agnostic.
    expect(sales).not.toContain('[Order Date]');
    expect(sales).not.toContain('[Ship Date]');
  });

  it('forces context transition for a RAW aggregation base (works without a measure ref)', () => {
    const dax = buildTimeIntelligenceMeasureExpression({
      period: 'YTD',
      baseExpression: "SUM('Orders'[Sales])",
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      capToLastDataPeriod: true,
    });
    // CALCULATE() around the raw SUM is what makes the per-date evaluation correct.
    expect(dax).toContain("NOT ISBLANK(CALCULATE(SUM('Orders'[Sales])))");
  });

  it('reuses the same upper-bound cap for QTD/MTD (not a whole-year clamp)', () => {
    const mtd = buildTimeIntelligenceMeasureExpression({
      period: 'MTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      capToLastDataPeriod: true,
    });
    expect(mtd).toContain(
      "CALCULATE(TOTALMTD([Total Sales], 'Date'[Date]), 'Date'[Date] <= _AsOf)",
    );
  });

  it('never emits a hardcoded date literal in either shape', () => {
    const a = buildTimeIntelligenceMeasureExpression({
      period: 'YTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
    });
    const b = buildTimeIntelligenceMeasureExpression({
      period: 'YTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      capToLastDataPeriod: true,
    });
    expect(DATE_LITERAL.test(a)).toBe(false);
    expect(DATE_LITERAL.test(b)).toBe(false);
  });
});

describe('detectCalendarMaxAnchorCap', () => {
  it('flags the calendar-max anchor anti-pattern (the field regression)', () => {
    const bad =
      "VAR _LastData = CALCULATE(MAX('Date'[Date]), REMOVEFILTERS('Date'))\n" +
      "VAR _AsOf = MIN(MAX('Date'[Date]), _LastData)\n" +
      "RETURN CALCULATE(TOTALYTD([Total Sales], 'Date'[Date]), 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(bad, 'Date', 'Date')).toBe(true);
  });

  it('flags the inlined-anchor hand-edit form (anchor still REMOVEFILTERS-scoped)', () => {
    const bad =
      "VAR _AsOf = MIN(MAX('Date'[Date]), CALCULATE(MAX('Date'[Date]), REMOVEFILTERS('Date')))\n" +
      "RETURN TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(bad, 'Date', 'Date')).toBe(true);
  });

  it('is CASE-INSENSITIVE (DAX function/identifier names are)', () => {
    const lower =
      "var _asof = min(max('date'[date]), calculate(max('date'[date]), removefilters('date')))\n" +
      "return totalytd([total sales], 'date'[date], 'date'[date] <= _asof)";
    expect(detectCalendarMaxAnchorCap(lower, 'Date', 'Date')).toBe(true);
    const mixed =
      "VAR _AsOf = Calculate(Max('Date'[Date]), RemoveFilters('Date'))\n" +
      "RETURN TotalYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(mixed, 'Date', 'Date')).toBe(true);
  });

  it('flags equivalent calendar-end anchors: ALL(table), ALL(axis), no-arg ALL(), ALLEXCEPT, multi-arg REMOVEFILTERS, LASTDATE, MAXX', () => {
    const allTable =
      "VAR _AsOf = CALCULATE(MAX('Date'[Date]), ALL('Date'))\n" +
      "RETURN TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(allTable, 'Date', 'Date')).toBe(true);
    const allAxis =
      "VAR _AsOf = CALCULATE(LASTDATE('Date'[Date]), ALL('Date'[Date]))\n" +
      "RETURN TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(allAxis, 'Date', 'Date')).toBe(true);
    // No-arg ALL()/REMOVEFILTERS() clear ALL filters (incl Date) → calendar end.
    const noArgAll =
      "VAR _AsOf = CALCULATE(MAX('Date'[Date]), ALL())\n" +
      "RETURN TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(noArgAll, 'Date', 'Date')).toBe(true);
    // ALLEXCEPT and multi-arg REMOVEFILTERS — the idiomatic forms the regex used to miss.
    const allExcept =
      "VAR _AsOf = CALCULATE(MAX('Date'[Date]), ALLEXCEPT('Date', 'Date'[Year]))\n" +
      "RETURN TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(allExcept, 'Date', 'Date')).toBe(true);
    const multiArg =
      "VAR _AsOf = CALCULATE(MAX('Date'[Date]), REMOVEFILTERS('Date'), REMOVEFILTERS('Sales'))\n" +
      "RETURN TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(multiArg, 'Date', 'Date')).toBe(true);
    const maxxValues =
      "VAR _AsOf = MAXX(VALUES('Date'[Date]), 'Date'[Date])\n" +
      "RETURN TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(maxxValues, 'Date', 'Date')).toBe(true);
    // ALLSELECTED equals the calendar end in default context — a mainstream missed idiom.
    const allSelected =
      "VAR _AsOf = CALCULATE(MAX('Date'[Date]), ALLSELECTED('Date'))\n" +
      "RETURN TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(allSelected, 'Date', 'Date')).toBe(true);
    // Unquoted table ref (DAX-valid for a name without spaces) must still be caught.
    const unquoted =
      'VAR _AsOf = CALCULATE(MAX(Date[Date]), REMOVEFILTERS(Date))\n' +
      'RETURN TOTALYTD([Total Sales], Date[Date], Date[Date] <= _AsOf)';
    expect(detectCalendarMaxAnchorCap(unquoted, 'Date', 'Date')).toBe(true);
    // MAXX over the whole date TABLE (not just the column) is the same calendar-end anchor.
    const maxxTable =
      "VAR _AsOf = MAXX(ALL('Date'), 'Date'[Date])\n" +
      "RETURN TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(maxxTable, 'Date', 'Date')).toBe(true);
  });

  it('ADVISORY (accepted imperfection): a period-to-date co-located with an unrelated calendar-anchored rolling window also matches', () => {
    // The detector cannot structurally distinguish this from the real anti-pattern, so it
    // matches. Harmless because the caller treats a positive as a NON-BLOCKING warning, not
    // a refusal — this documents the known false-positive, not a bug.
    const compound =
      "DIVIDE(TOTALYTD([Total Sales], 'Date'[Date]), " +
      "CALCULATE([Total Sales], DATESINPERIOD('Date'[Date], CALCULATE(MAX('Date'[Date]), REMOVEFILTERS('Date')), -12, MONTH)))";
    expect(detectCalendarMaxAnchorCap(compound, 'Date', 'Date')).toBe(true);
  });

  it('does NOT flag a NON-period-to-date measure (rolling window / PY) reusing MAX(axis)', () => {
    const r12m =
      "CALCULATE([Total Sales], DATESINPERIOD('Date'[Date], CALCULATE(MAX('Date'[Date]), REMOVEFILTERS('Date')), -12, MONTH))";
    expect(detectCalendarMaxAnchorCap(r12m, 'Date', 'Date')).toBe(false);
    const datesBetween =
      "VAR _End = CALCULATE(MAX('Date'[Date]), REMOVEFILTERS('Date'))\n" +
      "RETURN CALCULATE([Total Sales], DATESBETWEEN('Date'[Date], MIN('Date'[Date]), _End))";
    expect(detectCalendarMaxAnchorCap(datesBetween, 'Date', 'Date')).toBe(false);
  });

  it('does NOT flag a measure-relative cap (the correct generated form), even lower-cased', () => {
    const good = buildTimeIntelligenceMeasureExpression({
      period: 'YTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      capToLastDataPeriod: true,
    });
    expect(detectCalendarMaxAnchorCap(good, 'Date', 'Date')).toBe(false);
    expect(detectCalendarMaxAnchorCap(good.toLowerCase(), 'Date', 'Date')).toBe(false);
  });

  it('does NOT flag a fact-column anchor (legacy but data-bearing)', () => {
    const factAnchored =
      "VAR _LastData = CALCULATE(MAX('Orders'[Order Date]), REMOVEFILTERS('Date'))\n" +
      "VAR _AsOf = MIN(MAX('Date'[Date]), _LastData)\n" +
      "RETURN TOTALYTD([Total Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)";
    expect(detectCalendarMaxAnchorCap(factAnchored, 'Date', 'Date')).toBe(false);
  });

  it('does NOT flag a plain MAX(Date) used merely as _CtxMax (no filter-clear anchor)', () => {
    const good = buildTimeIntelligenceMeasureExpression({
      period: 'QTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      capToLastDataPeriod: true,
    });
    // _CtxMax = MAX('Date'[Date]) on its own (no REMOVEFILTERS/ALL) must not trip the gate.
    expect(good).toContain("VAR _CtxMax = MAX('Date'[Date])");
    expect(detectCalendarMaxAnchorCap(good, 'Date', 'Date')).toBe(false);
  });
});

describe('parseTimeIntelligencePeriod', () => {
  it('maps canonical and natural-language period tokens', () => {
    expect(parseTimeIntelligencePeriod('YTD')).toBe('YTD');
    expect(parseTimeIntelligencePeriod(' qtd ')).toBe('QTD');
    expect(parseTimeIntelligencePeriod('Month to date')).toBe('MTD');
    expect(parseTimeIntelligencePeriod('year-to-date')).toBe('YTD');
  });

  it('returns undefined for non period-to-date or missing tokens', () => {
    expect(parseTimeIntelligencePeriod(undefined)).toBeUndefined();
    expect(parseTimeIntelligencePeriod('YoY')).toBeUndefined();
    expect(parseTimeIntelligencePeriod('prior year')).toBeUndefined();
  });
});

describe('parseBarePeriodToDate', () => {
  it('extracts period, base, and dates ref from a bare TOTAL*TD call', () => {
    expect(parseBarePeriodToDate("TOTALYTD([Total Sales], 'Date'[Date])")).toEqual({
      period: 'YTD',
      baseExpression: '[Total Sales]',
      datesRef: "'Date'[Date]",
      extraArgs: [],
    });
    expect(parseBarePeriodToDate("TOTALMTD([Sales], 'Calendar'[Day])")?.period).toBe('MTD');
  });

  it('tolerates nested function calls in the base argument', () => {
    expect(
      parseBarePeriodToDate("TOTALQTD(CALCULATE(SUM('F'[x]), 'F'[y]>0), 'Date'[Date])"),
    ).toEqual({
      period: 'QTD',
      baseExpression: "CALCULATE(SUM('F'[x]), 'F'[y]>0)",
      datesRef: "'Date'[Date]",
      extraArgs: [],
    });
  });

  it('does not split arguments on commas inside quoted DAX identifiers', () => {
    expect(
      parseBarePeriodToDate("TOTALYTD(SUM('Sales, Archive'[Amount]), 'Calendar, Fiscal'[Date])"),
    ).toEqual({
      period: 'YTD',
      baseExpression: "SUM('Sales, Archive'[Amount])",
      datesRef: "'Calendar, Fiscal'[Date]",
      extraArgs: [],
    });
    expect(
      parseBarePeriodToDate(
        "CALCULATE(SUM('Sales, Archive'[Amount]), DATESYTD('Calendar, Fiscal'[Date]))",
      ),
    ).toEqual({
      period: 'YTD',
      baseExpression: "SUM('Sales, Archive'[Amount])",
      datesRef: "'Calendar, Fiscal'[Date]",
      extraArgs: [],
    });
  });

  it('does NOT false-flag a `<=` inside the base aggregate as already-capped', () => {
    // The old whole-string `<=` check wrongly returned null here, skipping the
    // blank-risk guard for a genuine bare YTD whose base just happens to filter rows.
    const parsed = parseBarePeriodToDate(
      "TOTALYTD(CALCULATE(SUM('Orders'[Amount]), 'Orders'[Qty] <= 100), 'Date'[Date])",
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.period).toBe('YTD');
    expect(parsed?.extraArgs).toEqual([]);
  });

  it('surfaces a fiscal year-end / extra filter as extraArgs (so the gate can re-thread or refuse)', () => {
    const yearEnd = parseBarePeriodToDate('TOTALYTD([Sales], \'Date\'[Date], "06-30")');
    expect(yearEnd?.extraArgs).toEqual(['"06-30"']);
    expect(isYearEndDateLiteral('"06-30"')).toBe(true);
    expect(isYearEndDateLiteral('"6/30"')).toBe(true);
    expect(isYearEndDateLiteral('\'Product\'[Cat]="A"')).toBe(false);

    const dimFilter = parseBarePeriodToDate(
      "TOTALYTD([Sales], 'Date'[Date], 'Product'[Cat]=\"A\")",
    );
    expect(dimFilter?.extraArgs).toEqual(['\'Product\'[Cat]="A"']);
  });

  it('treats a top-level `<=` as an existing cap ONLY when it filters the date column', () => {
    // A date upper-bound cap → already guarded → null.
    expect(
      parseBarePeriodToDate("TOTALYTD([Sales], 'Date'[Date], 'Date'[Date] <= _AsOf)"),
    ).toBeNull();
    // A non-date value filter with `<=` is NOT a cap: the measure is still uncapped, so
    // it must parse (and surface the filter as an extra arg) rather than be skipped.
    const valueFilter = parseBarePeriodToDate(
      "TOTALYTD([Sales], 'Date'[Date], 'Product'[Price] <= 100)",
    );
    expect(valueFilter).not.toBeNull();
    expect(valueFilter?.extraArgs).toEqual(["'Product'[Price] <= 100"]);
  });

  it('treats quoted and unquoted date-axis refs as the same existing cap', () => {
    expect(
      parseBarePeriodToDate("TOTALYTD([Sales], 'Date'[Date], Date[Date] <= _AsOf)"),
    ).toBeNull();
    expect(
      parseBarePeriodToDate("CALCULATE([Sales], DATESYTD('Date'[Date]), Date[Date] <= _AsOf)"),
    ).toBeNull();
  });

  it('strips leading DAX comments before the bare-period anchor', () => {
    expect(parseBarePeriodToDate("// fiscal YTD\nTOTALYTD([Sales], 'Date'[Date])")?.period).toBe(
      'YTD',
    );
    expect(parseBarePeriodToDate("/* note */ TOTALQTD([Sales], 'Date'[Date])")?.period).toBe('QTD');
  });

  it('ignores DAX comments around period-to-date expressions', () => {
    expect(parseBarePeriodToDate("-- fiscal YTD\nTOTALYTD([Sales], 'Date'[Date])")).toEqual({
      period: 'YTD',
      baseExpression: '[Sales]',
      datesRef: "'Date'[Date]",
      extraArgs: [],
    });
    expect(parseBarePeriodToDate("TOTALYTD([Sales], 'Date'[Date]) -- trailing note")).toEqual({
      period: 'YTD',
      baseExpression: '[Sales]',
      datesRef: "'Date'[Date]",
      extraArgs: [],
    });
    expect(
      parseBarePeriodToDate("CALCULATE([Sales], DATESYTD('Date'[Date])) -- trailing note"),
    ).toEqual({
      period: 'YTD',
      baseExpression: '[Sales]',
      datesRef: "'Date'[Date]",
      extraArgs: [],
    });
    expect(
      parseBarePeriodToDate(
        "TOTALYTD(SUM('Sales -- Archive'[Amount]), 'Date'[Date]) -- table name keeps dashes",
      )?.baseExpression,
    ).toBe("SUM('Sales -- Archive'[Amount])");
  });

  it('returns null for already-capped (shape-B) or guarded expressions', () => {
    const capped = buildTimeIntelligenceMeasureExpression({
      period: 'YTD',
      baseExpression: '[Total Sales]',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      capToLastDataPeriod: true,
    });
    expect(parseBarePeriodToDate(capped)).toBeNull();
    expect(
      parseBarePeriodToDate("TOTALYTD([m], 'Date'[Date], 'Date'[Date] <= MAX('Date'[Date]))"),
    ).toBeNull();
  });

  it('returns null for non period-to-date or compound expressions', () => {
    expect(parseBarePeriodToDate("CALCULATE([m], 'Date'[Date])")).toBeNull();
    expect(parseBarePeriodToDate("TOTALYTD([m], 'Date'[Date]) + 1")).toBeNull();
    expect(parseBarePeriodToDate('TOTALYTD([m])')).toBeNull();
  });

  it('normalizes CALCULATE plus DATES*TD filters into the bare period-to-date shape', () => {
    expect(parseBarePeriodToDate("CALCULATE([Sales], DATESYTD('Date'[Date]))")).toEqual({
      period: 'YTD',
      baseExpression: '[Sales]',
      datesRef: "'Date'[Date]",
      extraArgs: [],
    });
    expect(parseBarePeriodToDate("CALCULATE([Sales], DATESQTD('Date'[Date]))")?.period).toBe('QTD');
    expect(parseBarePeriodToDate("CALCULATE([Sales], DATESMTD('Date'[Date]))")?.period).toBe('MTD');
  });

  it('keeps nested CALCULATE bases intact when normalizing CALCULATE plus DATESYTD', () => {
    expect(
      parseBarePeriodToDate(
        "CALCULATE(CALCULATE(SUM('Orders'[Amount]), 'Orders'[Qty] <= 100), DATESYTD('Date'[Date]))",
      ),
    ).toEqual({
      period: 'YTD',
      baseExpression: "CALCULATE(SUM('Orders'[Amount]), 'Orders'[Qty] <= 100)",
      datesRef: "'Date'[Date]",
      extraArgs: [],
    });
  });

  it('surfaces DATESYTD year-end and extra CALCULATE filters as extraArgs', () => {
    expect(
      parseBarePeriodToDate('CALCULATE([Sales], DATESYTD(\'Date\'[Date], "06-30"))')?.extraArgs,
    ).toEqual(['"06-30"']);
    expect(
      parseBarePeriodToDate("CALCULATE([Sales], DATESYTD('Date'[Date]), 'Product'[Cat]=\"A\")")
        ?.extraArgs,
    ).toEqual(['\'Product\'[Cat]="A"']);
    expect(
      parseBarePeriodToDate("CALCULATE([Sales], 'Product'[Cat]=\"A\", DATESYTD('Date'[Date]))"),
    ).toEqual({
      period: 'YTD',
      baseExpression: '[Sales]',
      datesRef: "'Date'[Date]",
      extraArgs: ['\'Product\'[Cat]="A"'],
    });
  });

  it('does not double-cap CALCULATE plus DATES*TD and only treats axis <= as a cap', () => {
    expect(
      parseBarePeriodToDate("CALCULATE([Sales], DATESYTD('Date'[Date]), 'Date'[Date] <= _AsOf)"),
    ).toBeNull();
    const valueFilter = parseBarePeriodToDate(
      "CALCULATE([Sales], DATESYTD('Date'[Date]), 'Product'[Price] <= 100)",
    );
    expect(valueFilter).not.toBeNull();
    expect(valueFilter?.extraArgs).toEqual(["'Product'[Price] <= 100"]);
  });

  it('leaves non-DATES*TD and non-spanning CALCULATE expressions untouched', () => {
    expect(
      parseBarePeriodToDate(
        "CALCULATE([Sales], DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -1, YEAR))",
      ),
    ).toBeNull();
    expect(parseBarePeriodToDate("CALCULATE([Sales], DATESYTD('Date'[Date])) + 1")).toBeNull();
    expect(
      parseBarePeriodToDate("CALCULATE([Sales], FILTER(DATESYTD('Date'[Date]), TRUE()))"),
    ).toBeNull();
  });

  it('feeds a DATESYTD-derived parse into the existing shape-B builder output', () => {
    const parsed = parseBarePeriodToDate("CALCULATE(SUM('T'[Profit]), DATESYTD('Date'[Date]))");
    expect(parsed).toEqual({
      period: 'YTD',
      baseExpression: "SUM('T'[Profit])",
      datesRef: "'Date'[Date]",
      extraArgs: [],
    });
    const built = buildTimeIntelligenceMeasureExpression({
      period: parsed?.period ?? 'YTD',
      baseExpression: parsed?.baseExpression ?? '',
      dateTable: 'Date',
      dateKeyColumn: 'Date',
      capToLastDataPeriod: true,
    });
    expect(built).toBe(
      'VAR _LastData =\n' +
        '    CALCULATE(\n' +
        '        MAXX(\n' +
        "            FILTER(VALUES('Date'[Date]), NOT ISBLANK(CALCULATE(SUM('T'[Profit])))),\n" +
        "            'Date'[Date]\n" +
        '        ),\n' +
        "        REMOVEFILTERS('Date')\n" +
        '    )\n' +
        "VAR _CtxMax = MAX('Date'[Date])\n" +
        'VAR _AsOf = MIN(_CtxMax, _LastData)\n' +
        'RETURN\n' +
        "    CALCULATE(TOTALYTD(SUM('T'[Profit]), 'Date'[Date]), 'Date'[Date] <= _AsOf)",
    );
  });
});

describe('calendarOvershootsFactDay', () => {
  it('is true only when the calendar max is strictly later than the fact max (day grain)', () => {
    expect(calendarOvershootsFactDay('2021-01-05T00:00:00', '2020-12-30T00:00:00')).toBe(true);
    expect(calendarOvershootsFactDay('2020-12-30', '2020-12-30')).toBe(false);
    expect(calendarOvershootsFactDay('2020-12-29', '2020-12-30')).toBe(false);
    // same day, different time-of-day -> not an overshoot at day grain
    expect(calendarOvershootsFactDay('2020-12-30T23:00:00', '2020-12-30T01:00:00')).toBe(false);
  });

  it('never claims an overshoot without parseable evidence on both sides', () => {
    expect(calendarOvershootsFactDay(undefined, '2020-12-30')).toBe(false);
    expect(calendarOvershootsFactDay('2021-01-05', undefined)).toBe(false);
    expect(calendarOvershootsFactDay('n/a', '2020-12-30')).toBe(false);
  });
});
