export type Severity = 'error' | 'warning' | 'info';

export type Cardinality = 'manyToOne' | 'oneToMany' | 'oneToOne' | 'manyToMany';

export type CrossFilteringBehavior = 'single' | 'both';

export type StorageMode = 'import' | 'directQuery' | 'dual' | 'directLake';

export interface TMDLRolePermission {
  readonly table: string;
  readonly filterExpression: string; // '' = static role / no dynamic predicate
}

export interface TMDLRole {
  readonly name: string;
  readonly tablePermissions: ReadonlyArray<TMDLRolePermission>;
}

export interface TMDLColumn {
  readonly table: string;
  readonly name: string;
  readonly dataType: string;
  readonly summarizeBy?: string;
  readonly sourceColumn?: string;
  readonly dataCategory?: string;
  readonly formatString?: string;
  readonly isHidden: boolean;
  readonly isKey: boolean;
  readonly isCalculated: boolean;
  readonly expression?: string; // calc-column DAX (RHS of `column 'X' = <DAX>`)
  readonly description?: string;
  readonly displayFolder?: string;
  readonly sortByColumn?: string; // bare column name on the same table
  readonly isAvailableInMdx?: boolean; // absent ⇒ treated as true; only explicit false is risky
}

export interface TMDLMeasure {
  readonly table: string;
  readonly name: string;
  readonly expression: string;
  readonly formatString?: string;
  readonly isHidden: boolean;
  readonly description?: string;
  readonly displayFolder?: string;
  readonly annotations: Readonly<Record<string, string>>;
}

export interface TMDLTable {
  readonly name: string;
  readonly columns: ReadonlyArray<TMDLColumn>;
  readonly measures: ReadonlyArray<TMDLMeasure>;
  readonly isHidden: boolean;
  readonly isCalculated: boolean;
  readonly isAutoDateTable: boolean;
  readonly description?: string;
  readonly storageMode?: StorageMode;
}

export interface TMDLRelationship {
  readonly id: string;
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly isActive: boolean;
  readonly crossFilteringBehavior: CrossFilteringBehavior;
  readonly cardinality?: Cardinality;
  readonly relyOnReferentialIntegrity?: boolean;
}

export interface TMDLModel {
  readonly modelPath: string;
  readonly tables: ReadonlyArray<TMDLTable>;
  readonly relationships: ReadonlyArray<TMDLRelationship>;
  readonly roles?: ReadonlyArray<TMDLRole>;
}

export interface BridgeAnalysis {
  readonly fromTable: string;
  readonly toTable: string;
  readonly bridgeCovers: ReadonlyArray<string>;
  readonly bridgeUncovered: ReadonlyArray<string>;
  readonly bridgeBlockedAxes: ReadonlyArray<string>;
}

export interface GrainReport {
  readonly tableGrains: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly bridge?: BridgeAnalysis;
}

export interface BPAViolation {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly category: string;
  readonly object: string;
  readonly message: string;
  readonly fix?: string;
}

export interface RelationshipFinding {
  readonly level: Severity;
  readonly relationshipId: string;
  readonly message: string;
}

export interface BridgeIntent {
  readonly fromTable: string;
  readonly toTable: string;
  readonly axes?: ReadonlyArray<string>;
}

export interface ModelDoctorReport {
  readonly modelPath: string;
  readonly passed: boolean;
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
    readonly info: number;
  };
  readonly grain: GrainReport;
  readonly bpa: ReadonlyArray<BPAViolation>;
  readonly relationships: ReadonlyArray<RelationshipFinding>;
}
