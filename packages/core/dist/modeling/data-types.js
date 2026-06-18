const CANONICAL_DATA_TYPES = new Set([
    'boolean',
    'date',
    'datetime',
    'datetimezone',
    'decimal',
    'double',
    'int64',
    'string',
]);
const TEMPORAL_TYPES = new Set(['date', 'datetime', 'datetimezone']);
const NUMERIC_TYPES = new Set(['int64', 'decimal', 'double']);
export function normalizeDataType(dataType) {
    return dataType.trim().toLowerCase();
}
export function toCanonicalDataType(dataType) {
    const normalized = normalizeDataType(dataType);
    return CANONICAL_DATA_TYPES.has(normalized)
        ? normalized
        : undefined;
}
export function isTemporalType(dataType) {
    return TEMPORAL_TYPES.has(normalizeDataType(dataType));
}
export function isNumericType(dataType) {
    return NUMERIC_TYPES.has(normalizeDataType(dataType));
}
export function isStringType(dataType) {
    return normalizeDataType(dataType) === 'string';
}
export function isBooleanType(dataType) {
    return normalizeDataType(dataType) === 'boolean';
}
export function isTemporalColumn(column) {
    return isTemporalType(column.dataType);
}
export function isNumericColumn(column) {
    return isNumericType(column.dataType);
}
// Engine-default-Sum aggregation semantics: in Tabular the DEFAULT summarization for a
// numeric column is Sum, and TMDL/Desktop only serialize an explicit `summarizeBy:` line
// when it DIFFERS from that default — so a numeric column with summarizeBy undefined IS
// aggregatable (implicit Sum); only an explicit `none` makes it non-aggregating.
// SCOPE: this key-INCLUSIVE notion is used ONLY by BPA MOD014 (which must flag a numeric
// KEY that auto-sums) and, via isMeasureLikeNumeric (naming.ts), by star-schema's axis
// test. The fact-classifier, grain, and field-index intentionally use a STRICTER
// explicit-`summarizeBy` signal instead — treating an undefined-summarizeBy numeric as
// aggregatable there over-classified a dimension carrying a numeric attribute as a fact
// (adversarial-verify regression). Do NOT route those three through this helper.
// DATASET-AGNOSTIC: keys off canonical type + summarizeBy only, no field names.
export function isAggregatableNumeric(column) {
    if (!isNumericType(column.dataType))
        return false;
    return (column.summarizeBy ?? '').toLowerCase() !== 'none';
}
//# sourceMappingURL=data-types.js.map