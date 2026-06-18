import type { Cardinality, StorageMode, TMDLModel } from 'pbi-core';
import type { McpToolResult } from './ms-mcp-client.js';
export declare const MS_TOOLS: {
    readonly connection: "connection_operations";
    readonly tables: "table_operations";
    readonly columns: "column_operations";
    readonly measures: "measure_operations";
    readonly relationships: "relationship_operations";
    readonly dax: "dax_query_operations";
    readonly model: "model_operations";
    readonly database: "database_operations";
    readonly roles: "security_role_operations";
};
export interface ModelClient {
    callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
    reset?(): void;
    onReset?(cb: () => void): void;
}
export declare function isConnectionDrop(err: unknown): boolean;
export declare function isNonRetryable(err: unknown): boolean;
export type ConnectionMode = 'live' | 'folder';
export interface ConnectionInfo {
    readonly mode: ConnectionMode;
    readonly connectionString?: string;
    readonly folderPath?: string;
}
export interface TableInventoryRow {
    readonly name: string;
    readonly isHidden: boolean;
    readonly isCalculated: boolean;
    readonly isAutoDateTable: boolean;
    readonly description?: string;
    readonly storageMode?: StorageMode;
    readonly columnCount?: number;
    readonly measureCount?: number;
}
export interface ModelSnapshotOptions {
    readonly includeMeasures?: boolean;
    readonly includeRoles?: boolean;
}
export interface MeasureWrite {
    readonly tableName: string;
    readonly name: string;
    readonly expression?: string;
    readonly formatString?: string;
    readonly description?: string;
}
export interface MeasureRef {
    readonly tableName: string;
    readonly name: string;
}
export interface TableWrite {
    readonly name: string;
    readonly mode?: string;
    readonly mExpression?: string;
    readonly expression?: string;
    readonly description?: string;
    readonly isHidden?: boolean;
}
export interface TableUpdate {
    readonly name: string;
    readonly newName?: string;
    readonly description?: string;
    readonly isHidden?: boolean;
    readonly dataCategory?: string;
    readonly annotations?: Readonly<Record<string, string>>;
}
export interface TableRef {
    readonly name: string;
}
export interface ColumnWrite {
    readonly tableName: string;
    readonly name: string;
    readonly sourceColumn?: string;
    readonly expression?: string;
    readonly dataType?: string;
    readonly summarizeBy?: string;
    readonly formatString?: string;
    readonly sortByColumn?: string;
    readonly isHidden?: boolean;
    readonly description?: string;
    readonly isKey?: boolean;
    readonly dataCategory?: string;
}
export interface ColumnUpdate {
    readonly tableName: string;
    readonly name: string;
    readonly newName?: string;
    readonly dataType?: string;
    readonly expression?: string;
    readonly summarizeBy?: string;
    readonly formatString?: string;
    readonly sortByColumn?: string;
    readonly isHidden?: boolean;
    readonly description?: string;
    readonly isKey?: boolean;
    readonly dataCategory?: string;
}
export interface ColumnRef {
    readonly tableName: string;
    readonly name: string;
}
export interface RelationshipWrite {
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly toTable: string;
    readonly toColumn: string;
    readonly cardinality?: Cardinality;
    readonly crossFilteringBehavior?: 'single' | 'both';
    readonly isActive?: boolean;
}
export interface RelationshipUpdate {
    readonly id: string;
    readonly fromTable?: string;
    readonly fromColumn?: string;
    readonly toTable?: string;
    readonly toColumn?: string;
    readonly cardinality?: Cardinality;
    readonly crossFilteringBehavior?: 'single' | 'both';
    readonly isActive?: boolean;
}
export interface RelationshipRef {
    readonly id: string;
}
export interface LiveInstance {
    readonly connectionString: string;
    readonly port?: string;
    readonly name?: string;
    readonly databaseName?: string;
    readonly initialCatalog?: string;
}
export interface ConnectOpts {
    readonly folderPath?: string;
    readonly model?: string;
    readonly livePreferred?: boolean;
    readonly forceFolder?: boolean;
}
export interface DaxQueryOptions {
    readonly includeRawDiagnostics?: boolean;
}
export declare function operationArgs(operation: string, params?: Record<string, unknown>): Record<string, unknown>;
export declare function toDaxSource<T extends {
    expression?: string;
}>(def: T): Omit<T, 'expression'> & {
    daxExpression?: string;
};
export declare function redactConnectionSecrets(text: string): string;
export declare function normalizeDaxResult(payload: unknown): unknown;
export declare function pickArray(payload: unknown): unknown[];
export declare function collectConnectionStrings(payload: unknown): string[];
export declare function extractLiveInstances(payload: unknown): LiveInstance[];
export declare function normalizeModelName(s: string): string;
export declare class ModelDriver {
    #private;
    constructor(client: ModelClient);
    get connection(): ConnectionInfo | null;
    call(tool: string, operation: string, params?: Record<string, unknown>): Promise<unknown>;
    listLocalInstances(): Promise<string[]>;
    listLiveInstances(): Promise<LiveInstance[]>;
    ensureConnection(opts?: ConnectOpts): Promise<ConnectionInfo>;
    listTablesRaw(expectedConnection?: ConnectionInfo): Promise<Record<string, unknown>[]>;
    listTableInventoryRaw(expectedConnection?: ConnectionInfo): Promise<TableInventoryRow[]>;
    listColumnsRaw(expectedConnection?: ConnectionInfo): Promise<Record<string, unknown>[]>;
    listMeasuresRaw(expectedConnection?: ConnectionInfo): Promise<Record<string, unknown>[]>;
    listMeasuresEnriched(expectedConnection?: ConnectionInfo): Promise<Record<string, unknown>[]>;
    listRelationshipsRaw(expectedConnection?: ConnectionInfo): Promise<Record<string, unknown>[]>;
    listRolesRaw(expectedConnection?: ConnectionInfo): Promise<Record<string, unknown>[]>;
    daxQuery(query: string, expectedConnection?: ConnectionInfo, options?: DaxQueryOptions): Promise<unknown>;
    refreshModel(refreshType?: 'Automatic' | 'Full' | 'Calculate', expectedConnection?: ConnectionInfo): Promise<unknown>;
    getModelSnapshot(modelPath?: string, options?: ModelSnapshotOptions, expectedConnection?: ConnectionInfo): Promise<TMDLModel>;
    getFreshSnapshot(expectedConnection?: ConnectionInfo, options?: ModelSnapshotOptions): Promise<TMDLModel>;
    getCachedSnapshot(expectedConnection?: ConnectionInfo, options?: ModelSnapshotOptions): Promise<TMDLModel>;
    createMeasure(def: MeasureWrite, expectedConnection?: ConnectionInfo): Promise<unknown>;
    updateMeasure(def: MeasureWrite, expectedConnection?: ConnectionInfo): Promise<unknown>;
    deleteMeasure(ref: MeasureRef, expectedConnection?: ConnectionInfo): Promise<unknown>;
    createTable(def: TableWrite, expectedConnection?: ConnectionInfo): Promise<unknown>;
    updateTable(def: TableUpdate, expectedConnection?: ConnectionInfo): Promise<unknown>;
    deleteTable(ref: TableRef, expectedConnection?: ConnectionInfo): Promise<unknown>;
    createColumn(def: ColumnWrite, expectedConnection?: ConnectionInfo): Promise<unknown>;
    createColumns(defs: ReadonlyArray<ColumnWrite>, expectedConnection?: ConnectionInfo): Promise<unknown>;
    updateColumn(def: ColumnUpdate, expectedConnection?: ConnectionInfo): Promise<unknown>;
    updateColumns(defs: ReadonlyArray<ColumnUpdate>, expectedConnection?: ConnectionInfo): Promise<unknown>;
    deleteColumn(ref: ColumnRef, expectedConnection?: ConnectionInfo): Promise<unknown>;
    markAsDateTable(tableName: string, dateColumn: string, expectedConnection?: ConnectionInfo): Promise<unknown>;
    createRelationship(def: RelationshipWrite, expectedConnection?: ConnectionInfo): Promise<unknown>;
    createRelationships(defs: ReadonlyArray<RelationshipWrite>, expectedConnection?: ConnectionInfo): Promise<unknown>;
    updateRelationship(def: RelationshipUpdate, expectedConnection?: ConnectionInfo): Promise<unknown>;
    updateRelationships(defs: ReadonlyArray<RelationshipUpdate>, expectedConnection?: ConnectionInfo): Promise<unknown>;
    activateRelationship(ref: RelationshipRef, expectedConnection?: ConnectionInfo): Promise<unknown>;
    deactivateRelationship(ref: RelationshipRef, expectedConnection?: ConnectionInfo): Promise<unknown>;
    deleteRelationship(ref: RelationshipRef, expectedConnection?: ConnectionInfo): Promise<unknown>;
    exportToTmdlFolder(folderPath?: string, expectedConnection?: ConnectionInfo): Promise<unknown>;
}
