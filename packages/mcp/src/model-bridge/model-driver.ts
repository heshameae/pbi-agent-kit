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
import {
  type StorageMode,
  type TMDLColumn,
  type TMDLMeasure,
  type TMDLModel,
  type TMDLRelationship,
  type TMDLRole,
  type TMDLTable,
  deriveCardinality,
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
  database: 'database_operations',
  // UNVERIFIED: the MS modeling MCP RLS-roles tool name is inferred (likely a
  // `role_operations` / security-operations tool). Confirm against a live
  // Windows Desktop payload. The roles read is wrapped in try/catch so an
  // unsupported op degrades to no `roles` key (getModelSnapshot never breaks).
  roles: 'role_operations',
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

export interface MeasureWrite {
  readonly tableName: string;
  readonly name: string;
  readonly expression: string;
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
  readonly crossFilteringBehavior?: 'single' | 'both';
  readonly isActive?: boolean;
}

export interface RelationshipUpdate {
  readonly id: string;
  readonly fromTable?: string;
  readonly fromColumn?: string;
  readonly toTable?: string;
  readonly toColumn?: string;
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
  let base = path.basename(s);
  // `/x/Model.SemanticModel/definition` → use the parent folder name.
  if (base.toLowerCase() === 'definition') base = path.basename(path.dirname(s));
  for (const suffix of ['.SemanticModel', '.pbix', '.pbip', '.Dataset']) {
    if (base.toLowerCase().endsWith(suffix.toLowerCase())) {
      base = base.slice(0, base.length - suffix.length);
      break;
    }
  }
  return base.toLowerCase().trim();
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
  return `${lead}\n${lines}\nPass model: "<name>" to choose one, or set PBI_MODELING_MCP_CONNECTION_STRING.`;
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

export class ModelDriver {
  readonly #client: ModelClient;
  #connection: ConnectionInfo | null = null;
  #lastOpts: ConnectOpts | undefined;
  #connectPending: Promise<ConnectionInfo> | null = null;
  // Short-lived snapshot cache: reused across reads/gates within one batch,
  // invalidated on every write and on any connection reset so the DAX gate
  // always sees prior committed writes. The TTL bounds staleness from edits
  // made directly in Desktop between calls.
  #snapshot: { model: TMDLModel; at: number } | null = null;
  #snapshotPending: Promise<TMDLModel> | null = null;
  static readonly #SNAPSHOT_TTL_MS = 5_000;

  constructor(client: ModelClient) {
    this.#client = client;
    // When the bridged subprocess/transport drops, the client resets — drop our
    // cached connection (and snapshot) so the next call re-discovers and re-Connects.
    this.#client.onReset?.(() => {
      this.#connection = null;
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
  //
  // FIRST CONNECTION WINS for the session: once #connection is cached it is
  // sticky and a later opts.model is ignored. Switching the target model
  // requires a transport reset (handled by the existing onReset path, which
  // clears #connection so the next call re-discovers and re-Connects).
  async ensureConnection(opts?: ConnectOpts): Promise<ConnectionInfo> {
    if (opts) this.#lastOpts = opts;
    if (this.#connection) return this.#connection;
    if (this.#connectPending) return this.#connectPending;
    this.#connectPending = this.#connect(this.#lastOpts).finally(() => {
      this.#connectPending = null;
    });
    return this.#connectPending;
  }

  async #connect(opts?: ConnectOpts): Promise<ConnectionInfo> {
    const pinned = process.env.PBI_MODELING_MCP_CONNECTION_STRING?.trim();
    if (pinned) {
      await this.call(MS_TOOLS.connection, 'Connect', { connectionString: pinned });
      this.#connection = { mode: 'live', connectionString: pinned };
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
      const connectionString = (instances[0] as LiveInstance).connectionString;
      await this.call(MS_TOOLS.connection, 'Connect', { connectionString });
      this.#connection = { mode: 'live', connectionString };
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
      const matches = instances.filter((inst) => {
        const candidates = [inst.name, inst.databaseName, inst.initialCatalog]
          .filter((c): c is string => typeof c === 'string' && c.length > 0)
          .map(normalizeModelName);
        return candidates.includes(normalizedHint);
      });
      if (matches.length === 1) {
        const connectionString = (matches[0] as LiveInstance).connectionString;
        await this.call(MS_TOOLS.connection, 'Connect', { connectionString });
        this.#connection = { mode: 'live', connectionString };
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
      return this.#connection;
    }

    throw new Error(
      'No open Power BI Desktop instance found, and no folderPath supplied for folder mode. Open the .pbip in Desktop, or pass a .SemanticModel/definition folder.',
    );
  }

  // Run an operation against a connected model, retrying once if the connection
  // drops (or the subprocess re-spawned unconnected): invalidate the cache,
  // reset the subprocess, re-Connect, and re-run.
  async #live<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureConnection();
    try {
      return await fn();
    } catch (err) {
      // Never retry a deterministic validation failure — it will just fail again
      // after burning another request timeout.
      if (isNonRetryable(err) || !isConnectionDrop(err)) throw err;
      this.#connection = null;
      this.#snapshot = null;
      this.#snapshotPending = null;
      this.#client.reset?.();
      try {
        await this.ensureConnection();
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

  // --- reads -------------------------------------------------------------

  async listTablesRaw(): Promise<Record<string, unknown>[]> {
    return this.#live(async () =>
      pickArray(await this.call(MS_TOOLS.tables, 'List')).filter(isRecord),
    );
  }
  async listColumnsRaw(): Promise<Record<string, unknown>[]> {
    return this.#live(async () =>
      pickArray(await this.call(MS_TOOLS.columns, 'List')).filter(isRecord),
    );
  }
  async listMeasuresRaw(): Promise<Record<string, unknown>[]> {
    return this.#live(async () =>
      pickArray(await this.call(MS_TOOLS.measures, 'List')).filter(isRecord),
    );
  }

  // The live measure List returns only { name, description } — no table,
  // expression, or formatString. Enrich with a single batched Get
  // (references: [{ name }]) which returns the full definitions.
  async listMeasuresEnriched(): Promise<Record<string, unknown>[]> {
    const names = (await this.listMeasuresRaw())
      .map((m) => str(m, 'name', 'measureName'))
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (names.length === 0) return [];
    const got = await this.#live(() =>
      this.call(MS_TOOLS.measures, 'Get', { references: names.map((name) => ({ name })) }),
    );
    // Batched Get returns { results: [{ success, data: { ...measure } }, ...] }.
    // pickArray grabs `results`; unwrap each item's `data`. Tolerate a flat shape.
    return pickArray(got)
      .map((r) => (isRecord(r) && isRecord(r.data) ? r.data : r))
      .filter(isRecord);
  }
  async listRelationshipsRaw(): Promise<Record<string, unknown>[]> {
    return this.#live(async () =>
      pickArray(await this.call(MS_TOOLS.relationships, 'List')).filter(isRecord),
    );
  }
  // UNVERIFIED: RLS roles read. The MS modeling MCP exposes roles via a dedicated
  // tool/op (MS_TOOLS.roles + 'List'), both inferred — confirm on live Windows.
  // A per-role Get may be needed to retrieve tablePermissions (mirroring the
  // measure List→Get enrich); the assembly below tolerates either shape. The
  // CALLER (getModelSnapshot) wraps this in try/catch so an unsupported op
  // degrades to no `roles` key rather than breaking the snapshot.
  async listRolesRaw(): Promise<Record<string, unknown>[]> {
    return this.#live(async () =>
      pickArray(await this.call(MS_TOOLS.roles, 'List')).filter(isRecord),
    );
  }
  async daxQuery(query: string): Promise<unknown> {
    return this.#live(() => this.call(MS_TOOLS.dax, 'Execute', { query }));
  }

  // Assemble the live model into pbi-core's TMDLModel so existing validators reuse.
  async getModelSnapshot(modelPath = '(live)'): Promise<TMDLModel> {
    const [rawTables, rawColumns, rawMeasures, rawRels] = await Promise.all([
      this.listTablesRaw(),
      this.listColumnsRaw(),
      this.listMeasuresEnriched(),
      this.listRelationshipsRaw(),
    ]);

    // UNVERIFIED: RLS-roles read op is unconfirmed. Best-effort: a failure (op
    // not supported / errored) degrades to NO `roles` key so the snapshot — which
    // every validator depends on — can never break on the unconfirmed op.
    let rawRoles: Record<string, unknown>[] = [];
    try {
      rawRoles = await this.listRolesRaw();
    } catch {
      rawRoles = [];
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
        dataType: str(c, 'dataType', 'type') ?? 'string',
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
        return {
          name,
          columns: columnsByTable.get(name) ?? [],
          measures: measuresByTable.get(name) ?? [],
          isHidden: bool(t, ['isHidden', 'hidden']),
          isCalculated: bool(t, ['isCalculated', 'calculated']),
          isAutoDateTable: bool(t, ['isAutoDateTable', 'autoDateTable']),
          // UNVERIFIED: table description payload key inferred.
          description: str(t, 'description'),
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
        // payload keys are inferred. Derive via the shared helper so a normal
        // 1:many is captured as manyToOne (not manyToMany) and MOD003 only fires
        // on a true m:m. Absent keys → manyToOne (PBI default).
        const fromCard = str(r, 'fromCardinality', 'fromCardinalityName');
        const toCard = str(r, 'toCardinality', 'toCardinalityName');
        // UNVERIFIED: Assume-RI ("rely on referential integrity") key inferred.
        // Keep undefined when absent so MOD028 stays gated (no false positive).
        const relyOnRi = boolOrUndef(r, 'relyOnReferentialIntegrity', 'assumeReferentialIntegrity');
        return {
          id: str(r, 'id', 'name') ?? `rel_${i}`,
          fromTable,
          fromColumn,
          toTable,
          toColumn,
          isActive: bool(r, ['isActive', 'active'], true),
          crossFilteringBehavior: cross === 'both' ? 'both' : 'single',
          cardinality: deriveCardinality(fromCard, toCard),
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

    return { modelPath, tables, relationships, ...(roles.length > 0 ? { roles } : {}) };
  }

  // Snapshot reused across reads and the per-write DAX gate within one batch.
  // Dedupes concurrent callers and serves a fresh-enough result; otherwise
  // re-reads. Invalidated by every write (below) and by reset(), so the gate
  // always sees prior committed writes.
  async getCachedSnapshot(): Promise<TMDLModel> {
    const now = Date.now();
    if (this.#snapshot && now - this.#snapshot.at < ModelDriver.#SNAPSHOT_TTL_MS) {
      return this.#snapshot.model;
    }
    if (this.#snapshotPending) return this.#snapshotPending;
    this.#snapshotPending = this.getModelSnapshot()
      .then((model) => {
        this.#snapshot = { model, at: Date.now() };
        return model;
      })
      .finally(() => {
        this.#snapshotPending = null;
      });
    return this.#snapshotPending;
  }

  #invalidateSnapshot(): void {
    this.#snapshot = null;
    this.#snapshotPending = null;
  }

  // --- writes ------------------------------------------------------------

  async createMeasure(def: MeasureWrite): Promise<unknown> {
    const r = await this.#live(() =>
      this.call(MS_TOOLS.measures, 'Create', { definitions: [def] }),
    );
    this.#invalidateSnapshot();
    return r;
  }
  async updateMeasure(def: MeasureWrite): Promise<unknown> {
    const r = await this.#live(() =>
      this.call(MS_TOOLS.measures, 'Update', { definitions: [def] }),
    );
    this.#invalidateSnapshot();
    return r;
  }
  async deleteMeasure(ref: MeasureRef): Promise<unknown> {
    const r = await this.#live(() =>
      this.call(MS_TOOLS.measures, 'Delete', { references: [ref], shouldCascadeDelete: false }),
    );
    this.#invalidateSnapshot();
    return r;
  }

  // -- tables --
  async createTable(def: TableWrite): Promise<unknown> {
    const r = await this.#live(() =>
      this.call(MS_TOOLS.tables, 'Create', { definitions: [toDaxSource(def)] }),
    );
    this.#invalidateSnapshot();
    return r;
  }
  async updateTable(def: TableUpdate): Promise<unknown> {
    // UNVERIFIED: confirm against live MS MCP tool list — rename mechanism (newName) unconfirmed.
    const r = await this.#live(() => this.call(MS_TOOLS.tables, 'Update', { definitions: [def] }));
    this.#invalidateSnapshot();
    return r;
  }
  async deleteTable(ref: TableRef): Promise<unknown> {
    // UNVERIFIED: confirm against live MS MCP tool list — Delete not in the capability table.
    // Attempt + surface a clean error if unsupported; NEVER fall back to disk edits.
    const r = await this.#live(() =>
      this.call(MS_TOOLS.tables, 'Delete', { references: [ref], shouldCascadeDelete: false }),
    );
    this.#invalidateSnapshot();
    return r;
  }

  // -- columns --
  async createColumn(def: ColumnWrite): Promise<unknown> {
    const r = await this.#live(() =>
      this.call(MS_TOOLS.columns, 'Create', { definitions: [toDaxSource(def)] }),
    );
    this.#invalidateSnapshot();
    return r;
  }
  async updateColumn(def: ColumnUpdate): Promise<unknown> {
    const r = await this.#live(() =>
      this.call(MS_TOOLS.columns, 'Update', { definitions: [toDaxSource(def)] }),
    );
    this.#invalidateSnapshot();
    return r;
  }
  async deleteColumn(ref: ColumnRef): Promise<unknown> {
    // UNVERIFIED: confirm against live MS MCP tool list — Delete not in the capability table.
    const r = await this.#live(() =>
      this.call(MS_TOOLS.columns, 'Delete', { references: [ref], shouldCascadeDelete: false }),
    );
    this.#invalidateSnapshot();
    return r;
  }

  // Mark a table as a Power BI date table: set the table's dataCategory to
  // 'Time' and flag the chosen date column as the key. This is what enables
  // time-intelligence DAX (YTD/PY/YoY) and clears MODB1/MODB2.
  // UNVERIFIED: the MS MCP `dataCategory` (table Update) and `isKey` (column
  // Update) keys are inferred; both go through the standard Update path.
  async markAsDateTable(tableName: string, dateColumn: string): Promise<unknown> {
    await this.updateTable({ name: tableName, dataCategory: 'Time' });
    return this.updateColumn({ tableName, name: dateColumn, isKey: true });
  }

  // -- relationships --
  // The driver owns the MS wire-format quirk: crossFilteringBehavior is
  // 'single'|'both' in our API but 'OneDirection'|'BothDirections' on the wire.
  #translateRel<T extends { crossFilteringBehavior?: 'single' | 'both' }>(
    def: T,
  ): Omit<T, 'crossFilteringBehavior'> & { crossFilteringBehavior?: string } {
    const { crossFilteringBehavior, ...rest } = def;
    if (crossFilteringBehavior === undefined) return rest;
    return {
      ...rest,
      crossFilteringBehavior: crossFilteringBehavior === 'both' ? 'BothDirections' : 'OneDirection',
    };
  }

  async createRelationship(def: RelationshipWrite): Promise<unknown> {
    const r = await this.#live(() =>
      this.call(MS_TOOLS.relationships, 'Create', { definitions: [this.#translateRel(def)] }),
    );
    this.#invalidateSnapshot();
    return r;
  }
  async updateRelationship(def: RelationshipUpdate): Promise<unknown> {
    // UNVERIFIED: confirm against live MS MCP tool list — Update identity shape (name=id) unconfirmed.
    const { id, ...changes } = def;
    const translated = this.#translateRel(changes);
    const r = await this.#live(() =>
      this.call(MS_TOOLS.relationships, 'Update', { definitions: [{ name: id, ...translated }] }),
    );
    this.#invalidateSnapshot();
    return r;
  }
  async activateRelationship(ref: RelationshipRef): Promise<unknown> {
    // Activate IS a confirmed op (relationship_operations: …, Activate, Deactivate).
    // UNVERIFIED: the references:[{name}] envelope is inferred from Deactivate's
    // confirmed shape (Activate's own envelope is not separately documented).
    const r = await this.#live(() =>
      this.call(MS_TOOLS.relationships, 'Activate', { references: [{ name: ref.id }] }),
    );
    this.#invalidateSnapshot();
    return r;
  }
  async deactivateRelationship(ref: RelationshipRef): Promise<unknown> {
    const r = await this.#live(() =>
      this.call(MS_TOOLS.relationships, 'Deactivate', { references: [{ name: ref.id }] }),
    );
    this.#invalidateSnapshot();
    return r;
  }
  async deleteRelationship(ref: RelationshipRef): Promise<unknown> {
    // UNVERIFIED: confirm against live MS MCP tool list — Delete not in the op list.
    // Attempt + surface a clean error if unsupported; NEVER fall back to disk edits.
    const r = await this.#live(() =>
      this.call(MS_TOOLS.relationships, 'Delete', { references: [{ name: ref.id }] }),
    );
    this.#invalidateSnapshot();
    return r;
  }

  // Folder-mode persistence. Live mode persists via the user's Ctrl+S in Desktop.
  // NOTE: the MS MCP's param key is `tmdlFolderPath`, NOT `path`.
  async exportToTmdlFolder(folderPath?: string): Promise<unknown> {
    const params = folderPath ? { tmdlFolderPath: folderPath } : undefined;
    return this.#live(() => this.call(MS_TOOLS.database, 'ExportToTmdlFolder', params));
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
