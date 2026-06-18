import type { TMDLColumn } from './types.js';
export type CanonicalDataType = 'boolean' | 'date' | 'datetime' | 'datetimezone' | 'decimal' | 'double' | 'int64' | 'string';
export declare function normalizeDataType(dataType: string): string;
export declare function toCanonicalDataType(dataType: string): CanonicalDataType | undefined;
export declare function isTemporalType(dataType: string): boolean;
export declare function isNumericType(dataType: string): boolean;
export declare function isStringType(dataType: string): boolean;
export declare function isBooleanType(dataType: string): boolean;
export declare function isTemporalColumn(column: TMDLColumn): boolean;
export declare function isNumericColumn(column: TMDLColumn): boolean;
export declare function isAggregatableNumeric(column: {
    readonly dataType: string;
    readonly summarizeBy?: string;
}): boolean;
