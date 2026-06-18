export type SemanticModelResolutionStatus = 'found' | 'not-found' | 'ambiguous';
export interface SemanticModelResolution {
    readonly status: SemanticModelResolutionStatus;
    readonly definitionPath?: string;
    readonly candidates: readonly string[];
    readonly reason?: string;
}
/**
 * Resolve a Power BI .SemanticModel/definition folder.
 *
 * This is intentionally conservative: if more than one candidate is visible,
 * callers must pass modelPath explicitly rather than letting the tool guess.
 */
export declare function resolveSemanticModelDefinition(input?: string): SemanticModelResolution;
/**
 * Resolve the semantic model adjacent to a .Report/definition folder.
 */
export declare function resolveSiblingSemanticModelDefinition(reportDefinitionPath: string): SemanticModelResolution;
