// Drives the wrapped Microsoft modeling MCP: connection, reads, measure writes.
//
// Connection auto-detects: env-pinned connection string → single live Desktop
// instance (ListLocalInstances + Connect) → folder fallback (ConnectFolder).
// Reads are assembled into pbi-core's TMDLModel shape so every existing
// validator (daxReferenceCheck, model_check, BPA, grain) works identically
// for a live model or a folder.
//
// NOTE: the Microsoft MCP's response shapes are not officially pinned. The
// extraction helpers below are deliberately tolerant; log a raw payload once
// against a live Desktop (Parallels) and tighten `pickArray` / key lists.
var _a;
import path from 'node:path';
// Raw Microsoft-MCP tool names (called directly — no `mcp__` peer prefix,
// because we spawn the server ourselves).
export const MS_TOOLS = {
    connection: 'connection_operations',
    tables: 'table_operations',
    columns: 'column_operations',
    measures: 'measure_operations',
    relationships: 'relationship_operations',
    dax: 'dax_query_operations',
    model: 'model_operations',
    database: 'database_operations',
    // The roles read is wrapped in try/catch so an unsupported op degrades to no
    // `roles` key (getModelSnapshot never breaks).
    roles: 'security_role_operations',
};
// A dropped bridge subprocess / closed transport / freshly re-spawned but
// not-yet-connected MS MCP all surface as one of these. The "connect to a
// server first" / "no last used connection" forms come from the MS MCP itself
// when the subprocess re-spawned and lost its model connection.
export function isConnectionDrop(err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return /closed|transport|epipe|econn|not connected|disconnect|reachab|broken pipe|spawn|connect to a server first|no last used connection|no connectionname/.test(msg);
}
// Deterministic failures from the MS MCP validating the request itself (bad
// args, already-exists, not-found). Retrying these just burns another request
// timeout for the same guaranteed failure — never retry them.
export function isNonRetryable(err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return /missing required parameter|invalid (argument|parameter|operation)|already exists|not found|bad request|validation/.test(msg);
}
// Build the Microsoft-MCP request envelope: { request: { operation, ...params } };
// `List` puts its params under `request.filter` (reference repo behavior).
export function operationArgs(operation, params) {
    const isList = operation.toLowerCase() === 'list';
    const body = params && Object.keys(params).length > 0 ? (isList ? { filter: params } : params) : {};
    return { request: { operation, ...body } };
}
// Map our friendly `expression` to the MS MCP source key `daxExpression` for a
// DAX-defined table/column. Confirmed by the live MS MCP, which rejects a create
// with no source as: "One of DaxExpression, MExpression, EntityName, or SqlQuery
// must be provided" — i.e. `expression` is NOT a recognized key; `daxExpression`
// is (mirroring the already-working `mExpression`). A data column/M table carries
// `sourceColumn`/`mExpression` instead and is left untouched.
export function toDaxSource(def) {
    const { expression, ...rest } = def;
    return expression === undefined ? rest : { ...rest, daxExpression: expression };
}
// Mask connection-string secrets before they surface in errors/logs.
export function redactConnectionSecrets(text) {
    return text
        .replace(/(Password|Pwd)\s*=\s*[^;]*/gi, '$1=***')
        .replace(/Data Source\s*=\s*[^;]*/gi, 'Data Source=***');
}
function parseResult(result) {
    if (result.structuredContent !== undefined && result.structuredContent !== null) {
        return result.structuredContent;
    }
    return parseTextPayloads(result)[0]?.payload;
}
function parseTextPayloads(result) {
    return (result.content ?? [])
        .map((content, index) => {
        if (content.type !== 'text' || !content.text)
            return undefined;
        return { source: `content[${index}].text`, payload: parseTextPayload(content.text) };
    })
        .filter((payload) => payload !== undefined);
}
function parseTextPayload(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function parseDaxContentPayloads(result) {
    return (result.content ?? []).flatMap((content, index) => {
        if (content.type === 'text' && content.text) {
            return [{ source: `content[${index}].text`, payload: parseTextPayload(content.text) }];
        }
        if (content.type === 'resource' && content.resource?.mimeType === 'text/csv') {
            const payload = parseDaxCsvResource(content.resource.text ?? '', content.resource.uri);
            return payload ? [{ source: `content[${index}].resource`, payload }] : [];
        }
        return [];
    });
}
// DAX result shapes differ by host. The local @microsoft/powerbi-modeling-mcp
// returns columnar tables (verified against PowerBIModelingMCP.Library.dll):
//   { success, operation, message, data: { columns: [{ name, dataType }],
//     rows: [[v0, v1, ...]], rowCount, wasTruncated, truncationReason, filePath } }
// and some builds wrap those same columnar tables under result/table containers.
// The beta.2 Windows MCP returns {success:true} as text and the actual DAX
// table as a sibling text/csv resource.
// The public Execute-Queries REST shape is instead { results: [{ tables: [{
// rows: [{ "[Col]": v }] }] }] } (array-of-objects). Normalize local columnar
// tables into rows keyed by column name so pbi_dax_query callers and the
// date/relationship probe parsers all see one shape — and surface engine errors
// that this MCP returns WITHOUT setting isError (success:false envelope or
// non-tabular text), instead of silently yielding zero rows that read as "no
// data".
export function normalizeDaxResult(payload) {
    if (typeof payload === 'string') {
        // parseResult only returns a raw string when the content text was not JSON.
        // A DAX result is always JSON, so this is an error/Markdown render, not data.
        throw new Error(redactConnectionSecrets(`DAX query did not return a tabular JSON result: ${payload.slice(0, 400)}`));
    }
    if (!isRecord(payload))
        return payload;
    if (payload.success === false) {
        const message = str(payload, 'message', 'error', 'detail') ?? 'DAX query failed';
        throw new Error(redactConnectionSecrets(`DAX query failed: ${message}`));
    }
    const body = isRecord(payload.data) ? payload.data : payload;
    const direct = normalizeDaxColumnarRecord(body);
    if (direct)
        return direct;
    const nested = collectDaxColumnarTables(body);
    if (nested.length > 0)
        return mergeDaxColumnarTables(nested);
    // REST { results/tables } shape, an already-keyed { rows: [{}] }, or any other
    // object — leave it untouched; extractRows / pickArray handle those.
    return payload;
}
const DAX_RAW_SHAPE_NODE_LIMIT = 24;
const DAX_RAW_SHAPE_DEPTH_LIMIT = 6;
const DAX_RAW_SHAPE_KEY_LIMIT = 16;
function attachDaxRawDiagnostics(normalized, rawPayload, source) {
    if (!isRecord(normalized))
        return normalized;
    if (normalized.wasTruncated === true)
        return normalized;
    const rowCount = typeof normalized.rowCount === 'number' ? normalized.rowCount : 0;
    if (rowCount > 0 || daxPayloadHasRows(normalized))
        return normalized;
    return { ...normalized, rawDiagnostics: { source, ...summarizeDaxPayloadShape(rawPayload) } };
}
function daxPayloadHasRows(payload, depth = 0) {
    if (depth > DAX_RAW_SHAPE_DEPTH_LIMIT)
        return false;
    if (Array.isArray(payload)) {
        return payload.some((item) => daxPayloadHasRows(item, depth + 1));
    }
    if (!isRecord(payload))
        return false;
    if (Array.isArray(payload.rows) && payload.rows.length > 0)
        return true;
    return Object.values(payload).some((value) => daxPayloadHasRows(value, depth + 1));
}
function summarizeDaxPayloadShape(payload) {
    const shape = {};
    collectDaxPayloadShape(payload, '$', 0, shape);
    return {
        payloadType: daxShapeType(payload),
        ...(isRecord(payload) ? { topLevelKeys: boundedKeys(payload) } : {}),
        shape,
    };
}
function collectDaxPayloadShape(value, pathName, depth, out) {
    if (depth > DAX_RAW_SHAPE_DEPTH_LIMIT || Object.keys(out).length >= DAX_RAW_SHAPE_NODE_LIMIT) {
        return;
    }
    const nodeId = `node${Object.keys(out).length}`;
    if (Array.isArray(value)) {
        out[nodeId] = {
            path: pathName,
            type: 'array',
            length: value.length,
            ...(value.length > 0 ? { firstType: daxShapeType(value[0]) } : {}),
            ...(isRecord(value[0]) ? { firstKeys: boundedKeys(value[0]) } : {}),
            ...(Array.isArray(value[0]) ? { firstLength: value[0].length } : {}),
        };
        if (value.length > 0)
            collectDaxPayloadShape(value[0], `${pathName}[0]`, depth + 1, out);
        return;
    }
    if (!isRecord(value)) {
        out[nodeId] = { path: pathName, type: daxShapeType(value) };
        return;
    }
    const keys = boundedKeys(value);
    out[nodeId] = { path: pathName, type: 'object', keys };
    const priority = ['data', 'results', 'tables', 'rows', 'columns', 'value', 'values', 'content'];
    const orderedKeys = [
        ...priority.filter((key) => key in value),
        ...keys.filter((key) => !priority.includes(key)),
    ];
    for (const key of orderedKeys) {
        if (Object.keys(out).length >= DAX_RAW_SHAPE_NODE_LIMIT)
            break;
        collectDaxPayloadShape(value[key], `${pathName}.${key}`, depth + 1, out);
    }
}
function boundedKeys(record) {
    return Object.keys(record).slice(0, DAX_RAW_SHAPE_KEY_LIMIT);
}
function daxShapeType(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'array';
    return typeof value;
}
function parseDaxToolResult(result) {
    const hasStructured = result.structuredContent !== undefined && result.structuredContent !== null;
    const structured = result.structuredContent;
    if (hasStructured && !isDaxSuccessEnvelopeWithoutResultData(structured)) {
        return { payload: structured, source: 'structuredContent' };
    }
    const textPayloads = expandDaxTextPayloads(parseDaxContentPayloads(result));
    const textCandidate = textPayloads.find((candidate) => isDaxFailureEnvelope(candidate.payload)) ??
        textPayloads.find((candidate) => hasDaxResultShape(candidate.payload)) ??
        textPayloads.find((candidate) => typeof candidate.payload === 'string');
    if (textCandidate)
        return textCandidate;
    if (hasStructured)
        return { payload: structured, source: 'structuredContent' };
    return textPayloads[0] ?? { payload: undefined, source: 'none' };
}
function expandDaxTextPayloads(payloads) {
    const expanded = [];
    for (const payload of payloads) {
        expanded.push(payload);
        collectEmbeddedTextPayloads(payload.payload, payload.source, 0, expanded);
    }
    return expanded;
}
function collectEmbeddedTextPayloads(value, source, depth, out) {
    if (depth > DAX_RAW_SHAPE_DEPTH_LIMIT)
        return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            collectEmbeddedTextPayloads(item, `${source}[${index}]`, depth + 1, out);
        });
        return;
    }
    if (!isRecord(value))
        return;
    for (const [key, child] of Object.entries(value)) {
        if (key === 'content' && Array.isArray(child)) {
            child.forEach((part, index) => {
                const partSource = `${source}.content[${index}]`;
                if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
                    const nestedSource = `${partSource}.text`;
                    const nestedPayload = parseTextPayload(part.text);
                    out.push({ source: nestedSource, payload: nestedPayload });
                    collectEmbeddedTextPayloads(nestedPayload, nestedSource, depth + 1, out);
                    return;
                }
                collectEmbeddedTextPayloads(part, partSource, depth + 1, out);
            });
            continue;
        }
        collectEmbeddedTextPayloads(child, `${source}.${key}`, depth + 1, out);
    }
}
function isDaxFailureEnvelope(value) {
    return isRecord(value) && value.success === false;
}
function isDaxSuccessEnvelopeWithoutResultData(value) {
    return isRecord(value) && value.success === true && !hasDaxResultShape(value);
}
function hasDaxResultShape(value, depth = 0) {
    if (depth > DAX_RAW_SHAPE_DEPTH_LIMIT)
        return false;
    if (Array.isArray(value)) {
        return value.some((item) => hasDaxResultShape(item, depth + 1));
    }
    if (!isRecord(value))
        return false;
    if (Array.isArray(value.rows) || Array.isArray(value.columns))
        return true;
    return Object.values(value).some((child) => hasDaxResultShape(child, depth + 1));
}
function parseDaxCsvResource(csv, uri) {
    const records = parseCsvRecords(csv);
    if (records.length === 0)
        return null;
    const columns = records[0] ?? [];
    if (columns.length === 0)
        return null;
    const rows = records.slice(1).filter((row) => !isEmptyCsvTrailingRow(row));
    return {
        columns,
        rows: rows.map((row) => zipDaxRow(columns, row)),
        rowCount: rows.length,
        ...(uri ? { filePath: uri } : {}),
    };
}
function parseCsvRecords(csv) {
    const records = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < csv.length; i += 1) {
        const char = csv[i];
        if (inQuotes) {
            if (char === '"' && csv[i + 1] === '"') {
                field += '"';
                i += 1;
            }
            else if (char === '"') {
                inQuotes = false;
            }
            else {
                field += char;
            }
            continue;
        }
        if (char === '"') {
            inQuotes = true;
        }
        else if (char === ',') {
            row.push(field);
            field = '';
        }
        else if (char === '\n' || char === '\r') {
            row.push(field);
            records.push(row);
            row = [];
            field = '';
            if (char === '\r' && csv[i + 1] === '\n')
                i += 1;
        }
        else {
            field += char;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        records.push(row);
    }
    return records;
}
function isEmptyCsvTrailingRow(row) {
    return row.length === 1 && row[0] === '';
}
function normalizeDaxColumnarRecord(record) {
    const columns = record.columns;
    const rows = record.rows;
    if (!Array.isArray(columns) || !Array.isArray(rows))
        return null;
    const names = columns.map(daxColumnName);
    // Zip positional (array) rows against the column schema; pass already-keyed
    // object rows through. Malformed primitive rows are a bridge/host bug, not
    // valid "empty data" evidence for downstream Date/relationship gates.
    const keyed = [];
    let malformedRows = 0;
    for (const row of rows) {
        if (Array.isArray(row)) {
            keyed.push(zipDaxRow(names, row));
        }
        else if (isRecord(row)) {
            keyed.push(row);
        }
        else {
            malformedRows += 1;
        }
    }
    if (malformedRows > 0) {
        throw new Error(`DAX query returned ${malformedRows} malformed tabular rows; refusing to treat them as empty data.`);
    }
    const rowCount = typeof record.rowCount === 'number' ? record.rowCount : keyed.length;
    return {
        columns: names,
        rows: keyed,
        rowCount,
        ...(record.wasTruncated === true ? { wasTruncated: true } : {}),
        ...(typeof record.truncationReason === 'string'
            ? { truncationReason: record.truncationReason }
            : {}),
        ...(typeof record.filePath === 'string' ? { filePath: record.filePath } : {}),
    };
}
function collectDaxColumnarTables(payload, depth = 0) {
    if (depth > 8)
        return [];
    if (Array.isArray(payload)) {
        return payload.flatMap((item) => collectDaxColumnarTables(item, depth + 1));
    }
    if (!isRecord(payload))
        return [];
    const table = normalizeDaxColumnarRecord(payload);
    if (table)
        return [table];
    return Object.values(payload).flatMap((value) => collectDaxColumnarTables(value, depth + 1));
}
function mergeDaxColumnarTables(tables) {
    const columns = [];
    const seen = new Set();
    const rows = [];
    let rowCount = 0;
    let wasTruncated = false;
    const truncationReasons = new Set();
    const filePaths = new Set();
    for (const table of tables) {
        for (const column of table.columns) {
            if (seen.has(column))
                continue;
            seen.add(column);
            columns.push(column);
        }
        rows.push(...table.rows);
        rowCount += table.rowCount;
        if (table.wasTruncated === true)
            wasTruncated = true;
        if (table.truncationReason)
            truncationReasons.add(table.truncationReason);
        if (table.filePath)
            filePaths.add(table.filePath);
    }
    return {
        columns,
        rows,
        rowCount,
        ...(wasTruncated ? { wasTruncated: true } : {}),
        ...(truncationReasons.size > 0 ? { truncationReason: [...truncationReasons].join('; ') } : {}),
        ...(filePaths.size === 1 ? { filePath: [...filePaths][0] } : {}),
    };
}
function daxColumnName(column) {
    if (typeof column === 'string')
        return column;
    if (isRecord(column)) {
        const name = str(column, 'name', 'columnName');
        if (name !== undefined)
            return name;
    }
    return '';
}
function zipDaxRow(names, values) {
    const keyed = {};
    for (let i = 0; i < names.length; i += 1) {
        keyed[names[i] || `__col${i}`] = values[i];
    }
    return keyed;
}
// Find the first array in a payload, checking common container keys then any
// array-valued property. Tolerant by design (shapes not pinned).
const ARRAY_KEYS = ['data', 'items', 'definitions', 'value', 'values', 'results', 'rows'];
export function pickArray(payload) {
    if (Array.isArray(payload))
        return payload;
    if (payload && typeof payload === 'object') {
        const obj = payload;
        for (const key of ARRAY_KEYS) {
            if (Array.isArray(obj[key]))
                return obj[key];
        }
        for (const v of Object.values(obj)) {
            if (Array.isArray(v))
                return v;
        }
    }
    return [];
}
// Deep-collect connection strings from a ListLocalInstances payload.
export function collectConnectionStrings(payload) {
    const found = [];
    const visit = (node) => {
        if (typeof node === 'string') {
            if (/data source\s*=/i.test(node))
                found.push(node);
            return;
        }
        if (Array.isArray(node)) {
            for (const item of node)
                visit(item);
            return;
        }
        if (node && typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) {
                if (typeof value === 'string' &&
                    /^(connectionstring|datasource|connection)$/i.test(key) &&
                    value.trim().length > 0) {
                    found.push(value);
                }
                else {
                    visit(value);
                }
            }
        }
    };
    visit(payload);
    return [...new Set(found)];
}
function str(obj, ...keys) {
    for (const key of keys) {
        const v = obj[key];
        if (typeof v === 'string' && v.length > 0)
            return v;
    }
    return undefined;
}
function num(obj, ...keys) {
    for (const key of keys) {
        const v = obj[key];
        if (typeof v === 'number' && Number.isFinite(v))
            return v;
    }
    return undefined;
}
// Parse a ListLocalInstances payload into structured per-instance records so
// callers can match an instance by name/database when several Desktops are open.
// Tolerant by design (the MS MCP shape is not pinned): reads connectionString
// then opportunistically lifts a friendly name / database / port. If no array
// records are found, synthesizes minimal instances from collectConnectionStrings.
export function extractLiveInstances(payload) {
    const out = [];
    for (const item of pickArray(payload)) {
        if (!isRecord(item))
            continue;
        const connectionString = str(item, 'connectionString', 'dataSource', 'connection');
        // Skip records that carry no usable connection string (no `Data Source=`).
        if (!connectionString || !/data source\s*=/i.test(connectionString))
            continue;
        out.push(buildInstance(connectionString, item));
    }
    // Fallback: payload had no parseable records — synthesize from raw strings.
    if (out.length === 0) {
        for (const cs of collectConnectionStrings(payload))
            out.push(buildInstance(cs));
    }
    return dedupeInstances(out);
}
function buildInstance(connectionString, rec) {
    const portFromCs = connectionString.match(/Data Source\s*=\s*[^:;]*:(\d+)/i)?.[1];
    const catFromCs = connectionString.match(/Initial Catalog\s*=\s*([^;]+)/i)?.[1]?.trim();
    // UNVERIFIED field keys: opportunistic friendly-name / database keys; harmless if absent.
    const name = rec ? str(rec, 'name', 'displayName', 'friendlyName', 'instanceName') : undefined;
    const databaseName = rec
        ? str(rec, 'databaseName', 'database', 'catalog', 'initialCatalog')
        : undefined;
    const port = (rec ? str(rec, 'port') : undefined) ?? portFromCs;
    const initialCatalog = catFromCs;
    return {
        connectionString,
        ...(port ? { port } : {}),
        ...(name ? { name } : {}),
        ...(databaseName ? { databaseName } : {}),
        ...(initialCatalog ? { initialCatalog } : {}),
    };
}
function dedupeInstances(instances) {
    const seen = new Set();
    const out = [];
    for (const inst of instances) {
        if (seen.has(inst.connectionString))
            continue;
        seen.add(inst.connectionString);
        out.push(inst);
    }
    return out;
}
// Normalize a model name / folder path to a comparable token so a `model` hint
// or a folderPath basename can be matched against an instance's name/database.
// Strips the .SemanticModel/definition wrapper and common file suffixes, then
// lowercases + trims. Dataset-agnostic: no embedded names.
export function normalizeModelName(s) {
    const portable = s.replace(/\\/g, '/');
    let base = path.basename(portable);
    // `/x/Model.SemanticModel/definition` → use the parent folder name.
    if (base.toLowerCase() === 'definition')
        base = path.basename(path.dirname(portable));
    for (const suffix of ['.SemanticModel', '.pbix', '.pbip', '.Dataset']) {
        if (base.toLowerCase().endsWith(suffix.toLowerCase())) {
            base = base.slice(0, base.length - suffix.length);
            break;
        }
    }
    return base.toLowerCase().trim();
}
function normalizedConnectionHint(opts) {
    const raw = opts?.model ?? opts?.folderPath;
    return raw ? normalizeModelName(raw) : null;
}
function normalizeFolderCachePath(folderPath) {
    return path.resolve(folderPath.replace(/\\/g, '/'));
}
function connectionRequestKey(opts) {
    const intent = opts?.forceFolder === true ? 'folder' : opts?.livePreferred === true ? 'live' : 'auto';
    const model = opts?.model ? normalizeModelName(opts.model) : '';
    const folder = opts?.folderPath ? normalizeFolderCachePath(opts.folderPath) : '';
    return `${intent}|model=${model}|folder=${folder}`;
}
function connectionCacheKey(connection) {
    if (!connection)
        return null;
    if (connection.mode === 'live') {
        return connection.connectionString ? `live|${connection.connectionString}` : null;
    }
    return connection.folderPath ? `folder|${normalizeFolderCachePath(connection.folderPath)}` : null;
}
function snapshotOptionsKey(options = {}) {
    return JSON.stringify({
        includeMeasures: options.includeMeasures !== false,
        includeRoles: options.includeRoles !== false,
    });
}
const MEASURE_NAME_FIELDS = ['name', 'measureName', 'id', 'displayName'];
const MEASURE_TABLE_FIELDS = [
    'tableName',
    'table',
    'tableDisplayName',
    'tableId',
    'parentTable',
];
const TABLE_ALIAS_FIELDS = ['name', 'tableName', 'displayName', 'id'];
function measureName(record) {
    return str(record, ...MEASURE_NAME_FIELDS);
}
function buildTableAliasMap(tables) {
    const aliases = new Map();
    for (const table of tables) {
        const canonical = str(table, 'name', 'tableName', 'displayName', 'id');
        if (!canonical)
            continue;
        for (const key of TABLE_ALIAS_FIELDS) {
            const alias = str(table, key);
            if (alias)
                aliases.set(alias.trim().toLowerCase(), canonical);
        }
    }
    return aliases;
}
function canonicalTableName(value, tableAliases) {
    if (!value)
        return undefined;
    return tableAliases.get(value.trim().toLowerCase()) ?? value;
}
function measureTableName(record, tableAliases = new Map()) {
    return canonicalTableName(str(record, ...MEASURE_TABLE_FIELDS), tableAliases);
}
function knownMeasureCountFromTables(tables) {
    let total = 0;
    for (const table of tables) {
        const nestedMeasures = table.measures;
        const count = num(table, 'measureCount', 'measuresCount') ??
            (Array.isArray(nestedMeasures) ? nestedMeasures.length : undefined);
        if (count !== undefined)
            total += count;
    }
    return total;
}
function nestedMeasureRecordsFromTables(tables) {
    const out = [];
    const tableAliases = buildTableAliasMap(tables);
    for (const table of tables) {
        const tableName = canonicalTableName(str(table, 'name', 'tableName'), tableAliases);
        const nestedMeasures = table.measures;
        if (!Array.isArray(nestedMeasures))
            continue;
        for (const measure of nestedMeasures) {
            if (!isRecord(measure))
                continue;
            const nestedTable = measureTableName(measure, tableAliases) ?? tableName;
            if (!nestedTable)
                continue;
            out.push({ ...measure, tableName: nestedTable });
        }
    }
    return out;
}
function usableMeasureRecords(records, tableAliases = new Map()) {
    const out = [];
    for (const record of records) {
        const name = measureName(record);
        const tableName = measureTableName(record, tableAliases);
        if (!name || !tableName)
            continue;
        out.push({ ...record, name, tableName });
    }
    return out;
}
function measureRecordKey(record, tableAliases = new Map()) {
    const table = measureTableName(record, tableAliases);
    const name = measureName(record);
    return table && name ? `${table}\u0000${name}` : undefined;
}
function mergeMeasureRecords(primary, fallback, tableAliases = new Map()) {
    const out = [...primary];
    const seen = new Set(primary
        .map((record) => measureRecordKey(record, tableAliases))
        .filter((key) => key !== undefined));
    for (const record of fallback) {
        const key = measureRecordKey(record, tableAliases);
        if (!key || seen.has(key))
            continue;
        out.push(record);
        seen.add(key);
    }
    return out;
}
function unwrapMeasureGetRecord(record) {
    if (record.success === false)
        return null;
    return isRecord(record.data) ? record.data : record;
}
// Read a field from a normalized DAX row whose keys are bracketed column names
// (e.g. "[Name]"). Matches candidates case-insensitively after stripping brackets.
function daxRowField(row, candidates) {
    for (const [key, value] of Object.entries(row)) {
        const norm = key.replace(/[[\]]/g, '').trim().toLowerCase();
        if (!candidates.includes(norm))
            continue;
        if (typeof value === 'string' && value.length > 0)
            return value;
        if (typeof value === 'number')
            return String(value);
    }
    return undefined;
}
function daxRowBool(row, candidates) {
    for (const [key, value] of Object.entries(row)) {
        const norm = key.replace(/[[\]]/g, '').trim().toLowerCase();
        if (!candidates.includes(norm))
            continue;
        if (typeof value === 'boolean')
            return value;
        if (typeof value === 'number')
            return value !== 0;
        if (typeof value === 'string')
            return /^(true|1)$/i.test(value.trim());
    }
    return false;
}
function appendMeasureToModel(model, def) {
    const table = model.tables.find((candidate) => candidate.name === def.tableName);
    if (!table)
        return null;
    if (table.measures.some((measure) => measure.name === def.name))
        return null;
    const measure = {
        table: def.tableName,
        name: def.name,
        expression: def.expression ?? '',
        formatString: def.formatString,
        isHidden: false,
        description: def.description,
        annotations: {},
    };
    return {
        ...model,
        tables: model.tables.map((candidate) => candidate.name === def.tableName
            ? { ...candidate, measures: [...candidate.measures, measure] }
            : candidate),
    };
}
function liveInstanceMatchesHint(inst, normalizedHint) {
    const candidates = [inst.name, inst.databaseName, inst.initialCatalog, inst.port]
        .filter((c) => typeof c === 'string' && c.length > 0)
        .map(normalizeModelName);
    return candidates.includes(normalizedHint);
}
// Build the multi-instance disambiguation error. MUST start with
// "Found N open Power BI Desktop instances" (an existing test asserts /found N open/i).
// Lists each instance by friendly name/database (NEVER the raw connection string —
// `Data Source=` is a secret) and tells the user how to pick one. Never auto-picks.
function multiInstanceError(instances, hint) {
    const lines = instances
        .map((inst) => {
        const label = inst.name ?? inst.databaseName ?? inst.initialCatalog ?? '(unnamed)';
        return `  - ${label} (port ${inst.port ?? '?'})`;
    })
        .join('\n');
    const lead = hint
        ? `Found ${instances.length} open Power BI Desktop instances and none uniquely matched model "${hint}".`
        : `Found ${instances.length} open Power BI Desktop instances.`;
    return `${lead}\n${lines}\nPass model: "<name-or-port>" to choose one, or set PBI_MODELING_MCP_CONNECTION_STRING.`;
}
function bool(obj, keys, fallback = false) {
    for (const key of keys) {
        const v = obj[key];
        if (typeof v === 'boolean')
            return v;
    }
    return fallback;
}
// Lift a boolean only when explicitly present; otherwise undefined (so an absent
// key stays undefined, not coerced to false — keeps a gated rule like MOD028
// silent rather than risking a false positive).
function boolOrUndef(obj, ...keys) {
    for (const key of keys) {
        const v = obj[key];
        if (typeof v === 'boolean')
            return v;
    }
    return undefined;
}
// Normalize a storage-mode token (any casing) to a StorageMode; undefined when
// absent or unrecognized.
function normalizeStorageMode(value) {
    switch ((value ?? '').trim().toLowerCase()) {
        case 'import':
            return 'import';
        case 'directquery':
            return 'directQuery';
        case 'dual':
            return 'dual';
        case 'directlake':
            return 'directLake';
        default:
            return undefined;
    }
}
function cardinalitySides(cardinality) {
    switch (cardinality) {
        case 'oneToMany':
            return { fromCardinality: 'one', toCardinality: 'many' };
        case 'oneToOne':
            return { fromCardinality: 'one', toCardinality: 'one' };
        case 'manyToMany':
            return { fromCardinality: 'many', toCardinality: 'many' };
        case 'manyToOne':
            return { fromCardinality: 'many', toCardinality: 'one' };
    }
}
function normalizeCardinalitySide(value) {
    const normalized = value?.trim().toLowerCase();
    if (normalized === 'many')
        return 'many';
    if (normalized === 'one')
        return 'one';
    return undefined;
}
function deriveKnownCardinality(fromCard, toCard) {
    const from = normalizeCardinalitySide(fromCard);
    const to = normalizeCardinalitySide(toCard);
    if (from === undefined || to === undefined)
        return undefined;
    if (from === 'many' && to === 'many')
        return 'manyToMany';
    if (from === 'one' && to === 'many')
        return 'oneToMany';
    if (from === 'one' && to === 'one')
        return 'oneToOne';
    return 'manyToOne';
}
function normalizeCrossFilteringBehavior(value) {
    return value && /both/i.test(value) ? 'both' : 'single';
}
function definedOnly(value) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
function hasTableUpdateFields(def) {
    return ['description', 'isHidden', 'dataCategory', 'annotations'].some((key) => def[key] !== undefined);
}
function hasColumnUpdateFields(def) {
    return [
        'dataType',
        'expression',
        'summarizeBy',
        'formatString',
        'sortByColumn',
        'isHidden',
        'description',
        'isKey',
        'dataCategory',
    ].some((key) => def[key] !== undefined);
}
export class ModelDriver {
    #client;
    #connection = null;
    #connectionHint = null;
    #lastOpts;
    #connectPending = null;
    #connectPendingKey = null;
    #operationQueue = Promise.resolve();
    // Short-lived snapshot cache: reused across reads/gates within one batch,
    // invalidated on every write and on any connection reset so the DAX gate
    // always sees prior committed writes. The TTL bounds staleness from edits
    // made directly in Desktop between calls.
    #snapshot = null;
    #snapshotPending = null;
    static #SNAPSHOT_TTL_MS = 5_000;
    constructor(client) {
        this.#client = client;
        // When the bridged subprocess/transport drops, the client resets — drop our
        // cached connection (and snapshot) so the next call re-discovers and re-Connects.
        this.#client.onReset?.(() => {
            this.#connection = null;
            this.#connectionHint = null;
            this.#lastOpts = undefined;
            this.#connectPending = null;
            this.#connectPendingKey = null;
            this.#snapshot = null;
            this.#snapshotPending = null;
        });
    }
    get connection() {
        return this.#connection;
    }
    // Raw operation call with secret-safe error wrapping.
    async call(tool, operation, params) {
        let result;
        try {
            result = await this.#client.callTool(tool, operationArgs(operation, params));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(redactConnectionSecrets(`${tool}/${operation} failed: ${msg}`));
        }
        if (result.isError) {
            const text = result.content?.find((c) => c.type === 'text')?.text ?? `${tool}/${operation} errored`;
            throw new Error(redactConnectionSecrets(text));
        }
        const parsed = parseResult(result);
        // P1/P6: some MS-MCP builds report a failure WITHOUT setting `isError` — they
        // return a `{ success: false }` envelope (the same shape the DAX path already
        // guards at normalizeDaxResult). Surface it as a thrown error so a write that
        // the engine rejected can never read back to the caller as success.
        if (isRecord(parsed) && parsed.success === false) {
            const message = str(parsed, 'message', 'error', 'detail') ?? `${tool}/${operation} reported failure`;
            throw new Error(redactConnectionSecrets(`${tool}/${operation} failed: ${message}`));
        }
        return parsed;
    }
    // Compat shim: returns just the connection strings (existing callers/tests
    // rely on this). New code wanting per-instance fields uses listLiveInstances.
    async listLocalInstances() {
        const payload = await this.call(MS_TOOLS.connection, 'ListLocalInstances');
        return collectConnectionStrings(payload);
    }
    // Structured discovery: every running Desktop instance with whatever name /
    // database / port the MS MCP exposes, so #connect can match by name.
    async listLiveInstances() {
        const payload = await this.call(MS_TOOLS.connection, 'ListLocalInstances');
        return extractLiveInstances(payload);
    }
    // Auto-detect connection. Cached + serialized (concurrent callers share one
    // connect). The cache is invalidated on a transport drop (onReset) or by #live.
    // A later explicit model/folder hint can switch targets when it no longer
    // matches the cached connection, which keeps multi-window sessions deterministic.
    async ensureConnection(opts) {
        return this.#withOperationLock(() => this.#ensureConnectionUnlocked(opts));
    }
    async #ensureConnectionUnlocked(opts) {
        if (opts)
            this.#lastOpts = opts;
        const requestedHint = normalizedConnectionHint(opts);
        const requestKey = connectionRequestKey(opts);
        if (this.#connection) {
            const forceFolderAgainstLive = opts?.forceFolder === true && this.#connection.mode !== 'folder';
            const livePreferredFolder = opts?.livePreferred === true && this.#connection.mode === 'folder';
            const modelOnlySelectorAgainstFolder = this.#connection.mode === 'folder' && requestedHint && opts?.model && !opts.folderPath;
            const cachedConnectionMatches = !requestedHint && !opts?.folderPath
                ? true
                : this.#connectionMatchesRequest(opts, requestedHint);
            if (!forceFolderAgainstLive &&
                !livePreferredFolder &&
                !modelOnlySelectorAgainstFolder &&
                cachedConnectionMatches) {
                return this.#connection;
            }
            this.#connection = null;
            this.#connectionHint = null;
            this.#invalidateSnapshot();
        }
        if (this.#connectPending) {
            if (this.#connectPendingKey === requestKey)
                return this.#connectPending;
            await this.#connectPending.catch(() => undefined);
            return this.#ensureConnectionUnlocked(opts);
        }
        this.#connectPendingKey = requestKey;
        this.#connectPending = this.#connect(opts).finally(() => {
            this.#connectPending = null;
            this.#connectPendingKey = null;
        });
        return this.#connectPending;
    }
    #connectionMatchesRequest(opts, normalizedHint) {
        if (!this.#connection)
            return false;
        if (this.#connection.mode === 'folder') {
            if (opts?.folderPath) {
                return this.#connection.folderPath
                    ? normalizeFolderCachePath(this.#connection.folderPath) ===
                        normalizeFolderCachePath(opts.folderPath)
                    : false;
            }
            return false;
        }
        return normalizedHint ? this.#connectionMatchesLiveHint(normalizedHint) : true;
    }
    #connectionMatchesLiveHint(normalizedHint) {
        if (this.#connectionHint === normalizedHint)
            return true;
        if (!this.#connection)
            return false;
        if (this.#connection.mode === 'folder')
            return false;
        if (!this.#connection.connectionString)
            return false;
        return liveInstanceMatchesHint(buildInstance(this.#connection.connectionString), normalizedHint);
    }
    async #connect(opts) {
        const requestedHint = normalizedConnectionHint(opts);
        if (opts?.forceFolder === true && opts.folderPath) {
            await this.call(MS_TOOLS.connection, 'ConnectFolder', { folderPath: opts.folderPath });
            this.#connection = { mode: 'folder', folderPath: opts.folderPath };
            this.#connectionHint = requestedHint;
            return this.#connection;
        }
        const pinned = process.env.PBI_MODELING_MCP_CONNECTION_STRING?.trim();
        if (pinned) {
            await this.call(MS_TOOLS.connection, 'Connect', { connectionString: pinned });
            this.#connection = { mode: 'live', connectionString: pinned };
            this.#connectionHint = requestedHint;
            return this.#connection;
        }
        // LIVE-FIRST: a running Desktop instance always wins, even if the caller
        // passed a folderPath. Folder/ConnectFolder is the OFFLINE fallback only
        // (no live instance). Rationale: Desktop does not watch TMDL files, so a
        // folder write never reaches an already-open Desktop; and discovering live
        // first means reads/edits bind to Desktop's in-memory model (what the user
        // sees), instead of disk where unsaved Desktop changes are invisible.
        let instances = [];
        let discoveryError;
        try {
            instances = await this.listLiveInstances();
        }
        catch (err) {
            // If we have a folderPath we can still fall back to offline; otherwise surface it.
            discoveryError = err instanceof Error ? err.message : String(err);
            if (!opts?.folderPath) {
                throw new Error(`Could not reach the Power BI modeling MCP to discover a live Desktop instance. Live modeling requires Windows with Power BI Desktop open. (${discoveryError})`);
            }
        }
        if (instances.length === 1) {
            const instance = instances[0];
            const hint = opts?.model ?? (opts?.folderPath ? normalizeModelName(opts.folderPath) : undefined);
            if (hint && !liveInstanceMatchesHint(instance, normalizeModelName(hint))) {
                throw new Error(multiInstanceError(instances, hint));
            }
            const connectionString = instance.connectionString;
            await this.call(MS_TOOLS.connection, 'Connect', { connectionString });
            this.#connection = { mode: 'live', connectionString };
            this.#connectionHint = requestedHint;
            return this.#connection;
        }
        if (instances.length > 1) {
            // Several Desktops open: derive a hint (explicit model wins; else the
            // folderPath basename) and exact-match it against each instance's
            // normalized name/database/initialCatalog. 0 or >1 matches → error.
            const hint = opts?.model ?? (opts?.folderPath ? normalizeModelName(opts.folderPath) : undefined);
            if (!hint)
                throw new Error(multiInstanceError(instances));
            const normalizedHint = normalizeModelName(hint);
            const matches = instances.filter((inst) => liveInstanceMatchesHint(inst, normalizedHint));
            if (matches.length === 1) {
                const connectionString = matches[0].connectionString;
                await this.call(MS_TOOLS.connection, 'Connect', { connectionString });
                this.#connection = { mode: 'live', connectionString };
                this.#connectionHint = normalizedHint;
                return this.#connection;
            }
            throw new Error(multiInstanceError(instances, hint));
        }
        // Zero live instances → offline folder fallback (if a folderPath is given).
        // NOTE: the MS MCP's ConnectFolder param key is `folderPath`, NOT `path`.
        // Sending `path` yields "Missing required parameters needed for ConnectFolder".
        if (opts?.folderPath) {
            await this.call(MS_TOOLS.connection, 'ConnectFolder', { folderPath: opts.folderPath });
            this.#connection = { mode: 'folder', folderPath: opts.folderPath };
            this.#connectionHint = requestedHint;
            return this.#connection;
        }
        throw new Error('No open Power BI Desktop instance found, and no folderPath supplied for folder mode. Open the .pbip in Desktop, or pass a .SemanticModel/definition folder.');
    }
    // Run an operation against a connected model, retrying once if the connection
    // drops (or the subprocess re-spawned unconnected): invalidate the cache,
    // reset the subprocess, re-Connect, and re-run.
    async #live(fn, expectedConnection) {
        return this.#withOperationLock(() => this.#liveUnlocked(fn, expectedConnection));
    }
    async #withOperationLock(work) {
        const previous = this.#operationQueue;
        let release;
        this.#operationQueue = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await work();
        }
        finally {
            release();
        }
    }
    async #liveUnlocked(fn, expectedConnection, options = {}) {
        await this.#ensureOperationConnection(expectedConnection);
        try {
            return await fn();
        }
        catch (err) {
            // Never retry a deterministic validation failure — it will just fail again
            // after burning another request timeout.
            if (isNonRetryable(err) || !isConnectionDrop(err))
                throw err;
            this.#connection = null;
            this.#connectionHint = null;
            this.#snapshot = null;
            this.#snapshotPending = null;
            this.#client.reset?.();
            if (options.retryOnConnectionDrop === false) {
                const m = err instanceof Error ? err.message : String(err);
                throw new Error(redactConnectionSecrets(`Model bridge write result unknown after connection drop during ${options.operationLabel ?? 'write'}. The operation may already have been applied; refusing to replay a non-idempotent write without readback. Last error: ${m}`));
            }
            try {
                await this.#ensureOperationConnection(expectedConnection);
                return await fn();
            }
            catch (retryErr) {
                const m = retryErr instanceof Error ? retryErr.message : String(retryErr);
                throw new Error(redactConnectionSecrets(`Model bridge connection dropped and could not be re-established after one retry. Check that Power BI Desktop is open with the .pbip loaded (live mode), or that the folder path is valid (offline mode). Last error: ${m}`));
            }
        }
    }
    async #ensureOperationConnection(expectedConnection) {
        if (!expectedConnection) {
            await this.#ensureConnectionUnlocked();
            return;
        }
        if (this.#connectionMatchesExpected(expectedConnection))
            return;
        this.#connection = null;
        this.#connectionHint = null;
        this.#invalidateSnapshot();
        if (expectedConnection.mode === 'live') {
            if (!expectedConnection.connectionString) {
                throw new Error('Expected live model connection is missing its connection string.');
            }
            await this.call(MS_TOOLS.connection, 'Connect', {
                connectionString: expectedConnection.connectionString,
            });
            this.#connection = {
                mode: 'live',
                connectionString: expectedConnection.connectionString,
            };
            return;
        }
        if (!expectedConnection.folderPath) {
            throw new Error('Expected folder model connection is missing its folderPath.');
        }
        await this.call(MS_TOOLS.connection, 'ConnectFolder', {
            folderPath: expectedConnection.folderPath,
        });
        this.#connection = { mode: 'folder', folderPath: expectedConnection.folderPath };
    }
    #connectionMatchesExpected(expectedConnection) {
        if (!this.#connection)
            return false;
        if (expectedConnection.mode !== this.#connection.mode)
            return false;
        if (expectedConnection.mode === 'live') {
            return (expectedConnection.connectionString !== undefined &&
                this.#connection.connectionString === expectedConnection.connectionString);
        }
        return (expectedConnection.folderPath !== undefined &&
            this.#connection.folderPath !== undefined &&
            normalizeFolderCachePath(this.#connection.folderPath) ===
                normalizeFolderCachePath(expectedConnection.folderPath));
    }
    // --- reads -------------------------------------------------------------
    async listTablesRaw(expectedConnection) {
        return this.#live(() => this.#listTablesRawUnlocked(), expectedConnection);
    }
    async listTableInventoryRaw(expectedConnection) {
        return (await this.listTablesRaw(expectedConnection))
            .map((table) => {
            const name = str(table, 'name', 'tableName');
            if (!name)
                return null;
            const nestedColumns = table.columns;
            const nestedMeasures = table.measures;
            const columnCount = num(table, 'columnCount', 'columnsCount') ??
                (Array.isArray(nestedColumns) ? nestedColumns.length : undefined);
            const measureCount = num(table, 'measureCount', 'measuresCount') ??
                (Array.isArray(nestedMeasures) ? nestedMeasures.length : undefined);
            const storageMode = normalizeStorageMode(str(table, 'mode', 'storageMode', 'modeType'));
            return {
                name,
                isHidden: bool(table, ['isHidden', 'hidden']),
                isCalculated: bool(table, ['isCalculated', 'calculated']),
                isAutoDateTable: bool(table, ['isAutoDateTable', 'autoDateTable']),
                description: str(table, 'description'),
                ...(storageMode !== undefined ? { storageMode } : {}),
                ...(columnCount !== undefined ? { columnCount } : {}),
                ...(measureCount !== undefined ? { measureCount } : {}),
            };
        })
            .filter((table) => table !== null);
    }
    async listColumnsRaw(expectedConnection) {
        return this.#live(() => this.#listColumnsRawUnlocked(), expectedConnection);
    }
    async listMeasuresRaw(expectedConnection) {
        return this.#live(() => this.#listMeasuresRawUnlocked(), expectedConnection);
    }
    // The live measure List returns only { name, description } — no table,
    // expression, or formatString. Enrich with a single batched Get
    // (references: [{ name }]) which returns the full definitions.
    async listMeasuresEnriched(expectedConnection) {
        return this.#live(async () => (await this.#listMeasuresEnrichedUnlocked()).records, expectedConnection);
    }
    async listRelationshipsRaw(expectedConnection) {
        return this.#live(() => this.#listRelationshipsRawUnlocked(), expectedConnection);
    }
    // RLS roles read. A per-role Get may be needed to retrieve tablePermissions
    // (mirroring the measure List→Get enrich); the assembly below tolerates either
    // shape. The CALLER (getModelSnapshot) wraps this in try/catch so an
    // unsupported op degrades to no `roles` key rather than breaking the snapshot.
    async listRolesRaw(expectedConnection) {
        return this.#live(() => this.#listRolesRawUnlocked(), expectedConnection);
    }
    async daxQuery(query, expectedConnection, options = {}) {
        return this.#live(async () => {
            const { normalized, rawPayload, source } = await this.#daxExecUnlocked(query);
            return options.includeRawDiagnostics
                ? attachDaxRawDiagnostics(normalized, rawPayload, source)
                : normalized;
        }, expectedConnection);
    }
    // Execute DAX WITHOUT acquiring the operation lock or re-ensuring the
    // connection. Callers that already hold the lock / a live connection (e.g. the
    // snapshot assembly) use this directly; `daxQuery` wraps it in `#live`.
    async #daxExecUnlocked(query) {
        let result;
        try {
            result = await this.#client.callTool(MS_TOOLS.dax, operationArgs('Execute', { query }));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(redactConnectionSecrets(`${MS_TOOLS.dax}/Execute failed: ${msg}`));
        }
        if (result.isError) {
            const text = result.content?.find((c) => c.type === 'text')?.text ?? `${MS_TOOLS.dax}/Execute errored`;
            throw new Error(redactConnectionSecrets(text));
        }
        const raw = parseDaxToolResult(result);
        return {
            normalized: normalizeDaxResult(raw.payload),
            rawPayload: raw.payload,
            source: raw.source,
        };
    }
    async refreshModel(refreshType = 'Automatic', expectedConnection) {
        return this.#write(() => this.call(MS_TOOLS.model, 'Refresh', { refreshType }), expectedConnection);
    }
    // Assemble the live model into pbi-core's TMDLModel so existing validators reuse.
    async getModelSnapshot(modelPath = '(live)', options = {}, expectedConnection) {
        return this.#live(() => this.#getModelSnapshotUnlocked(modelPath, options), expectedConnection);
    }
    async getFreshSnapshot(expectedConnection, options = {}) {
        return this.#withOperationLock(() => this.#liveUnlocked(() => this.#getModelSnapshotUnlocked('(live)', options), expectedConnection));
    }
    async #getModelSnapshotUnlocked(modelPath = '(live)', options = {}) {
        const includeMeasures = options.includeMeasures !== false;
        const includeRoles = options.includeRoles !== false;
        const rawTablesPromise = this.#listTablesRawUnlocked();
        const measuresPromise = includeMeasures
            ? rawTablesPromise.then((tables) => this.#listMeasuresEnrichedUnlocked(tables))
            : Promise.resolve({
                records: [],
                complete: true,
                knownCount: 0,
            });
        const [rawTables, rawColumns, measuresResult, rawRels] = await Promise.all([
            rawTablesPromise,
            this.#listColumnsRawUnlocked(),
            measuresPromise,
            this.#listRelationshipsRawUnlocked(),
        ]);
        const rawMeasures = measuresResult.records;
        // UNVERIFIED: RLS-roles read op is unconfirmed. Best-effort: a failure (op
        // not supported / errored) degrades to NO `roles` key so the snapshot — which
        // every validator depends on — can never break on the unconfirmed op.
        let rawRoles = [];
        let rolesCaptured = false;
        if (includeRoles) {
            try {
                rawRoles = await this.#listRolesRawUnlocked();
                rolesCaptured = true;
            }
            catch {
                rawRoles = [];
            }
        }
        const columnsByTable = new Map();
        const pushColumn = (table, c) => {
            const name = str(c, 'name', 'columnName') ?? '';
            if (!table || !name)
                return;
            // UNVERIFIED: calc-column DAX source key. The WRITE path proves the MS key
            // is `daxExpression` (toDaxSource); the read payload likely surfaces it the
            // same way — list it first after the friendly `expression`.
            const expression = str(c, 'expression', 'daxExpression', 'dax');
            // UNVERIFIED: sortByColumn payload key inferred.
            const sortByColumn = str(c, 'sortByColumn', 'sortByColumnName');
            // UNVERIFIED: isAvailableInMDX payload key + casing inferred. Keep undefined
            // when absent — do NOT default to true (absence already means "treated as
            // true" downstream; coercing would mask a genuine alternate-cased false).
            const isAvailableInMdx = boolOrUndef(c, 'isAvailableInMDX', 'isAvailableInMdx');
            const col = {
                table,
                name,
                dataType: str(c, 'dataType', 'type') ?? 'unknown',
                summarizeBy: str(c, 'summarizeBy'),
                sourceColumn: str(c, 'sourceColumn'),
                // UNVERIFIED: confirm against live MS MCP — dataCategory/formatString/
                // description/displayFolder payload keys are inferred (tolerant str()
                // lifts; harmless if absent).
                dataCategory: str(c, 'dataCategory'),
                formatString: str(c, 'formatString', 'format'),
                description: str(c, 'description'),
                displayFolder: str(c, 'displayFolder'),
                isHidden: bool(c, ['isHidden', 'hidden']),
                isKey: bool(c, ['isKey', 'key']),
                isCalculated: bool(c, ['isCalculated', 'calculated']),
                ...(expression !== undefined ? { expression } : {}),
                ...(sortByColumn !== undefined ? { sortByColumn } : {}),
                ...(isAvailableInMdx !== undefined ? { isAvailableInMdx } : {}),
            };
            const list = columnsByTable.get(table) ?? [];
            list.push(col);
            columnsByTable.set(table, list);
        };
        // The live column List is grouped per table: { tableName, columns: [{name, dataType}] }.
        // Folder/flat sources hand back one column per entry. Handle both.
        for (const entry of rawColumns) {
            const table = str(entry, 'tableName', 'table') ?? '';
            const nested = entry.columns;
            if (Array.isArray(nested)) {
                for (const c of nested)
                    if (isRecord(c))
                        pushColumn(table, c);
            }
            else {
                pushColumn(table, entry);
            }
        }
        const measuresByTable = new Map();
        for (const m of rawMeasures) {
            const table = measureTableName(m) ?? '';
            const name = measureName(m) ?? '';
            if (!table || !name)
                continue;
            const measure = {
                table,
                name,
                expression: str(m, 'expression', 'dax') ?? '',
                formatString: str(m, 'formatString', 'format'),
                isHidden: bool(m, ['isHidden', 'hidden']),
                description: str(m, 'description'),
                // UNVERIFIED: displayFolder payload key inferred (enrich Get data).
                displayFolder: str(m, 'displayFolder'),
                annotations: extractAnnotations(m),
            };
            const list = measuresByTable.get(table) ?? [];
            list.push(measure);
            measuresByTable.set(table, list);
        }
        const tables = rawTables
            .map((t) => {
            const name = str(t, 'name', 'tableName');
            if (!name)
                return null;
            // UNVERIFIED: table storage-mode key + value casing inferred. The MS MCP
            // may expose it as `mode`/`storageMode`/`modeType`; normalize tolerantly
            // (undefined when absent keeps MOD028's DQ gate silent).
            const storageMode = normalizeStorageMode(str(t, 'mode', 'storageMode', 'modeType'));
            const dataCategory = str(t, 'dataCategory');
            const expression = str(t, 'expression', 'daxExpression', 'source', 'query');
            const annotations = extractAnnotations(t);
            return {
                name,
                columns: columnsByTable.get(name) ?? [],
                measures: measuresByTable.get(name) ?? [],
                isHidden: bool(t, ['isHidden', 'hidden']),
                isCalculated: bool(t, ['isCalculated', 'calculated']),
                isAutoDateTable: bool(t, ['isAutoDateTable', 'autoDateTable']),
                // UNVERIFIED: table description payload key inferred.
                description: str(t, 'description'),
                ...(dataCategory !== undefined ? { dataCategory } : {}),
                ...(expression !== undefined ? { expression } : {}),
                ...(storageMode !== undefined ? { storageMode } : {}),
                // Surfaces the governed Date-table policy stamp so the gates can read it back.
                ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
            };
        })
            .filter((t) => t !== null);
        // Ensure tables referenced only by columns/measures still appear.
        const known = new Set(tables.map((t) => t.name));
        for (const table of new Set([...columnsByTable.keys(), ...measuresByTable.keys()])) {
            if (!known.has(table)) {
                tables.push({
                    name: table,
                    columns: columnsByTable.get(table) ?? [],
                    measures: measuresByTable.get(table) ?? [],
                    isHidden: false,
                    isCalculated: false,
                    isAutoDateTable: false,
                });
            }
        }
        const relationships = rawRels
            .map((r, i) => {
            const fromTable = str(r, 'fromTable', 'fromTableName');
            const fromColumn = str(r, 'fromColumn', 'fromColumnName');
            const toTable = str(r, 'toTable', 'toTableName');
            const toColumn = str(r, 'toColumn', 'toColumnName');
            if (!fromTable || !fromColumn || !toTable || !toColumn)
                return null;
            const cross = str(r, 'crossFilteringBehavior', 'crossFilterBehavior');
            // UNVERIFIED: confirm against live MS MCP — fromCardinality/toCardinality
            // payload keys are inferred. Only set cardinality when both sides are
            // present and recognized; unknown live metadata must fail closed in
            // repair/reuse gates instead of being coerced to a default.
            const fromCard = str(r, 'fromCardinality', 'fromCardinalityName');
            const toCard = str(r, 'toCardinality', 'toCardinalityName');
            const cardinality = deriveKnownCardinality(fromCard, toCard);
            // UNVERIFIED: Assume-RI ("rely on referential integrity") key inferred.
            // Keep undefined when absent so MOD028 stays gated (no false positive).
            const relyOnRi = boolOrUndef(r, 'relyOnReferentialIntegrity', 'assumeReferentialIntegrity');
            const relationshipId = str(r, 'id', 'name');
            return {
                id: relationshipId ?? `rel_${i}`,
                identityProven: relationshipId !== undefined,
                fromTable,
                fromColumn,
                toTable,
                toColumn,
                isActive: bool(r, ['isActive', 'active'], true),
                crossFilteringBehavior: normalizeCrossFilteringBehavior(cross),
                ...(cardinality !== undefined ? { cardinality } : {}),
                ...(relyOnRi !== undefined ? { relyOnReferentialIntegrity: relyOnRi } : {}),
            };
        })
            .filter((r) => r !== null);
        // UNVERIFIED: roles assembly. Tolerant lifts over inferred keys — the role
        // record's name + a tablePermissions/permissions array of { table,
        // filterExpression } rows. Drop roles with no name and permissions with no
        // table. Omit `roles` from the model when empty so it stays undefined.
        const roles = rawRoles
            .map((r) => {
            const permsRaw = r.tablePermissions ?? r.permissions;
            const tablePermissions = pickArray(permsRaw)
                .filter(isRecord)
                .map((p) => ({
                table: str(p, 'table', 'tableName') ?? '',
                filterExpression: str(p, 'filterExpression', 'expression', 'filter') ?? '',
            }))
                .filter((p) => p.table.length > 0);
            return { name: str(r, 'name', 'roleName') ?? '', tablePermissions };
        })
            .filter((r) => r.name.length > 0);
        return {
            modelPath,
            tables,
            relationships,
            ...(includeMeasures ? { measuresCaptured: measuresResult.complete } : {}),
            ...(rolesCaptured ? { rolesCaptured: true, roles } : {}),
        };
    }
    async #listTablesRawUnlocked() {
        return pickArray(await this.call(MS_TOOLS.tables, 'List')).filter(isRecord);
    }
    async #listColumnsRawUnlocked() {
        return pickArray(await this.call(MS_TOOLS.columns, 'List')).filter(isRecord);
    }
    async #listMeasuresRawUnlocked() {
        return pickArray(await this.call(MS_TOOLS.measures, 'List')).filter(isRecord);
    }
    // Best-effort measure enumeration. NEVER throws: a measure-list payload the
    // driver cannot parse (e.g. an MS-MCP shape change) must NOT block writes — the
    // write path only needs columns for the reference gate and the Microsoft engine
    // validates measure references at commit time. `complete` is false when table
    // inventory proves more measures exist than we could enumerate by name, so the
    // snapshot can be flagged `measuresCaptured: false` and consumers degrade
    // gracefully instead of treating the model as empty.
    async #listMeasuresEnrichedUnlocked(knownTables) {
        const tables = knownTables ?? (await this.#listTablesRawUnlocked());
        const tableAliases = buildTableAliasMap(tables);
        const knownMeasureCount = knownMeasureCountFromTables(tables);
        const nestedMeasures = usableMeasureRecords(nestedMeasureRecordsFromTables(tables), tableAliases);
        const rawMeasures = await this.#listMeasuresRawUnlocked();
        const names = rawMeasures
            .map((m) => measureName(m))
            .filter((n) => typeof n === 'string' && n.length > 0);
        let payloadRecords;
        if (names.length === 0) {
            // measure_operations/List exposed no parseable names — fall back to whatever
            // the table-nested source yielded.
            payloadRecords = nestedMeasures;
        }
        else {
            const got = await this.call(MS_TOOLS.measures, 'Get', {
                references: names.map((name) => ({ name })),
            });
            // Batched Get returns { results: [{ success, data: { ...measure } }, ...] }.
            // pickArray grabs `results`; unwrap each item's `data`. Tolerate a flat shape.
            const enriched = pickArray(got)
                .map((r) => (isRecord(r) ? unwrapMeasureGetRecord(r) : null))
                .filter((record) => record !== null);
            payloadRecords = usableMeasureRecords(mergeMeasureRecords(enriched, nestedMeasures, tableAliases), tableAliases);
        }
        // Fast path: the measure_operations payload covered every measure table
        // inventory reports — trust it, no extra round-trip.
        if (knownMeasureCount === 0 || payloadRecords.length >= knownMeasureCount) {
            return { records: payloadRecords, complete: true, knownCount: knownMeasureCount };
        }
        // Payload enumeration is short of the proven count — likely an MS-MCP
        // measure-list payload-shape change. Fall back to a version-INDEPENDENT DAX
        // INFO query that reads measures straight from the engine, decoupled from the
        // measure_operations payload keys. Best-effort: never throws.
        const daxRecords = await this.#listMeasuresViaDaxUnlocked(tableAliases);
        if (daxRecords.length >= Math.max(payloadRecords.length, knownMeasureCount)) {
            return { records: daxRecords, complete: true, knownCount: knownMeasureCount };
        }
        if (daxRecords.length > payloadRecords.length) {
            return { records: daxRecords, complete: false, knownCount: knownMeasureCount };
        }
        return { records: payloadRecords, complete: false, knownCount: knownMeasureCount };
    }
    // Version-independent measure enumeration via the engine's INFO.VIEW.MEASURES()
    // function. Returns records shaped like the measure_operations payload (name,
    // tableName, expression, formatString, ...) so the snapshot assembler consumes
    // them unchanged. Never throws — a failed/absent INFO query degrades to [].
    async #listMeasuresViaDaxUnlocked(tableAliases) {
        let normalized;
        try {
            ({ normalized } = await this.#daxExecUnlocked('EVALUATE INFO.VIEW.MEASURES()'));
        }
        catch {
            return [];
        }
        const rows = isRecord(normalized) && Array.isArray(normalized.rows)
            ? normalized.rows.filter(isRecord)
            : [];
        const out = [];
        for (const row of rows) {
            const name = daxRowField(row, ['name']);
            const table = canonicalTableName(daxRowField(row, ['table', 'tablename']), tableAliases);
            if (!name || !table)
                continue;
            const formatString = daxRowField(row, ['formatstring', 'formatstringdefinition']);
            const description = daxRowField(row, ['description']);
            const displayFolder = daxRowField(row, ['displayfolder']);
            out.push({
                name,
                tableName: table,
                expression: daxRowField(row, ['expression']) ?? '',
                ...(formatString !== undefined ? { formatString } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(displayFolder !== undefined ? { displayFolder } : {}),
                isHidden: daxRowBool(row, ['ishidden', 'hidden']),
            });
        }
        return out;
    }
    async #listRelationshipsRawUnlocked() {
        return pickArray(await this.call(MS_TOOLS.relationships, 'List')).filter(isRecord);
    }
    async #listRolesRawUnlocked() {
        return pickArray(await this.call(MS_TOOLS.roles, 'List')).filter(isRecord);
    }
    // Snapshot reused across reads and the per-write DAX gate within one batch.
    // Dedupes concurrent callers and serves a fresh-enough result; otherwise
    // re-reads. Invalidated by every write (below) and by reset(), so the gate
    // always sees prior committed writes.
    async getCachedSnapshot(expectedConnection, options = {}) {
        return this.#withOperationLock(() => this.#getCachedSnapshotUnlocked(expectedConnection, options));
    }
    async #getCachedSnapshotUnlocked(expectedConnection, options = {}) {
        await this.#ensureOperationConnection(expectedConnection);
        const connectionKey = connectionCacheKey(this.#connection);
        const optionsKey = snapshotOptionsKey(options);
        const now = Date.now();
        if (this.#snapshot &&
            connectionKey !== null &&
            this.#snapshot.connectionKey === connectionKey &&
            this.#snapshot.optionsKey === optionsKey &&
            now - this.#snapshot.at < _a.#SNAPSHOT_TTL_MS) {
            return this.#snapshot.model;
        }
        if (this.#snapshotPending && this.#snapshotPending.optionsKey === optionsKey) {
            return this.#snapshotPending.promise;
        }
        const promise = this.#liveUnlocked(() => this.#getModelSnapshotUnlocked('(live)', options), expectedConnection)
            .then((model) => {
            const snapshotConnectionKey = connectionCacheKey(this.#connection);
            if (snapshotConnectionKey !== null) {
                this.#snapshot = {
                    model,
                    at: Date.now(),
                    connectionKey: snapshotConnectionKey,
                    optionsKey,
                };
            }
            return model;
        })
            .finally(() => {
            this.#snapshotPending = null;
        });
        this.#snapshotPending = { promise, optionsKey };
        return promise;
    }
    #invalidateSnapshot() {
        this.#snapshot = null;
        this.#snapshotPending = null;
    }
    async #write(fn, expectedConnection, options = {}) {
        return this.#withOperationLock(async () => {
            const result = await this.#liveUnlocked(fn, expectedConnection, options);
            this.#invalidateSnapshot();
            // P6: a batched Create/Update returns { results: [{ success, ... }] }; a
            // partial failure must surface, not pass as overall success.
            assertNoBatchFailure(result, options.operationLabel);
            return result;
        });
    }
    // Like #write, but after the write re-reads the live model on the SAME
    // connection and throws if `verify` does not observe the requested state —
    // closing the false-success gap (P1/P6). `verify` returns true for the
    // "cannot confirm" case (e.g. the target table is not present in the
    // snapshot), so a legitimately-unobservable read never yields a false
    // negative; it returns false only when the live state clearly contradicts the
    // requested write.
    async #writeVerified(fn, verify, failure, expectedConnection, options = {}) {
        const { snapshotOptions, ...writeOpts } = options;
        return this.#withOperationLock(async () => {
            const result = await this.#liveUnlocked(fn, expectedConnection, writeOpts);
            this.#invalidateSnapshot();
            assertNoBatchFailure(result, writeOpts.operationLabel);
            const model = await this.#getCachedSnapshotUnlocked(expectedConnection, snapshotOptions ?? {});
            if (!verify(model))
                throw new Error(redactConnectionSecrets(failure));
            return result;
        });
    }
    async #writeThenPatchSnapshot(fn, patchFn, expectedConnection, options = {}) {
        const { requireOptionsKey, ...writeOpts } = options;
        return this.#withOperationLock(async () => {
            const result = await this.#liveUnlocked(fn, expectedConnection, writeOpts);
            assertNoBatchFailure(result, writeOpts.operationLabel);
            const cache = this.#snapshot;
            const connectionKey = connectionCacheKey(this.#connection);
            if (cache &&
                connectionKey !== null &&
                cache.connectionKey === connectionKey &&
                (requireOptionsKey === undefined || cache.optionsKey === requireOptionsKey)) {
                const patched = patchFn(cache.model);
                if (patched !== null) {
                    this.#snapshot = { ...cache, model: patched, at: Date.now() };
                    this.#snapshotPending = null;
                    return result;
                }
            }
            this.#invalidateSnapshot();
            return result;
        });
    }
    // --- writes ------------------------------------------------------------
    async createMeasure(def, expectedConnection) {
        return this.#writeThenPatchSnapshot(() => this.call(MS_TOOLS.measures, 'Create', { definitions: [def] }), (model) => appendMeasureToModel(model, def), expectedConnection, {
            retryOnConnectionDrop: false,
            operationLabel: 'measure create',
            requireOptionsKey: snapshotOptionsKey({ includeMeasures: true, includeRoles: false }),
        });
    }
    async updateMeasure(def, expectedConnection) {
        // A measure update mutates expression/formatString/description — properties that
        // can silently no-op on Import. Re-read and confirm so a no-opped DAX edit cannot
        // report updated:true while the live model still holds the old expression.
        return this.#writeVerified(() => this.call(MS_TOOLS.measures, 'Update', { definitions: [def] }), (model) => measureUpdateApplied(model, def), `measure update was not applied: live re-read of ${def.tableName}[${def.name}] does not reflect the requested change`, expectedConnection, { operationLabel: 'measure update' });
    }
    async deleteMeasure(ref, expectedConnection) {
        return this.#write(() => this.call(MS_TOOLS.measures, 'Delete', { references: [ref], shouldCascadeDelete: false }), expectedConnection);
    }
    // -- tables --
    async createTable(def, expectedConnection) {
        return this.#write(() => this.call(MS_TOOLS.tables, 'Create', { definitions: [toDaxSource(def)] }), expectedConnection, { retryOnConnectionDrop: false, operationLabel: 'table create' });
    }
    async updateTable(def, expectedConnection) {
        return this.#writeVerified(async () => {
            const { newName, ...updateDef } = def;
            let result;
            if (newName !== undefined && newName !== def.name) {
                result = await this.call(MS_TOOLS.tables, 'Rename', {
                    renameDefinitions: [{ currentName: def.name, newName }],
                });
            }
            const updateName = newName ?? def.name;
            const remaining = definedOnly({
                ...updateDef,
                name: updateName,
            });
            if (hasTableUpdateFields(remaining)) {
                result = await this.call(MS_TOOLS.tables, 'Update', { definitions: [remaining] });
            }
            return result ?? {};
        }, 
        // P1 parity with updateColumn: the MS MCP can accept a table Update and
        // report success while the live model is unchanged (observed on Import-mode
        // dataCategory:'Time' / isHidden writes). Trust a fresh re-read, not the
        // server's success flag, so a silent no-op surfaces as an honest error
        // instead of a fake `marked:true` that deadlocks the mark-as-date gate.
        (model) => tableUpdateApplied(model, def), `table update was not applied: live re-read of ${def.newName ?? def.name} does not reflect the requested change`, expectedConnection, { operationLabel: 'table update' });
    }
    async deleteTable(ref, expectedConnection) {
        // UNVERIFIED: confirm against live MS MCP tool list — Delete not in the capability table.
        // Attempt + surface a clean error if unsupported; NEVER fall back to disk edits.
        return this.#write(() => this.call(MS_TOOLS.tables, 'Delete', { references: [ref], shouldCascadeDelete: false }), expectedConnection);
    }
    // -- columns --
    async createColumn(def, expectedConnection) {
        return this.#write(() => this.call(MS_TOOLS.columns, 'Create', { definitions: [toDaxSource(def)] }), expectedConnection, { retryOnConnectionDrop: false, operationLabel: 'column create' });
    }
    async createColumns(defs, expectedConnection) {
        return this.#write(() => this.call(MS_TOOLS.columns, 'Create', {
            definitions: defs.map((def) => toDaxSource(def)),
        }), expectedConnection, { retryOnConnectionDrop: false, operationLabel: 'columns create' });
    }
    async updateColumn(def, expectedConnection) {
        return this.#writeVerified(async () => {
            const { newName, ...updateDef } = def;
            let result;
            if (newName !== undefined && newName !== def.name) {
                result = await this.call(MS_TOOLS.columns, 'Rename', {
                    renameDefinitions: [{ tableName: def.tableName, currentName: def.name, newName }],
                });
            }
            const updateName = newName ?? def.name;
            const remaining = definedOnly({
                ...updateDef,
                name: updateName,
            });
            if (hasColumnUpdateFields(remaining)) {
                result = await this.call(MS_TOOLS.columns, 'Update', {
                    definitions: [toDaxSource(remaining)],
                });
            }
            return result ?? {};
        }, (model) => columnUpdateApplied(model, def), `column update was not applied: live re-read of ${def.tableName}[${def.newName ?? def.name}] does not reflect the requested change`, expectedConnection, { operationLabel: 'column update' });
    }
    async updateColumns(defs, expectedConnection) {
        return this.#writeVerified(() => this.call(MS_TOOLS.columns, 'Update', {
            definitions: defs.map((def) => toDaxSource(def)),
        }), (model) => defs.every((def) => columnUpdateApplied(model, def)), 'column update was not applied: live re-read does not reflect one or more requested column changes', expectedConnection, { operationLabel: 'columns update' });
    }
    async deleteColumn(ref, expectedConnection) {
        // UNVERIFIED: confirm against live MS MCP tool list — Delete not in the capability table.
        return this.#write(() => this.call(MS_TOOLS.columns, 'Delete', { references: [ref], shouldCascadeDelete: false }), expectedConnection);
    }
    // Mark a table as a Power BI date table: set the table's dataCategory to
    // 'Time' and flag the chosen date column as the key. This is what enables
    // time-intelligence DAX (YTD/PY/YoY) and clears MODB1/MODB2.
    // UNVERIFIED: the MS MCP `dataCategory` (table Update) and `isKey` (column
    // Update) keys are inferred; both go through the standard Update path.
    async markAsDateTable(tableName, dateColumn, expectedConnection) {
        let tableResult;
        try {
            tableResult = await this.updateTable({ name: tableName, dataCategory: 'Time' }, expectedConnection);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // The host accepted the dataCategory:'Time' write but a fresh re-read did
            // not reflect it (observed on Import-mode tables). Do NOT claim success and
            // do NOT treat marking as impossible — return a structured non-marked signal
            // so the caller's mark gate surfaces an actionable blocker. The date key may
            // still be proven from data, which is what relationships/time intelligence rely on.
            if (!isTableUpdateNotApplied(message))
                throw err;
            return { marked: false, dataCategoryNotApplied: true, dataCategoryWarning: message };
        }
        try {
            const columnResult = await this.updateColumn({ tableName, name: dateColumn, isKey: true }, expectedConnection);
            return { marked: true, tableResult, columnResult };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!isImportModeDateKeyWriteRejection(message))
                throw err;
            return {
                marked: true,
                tableResult,
                columnKeySkipped: true,
                columnKeyWarning: message.replace(/^column_operations\/Update failed:\s*/i, ''),
            };
        }
    }
    // -- relationships --
    // The driver owns the MS wire-format quirk: crossFilteringBehavior is
    // 'single'|'both' in our API but 'OneDirection'|'BothDirections' on the wire.
    #translateRel(def) {
        const { cardinality, crossFilteringBehavior, ...rest } = def;
        return {
            ...rest,
            ...(cardinality ? cardinalitySides(cardinality) : {}),
            ...(crossFilteringBehavior === undefined
                ? {}
                : {
                    crossFilteringBehavior: crossFilteringBehavior === 'both' ? 'BothDirections' : 'OneDirection',
                }),
        };
    }
    async createRelationship(def, expectedConnection) {
        return this.#write(() => this.call(MS_TOOLS.relationships, 'Create', { definitions: [this.#translateRel(def)] }), expectedConnection, { retryOnConnectionDrop: false, operationLabel: 'relationship create' });
    }
    async createRelationships(defs, expectedConnection) {
        return this.#write(() => this.call(MS_TOOLS.relationships, 'Create', {
            definitions: defs.map((def) => this.#translateRel(def)),
        }), expectedConnection, { retryOnConnectionDrop: false, operationLabel: 'relationships create' });
    }
    async updateRelationship(def, expectedConnection) {
        // UNVERIFIED: confirm against live MS MCP tool list — Update identity shape (name=id) unconfirmed.
        const { id, ...changes } = def;
        const translated = this.#translateRel(changes);
        // Re-pointing endpoints / flipping cardinality|crossFilter|isActive are property
        // updates with the same Import-mode silent-no-op hazard as column/table writes.
        // Verify the live relationship reflects the change instead of trusting the ack.
        return this.#writeVerified(() => this.call(MS_TOOLS.relationships, 'Update', { definitions: [{ name: id, ...translated }] }), (model) => relationshipUpdateApplied(model, def), `relationship update was not applied: live re-read of relationship ${id} does not reflect the requested change`, expectedConnection, { operationLabel: 'relationship update' });
    }
    async updateRelationships(defs, expectedConnection) {
        return this.#write(() => this.call(MS_TOOLS.relationships, 'Update', {
            definitions: defs.map((def) => {
                const { id, ...changes } = def;
                return { name: id, ...this.#translateRel(changes) };
            }),
        }), expectedConnection);
    }
    async activateRelationship(ref, expectedConnection) {
        // Activate IS a confirmed op (relationship_operations: …, Activate, Deactivate).
        // UNVERIFIED: the references:[{name}] envelope is inferred from Deactivate's
        // confirmed shape (Activate's own envelope is not separately documented).
        // Verify the relationship reads back active so a no-opped activate cannot report
        // updated:true while the live relationship is still inactive.
        return this.#writeVerified(() => this.call(MS_TOOLS.relationships, 'Activate', { references: [{ name: ref.id }] }), (model) => relationshipActivated(model, ref.id), `relationship activate was not applied: live re-read of relationship ${ref.id} does not show it active`, expectedConnection, { operationLabel: 'relationship activate' });
    }
    async deactivateRelationship(ref, expectedConnection) {
        return this.#write(() => this.call(MS_TOOLS.relationships, 'Deactivate', { references: [{ name: ref.id }] }), expectedConnection);
    }
    async deleteRelationship(ref, expectedConnection) {
        // UNVERIFIED: confirm against live MS MCP tool list — Delete not in the op list.
        // Attempt + surface a clean error if unsupported; NEVER fall back to disk edits.
        return this.#withOperationLock(async () => {
            // P4: deleting a fact[date] -> auto LocalDateTable relationship orphans the
            // source column's date Variation/DefaultHierarchy (which still points at the
            // deleted relationship), leaving the model inconsistent. The bridge cannot
            // model or repoint a Variation, so refuse rather than orphan it.
            const before = await this.#getCachedSnapshotUnlocked(expectedConnection, {});
            const target = before.relationships.find((r) => r.id === ref.id);
            if (target) {
                const toTable = before.tables.find((t) => t.name === target.toTable);
                if (toTable?.isAutoDateTable) {
                    throw new Error(redactConnectionSecrets(`Refusing to delete relationship '${ref.id}': its target '${target.toTable}' is an auto date/time table, so deleting it would orphan the source column's date Variation/DefaultHierarchy and leave the model inconsistent. Disable Auto date/time (File > Options and settings > Options > Data Load > Time intelligence) or remove the column's date variation first, then retry.`));
                }
            }
            const result = await this.#liveUnlocked(() => this.call(MS_TOOLS.relationships, 'Delete', { references: [{ name: ref.id }] }), expectedConnection);
            this.#invalidateSnapshot();
            // P6: confirm the delete actually applied via a fresh live re-read.
            const after = await this.#getCachedSnapshotUnlocked(expectedConnection, {});
            if (after.relationships.some((r) => r.id === ref.id)) {
                throw new Error(redactConnectionSecrets(`relationship delete was not applied: live re-read still shows relationship '${ref.id}'`));
            }
            return result;
        });
    }
    // Folder-mode persistence. Live mode persists via the user's Ctrl+S in Desktop.
    // NOTE: the MS MCP's param key is `tmdlFolderPath`, NOT `path`.
    async exportToTmdlFolder(folderPath, expectedConnection) {
        const params = folderPath ? { tmdlFolderPath: folderPath } : undefined;
        return this.#live(() => this.call(MS_TOOLS.database, 'ExportToTmdlFolder', params), expectedConnection);
    }
}
_a = ModelDriver;
function isImportModeDateKeyWriteRejection(message) {
    if (!/\bisKey\b/i.test(message))
        return false;
    return /\b(?:DirectQuery|Import)\b|only supported|not supported|not valid/i.test(message);
}
// The stable prefix updateTable's read-back verifier throws on a silent no-op
// (host accepted the write, fresh re-read does not reflect it). Callers that own
// a richer, actionable verification path (e.g. the mark-as-date gate) match on
// this to convert the raw driver miss into their structured blocker.
const TABLE_UPDATE_NOT_APPLIED_PREFIX = 'table update was not applied';
function isTableUpdateNotApplied(message) {
    return message.toLowerCase().includes(TABLE_UPDATE_NOT_APPLIED_PREFIX);
}
// P6: a batched Create/Update returns `{ results: [{ success, ... }] }`. Throw if
// any item failed so a partial batch never reads back as overall success.
function assertNoBatchFailure(payload, label) {
    if (!isRecord(payload) || !Array.isArray(payload.results))
        return;
    for (const item of payload.results) {
        if (isRecord(item) && item.success === false) {
            const message = str(item, 'message', 'error', 'detail') ?? 'a batched operation item failed';
            throw new Error(redactConnectionSecrets(`${label ?? 'write'} failed: ${message}`));
        }
    }
}
// P1: confirm a column update actually landed by comparing the post-write live
// column against ONLY the fields that were requested. Returns true ("cannot
// disprove") when the target table is not observable in the snapshot, so an
// empty/partial read never produces a false negative; returns false only when
// the live column clearly contradicts the request. `isKey` is best-effort
// (Import models legitimately reject it — see isImportModeDateKeyWriteRejection)
// and is intentionally never asserted here.
function columnUpdateApplied(model, def) {
    const table = model.tables.find((t) => t.name === def.tableName);
    if (!table)
        return true; // target table not observable — do not assert
    const targetName = def.newName ?? def.name;
    const col = table.columns.find((c) => c.name === targetName);
    if (!col)
        return false; // rename/update target must exist after the write
    // Case-insensitive for enumerations whose casing the engine may echo back
    // differently; skip a field entirely when the read does not surface it.
    const eqCI = (a, b) => a === undefined || a.toLowerCase() === b.toLowerCase();
    const eq = (a, b) => a === undefined || a === b;
    // `isHidden` is a cosmetic report-view flag with the SAME Import-mode read-back
    // hazard as `isKey`: the live column List may omit the key, which the parser
    // coerces to `false`, so a hide write that actually landed reads back as `false`
    // and would produce a FALSE NEGATIVE that hard-throws — pushing the agent to ask
    // the user to hide fields that are already hidden. Like isKey, treat it as
    // best-effort and never assert it on read-back.
    if (def.dataType !== undefined && !eqCI(col.dataType, def.dataType))
        return false;
    if (def.summarizeBy !== undefined && !eqCI(col.summarizeBy, def.summarizeBy))
        return false;
    if (def.dataCategory !== undefined && !eqCI(col.dataCategory, def.dataCategory))
        return false;
    if (def.formatString !== undefined && !eq(col.formatString, def.formatString))
        return false;
    if (def.sortByColumn !== undefined && !eq(col.sortByColumn, def.sortByColumn))
        return false;
    if (def.description !== undefined && !eq(col.description, def.description))
        return false;
    if (def.expression !== undefined && !eq(col.expression, def.expression))
        return false;
    return true;
}
// P1 (table parity): confirm a table-level update actually landed, mirroring
// columnUpdateApplied. Compares ONLY the requested scalar fields against the
// fresh snapshot; returns true ("cannot disprove") when the table is not
// observable, and false only on a clear contradiction. `annotations` are a
// best-effort/UNVERIFIED host-side write (used for the governed-policy stamp)
// and are intentionally NOT asserted, so an annotation-only update never throws.
function tableUpdateApplied(model, def) {
    const targetName = def.newName ?? def.name;
    const table = model.tables.find((t) => t.name === targetName);
    if (!table) {
        // Target not observable — cannot disprove (mirrors columnUpdateApplied), so a
        // partial/empty read never yields a false negative. The one exception: a rename
        // whose OLD name is still present clearly did not land.
        if (def.newName !== undefined && model.tables.some((t) => t.name === def.name))
            return false;
        return true;
    }
    const eqCI = (a, b) => a === undefined || a.toLowerCase() === b.toLowerCase();
    const eq = (a, b) => a === undefined || a === b;
    // `isHidden` is cosmetic and carries the Import-mode read-back false-negative
    // hazard (absent List key parses to `false`); like the column case it is
    // best-effort and never asserted on read-back. See columnUpdateApplied.
    if (def.dataCategory !== undefined && !eqCI(table.dataCategory, def.dataCategory))
        return false;
    if (def.description !== undefined && !eq(table.description, def.description))
        return false;
    return true;
}
// Confirm a measure update landed: compare ONLY the requested scalar fields against
// the post-write live measure. Cannot-disprove (returns true) when the measure/table
// is not observable, so a partial read never false-negatives; false only on a clear
// contradiction. Mirrors columnUpdateApplied. A measure update is the exact category
// the project's known design warns can silently no-op on Import, but unlike
// updateColumn it previously had NO read-back.
function measureUpdateApplied(model, def) {
    const table = model.tables.find((t) => t.name === def.tableName);
    if (!table)
        return true; // target table not observable — do not assert
    const measure = table.measures.find((m) => m.name === def.name);
    if (!measure)
        return true; // not observable — cannot disprove
    const collapse = (s) => s.replace(/\s+/g, ' ').trim();
    const eq = (a, b) => a === undefined || a === b;
    // Whitespace-tolerant: the engine may echo the expression with different spacing.
    // Treat an empty read-back expression as "not surfaced" (the enrich Get can omit
    // it), so we cannot-disprove rather than false-negative on an unobservable body.
    if (def.expression !== undefined &&
        measure.expression !== '' &&
        collapse(measure.expression) !== collapse(def.expression)) {
        return false;
    }
    if (def.formatString !== undefined && !eq(measure.formatString, def.formatString))
        return false;
    if (def.description !== undefined && !eq(measure.description, def.description))
        return false;
    return true;
}
// Confirm a relationship update landed: compare ONLY the requested fields against the
// post-write live relationship (found by id). Cannot-disprove when the relationship
// is not observable; false only on a clear contradiction. Re-pointing endpoints,
// flipping cardinality/crossFilter, or toggling isActive are property updates with the
// same Import-mode silent-no-op hazard as column/table updates.
function relationshipUpdateApplied(model, def) {
    const rel = model.relationships.find((r) => r.id === def.id);
    if (!rel)
        return true; // not observable — cannot disprove
    if (def.fromTable !== undefined && rel.fromTable !== def.fromTable)
        return false;
    if (def.fromColumn !== undefined && rel.fromColumn !== def.fromColumn)
        return false;
    if (def.toTable !== undefined && rel.toTable !== def.toTable)
        return false;
    if (def.toColumn !== undefined && rel.toColumn !== def.toColumn)
        return false;
    if (def.isActive !== undefined && rel.isActive !== def.isActive)
        return false;
    if (def.crossFilteringBehavior !== undefined &&
        rel.crossFilteringBehavior !== def.crossFilteringBehavior) {
        return false;
    }
    // Only assert cardinality when the read surfaces one (undefined == PBI default).
    if (def.cardinality !== undefined &&
        rel.cardinality !== undefined &&
        rel.cardinality !== def.cardinality) {
        return false;
    }
    return true;
}
// Confirm an activate landed: the relationship reads back active. Cannot-disprove
// when the relationship id is not observable.
function relationshipActivated(model, id) {
    const rel = model.relationships.find((r) => r.id === id);
    if (!rel)
        return true; // not observable — cannot disprove
    return rel.isActive === true;
}
function isRecord(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function extractAnnotations(m) {
    const out = {};
    const raw = m.annotations;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw)) {
            if (typeof v === 'string')
                out[k] = v;
        }
    }
    else if (Array.isArray(raw)) {
        for (const item of raw) {
            if (isRecord(item)) {
                const k = str(item, 'name', 'key');
                const v = str(item, 'value');
                if (k && v !== undefined)
                    out[k] = v;
            }
        }
    }
    return out;
}
//# sourceMappingURL=model-driver.js.map