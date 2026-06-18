import { type RelationshipReason } from './relationship-check.js';
import type { TMDLModel } from './types.js';
export interface StarSchemaSharedDimensionPlanOptions {
    readonly axes?: ReadonlyArray<string>;
    readonly sharedColumns?: ReadonlyArray<string>;
}
export interface StarSchemaSharedDimensionPlanResult {
    readonly design: 'star-schema-shared-dimension';
    readonly directFactRelationshipAllowed: false;
    readonly leftTable: string;
    readonly rightTable: string;
    readonly plans: ReadonlyArray<StarSchemaSharedDimensionPlan>;
    readonly blockers: ReadonlyArray<StarSchemaSharedDimensionBlocker>;
}
export interface StarSchemaSharedDimensionPlan {
    readonly axis: string;
    readonly leftTable: string;
    readonly rightTable: string;
    readonly source: 'new-calculated-table' | 'existing-dimension';
    readonly proposedDimensionTableName: string;
    readonly dimensionKeyColumn: string;
    readonly daxExpression?: string;
    readonly writePlan: ReadonlyArray<StarSchemaWritePlanItem>;
}
export type StarSchemaWritePlanItem = CreateCalculatedTablePlanItem | ConfigureDimensionKeyPlanItem | CreateRelationshipsPlanItem | RepairRelationshipsPlanItem | HideSourceColumnsPlanItem;
export interface CreateCalculatedTablePlanItem {
    readonly action: 'create-calculated-table';
    readonly tableName: string;
    readonly expression: string;
    readonly description: string;
}
export interface ConfigureDimensionKeyPlanItem {
    readonly action: 'configure-dimension-key';
    readonly tableName: string;
    readonly columnName: string;
    readonly summarizeBy: 'none';
    readonly isKey: true;
    readonly description: string;
}
export interface CreateRelationshipsPlanItem {
    readonly action: 'create-relationships';
    readonly relationships: ReadonlyArray<StarSchemaRelationshipPlan>;
    readonly description: string;
}
export interface StarSchemaRelationshipPlan {
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly toTable: string;
    readonly toColumn: string;
    readonly cardinality: 'manyToOne';
    readonly crossFilteringBehavior: 'single';
    readonly isActive: true;
}
export interface RepairRelationshipsPlanItem {
    readonly action: 'repair-relationships';
    readonly relationships: ReadonlyArray<StarSchemaRelationshipRepairPlan>;
    readonly description: string;
}
export interface StarSchemaRelationshipRepairPlan extends StarSchemaRelationshipPlan {
    readonly id: string;
    readonly reason: 'inactive' | 'bidirectional';
}
export interface HideSourceColumnsPlanItem {
    readonly action: 'hide-source-columns';
    readonly columns: ReadonlyArray<StarSchemaColumnRef>;
    readonly description: string;
}
export interface StarSchemaColumnRef {
    readonly table: string;
    readonly column: string;
}
export type StarSchemaSharedDimensionBlocker = TableNotFoundBlocker | AxisMissingBlocker | AxisTypeMismatchBlocker | AxisUnusableBlocker | RelationshipRepairUnsupportedBlocker | RelationshipWriteBlockedBlocker | NoSharedAxesBlocker | NoUsableSharedAxesBlocker;
export interface TableNotFoundBlocker {
    readonly code: 'table-not-found';
    readonly table: string;
    readonly message: string;
}
export interface AxisMissingBlocker {
    readonly code: 'axis-missing-on-left' | 'axis-missing-on-right';
    readonly axis: string;
    readonly message: string;
}
export interface AxisTypeMismatchBlocker {
    readonly code: 'axis-type-mismatch';
    readonly axis: string;
    readonly leftDataType: string;
    readonly rightDataType: string;
    readonly message: string;
}
export interface AxisUnusableBlocker {
    readonly code: 'axis-unusable-on-left' | 'axis-unusable-on-right';
    readonly axis: string;
    readonly table: string;
    readonly reason: 'calculated' | 'unsupported-data-type' | 'measure-like' | 'temporal-axis';
    readonly dataType?: string;
    readonly message: string;
}
export interface RelationshipRepairUnsupportedBlocker {
    readonly code: 'relationship-repair-unsupported';
    readonly axis: string;
    readonly relationshipId: string;
    readonly reason: 'wrong-cardinality' | 'wrong-direction' | 'relationship-id-missing';
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly toTable: string;
    readonly toColumn: string;
    readonly message: string;
}
export interface RelationshipWriteBlockedBlocker {
    readonly code: 'relationship-write-blocked';
    readonly action: 'create-relationship' | 'repair-relationship';
    readonly axis: string;
    readonly relationshipId?: string;
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly toTable: string;
    readonly toColumn: string;
    readonly blocking: ReadonlyArray<RelationshipReason>;
    readonly message: string;
}
export interface NoSharedAxesBlocker {
    readonly code: 'no-shared-axes';
    readonly message: string;
}
export interface NoUsableSharedAxesBlocker {
    readonly code: 'no-usable-shared-axes';
    readonly message: string;
}
export declare function planStarSchemaSharedDimensions(model: TMDLModel, leftTable: string, rightTable: string, options?: StarSchemaSharedDimensionPlanOptions): StarSchemaSharedDimensionPlanResult;
