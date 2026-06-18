import type { TMDLModel, TMDLTable } from './types.js';
export type TableKind = 'fact' | 'dimension' | 'unknown';
export interface TableClassification {
    readonly kind: TableKind;
    readonly confidence: number;
}
export declare function classifyTable(model: TMDLModel, tableName: string): TableClassification;
export declare function tableByName(model: TMDLModel, name: string): TMDLTable | undefined;
