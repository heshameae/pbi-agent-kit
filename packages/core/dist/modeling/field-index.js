import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { isNumericType } from './data-types.js';
import { parseTMDLFolder } from './tmdl-parser.js';
export function buildModelFieldIndex(modelPath) {
    return buildModelFieldIndexFromModel(parseTMDLFolder(modelPath));
}
export function buildModelFieldIndexFromModel(model) {
    const tables = {};
    for (const table of model.tables) {
        const columns = {};
        const measures = {};
        for (const column of table.columns) {
            columns[column.name] = columnField(column);
        }
        for (const measure of table.measures) {
            measures[measure.name] = measureField(measure);
        }
        tables[table.name] = {
            name: table.name,
            isHidden: table.isHidden,
            isCalculated: table.isCalculated,
            isAutoDateTable: table.isAutoDateTable,
            columns,
            measures,
        };
    }
    const relationshipGraph = buildRelationshipGraph(model.relationships);
    const indexWithoutBridges = {
        modelPath: model.modelPath,
        modelFingerprint: fingerprintDefinitionFolder(model.modelPath),
        model,
        tables,
        relationships: model.relationships,
        relationshipGraph,
    };
    return {
        ...indexWithoutBridges,
        treatasBridgeMeasures: buildTreatasBridgeMeasures(indexWithoutBridges),
    };
}
export function findModelField(index, tableName, fieldName) {
    const table = index.tables[tableName];
    if (!table)
        return null;
    return table.measures[fieldName] ?? table.columns[fieldName] ?? null;
}
export function findColumn(index, tableName, columnName) {
    return index.tables[tableName]?.columns[columnName] ?? null;
}
export function findMeasure(index, tableName, measureName) {
    return index.tables[tableName]?.measures[measureName] ?? null;
}
export function hasActiveRelationshipPath(index, fromTable, toTable) {
    return hasDirectedFilterPath(index, fromTable, toTable);
}
export function hasDirectedFilterPath(index, filterTable, targetTable) {
    if (filterTable === targetTable)
        return true;
    if (!index.tables[filterTable] || !index.tables[targetTable])
        return false;
    const visited = new Set();
    const queue = [filterTable];
    while (queue.length > 0) {
        const table = queue.shift();
        if (table === undefined)
            break;
        if (table === targetTable)
            return true;
        if (visited.has(table))
            continue;
        visited.add(table);
        for (const link of outgoingFilterLinks(index, table)) {
            if (!visited.has(link))
                queue.push(link);
        }
    }
    return false;
}
export function hasUndirectedRelationshipPath(index, fromTable, toTable) {
    if (fromTable === toTable)
        return true;
    if (!index.tables[fromTable] || !index.tables[toTable])
        return false;
    const visited = new Set();
    const queue = [fromTable];
    while (queue.length > 0) {
        const table = queue.shift();
        if (table === undefined)
            break;
        if (table === toTable)
            return true;
        if (visited.has(table))
            continue;
        visited.add(table);
        for (const link of index.relationshipGraph[table] ?? []) {
            if (!link.isActive)
                continue;
            const next = link.fromTable === table ? link.toTable : link.fromTable;
            if (!visited.has(next))
                queue.push(next);
        }
    }
    return false;
}
export function isSummarizableColumn(column) {
    // A numeric column with an EXPLICIT non-none summarizeBy is a measure-like quantity
    // (excluded from blockedAxes/axis candidates). Kept conservative (explicit only) so an
    // undefined-summarizeBy numeric stays an axis candidate — matching the fact-classifier
    // and grain definitions. (Axis-side measure-like detection lives in star-schema-plan.)
    return (column.summarizeBy !== undefined &&
        column.summarizeBy.toLowerCase() !== 'none' &&
        isNumericType(column.dataType));
}
export function defaultAggregationForColumn(column) {
    const summarizeBy = column.summarizeBy?.toLowerCase();
    if (summarizeBy === 'sum')
        return 'sum';
    if (summarizeBy === 'average')
        return 'avg';
    if (summarizeBy === 'count')
        return 'count';
    if (summarizeBy === 'min')
        return 'min';
    if (summarizeBy === 'max')
        return 'max';
    return null;
}
function columnField(column) {
    return {
        kind: 'column',
        table: column.table,
        name: column.name,
        dataType: column.dataType,
        summarizeBy: column.summarizeBy,
        isHidden: column.isHidden,
        isKey: column.isKey,
    };
}
function measureField(measure) {
    return {
        kind: 'measure',
        table: measure.table,
        name: measure.name,
        expression: measure.expression,
        formatString: measure.formatString,
        isHidden: measure.isHidden,
        description: measure.description,
        annotations: measure.annotations,
    };
}
function buildRelationshipGraph(relationships) {
    const graph = {};
    for (const relationship of relationships) {
        const link = {
            relationshipId: relationship.id,
            fromTable: relationship.fromTable,
            fromColumn: relationship.fromColumn,
            toTable: relationship.toTable,
            toColumn: relationship.toColumn,
            isActive: relationship.isActive,
            crossFilteringBehavior: relationship.crossFilteringBehavior,
        };
        const fromLinks = graph[relationship.fromTable] ?? [];
        fromLinks.push(link);
        graph[relationship.fromTable] = fromLinks;
        const toLinks = graph[relationship.toTable] ?? [];
        toLinks.push(link);
        graph[relationship.toTable] = toLinks;
    }
    return graph;
}
function buildTreatasBridgeMeasures(index) {
    const out = {};
    for (const table of Object.values(index.tables)) {
        for (const measure of Object.values(table.measures)) {
            const pairs = parseTreatasPairs(measure.expression);
            if (pairs.length === 0)
                continue;
            const first = pairs[0];
            if (!first)
                continue;
            const fromTable = first.fromTable;
            const toTable = first.toTable;
            const sameBridgePairs = pairs.filter((pair) => pair.fromTable === fromTable && pair.toTable === toTable);
            const coveredAxes = unique(sameBridgePairs.map((pair) => pair.fromColumn));
            const from = index.tables[fromTable];
            if (!from)
                continue;
            const blockedAxes = Object.values(from.columns)
                .filter((column) => !column.isHidden && !isSummarizableColumn(column))
                .map((column) => column.name)
                .filter((name) => !coveredAxes.includes(name));
            out[`${measure.table}[${measure.name}]`] = {
                measure,
                fromTable,
                toTable,
                fromTables: [fromTable],
                toTables: [toTable],
                coveredAxes,
                blockedAxes,
            };
        }
    }
    propagateBridgeMeasureScopes(index, out);
    return out;
}
function propagateBridgeMeasureScopes(index, bridges) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const table of Object.values(index.tables)) {
            for (const measure of Object.values(table.measures)) {
                const key = `${measure.table}[${measure.name}]`;
                if (bridges[key])
                    continue;
                const inherited = measureDependencies(index, measure)
                    .map((dep) => bridges[dep])
                    .filter((bridge) => bridge !== undefined);
                if (inherited.length === 0)
                    continue;
                const first = inherited[0];
                if (!first)
                    continue;
                bridges[key] = {
                    measure,
                    fromTable: first.fromTable,
                    toTable: first.toTable,
                    fromTables: unique(inherited.flatMap((bridge) => bridge.fromTables)),
                    toTables: unique(inherited.flatMap((bridge) => bridge.toTables)),
                    coveredAxes: intersection(inherited.map((bridge) => bridge.coveredAxes)),
                    blockedAxes: unique(inherited.flatMap((bridge) => bridge.blockedAxes)),
                };
                changed = true;
            }
        }
    }
}
function parseTreatasPairs(expression) {
    const pairs = [];
    const re = /TREATAS\s*\(\s*VALUES\s*\(\s*('([^']+)'|([A-Za-z_][\w .-]*))\[([^\]]+)\]\s*\)\s*,\s*('([^']+)'|([A-Za-z_][\w .-]*))\[([^\]]+)\]\s*\)/gi;
    for (const match of expression.matchAll(re)) {
        const fromTable = match[2] ?? match[3];
        const fromColumn = match[4];
        const toTable = match[6] ?? match[7];
        const toColumn = match[8];
        if (!fromTable || !fromColumn || !toTable || !toColumn)
            continue;
        pairs.push({ fromTable, fromColumn, toTable, toColumn });
    }
    return pairs;
}
function unique(values) {
    return [...new Set(values)];
}
function intersection(groups) {
    const [first, ...rest] = groups;
    if (!first)
        return [];
    return first.filter((value) => rest.every((group) => group.includes(value)));
}
function outgoingFilterLinks(index, table) {
    const out = [];
    for (const link of index.relationshipGraph[table] ?? []) {
        if (!link.isActive)
            continue;
        if (link.crossFilteringBehavior === 'both') {
            out.push(link.fromTable === table ? link.toTable : link.fromTable);
            continue;
        }
        // For relationships created as fact[from FK] -> dim[to key], single
        // direction means filters flow from the dimension side to the fact side.
        if (link.toTable === table)
            out.push(link.fromTable);
    }
    return out;
}
export function directedFilterEdges(index) {
    return directedFilterEdgesFromRelationships(index.relationships);
}
// Edge computation that depends ONLY on the relationship list, so callers that
// have no built index (the pre-write gate, MOD017) avoid the on-disk fingerprint
// that buildModelFieldIndexFromModel performs.
export function directedFilterEdgesFromRelationships(relationships) {
    const edges = [];
    for (const r of relationships) {
        if (!r.isActive)
            continue;
        // Single direction: filters flow from the to-side (dim key) to the
        // from-side (fact FK), matching outgoingFilterLinks.
        edges.push({ from: r.toTable, to: r.fromTable, relationshipId: r.id });
        if (r.crossFilteringBehavior === 'both') {
            edges.push({ from: r.fromTable, to: r.toTable, relationshipId: r.id });
        }
    }
    return edges;
}
// Greedily count edge-disjoint directed paths from src to dst: find a path via
// BFS, delete its edges, repeat. Returns each path as its ordered list of tables
// (so callers can compare intermediates). Shared by MOD017 (diamond audit) and
// the diamond pre-write gate so both reason over the SAME detector — lives here
// (not bpa.ts) because relationship-check.ts must import it WITHOUT creating a
// cycle (bpa.ts imports typesCompatible from relationship-check.ts).
export function edgeDisjointDirectedPaths(edges, src, dst) {
    // Mutable working copy keyed by from-table; each entry carries a unique edge id.
    let pool = edges.map((e, i) => ({ from: e.from, to: e.to, eid: `${e.relationshipId}#${i}` }));
    const paths = [];
    // Cap iterations defensively (a model can't have unbounded disjoint paths).
    for (let guard = 0; guard < 64; guard++) {
        const adj = new Map();
        for (const e of pool) {
            const list = adj.get(e.from) ?? [];
            list.push({ to: e.to, eid: e.eid });
            adj.set(e.from, list);
        }
        // BFS recording the edge taken to reach each node.
        const prev = new Map();
        const visited = new Set([src]);
        const queue = [src];
        let found = false;
        while (queue.length > 0) {
            const node = queue.shift();
            if (node === undefined)
                break;
            if (node === dst) {
                found = true;
                break;
            }
            for (const next of adj.get(node) ?? []) {
                if (visited.has(next.to))
                    continue;
                visited.add(next.to);
                prev.set(next.to, { node, eid: next.eid });
                queue.push(next.to);
            }
        }
        if (!found)
            break;
        // Reconstruct the path and the edges it used.
        const pathNodes = [dst];
        const usedEids = new Set();
        let cur = dst;
        while (cur !== src) {
            const step = prev.get(cur);
            if (!step)
                break;
            usedEids.add(step.eid);
            pathNodes.push(step.node);
            cur = step.node;
        }
        pathNodes.reverse();
        paths.push(pathNodes);
        // Remove the consumed edges and look for another disjoint path.
        pool = pool.filter((e) => !usedEids.has(e.eid));
    }
    return paths;
}
// At least two of the found paths differ by ≥1 INTERMEDIATE table (so the
// same-pair length-1-vs-length-1 case is left to ambiguous-active-path, and a
// single dim fanning to two facts — two length-1 paths — is not a diamond).
export function pathsDifferByIntermediate(paths) {
    const signatures = paths.map((p) => p.slice(1, -1).join('>')); // intermediates only
    for (let i = 0; i < signatures.length; i++) {
        for (let j = i + 1; j < signatures.length; j++) {
            const a = signatures[i];
            const b = signatures[j];
            // A diamond needs at least one route WITH an intermediate, and the two
            // routes' intermediate signatures must differ.
            if (a !== b && (a !== '' || b !== ''))
                return true;
        }
    }
    return false;
}
function measureDependencies(index, measure) {
    const deps = new Set();
    const expression = measure.expression;
    const qualifiedRe = /('([^']+)'|([A-Za-z_][\w .-]*))\[([^\]]+)\]/g;
    let expressionWithoutQualifiedRefs = expression;
    for (const match of expression.matchAll(qualifiedRe)) {
        const table = match[2] ?? match[3];
        const name = match[4];
        if (!table || !name)
            continue;
        if (index.tables[table]?.measures[name])
            deps.add(`${table}[${name}]`);
        expressionWithoutQualifiedRefs = expressionWithoutQualifiedRefs.replace(match[0], ' ');
    }
    const measureNameCounts = measureNameCountsByName(index);
    for (const match of expressionWithoutQualifiedRefs.matchAll(/\[([^\]]+)\]/g)) {
        const name = match[1];
        if (!name)
            continue;
        const sameTable = index.tables[measure.table]?.measures[name];
        if (sameTable) {
            deps.add(`${measure.table}[${name}]`);
            continue;
        }
        if (measureNameCounts.get(name) !== 1)
            continue;
        for (const table of Object.values(index.tables)) {
            if (table.measures[name])
                deps.add(`${table.name}[${name}]`);
        }
    }
    deps.delete(`${measure.table}[${measure.name}]`);
    return [...deps];
}
function measureNameCountsByName(index) {
    const counts = new Map();
    for (const table of Object.values(index.tables)) {
        for (const measure of Object.values(table.measures)) {
            counts.set(measure.name, (counts.get(measure.name) ?? 0) + 1);
        }
    }
    return counts;
}
function fingerprintDefinitionFolder(definitionPath) {
    if (!existsSync(definitionPath))
        return 'missing';
    let fileCount = 0;
    let totalSize = 0;
    let latestMtime = 0;
    for (const file of listTmdlFiles(definitionPath)) {
        const stat = statSync(file);
        fileCount++;
        totalSize += stat.size;
        latestMtime = Math.max(latestMtime, stat.mtimeMs);
    }
    return `${fileCount}:${totalSize}:${Math.round(latestMtime)}`;
}
function listTmdlFiles(root) {
    const out = [];
    if (!existsSync(root))
        return out;
    for (const entry of readdirSync(root)) {
        const full = path.join(root, entry);
        if (statSync(full).isDirectory()) {
            out.push(...listTmdlFiles(full));
        }
        else if (entry.endsWith('.tmdl')) {
            out.push(full);
        }
    }
    return out;
}
//# sourceMappingURL=field-index.js.map