import { compareByName } from './naming.js';
export function buildDataDictionary(model, options = {}) {
    const includeHidden = options.includeHidden === true;
    const includeExpressions = options.includeExpressions === true;
    const includeNested = options.includeNested === true;
    const selectedTables = options.tableNames && options.tableNames.length > 0 ? new Set(options.tableNames) : null;
    const selectedRefs = options.refs && options.refs.length > 0 ? new Set(options.refs) : null;
    const visibleTables = model.tables
        .filter((table) => (includeHidden || !table.isHidden) &&
        (selectedTables === null || selectedTables.has(table.name)))
        // Canonical code-unit name order so the dictionary (a primary read surface) is
        // byte-identical run-to-run. Folder mode is already canonical via the parser sort;
        // this also normalizes LIVE mode, where model.tables arrives in host-return order.
        .slice()
        .sort((a, b) => compareByName(a.name, b.name));
    const tableNames = new Set(visibleTables.map((table) => table.name));
    const tables = visibleTables.map((table) => dictionaryTable(table, { includeHidden, includeExpressions, selectedRefs }));
    const fields = tables.flatMap((table) => table.fields);
    const measures = tables.flatMap((table) => table.measures);
    const fieldRefs = new Set(fields.map((field) => field.ref));
    const relationships = model.relationships
        .filter((relationship) => tableNames.has(relationship.fromTable) && tableNames.has(relationship.toTable))
        .filter((relationship) => fieldRefs.has(canonicalRef(relationship.fromTable, relationship.fromColumn)) &&
        fieldRefs.has(canonicalRef(relationship.toTable, relationship.toColumn)))
        .map((relationship) => ({
        id: relationship.id,
        fromTable: relationship.fromTable,
        fromColumn: relationship.fromColumn,
        fromRef: canonicalRef(relationship.fromTable, relationship.fromColumn),
        toTable: relationship.toTable,
        toColumn: relationship.toColumn,
        toRef: canonicalRef(relationship.toTable, relationship.toColumn),
        isActive: relationship.isActive,
        crossFilteringBehavior: relationship.crossFilteringBehavior,
        ...(relationship.cardinality !== undefined ? { cardinality: relationship.cardinality } : {}),
        ...(relationship.relyOnReferentialIntegrity !== undefined
            ? { relyOnReferentialIntegrity: relationship.relyOnReferentialIntegrity }
            : {}),
    }));
    return {
        modelPath: model.modelPath,
        counts: {
            tables: tables.length,
            fields: fields.length,
            measures: measures.length,
            relationships: relationships.length,
        },
        tables: includeNested ? tables : tables.map(withoutNestedObjects),
        fields,
        measures,
        relationships,
    };
}
function dictionaryTable(table, options) {
    const fields = table.columns
        .filter((column) => options.includeHidden || !column.isHidden)
        .filter((column) => options.selectedRefs === null ||
        options.selectedRefs.has(canonicalRef(column.table, column.name)))
        .map((column) => dictionaryField(column, options.includeExpressions));
    const measures = table.measures
        .filter((measure) => options.includeHidden || !measure.isHidden)
        .filter((measure) => options.selectedRefs === null ||
        options.selectedRefs.has(canonicalRef(measure.table, measure.name)))
        .map((measure) => dictionaryMeasure(measure, options.includeExpressions));
    return {
        name: table.name,
        isHidden: table.isHidden,
        isCalculated: table.isCalculated,
        isAutoDateTable: table.isAutoDateTable,
        fieldCount: fields.length,
        measureCount: measures.length,
        fields,
        measures,
        ...(table.dataCategory !== undefined ? { dataCategory: table.dataCategory } : {}),
        ...(table.description !== undefined ? { description: table.description } : {}),
        ...(table.storageMode !== undefined ? { storageMode: table.storageMode } : {}),
        ...(options.includeExpressions && table.expression !== undefined
            ? { expression: table.expression }
            : {}),
    };
}
function withoutNestedObjects(table) {
    return {
        ...table,
        fields: [],
        measures: [],
    };
}
function dictionaryField(column, includeExpressions) {
    return {
        kind: 'column',
        table: column.table,
        name: column.name,
        ref: canonicalRef(column.table, column.name),
        dataType: column.dataType || 'unknown',
        isHidden: column.isHidden,
        isKey: column.isKey,
        isCalculated: column.isCalculated,
        ...(column.summarizeBy !== undefined ? { summarizeBy: column.summarizeBy } : {}),
        ...(column.sourceColumn !== undefined ? { sourceColumn: column.sourceColumn } : {}),
        ...(column.dataCategory !== undefined ? { dataCategory: column.dataCategory } : {}),
        ...(column.formatString !== undefined ? { formatString: column.formatString } : {}),
        ...(column.description !== undefined ? { description: column.description } : {}),
        ...(column.displayFolder !== undefined ? { displayFolder: column.displayFolder } : {}),
        ...(column.sortByColumn !== undefined ? { sortByColumn: column.sortByColumn } : {}),
        ...(column.isAvailableInMdx !== undefined ? { isAvailableInMdx: column.isAvailableInMdx } : {}),
        ...(includeExpressions && column.expression !== undefined
            ? { expression: column.expression }
            : {}),
    };
}
function dictionaryMeasure(measure, includeExpressions) {
    const annotations = measure.annotations ?? {};
    return {
        kind: 'measure',
        table: measure.table,
        name: measure.name,
        ref: canonicalRef(measure.table, measure.name),
        isHidden: measure.isHidden,
        ...(measure.formatString !== undefined ? { formatString: measure.formatString } : {}),
        ...(measure.description !== undefined ? { description: measure.description } : {}),
        ...(measure.displayFolder !== undefined ? { displayFolder: measure.displayFolder } : {}),
        ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
        ...(includeExpressions ? { expression: measure.expression } : {}),
    };
}
function canonicalRef(table, field) {
    return `${table}[${field}]`;
}
//# sourceMappingURL=data-dictionary.js.map