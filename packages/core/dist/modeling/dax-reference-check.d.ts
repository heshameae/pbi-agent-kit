import type { TMDLModel } from './types.js';
export interface DaxReference {
    readonly table?: string;
    readonly name: string;
    readonly raw: string;
}
export interface UncommittedMeasureRef {
    readonly table: string;
    readonly name: string;
}
export interface DaxReferenceCheckOptions {
    readonly hostTable?: string;
    readonly uncommittedMeasures?: readonly UncommittedMeasureRef[];
    readonly assumeUnknownMeasuresExist?: boolean;
}
export interface DaxReferenceCheckResult {
    readonly valid: boolean;
    readonly missing: readonly DaxReference[];
    readonly ambiguous: readonly DaxReference[];
    readonly unsupported: readonly string[];
}
export declare function daxReferenceCheck(expression: string, model: TMDLModel, options?: DaxReferenceCheckOptions): DaxReferenceCheckResult;
