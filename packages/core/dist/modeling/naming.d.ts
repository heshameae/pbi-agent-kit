export declare function looksLikeKeyName(name: string): boolean;
export declare function compareByName(a: string, b: string): number;
export declare function isMeasureLikeNumeric(column: {
    readonly dataType: string;
    readonly summarizeBy?: string;
    readonly name: string;
    readonly isKey: boolean;
}): boolean;
