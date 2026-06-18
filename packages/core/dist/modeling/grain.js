import { isNumericType, isTemporalType, normalizeDataType } from './data-types.js';
export function isDateLikeColumn(column) {
    if (isTemporalType(column.dataType))
        return true;
    return /(^|\s)(date|year|month|quarter|week|day)(\s|$)/i.test(column.name);
}
export function isKeyLikeColumn(column) {
    if (column.isKey)
        return true;
    return /(id|key|code|sku|number)$/i.test(column.name);
}
export function dimColumnsOf(table) {
    return table.columns.filter((c) => !c.isHidden && !isAggregatedNumericColumn(c) && !isLineageOnly(c));
}
// A numeric column is treated as an aggregated MEASURE (not a grain/axis candidate)
// only when it carries an EXPLICIT non-none summarizeBy. We deliberately do NOT treat
// an undefined-summarizeBy numeric as aggregated here: a numeric surrogate key or
// period part with no summarizeBy line (month_no, FiscalYear) must REMAIN an axis/grain
// candidate. (Adversarial-verify regression: routing this through the axis-side
// "engine-default Sum" notion dropped such columns from the grain/axis set.)
function isAggregatedNumericColumn(column) {
    // Case-INSENSITIVE 'none' check, matching fact-classifier.isSummarizableNumericColumn and
    // field-index.isSummarizableColumn. Tabular/TMDL serializes the enum capitalized
    // (`summarizeBy: None`) and both ingestion paths pass it through verbatim, so a
    // case-sensitive `!== 'none'` would treat an explicit `None` numeric as an aggregated
    // measure and wrongly drop it from the grain/axis set.
    if (column.summarizeBy && column.summarizeBy.toLowerCase() !== 'none') {
        return isNumericType(column.dataType);
    }
    return false;
}
// Same-named columns only bridge a shared axis when their types are compatible.
function typesBridgeCompatible(a, b) {
    if (isNumericType(a.dataType) && isNumericType(b.dataType))
        return true;
    if (isTemporalType(a.dataType) && isTemporalType(b.dataType))
        return true;
    return normalizeDataType(a.dataType) === normalizeDataType(b.dataType);
}
function isLineageOnly(column) {
    return false;
}
export function inferGrain(table) {
    const dims = dimColumnsOf(table);
    const keys = dims.filter((c) => isKeyLikeColumn(c));
    if (keys.length > 0)
        return keys.map((c) => c.name);
    const dates = dims.filter((c) => isDateLikeColumn(c));
    const firstDate = dates[0];
    if (firstDate)
        return [firstDate.name];
    return dims.slice(0, 3).map((c) => c.name);
}
export function buildGrainReport(model) {
    const tableGrains = {};
    for (const table of model.tables) {
        if (table.isAutoDateTable)
            continue;
        tableGrains[table.name] = inferGrain(table);
    }
    return { tableGrains };
}
export function validateBridge(model, fromTable, toTable, intendedAxes) {
    const from = model.tables.find((t) => t.name === fromTable);
    const to = model.tables.find((t) => t.name === toTable);
    if (!from) {
        throw new Error(`Table not found: ${fromTable}`);
    }
    if (!to) {
        throw new Error(`Table not found: ${toTable}`);
    }
    const fromDimCols = dimColumnsOf(from);
    const fromDims = fromDimCols.map((c) => c.name);
    // Look up the TO-side column object by name. Use dimColumnsOf(to) (NOT to.columns)
    // so a hidden / measure-like TO column is excluded symmetrically with the from-side —
    // a hidden column is not a presentable shared axis. (Adversarial-verify regression:
    // switching to raw to.columns started counting hidden TO columns as covered.)
    const toByName = new Map(dimColumnsOf(to).map((c) => [c.name, c]));
    const bridgeCovers = fromDimCols
        .filter((fromCol) => {
        const toCol = toByName.get(fromCol.name);
        if (toCol === undefined)
            return false;
        // A name match alone overstated coverage: two unrelated same-named columns of
        // INCOMPATIBLE types (e.g. a string "Status" vs an int64 "Status") would read
        // as a covered shared axis even though a join on them cannot work. Require type
        // compatibility. (We deliberately do NOT additionally require a key-like TO
        // endpoint: a conformed dimension axis like "Category"/"Region"/"Order Date" is
        // a legitimate shared axis without being named/flagged as a key, and metadata
        // cannot prove uniqueness — over-restricting would hide real axes, which is the
        // opposite of this report's purpose.)
        return typesBridgeCompatible(fromCol, toCol);
    })
        .map((c) => c.name);
    const coversSet = new Set(bridgeCovers);
    const bridgeUncovered = (intendedAxes ?? []).filter((axis) => !coversSet.has(axis));
    const bridgeBlockedAxes = fromDims.filter((c) => !coversSet.has(c));
    return {
        fromTable,
        toTable,
        bridgeCovers,
        bridgeUncovered,
        bridgeBlockedAxes,
    };
}
//# sourceMappingURL=grain.js.map