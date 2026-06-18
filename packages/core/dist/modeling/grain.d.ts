import type { BridgeAnalysis, GrainReport, TMDLColumn, TMDLModel, TMDLTable } from './types.js';
export declare function isDateLikeColumn(column: TMDLColumn): boolean;
export declare function isKeyLikeColumn(column: TMDLColumn): boolean;
export declare function dimColumnsOf(table: TMDLTable): ReadonlyArray<TMDLColumn>;
export declare function inferGrain(table: TMDLTable): ReadonlyArray<string>;
export declare function buildGrainReport(model: TMDLModel): GrainReport;
export declare function validateBridge(model: TMDLModel, fromTable: string, toTable: string, intendedAxes?: ReadonlyArray<string>): BridgeAnalysis;
