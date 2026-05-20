import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export interface ConnectionRecord {
  readonly connectionName: string;
  readonly folderPath: string;
  readonly connectedAt: string;
}

export interface ConnectionsSidecar {
  readonly lastUsedConnectionName?: string;
  readonly connections: Readonly<Record<string, ConnectionRecord>>;
}

export interface UncommittedMeasureRecord {
  readonly table: string;
  readonly name: string;
  readonly expression?: string;
  readonly createdAt: string;
}

const CONNECTIONS_FILE = 'connections.json';
const UNCOMMITTED_FILE = 'uncommitted-measures.json';

export function resolveSidecarRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PBI_MCP_SIDECAR_DIR;
  if (explicit && explicit.length > 0) return explicit;
  const project = env.CLAUDE_PROJECT_DIR;
  if (project && project.length > 0) return path.join(project, '.pbi-mcp-ts', 'sidecar');
  const plugin = env.CLAUDE_PLUGIN_DATA;
  if (plugin && plugin.length > 0) return path.join(plugin, 'sidecar');
  return path.join(process.cwd(), '.pbi-mcp-ts', 'sidecar');
}

export function readConnections(root: string): ConnectionsSidecar {
  const file = path.join(root, CONNECTIONS_FILE);
  if (!existsSync(file)) return { connections: {} };
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ConnectionsSidecar>;
  return {
    lastUsedConnectionName: parsed.lastUsedConnectionName,
    connections: parsed.connections ?? {},
  };
}

export function upsertConnection(root: string, record: ConnectionRecord): void {
  const current = readConnections(root);
  const next: ConnectionsSidecar = {
    lastUsedConnectionName: record.connectionName,
    connections: {
      ...current.connections,
      [record.connectionName]: record,
    },
  };
  atomicWriteJson(root, CONNECTIONS_FILE, next);
}

export function resolveConnection(
  root: string,
  connectionName?: string,
): ConnectionRecord | null {
  const current = readConnections(root);
  if (connectionName !== undefined && connectionName.length > 0) {
    return current.connections[connectionName] ?? null;
  }
  const last = current.lastUsedConnectionName;
  if (last === undefined) return null;
  return current.connections[last] ?? null;
}

interface UncommittedSidecarFile {
  readonly byConnection: Readonly<Record<string, readonly UncommittedMeasureRecord[]>>;
}

function readUncommittedFile(root: string): UncommittedSidecarFile {
  const file = path.join(root, UNCOMMITTED_FILE);
  if (!existsSync(file)) return { byConnection: {} };
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<UncommittedSidecarFile>;
  return { byConnection: parsed.byConnection ?? {} };
}

export function readUncommittedMeasures(
  root: string,
  connectionName: string,
): readonly UncommittedMeasureRecord[] {
  return readUncommittedFile(root).byConnection[connectionName] ?? [];
}

export function appendUncommittedMeasures(
  root: string,
  connectionName: string,
  measures: readonly Omit<UncommittedMeasureRecord, 'createdAt'>[],
): void {
  if (measures.length === 0) return;
  const now = new Date().toISOString();
  const current = readUncommittedFile(root);
  const existing = current.byConnection[connectionName] ?? [];
  const added: UncommittedMeasureRecord[] = measures.map((measure) => ({
    table: measure.table,
    name: measure.name,
    expression: measure.expression,
    createdAt: now,
  }));
  const next: UncommittedSidecarFile = {
    byConnection: {
      ...current.byConnection,
      [connectionName]: [...existing, ...added],
    },
  };
  atomicWriteJson(root, UNCOMMITTED_FILE, next);
}

export function clearUncommittedMeasures(root: string, connectionName: string): void {
  const current = readUncommittedFile(root);
  if (!(connectionName in current.byConnection)) return;
  const nextByConnection: Record<string, readonly UncommittedMeasureRecord[]> = {
    ...current.byConnection,
  };
  delete nextByConnection[connectionName];
  atomicWriteJson(root, UNCOMMITTED_FILE, { byConnection: nextByConnection });
}

function atomicWriteJson(root: string, filename: string, payload: unknown): void {
  mkdirSync(root, { recursive: true });
  const target = path.join(root, filename);
  const tmp = path.join(root, `${filename}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  try {
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}
