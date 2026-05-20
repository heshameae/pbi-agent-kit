import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const UPDATE_SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'update-connection-sidecar.mjs');
const TRACK_SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'track-uncommitted-measure.mjs');
const CLEAR_SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'clear-uncommitted-on-export.mjs');

let sandbox;
let sidecarDir;
let modelDefinitionPath;

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'pbi-sidecar-hooks-'));
  sidecarDir = path.join(sandbox, 'sidecar');
  mkdirSync(sidecarDir, { recursive: true });

  modelDefinitionPath = path.join(sandbox, 'Model.SemanticModel', 'definition');
  mkdirSync(modelDefinitionPath, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function runHook(scriptPath, payload) {
  return spawnSync('node', [scriptPath], {
    input: JSON.stringify(payload),
    env: { ...process.env, PBI_MCP_SIDECAR_DIR: sidecarDir },
    encoding: 'utf8',
  });
}

function readConnections() {
  const file = path.join(sidecarDir, 'connections.json');
  if (!existsSync(file)) return { connections: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readUncommitted() {
  const file = path.join(sidecarDir, 'uncommitted-measures.json');
  if (!existsSync(file)) return { byConnection: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}

describe('update-connection-sidecar', () => {
  it('upserts a ConnectFolder result keyed by structuredContent.connectionName', () => {
    const result = runHook(UPDATE_SCRIPT, {
      tool_input: {
        operation: 'ConnectFolder',
        folderPath: modelDefinitionPath,
      },
      tool_response: {
        structuredContent: { connectionName: 'ModelConnectionA' },
      },
    });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    const sidecar = readConnections();
    assert.equal(sidecar.lastUsedConnectionName, 'ModelConnectionA');
    assert.equal(sidecar.connections.ModelConnectionA.folderPath, modelDefinitionPath);
  });

  it('falls back to .SemanticModel folder basename when connectionName is missing', () => {
    const result = runHook(UPDATE_SCRIPT, {
      tool_input: {
        request: {
          operation: 'ConnectFolder',
          folderPath: modelDefinitionPath,
        },
      },
    });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    const sidecar = readConnections();
    assert.equal(sidecar.lastUsedConnectionName, 'Model');
  });

  it('ignores non-ConnectFolder operations', () => {
    const result = runHook(UPDATE_SCRIPT, {
      tool_input: { operation: 'List' },
    });
    assert.equal(result.status, 0);
    assert.equal(existsSync(path.join(sidecarDir, 'connections.json')), false);
  });
});

describe('track-uncommitted-measure', () => {
  beforeEach(() => {
    writeFileSync(
      path.join(sidecarDir, 'connections.json'),
      JSON.stringify({
        lastUsedConnectionName: 'ModelConnectionA',
        connections: {
          ModelConnectionA: {
            connectionName: 'ModelConnectionA',
            folderPath: modelDefinitionPath,
            connectedAt: '2026-05-19T00:00:00.000Z',
          },
        },
      }),
      'utf8',
    );
  });

  it('appends measures from a successful Create', () => {
    const result = runHook(TRACK_SCRIPT, {
      tool_input: {
        operation: 'Create',
        connectionName: 'ModelConnectionA',
        definitions: [
          {
            tableName: 'FactPrimary',
            name: 'NewMeasureA',
            expression: 'SUM(FactPrimary[ValueMetric])',
          },
          { tableName: 'FactPrimary', name: 'NewMeasureB' },
        ],
      },
      tool_response: { structuredContent: { success: true } },
    });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    const u = readUncommitted();
    const names = (u.byConnection.ModelConnectionA ?? []).map((m) => m.name).sort();
    assert.deepEqual(names, ['NewMeasureA', 'NewMeasureB']);
  });

  it('ignores non-Create operations', () => {
    const result = runHook(TRACK_SCRIPT, {
      tool_input: {
        operation: 'List',
        connectionName: 'ModelConnectionA',
      },
    });
    assert.equal(result.status, 0);
    assert.equal(existsSync(path.join(sidecarDir, 'uncommitted-measures.json')), false);
  });
});

describe('clear-uncommitted-on-export', () => {
  beforeEach(() => {
    writeFileSync(
      path.join(sidecarDir, 'connections.json'),
      JSON.stringify({
        lastUsedConnectionName: 'ModelConnectionA',
        connections: {
          ModelConnectionA: {
            connectionName: 'ModelConnectionA',
            folderPath: modelDefinitionPath,
            connectedAt: '2026-05-19T00:00:00.000Z',
          },
          ModelConnectionB: {
            connectionName: 'ModelConnectionB',
            folderPath: '/other/model',
            connectedAt: '2026-05-19T00:00:00.000Z',
          },
        },
      }),
      'utf8',
    );
    writeFileSync(
      path.join(sidecarDir, 'uncommitted-measures.json'),
      JSON.stringify({
        byConnection: {
          ModelConnectionA: [
            {
              table: 'FactPrimary',
              name: 'NewMeasureA',
              createdAt: '2026-05-19T00:00:00.000Z',
            },
          ],
          ModelConnectionB: [
            {
              table: 'FactSecondary',
              name: 'NewMeasureC',
              createdAt: '2026-05-19T00:00:00.000Z',
            },
          ],
        },
      }),
      'utf8',
    );
  });

  it('clears only the targeted connection on ExportToTmdlFolder', () => {
    const result = runHook(CLEAR_SCRIPT, {
      tool_input: {
        operation: 'ExportToTmdlFolder',
        connectionName: 'ModelConnectionA',
      },
      tool_response: { structuredContent: { success: true } },
    });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    const u = readUncommitted();
    assert.equal(u.byConnection.ModelConnectionA, undefined);
    assert.equal(u.byConnection.ModelConnectionB.length, 1);
  });

  it('ignores non-Export operations', () => {
    const result = runHook(CLEAR_SCRIPT, {
      tool_input: { operation: 'List' },
    });
    assert.equal(result.status, 0);
    const u = readUncommitted();
    assert.equal(u.byConnection.ModelConnectionA.length, 1);
  });

  it('clears the connection matched by tmdlFolderPath when connectionName is omitted', () => {
    const result = runHook(CLEAR_SCRIPT, {
      tool_input: {
        operation: 'ExportToTmdlFolder',
        tmdlFolderPath: modelDefinitionPath,
      },
      tool_response: { structuredContent: { success: true } },
    });
    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    const u = readUncommitted();
    assert.equal(u.byConnection.ModelConnectionA, undefined);
    assert.equal(u.byConnection.ModelConnectionB.length, 1);
  });
});
