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

import type { TMDLColumn, TMDLMeasure, TMDLModel, TMDLRelationship, TMDLTable } from 'pbi-core';
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
} as const;

export interface ModelClient {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  reset?(): void;
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

function bool(obj: Record<string, unknown>, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'boolean') return v;
  }
  return fallback;
}

export class ModelDriver {
  readonly #client: ModelClient;
  #connection: ConnectionInfo | null = null;

  constructor(client: ModelClient) {
    this.#client = client;
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

  async listLocalInstances(): Promise<string[]> {
    const payload = await this.call(MS_TOOLS.connection, 'ListLocalInstances');
    return collectConnectionStrings(payload);
  }

  // Auto-detect connection. Caches the result; call reset-on-driver to redo.
  async ensureConnection(opts?: { folderPath?: string }): Promise<ConnectionInfo> {
    if (this.#connection) return this.#connection;

    const pinned = process.env.PBI_MODELING_MCP_CONNECTION_STRING?.trim();
    if (pinned) {
      await this.call(MS_TOOLS.connection, 'Connect', { connectionString: pinned });
      this.#connection = { mode: 'live', connectionString: pinned };
      return this.#connection;
    }

    const instances = await this.listLocalInstances();
    if (instances.length === 1) {
      const connectionString = instances[0] as string;
      await this.call(MS_TOOLS.connection, 'Connect', { connectionString });
      this.#connection = { mode: 'live', connectionString };
      return this.#connection;
    }
    if (instances.length > 1) {
      throw new Error(
        `Found ${instances.length} open Power BI Desktop instances. Set PBI_MODELING_MCP_CONNECTION_STRING to choose one.`,
      );
    }

    if (opts?.folderPath) {
      await this.call(MS_TOOLS.connection, 'ConnectFolder', { path: opts.folderPath });
      this.#connection = { mode: 'folder', folderPath: opts.folderPath };
      return this.#connection;
    }

    throw new Error(
      'No open Power BI Desktop instance found, and no folderPath supplied for folder mode. Open the .pbip in Desktop, or pass a .SemanticModel/definition folder.',
    );
  }

  // --- reads -------------------------------------------------------------

  async listTablesRaw(): Promise<Record<string, unknown>[]> {
    return pickArray(await this.call(MS_TOOLS.tables, 'List')).filter(isRecord);
  }
  async listColumnsRaw(): Promise<Record<string, unknown>[]> {
    return pickArray(await this.call(MS_TOOLS.columns, 'List')).filter(isRecord);
  }
  async listMeasuresRaw(): Promise<Record<string, unknown>[]> {
    return pickArray(await this.call(MS_TOOLS.measures, 'List')).filter(isRecord);
  }
  async listRelationshipsRaw(): Promise<Record<string, unknown>[]> {
    return pickArray(await this.call(MS_TOOLS.relationships, 'List')).filter(isRecord);
  }
  async daxQuery(query: string): Promise<unknown> {
    return this.call(MS_TOOLS.dax, 'Execute', { query });
  }

  // Assemble the live model into pbi-core's TMDLModel so existing validators reuse.
  async getModelSnapshot(modelPath = '(live)'): Promise<TMDLModel> {
    const [rawTables, rawColumns, rawMeasures, rawRels] = await Promise.all([
      this.listTablesRaw(),
      this.listColumnsRaw(),
      this.listMeasuresRaw(),
      this.listRelationshipsRaw(),
    ]);

    const columnsByTable = new Map<string, TMDLColumn[]>();
    for (const c of rawColumns) {
      const table = str(c, 'tableName', 'table') ?? '';
      const name = str(c, 'name', 'columnName') ?? '';
      if (!table || !name) continue;
      const col: TMDLColumn = {
        table,
        name,
        dataType: str(c, 'dataType', 'type') ?? 'string',
        summarizeBy: str(c, 'summarizeBy'),
        sourceColumn: str(c, 'sourceColumn'),
        isHidden: bool(c, ['isHidden', 'hidden']),
        isKey: bool(c, ['isKey', 'key']),
        isCalculated: bool(c, ['isCalculated', 'calculated']),
      };
      const list = columnsByTable.get(table) ?? [];
      list.push(col);
      columnsByTable.set(table, list);
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
        return {
          name,
          columns: columnsByTable.get(name) ?? [],
          measures: measuresByTable.get(name) ?? [],
          isHidden: bool(t, ['isHidden', 'hidden']),
          isCalculated: bool(t, ['isCalculated', 'calculated']),
          isAutoDateTable: bool(t, ['isAutoDateTable', 'autoDateTable']),
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
        return {
          id: str(r, 'id', 'name') ?? `rel_${i}`,
          fromTable,
          fromColumn,
          toTable,
          toColumn,
          isActive: bool(r, ['isActive', 'active'], true),
          crossFilteringBehavior: cross === 'both' ? 'both' : 'single',
        };
      })
      .filter((r): r is TMDLRelationship => r !== null);

    return { modelPath, tables, relationships };
  }

  // --- writes ------------------------------------------------------------

  async createMeasure(def: MeasureWrite): Promise<unknown> {
    return this.call(MS_TOOLS.measures, 'Create', { definitions: [def] });
  }
  async updateMeasure(def: MeasureWrite): Promise<unknown> {
    return this.call(MS_TOOLS.measures, 'Update', { definitions: [def] });
  }
  async deleteMeasure(ref: MeasureRef): Promise<unknown> {
    return this.call(MS_TOOLS.measures, 'Delete', {
      references: [ref],
      shouldCascadeDelete: false,
    });
  }

  // Folder-mode persistence. Live mode persists via the user's Ctrl+S in Desktop.
  async exportToTmdlFolder(folderPath?: string): Promise<unknown> {
    const params = folderPath ? { path: folderPath } : undefined;
    return this.call(MS_TOOLS.database, 'ExportToTmdlFolder', params);
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
