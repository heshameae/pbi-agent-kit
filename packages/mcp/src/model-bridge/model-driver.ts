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

import path from 'node:path';
import type {
  Cardinality,
  CrossFilteringBehavior,
  StorageMode,
  TMDLColumn,
  TMDLMeasure,
  TMDLModel,
  TMDLRelationship,
  TMDLRole,
  TMDLTable,
} from 'pbi-core';
import type { McpToolResult } from './ms-mcp-client.js';

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
} as const;

export interface ModelClient {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  reset?(): void;
  // Registers a callback fired when the underlying subprocess/transport drops.
  onReset?(cb: () => void): void;
}

// A dropped bridge subprocess / closed transport / freshly re-spawned but
// not-yet-connected MS MCP all surface as one of these. The "connect to a
// server first" / "no last used connection" forms come from the MS MCP itself
// when the subprocess re-spawned and lost its model connection.
export function isConnectionDrop(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /closed|transport|epipe|econn|not connected|disconnect|reachab|broken pipe|spawn|connect to a server first|no last used connection|no connectionname/.test(
    msg,
  );
}

// Deterministic failures from the MS MCP validating the request itself (bad
// args, already-exists, not-found). Retrying these just burns another request
// timeout for the same guaranteed failure — never retry them.
export function isNonRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /missing required parameter|invalid (argument|parameter|operation)|already exists|not found|bad request|validation/.test(
    msg,
  );
}

export type ConnectionMode = 'live' | 'folder';

export interface ConnectionInfo {
  readonly mode: ConnectionMode;
  readonly connectionString?: string;
  readonly folderPath?: string;
}

export interface TableInventoryRow {
  readonly name: string;
  readonly isHidden: boolean;
  readonly isCalculated: boolean;
  readonly isAutoDateTable: boolean;
  readonly description?: string;
  readonly storageMode?: StorageMode;
  readonly columnCount?: number;
  readonly measureCount?: number;
}

export interface ModelSnapshotOptions {
  readonly includeMeasures?: boolean;
  readonly includeRoles?: boolean;
}

export interface MeasureWrite {
  readonly tableName: string;
  readonly name: string;
  readonly expression?: string;
  readonly formatString?: string;
  readonly description?: string;
}

export interface MeasureRef {
  readonly tableName: string;
  readonly name: string;
}

// --- table/column/relationship write shapes ----------------------------
// Field names mirror the wrapped Microsoft modeling MCP `definitions[]` /
// `references[]` payloads (grounded against awesome-copilot-pbi-data.xml).

export interface TableWrite {
  readonly name: string;
  readonly mode?: string;
  readonly mExpression?: string;
  readonly expression?: string;
  readonly description?: string;
  readonly isHidden?: boolean;
}

export interface TableUpdate {
  readonly name: string;
  readonly newName?: string;
  readonly description?: string;
  readonly isHidden?: boolean;
  // UNVERIFIED: confirm against live MS MCP — `dataCategory` Update key inferred.
  // Used to mark a table as a date table (dataCategory:'Time').
  readonly dataCategory?: string;
}

export interface TableRef {
  readonly name: string;
}

export interface ColumnWrite {
  readonly tableName: string;
  readonly name: string;
  readonly sourceColumn?: string;
  readonly expression?: string;
  readonly dataType?: string;
  readonly summarizeBy?: string;
  readonly formatString?: string;
  // UNVERIFIED: confirm against live MS MCP — `sortByColumn` Update/Create key inferred.
  readonly sortByColumn?: string;
  readonly isHidden?: boolean;
  readonly description?: string;
  // UNVERIFIED: confirm against live MS MCP — `isKey`/`dataCategory` keys inferred.
  readonly isKey?: boolean;
  readonly dataCategory?: string;
}

export interface ColumnUpdate {
  readonly tableName: string;
  readonly name: string;
  readonly newName?: string;
  readonly dataType?: string;
  readonly expression?: string;
  readonly summarizeBy?: string;
  readonly formatString?: string;
  // UNVERIFIED: confirm against live MS MCP — `sortByColumn` Update/Create key inferred.
  readonly sortByColumn?: string;
  readonly isHidden?: boolean;
  readonly description?: string;
  // UNVERIFIED: confirm against live MS MCP — `isKey`/`dataCategory` keys inferred.
  readonly isKey?: boolean;
  readonly dataCategory?: string;
}

export interface ColumnRef {
  readonly tableName: string;
  readonly name: string;
}

export interface RelationshipWrite {
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly cardinality?: Cardinality;
  readonly crossFilteringBehavior?: 'single' | 'both';
  readonly isActive?: boolean;
}

export interface RelationshipUpdate {
  readonly id: string;
  readonly fromTable?: string;
  readonly fromColumn?: string;
  readonly toTable?: string;
  readonly toColumn?: string;
  readonly cardinality?: Cardinality;
  readonly crossFilteringBehavior?: 'single' | 'both';
  readonly isActive?: boolean;
}

export interface RelationshipRef {
  readonly id: string;
}

// One running Power BI Desktop instance discovered via ListLocalInstances.
// Field keys beyond `connectionString` are opportunistic — the MS MCP shape is
// not pinned. See extractLiveInstances for the tolerant parsing.
export interface LiveInstance {
  readonly connectionString: string;
  readonly port?: string;
  readonly name?: string;
  readonly databaseName?: string;
  readonly initialCatalog?: string;
}

export interface ConnectOpts {
  readonly folderPath?: string;
  readonly model?: string;
  readonly livePreferred?: boolean;
  readonly forceFolder?: boolean;
}

// Build the Microsoft-MCP request envelope: { request: { operation, ...params } };
// `List` puts its params under `request.filter` (reference repo behavior).
export function operationArgs(
  operation: string,
  params?: Record<string, unknown>,
): Record<string, unknown> {
  const isList = operation.toLowerCase() === 'list';
  const body =
    params && Object.keys(params).length > 0 ? (isList ? { filter: params } : params) : {};
  return { request: { operation, ...body } };
}

// Map our friendly `expression` to the MS MCP source key `daxExpression` for a
// DAX-defined table/column. Confirmed by the live MS MCP, which rejects a create
// with no source as: "One of DaxExpression, MExpression, EntityName, or SqlQuery
// must be provided" — i.e. `expression` is NOT a recognized key; `daxExpression`
// is (mirroring the already-working `mExpression`). A data column/M table carries
// `sourceColumn`/`mExpression` instead and is left untouched.
export function toDaxSource<T extends { expression?: string }>(
  def: T,
): Omit<T, 'expression'> & { daxExpression?: string } {
  const { expression, ...rest } = def;
  return expression === undefined ? rest : { ...rest, daxExpression: expression };
}

// Mask connection-string secrets before they surface in errors/logs.
export function redactConnectionSecrets(text: string): string {
  return text
    .replace(/(Password|Pwd)\s*=\s*[^;]*/gi, '$1=***')
    .replace(/Data Source\s*=\s*[^;]*/gi, 'Data Source=***');
}

function parseResult(result: McpToolResult): unknown {
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent;
  }
  const text = result.content?.find((c) => c.type === 'text')?.text;
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return undefined;
}

// DAX result shapes differ by host. The local @microsoft/powerbi-modeling-mcp
// returns columnar tables (verified against PowerBIModelingMCP.Library.dll):
//   { success, operation, message, data: { columns: [{ name, dataType }],
//     rows: [[v0, v1, ...]], rowCount, wasTruncated, truncationReason, filePath } }
// and some builds wrap those same columnar tables under result/table containers.
// The public Execute-Queries REST shape is instead { results: [{ tables: [{
// rows: [{ "[Col]": v }] }] }] } (array-of-objects). Normalize local columnar
// tables into rows keyed by column name so pbi_dax_query callers and the
// date/relationship probe parsers all see one shape — and surface engine errors
// that this MCP returns WITHOUT setting isError (success:false envelope or
// non-tabular text), instead of silently yielding zero rows that read as "no
// data".
export function normalizeDaxResult(payload: unknown): unknown {
  if (typeof payload === 'string') {
    // parseResult only returns a raw string when the content text was not JSON.
    // A DAX result is always JSON, so this is an error/Markdown render, not data.
    throw new Error(
      redactConnectionSecrets(
        `DAX query did not return a tabular JSON result: ${payload.slice(0, 400)}`,
      ),
    );
  }
  if (!isRecord(payload)) return payload;
  if (payload.success === false) {
    const message = str(payload, 'message', 'error', 'detail') ?? 'DAX query failed';
    throw new Error(redactConnectionSecrets(`DAX query failed: ${message}`));
  }
  const body = isRecord(payload.data) ? payload.data : payload;
  const direct = normalizeDaxColumnarRecord(body);
  if (direct) return direct;

  const nested = collectDaxColumnarTables(body);
  if (nested.length > 0) return mergeDaxColumnarTables(nested);

  // REST { results/tables } shape, an already-keyed { rows: [{}] }, or any other
  // object — leave it untouched; extractRows / pickArray handle those.
  return payload;
}

interface NormalizedDaxTable {
  readonly columns: string[];
  readonly rows: Record<string, unknown>[];
  readonly rowCount: number;
  readonly wasTruncated?: true;
  readonly truncationReason?: string;
  readonly filePath?: string;
}

function normalizeDaxColumnarRecord(record: Record<string, unknown>): NormalizedDaxTable | null {
  const columns = record.columns;
  const rows = record.rows;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return null;

  const names = columns.map(daxColumnName);
  // Zip positional (array) rows against the column schema; pass already-keyed
  // object rows through. Malformed primitive rows are a bridge/host bug, not
  // valid "empty data" evidence for downstream Date/relationship gates.
  const keyed: Record<string, unknown>[] = [];
  let malformedRows = 0;
  for (const row of rows) {
    if (Array.isArray(row)) {
      keyed.push(zipDaxRow(names, row));
    } else if (isRecord(row)) {
      keyed.push(row);
    } else {
      malformedRows += 1;
    }
  }
  if (malformedRows > 0) {
    throw new Error(
      `DAX query returned ${malformedRows} malformed tabular rows; refusing to treat them as empty data.`,
    );
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

function collectDaxColumnarTables(payload: unknown, depth = 0): NormalizedDaxTable[] {
  if (depth > 8) return [];
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => collectDaxColumnarTables(item, depth + 1));
  }
  if (!isRecord(payload)) return [];

  const table = normalizeDaxColumnarRecord(payload);
  if (table) return [table];

  return Object.values(payload).flatMap((value) => collectDaxColumnarTables(value, depth + 1));
}

function mergeDaxColumnarTables(tables: ReadonlyArray<NormalizedDaxTable>): NormalizedDaxTable {
  const columns: string[] = [];
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  let rowCount = 0;
  let wasTruncated = false;
  const truncationReasons = new Set<string>();
  const filePaths = new Set<string>();

  for (const table of tables) {
    for (const column of table.columns) {
      if (seen.has(column)) continue;
      seen.add(column);
      columns.push(column);
    }
    rows.push(...table.rows);
    rowCount += table.rowCount;
    if (table.wasTruncated === true) wasTruncated = true;
    if (table.truncationReason) truncationReasons.add(table.truncationReason);
    if (table.filePath) filePaths.add(table.filePath);
  }

  return {
    columns,
    rows,
    rowCount,
    ...(wasTruncated ? { wasTruncated: true as const } : {}),
    ...(truncationReasons.size > 0
      ? { truncationReason: [...truncationReasons].join('; ') }
      : {}),
    ...(filePaths.size === 1 ? { filePath: [...filePaths][0] } : {}),
  };
}

function daxColumnName(column: unknown): string {
  if (typeof column === 'string') return column;
  if (isRecord(column)) {
    const name = str(column, 'name', 'columnName');
    if (name !== undefined) return name;
  }
  return '';
}

function zipDaxRow(
  names: ReadonlyArray<string>,
  values: ReadonlyArray<unknown>,
): Record<string, unknown> {
  const keyed: Record<string, unknown> = {};
  for (let i = 0; i < names.length; i += 1) {
    keyed[names[i] || `__col${i}`] = values[i];
  }
  return keyed;
}

// Find the first array in a payload, checking common container keys then any
// array-valued property. Tolerant by design (shapes not pinned).
const ARRAY_KEYS = ['data', 'items', 'definitions', 'value', 'values', 'results', 'rows'];
export function pickArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ARRAY_KEYS) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

// Deep-collect connection strings from a ListLocalInstances payload.
export function collectConnectionStrings(payload: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      if (/data source\s*=/i.test(node)) found.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (
          typeof value === 'string' &&
          /^(connectionstring|datasource|connection)$/i.test(key) &&
          value.trim().length > 0
        ) {
          found.push(value);
        } else {
          visit(value);
        }
      }
    }
  };
  visit(payload);
  return [...new Set(found)];
}

function str(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function num(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

// Parse a ListLocalInstances payload into structured per-instance records so
// callers can match an instance by name/database when several Desktops are open.
// Tolerant by design (the MS MCP shape is not pinned): reads connectionString
// then opportunistically lifts a friendly name / database / port. If no array
// records are found, synthesizes minimal instances from collectConnectionStrings.
export function extractLiveInstances(payload: unknown): LiveInstance[] {
  const out: LiveInstance[] = [];
  for (const item of pickArray(payload)) {
    if (!isRecord(item)) continue;
    const connectionString = str(item, 'connectionString', 'dataSource', 'connection');
    // Skip records that carry no usable connection string (no `Data Source=`).
    if (!connectionString || !/data source\s*=/i.test(connectionString)) continue;
    out.push(buildInstance(connectionString, item));
  }
  // Fallback: payload had no parseable records — synthesize from raw strings.
  if (out.length === 0) {
    for (const cs of collectConnectionStrings(payload)) out.push(buildInstance(cs));
  }
  return dedupeInstances(out);
}

function buildInstance(connectionString: string, rec?: Record<string, unknown>): LiveInstance {
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

function dedupeInstances(instances: LiveInstance[]): LiveInstance[] {
  const seen = new Set<string>();
  const out: LiveInstance[] = [];
  for (const inst of instances) {
    if (seen.has(inst.connectionString)) continue;
    seen.add(inst.connectionString);
    out.push(inst);
  }
  return out;
}

// Normalize a model name / folder path to a comparable token so a `model` hint
// or a folderPath basename can be matched against an instance's name/database.
// Strips the .SemanticModel/definition wrapper and common file suffixes, then
// lowercases + trims. Dataset-agnostic: no embedded names.
export function normalizeModelName(s: string): string {
  const portable = s.replace(/\\/g, '/');
  let base = path.basename(portable);
  // `/x/Model.SemanticModel/definition` → use the parent folder name.
  if (base.toLowerCase() === 'definition') base = path.basename(path.dirname(portable));
  for (const suffix of ['.SemanticModel', '.pbix', '.pbip', '.Dataset']) {
    if (base.toLowerCase().endsWith(suffix.toLowerCase())) {
      base = base.slice(0, base.length - suffix.length);
      break;
    }
  }
  return base.toLowerCase().trim();
}

function normalizedConnectionHint(opts?: ConnectOpts): string | null {
  const raw = opts?.model ?? opts?.folderPath;
  return raw ? normalizeModelName(raw) : null;
}

function normalizeFolderCachePath(folderPath: string): string {
  return path.resolve(folderPath.replace(/\\/g, '/'));
}

function connectionRequestKey(opts?: ConnectOpts): string {
  const intent =
    opts?.forceFolder === true ? 'folder' : opts?.livePreferred === true ? 'live' : 'auto';
  const model = opts?.model ? normalizeModelName(opts.model) : '';
  const folder = opts?.folderPath ? normalizeFolderCachePath(opts.folderPath) : '';
  return `${intent}|model=${model}|folder=${folder}`;
}

function connectionCacheKey(connection: ConnectionInfo | null): string | null {
  if (!connection) return null;
  if (connection.mode === 'live') {
    return connection.connectionString ? `live|${connection.connectionString}` : null;
  }
  return connection.folderPath ? `folder|${normalizeFolderCachePath(connection.folderPath)}` : null;
}

function snapshotOptionsKey(options: ModelSnapshotOptions = {}): string {
  return JSON.stringify({
    includeMeasures: options.includeMeasures !== false,
    includeRoles: options.includeRoles !== false,
  });
}

function liveInstanceMatchesHint(inst: LiveInstance, normalizedHint: string): boolean {
  const candidates = [inst.name, inst.databaseName, inst.initialCatalog, inst.port]
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
    .map(normalizeModelName);
  return candidates.includes(normalizedHint);
}

// Build the multi-instance disambiguation error. MUST start with
// "Found N open Power BI Desktop instances" (an existing test asserts /found N open/i).
// Lists each instance by friendly name/database (NEVER the raw connection string —
// `Data Source=` is a secret) and tells the user how to pick one. Never auto-picks.
function multiInstanceError(instances: LiveInstance[], hint?: string): string {
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

function bool(obj: Record<string, unknown>, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'boolean') return v;
  }
  return fallback;
}

// Lift a boolean only when explicitly present; otherwise undefined (so an absent
// key stays undefined, not coerced to false — keeps a gated rule like MOD028
// silent rather than risking a false positive).
function boolOrUndef(obj: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'boolean') return v;
  }
  return undefined;
}

// Normalize a storage-mode token (any casing) to a StorageMode; undefined when
// absent or unrecognized.
function normalizeStorageMode(value?: string): StorageMode | undefined {
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

function cardinalitySides(cardinality: Cardinality): {
  fromCardinality: 'many' | 'one';
  toCardinality: 'many' | 'one';
} {
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

type CardinalitySide = 'many' | 'one' | undefined;

function normalizeCardinalitySide(value?: string): CardinalitySide {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'many') return 'many';
  if (normalized === 'one') return 'one';
  return undefined;
}

function deriveKnownCardinality(fromCard?: string, toCard?: string): Cardinality | undefined {
  const from = normalizeCardinalitySide(fromCard);
  const to = normalizeCardinalitySide(toCard);
  if (from === undefined || to === undefined) return undefined;
  if (from === 'many' && to === 'many') return 'manyToMany';
  if (from === 'one' && to === 'many') return 'oneToMany';
  if (from === 'one' && to === 'one') return 'oneToOne';
  return 'manyToOne';
}

function normalizeCrossFilteringBehavior(value?: string): CrossFilteringBehavior {
  return value && /both/i.test(value) ? 'both' : 'single';
}

function definedOnly<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function hasTableUpdateFields(def: Record<string, unknown>): boolean {
  return ['description', 'isHidden', 'dataCategory'].some((key) => def[key] !== undefined);
}

function hasColumnUpdateFields(def: Record<string, unknown>): boolean {
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
  readonly #client: ModelClient;
  #connection: ConnectionInfo | null = null;
  #connectionHint: string | null = null;
  #lastOpts: ConnectOpts | undefined;
  #connectPending: Promise<ConnectionInfo> | null = null;
  #connectPendingKey: string | null = null;
  #operationQueue: Promise<void> = Promise.resolve();
  // Short-lived snapshot cache: reused across reads/gates within one batch,
  // invalidated on every write and on any connection reset so the DAX gate
  // always sees prior committed writes. The TTL bounds staleness from edits
  // made directly in Desktop between calls.
  #snapshot: { model: TMDLModel; at: number; connectionKey: string; optionsKey: string } | null =
    null;
  #snapshotPending: { promise: Promise<TMDLModel>; optionsKey: string } | null = null;
  static readonly #SNAPSHOT_TTL_MS = 5_000;

  constructor(client: ModelClient) {
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

  get connection(): ConnectionInfo | null {
    return this.#connection;
  }

  // Raw operation call with secret-safe error wrapping.
  async call(tool: string, operation: string, params?: Record<string, unknown>): Promise<unknown> {
    let result: McpToolResult;
    try {
      result = await this.#client.callTool(tool, operationArgs(operation, params));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(redactConnectionSecrets(`${tool}/${operation} failed: ${msg}`));
    }
    if (result.isError) {
      const text =
        result.content?.find((c) => c.type === 'text')?.text ?? `${tool}/${operation} errored`;
      throw new Error(redactConnectionSecrets(text));
    }
    return parseResult(result);
  }

  // Compat shim: returns just the connection strings (existing callers/tests
  // rely on this). New code wanting per-instance fields uses listLiveInstances.
  async listLocalInstances(): Promise<string[]> {
    const payload = await this.call(MS_TOOLS.connection, 'ListLocalInstances');
    return collectConnectionStrings(payload);
  }

  // Structured discovery: every running Desktop instance with whatever name /
  // database / port the MS MCP exposes, so #connect can match by name.
  async listLiveInstances(): Promise<LiveInstance[]> {
    const payload = await this.call(MS_TOOLS.connection, 'ListLocalInstances');
    return extractLiveInstances(payload);
  }

  // Auto-detect connection. Cached + serialized (concurrent callers share one
  // connect). The cache is invalidated on a transport drop (onReset) or by #live.
  // A later explicit model/folder hint can switch targets when it no longer
  // matches the cached connection, which keeps multi-window sessions deterministic.
  async ensureConnection(opts?: ConnectOpts): Promise<ConnectionInfo> {
    return this.#withOperationLock(() => this.#ensureConnectionUnlocked(opts));
  }

  async #ensureConnectionUnlocked(opts?: ConnectOpts): Promise<ConnectionInfo> {
    if (opts) this.#lastOpts = opts;
    const requestedHint = normalizedConnectionHint(opts);
    const requestKey = connectionRequestKey(opts);
    if (this.#connection) {
      const forceFolderAgainstLive =
        opts?.forceFolder === true && this.#connection.mode !== 'folder';
      const livePreferredFolder =
        opts?.livePreferred === true && this.#connection.mode === 'folder';
      const modelOnlySelectorAgainstFolder =
        this.#connection.mode === 'folder' && requestedHint && opts?.model && !opts.folderPath;
      const cachedConnectionMatches =
        !requestedHint && !opts?.folderPath
          ? true
          : this.#connectionMatchesRequest(opts, requestedHint);
      if (
        !forceFolderAgainstLive &&
        !livePreferredFolder &&
        !modelOnlySelectorAgainstFolder &&
        cachedConnectionMatches
      ) {
        return this.#connection;
      }
      this.#connection = null;
      this.#connectionHint = null;
      this.#invalidateSnapshot();
    }
    if (this.#connectPending) {
      if (this.#connectPendingKey === requestKey) return this.#connectPending;
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

  #connectionMatchesRequest(opts: ConnectOpts | undefined, normalizedHint: string | null): boolean {
    if (!this.#connection) return false;
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

  #connectionMatchesLiveHint(normalizedHint: string): boolean {
    if (this.#connectionHint === normalizedHint) return true;
    if (!this.#connection) return false;
    if (this.#connection.mode === 'folder') return false;
    if (!this.#connection.connectionString) return false;
    return liveInstanceMatchesHint(
      buildInstance(this.#connection.connectionString),
      normalizedHint,
    );
  }

  async #connect(opts?: ConnectOpts): Promise<ConnectionInfo> {
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
    let instances: LiveInstance[] = [];
    let discoveryError: string | undefined;
    try {
      instances = await this.listLiveInstances();
    } catch (err) {
      // If we have a folderPath we can still fall back to offline; otherwise surface it.
      discoveryError = err instanceof Error ? err.message : String(err);
      if (!opts?.folderPath) {
        throw new Error(
          `Could not reach the Power BI modeling MCP to discover a live Desktop instance. Live modeling requires Windows with Power BI Desktop open. (${discoveryError})`,
        );
      }
    }
    if (instances.length === 1) {
      const instance = instances[0] as LiveInstance;
      const hint =
        opts?.model ?? (opts?.folderPath ? normalizeModelName(opts.folderPath) : undefined);
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
      const hint =
        opts?.model ?? (opts?.folderPath ? normalizeModelName(opts.folderPath) : undefined);
      if (!hint) throw new Error(multiInstanceError(instances));
      const normalizedHint = normalizeModelName(hint);
      const matches = instances.filter((inst) => liveInstanceMatchesHint(inst, normalizedHint));
      if (matches.length === 1) {
        const connectionString = (matches[0] as LiveInstance).connectionString;
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

    throw new Error(
      'No open Power BI Desktop instance found, and no folderPath supplied for folder mode. Open the .pbip in Desktop, or pass a .SemanticModel/definition folder.',
    );
  }

  // Run an operation against a connected model, retrying once if the connection
  // drops (or the subprocess re-spawned unconnected): invalidate the cache,
  // reset the subprocess, re-Connect, and re-run.
  async #live<T>(fn: () => Promise<T>, expectedConnection?: ConnectionInfo): Promise<T> {
    return this.#withOperationLock(() => this.#liveUnlocked(fn, expectedConnection));
  }

  async #withOperationLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.#operationQueue;
    let release!: () => void;
    this.#operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  async #liveUnlocked<T>(
    fn: () => Promise<T>,
    expectedConnection?: ConnectionInfo,
    options: { readonly retryOnConnectionDrop?: boolean; readonly operationLabel?: string } = {},
  ): Promise<T> {
    await this.#ensureOperationConnection(expectedConnection);
    try {
      return await fn();
    } catch (err) {
      // Never retry a deterministic validation failure — it will just fail again
      // after burning another request timeout.
      if (isNonRetryable(err) || !isConnectionDrop(err)) throw err;
      this.#connection = null;
      this.#connectionHint = null;
      this.#snapshot = null;
      this.#snapshotPending = null;
      this.#client.reset?.();
      if (options.retryOnConnectionDrop === false) {
        const m = err instanceof Error ? err.message : String(err);
        throw new Error(
          redactConnectionSecrets(
            `Model bridge write result unknown after connection drop during ${options.operationLabel ?? 'write'}. The operation may already have been applied; refusing to replay a non-idempotent write without readback. Last error: ${m}`,
          ),
        );
      }
      try {
        await this.#ensureOperationConnection(expectedConnection);
        return await fn();
      } catch (retryErr) {
        const m = retryErr instanceof Error ? retryErr.message : String(retryErr);
        throw new Error(
          redactConnectionSecrets(
            `Model bridge connection dropped and could not be re-established after one retry. Check that Power BI Desktop is open with the .pbip loaded (live mode), or that the folder path is valid (offline mode). Last error: ${m}`,
          ),
        );
      }
    }
  }

  async #ensureOperationConnection(expectedConnection?: ConnectionInfo): Promise<void> {
    if (!expectedConnection) {
      await this.#ensureConnectionUnlocked();
      return;
    }
    if (this.#connectionMatchesExpected(expectedConnection)) return;
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

  #connectionMatchesExpected(expectedConnection: ConnectionInfo): boolean {
    if (!this.#connection) return false;
    if (expectedConnection.mode !== this.#connection.mode) return false;
    if (expectedConnection.mode === 'live') {
      return (
        expectedConnection.connectionString !== undefined &&
        this.#connection.connectionString === expectedConnection.connectionString
      );
    }
    return (
      expectedConnection.folderPath !== undefined &&
      this.#connection.folderPath !== undefined &&
      normalizeFolderCachePath(this.#connection.folderPath) ===
        normalizeFolderCachePath(expectedConnection.folderPath)
    );
  }

  // --- reads -------------------------------------------------------------

  async listTablesRaw(expectedConnection?: ConnectionInfo): Promise<Record<string, unknown>[]> {
    return this.#live(() => this.#listTablesRawUnlocked(), expectedConnection);
  }
  async listTableInventoryRaw(expectedConnection?: ConnectionInfo): Promise<TableInventoryRow[]> {
    return (await this.listTablesRaw(expectedConnection))
      .map((table): TableInventoryRow | null => {
        const name = str(table, 'name', 'tableName');
        if (!name) return null;
        const nestedColumns = table.columns;
        const nestedMeasures = table.measures;
        const columnCount =
          num(table, 'columnCount', 'columnsCount') ??
          (Array.isArray(nestedColumns) ? nestedColumns.length : undefined);
        const measureCount =
          num(table, 'measureCount', 'measuresCount') ??
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
      .filter((table): table is TableInventoryRow => table !== null);
  }
  async listColumnsRaw(expectedConnection?: ConnectionInfo): Promise<Record<string, unknown>[]> {
    return this.#live(() => this.#listColumnsRawUnlocked(), expectedConnection);
  }
  async listMeasuresRaw(expectedConnection?: ConnectionInfo): Promise<Record<string, unknown>[]> {
    return this.#live(() => this.#listMeasuresRawUnlocked(), expectedConnection);
  }

  // The live measure List returns only { name, description } — no table,
  // expression, or formatString. Enrich with a single batched Get
  // (references: [{ name }]) which returns the full definitions.
  async listMeasuresEnriched(
    expectedConnection?: ConnectionInfo,
  ): Promise<Record<string, unknown>[]> {
    return this.#live(() => this.#listMeasuresEnrichedUnlocked(), expectedConnection);
  }
  async listRelationshipsRaw(
    expectedConnection?: ConnectionInfo,
  ): Promise<Record<string, unknown>[]> {
    return this.#live(() => this.#listRelationshipsRawUnlocked(), expectedConnection);
  }
  // RLS roles read. A per-role Get may be needed to retrieve tablePermissions
  // (mirroring the measure List→Get enrich); the assembly below tolerates either
  // shape. The CALLER (getModelSnapshot) wraps this in try/catch so an
  // unsupported op degrades to no `roles` key rather than breaking the snapshot.
  async listRolesRaw(expectedConnection?: ConnectionInfo): Promise<Record<string, unknown>[]> {
    return this.#live(() => this.#listRolesRawUnlocked(), expectedConnection);
  }
  async daxQuery(query: string, expectedConnection?: ConnectionInfo): Promise<unknown> {
    return this.#live(
      async () => normalizeDaxResult(await this.call(MS_TOOLS.dax, 'Execute', { query })),
      expectedConnection,
    );
  }

  async refreshModel(
    refreshType: 'Automatic' | 'Full' | 'Calculate' = 'Automatic',
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    return this.#write(
      () => this.call(MS_TOOLS.model, 'Refresh', { refreshType }),
      expectedConnection,
    );
  }

  // Assemble the live model into pbi-core's TMDLModel so existing validators reuse.
  async getModelSnapshot(
    modelPath = '(live)',
    options: ModelSnapshotOptions = {},
    expectedConnection?: ConnectionInfo,
  ): Promise<TMDLModel> {
    return this.#live(() => this.#getModelSnapshotUnlocked(modelPath, options), expectedConnection);
  }

  async getFreshSnapshot(
    expectedConnection?: ConnectionInfo,
    options: ModelSnapshotOptions = {},
  ): Promise<TMDLModel> {
    return this.#withOperationLock(() =>
      this.#liveUnlocked(
        () => this.#getModelSnapshotUnlocked('(live)', options),
        expectedConnection,
      ),
    );
  }

  async #getModelSnapshotUnlocked(
    modelPath = '(live)',
    options: ModelSnapshotOptions = {},
  ): Promise<TMDLModel> {
    const includeMeasures = options.includeMeasures !== false;
    const includeRoles = options.includeRoles !== false;
    const [rawTables, rawColumns, rawMeasures, rawRels] = await Promise.all([
      this.#listTablesRawUnlocked(),
      this.#listColumnsRawUnlocked(),
      includeMeasures ? this.#listMeasuresEnrichedUnlocked() : Promise.resolve([]),
      this.#listRelationshipsRawUnlocked(),
    ]);

    // UNVERIFIED: RLS-roles read op is unconfirmed. Best-effort: a failure (op
    // not supported / errored) degrades to NO `roles` key so the snapshot — which
    // every validator depends on — can never break on the unconfirmed op.
    let rawRoles: Record<string, unknown>[] = [];
    let rolesCaptured = false;
    if (includeRoles) {
      try {
        rawRoles = await this.#listRolesRawUnlocked();
        rolesCaptured = true;
      } catch {
        rawRoles = [];
      }
    }

    const columnsByTable = new Map<string, TMDLColumn[]>();
    const pushColumn = (table: string, c: Record<string, unknown>): void => {
      const name = str(c, 'name', 'columnName') ?? '';
      if (!table || !name) return;
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
      const col: TMDLColumn = {
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
      const nested = (entry as { columns?: unknown }).columns;
      if (Array.isArray(nested)) {
        for (const c of nested) if (isRecord(c)) pushColumn(table, c);
      } else {
        pushColumn(table, entry);
      }
    }

    const measuresByTable = new Map<string, TMDLMeasure[]>();
    for (const m of rawMeasures) {
      const table = str(m, 'tableName', 'table') ?? '';
      const name = str(m, 'name', 'measureName') ?? '';
      if (!table || !name) continue;
      const measure: TMDLMeasure = {
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

    const tables: TMDLTable[] = rawTables
      .map((t): TMDLTable | null => {
        const name = str(t, 'name', 'tableName');
        if (!name) return null;
        // UNVERIFIED: table storage-mode key + value casing inferred. The MS MCP
        // may expose it as `mode`/`storageMode`/`modeType`; normalize tolerantly
        // (undefined when absent keeps MOD028's DQ gate silent).
        const storageMode = normalizeStorageMode(str(t, 'mode', 'storageMode', 'modeType'));
        const dataCategory = str(t, 'dataCategory');
        const expression = str(t, 'expression', 'daxExpression', 'source', 'query');
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
        };
      })
      .filter((t): t is TMDLTable => t !== null);

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

    const relationships: TMDLRelationship[] = rawRels
      .map((r, i): TMDLRelationship | null => {
        const fromTable = str(r, 'fromTable', 'fromTableName');
        const fromColumn = str(r, 'fromColumn', 'fromColumnName');
        const toTable = str(r, 'toTable', 'toTableName');
        const toColumn = str(r, 'toColumn', 'toColumnName');
        if (!fromTable || !fromColumn || !toTable || !toColumn) return null;
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
      .filter((r): r is TMDLRelationship => r !== null);

    // UNVERIFIED: roles assembly. Tolerant lifts over inferred keys — the role
    // record's name + a tablePermissions/permissions array of { table,
    // filterExpression } rows. Drop roles with no name and permissions with no
    // table. Omit `roles` from the model when empty so it stays undefined.
    const roles: TMDLRole[] = rawRoles
      .map((r): TMDLRole => {
        const permsRaw = (r as { tablePermissions?: unknown }).tablePermissions ?? r.permissions;
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
      ...(rolesCaptured ? { rolesCaptured: true, roles } : {}),
    };
  }

  async #listTablesRawUnlocked(): Promise<Record<string, unknown>[]> {
    return pickArray(await this.call(MS_TOOLS.tables, 'List')).filter(isRecord);
  }

  async #listColumnsRawUnlocked(): Promise<Record<string, unknown>[]> {
    return pickArray(await this.call(MS_TOOLS.columns, 'List')).filter(isRecord);
  }

  async #listMeasuresRawUnlocked(): Promise<Record<string, unknown>[]> {
    return pickArray(await this.call(MS_TOOLS.measures, 'List')).filter(isRecord);
  }

  async #listMeasuresEnrichedUnlocked(): Promise<Record<string, unknown>[]> {
    const names = (await this.#listMeasuresRawUnlocked())
      .map((m) => str(m, 'name', 'measureName'))
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (names.length === 0) return [];
    const got = await this.call(MS_TOOLS.measures, 'Get', {
      references: names.map((name) => ({ name })),
    });
    // Batched Get returns { results: [{ success, data: { ...measure } }, ...] }.
    // pickArray grabs `results`; unwrap each item's `data`. Tolerate a flat shape.
    return pickArray(got)
      .map((r) => (isRecord(r) && isRecord(r.data) ? r.data : r))
      .filter(isRecord);
  }

  async #listRelationshipsRawUnlocked(): Promise<Record<string, unknown>[]> {
    return pickArray(await this.call(MS_TOOLS.relationships, 'List')).filter(isRecord);
  }

  async #listRolesRawUnlocked(): Promise<Record<string, unknown>[]> {
    return pickArray(await this.call(MS_TOOLS.roles, 'List')).filter(isRecord);
  }

  // Snapshot reused across reads and the per-write DAX gate within one batch.
  // Dedupes concurrent callers and serves a fresh-enough result; otherwise
  // re-reads. Invalidated by every write (below) and by reset(), so the gate
  // always sees prior committed writes.
  async getCachedSnapshot(
    expectedConnection?: ConnectionInfo,
    options: ModelSnapshotOptions = {},
  ): Promise<TMDLModel> {
    return this.#withOperationLock(() =>
      this.#getCachedSnapshotUnlocked(expectedConnection, options),
    );
  }

  async #getCachedSnapshotUnlocked(
    expectedConnection?: ConnectionInfo,
    options: ModelSnapshotOptions = {},
  ): Promise<TMDLModel> {
    await this.#ensureOperationConnection(expectedConnection);
    const connectionKey = connectionCacheKey(this.#connection);
    const optionsKey = snapshotOptionsKey(options);
    const now = Date.now();
    if (
      this.#snapshot &&
      connectionKey !== null &&
      this.#snapshot.connectionKey === connectionKey &&
      this.#snapshot.optionsKey === optionsKey &&
      now - this.#snapshot.at < ModelDriver.#SNAPSHOT_TTL_MS
    ) {
      return this.#snapshot.model;
    }
    if (this.#snapshotPending && this.#snapshotPending.optionsKey === optionsKey) {
      return this.#snapshotPending.promise;
    }
    const promise = this.#liveUnlocked(
      () => this.#getModelSnapshotUnlocked('(live)', options),
      expectedConnection,
    )
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

  #invalidateSnapshot(): void {
    this.#snapshot = null;
    this.#snapshotPending = null;
  }

  async #write<T>(
    fn: () => Promise<T>,
    expectedConnection?: ConnectionInfo,
    options: { readonly retryOnConnectionDrop?: boolean; readonly operationLabel?: string } = {},
  ): Promise<T> {
    return this.#withOperationLock(async () => {
      const result = await this.#liveUnlocked(fn, expectedConnection, options);
      this.#invalidateSnapshot();
      return result;
    });
  }

  // --- writes ------------------------------------------------------------

  async createMeasure(def: MeasureWrite, expectedConnection?: ConnectionInfo): Promise<unknown> {
    return this.#write(
      () => this.call(MS_TOOLS.measures, 'Create', { definitions: [def] }),
      expectedConnection,
      { retryOnConnectionDrop: false, operationLabel: 'measure create' },
    );
  }
  async updateMeasure(def: MeasureWrite, expectedConnection?: ConnectionInfo): Promise<unknown> {
    return this.#write(
      () => this.call(MS_TOOLS.measures, 'Update', { definitions: [def] }),
      expectedConnection,
    );
  }
  async deleteMeasure(ref: MeasureRef, expectedConnection?: ConnectionInfo): Promise<unknown> {
    return this.#write(
      () =>
        this.call(MS_TOOLS.measures, 'Delete', { references: [ref], shouldCascadeDelete: false }),
      expectedConnection,
    );
  }

  // -- tables --
  async createTable(def: TableWrite, expectedConnection?: ConnectionInfo): Promise<unknown> {
    return this.#write(
      () => this.call(MS_TOOLS.tables, 'Create', { definitions: [toDaxSource(def)] }),
      expectedConnection,
      { retryOnConnectionDrop: false, operationLabel: 'table create' },
    );
  }
  async updateTable(def: TableUpdate, expectedConnection?: ConnectionInfo): Promise<unknown> {
    return this.#write(async () => {
      const { newName, ...updateDef } = def;
      let result: unknown;
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
    }, expectedConnection);
  }
  async deleteTable(ref: TableRef, expectedConnection?: ConnectionInfo): Promise<unknown> {
    // UNVERIFIED: confirm against live MS MCP tool list — Delete not in the capability table.
    // Attempt + surface a clean error if unsupported; NEVER fall back to disk edits.
    return this.#write(
      () => this.call(MS_TOOLS.tables, 'Delete', { references: [ref], shouldCascadeDelete: false }),
      expectedConnection,
    );
  }

  // -- columns --
  async createColumn(def: ColumnWrite, expectedConnection?: ConnectionInfo): Promise<unknown> {
    return this.#write(
      () => this.call(MS_TOOLS.columns, 'Create', { definitions: [toDaxSource(def)] }),
      expectedConnection,
      { retryOnConnectionDrop: false, operationLabel: 'column create' },
    );
  }
  async createColumns(
    defs: ReadonlyArray<ColumnWrite>,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    return this.#write(
      () =>
        this.call(MS_TOOLS.columns, 'Create', {
          definitions: defs.map((def) => toDaxSource(def)),
        }),
      expectedConnection,
      { retryOnConnectionDrop: false, operationLabel: 'columns create' },
    );
  }
  async updateColumn(def: ColumnUpdate, expectedConnection?: ConnectionInfo): Promise<unknown> {
    return this.#write(async () => {
      const { newName, ...updateDef } = def;
      let result: unknown;
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
          definitions: [toDaxSource(remaining as unknown as ColumnUpdate)],
        });
      }
      return result ?? {};
    }, expectedConnection);
  }
  async updateColumns(
    defs: ReadonlyArray<ColumnUpdate>,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    return this.#write(
      () =>
        this.call(MS_TOOLS.columns, 'Update', {
          definitions: defs.map((def) => toDaxSource(def)),
        }),
      expectedConnection,
    );
  }
  async deleteColumn(ref: ColumnRef, expectedConnection?: ConnectionInfo): Promise<unknown> {
    // UNVERIFIED: confirm against live MS MCP tool list — Delete not in the capability table.
    return this.#write(
      () =>
        this.call(MS_TOOLS.columns, 'Delete', { references: [ref], shouldCascadeDelete: false }),
      expectedConnection,
    );
  }

  // Mark a table as a Power BI date table: set the table's dataCategory to
  // 'Time' and flag the chosen date column as the key. This is what enables
  // time-intelligence DAX (YTD/PY/YoY) and clears MODB1/MODB2.
  // UNVERIFIED: the MS MCP `dataCategory` (table Update) and `isKey` (column
  // Update) keys are inferred; both go through the standard Update path.
  async markAsDateTable(
    tableName: string,
    dateColumn: string,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    await this.updateTable({ name: tableName, dataCategory: 'Time' }, expectedConnection);
    return this.updateColumn({ tableName, name: dateColumn, isKey: true }, expectedConnection);
  }

  // -- relationships --
  // The driver owns the MS wire-format quirk: crossFilteringBehavior is
  // 'single'|'both' in our API but 'OneDirection'|'BothDirections' on the wire.
  #translateRel<
    T extends { cardinality?: Cardinality; crossFilteringBehavior?: 'single' | 'both' },
  >(
    def: T,
  ): Omit<T, 'crossFilteringBehavior' | 'cardinality'> & {
    crossFilteringBehavior?: string;
    fromCardinality?: 'many' | 'one';
    toCardinality?: 'many' | 'one';
  } {
    const { cardinality, crossFilteringBehavior, ...rest } = def;
    return {
      ...rest,
      ...(cardinality ? cardinalitySides(cardinality) : {}),
      ...(crossFilteringBehavior === undefined
        ? {}
        : {
            crossFilteringBehavior:
              crossFilteringBehavior === 'both' ? 'BothDirections' : 'OneDirection',
          }),
    };
  }

  async createRelationship(
    def: RelationshipWrite,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    return this.#write(
      () => this.call(MS_TOOLS.relationships, 'Create', { definitions: [this.#translateRel(def)] }),
      expectedConnection,
      { retryOnConnectionDrop: false, operationLabel: 'relationship create' },
    );
  }
  async createRelationships(
    defs: ReadonlyArray<RelationshipWrite>,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    return this.#write(
      () =>
        this.call(MS_TOOLS.relationships, 'Create', {
          definitions: defs.map((def) => this.#translateRel(def)),
        }),
      expectedConnection,
      { retryOnConnectionDrop: false, operationLabel: 'relationships create' },
    );
  }
  async updateRelationship(
    def: RelationshipUpdate,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    // UNVERIFIED: confirm against live MS MCP tool list — Update identity shape (name=id) unconfirmed.
    const { id, ...changes } = def;
    const translated = this.#translateRel(changes);
    return this.#write(
      () =>
        this.call(MS_TOOLS.relationships, 'Update', { definitions: [{ name: id, ...translated }] }),
      expectedConnection,
    );
  }
  async updateRelationships(
    defs: ReadonlyArray<RelationshipUpdate>,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    return this.#write(
      () =>
        this.call(MS_TOOLS.relationships, 'Update', {
          definitions: defs.map((def) => {
            const { id, ...changes } = def;
            return { name: id, ...this.#translateRel(changes) };
          }),
        }),
      expectedConnection,
    );
  }
  async activateRelationship(
    ref: RelationshipRef,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    // Activate IS a confirmed op (relationship_operations: …, Activate, Deactivate).
    // UNVERIFIED: the references:[{name}] envelope is inferred from Deactivate's
    // confirmed shape (Activate's own envelope is not separately documented).
    return this.#write(
      () => this.call(MS_TOOLS.relationships, 'Activate', { references: [{ name: ref.id }] }),
      expectedConnection,
    );
  }
  async deactivateRelationship(
    ref: RelationshipRef,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    return this.#write(
      () => this.call(MS_TOOLS.relationships, 'Deactivate', { references: [{ name: ref.id }] }),
      expectedConnection,
    );
  }
  async deleteRelationship(
    ref: RelationshipRef,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    // UNVERIFIED: confirm against live MS MCP tool list — Delete not in the op list.
    // Attempt + surface a clean error if unsupported; NEVER fall back to disk edits.
    return this.#write(
      () => this.call(MS_TOOLS.relationships, 'Delete', { references: [{ name: ref.id }] }),
      expectedConnection,
    );
  }

  // Folder-mode persistence. Live mode persists via the user's Ctrl+S in Desktop.
  // NOTE: the MS MCP's param key is `tmdlFolderPath`, NOT `path`.
  async exportToTmdlFolder(
    folderPath?: string,
    expectedConnection?: ConnectionInfo,
  ): Promise<unknown> {
    const params = folderPath ? { tmdlFolderPath: folderPath } : undefined;
    return this.#live(
      () => this.call(MS_TOOLS.database, 'ExportToTmdlFolder', params),
      expectedConnection,
    );
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function extractAnnotations(m: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = m.annotations;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isRecord(item)) {
        const k = str(item, 'name', 'key');
        const v = str(item, 'value');
        if (k && v !== undefined) out[k] = v;
      }
    }
  }
  return out;
}
