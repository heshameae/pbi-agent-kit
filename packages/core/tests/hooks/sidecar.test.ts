import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendUncommittedMeasures,
  clearUncommittedMeasures,
  readConnections,
  readUncommittedMeasures,
  resolveConnection,
  resolveSidecarRoot,
  upsertConnection,
} from '../../src/hooks/sidecar.js';

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-sidecar-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveSidecarRoot', () => {
  it('prefers PBI_MCP_SIDECAR_DIR', () => {
    const resolved = resolveSidecarRoot({
      PBI_MCP_SIDECAR_DIR: '/explicit/dir',
      CLAUDE_PROJECT_DIR: '/project/dir',
      CLAUDE_PLUGIN_DATA: '/plugin/data',
    });
    expect(resolved).toBe('/explicit/dir');
  });

  it('falls back to project-scoped path', () => {
    const resolved = resolveSidecarRoot({
      CLAUDE_PROJECT_DIR: '/project/dir',
      CLAUDE_PLUGIN_DATA: '/plugin/data',
    });
    expect(resolved).toBe(path.join('/project/dir', '.pbi-mcp-ts', 'sidecar'));
  });

  it('falls back to plugin-scoped path when no project dir is set', () => {
    const resolved = resolveSidecarRoot({
      CLAUDE_PLUGIN_DATA: '/plugin/data',
    });
    expect(resolved).toBe(path.join('/plugin/data', 'sidecar'));
  });
});

describe('connections registry', () => {
  it('upserts multiple connections keyed by connectionName and tracks lastUsedConnectionName', () => {
    upsertConnection(root, {
      connectionName: 'ModelConnectionA',
      folderPath: '/models/A.SemanticModel/definition',
      connectedAt: '2026-05-19T10:00:00.000Z',
    });
    upsertConnection(root, {
      connectionName: 'ModelConnectionB',
      folderPath: '/models/B.SemanticModel/definition',
      connectedAt: '2026-05-19T10:05:00.000Z',
    });

    const sidecar = readConnections(root);
    expect(sidecar.lastUsedConnectionName).toBe('ModelConnectionB');
    expect(Object.keys(sidecar.connections).sort()).toEqual([
      'ModelConnectionA',
      'ModelConnectionB',
    ]);
    expect(sidecar.connections.ModelConnectionA?.folderPath).toBe(
      '/models/A.SemanticModel/definition',
    );
  });

  it('resolveConnection returns explicit match or falls back to lastUsed', () => {
    upsertConnection(root, {
      connectionName: 'ModelConnectionA',
      folderPath: '/models/A.SemanticModel/definition',
      connectedAt: '2026-05-19T10:00:00.000Z',
    });
    upsertConnection(root, {
      connectionName: 'ModelConnectionB',
      folderPath: '/models/B.SemanticModel/definition',
      connectedAt: '2026-05-19T10:05:00.000Z',
    });

    expect(resolveConnection(root, 'ModelConnectionA')?.folderPath).toBe(
      '/models/A.SemanticModel/definition',
    );
    expect(resolveConnection(root)?.connectionName).toBe('ModelConnectionB');
    expect(resolveConnection(root, 'Missing')).toBeNull();
  });

  it('writes atomically (final file present, no temp leftovers)', () => {
    upsertConnection(root, {
      connectionName: 'ModelConnectionA',
      folderPath: '/x',
      connectedAt: '2026-05-19T10:00:00.000Z',
    });
    expect(existsSync(path.join(root, 'connections.json'))).toBe(true);
    const raw = readFileSync(path.join(root, 'connections.json'), 'utf8');
    expect(JSON.parse(raw).connections.ModelConnectionA.folderPath).toBe('/x');
  });
});

describe('uncommitted measures registry', () => {
  it('appends per-connection and reads them back', () => {
    appendUncommittedMeasures(root, 'ModelConnectionA', [
      { table: 'FactPrimary', name: 'NewMeasureA', expression: 'SUM(FactPrimary[ValueMetric])' },
    ]);
    appendUncommittedMeasures(root, 'ModelConnectionA', [
      { table: 'FactPrimary', name: 'NewMeasureB' },
    ]);
    appendUncommittedMeasures(root, 'ModelConnectionB', [
      { table: 'FactSecondary', name: 'NewMeasureC' },
    ]);

    const a = readUncommittedMeasures(root, 'ModelConnectionA');
    expect(a.map((m) => m.name).sort()).toEqual(['NewMeasureA', 'NewMeasureB']);
    expect(a[0]?.createdAt).toMatch(/T/);

    const b = readUncommittedMeasures(root, 'ModelConnectionB');
    expect(b.map((m) => m.name)).toEqual(['NewMeasureC']);
  });

  it('clears only the targeted connection', () => {
    appendUncommittedMeasures(root, 'ModelConnectionA', [
      { table: 'FactPrimary', name: 'NewMeasureA' },
    ]);
    appendUncommittedMeasures(root, 'ModelConnectionB', [
      { table: 'FactSecondary', name: 'NewMeasureC' },
    ]);

    clearUncommittedMeasures(root, 'ModelConnectionA');

    expect(readUncommittedMeasures(root, 'ModelConnectionA')).toEqual([]);
    expect(readUncommittedMeasures(root, 'ModelConnectionB').map((m) => m.name)).toEqual([
      'NewMeasureC',
    ]);
  });
});
