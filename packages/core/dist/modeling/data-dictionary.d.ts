import type { TMDLModel } from './types.js';
export interface DataDictionaryOptions {
    readonly includeHidden?: boolean;
    readonly includeExpressions?: boolean;
    readonly includeNested?: boolean;
    readonly tableNames?: ReadonlyArray<string>;
    readonly refs?: ReadonlyArray<string>;
}
export interface DataDictionaryCounts {
    readonly tables: number;
    readonly fields: number;
    readonly measures: number;
    readonly relationships: number;
}
export interface DataDictionaryField {
    readonly kind: 'column';
    readonly table: string;
    readonly name: string;
    readonly ref: string;
    readonly dataType: string;
    readonly isHidden: boolean;
    readonly isKey: boolean;
    readonly isCalculated: boolean;
    readonly summarizeBy?: string;
    readonly sourceColumn?: string;
    readonly dataCategory?: string;
    readonly formatString?: string;
    readonly description?: string;
    readonly displayFolder?: string;
    readonly sortByColumn?: string;
    readonly isAvailableInMdx?: boolean;
    readonly expression?: string;
}
export interface DataDictionaryMeasure {
    readonly kind: 'measure';
    readonly table: string;
    readonly name: string;
    readonly ref: string;
    readonly isHidden: boolean;
    readonly formatString?: string;
    readonly description?: string;
    readonly displayFolder?: string;
    readonly annotations?: Readonly<Record<string, string>>;
    readonly expression?: string;
}
export interface DataDictionaryTable {
    readonly name: string;
    readonly isHidden: boolean;
    readonly isCalculated: boolean;
    readonly isAutoDateTable: boolean;
    readonly fieldCount: number;
    readonly measureCount: number;
    readonly fields: ReadonlyArray<DataDictionaryField>;
    readonly measures: ReadonlyArray<DataDictionaryMeasure>;
    readonly dataCategory?: string;
    readonly description?: string;
    readonly storageMode?: string;
    readonly expression?: string;
}
export interface DataDictionaryRelationship {
    readonly id: string;
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly fromRef: string;
    readonly toTable: string;
    readonly toColumn: string;
    readonly toRef: string;
    readonly isActive: boolean;
    readonly crossFilteringBehavior: string;
    readonly cardinality?: string;
    readonly relyOnReferentialIntegrity?: boolean;
}
export interface DataDictionary {
    readonly modelPath: string;
    readonly counts: DataDictionaryCounts;
    readonly tables: ReadonlyArray<DataDictionaryTable>;
    readonly fields: ReadonlyArray<DataDictionaryField>;
    readonly measures: ReadonlyArray<DataDictionaryMeasure>;
    readonly relationships: ReadonlyArray<DataDictionaryRelationship>;
}
export declare function buildDataDictionary(model: TMDLModel, options?: DataDictionaryOptions): DataDictionary;
