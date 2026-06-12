import { isNumericType, isTemporalType } from './data-types.js';
import { classifyTable } from './fact-classifier.js';
import { relationshipCheck } from './relationship-check.js';
import type { TMDLColumn, TMDLMeasure, TMDLModel, TMDLRelationship, TMDLTable } from './types.js';

export interface DateGrainFactInput {
  readonly tableName: string;
  readonly dateColumn: string;
}

export interface DateGrainPlanOptions {
  readonly facts: ReadonlyArray<DateGrainFactInput>;
  readonly dateTable?: string;
  readonly dateColumn?: string;
  readonly dateTableCoverageEvidence?: DateTableCoverageProbeEvidence;
  readonly futureHorizonDays?: number;
  readonly allowCalendarEndAfterFactMax?: boolean;
}

export type ObservedDateGrain =
  | 'day'
  | 'submonthly'
  | 'month-start'
  | 'month-single-date'
  | 'empty'
  | 'unknown';

export interface DateGrainProbeEvidence {
  readonly tableName: string;
  readonly dateColumn: string;
  readonly rowCount?: number;
  readonly nonBlankDateCount?: number;
  readonly distinctDateCount?: number;
  readonly distinctMonthStartCount?: number;
  readonly nonMonthStartDateCount?: number;
  readonly monthsWithMultipleDates?: number;
  readonly maxDistinctDatesPerMonth?: number;
  readonly blankDateCount?: number;
  readonly duplicateDateCount?: number;
  readonly gapCount?: number;
  readonly nonMidnightTimeCount?: number;
  readonly minDate?: string;
  readonly maxDate?: string;
}

export interface DateGrainPlanResult {
  readonly design: 'date-grain';
  readonly probeRequired: boolean;
  readonly facts: ReadonlyArray<FactDateGrainPlan>;
  readonly blockers: ReadonlyArray<DateGrainBlocker>;
  readonly dateTableCoverage?: DateTableCoveragePlanResult;
  readonly autoDateTables: {
    readonly count: number;
    readonly names: ReadonlyArray<string>;
    readonly recommendation?: string;
  };
}

export interface DateTableCoveragePlanOptions {
  readonly dateTable: string;
  readonly dateColumn: string;
  readonly facts: ReadonlyArray<DateGrainFactInput>;
  readonly futureHorizonDays?: number;
  readonly allowCalendarEndAfterFactMax?: boolean;
}

export interface CalendarSourceRisk {
  readonly code: 'volatile-calendar-anchor' | 'literal-calendar-range';
  readonly message: string;
  readonly sourceKind?: string;
}

export interface DateTableKeyProbeEvidence {
  readonly tableName: string;
  readonly dateColumn: string;
  readonly rowCount?: number;
  readonly nonBlankDateCount?: number;
  readonly distinctDateCount?: number;
  readonly blankDateCount?: number;
  readonly duplicateDateCount?: number;
  readonly gapCount?: number;
  readonly nonMidnightTimeCount?: number;
  readonly minDate?: string;
  readonly maxDate?: string;
}

export interface DateTableCoverageProbeEvidence {
  readonly dateTable?: DateTableKeyProbeEvidence;
  readonly facts: ReadonlyArray<DateGrainProbeEvidence>;
}

export interface DateTableCoveragePlanResult {
  readonly design: 'date-table-coverage';
  readonly status: 'valid' | 'blocked' | 'unknown';
  readonly recommendedRange: {
    readonly observedFactMinDate?: string;
    readonly observedFactMaxDate?: string;
    readonly calendarStartDate?: string;
    readonly calendarEndDate?: string;
    readonly requiresExplicitForecastHorizon: boolean;
    readonly message: string;
  };
  readonly dateTable: {
    readonly tableName: string;
    readonly dateColumn: string;
    readonly exists: boolean;
    readonly columnExists: boolean;
    readonly isAutoDateTable: boolean;
    readonly isMarkedDateTable: boolean;
    readonly isTemporalKey: boolean;
    readonly hasVolatileAnchor: boolean;
    readonly evidence?: DateTableKeyProbeEvidence;
  };
  readonly factCoverage: ReadonlyArray<DateTableFactCoverage>;
  readonly blockers: ReadonlyArray<DateTableCoverageBlocker>;
  readonly autoDateTables: DateGrainPlanResult['autoDateTables'];
  readonly recommendation: string;
}

export interface DateTableFactCoverage {
  readonly tableName: string;
  readonly dateColumn: string;
  readonly factMinDate?: string;
  readonly factMaxDate?: string;
  readonly covered: boolean;
  readonly blocking: ReadonlyArray<DateTableCoverageBlocker>;
}

export type DateTableCoverageBlocker = {
  readonly code:
    | 'date-table-not-found'
    | 'date-column-not-found'
    | 'date-table-is-auto'
    | 'date-table-not-marked'
    | 'date-column-not-temporal-key'
    | 'date-table-proof-mismatch'
    | 'date-table-proof-missing'
    | 'date-table-has-blanks'
    | 'date-table-has-duplicates'
    | 'date-table-has-gaps'
    | 'date-table-has-time-component'
    | 'date-column-not-key'
    | 'fact-date-proof-missing'
    | 'fact-date-has-time-component'
    | 'date-table-start-after-fact-min'
    | 'date-table-end-before-fact-max'
    | 'date-table-end-after-fact-max-without-policy'
    | 'calendar-source-proof-missing'
    | 'volatile-calendar-anchor'
    | 'literal-calendar-range'
    | 'fact-table-not-found'
    | 'fact-date-column-not-found'
    | 'fact-date-column-not-temporal';
  readonly message: string;
  readonly table?: string;
  readonly column?: string;
  readonly factTable?: string;
  readonly factColumn?: string;
};

export interface FactDateGrainPlan {
  readonly tableName: string;
  readonly dateColumn: string;
  readonly metadata: {
    readonly columnDataType?: string;
    readonly dateCompatible: boolean;
    readonly reason?: string;
  };
  readonly observedGrain: ObservedDateGrain;
  readonly evidence?: DateGrainProbeEvidence;
  readonly relationship: DateRelationshipPlan;
  readonly measureGuidance: {
    readonly plainSumSafe: boolean;
    readonly removeDateTruncatingTreatas: boolean;
    readonly safeVisualDateGrain: 'day-or-above' | 'month-or-above' | 'unknown';
    readonly dateTruncatingMeasureCandidates: ReadonlyArray<DateTruncatingMeasureCandidate>;
    readonly message: string;
  };
  readonly writePlan: ReadonlyArray<DateGrainWritePlanItem>;
}

export interface DateTruncatingMeasureCandidate {
  readonly table: string;
  readonly name: string;
  readonly reason: 'treatas-date-truncation-pattern';
}

export type DateRelationshipPlan =
  | ExistingDateRelationshipPlan
  | MissingDateRelationshipPlan
  | AmbiguousDateRelationshipPlan
  | UnknownDateRelationshipPlan;

export interface ExistingDateRelationshipPlan {
  readonly status: 'active' | 'inactive';
  readonly id: string;
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly cardinality?: string;
  readonly crossFilteringBehavior: string;
  readonly canActivate: boolean;
  readonly activationBlocking: ReadonlyArray<{ readonly code: string; readonly message: string }>;
}

export interface MissingDateRelationshipPlan {
  readonly status: 'missing';
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable?: string;
  readonly toColumn?: string;
  readonly canCreate: boolean;
  readonly blocking: ReadonlyArray<{ readonly code: string; readonly message: string }>;
}

export interface AmbiguousDateRelationshipPlan {
  readonly status: 'ambiguous';
  readonly candidates: ReadonlyArray<ExistingDateRelationshipPlan>;
}

export interface UnknownDateRelationshipPlan {
  readonly status: 'unknown';
  readonly reason: string;
}

export type DateGrainWritePlanItem =
  | ActivateDateRelationshipPlanItem
  | CreateDateRelationshipPlanItem;

export interface ActivateDateRelationshipPlanItem {
  readonly action: 'activate-date-relationship';
  readonly id: string;
  readonly description: string;
}

export interface CreateDateRelationshipPlanItem {
  readonly action: 'create-date-relationship';
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly cardinality: 'manyToOne';
  readonly crossFilteringBehavior: 'single';
  readonly isActive: true;
  readonly description: string;
}

export type DateGrainBlocker =
  | DateGrainTableMissingBlocker
  | DateGrainColumnMissingBlocker
  | DateGrainUnsupportedColumnBlocker;

export interface DateGrainTableMissingBlocker {
  readonly code: 'table-not-found';
  readonly table: string;
  readonly message: string;
}

export interface DateGrainColumnMissingBlocker {
  readonly code: 'date-column-not-found';
  readonly table: string;
  readonly column: string;
  readonly message: string;
}

export interface DateGrainUnsupportedColumnBlocker {
  readonly code: 'date-column-not-temporal';
  readonly table: string;
  readonly column: string;
  readonly dataType?: string;
  readonly message: string;
}

export function planDateGrain(
  model: TMDLModel,
  options: DateGrainPlanOptions,
  evidence: ReadonlyArray<DateGrainProbeEvidence> = [],
): DateGrainPlanResult {
  const blockers: DateGrainBlocker[] = [];
  const tableByName = new Map(model.tables.map((table) => [table.name, table]));
  const evidenceByKey = new Map(
    evidence.map((item) => [probeKey(item.tableName, item.dateColumn), item]),
  );
  const requiredCoverageFacts =
    options.dateTable && options.dateColumn
      ? deriveRequiredDateCoverageFacts(model, {
          dateTable: options.dateTable,
          dateColumn: options.dateColumn,
          facts: options.facts,
          futureHorizonDays: options.futureHorizonDays,
        })
      : options.facts;
  const dateCoverage =
    options.dateTable && options.dateColumn && options.dateTableCoverageEvidence
      ? planDateTableCoverage(
          model,
          {
            dateTable: options.dateTable,
            dateColumn: options.dateColumn,
            facts: requiredCoverageFacts,
            futureHorizonDays: options.futureHorizonDays,
            allowCalendarEndAfterFactMax: options.allowCalendarEndAfterFactMax,
          },
          options.dateTableCoverageEvidence,
        )
      : undefined;

  const facts = options.facts.map((fact) => {
    const table = tableByName.get(fact.tableName);
    if (!table) {
      blockers.push({
        code: 'table-not-found',
        table: fact.tableName,
        message: `Table not found: ${fact.tableName}`,
      });
      return missingFactPlan(fact);
    }

    const column = table.columns.find((candidate) => candidate.name === fact.dateColumn);
    if (!column) {
      blockers.push({
        code: 'date-column-not-found',
        table: fact.tableName,
        column: fact.dateColumn,
        message: `Date column "${fact.dateColumn}" does not exist on table "${fact.tableName}".`,
      });
      return missingColumnPlan(fact);
    }

    const metadata = dateColumnMetadata(column);
    if (!metadata.dateCompatible) {
      blockers.push({
        code: 'date-column-not-temporal',
        table: fact.tableName,
        column: fact.dateColumn,
        dataType: column.dataType,
        message: `Column "${fact.tableName}"[${fact.dateColumn}] is ${column.dataType}, so date-grain probing is not safe.`,
      });
    }

    const factEvidence = evidenceByKey.get(probeKey(fact.tableName, fact.dateColumn));
    const observedGrain = classifyObservedDateGrain(factEvidence);
    const exactDayProof = isExactDayGrainProof(factEvidence);
    const dayRelationshipSafe = isDayRelationshipDateGrainSafe(observedGrain, factEvidence);
    const relationship = resolveDateRelationship(model, table, column, options);
    const dateTruncatingMeasureCandidates = findDateTruncatingMeasureCandidates(
      model,
      fact.tableName,
      fact.dateColumn,
    );
    const writePlan = buildWritePlan(
      model,
      observedGrain,
      dayRelationshipSafe,
      relationship,
      dateCoverage?.status === 'valid',
    );

    return {
      tableName: fact.tableName,
      dateColumn: fact.dateColumn,
      metadata,
      observedGrain,
      ...(factEvidence ? { evidence: factEvidence } : {}),
      relationship,
      measureGuidance: buildMeasureGuidance(
        observedGrain,
        exactDayProof,
        dateTruncatingMeasureCandidates,
        dayRelationshipSafe,
      ),
      writePlan,
    };
  });

  return {
    design: 'date-grain',
    probeRequired: facts.some((fact) => fact.metadata.dateCompatible && !fact.evidence),
    facts,
    blockers,
    ...(dateCoverage ? { dateTableCoverage: dateCoverage } : {}),
    autoDateTables: autoDateTableSummary(model),
  };
}

export function buildDateGrainProbeQuery(
  model: TMDLModel,
  facts: ReadonlyArray<DateGrainFactInput>,
): string | undefined {
  const tableByName = new Map(model.tables.map((table) => [table.name, table]));
  const rows: string[] = [];

  for (const fact of facts) {
    const table = tableByName.get(fact.tableName);
    const column = table?.columns.find((candidate) => candidate.name === fact.dateColumn);
    if (!column || !isTemporalColumn(column)) continue;
    rows.push(buildProbeRow(fact.tableName, fact.dateColumn));
  }

  if (rows.length === 0) return undefined;
  if (rows.length === 1) return `EVALUATE\n${rows[0]}`;
  return `EVALUATE\nUNION(\n${rows.map((row) => indent(row, 2)).join(',\n')}\n)`;
}

export function parseDateGrainProbeResult(payload: unknown): ReadonlyArray<DateGrainProbeEvidence> {
  return extractRows(payload)
    .filter((row) => stringValue(row, '__kind') !== 'date-table')
    .map((row) => {
      const tableName = stringValue(row, '__table', 'tableName', 'table');
      const dateColumn = stringValue(row, '__column', 'dateColumn', 'column');
      if (!tableName || !dateColumn) return undefined;
      const rowCount = numberValue(row, 'rowCount');
      const nonBlankDateCount = numberValue(row, 'nonBlankDateCount');
      const distinctDateCount = numberValue(row, 'distinctDateCount');
      const distinctMonthStartCount = numberValue(row, 'distinctMonthStartCount');
      const nonMonthStartDateCount = numberValue(row, 'nonMonthStartDateCount');
      const monthsWithMultipleDates = numberValue(row, 'monthsWithMultipleDates');
      const maxDistinctDatesPerMonth = numberValue(row, 'maxDistinctDatesPerMonth');
      const blankDateCount = numberValue(row, 'blankDateCount');
      const duplicateDateCount = numberValue(row, 'duplicateDateCount');
      const gapCount = numberValue(row, 'gapCount');
      const nonMidnightTimeCount = numberValue(row, 'nonMidnightTimeCount');
      const minDate = stringValue(row, 'minDate');
      const maxDate = stringValue(row, 'maxDate');
      return {
        tableName,
        dateColumn,
        ...(rowCount !== undefined ? { rowCount } : {}),
        ...(nonBlankDateCount !== undefined ? { nonBlankDateCount } : {}),
        ...(distinctDateCount !== undefined ? { distinctDateCount } : {}),
        ...(distinctMonthStartCount !== undefined ? { distinctMonthStartCount } : {}),
        ...(nonMonthStartDateCount !== undefined ? { nonMonthStartDateCount } : {}),
        ...(monthsWithMultipleDates !== undefined ? { monthsWithMultipleDates } : {}),
        ...(maxDistinctDatesPerMonth !== undefined ? { maxDistinctDatesPerMonth } : {}),
        ...(blankDateCount !== undefined ? { blankDateCount } : {}),
        ...(duplicateDateCount !== undefined ? { duplicateDateCount } : {}),
        ...(gapCount !== undefined ? { gapCount } : {}),
        ...(nonMidnightTimeCount !== undefined ? { nonMidnightTimeCount } : {}),
        ...(minDate !== undefined ? { minDate } : {}),
        ...(maxDate !== undefined ? { maxDate } : {}),
      };
    })
    .filter((row): row is DateGrainProbeEvidence => row !== undefined);
}

export function buildDateTableCoverageProbeQuery(
  model: TMDLModel,
  options: DateTableCoveragePlanOptions,
): string | undefined {
  const tableByName = new Map(model.tables.map((table) => [table.name, table]));
  const facts = deriveRequiredDateCoverageFacts(model, options);
  const rows: string[] = [];
  const dateTable = tableByName.get(options.dateTable);
  const dateColumn = dateTable?.columns.find((column) => column.name === options.dateColumn);
  if (dateColumn && isTemporalColumn(dateColumn)) {
    rows.push(buildProbeRow(options.dateTable, options.dateColumn, 'date-table'));
  }

  for (const fact of facts) {
    const table = tableByName.get(fact.tableName);
    const column = table?.columns.find((candidate) => candidate.name === fact.dateColumn);
    if (!column || !isTemporalColumn(column)) continue;
    rows.push(buildProbeRow(fact.tableName, fact.dateColumn, 'fact'));
  }

  if (rows.length === 0) return undefined;
  if (rows.length === 1) return `EVALUATE\n${rows[0]}`;
  return `EVALUATE\nUNION(\n${rows.map((row) => indent(row, 2)).join(',\n')}\n)`;
}

export function parseDateTableCoverageProbeResult(
  payload: unknown,
): DateTableCoverageProbeEvidence {
  const rows = extractRows(payload);
  const dateTableRow = rows.find((row) => stringValue(row, '__kind') === 'date-table');
  return {
    ...(dateTableRow ? { dateTable: toDateTableEvidence(dateTableRow) } : {}),
    facts: parseDateGrainProbeResult(payload),
  };
}

export function planDateTableCoverage(
  model: TMDLModel,
  options: DateTableCoveragePlanOptions,
  evidence: DateTableCoverageProbeEvidence = { facts: [] },
): DateTableCoveragePlanResult {
  const requiredFacts = deriveRequiredDateCoverageFacts(model, options);
  const table = model.tables.find((candidate) => candidate.name === options.dateTable);
  const column = table?.columns.find((candidate) => candidate.name === options.dateColumn);
  const blockers: DateTableCoverageBlocker[] = [];
  const rawDateTableEvidence = evidence.dateTable;
  const dateTableEvidence =
    rawDateTableEvidence?.tableName === options.dateTable &&
    rawDateTableEvidence.dateColumn === options.dateColumn
      ? rawDateTableEvidence
      : undefined;
  if (
    rawDateTableEvidence &&
    (rawDateTableEvidence.tableName !== options.dateTable ||
      rawDateTableEvidence.dateColumn !== options.dateColumn)
  ) {
    blockers.push({
      code: 'date-table-proof-mismatch',
      table: options.dateTable,
      column: options.dateColumn,
      message: `Date-table proof was returned for "${rawDateTableEvidence.tableName}"[${rawDateTableEvidence.dateColumn}], not "${options.dateTable}"[${options.dateColumn}].`,
    });
  }

  if (!table) {
    blockers.push({
      code: 'date-table-not-found',
      table: options.dateTable,
      message: `Date table not found: ${options.dateTable}`,
    });
  }
  if (table && !column) {
    blockers.push({
      code: 'date-column-not-found',
      table: options.dateTable,
      column: options.dateColumn,
      message: `Date key column "${options.dateColumn}" does not exist on table "${options.dateTable}".`,
    });
  }
  if (table?.isAutoDateTable) {
    blockers.push({
      code: 'date-table-is-auto',
      table: table.name,
      message:
        'Auto date tables are generated implementation details, not governed date dimensions.',
    });
  }
  if (table && column && !isMarkedDateTable(table, column)) {
    blockers.push({
      code: 'date-table-not-marked',
      table: table.name,
      column: column.name,
      message:
        'The governed date table must be marked as a Date table before it is used as the time-intelligence axis.',
    });
  }
  if (column && !isTemporalColumn(column)) {
    blockers.push({
      code: 'date-column-not-temporal-key',
      table: options.dateTable,
      column: options.dateColumn,
      message: `Date key "${options.dateTable}"[${options.dateColumn}] is ${column.dataType}, not date/dateTime.`,
    });
  }
  if (table && column && !column.isKey && !isMarkedDateTable(table, column)) {
    blockers.push({
      code: 'date-column-not-key',
      table: options.dateTable,
      column: options.dateColumn,
      message: `Date key "${options.dateTable}"[${options.dateColumn}] is not marked as the table key.`,
    });
  }

  const sourceRisks = findDateTableSourceRisks(table);
  const hasVolatileAnchor = sourceRisks.some((risk) => risk.code === 'volatile-calendar-anchor');
  const hasSourceProvenance =
    table?.expression !== undefined || (table?.partitionSources?.length ?? 0) > 0;
  if (
    model.modelPath === '(live)' &&
    table &&
    column &&
    isMarkedDateTable(table, column) &&
    !hasSourceProvenance
  ) {
    blockers.push({
      code: 'calendar-source-proof-missing',
      table: options.dateTable,
      column: options.dateColumn,
      message:
        'Live Date-table source expression is not proven. Refusing to rely on a Date table whose calendar bounds cannot be checked for volatile or hardcoded anchors.',
    });
  }
  for (const risk of sourceRisks) {
    blockers.push({
      code: risk.code,
      table: options.dateTable,
      column: options.dateColumn,
      message: risk.message,
    });
  }

  if (!hasCompleteDateTableKeyProof(dateTableEvidence)) {
    blockers.push({
      code: 'date-table-proof-missing',
      table: options.dateTable,
      column: options.dateColumn,
      message:
        'Date-table coverage is not proven by a live data probe. Do not edit calendar bounds or rely on this table for relationship rewrites from prompt judgment alone.',
    });
  } else if (dateTableEvidence) {
    if (dateTableEvidence.blankDateCount > 0) {
      blockers.push({
        code: 'date-table-has-blanks',
        table: options.dateTable,
        column: options.dateColumn,
        message: 'The date table key contains blank values.',
      });
    }
    if (dateTableEvidence.duplicateDateCount > 0) {
      blockers.push({
        code: 'date-table-has-duplicates',
        table: options.dateTable,
        column: options.dateColumn,
        message: 'The date table key contains duplicate dates.',
      });
    }
    if (dateTableEvidence.gapCount > 0) {
      blockers.push({
        code: 'date-table-has-gaps',
        table: options.dateTable,
        column: options.dateColumn,
        message: 'The date table key is not contiguous at daily grain.',
      });
    }
    if ((dateTableEvidence.nonMidnightTimeCount ?? 0) > 0) {
      blockers.push({
        code: 'date-table-has-time-component',
        table: options.dateTable,
        column: options.dateColumn,
        message: 'The date table key contains DateTime values with a non-midnight time component.',
      });
    }
  }

  const factCoverage = requiredFacts.map((fact) =>
    buildFactCoverage(model, fact, evidence.facts, dateTableEvidence),
  );
  for (const coverage of factCoverage) blockers.push(...coverage.blocking);
  const dateMax = dateOnlyOrdinal(dateTableEvidence?.maxDate);
  const factMaxes = requiredFacts
    .map((fact) =>
      evidence.facts.find(
        (candidate) =>
          candidate.tableName === fact.tableName && candidate.dateColumn === fact.dateColumn,
      ),
    )
    .map((factEvidence) => dateOnlyOrdinal(factEvidence?.maxDate))
    .filter((value): value is number => value !== undefined);
  if (
    hasCompleteDateTableKeyProof(dateTableEvidence) &&
    requiredFacts.length > 0 &&
    factMaxes.length === requiredFacts.length &&
    dateMax !== undefined &&
    dateMax > Math.max(...factMaxes) + (options.futureHorizonDays ?? 0) &&
    options.allowCalendarEndAfterFactMax !== true
  ) {
    blockers.push({
      code: 'date-table-end-after-fact-max-without-policy',
      table: options.dateTable,
      column: options.dateColumn,
      message:
        'The date table extends beyond the observed maximum date across the supplied facts without a sufficient explicit futureHorizonDays policy.',
    });
  }
  const recommendedRange = buildRecommendedDateRange(requiredFacts, evidence.facts);

  const onlyProofMissing =
    blockers.length > 0 &&
    blockers.every((blocker) =>
      ['date-table-proof-missing', 'fact-date-proof-missing'].includes(blocker.code),
    );
  const status = blockers.length === 0 ? 'valid' : onlyProofMissing ? 'unknown' : 'blocked';

  return {
    design: 'date-table-coverage',
    status,
    recommendedRange,
    dateTable: {
      tableName: options.dateTable,
      dateColumn: options.dateColumn,
      exists: table !== undefined,
      columnExists: column !== undefined,
      isAutoDateTable: table?.isAutoDateTable ?? false,
      isMarkedDateTable: table && column ? isMarkedDateTable(table, column) : false,
      isTemporalKey:
        table !== undefined &&
        column !== undefined &&
        isTemporalColumn(column) &&
        (column.isKey || isMarkedDateTable(table, column)),
      hasVolatileAnchor,
      ...(dateTableEvidence ? { evidence: dateTableEvidence } : {}),
    },
    factCoverage,
    blockers,
    autoDateTables: autoDateTableSummary(model),
    recommendation:
      'Use one explicit, marked date table whose daily key covers the observed min/max dates of every related fact. Anchor default calendar bounds to observed fact min/max dates, not TODAY()/NOW(); future padding requires an explicit forecast horizon policy.',
  };
}

export function deriveRequiredDateCoverageFacts(
  model: TMDLModel,
  options: DateTableCoveragePlanOptions,
): ReadonlyArray<DateGrainFactInput> {
  const facts = new Map<string, DateGrainFactInput>();
  const setFact = (fact: DateGrainFactInput): void => {
    facts.set(probeKey(fact.tableName, fact.dateColumn), fact);
  };
  const addDerivedFact = (fact: DateGrainFactInput): void => {
    const table = model.tables.find((candidate) => candidate.name === fact.tableName);
    const column = table?.columns.find((candidate) => candidate.name === fact.dateColumn);
    if (!table || !column || !isTemporalColumn(column)) return;
    if (table.name === options.dateTable || table.isAutoDateTable || isDateTableLike(table)) return;
    setFact(fact);
  };

  for (const relationship of model.relationships) {
    const fromIsDate =
      relationship.fromTable === options.dateTable &&
      relationship.fromColumn === options.dateColumn;
    const toIsDate =
      relationship.toTable === options.dateTable && relationship.toColumn === options.dateColumn;
    if (fromIsDate) {
      addDerivedFact({ tableName: relationship.toTable, dateColumn: relationship.toColumn });
    }
    if (toIsDate) {
      addDerivedFact({ tableName: relationship.fromTable, dateColumn: relationship.fromColumn });
    }
  }

  for (const table of model.tables) {
    if (!looksLikeDateCoverageFactTable(model, table, options.dateTable)) continue;
    for (const column of table.columns) {
      if (!isTemporalColumn(column)) continue;
      addDerivedFact({ tableName: table.name, dateColumn: column.name });
    }
  }

  for (const fact of options.facts) setFact(fact);

  return [...facts.values()];
}

export function classifyObservedDateGrain(
  evidence: DateGrainProbeEvidence | undefined,
): ObservedDateGrain {
  if (!evidence) return 'unknown';
  if (!hasCompleteDateGrainProof(evidence)) return 'unknown';
  const nonBlankDateCount = evidence.nonBlankDateCount;
  const distinctDateCount = evidence.distinctDateCount;
  if (nonBlankDateCount === 0 || distinctDateCount === 0) return 'empty';

  const distinctMonthStartCount = evidence.distinctMonthStartCount;
  const nonMonthStartDateCount = evidence.nonMonthStartDateCount;
  const monthsWithMultipleDates = evidence.monthsWithMultipleDates;
  const maxDistinctDatesPerMonth = evidence.maxDistinctDatesPerMonth;
  const minDate = dateOnlyOrdinal(evidence.minDate);
  const maxDate = dateOnlyOrdinal(evidence.maxDate);
  if (minDate === undefined || maxDate === undefined || maxDate < minDate) return 'unknown';
  const observedDaySpan = maxDate - minDate + 1;
  const dateDensity = observedDaySpan > 0 ? distinctDateCount / observedDaySpan : 0;

  if (
    nonMonthStartDateCount > 0 &&
    (dateDensity >= 0.5 ||
      maxDistinctDatesPerMonth >= 15 ||
      (monthsWithMultipleDates >= 6 && maxDistinctDatesPerMonth >= 6))
  ) {
    return 'day';
  }
  if (distinctDateCount === distinctMonthStartCount) {
    return nonMonthStartDateCount === 0 ? 'month-start' : 'month-single-date';
  }
  if (distinctDateCount > distinctMonthStartCount) {
    return 'submonthly';
  }
  return 'unknown';
}

function isExactDayGrainProof(evidence: DateGrainProbeEvidence | undefined): boolean {
  if (!evidence || !hasCompleteDateGrainProof(evidence)) return false;
  const minDate = dateOnlyOrdinal(evidence.minDate);
  const maxDate = dateOnlyOrdinal(evidence.maxDate);
  if (minDate === undefined || maxDate === undefined || maxDate < minDate) return false;
  const observedDaySpan = maxDate - minDate + 1;
  return (
    evidence.nonBlankDateCount > 0 &&
    evidence.distinctDateCount === observedDaySpan &&
    evidence.nonMonthStartDateCount > 0 &&
    evidence.blankDateCount === 0 &&
    evidence.gapCount === 0 &&
    evidence.nonMidnightTimeCount === 0
  );
}

function isDayRelationshipDateGrainSafe(
  observedGrain: ObservedDateGrain,
  evidence: DateGrainProbeEvidence | undefined,
): boolean {
  return (
    observedGrain === 'day' &&
    hasCompleteDateGrainProof(evidence) &&
    evidence.nonBlankDateCount > 0 &&
    evidence.distinctDateCount > 0 &&
    evidence.blankDateCount === 0 &&
    evidence.nonMidnightTimeCount === 0
  );
}

function missingFactPlan(fact: DateGrainFactInput): FactDateGrainPlan {
  return {
    tableName: fact.tableName,
    dateColumn: fact.dateColumn,
    metadata: {
      dateCompatible: false,
      reason: 'table-not-found',
    },
    observedGrain: 'unknown',
    relationship: {
      status: 'unknown',
      reason: 'table-not-found',
    },
    measureGuidance: buildMeasureGuidance('unknown', false, []),
    writePlan: [],
  };
}

function missingColumnPlan(fact: DateGrainFactInput): FactDateGrainPlan {
  return {
    tableName: fact.tableName,
    dateColumn: fact.dateColumn,
    metadata: {
      dateCompatible: false,
      reason: 'date-column-not-found',
    },
    observedGrain: 'unknown',
    relationship: {
      status: 'unknown',
      reason: 'date-column-not-found',
    },
    measureGuidance: buildMeasureGuidance('unknown', false, []),
    writePlan: [],
  };
}

function dateColumnMetadata(column: TMDLColumn): FactDateGrainPlan['metadata'] {
  if (!isTemporalColumn(column)) {
    return {
      columnDataType: column.dataType,
      dateCompatible: false,
      reason: 'date-grain-probe-requires-date-or-dateTime',
    };
  }
  return {
    columnDataType: column.dataType,
    dateCompatible: true,
  };
}

function isTemporalColumn(column: TMDLColumn): boolean {
  return isTemporalType(column.dataType);
}

function resolveDateRelationship(
  model: TMDLModel,
  factTable: TMDLTable,
  factColumn: TMDLColumn,
  options: DateGrainPlanOptions,
): DateRelationshipPlan {
  const candidates = model.relationships
    .filter((relationship) =>
      relationshipTouchesFactDate(relationship, factTable.name, factColumn.name),
    )
    .filter((relationship) =>
      relationshipMatchesRequestedDateDimension(
        relationship,
        factTable.name,
        factColumn.name,
        options,
      ),
    )
    .map((relationship) => toExistingRelationshipPlan(relationship, model));

  if (candidates.length > 1) {
    const nonAuto = candidates.filter((candidate) => {
      const otherTable = otherRelationshipTable(candidate, factTable.name);
      return !model.tables.find((table) => table.name === otherTable)?.isAutoDateTable;
    });
    const onlyNonAuto = nonAuto[0];
    if (nonAuto.length === 1 && onlyNonAuto) return activeStatus(onlyNonAuto);
    return { status: 'ambiguous', candidates };
  }

  const onlyCandidate = candidates[0];
  if (candidates.length === 1 && onlyCandidate) return activeStatus(onlyCandidate);

  if (!options.dateTable || !options.dateColumn) {
    return {
      status: 'unknown',
      reason: 'no matching date relationship found and dateTable/dateColumn were not supplied',
    };
  }

  const check = relationshipCheck(
    {
      fromTable: factTable.name,
      fromColumn: factColumn.name,
      toTable: options.dateTable,
      toColumn: options.dateColumn,
      isActive: true,
      crossFilteringBehavior: 'single',
    },
    model,
  );

  return {
    status: 'missing',
    fromTable: factTable.name,
    fromColumn: factColumn.name,
    toTable: options.dateTable,
    toColumn: options.dateColumn,
    canCreate: check.valid,
    blocking: check.blocking,
  };
}

function relationshipTouchesFactDate(
  relationship: TMDLRelationship,
  tableName: string,
  columnName: string,
): boolean {
  return (
    (relationship.fromTable === tableName && relationship.fromColumn === columnName) ||
    (relationship.toTable === tableName && relationship.toColumn === columnName)
  );
}

function relationshipMatchesRequestedDateDimension(
  relationship: TMDLRelationship,
  factTable: string,
  factColumn: string,
  options: DateGrainPlanOptions,
): boolean {
  if (!options.dateTable && !options.dateColumn) return true;
  const dateEndpoint = dateEndpointForFactRelationship(relationship, factTable, factColumn);
  if (!dateEndpoint) return false;
  return (
    (!options.dateTable || dateEndpoint.table === options.dateTable) &&
    (!options.dateColumn || dateEndpoint.column === options.dateColumn)
  );
}

function dateEndpointForFactRelationship(
  relationship: TMDLRelationship,
  factTable: string,
  factColumn: string,
): { readonly table: string; readonly column: string } | undefined {
  if (relationship.fromTable === factTable && relationship.fromColumn === factColumn) {
    return { table: relationship.toTable, column: relationship.toColumn };
  }
  if (relationship.toTable === factTable && relationship.toColumn === factColumn) {
    return { table: relationship.fromTable, column: relationship.fromColumn };
  }
  return undefined;
}

function toExistingRelationshipPlan(
  relationship: TMDLRelationship,
  model: TMDLModel,
): ExistingDateRelationshipPlan {
  const activationCheck = relationship.isActive
    ? { valid: true, blocking: [] }
    : relationshipCheck(
        {
          fromTable: relationship.fromTable,
          fromColumn: relationship.fromColumn,
          toTable: relationship.toTable,
          toColumn: relationship.toColumn,
          isActive: true,
          crossFilteringBehavior: relationship.crossFilteringBehavior,
        },
        model,
        { ignoreRelationshipId: relationship.id },
      );
  const shapeBlocking = relationshipActivationShapeBlocking(relationship);
  const activationBlocking = [...activationCheck.blocking, ...shapeBlocking];
  return {
    status: relationship.isActive ? 'active' : 'inactive',
    id: relationship.id,
    fromTable: relationship.fromTable,
    fromColumn: relationship.fromColumn,
    toTable: relationship.toTable,
    toColumn: relationship.toColumn,
    cardinality: relationship.cardinality,
    crossFilteringBehavior: relationship.crossFilteringBehavior,
    canActivate: relationship.isActive || (activationCheck.valid && shapeBlocking.length === 0),
    activationBlocking,
  };
}

function relationshipActivationShapeBlocking(
  relationship: TMDLRelationship,
): ReadonlyArray<{ readonly code: string; readonly message: string }> {
  const blocking: { readonly code: string; readonly message: string }[] = [];
  if (relationship.identityProven !== true) {
    blocking.push({
      code: 'relationship-id-missing',
      message: `Existing relationship "${relationship.id}" does not have a proven model identity, so it cannot be activated automatically.`,
    });
  }
  if (relationship.cardinality && relationship.cardinality !== 'manyToOne') {
    blocking.push({
      code: 'unsupported-cardinality',
      message: `Existing relationship "${relationship.id}" has cardinality ${relationship.cardinality}; automatic date activation only supports manyToOne.`,
    });
  }
  if (relationship.crossFilteringBehavior !== 'single') {
    blocking.push({
      code: 'unsupported-cross-filter',
      message: `Existing relationship "${relationship.id}" uses ${relationship.crossFilteringBehavior} cross-filtering; automatic date activation only supports single direction.`,
    });
  }
  return blocking;
}

function activeStatus(plan: ExistingDateRelationshipPlan): ExistingDateRelationshipPlan {
  return plan;
}

function otherRelationshipTable(plan: ExistingDateRelationshipPlan, tableName: string): string {
  return plan.fromTable === tableName ? plan.toTable : plan.fromTable;
}

function buildWritePlan(
  model: TMDLModel,
  observedGrain: ObservedDateGrain,
  dayRelationshipSafe: boolean,
  relationship: DateRelationshipPlan,
  dateCoverageValid: boolean,
): ReadonlyArray<DateGrainWritePlanItem> {
  if (observedGrain !== 'day' || !dayRelationshipSafe) {
    return [];
  }

  if (!dateCoverageValid) {
    return [];
  }

  if (!relationshipTargetsGovernedDateEndpoint(model, relationship)) {
    return [];
  }

  if (relationship.status === 'inactive' && relationship.canActivate) {
    return [
      {
        action: 'activate-date-relationship',
        id: relationship.id,
        description:
          'Observed day-level date values support activating the existing date relationship.',
      },
    ];
  }

  if (relationship.status === 'inactive' && !relationship.canActivate) {
    return [];
  }

  if (
    relationship.status === 'missing' &&
    relationship.canCreate &&
    relationship.toTable &&
    relationship.toColumn
  ) {
    return [
      {
        action: 'create-date-relationship',
        fromTable: relationship.fromTable,
        fromColumn: relationship.fromColumn,
        toTable: relationship.toTable,
        toColumn: relationship.toColumn,
        cardinality: 'manyToOne',
        crossFilteringBehavior: 'single',
        isActive: true,
        description:
          'Observed day-level date values support creating an active many-to-one date relationship.',
      },
    ];
  }

  return [];
}

function buildMeasureGuidance(
  observedGrain: ObservedDateGrain,
  exactDayProof: boolean,
  candidates: ReadonlyArray<DateTruncatingMeasureCandidate>,
  dayRelationshipSafe = false,
): FactDateGrainPlan['measureGuidance'] {
  if (observedGrain === 'day' && dayRelationshipSafe) {
    return {
      plainSumSafe: true,
      removeDateTruncatingTreatas: candidates.length > 0,
      safeVisualDateGrain: 'day-or-above',
      dateTruncatingMeasureCandidates: candidates,
      message: exactDayProof
        ? 'Observed fact dates include complete date-only daily evidence strong enough for daily-grain relationship writes. After shared dimensions/date relationships are valid, a plain additive measure can preserve date-level grain; remove date-truncating TREATAS patterns.'
        : 'Observed fact dates are day-level but sparse. Day-or-above visual axes, Date relationships, and plain additive measures are safe for the proven nonblank date rows after shared dimensions/date relationships are valid.',
    };
  }

  if (observedGrain === 'day') {
    return {
      plainSumSafe: false,
      removeDateTruncatingTreatas: false,
      safeVisualDateGrain: 'unknown',
      dateTruncatingMeasureCandidates: candidates,
      message:
        'Observed fact dates look date-level but do not provide complete date-only proof. Do not rewrite target/actual measures, activate date relationships, or use day-level visuals automatically until grain is proven by data.',
    };
  }

  if (observedGrain === 'month-start' || observedGrain === 'month-single-date') {
    return {
      plainSumSafe: false,
      removeDateTruncatingTreatas: false,
      safeVisualDateGrain: 'month-or-above',
      dateTruncatingMeasureCandidates: candidates,
      message:
        'Observed fact dates have one distinct date value per month. Do not repeat the monthly value across every day; use a month-grain axis/key or explicit daily allocation logic.',
    };
  }

  if (observedGrain === 'submonthly') {
    return {
      plainSumSafe: false,
      removeDateTruncatingTreatas: false,
      safeVisualDateGrain: 'unknown',
      dateTruncatingMeasureCandidates: candidates,
      message:
        'Observed fact dates have more than one date in at least one month, but not enough repeated evidence to prove daily grain. Treat this as a grain-review case before rewriting target/actual measures.',
    };
  }

  return {
    plainSumSafe: false,
    removeDateTruncatingTreatas: false,
    safeVisualDateGrain: 'unknown',
    dateTruncatingMeasureCandidates: candidates,
    message:
      'Date grain is not proven. Run the live date-grain probe before changing date relationships or grain-sensitive target measures.',
  };
}

function relationshipTargetsGovernedDateEndpoint(
  model: TMDLModel,
  relationship: DateRelationshipPlan,
): boolean {
  if (relationship.status !== 'inactive' && relationship.status !== 'missing') return true;
  if (!relationship.toTable || !relationship.toColumn) return false;
  const table = model.tables.find((candidate) => candidate.name === relationship.toTable);
  const column = table?.columns.find((candidate) => candidate.name === relationship.toColumn);
  return (
    table !== undefined &&
    column !== undefined &&
    !table.isAutoDateTable &&
    isMarkedDateTable(table, column)
  );
}

function findDateTruncatingMeasureCandidates(
  model: TMDLModel,
  factTable: string,
  dateColumn: string,
): ReadonlyArray<DateTruncatingMeasureCandidate> {
  const candidates: DateTruncatingMeasureCandidate[] = [];
  for (const table of model.tables) {
    for (const measure of table.measures) {
      if (isDateTruncatingMeasure(measure, factTable, dateColumn)) {
        candidates.push({
          table: measure.table,
          name: measure.name,
          reason: 'treatas-date-truncation-pattern',
        });
      }
    }
  }
  return candidates;
}

function isDateTruncatingMeasure(
  measure: TMDLMeasure,
  factTable: string,
  dateColumn: string,
): boolean {
  const compact = measure.expression.replace(/\s+/g, '').toUpperCase();
  if (!compact.includes('TREATAS(')) return false;
  const hasDateTruncation =
    compact.includes('DATE(YEAR(') ||
    compact.includes('EOMONTH(') ||
    compact.includes('STARTOFMONTH(');
  if (!hasDateTruncation) return false;
  const expressionUpper = measure.expression.toUpperCase();
  return exactColumnRefs(factTable, dateColumn).some((ref) =>
    expressionUpper.includes(ref.toUpperCase()),
  );
}

function exactColumnRefs(tableName: string, columnName: string): ReadonlyArray<string> {
  const refs = [columnRef(tableName, columnName)];
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    refs.push(`${tableName}[${columnName.replace(/]/g, ']]')}]`);
  }
  return refs;
}

function autoDateTableSummary(model: TMDLModel): DateGrainPlanResult['autoDateTables'] {
  const names = model.tables.filter((table) => table.isAutoDateTable).map((table) => table.name);
  return {
    count: names.length,
    names,
    ...(names.length > 0
      ? {
          recommendation:
            'Disable Auto Date/Time and use the governed date table; auto date tables add repeated calendar structures and slow model inspection.',
        }
      : {}),
  };
}

function buildProbeRow(
  tableName: string,
  dateColumn: string,
  kind: 'fact' | 'date-table' = 'fact',
): string {
  const table = quoteTableName(tableName);
  const ref = columnRef(tableName, dateColumn);
  const nonBlankFilter = `FILTER(${table}, NOT ISBLANK(${ref}))`;
  const distinctDates = `DISTINCT(SELECTCOLUMNS(${nonBlankFilter}, "__date", DATE(YEAR(${ref}), MONTH(${ref}), DAY(${ref})), "__monthStart", DATE(YEAR(${ref}), MONTH(${ref}), 1)))`;
  const datesByMonth = `GROUPBY(${distinctDates}, [__monthStart], "__dateCount", COUNTX(CURRENTGROUP(), [__date]))`;
  return [
    'ROW(',
    `  "__kind", "${kind}",`,
    `  "__table", "${escapeDaxString(tableName)}",`,
    `  "__column", "${escapeDaxString(dateColumn)}",`,
    `  "rowCount", COUNTROWS(${table}),`,
    `  "nonBlankDateCount", COUNTROWS(${nonBlankFilter}),`,
    `  "distinctDateCount", COUNTROWS(DISTINCT(SELECTCOLUMNS(${nonBlankFilter}, "__date", DATE(YEAR(${ref}), MONTH(${ref}), DAY(${ref}))))),`,
    `  "distinctMonthStartCount", COUNTROWS(DISTINCT(SELECTCOLUMNS(${nonBlankFilter}, "__monthStart", DATE(YEAR(${ref}), MONTH(${ref}), 1)))),`,
    `  "nonMonthStartDateCount", COUNTROWS(FILTER(${table}, NOT ISBLANK(${ref}) && DAY(${ref}) <> 1)),`,
    `  "monthsWithMultipleDates", COUNTROWS(FILTER(${datesByMonth}, [__dateCount] > 1)),`,
    `  "maxDistinctDatesPerMonth", MAXX(${datesByMonth}, [__dateCount]),`,
    `  "blankDateCount", COUNTROWS(FILTER(${table}, ISBLANK(${ref}))),`,
    `  "duplicateDateCount", COUNTROWS(${nonBlankFilter}) - COUNTROWS(DISTINCT(SELECTCOLUMNS(${nonBlankFilter}, "__date", DATE(YEAR(${ref}), MONTH(${ref}), DAY(${ref}))))),`,
    `  "nonMidnightTimeCount", COUNTROWS(FILTER(${nonBlankFilter}, ${ref} <> DATE(YEAR(${ref}), MONTH(${ref}), DAY(${ref})))),`,
    `  "gapCount", VAR __minDate = MINX(${nonBlankFilter}, ${ref}) VAR __maxDate = MAXX(${nonBlankFilter}, ${ref}) RETURN IF(ISBLANK(__minDate) || ISBLANK(__maxDate), BLANK(), DATEDIFF(__minDate, __maxDate, DAY) + 1 - COUNTROWS(DISTINCT(SELECTCOLUMNS(${nonBlankFilter}, "__date", DATE(YEAR(${ref}), MONTH(${ref}), DAY(${ref})))))),`,
    `  "minDate", MINX(${nonBlankFilter}, ${ref}),`,
    `  "maxDate", MAXX(${nonBlankFilter}, ${ref})`,
    ')',
  ].join('\n');
}

function toDateTableEvidence(row: Record<string, unknown>): DateTableKeyProbeEvidence {
  const tableName = stringValue(row, '__table', 'tableName', 'table') ?? '';
  const dateColumn = stringValue(row, '__column', 'dateColumn', 'column') ?? '';
  const rowCount = numberValue(row, 'rowCount');
  const nonBlankDateCount = numberValue(row, 'nonBlankDateCount');
  const distinctDateCount = numberValue(row, 'distinctDateCount');
  const blankDateCount = numberValue(row, 'blankDateCount');
  const duplicateDateCount = numberValue(row, 'duplicateDateCount');
  const gapCount = numberValue(row, 'gapCount');
  const nonMidnightTimeCount = numberValue(row, 'nonMidnightTimeCount');
  const minDate = stringValue(row, 'minDate');
  const maxDate = stringValue(row, 'maxDate');
  return {
    tableName,
    dateColumn,
    ...(rowCount !== undefined ? { rowCount } : {}),
    ...(nonBlankDateCount !== undefined ? { nonBlankDateCount } : {}),
    ...(distinctDateCount !== undefined ? { distinctDateCount } : {}),
    ...(blankDateCount !== undefined ? { blankDateCount } : {}),
    ...(duplicateDateCount !== undefined ? { duplicateDateCount } : {}),
    ...(gapCount !== undefined ? { gapCount } : {}),
    ...(nonMidnightTimeCount !== undefined ? { nonMidnightTimeCount } : {}),
    ...(minDate !== undefined ? { minDate } : {}),
    ...(maxDate !== undefined ? { maxDate } : {}),
  };
}

function buildFactCoverage(
  model: TMDLModel,
  fact: DateGrainFactInput,
  factsEvidence: ReadonlyArray<DateGrainProbeEvidence>,
  dateTableEvidence: DateTableKeyProbeEvidence | undefined,
): DateTableFactCoverage {
  const evidence = factsEvidence.find(
    (candidate) =>
      candidate.tableName === fact.tableName && candidate.dateColumn === fact.dateColumn,
  );
  const blocking: DateTableCoverageBlocker[] = [];
  const completeDateProof = hasCompleteDateTableKeyProof(dateTableEvidence);
  const completeFactProof = hasCompleteDateGrainProof(evidence);
  const dateMin = dateOnlyOrdinal(dateTableEvidence?.minDate);
  const dateMax = dateOnlyOrdinal(dateTableEvidence?.maxDate);
  const factMin = dateOnlyOrdinal(evidence?.minDate);
  const factMax = dateOnlyOrdinal(evidence?.maxDate);
  const factTable = model.tables.find((candidate) => candidate.name === fact.tableName);
  const factColumn = factTable?.columns.find((candidate) => candidate.name === fact.dateColumn);

  if (!factTable) {
    blocking.push({
      code: 'fact-table-not-found',
      factTable: fact.tableName,
      factColumn: fact.dateColumn,
      message: `Fact table "${fact.tableName}" was requested for Date-table coverage but does not exist.`,
      ...(dateTableEvidence?.tableName ? { table: dateTableEvidence.tableName } : {}),
      ...(dateTableEvidence?.dateColumn ? { column: dateTableEvidence.dateColumn } : {}),
    });
  } else if (!factColumn) {
    blocking.push({
      code: 'fact-date-column-not-found',
      factTable: fact.tableName,
      factColumn: fact.dateColumn,
      message: `Fact date column "${fact.dateColumn}" was requested for Date-table coverage but does not exist on "${fact.tableName}".`,
      ...(dateTableEvidence?.tableName ? { table: dateTableEvidence.tableName } : {}),
      ...(dateTableEvidence?.dateColumn ? { column: dateTableEvidence.dateColumn } : {}),
    });
  } else if (!isTemporalColumn(factColumn)) {
    blocking.push({
      code: 'fact-date-column-not-temporal',
      factTable: fact.tableName,
      factColumn: fact.dateColumn,
      message: `Fact date column "${fact.tableName}"[${fact.dateColumn}] is ${factColumn.dataType}, so Date-table coverage cannot be proven.`,
      ...(dateTableEvidence?.tableName ? { table: dateTableEvidence.tableName } : {}),
      ...(dateTableEvidence?.dateColumn ? { column: dateTableEvidence.dateColumn } : {}),
    });
  }

  if (!completeFactProof || factMin === undefined || factMax === undefined) {
    blocking.push({
      code: 'fact-date-proof-missing',
      factTable: fact.tableName,
      factColumn: fact.dateColumn,
      message: `Fact date coverage is not proven for "${fact.tableName}"[${fact.dateColumn}].`,
      ...(dateTableEvidence?.tableName ? { table: dateTableEvidence.tableName } : {}),
      ...(dateTableEvidence?.dateColumn ? { column: dateTableEvidence.dateColumn } : {}),
    });
  }

  if ((evidence?.nonMidnightTimeCount ?? 0) > 0) {
    blocking.push({
      code: 'fact-date-has-time-component',
      factTable: fact.tableName,
      factColumn: fact.dateColumn,
      message: `Fact date column "${fact.tableName}"[${fact.dateColumn}] contains DateTime values with a non-midnight time component, so exact Date relationship coverage is not proven.`,
      ...(dateTableEvidence?.tableName ? { table: dateTableEvidence.tableName } : {}),
      ...(dateTableEvidence?.dateColumn ? { column: dateTableEvidence.dateColumn } : {}),
    });
  }

  if (completeDateProof && factMin !== undefined && dateMin !== undefined && dateMin > factMin) {
    blocking.push({
      code: 'date-table-start-after-fact-min',
      factTable: fact.tableName,
      factColumn: fact.dateColumn,
      message: `The date table starts after the observed minimum date for "${fact.tableName}"[${fact.dateColumn}].`,
      ...(dateTableEvidence?.tableName ? { table: dateTableEvidence.tableName } : {}),
      ...(dateTableEvidence?.dateColumn ? { column: dateTableEvidence.dateColumn } : {}),
    });
  }
  if (completeDateProof && factMax !== undefined && dateMax !== undefined && dateMax < factMax) {
    blocking.push({
      code: 'date-table-end-before-fact-max',
      factTable: fact.tableName,
      factColumn: fact.dateColumn,
      message: `The date table ends before the observed maximum date for "${fact.tableName}"[${fact.dateColumn}].`,
      ...(dateTableEvidence?.tableName ? { table: dateTableEvidence.tableName } : {}),
      ...(dateTableEvidence?.dateColumn ? { column: dateTableEvidence.dateColumn } : {}),
    });
  }
  return {
    tableName: fact.tableName,
    dateColumn: fact.dateColumn,
    ...(evidence?.minDate ? { factMinDate: evidence.minDate } : {}),
    ...(evidence?.maxDate ? { factMaxDate: evidence.maxDate } : {}),
    covered:
      blocking.length === 0 &&
      completeDateProof &&
      completeFactProof &&
      dateMin !== undefined &&
      dateMax !== undefined &&
      factMin !== undefined &&
      factMax !== undefined,
    blocking,
  };
}

function buildRecommendedDateRange(
  facts: ReadonlyArray<DateGrainFactInput>,
  factsEvidence: ReadonlyArray<DateGrainProbeEvidence>,
): DateTableCoveragePlanResult['recommendedRange'] {
  const evidenceByKey = new Map(
    factsEvidence.map((evidence) => [probeKey(evidence.tableName, evidence.dateColumn), evidence]),
  );
  const requestedEvidence = facts.map((fact) =>
    evidenceByKey.get(probeKey(fact.tableName, fact.dateColumn)),
  );
  if (
    requestedEvidence.length === 0 ||
    requestedEvidence.some(
      (evidence) =>
        !hasCompleteDateGrainProof(evidence) ||
        dateOnlyOrdinal(evidence.minDate) === undefined ||
        dateOnlyOrdinal(evidence.maxDate) === undefined,
    )
  ) {
    return {
      requiresExplicitForecastHorizon: true,
      message:
        'Observed fact min/max dates are not fully proven. Do not invent calendar bounds or use TODAY()/NOW(); run the live proof with every relevant fact date column.',
    };
  }

  const factMins = requestedEvidence.map((fact) => dateOnlyOrdinal(fact?.minDate) ?? 0);
  const factMaxes = requestedEvidence.map((fact) => dateOnlyOrdinal(fact?.maxDate) ?? 0);
  const calendarStartDate = toIsoDate(Math.min(...factMins));
  const calendarEndDate = toIsoDate(Math.max(...factMaxes));
  return {
    observedFactMinDate: calendarStartDate,
    observedFactMaxDate: calendarEndDate,
    calendarStartDate,
    calendarEndDate,
    requiresExplicitForecastHorizon: true,
    message:
      'Default calendar bounds should be anchored to observed fact min/max dates. Extend beyond the observed max only when the user supplies an explicit forecast horizon policy.',
  };
}

function toIsoDate(dayOrdinal: number): string {
  return new Date(dayOrdinal * 86_400_000).toISOString().slice(0, 10);
}

function dateOnlyOrdinal(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dateOnly?.[1] && dateOnly[2] && dateOnly[3]) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) / 86400000;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  const d = new Date(parsed);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000;
}

function isMarkedDateTable(table: TMDLTable, column: TMDLColumn): boolean {
  const tableMarked = (table.dataCategory ?? '').toLowerCase() === 'time';
  const columnMarked = (column.dataCategory ?? '').toLowerCase() === 'time';
  return tableMarked || columnMarked;
}

export function findCalendarSourceRisks(
  sources: ReadonlyArray<{ readonly expression?: string; readonly kind?: string | undefined }>,
): ReadonlyArray<CalendarSourceRisk> {
  const risks: CalendarSourceRisk[] = [];
  for (const source of sources) {
    const expression = source.expression;
    if (!expression) continue;
    const hasVolatileAnchor =
      /\b(?:TODAY|NOW|UTCNOW)\s*\(/i.test(expression) ||
      /\bDateTime(?:Zone)?\.(?:LocalNow|UtcNow|FixedLocalNow|FixedUtcNow)\s*\(/i.test(expression) ||
      /\bDate\.(?:From|StartOfDay)\s*\(\s*DateTime(?:Zone)?\.(?:LocalNow|UtcNow|FixedLocalNow|FixedUtcNow)\s*\(/i.test(
        expression,
      );
    if (hasVolatileAnchor) {
      risks.push({
        code: 'volatile-calendar-anchor',
        ...(source.kind !== undefined ? { sourceKind: source.kind } : {}),
        message:
          'The date table definition uses a volatile current-date function as a calendar bound. Use observed fact min/max dates and an explicit forecast horizon policy instead of the system date.',
      });
    }

    const calendarLike =
      /\b(?:CALENDAR|CALENDARAUTO)\s*\(/i.test(expression) ||
      /\bGENERATESERIES\s*\(\s*DATE\s*\(/i.test(expression) ||
      /\bList\.Dates\s*\(/i.test(expression) ||
      /\bList\.Generate\s*\(/i.test(expression) ||
      /\bDate\.Add(?:Days|Months|Years)\s*\(/i.test(expression);
    const hasLiteralBounds =
      /\bDATE\s*\(\s*\d{4}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*\)/i.test(expression) ||
      /\bDATEVALUE\s*\(\s*["']\d{4}[-/]\d{1,2}[-/]\d{1,2}["']\s*\)/i.test(expression) ||
      /["']\d{4}[-/]\d{1,2}[-/]\d{1,2}["']/i.test(expression) ||
      /#date(?:time(?:zone)?)?\s*\(\s*\d{4}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,/i.test(expression) ||
      /#date\s*\(\s*\d{4}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*\)/i.test(expression);
    if (hasLiteralBounds && (calendarLike || source.kind !== undefined)) {
      risks.push({
        code: 'literal-calendar-range',
        ...(source.kind !== undefined ? { sourceKind: source.kind } : {}),
        message:
          'The date table definition uses literal calendar bounds. Prove observed fact min/max dates with pbi_model_plan_date_table and only extend with an explicit futureHorizonDays policy.',
      });
    }
  }
  return risks;
}

function findDateTableSourceRisks(table: TMDLTable | undefined): ReadonlyArray<CalendarSourceRisk> {
  if (!table) return [];
  const sources = [
    ...(table.expression !== undefined
      ? [{ kind: 'calculated', expression: table.expression }]
      : []),
    ...(table.partitionSources ?? []),
  ];
  return findCalendarSourceRisks(sources);
}

function looksLikeDateCoverageFactTable(
  model: TMDLModel,
  table: TMDLTable,
  dateTableName: string,
): boolean {
  if (table.name === dateTableName || table.isAutoDateTable || isDateTableLike(table)) {
    return false;
  }
  const hasTemporalColumn = table.columns.some((column) => isTemporalColumn(column));
  if (!hasTemporalColumn) return false;
  const classification = classifyTable(model, table.name);
  if (classification.kind === 'fact' && classification.confidence >= 0.6) return true;
  return table.measures.length > 0 || table.columns.some(isAggregatableNumericColumn);
}

function isDateTableLike(table: TMDLTable): boolean {
  return (table.dataCategory ?? '').toLowerCase() === 'time';
}

function isAggregatableNumericColumn(column: TMDLColumn): boolean {
  return (
    column.summarizeBy !== undefined &&
    column.summarizeBy.toLowerCase() !== 'none' &&
    isNumericType(column.dataType)
  );
}

type CompleteDateTableKeyProof = DateTableKeyProbeEvidence &
  Required<
    Pick<
      DateTableKeyProbeEvidence,
      | 'rowCount'
      | 'nonBlankDateCount'
      | 'distinctDateCount'
      | 'blankDateCount'
      | 'duplicateDateCount'
      | 'gapCount'
      | 'nonMidnightTimeCount'
      | 'minDate'
      | 'maxDate'
    >
  >;

type CompleteDateGrainProof = DateGrainProbeEvidence &
  Required<
    Pick<
      DateGrainProbeEvidence,
      | 'rowCount'
      | 'nonBlankDateCount'
      | 'distinctDateCount'
      | 'distinctMonthStartCount'
      | 'nonMonthStartDateCount'
      | 'monthsWithMultipleDates'
      | 'maxDistinctDatesPerMonth'
      | 'blankDateCount'
      | 'duplicateDateCount'
      | 'gapCount'
      | 'nonMidnightTimeCount'
      | 'minDate'
      | 'maxDate'
    >
  >;

function hasCompleteDateTableKeyProof(
  evidence: DateTableKeyProbeEvidence | undefined,
): evidence is CompleteDateTableKeyProof {
  return (
    evidence !== undefined &&
    evidence.rowCount !== undefined &&
    evidence.nonBlankDateCount !== undefined &&
    evidence.distinctDateCount !== undefined &&
    evidence.blankDateCount !== undefined &&
    evidence.duplicateDateCount !== undefined &&
    evidence.gapCount !== undefined &&
    evidence.nonMidnightTimeCount !== undefined &&
    dateOnlyOrdinal(evidence.minDate) !== undefined &&
    dateOnlyOrdinal(evidence.maxDate) !== undefined &&
    evidence.nonBlankDateCount > 0 &&
    evidence.distinctDateCount > 0
  );
}

function hasCompleteDateGrainProof(
  evidence: DateGrainProbeEvidence | undefined,
): evidence is CompleteDateGrainProof {
  return (
    evidence !== undefined &&
    evidence.rowCount !== undefined &&
    evidence.nonBlankDateCount !== undefined &&
    evidence.distinctDateCount !== undefined &&
    evidence.distinctMonthStartCount !== undefined &&
    evidence.nonMonthStartDateCount !== undefined &&
    evidence.monthsWithMultipleDates !== undefined &&
    evidence.maxDistinctDatesPerMonth !== undefined &&
    evidence.blankDateCount !== undefined &&
    evidence.duplicateDateCount !== undefined &&
    evidence.gapCount !== undefined &&
    evidence.nonMidnightTimeCount !== undefined &&
    (evidence.nonBlankDateCount === 0 ||
      (dateOnlyOrdinal(evidence.minDate) !== undefined &&
        dateOnlyOrdinal(evidence.maxDate) !== undefined))
  );
}

function indent(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function quoteTableName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function columnRef(tableName: string, columnName: string): string {
  return `${quoteTableName(tableName)}[${columnName.replace(/]/g, ']]')}]`;
}

function escapeDaxString(value: string): string {
  return value.replace(/"/g, '""');
}

function probeKey(tableName: string, dateColumn: string): string {
  return `${tableName}\x1f${dateColumn}`;
}

function extractRows(payload: unknown, depth = 0): ReadonlyArray<Record<string, unknown>> {
  if (depth > 8) return [];
  if (Array.isArray(payload)) {
    const rows = payload.filter(isRecord);
    if (rows.some(hasProbeMetric)) return rows;
    for (const item of payload) {
      const nested = extractRows(item, depth + 1);
      if (nested.length > 0) return nested;
    }
    return [];
  }

  if (!isRecord(payload)) return [];

  // The local Microsoft modeling MCP returns DAX results in a columnar shape:
  // { columns: [{ name }], rows: [[v0, v1, ...]] } — positional array-of-arrays,
  // optionally wrapped in a `data` envelope — NOT the array-of-objects of the
  // public Execute-Queries REST API. Zip those into keyed objects so the rest of
  // the parser, which expects rows keyed by column name, works for either host.
  const zipped = zipColumnarRows(payload);
  if (zipped.length > 0) return zipped;

  for (const key of ['rows', 'data', 'value', 'values', 'results', 'tables']) {
    const nested = extractRows(payload[key], depth + 1);
    if (nested.length > 0) return nested;
  }

  for (const value of Object.values(payload)) {
    const nested = extractRows(value, depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

// Zip a co-located { columns, rows: [[...]] } columnar payload into array-of-
// objects keyed by column name. Returns [] unless rows are positional arrays
// (array-of-objects is already handled by the normal key walk above).
function zipColumnarRows(record: Record<string, unknown>): ReadonlyArray<Record<string, unknown>> {
  const columns = record.columns;
  const rows = record.rows;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return [];
  if (!rows.some((row) => Array.isArray(row))) return [];
  const names = columns.map(columnNameOf);
  if (names.every((name) => name === '')) return [];
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const keyed: Record<string, unknown> = {};
    for (let i = 0; i < names.length; i += 1) {
      keyed[names[i] || `__col${i}`] = row[i];
    }
    out.push(keyed);
  }
  return out;
}

function columnNameOf(column: unknown): string {
  if (typeof column === 'string') return column;
  if (isRecord(column)) {
    const name = column.name ?? column.columnName ?? column.Name;
    if (typeof name === 'string') return name;
  }
  return '';
}

function hasProbeMetric(row: Record<string, unknown>): boolean {
  return findValue(row, 'rowCount') !== undefined || findValue(row, '__table') !== undefined;
}

function numberValue(row: Record<string, unknown>, ...aliases: string[]): number | undefined {
  const value = findValue(row, ...aliases);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringValue(row: Record<string, unknown>, ...aliases: string[]): string | undefined {
  const value = findValue(row, ...aliases);
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function findValue(row: Record<string, unknown>, ...aliases: string[]): unknown {
  const normalizedAliases = new Set(aliases.map(normalizeResultKey));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.has(normalizeResultKey(key))) return value;
  }
  return undefined;
}

function normalizeResultKey(key: string): string {
  const afterBracket = key.includes('[') ? key.slice(key.lastIndexOf('[') + 1) : key;
  return afterBracket.replace(/[\]_\s]/g, '').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
