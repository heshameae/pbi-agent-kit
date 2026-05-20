import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'hooks', 'scripts', 'gate-measure-create.mjs');

let sandbox;
let sidecarDir;
let modelDefinitionPath;

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'pbi-gate-'));
  sidecarDir = path.join(sandbox, 'sidecar');
  mkdirSync(sidecarDir, { recursive: true });

  modelDefinitionPath = path.join(
    sandbox,
    'Model.SemanticModel',
    'definition',
  );
  const tablesDir = path.join(modelDefinitionPath, 'tables');
  mkdirSync(tablesDir, { recursive: true });
  writeFileSync(path.join(modelDefinitionPath, 'database.tmdl'), 'database\n', 'utf8');
  writeFileSync(path.join(modelDefinitionPath, 'model.tmdl'), 'model Model\n', 'utf8');
  writeFileSync(
    path.join(tablesDir, 'FactPrimary.tmdl'),
    [
      'table FactPrimary',
      '\tcolumn ValueMetric',
      '\t\tdataType: decimal',
      '\t\tsummarizeBy: sum',
      '',
      '\tmeasure BaseMeasure = SUM(FactPrimary[ValueMetric])',
      '\t\tformatString: #,##0',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    path.join(sidecarDir, 'connections.json'),
    JSON.stringify(
      {
        lastUsedConnectionName: 'ModelConnectionA',
        connections: {
          ModelConnectionA: {
            connectionName: 'ModelConnectionA',
            folderPath: modelDefinitionPath,
            connectedAt: '2026-05-19T00:00:00.000Z',
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function runHook(payload) {
  return spawnSync('node', [SCRIPT], {
    input: JSON.stringify(payload),
    env: { ...process.env, PBI_MCP_SIDECAR_DIR: sidecarDir },
    encoding: 'utf8',
  });
}

describe('gate-measure-create', () => {
  it('denies Create when DAX references a missing column (wrapped request shape)', () => {
    const result = runHook({
      tool_name: 'mcp__powerbi-modeling__measure_operations',
      tool_input: {
        request: {
          operation: 'Create',
          connectionName: 'ModelConnectionA',
          definitions: [
            {
              tableName: 'FactPrimary',
              name: 'InvalidMeasure',
              expression: 'SUM(FactPrimary[MissingField])',
            },
          ],
        },
      },
    });
    assert.equal(result.status, 2, `expected exit 2, got ${result.status}; stderr=${result.stderr}`);
    assert.match(result.stderr, /FactPrimary\[MissingField\]/);
  });

  it('allows Create with valid references (direct shape)', () => {
    const result = runHook({
      tool_name: 'mcp__powerbi-modeling__measure_operations',
      tool_input: {
        operation: 'Create',
        connectionName: 'ModelConnectionA',
        definitions: [
          {
            tableName: 'FactPrimary',
            name: 'ValidMeasure',
            expression: 'SUM(FactPrimary[ValueMetric])',
          },
        ],
      },
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr=${result.stderr}`);
  });

  it('allows non-Create operations without inspecting definitions', () => {
    const result = runHook({
      tool_input: {
        operation: 'List',
        connectionName: 'ModelConnectionA',
      },
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr=${result.stderr}`);
  });

  it('denies Create when no connection is known (fail closed)', () => {
    rmSync(path.join(sidecarDir, 'connections.json'));
    const result = runHook({
      tool_input: {
        operation: 'Create',
        connectionName: 'UnknownConnection',
        definitions: [
          {
            tableName: 'FactPrimary',
            name: 'AnyMeasure',
            expression: 'SUM(FactPrimary[ValueMetric])',
          },
        ],
      },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /connection/i);
  });

  it('allows references to a previously created uncommitted measure', () => {
    writeFileSync(
      path.join(sidecarDir, 'uncommitted-measures.json'),
      JSON.stringify(
        {
          byConnection: {
            ModelConnectionA: [
              {
                table: 'FactPrimary',
                name: 'PendingMeasure',
                createdAt: '2026-05-19T00:00:00.000Z',
              },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    const result = runHook({
      tool_input: {
        operation: 'Create',
        connectionName: 'ModelConnectionA',
        definitions: [
          {
            tableName: 'FactPrimary',
            name: 'DerivedMeasure',
            expression: '[PendingMeasure] + 1',
          },
        ],
      },
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr=${result.stderr}`);
  });

  it('allows references between measures created in the same Create batch', () => {
    const result = runHook({
      tool_input: {
        operation: 'Create',
        connectionName: 'ModelConnectionA',
        definitions: [
          {
            tableName: 'FactPrimary',
            name: 'BatchMeasureA',
            expression: 'SUM(FactPrimary[ValueMetric])',
          },
          {
            tableName: 'FactPrimary',
            name: 'BatchMeasureB',
            expression: '[BatchMeasureA] + 1',
          },
        ],
      },
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr=${result.stderr}`);
    assert.doesNotMatch(result.stderr, /missing/i);
  });
});
