// Code-backed, dataset-agnostic generator for period-to-date time-intelligence
// measures (YTD / QTD / MTD). It exists so agents never hand-author the fragile
// "clamp to the max fact year" guard that broke in the field: that pattern
// over-clamps filtered contexts, breaks drill-down, uses the wrong granularity,
// and — in a multi-fact model — caps every measure at one global date.
//
// Two shapes are produced, both with ZERO hardcoded field/table/date literals
// (every name flows in from model metadata):
//
//   (A) Plain — the calendar ENDS at the last real fact date (rangePolicy
//       observed-min-max / observed-full-years). No guard is needed; plain
//       TOTAL*TD is correct in default, slicer, and drill-down contexts.
//
//   (B) Default-to-last-data-period — only when a longer calendar is deliberately
//       kept (e.g. a shared/conformed calendar that must span a LATER fact such as
//       Ship Date, or a future-horizon policy). It caps the UPPER bound only, at DAY
//       granularity, and never REMOVEFILTERS the user's date selection. So default
//       context stops at the last date THIS MEASURE actually has data, while a
//       user-selected earlier year/quarter/month is preserved unchanged.
//
//       The cap anchor is MEASURE-RELATIVE: the last Date-table date for which the
//       measure's own base expression is non-blank (forced through context
//       transition so it works for a bare measure ref, a raw aggregation, OR a
//       row-filtered base like status="Shipped"). It deliberately does NOT anchor at
//       a named fact date column — that would (a) hardcode one role (Order Date vs
//       Ship Date) and (b) silently blank a row-filtered measure. And it must NEVER
//       anchor at MAX of the Date table itself: that is the CALENDAR end, not the
//       DATA end, so on a calendar that overshoots the facts (the exact case shape
//       (B) exists for) it caps past all data and returns BLANK everywhere. See
//       detectCalendarMaxAnchorCap, which refuses that anti-pattern.

export type TimeIntelligencePeriod = 'YTD' | 'QTD' | 'MTD';

const TOTAL_FN: Record<TimeIntelligencePeriod, string> = {
  YTD: 'TOTALYTD',
  QTD: 'TOTALQTD',
  MTD: 'TOTALMTD',
};

// Map a free-form intent period token (e.g. "YTD", "Year to date", "qtd") to a
// canonical period, or undefined when it is not a period-to-date period.
export function parseTimeIntelligencePeriod(
  period: string | undefined,
): TimeIntelligencePeriod | undefined {
  if (period === undefined) return undefined;
  const p = period.trim().toUpperCase();
  if (p === 'YTD' || p.includes('YEAR TO DATE') || p.includes('YEAR-TO-DATE')) return 'YTD';
  if (p === 'QTD' || p.includes('QUARTER TO DATE') || p.includes('QUARTER-TO-DATE')) return 'QTD';
  if (p === 'MTD' || p.includes('MONTH TO DATE') || p.includes('MONTH-TO-DATE')) return 'MTD';
  return undefined;
}

export interface BarePeriodToDate {
  readonly period: TimeIntelligencePeriod;
  readonly baseExpression: string;
  readonly datesRef: string;
  // Top-level args beyond <base>,<dates> — e.g. a fiscal year_end_date literal or a
  // dimension/lower-bound filter. When non-empty the blank-risk gate MUST NOT
  // silently rebuild the expression (doing so would drop these args and change the
  // result); it re-threads a recognized year-end literal or refuses instead.
  readonly extraArgs: readonly string[];
}

// Strip DAX comments outside string literals / quoted identifiers, so comments
// around a bare call do not defeat the period-to-date anchor below.
function stripDaxComments(expression: string): string {
  let out = '';
  let inString = false;
  let inQuotedIdentifier = false;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    const next = expression[i + 1];
    if (inString) {
      out += ch;
      if (ch === '"' && next === '"') {
        out += next;
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (inQuotedIdentifier) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i++;
        continue;
      }
      if (ch === "'") inQuotedIdentifier = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "'") {
      inQuotedIdentifier = true;
      out += ch;
      continue;
    }
    if ((ch === '/' && next === '/') || (ch === '-' && next === '-')) {
      const nl = expression.indexOf('\n', i + 2);
      if (nl === -1) break;
      out += '\n';
      i = nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = expression.indexOf('*/', i + 2);
      if (close === -1) break;
      out += ' ';
      i = close + 1;
      continue;
    }
    out += ch;
  }
  return out.trim();
}

// True when a TOTALYTD third argument is a fiscal year_end_date literal — a quoted
// "MM-DD"/"MM/DD" month-day boundary, never a dataset field. Lets the blank-risk
// gate re-thread a fiscal year-end through the rebuilt cap instead of dropping it.
export function isYearEndDateLiteral(arg: string): boolean {
  return /^"\s*\d{1,2}\s*[-/]\s*\d{1,2}\s*"$/.test(arg.trim());
}

const BARE_TOTAL_FN: Record<string, TimeIntelligencePeriod> = {
  TOTALYTD: 'YTD',
  TOTALQTD: 'QTD',
  TOTALMTD: 'MTD',
};

const BARE_DATES_FN: Record<string, TimeIntelligencePeriod> = {
  DATESYTD: 'YTD',
  DATESQTD: 'QTD',
  DATESMTD: 'MTD',
};

function splitTopLevelArgs(
  s: string,
  openParenIdx: number,
): { args: string[]; end: number } | null {
  const args: string[] = [];
  let depth = 0;
  let start = openParenIdx + 1;
  let inString = false;
  let inQuotedIdentifier = false;
  let end = -1;
  for (let i = openParenIdx; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];
    if (inString) {
      if (ch === '"' && next === '"') {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (inQuotedIdentifier) {
      if (ch === "'" && next === "'") {
        i++;
        continue;
      }
      if (ch === "'") inQuotedIdentifier = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "'") {
      inQuotedIdentifier = true;
      continue;
    }
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth--;
      if (depth === 0) {
        args.push(s.slice(start, i));
        end = i;
        break;
      }
      continue;
    }
    if (ch === ',' && depth === 1) {
      args.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (end === -1) return null;
  return { args, end };
}

function hasDateAxisUpperBoundArg(extraArgs: readonly string[], datesRef: string): boolean {
  const collapse = (s: string) => s.replace(/\s+/g, '').replace(/'/g, '').toLowerCase();
  const datesRefCollapsed = collapse(datesRef);
  return extraArgs.some((arg) => /<=/.test(arg) && collapse(arg).includes(datesRefCollapsed));
}

function parseDatesPeriodToDateArg(
  arg: string,
): { period: TimeIntelligencePeriod; datesRef: string; extraArgs: string[] } | null {
  const datesHead = /^DATES(?:YTD|QTD|MTD)\s*\(/i.exec(arg);
  if (!datesHead) return null;
  const datesFnName = arg.slice(0, arg.toUpperCase().indexOf('(')).trim().toUpperCase();
  const period = BARE_DATES_FN[datesFnName];
  if (period === undefined) return null;
  const datesSplit = splitTopLevelArgs(arg, datesHead[0].length - 1);
  if (!datesSplit) return null;
  if (arg.slice(datesSplit.end + 1).trim() !== '') return null;
  const datesRef = datesSplit.args[0]?.trim();
  if (!datesRef) return null;
  const extraArgs = datesSplit.args
    .slice(1)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '');
  return { period, datesRef, extraArgs };
}

// Parse a "bare" period-to-date measure body — a single
// TOTALYTD/TOTALQTD/TOTALMTD(<base>, <dates>[, ...]) call spanning the whole
// expression — into its parts. Returns null when the expression is not exactly
// one such call, has fewer than two arguments, or already carries an upper-bound
// cap (an `_AsOf` var or a `<=` date filter — i.e. shape (B) or a custom guard).
// Used to detect the default-context BLANK risk and rebuild the capped form
// deterministically. No model/dataset assumptions; pure string parsing.
export function parseBarePeriodToDate(expression: string): BarePeriodToDate | null {
  const trimmed = stripDaxComments(expression);
  // An explicit as-of cap VAR means an upper bound was already applied by hand.
  // We intentionally do NOT scan the whole string for `<=` here: a `<=` inside the
  // base aggregate's own filter (e.g. CALCULATE(SUM(...), Qty <= 100)) must not be
  // mistaken for a date cap. Top-level args are checked after parsing instead.
  if (/_AsOf\b/.test(trimmed)) return null;
  const head = /^TOTAL(?:YTD|QTD|MTD)\s*\(/i.exec(trimmed);
  if (head) {
    const fnName = trimmed.slice(0, trimmed.toUpperCase().indexOf('(')).trim().toUpperCase();
    const period = BARE_TOTAL_FN[fnName];
    if (period === undefined) return null;
    // Walk from the opening paren, tracking depth and string literals, to find the
    // matching close and the top-level (depth-1) argument boundaries.
    const open = head[0].length - 1;
    const split = splitTopLevelArgs(trimmed, open);
    if (!split) return null;
    const { args, end } = split;
    // The call must span the entire expression — a compound expression is not a bare
    // period-to-date measure and must not be rewritten.
    if (trimmed.slice(end + 1).trim() !== '') return null;
    const baseExpression = args[0]?.trim();
    const datesRef = args[1]?.trim();
    if (!baseExpression || !datesRef) return null;
    const extraArgs = args
      .slice(2)
      .map((arg) => arg.trim())
      .filter((arg) => arg !== '');
    // A top-level `<=` arg is treated as an existing upper-bound DATE cap (so the measure
    // is already guarded — leave it alone) ONLY when it filters the DATE column itself.
    // A `<=` over a non-date value (e.g. 'Product'[Price] <= 100) is NOT a cap: it stays
    // in extraArgs so the blank-risk gate still evaluates it (and refuses to auto-rewrite
    // rather than silently dropping the filter). This is the precise, depth-1 + axis-aware
    // version of the old whole-string `<=` check.
    if (hasDateAxisUpperBoundArg(extraArgs, datesRef)) {
      return null;
    }
    return { period, baseExpression, datesRef, extraArgs };
  }

  const calculateHead = /^CALCULATE\s*\(/i.exec(trimmed);
  if (!calculateHead) return null;
  const calculateOpen = calculateHead[0].length - 1;
  const calculateSplit = splitTopLevelArgs(trimmed, calculateOpen);
  if (!calculateSplit) return null;
  if (trimmed.slice(calculateSplit.end + 1).trim() !== '') return null;
  const calculateArgs = calculateSplit.args;
  const baseExpression = calculateArgs[0]?.trim();
  const datesArg = calculateArgs[1]?.trim();
  if (!baseExpression || !datesArg) return null;

  let datesArgIndex = -1;
  let datesPeriod: TimeIntelligencePeriod | undefined;
  let datesRef: string | undefined;
  let datesExtraArgs: string[] = [];
  for (let i = 1; i < calculateArgs.length; i++) {
    const parsed = parseDatesPeriodToDateArg(calculateArgs[i]?.trim() ?? '');
    if (!parsed) continue;
    datesArgIndex = i;
    datesPeriod = parsed.period;
    datesRef = parsed.datesRef;
    datesExtraArgs = parsed.extraArgs;
    break;
  }
  if (datesArgIndex === -1 || datesPeriod === undefined || datesRef === undefined) return null;

  const extraArgs = [
    ...datesExtraArgs,
    ...calculateArgs.filter((_, index) => index > 0 && index !== datesArgIndex),
  ]
    .map((arg) => arg.trim())
    .filter((arg) => arg !== '');
  if (hasDateAxisUpperBoundArg(extraArgs, datesRef)) {
    return null;
  }
  return { period: datesPeriod, baseExpression, datesRef, extraArgs };
}

// Parse the day-grain ordinal from an ISO date or dateTime string (the leading
// YYYY-MM-DD), or undefined when unparseable. Local helper so callers need not
// import date-grain internals.
function dayOrdinal(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return undefined;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.floor(ms / 86_400_000);
}

// True when the calendar's max date is strictly later (at day grain) than the
// fact's max date — the exact condition under which a bare period-to-date measure
// returns BLANK in default (no-slicer) context. Returns false when either max is
// missing/unparseable: never claim an overshoot without evidence.
export function calendarOvershootsFactDay(
  calendarMaxDate: string | undefined,
  factMaxDate: string | undefined,
): boolean {
  const calendar = dayOrdinal(calendarMaxDate);
  const fact = dayOrdinal(factMaxDate);
  if (calendar === undefined || fact === undefined) return false;
  return calendar > fact;
}

export interface TimeIntelligenceMeasureInput {
  readonly period: TimeIntelligencePeriod;
  // The measure body to wrap as a period-to-date aggregate, e.g. "[Total Sales]"
  // or "SUM('Orders'[Sales])". Passed through verbatim — caller owns its validity.
  readonly baseExpression: string;
  // The marked Date table and its date key column.
  readonly dateTable: string;
  readonly dateKeyColumn: string;
  // Optional fiscal year-end as a DAX literal accepted by TOTALYTD's year_end_date
  // argument, e.g. "\"06-30\"". Applies to YTD only; ignored for QTD/MTD.
  readonly yearEndDate?: string;
  // When true, emit shape (B): cap the upper bound at the last Date-table date for
  // which THIS measure's base expression is non-blank (measure-relative, role- and
  // dataset-agnostic). Omit/false for shape (A) — used only when the calendar is
  // known to end at real data.
  readonly capToLastDataPeriod?: boolean;
}

// DAX-quote a table name (single-quote wrapped, embedded quotes doubled) and a
// column reference, matching the repo convention 'Table'[Column].
function quoteTable(table: string): string {
  return `'${table.replace(/'/g, "''")}'`;
}
function columnRef(table: string, column: string): string {
  return `${quoteTable(table)}[${column}]`;
}

// Build the period-to-date call, threading optional filter and year-end args in
// the correct positions: TOTAL*TD(<expr>, <dates>[, <filter>][, <year_end_date>]).
function totalCall(
  fn: string,
  baseExpression: string,
  datesRef: string,
  opts: { readonly filter?: string; readonly yearEndDate?: string } = {},
): string {
  const args = [baseExpression, datesRef];
  if (opts.filter !== undefined) args.push(opts.filter);
  // year_end_date is only meaningful for TOTALYTD; QTD/MTD do not take it.
  if (opts.yearEndDate !== undefined && fn === 'TOTALYTD') args.push(opts.yearEndDate);
  return `${fn}(${args.join(', ')})`;
}

// Returns the DAX expression body (right-hand side of `Measure = ...`) for the
// requested period-to-date measure, fully generalized from the supplied names.
export function buildTimeIntelligenceMeasureExpression(
  input: TimeIntelligenceMeasureInput,
): string {
  const fn = TOTAL_FN[input.period];
  const datesRef = columnRef(input.dateTable, input.dateKeyColumn);
  const yearEndDate = input.period === 'YTD' ? input.yearEndDate : undefined;

  // Shape (A): plain — correct when the calendar ends at real data.
  if (input.capToLastDataPeriod !== true) {
    return totalCall(fn, input.baseExpression, datesRef, { yearEndDate });
  }

  // Shape (B): default-to-last-data-period. Cap the UPPER bound only.
  const dateTableRef = quoteTable(input.dateTable);
  // CRITICAL: the cap MUST wrap TOTAL*TD on the OUTSIDE — CALCULATE(TOTAL*TD(...), <date> <=
  // _AsOf) — NOT be threaded as TOTAL*TD's inner filter argument. TOTALYTD(expr, dates,
  // filter) === CALCULATE(expr, DATESYTD(dates), filter); DATESYTD picks the YEAR from the
  // last date in the OUTER context (= the calendar end in default no-slicer context), and an
  // inner sibling filter can only SHRINK within that year, not move it — so the inner form
  // still resolves to the empty post-data tail and returns BLANK. The outer CALCULATE applies
  // `<= _AsOf` FIRST, so DATESYTD/QTD/MTD anchors on the last period WITH data. The year-end
  // literal stays inside TOTALYTD (its own arg); only the date cap goes on the outer CALCULATE.
  const inner = totalCall(fn, input.baseExpression, datesRef, { yearEndDate });
  const capped = `CALCULATE(${inner}, ${datesRef} <= _AsOf)`;
  return [
    // _LastData: the MEASURE-RELATIVE last data date — the latest Date-table date for
    // which this measure's base expression is non-blank. CALCULATE(<base>) forces
    // context transition so the base is evaluated PER date (works for a measure ref,
    // a raw aggregation, or a row-filtered base alike). REMOVEFILTERS only the Date
    // table, so the anchor is a stable "last data date" independent of the current
    // date slice while still respecting non-date context. This deliberately does NOT
    // use MAX(${datesRef}) — that is the calendar end, not the data end.
    'VAR _LastData =',
    '    CALCULATE(',
    '        MAXX(',
    `            FILTER(VALUES(${datesRef}), NOT ISBLANK(CALCULATE(${input.baseExpression}))),`,
    `            ${datesRef}`,
    '        ),',
    `        REMOVEFILTERS(${dateTableRef})`,
    '    )',
    // _CtxMax: the latest date the current filter context exposes.
    `VAR _CtxMax = MAX(${datesRef})`,
    // _AsOf: lower the ceiling to the last data date only when context overshoots
    // it; a user-selected earlier period is left untouched.
    'VAR _AsOf = MIN(_CtxMax, _LastData)',
    'RETURN',
    `    ${capped}`,
  ].join('\n');
}

// Detects the CALENDAR-END anchor anti-pattern in a PERIOD-TO-DATE measure: a cap whose
// last-data anchor is the END of the declared date axis (its MAX/LASTDATE with date
// filters cleared) rather than the last date with DATA. On a calendar that deliberately
// overshoots the facts (shape (B)'s whole reason to exist) that caps past all data and the
// measure returns BLANK in every context — the exact regression a hand-edit introduced in
// the field. Callers MUST additionally gate on a real overshoot before refusing (on a
// non-overshooting calendar the same anchor is harmless), so this detector errs toward
// catching the family rather than minimizing matches.
//
// BEST-EFFORT ADVISORY, not a sound-and-complete gate. Detecting "the period-to-date's
// upper bound is anchored at the calendar end" is a semantic property that pure string
// matching cannot decide exactly: broadening to catch every filter-clear form (no-arg
// ALL(), ALLEXCEPT, multi-arg REMOVEFILTERS) inevitably also matches a legitimate compound
// measure that co-locates a period-to-date with an unrelated calendar-anchored rolling
// window. So the caller treats a positive as a NON-BLOCKING WARNING (surfaced as
// blankRiskWarning), never a hard refusal — a missed form just means no advisory (the
// deterministic protection is the generator + the bare-overshoot rewrite, not this), and a
// spurious match only adds a verify-this note. Pure string detection, no model/dataset
// assumptions. Scoped to period-to-date measures (TOTAL*TD / DATES*TD) so a pure
// rolling-window or PY/PM measure is never flagged. Case-insensitive. It deliberately does
// NOT match the generator's own MAXX(FILTER(VALUES(axis), NOT ISBLANK(...)), axis), nor the
// `_AsOf = MIN(MAX(axis), _LastData)` ceiling (a bare MAX with no filter-clear), nor a
// fact-column anchor MAX('Orders'[Order Date]).
export function detectCalendarMaxAnchorCap(
  expression: string,
  dateTable: string,
  dateColumn: string,
): boolean {
  const collapsed = expression.replace(/\s+/g, '').toLowerCase();
  // Only a period-to-date aggregate can exhibit this blank-everywhere cap.
  if (!/(?:total|dates)(?:ytd|qtd|mtd)\(/.test(collapsed)) return false;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Build regex fragments from the RAW names (embedded quotes doubled, like quoteTable) and
  // make the table's surrounding single-quotes OPTIONAL — DAX accepts an unquoted table ref
  // (Date[Date]) for a name without spaces/specials, and a hand-edit may use it.
  const tb = `'?${esc(dateTable.replace(/'/g, "''").replace(/\s+/g, '').toLowerCase())}'?`;
  const ax = `${tb}\\[${esc(dateColumn.replace(/\s+/g, '').toLowerCase())}\\]`;
  // Form 1: CALCULATE(MAX|LASTDATE(axis), <filter-clear>...) — the calendar end taken with
  // filters cleared. The clear can be REMOVEFILTERS/ALL/ALLEXCEPT/ALLSELECTED in any arg shape
  // (incl no-arg ALL()/REMOVEFILTERS() and multi-arg), so we only require a clear function to
  // OPEN immediately as CALCULATE's second argument. Matches MAX( but never MAXX( (the
  // generator form). Best-effort: an inline comment between CALCULATE and MAX is not chased.
  if (
    new RegExp(
      `calculate\\((?:max|lastdate)\\(${ax}\\),(?:removefilters|allexcept|allselected|all)\\(`,
    ).test(collapsed)
  ) {
    return true;
  }
  // Form 2: MAXX(VALUES|ALL|ALLSELECTED(axis-or-table), axis) — the axis end over a filter-
  // cleared row set, whether iterated over the date COLUMN or the whole date TABLE. The
  // generator's safe form is MAXX(FILTER(VALUES(axis), ...), axis) (FILTER wraps VALUES), so
  // requiring the clear immediately after MAXX( excludes it. Best-effort: a clear wrapped in
  // FILTER(...)/DISTINCT(...) is intentionally not chased (advisory, non-blocking).
  return new RegExp(`maxx\\((?:values|allselected|all)\\((?:${ax}|${tb})\\),${ax}\\)`).test(
    collapsed,
  );
}
