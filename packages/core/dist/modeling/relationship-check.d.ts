import type { CrossFilteringBehavior, RelationshipFinding, TMDLColumn, TMDLModel } from './types.js';
export interface RelationshipCandidate {
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly toTable: string;
    readonly toColumn: string;
    readonly isActive?: boolean;
    readonly crossFilteringBehavior?: CrossFilteringBehavior;
}
export interface RelationshipReason {
    readonly code: string;
    readonly message: string;
}
export interface RelationshipCheckResult {
    readonly valid: boolean;
    readonly blocking: readonly RelationshipReason[];
    readonly warnings: readonly RelationshipReason[];
}
export interface RelationshipCheckOptions {
    readonly ignoreRelationshipId?: string;
}
export declare function relationshipCheck(candidate: RelationshipCandidate, model: TMDLModel, options?: RelationshipCheckOptions): RelationshipCheckResult;
export declare function checkRelationships(model: TMDLModel): ReadonlyArray<RelationshipFinding>;
export declare function typesCompatible(a: TMDLColumn, b: TMDLColumn): boolean;
