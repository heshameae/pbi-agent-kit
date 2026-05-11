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
  it('scaffolds Demo.pbip and reads it back', () => {
    const create = JSON.parse(run(['report', 'create', 'Demo', '--target', tmp]));
    expect(create.status).toBe('created');
    expect(create.name).toBe('Demo');
    expect(existsSync(path.join(tmp, 'Demo.pbip'))).toBe(true);
    expect(existsSync(path.join(tmp, 'Demo.SemanticModel', 'definition.pbism'))).toBe(true);

    const info = JSON.parse(run(['report', 'info', '--path', path.join(tmp, 'Demo.Report')]));
    expect(info.pageCount).toBe(0);
    expect(info.theme).toBe('CY24SU06');
  });

  it('validates a fresh scaffold as valid', () => {
    run(['report', 'create', 'Demo', '--target', tmp]);
    const out = run(['report', 'validate', '--path', path.join(tmp, 'Demo.Report')]);
    const r = JSON.parse(out);
    expect(r.valid).toBe(true);
  });
});

describe('pbi-ts page add / list / delete', () => {
  it('adds pages and lists them in pageOrder', () => {
    run(['report', 'create', 'Demo', '--target', tmp]);
    const reportPath = path.join(tmp, 'Demo.Report');

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
