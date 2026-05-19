import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PbiCoreError, readJson, reportConvert, reportCreate } from '../../src/index.js';

let tmp: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-convert-')));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('reportConvert', () => {
  it('wraps an existing .Report folder into a .pbip', () => {
    // Scaffold then delete the .pbip + .SemanticModel; keep only the .Report
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    rmSync(path.join(tmp, 'MyReport.pbip'));

    const r = reportConvert({ sourcePath: path.join(tmp, 'MyReport.Report') });
    expect(r.status).toBe('converted');
    expect(r.name).toBe('MyReport');
    expect(existsSync(r.pbipPath)).toBe(true);

    const pbip = readJson(r.pbipPath) as Record<string, unknown>;
    expect(pbip.version).toBe('1.0');
    expect(pbip.artifacts).toEqual([{ report: { path: 'MyReport.Report' } }]);
  });

  it('finds the .Report when given a parent directory', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    rmSync(path.join(tmp, 'MyReport.pbip'));

    const r = reportConvert({ sourcePath: tmp });
    expect(r.name).toBe('MyReport');
  });

  it('creates a .gitignore when missing', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    rmSync(path.join(tmp, 'MyReport.pbip'));

    const r = reportConvert({ sourcePath: path.join(tmp, 'MyReport.Report') });
    expect(r.gitignoreCreated).toBe(true);
    expect(existsSync(path.join(tmp, '.gitignore'))).toBe(true);
  });

  it('refuses to overwrite without force', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    // .pbip already exists from reportCreate
    expect(() => reportConvert({ sourcePath: path.join(tmp, 'MyReport.Report') })).toThrow(
      PbiCoreError,
    );
  });

  it('overwrites with force: true', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    const r = reportConvert({
      sourcePath: path.join(tmp, 'MyReport.Report'),
      force: true,
    });
    expect(r.status).toBe('converted');
  });

  it('throws when no .Report folder is reachable', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'pbi-empty-'));
    try {
      expect(() => reportConvert({ sourcePath: empty })).toThrow(PbiCoreError);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('flags definition.pbir presence', () => {
    reportCreate({ targetPath: tmp, name: 'MyReport' });
    rmSync(path.join(tmp, 'MyReport.pbip'));
    const r = reportConvert({ sourcePath: path.join(tmp, 'MyReport.Report') });
    expect(r.hasDefinitionPbir).toBe(true);

    // Now delete it and retry — should be false
    rmSync(path.join(tmp, 'MyReport.Report', 'definition.pbir'));
    rmSync(r.pbipPath);
    const r2 = reportConvert({ sourcePath: path.join(tmp, 'MyReport.Report') });
    expect(r2.hasDefinitionPbir).toBe(false);
  });
});
