import type { TMDLModel, TMDLTable } from './types.js';
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
export type ObservedDateGrain = 'day' | 'submonthly' | 'month-start' | 'month-single-date' | 'empty' | 'unknown';
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
/**
 * Annotation keys the governed Date-table creator stamps on the table so its calendar
 * range / future-horizon policy is durable and later gates do not re-block or require the
 * caller to re-supply the horizon (P5 / circular mark-vs-proof). Tool-internal keys only —
 * never any dataset field name.
 */
export declare const GOVERNED_DATE_TABLE_ANNOTATIONS: {
    readonly governedByTool: "pbiAgentKit_governedByTool";
    readonly rangePolicy: "pbiAgentKit_dateRangePolicy";
    readonly futureHorizonDays: "pbiAgentKit_futureHorizonDays";
};
export declare const MAX_FUTURE_HORIZON_DAYS = 3660;
export interface GovernedDatePolicy {
    readonly governedByTool: boolean;
    readonly rangePolicy?: string;
    readonly futureHorizonDays?: number;
    readonly allowCalendarEndAfterFactMax?: boolean;
}
/**
 * Reads the persisted governed Date-table policy from a table's annotations. Only honored
 * when our own creator stamped governedByTool='true'; the volatile/literal anchor detectors
 * still run independently, so a TODAY()/NOW() calendar can never be trusted via a stamped
 * flag. Dataset-agnostic (keys/values are tool-internal policy, not model fields).
 */
export declare function readGovernedDatePolicy(table: TMDLTable | undefined): GovernedDatePolicy;
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
        readonly keyProvenFromData: boolean;
        readonly hasVolatileAnchor: boolean;
        readonly evidence?: DateTableKeyProbeEvidence;
    };
    readonly factCoverage: ReadonlyArray<DateTableFactCoverage>;
    readonly blockers: ReadonlyArray<DateTableCoverageBlocker>;
    readonly warnings: ReadonlyArray<DateTableCoverageWarning>;
    readonly markReadiness: {
        readonly ready: boolean;
        readonly dataProvenKey: boolean;
        readonly coversAllFacts: boolean;
        readonly blockingForMark: ReadonlyArray<DateTableCoverageBlocker>;
    };
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
    readonly code: 'date-table-not-found' | 'date-column-not-found' | 'date-table-is-auto' | 'date-table-not-marked' | 'date-column-not-temporal-key' | 'date-table-proof-mismatch' | 'date-table-proof-missing' | 'date-table-has-blanks' | 'date-table-has-duplicates' | 'date-table-has-gaps' | 'date-table-has-time-component' | 'date-column-not-key' | 'fact-date-proof-missing' | 'fact-date-has-time-component' | 'date-table-start-after-fact-min' | 'date-table-end-before-fact-max' | 'date-table-end-after-fact-max-without-policy' | 'volatile-calendar-anchor' | 'literal-calendar-range' | 'fact-table-not-found' | 'fact-date-column-not-found' | 'fact-date-column-not-temporal';
    readonly message: string;
    readonly table?: string;
    readonly column?: string;
    readonly factTable?: string;
    readonly factColumn?: string;
};
/**
 * Non-blocking caveats that the consuming gates must RELAY to the agent but that must
 * NOT refuse the operation. Used for signals that are structurally unobservable through
 * the Microsoft Modeling MCP read layer (e.g. a live Import Date table whose calendar
 * source expression / partition cannot be read back) — absence of the signal is not
 * proof of a defect, so it degrades to a warning rather than a fail-closed blocker. A
 * positively-observed risk (a TODAY()/NOW() volatile anchor or a hardcoded literal range)
 * is a different thing and still blocks via DateTableCoverageBlocker.
 */
export type DateTableCoverageWarning = {
    readonly code: 'calendar-source-unproven' | 'date-table-mark-unobservable';
    readonly message: string;
    readonly table?: string;
    readonly column?: string;
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
export type DateRelationshipPlan = ExistingDateRelationshipPlan | MissingDateRelationshipPlan | AmbiguousDateRelationshipPlan | UnknownDateRelationshipPlan;
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
    readonly activationBlocking: ReadonlyArray<{
        readonly code: string;
        readonly message: string;
    }>;
}
export interface MissingDateRelationshipPlan {
    readonly status: 'missing';
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly toTable?: string;
    readonly toColumn?: string;
    readonly canCreate: boolean;
    readonly blocking: ReadonlyArray<{
        readonly code: string;
        readonly message: string;
    }>;
}
export interface AmbiguousDateRelationshipPlan {
    readonly status: 'ambiguous';
    readonly candidates: ReadonlyArray<ExistingDateRelationshipPlan>;
}
export interface UnknownDateRelationshipPlan {
    readonly status: 'unknown';
    readonly reason: string;
}
export type DateGrainWritePlanItem = ActivateDateRelationshipPlanItem | CreateDateRelationshipPlanItem;
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
export type DateGrainBlocker = DateGrainTableMissingBlocker | DateGrainColumnMissingBlocker | DateGrainUnsupportedColumnBlocker;
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
export declare function planDateGrain(model: TMDLModel, options: DateGrainPlanOptions, evidence?: ReadonlyArray<DateGrainProbeEvidence>): DateGrainPlanResult;
export declare function buildDateGrainProbeQuery(model: TMDLModel, facts: ReadonlyArray<DateGrainFactInput>): string | undefined;
export declare function parseDateGrainProbeResult(payload: unknown): ReadonlyArray<DateGrainProbeEvidence>;
export declare function buildDateTableCoverageProbeQuery(model: TMDLModel, options: DateTableCoveragePlanOptions): string | undefined;
export declare function parseDateTableCoverageProbeResult(payload: unknown): DateTableCoverageProbeEvidence;
export declare function planDateTableCoverage(model: TMDLModel, options: DateTableCoveragePlanOptions, evidence?: DateTableCoverageProbeEvidence): DateTableCoveragePlanResult;
export declare function deriveRequiredDateCoverageFacts(model: TMDLModel, options: DateTableCoveragePlanOptions): ReadonlyArray<DateGrainFactInput>;
export declare function classifyObservedDateGrain(evidence: DateGrainProbeEvidence | undefined): ObservedDateGrain;
export declare function findCalendarSourceRisks(sources: ReadonlyArray<{
    readonly expression?: string;
    readonly kind?: string | undefined;
}>): ReadonlyArray<CalendarSourceRisk>;
type CompleteDateTableKeyProof = DateTableKeyProbeEvidence & Required<Pick<DateTableKeyProbeEvidence, 'rowCount' | 'nonBlankDateCount' | 'distinctDateCount' | 'blankDateCount' | 'duplicateDateCount' | 'gapCount' | 'nonMidnightTimeCount' | 'minDate' | 'maxDate'>>;
type CompleteDateGrainProof = DateGrainProbeEvidence & Required<Pick<DateGrainProbeEvidence, 'rowCount' | 'nonBlankDateCount' | 'distinctDateCount' | 'distinctMonthStartCount' | 'nonMonthStartDateCount' | 'monthsWithMultipleDates' | 'maxDistinctDatesPerMonth' | 'blankDateCount' | 'duplicateDateCount' | 'gapCount' | 'nonMidnightTimeCount' | 'minDate' | 'maxDate'>>;
export declare function hasCompleteDateTableKeyProof(evidence: DateTableKeyProbeEvidence | undefined): evidence is CompleteDateTableKeyProof;
/**
 * Proves date-key-ness FROM DATA (not the isKey metadata flag): a complete probe
 * showing a non-blank, unique (distinct == non-blank), gap-free daily key with no
 * non-midnight time component. Import models often reject the isKey write, so the
 * gates must be able to prove a usable Date key from the probe alone. Dataset-agnostic.
 */
export declare function isDataProvenDailyKey(evidence: DateTableKeyProbeEvidence | undefined): boolean;
export declare function hasCompleteDateGrainProof(evidence: DateGrainProbeEvidence | undefined): evidence is CompleteDateGrainProof;
export {};
