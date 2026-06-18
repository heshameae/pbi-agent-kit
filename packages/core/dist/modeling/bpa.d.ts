import type { BPAViolation, Severity, TMDLModel } from './types.js';
export type BPARuleCategory = 'DAX' | 'Performance' | 'Naming' | 'Modeling' | 'Maintenance' | 'Formatting' | 'ErrorPrevention';
export interface BPARule {
    readonly id: string;
    readonly name: string;
    readonly severity: Severity;
    readonly category: BPARuleCategory;
    readonly check: (model: TMDLModel) => ReadonlyArray<BPAViolation>;
}
export declare const BPA_RULES: ReadonlyArray<BPARule>;
export declare function runBPA(model: TMDLModel): ReadonlyArray<BPAViolation>;
