import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from 'pbi-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.resolve(__dirname, '..', 'dist', 'main.js');

let tmp: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-cli-smoke-')));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function run(args: string[]): string {
  return execSync(`node ${CLI_ENTRY} ${args.join(' ')}`, {
    cwd: tmp,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('pbi-cli smoke', () => {
  it('imports pbi-core', () => {
    expect(VERSION).toBeDefined();
  });

  it('--version prints VERSION', () => {
    const stdout = run(['--version']);
    expect(stdout.trim()).toBe(VERSION);
  });
});

describe('pbi-ts report create / info', () => {
  it('scaffolds MyReport.pbip and reads it back', () => {
    const create = JSON.parse(run(['report', 'create', 'MyReport', '--target', tmp]));
    expect(create.status).toBe('created');
    expect(create.name).toBe('MyReport');
    expect(existsSync(path.join(tmp, 'MyReport.pbip'))).toBe(true);
    expect(existsSync(path.join(tmp, 'MyReport.SemanticModel', 'definition.pbism'))).toBe(true);

    const info = JSON.parse(run(['report', 'info', '--path', path.join(tmp, 'MyReport.Report')]));
    expect(info.pageCount).toBe(0);
    expect(info.theme).toBe('CY26SU02');
  });

  it('validates a fresh scaffold as valid', () => {
    run(['report', 'create', 'MyReport', '--target', tmp]);
    const out = run(['report', 'validate', '--path', path.join(tmp, 'MyReport.Report')]);
    const r = JSON.parse(out);
    expect(r.valid).toBe(true);
  });
});

describe('pbi-ts page add / list / delete', () => {
  it('adds pages and lists them in pageOrder', () => {
    run(['report', 'create', 'MyReport', '--target', tmp]);
    const reportPath = path.join(tmp, 'MyReport.Report');

    const a = JSON.parse(run(['page', 'add', 'Overview', '--path', reportPath, '-n', 'p1']));
    expect(a.status).toBe('created');
    const b = JSON.parse(run(['page', 'add', 'Detail', '--path', reportPath, '-n', 'p2']));
    expect(b.status).toBe('created');

    const list = JSON.parse(run(['page', 'list', '--path', reportPath]));
    expect(list.map((p: { name: string }) => p.name)).toEqual(['p1', 'p2']);

    run(['page', 'delete', 'p1', '--path', reportPath]);
    const after = JSON.parse(run(['page', 'list', '--path', reportPath]));
    expect(after.map((p: { name: string }) => p.name)).toEqual(['p2']);
  });
});
