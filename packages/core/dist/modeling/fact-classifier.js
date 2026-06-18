import { isNumericType } from './data-types.js';
// Heuristic, PURELY STRUCTURAL fact/dimension classifier. There is no native
// `isFact` flag in Tabular, and several rules (orphan-fact severity,
// fact-to-fact, snowflake exclusion, conformed-dimension) need to know whether a
// table is fact-like. DATASET-AGNOSTIC: no hardcoded table/column names — only
// the model's own relationship topology and column shape.
//
// Signals (FINAL contract §classifier):
//   S1 — has >= 1 measure
//   S2 — count of summarizable columns (numeric AND summarizeBy != none)
//   S3 — is the `fromTable` (many side) of >= 1 relationship
//   S4 — number of distinct relationships where it is the `fromTable` (fan-out)
//
// Decision:
//   fact      = S3 >= 1 AND (S2 >= 1 OR S4 >= 2)
//   dimension = appears only as a `toTable` (never a from side), OR 0 numerics + 0 measures
//   unknown   = neither (ambiguous)
export function classifyTable(model, tableName) {
    const table = model.tables.find((t) => t.name === tableName);
    if (!table)
        return { kind: 'unknown', confidence: 0 };
    const s1HasMeasure = table.measures.length > 0;
    const s2SummarizableCount = table.columns.filter(isSummarizableNumericColumn).length;
    let s3IsFromSide = false;
    let s4FanOut = 0;
    let isToSide = false;
    for (const r of model.relationships) {
        if (r.fromTable === tableName) {
            // Only count an edge as fan-out / many-side when this table is actually on the
            // MANY side. A relationship can be authored oneToMany (from = the ONE/dimension
            // side); counting those as fan-out would misclassify a conformed dimension that
            // sits on the from-side of >= 2 oneToMany edges as a fact. manyToOne, manyToMany,
            // and the absent default (PBI default manyToOne) all put the from side on many.
            if (isManySideFrom(r.cardinality)) {
                s3IsFromSide = true;
                s4FanOut += 1;
            }
            else {
                // oneToMany / oneToOne from-side is the ONE side — a dimension-like signal.
                isToSide = true;
            }
        }
        if (r.toTable === tableName)
            isToSide = true;
    }
    const numericCount = table.columns.filter((c) => isNumericType(c.dataType)).length;
    // FACT: sits on the many side AND carries aggregatable measures/quantities or
    // fans out to multiple dimensions.
    if (s3IsFromSide && (s2SummarizableCount >= 1 || s4FanOut >= 2)) {
        // More corroborating signals → higher confidence.
        const signals = [s1HasMeasure, s2SummarizableCount >= 1, s4FanOut >= 2].filter(Boolean).length;
        return { kind: 'fact', confidence: clamp(0.6 + 0.15 * signals) };
    }
    // DIMENSION: only ever a target (to side) of relationships, or has no numerics
    // and no measures (a pure lookup / attribute table).
    if ((isToSide && !s3IsFromSide) || (numericCount === 0 && !s1HasMeasure)) {
        // A related, non-numeric lookup table is a stronger dimension signal than a
        // disconnected attribute-only table.
        const confidence = isToSide && !s3IsFromSide ? 0.8 : 0.5;
        return { kind: 'dimension', confidence };
    }
    return { kind: 'unknown', confidence: 0 };
}
// Fact-detection signal S2: a numeric column with an EXPLICIT non-none summarizeBy.
// This is deliberately STRICTER than the "engine-default Sum" notion used for axis
// detection: requiring an explicit summarizeBy keeps the fact classifier conservative
// so a dimension that merely carries a numeric ATTRIBUTE with no summarizeBy line
// (Weight, Latitude, Age, FiscalYear) is NOT misclassified as a fact — which would
// make star-schema propose a duplicate dimension and fire false MOD010 conformance
// warnings. (Adversarial-verify regression: unifying this with the axis-side
// isMeasureLikeNumeric over-classified such dimensions as facts.)
function isSummarizableNumericColumn(column) {
    return (column.summarizeBy !== undefined &&
        column.summarizeBy.toLowerCase() !== 'none' &&
        isNumericType(column.dataType));
}
// True when the from-side of a relationship with this cardinality is on the MANY
// side (so the from-table is fact-like w.r.t. that edge). undefined == PBI default
// manyToOne.
function isManySideFrom(cardinality) {
    return cardinality === undefined || cardinality === 'manyToOne' || cardinality === 'manyToMany';
}
function clamp(n) {
    return Math.max(0, Math.min(1, n));
}
// Re-exported convenience for rules that just need the table object.
export function tableByName(model, name) {
    return model.tables.find((t) => t.name === name);
}
//# sourceMappingURL=fact-classifier.js.map