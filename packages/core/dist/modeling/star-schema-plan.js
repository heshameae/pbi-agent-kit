import { isTemporalType, normalizeDataType } from './data-types.js';
import { classifyTable } from './fact-classifier.js';
import { isMeasureLikeNumeric } from './naming.js';
import { relationshipCheck, typesCompatible, } from './relationship-check.js';
const ALLOWED_SHARED_AXIS_DATA_TYPES = new Set([
    'string',
    'date',
    'datetime',
    'datetimezone',
    'int64',
    'decimal',
    'double',
]);
export function planStarSchemaSharedDimensions(model, leftTable, rightTable, options = {}) {
    const blockers = [];
    const tableByName = new Map(model.tables.map((table) => [table.name, table]));
    const left = tableByName.get(leftTable);
    const right = tableByName.get(rightTable);
    if (!left) {
        blockers.push({
            code: 'table-not-found',
            table: leftTable,
            message: `Table not found: ${leftTable}`,
        });
    }
    if (!right) {
        blockers.push({
            code: 'table-not-found',
            table: rightTable,
            message: `Table not found: ${rightTable}`,
        });
    }
    if (!left || !right) {
        return baseResult(leftTable, rightTable, [], blockers);
    }
    const axisNames = resolveAxisNames(left, right, options);
    if (axisNames.length === 0) {
        blockers.push({
            code: 'no-shared-axes',
            message: `No shared axes found between "${leftTable}" and "${rightTable}".`,
        });
        return baseResult(leftTable, rightTable, [], blockers);
    }
    const usedTableNames = new Set(model.tables.map((table) => table.name));
    const plans = [];
    for (const axis of axisNames) {
        const leftColumn = left.columns.find((column) => column.name === axis);
        const rightColumn = right.columns.find((column) => column.name === axis);
        if (!leftColumn) {
            blockers.push({
                code: 'axis-missing-on-left',
                axis,
                message: `Axis "${axis}" does not exist on table "${leftTable}".`,
            });
            continue;
        }
        if (!rightColumn) {
            blockers.push({
                code: 'axis-missing-on-right',
                axis,
                message: `Axis "${axis}" does not exist on table "${rightTable}".`,
            });
            continue;
        }
        const leftUsabilityBlocker = axisUsabilityBlocker('left', leftColumn);
        if (leftUsabilityBlocker) {
            blockers.push(leftUsabilityBlocker);
            continue;
        }
        const rightUsabilityBlocker = axisUsabilityBlocker('right', rightColumn);
        if (rightUsabilityBlocker) {
            blockers.push(rightUsabilityBlocker);
            continue;
        }
        if (!typesCompatible(leftColumn, rightColumn)) {
            blockers.push({
                code: 'axis-type-mismatch',
                axis,
                leftDataType: leftColumn.dataType,
                rightDataType: rightColumn.dataType,
                message: `Axis "${axis}" has incompatible data types: ${leftTable}[${axis}]=${leftColumn.dataType} vs ${rightTable}[${axis}]=${rightColumn.dataType}.`,
            });
            continue;
        }
        if (isTemporalSharedAxis(leftColumn, rightColumn)) {
            blockers.push({
                code: 'axis-unusable-on-left',
                axis,
                table: leftTable,
                reason: 'temporal-axis',
                dataType: leftColumn.dataType,
                message: `Axis "${axis}" is temporal. Use pbi_model_plan_date_table and pbi_model_plan_date_grain for Date relationships instead of the star-schema shared-dimension planner.`,
            });
            continue;
        }
        const existingDimension = findExistingDimensionForAxis(model, axis, leftTable, rightTable, leftColumn, rightColumn);
        const dimensionTableName = existingDimension?.table.name ?? proposeDimensionTableName(axis, usedTableNames);
        const dimensionKeyColumn = existingDimension?.keyColumn ?? {
            ...leftColumn,
            table: dimensionTableName,
            name: axis,
        };
        if (!existingDimension)
            usedTableNames.add(dimensionTableName);
        const daxExpression = existingDimension
            ? undefined
            : buildSharedDimensionDax(leftTable, rightTable, axis);
        const write = buildWritePlan(model, leftTable, rightTable, axis, dimensionTableName, dimensionKeyColumn, daxExpression);
        plans.push({
            axis,
            leftTable,
            rightTable,
            source: existingDimension ? 'existing-dimension' : 'new-calculated-table',
            proposedDimensionTableName: dimensionTableName,
            dimensionKeyColumn: dimensionKeyColumn.name,
            ...(daxExpression !== undefined ? { daxExpression } : {}),
            writePlan: write.writePlan,
        });
        blockers.push(...write.blockers);
    }
    if (plans.length === 0 && !blockers.some((blocker) => blocker.code === 'no-shared-axes')) {
        blockers.push({
            code: 'no-usable-shared-axes',
            message: `No usable shared axes found between "${leftTable}" and "${rightTable}".`,
        });
    }
    return baseResult(leftTable, rightTable, plans, blockers);
}
function baseResult(leftTable, rightTable, plans, blockers) {
    return {
        design: 'star-schema-shared-dimension',
        directFactRelationshipAllowed: false,
        leftTable,
        rightTable,
        plans,
        blockers,
    };
}
function resolveAxisNames(left, right, options) {
    const requestedAxes = options.axes ?? options.sharedColumns;
    if (requestedAxes)
        return dedupe(requestedAxes);
    const rightColumnNames = new Set(right.columns.map((column) => column.name));
    return dedupe(left.columns.map((column) => column.name).filter((name) => rightColumnNames.has(name))).sort(compareCodePoint);
}
function compareCodePoint(a, b) {
    if (a < b)
        return -1;
    if (a > b)
        return 1;
    return 0;
}
function dedupe(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        if (seen.has(value))
            continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}
function axisUsabilityBlocker(side, column) {
    const code = side === 'left' ? 'axis-unusable-on-left' : 'axis-unusable-on-right';
    if (column.isCalculated) {
        return {
            code,
            axis: column.name,
            table: column.table,
            reason: 'calculated',
            message: `Axis "${column.name}" on table "${column.table}" is calculated.`,
        };
    }
    if (!ALLOWED_SHARED_AXIS_DATA_TYPES.has(normalizeDataType(column.dataType))) {
        return {
            code,
            axis: column.name,
            table: column.table,
            reason: 'unsupported-data-type',
            dataType: column.dataType,
            message: `Axis "${column.name}" on table "${column.table}" has unsupported data type "${column.dataType}".`,
        };
    }
    if (isMeasureLikeColumn(column)) {
        return {
            code,
            axis: column.name,
            table: column.table,
            reason: 'measure-like',
            dataType: column.dataType,
            message: `Axis "${column.name}" on table "${column.table}" is numeric and summarized like a measure.`,
        };
    }
    return undefined;
}
function isTemporalSharedAxis(leftColumn, rightColumn) {
    return isTemporalSharedAxisColumn(leftColumn) || isTemporalSharedAxisColumn(rightColumn);
}
function isTemporalSharedAxisColumn(column) {
    return isTemporalType(column.dataType) || (column.dataCategory ?? '').toLowerCase() === 'time';
}
function isMeasureLikeColumn(column) {
    // Engine-default Sum (undefined summarizeBy on a numeric column) is measure-like;
    // explicit `none` and numeric keys/identifiers are not. Shared helper keeps this
    // aligned with the fact-classifier / grain / field-index definitions (no behavior
    // change here — star-schema already excluded keys and treated undefined as Sum).
    return isMeasureLikeNumeric(column);
}
function looksIntrinsicallyFactLike(table) {
    return table.measures.length > 0 || table.columns.some(isMeasureLikeColumn);
}
function proposeDimensionTableName(axis, usedTableNames) {
    if (!usedTableNames.has(axis))
        return axis;
    for (const suffix of [' Shared', ' Lookup']) {
        const candidate = `${axis}${suffix}`;
        if (!usedTableNames.has(candidate))
            return candidate;
    }
    let index = 2;
    while (usedTableNames.has(`${axis} Shared ${index}`)) {
        index += 1;
    }
    return `${axis} Shared ${index}`;
}
function findExistingDimensionForAxis(model, axis, leftTable, rightTable, leftColumn, rightColumn) {
    const candidates = [];
    for (const table of model.tables) {
        if (table.name === leftTable || table.name === rightTable)
            continue;
        const classification = classifyTable(model, table.name);
        if (classification.kind === 'fact')
            continue;
        if (classification.kind === 'unknown' && looksIntrinsicallyFactLike(table))
            continue;
        for (const column of candidateDimensionKeyColumns(model.relationships, table, axis, [
            leftTable,
            rightTable,
        ])) {
            if (axisUsabilityBlocker('left', column) !== undefined ||
                !typesCompatible(column, leftColumn) ||
                !typesCompatible(column, rightColumn)) {
                continue;
            }
            const nameRank = existingDimensionNameRank(table.name, axis);
            const relationshipCoverage = safeRelationshipCoverage(model.relationships, table.name, axis, column.name, [leftTable, rightTable]);
            const unsupportedRepairCount = unsupportedRelationshipRepairBlockers(model.relationships, axis, leftTable, rightTable, table.name, column.name).length;
            if (relationshipCoverage === 0 && unsupportedRepairCount === 0)
                continue;
            candidates.push({
                table,
                keyColumn: column,
                nameRank,
                relationshipCoverage,
                unsupportedRepairCount,
                isKey: column.isKey,
            });
        }
    }
    return candidates.sort((a, b) => a.unsupportedRepairCount - b.unsupportedRepairCount ||
        b.relationshipCoverage - a.relationshipCoverage ||
        (a.nameRank ?? Number.MAX_SAFE_INTEGER) - (b.nameRank ?? Number.MAX_SAFE_INTEGER) ||
        Number(b.isKey) - Number(a.isKey) ||
        compareCodePoint(a.keyColumn.name, b.keyColumn.name) ||
        compareCodePoint(a.table.name, b.table.name))[0];
}
function candidateDimensionKeyColumns(relationships, table, axis, sourceTables) {
    const byName = new Map(table.columns.map((column) => [column.name, column]));
    const candidates = new Map();
    const sameName = byName.get(axis);
    if (sameName)
        candidates.set(sameName.name, sameName);
    for (const relationship of relationships) {
        for (const sourceTable of sourceTables) {
            if (relationship.fromTable === sourceTable &&
                relationship.fromColumn === axis &&
                relationship.toTable === table.name) {
                const column = byName.get(relationship.toColumn);
                if (column)
                    candidates.set(column.name, column);
            }
            if (relationship.toTable === sourceTable &&
                relationship.toColumn === axis &&
                relationship.fromTable === table.name) {
                const column = byName.get(relationship.fromColumn);
                if (column)
                    candidates.set(column.name, column);
            }
        }
    }
    return [...candidates.values()];
}
function existingDimensionNameRank(tableName, axis) {
    if (tableName === axis)
        return 0;
    const table = normalizeDimensionName(tableName);
    const tableWithoutAffixes = normalizeDimensionName(tableName, { stripAffixes: true });
    const axisName = normalizeDimensionName(axis);
    const axisKeyStem = normalizeKeyStem(axis);
    if (table === axisName)
        return 1;
    if (tableWithoutAffixes === axisName)
        return 2;
    if (axisKeyStem && tableWithoutAffixes === axisKeyStem)
        return 3;
    if (axisKeyStem && table === axisKeyStem)
        return 4;
    return undefined;
}
function nameTokens(name) {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(singularizeToken);
}
function normalizeDimensionName(name, opts = {}) {
    const tokens = nameTokens(name);
    if (opts.stripAffixes) {
        while (tokens.length > 0 && DIMENSION_PREFIX_TOKENS.has(tokens[0]))
            tokens.shift();
        while (tokens.length > 0 && DIMENSION_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
            tokens.pop();
        }
    }
    return tokens.join('');
}
const DIMENSION_PREFIX_TOKENS = new Set(['d', 'dim', 'dimension']);
const DIMENSION_SUFFIX_TOKENS = new Set(['dim', 'dimension', 'lookup', 'shared']);
const KEY_SUFFIX_TOKENS = new Set(['key', 'id', 'code']);
function normalizeKeyStem(name) {
    const tokens = nameTokens(name);
    while (tokens.length > 1 && KEY_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
        tokens.pop();
    }
    const normalized = tokens.join('');
    return normalized.length > 0 ? normalized : undefined;
}
function singularizeToken(token) {
    return token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token;
}
function buildSharedDimensionDax(leftTable, rightTable, axis) {
    const leftTableRef = quoteDaxTableName(leftTable);
    const rightTableRef = quoteDaxTableName(rightTable);
    const axisAlias = quoteDaxString(axis);
    const columnRef = quoteDaxColumnName(axis);
    return [
        'DISTINCT(',
        '  UNION(',
        `    SELECTCOLUMNS(${leftTableRef}, ${axisAlias}, ${leftTableRef}${columnRef}),`,
        `    SELECTCOLUMNS(${rightTableRef}, ${axisAlias}, ${rightTableRef}${columnRef})`,
        '  )',
        ')',
    ].join('\n');
}
function quoteDaxTableName(name) {
    return `'${name.replace(/'/g, "''")}'`;
}
function quoteDaxColumnName(name) {
    return `[${name.replace(/\]/g, ']]')}]`;
}
function quoteDaxString(value) {
    return `"${value.replace(/"/g, '""')}"`;
}
function buildWritePlan(model, leftTable, rightTable, axis, dimensionTableName, dimensionKeyColumn, daxExpression) {
    const out = [];
    const blockers = [];
    if (daxExpression !== undefined) {
        out.push({
            action: 'create-calculated-table',
            tableName: dimensionTableName,
            expression: daxExpression,
            description: `Create calculated table "${dimensionTableName}" from the distinct "${axis}" values in both source tables.`,
        });
    }
    out.push({
        action: 'configure-dimension-key',
        tableName: dimensionTableName,
        columnName: dimensionKeyColumn.name,
        summarizeBy: 'none',
        isKey: true,
        description: `Mark ${dimensionTableName}[${dimensionKeyColumn.name}] as the dimension key and disable implicit summarization.`,
    });
    const relationships = [
        sharedDimensionRelationship(leftTable, axis, dimensionTableName, dimensionKeyColumn.name),
        sharedDimensionRelationship(rightTable, axis, dimensionTableName, dimensionKeyColumn.name),
    ];
    const missingRelationships = [];
    const repairRelationships = [];
    let gateModel = modelWithPlannedDimension(model, dimensionTableName, dimensionKeyColumn);
    for (const relationship of relationships) {
        if (relationshipAlreadyExists(gateModel.relationships, relationship))
            continue;
        const existing = findRelationshipWithSameEndpoints(model.relationships, relationship);
        if (existing) {
            const reason = relationshipRepairReason(existing, relationship);
            if (!reason)
                continue;
            if (!isExecutableRepairReason(reason)) {
                blockers.push(relationshipRepairUnsupportedBlocker(axis, existing, relationship, reason));
                continue;
            }
            const repair = {
                ...relationship,
                id: existing.id,
                reason,
            };
            const blocked = relationshipWriteBlocker('repair-relationship', axis, gateModel, repair);
            if (blocked) {
                blockers.push(blocked);
                continue;
            }
            repairRelationships.push(repair);
            gateModel = modelWithGateRelationship(gateModel, repair, existing.id);
            continue;
        }
        const blocked = relationshipWriteBlocker('create-relationship', axis, gateModel, relationship);
        if (blocked) {
            blockers.push(blocked);
            continue;
        }
        missingRelationships.push(relationship);
        gateModel = modelWithGateRelationship(gateModel, relationship);
    }
    if (missingRelationships.length > 0) {
        out.push({
            action: 'create-relationships',
            relationships: missingRelationships,
            description: `Create single-direction many-to-one relationships from each source table to "${dimensionTableName}".`,
        });
    }
    if (repairRelationships.length > 0) {
        out.push({
            action: 'repair-relationships',
            relationships: repairRelationships,
            description: `Repair existing relationships so each source table filters through "${dimensionTableName}" as active, single-direction, many-to-one edges.`,
        });
    }
    out.push({
        action: 'hide-source-columns',
        columns: [
            { table: leftTable, column: axis },
            { table: rightTable, column: axis },
        ],
        description: `Hide the source "${axis}" columns after relationships to "${dimensionTableName}" are in place.`,
    });
    if (blockers.length > 0)
        return { writePlan: [], blockers };
    return { writePlan: out, blockers };
}
function relationshipAlreadyExists(relationships, planned) {
    return relationships.some((existing) => relationshipSatisfiesPlan(existing, planned));
}
function findRelationshipWithSameEndpoints(relationships, planned) {
    return relationships.find((existing) => (existing.fromTable === planned.fromTable &&
        existing.fromColumn === planned.fromColumn &&
        existing.toTable === planned.toTable &&
        existing.toColumn === planned.toColumn) ||
        (existing.fromTable === planned.toTable &&
            existing.fromColumn === planned.toColumn &&
            existing.toTable === planned.fromTable &&
            existing.toColumn === planned.fromColumn));
}
function relationshipRepairReason(existing, planned) {
    if (existing.identityProven !== true)
        return 'relationship-id-missing';
    const exact = existing.fromTable === planned.fromTable &&
        existing.fromColumn === planned.fromColumn &&
        existing.toTable === planned.toTable &&
        existing.toColumn === planned.toColumn;
    if (exact) {
        if (existing.cardinality !== 'manyToOne') {
            return 'wrong-cardinality';
        }
        if (!existing.isActive)
            return 'inactive';
        if (existing.crossFilteringBehavior !== 'single')
            return 'bidirectional';
        return undefined;
    }
    const reversed = existing.fromTable === planned.toTable &&
        existing.fromColumn === planned.toColumn &&
        existing.toTable === planned.fromTable &&
        existing.toColumn === planned.fromColumn;
    if (reversed) {
        if (existing.cardinality !== 'oneToMany') {
            return 'wrong-cardinality';
        }
        return 'wrong-direction';
    }
    return undefined;
}
function isExecutableRepairReason(reason) {
    return reason === 'inactive' || reason === 'bidirectional';
}
function safeRelationshipCoverage(relationships, dimensionTable, axis, dimensionKeyColumn, sourceTables) {
    let coverage = 0;
    for (const sourceTable of sourceTables) {
        const planned = sharedDimensionRelationship(sourceTable, axis, dimensionTable, dimensionKeyColumn);
        if (relationshipAlreadyExists(relationships, planned)) {
            coverage += 1;
            continue;
        }
        const existing = findRelationshipWithSameEndpoints(relationships, planned);
        const reason = existing ? relationshipRepairReason(existing, planned) : undefined;
        if (isExecutableRepairReason(reason)) {
            coverage += 1;
        }
    }
    return coverage;
}
function unsupportedRelationshipRepairBlockers(relationships, axis, leftTable, rightTable, dimensionTableName, dimensionKeyColumn) {
    const blockers = [];
    for (const sourceTable of [leftTable, rightTable]) {
        const planned = sharedDimensionRelationship(sourceTable, axis, dimensionTableName, dimensionKeyColumn);
        if (relationshipAlreadyExists(relationships, planned))
            continue;
        const existing = findRelationshipWithSameEndpoints(relationships, planned);
        if (!existing)
            continue;
        const reason = relationshipRepairReason(existing, planned);
        if (!reason || isExecutableRepairReason(reason))
            continue;
        blockers.push(relationshipRepairUnsupportedBlocker(axis, existing, planned, reason));
    }
    return blockers;
}
function relationshipRepairUnsupportedBlocker(axis, existing, planned, reason) {
    const fix = reason === 'wrong-direction'
        ? 'Delete/recreate it with the planned many-side and one-side endpoints; the current MCP update path cannot safely repair relationship orientation/cardinality.'
        : reason === 'relationship-id-missing'
            ? 'Refresh relationship metadata or target the relationship by a proven model identity before attempting an automatic repair.'
            : 'Delete/recreate it as many-to-one, single-direction, active.';
    return {
        code: 'relationship-repair-unsupported',
        axis,
        relationshipId: existing.id,
        reason,
        fromTable: planned.fromTable,
        fromColumn: planned.fromColumn,
        toTable: planned.toTable,
        toColumn: planned.toColumn,
        message: `Relationship "${existing.id}" already connects ${planned.fromTable}[${planned.fromColumn}] to ${planned.toTable}[${planned.toColumn}] but is not safe for an automatic repair. ${fix}`,
    };
}
function relationshipWriteBlocker(action, axis, model, relationship) {
    const check = relationshipCheck(relationship, model, {
        ...('id' in relationship ? { ignoreRelationshipId: relationship.id } : {}),
    });
    if (check.valid)
        return undefined;
    return {
        code: 'relationship-write-blocked',
        action,
        axis,
        ...('id' in relationship ? { relationshipId: relationship.id } : {}),
        fromTable: relationship.fromTable,
        fromColumn: relationship.fromColumn,
        toTable: relationship.toTable,
        toColumn: relationship.toColumn,
        blocking: check.blocking,
        message: `Relationship ${relationship.fromTable}[${relationship.fromColumn}] → ${relationship.toTable}[${relationship.toColumn}] is blocked by the relationship pre-write gate.`,
    };
}
function modelWithPlannedDimension(model, dimensionTableName, dimensionColumn) {
    if (model.tables.some((table) => table.name === dimensionTableName))
        return model;
    return {
        ...model,
        tables: [
            ...model.tables,
            {
                name: dimensionTableName,
                columns: [
                    {
                        ...dimensionColumn,
                        table: dimensionTableName,
                        name: dimensionColumn.name,
                        summarizeBy: 'none',
                        isHidden: false,
                        isKey: true,
                        isCalculated: false,
                    },
                ],
                measures: [],
                isHidden: false,
                isCalculated: true,
                isAutoDateTable: false,
            },
        ],
    };
}
function modelWithGateRelationship(model, relationship, replaceRelationshipId) {
    const id = replaceRelationshipId ??
        `__planned__:${relationship.fromTable}[${relationship.fromColumn}]->${relationship.toTable}[${relationship.toColumn}]`;
    return {
        ...model,
        relationships: [
            ...model.relationships.filter((existing) => existing.id !== replaceRelationshipId),
            {
                id,
                fromTable: relationship.fromTable,
                fromColumn: relationship.fromColumn,
                toTable: relationship.toTable,
                toColumn: relationship.toColumn,
                isActive: relationship.isActive,
                crossFilteringBehavior: relationship.crossFilteringBehavior,
                cardinality: relationship.cardinality,
            },
        ],
    };
}
function relationshipSatisfiesPlan(existing, planned) {
    if (!existing.isActive || existing.crossFilteringBehavior !== 'single')
        return false;
    const exact = existing.fromTable === planned.fromTable &&
        existing.fromColumn === planned.fromColumn &&
        existing.toTable === planned.toTable &&
        existing.toColumn === planned.toColumn;
    if (exact)
        return existing.cardinality === 'manyToOne';
    return false;
}
function sharedDimensionRelationship(sourceTable, axis, dimensionTableName, dimensionKeyColumn) {
    return {
        fromTable: sourceTable,
        fromColumn: axis,
        toTable: dimensionTableName,
        toColumn: dimensionKeyColumn,
        cardinality: 'manyToOne',
        crossFilteringBehavior: 'single',
        isActive: true,
    };
}
//# sourceMappingURL=star-schema-plan.js.map