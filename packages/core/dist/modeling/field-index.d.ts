import type { TMDLModel, TMDLRelationship } from './types.js';
export type ModelFieldKind = 'column' | 'measure';
export interface ModelColumnField {
    readonly kind: 'column';
    readonly table: string;
    readonly name: string;
    readonly dataType: string;
    readonly summarizeBy?: string;
    readonly isHidden: boolean;
    readonly isKey: boolean;
}
export interface ModelMeasureField {
    readonly kind: 'measure';
    readonly table: string;
    readonly name: string;
    readonly expression: string;
    readonly formatString?: string;
    readonly isHidden: boolean;
    readonly description?: string;
    readonly annotations: Readonly<Record<string, string>>;
}
export type ModelField = ModelColumnField | ModelMeasureField;
export interface ModelFieldIndexTable {
    readonly name: string;
    readonly isHidden: boolean;
    readonly isCalculated: boolean;
    readonly isAutoDateTable: boolean;
    readonly columns: Readonly<Record<string, ModelColumnField>>;
    readonly measures: Readonly<Record<string, ModelMeasureField>>;
}
export interface ModelRelationshipLink {
    readonly relationshipId: string;
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly toTable: string;
    readonly toColumn: string;
    readonly isActive: boolean;
    readonly crossFilteringBehavior: 'single' | 'both';
}
export interface TreatasBridgeMeasure {
    readonly measure: ModelMeasureField;
    readonly fromTable: string;
    readonly toTable: string;
    readonly fromTables: readonly string[];
    readonly toTables: readonly string[];
    readonly coveredAxes: readonly string[];
    readonly blockedAxes: readonly string[];
}
export interface ModelFieldIndex {
    readonly modelPath: string;
    readonly modelFingerprint: string;
    readonly model: TMDLModel;
    readonly tables: Readonly<Record<string, ModelFieldIndexTable>>;
    readonly relationships: readonly TMDLRelationship[];
    readonly relationshipGraph: Readonly<Record<string, readonly ModelRelationshipLink[]>>;
    readonly treatasBridgeMeasures: Readonly<Record<string, TreatasBridgeMeasure>>;
}
export declare function buildModelFieldIndex(modelPath: string): ModelFieldIndex;
export declare function buildModelFieldIndexFromModel(model: TMDLModel): ModelFieldIndex;
export declare function findModelField(index: ModelFieldIndex, tableName: string, fieldName: string): ModelField | null;
export declare function findColumn(index: ModelFieldIndex, tableName: string, columnName: string): ModelColumnField | null;
export declare function findMeasure(index: ModelFieldIndex, tableName: string, measureName: string): ModelMeasureField | null;
export declare function hasActiveRelationshipPath(index: ModelFieldIndex, fromTable: string, toTable: string): boolean;
export declare function hasDirectedFilterPath(index: ModelFieldIndex, filterTable: string, targetTable: string): boolean;
export declare function hasUndirectedRelationshipPath(index: ModelFieldIndex, fromTable: string, toTable: string): boolean;
export declare function isSummarizableColumn(column: ModelColumnField): boolean;
export declare function defaultAggregationForColumn(column: ModelColumnField): 'sum' | 'avg' | 'count' | 'min' | 'max' | null;
/** A directed active filter-propagation edge between two tables, tagged with the
 *  relationship that produces it. Direction semantics mirror
 *  `outgoingFilterLinks`: a single-direction relationship (fact[FK] → dim[key])
 *  propagates dim(to) → fact(from); a bidirectional one propagates both ways.
 *  Inactive relationships contribute nothing (role-playing must not create a
 *  phantom path). Used by MOD017 (diamond detection) and the diamond pre-write
 *  gate so both reason about the SAME edge set. */
export interface DirectedFilterEdge {
    readonly from: string;
    readonly to: string;
    readonly relationshipId: string;
}
export declare function directedFilterEdges(index: ModelFieldIndex): DirectedFilterEdge[];
export declare function directedFilterEdgesFromRelationships(relationships: readonly TMDLRelationship[]): DirectedFilterEdge[];
export declare function edgeDisjointDirectedPaths(edges: ReadonlyArray<{
    from: string;
    to: string;
    relationshipId: string;
}>, src: string, dst: string): string[][];
export declare function pathsDifferByIntermediate(paths: ReadonlyArray<ReadonlyArray<string>>): boolean;
