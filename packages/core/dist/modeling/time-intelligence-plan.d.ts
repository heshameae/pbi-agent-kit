export type TimeIntelligencePeriod = 'YTD' | 'QTD' | 'MTD';
export declare function parseTimeIntelligencePeriod(period: string | undefined): TimeIntelligencePeriod | undefined;
export interface BarePeriodToDate {
    readonly period: TimeIntelligencePeriod;
    readonly baseExpression: string;
    readonly datesRef: string;
    readonly extraArgs: readonly string[];
}
export declare function isYearEndDateLiteral(arg: string): boolean;
export declare function parseBarePeriodToDate(expression: string): BarePeriodToDate | null;
export declare function calendarOvershootsFactDay(calendarMaxDate: string | undefined, factMaxDate: string | undefined): boolean;
export interface TimeIntelligenceMeasureInput {
    readonly period: TimeIntelligencePeriod;
    readonly baseExpression: string;
    readonly dateTable: string;
    readonly dateKeyColumn: string;
    readonly yearEndDate?: string;
    readonly capToLastDataPeriod?: boolean;
}
export declare function buildTimeIntelligenceMeasureExpression(input: TimeIntelligenceMeasureInput): string;
export declare function detectCalendarMaxAnchorCap(expression: string, dateTable: string, dateColumn: string): boolean;
