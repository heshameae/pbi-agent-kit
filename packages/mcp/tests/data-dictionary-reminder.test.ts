// Contract for the SessionStart data-dictionary reminder hook. The reminder is a
// pure UX nudge and MUST be non-disruptive: it always exits 0, never blocks, only
// fires inside a real Power BI project that lacks the optional dictionary, and
// inspects the USER's project dir (never the plugin dir).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const HOOK = path.join(REPO_ROOT, 'hooks', 'scripts', 'remind-data-dictionary.mjs');
const SCOPE_GUARD = path.join(REPO_ROOT, 'hooks', 'scripts', 'guard-modeling-beta-scope.mjs');

interface RunResult {
  status: number | null;
  stdout: string;
}

// Build a clean env so the host's own CLAUDE_*/opt-out vars never leak into a case.
function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    'CLAUDE_PROJECT_DIR',
    'CLAUDE_PLUGIN_ROOT',
    'CLAUDE_PLUGIN_DATA',
    'PBI_AGENT_KIT_NO_DICT_REMINDER',
  ]) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function runHook(payload: unknown, env: NodeJS.ProcessEnv, cwd?: string): RunResult {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    env,
    cwd,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: (result.stdout ?? '').trim() };
}

let tmpRoots: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pbi-dd-'));
  tmpRoots.push(dir);
  return dir;
}

beforeEach(() => {
  tmpRoots = [];
});
afterEach(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

describe('data-dictionary reminder hook (SessionStart)', () => {
  it('nudges in a Power BI project (*.pbip) with no dictionary', () => {
    const root = makeDir();
    writeFileSync(path.join(root, 'Sales.pbip'), '{}');
    const { status, stdout } = runHook(
      { hook_event_name: 'SessionStart', cwd: root },
      baseEnv({ CLAUDE_PROJECT_DIR: root }),
    );
    expect(status).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(out.hookSpecificOutput.additionalContext).toContain('/pbi-init-data-dictionary');
    expect(out.hookSpecificOutput.additionalContext).toMatch(/optional/i);
    expect(typeof out.systemMessage).toBe('string');
  });

  it('also recognizes a *.SemanticModel directory as a Power BI project', () => {
    const root = makeDir();
    mkdirSync(path.join(root, 'Sales.SemanticModel'));
    const { status, stdout } = runHook(
      { hook_event_name: 'SessionStart', cwd: root },
      baseEnv({ CLAUDE_PROJECT_DIR: root }),
    );
    expect(status).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('stays silent when the dictionary already exists', () => {
    const root = makeDir();
    writeFileSync(path.join(root, 'Sales.pbip'), '{}');
    mkdirSync(path.join(root, '.pbi-agent-kit'), { recursive: true });
    writeFileSync(path.join(root, '.pbi-agent-kit', 'data-dictionary.yaml'), 'version: 1\n');
    const { status, stdout } = runHook(
      { hook_event_name: 'SessionStart', cwd: root },
      baseEnv({ CLAUDE_PROJECT_DIR: root }),
    );
    expect(status).toBe(0);
    expect(stdout).toBe('');
  });

  it('stays silent outside a Power BI project (no nagging in unrelated folders)', () => {
    const root = makeDir();
    const { status, stdout } = runHook(
      { hook_event_name: 'SessionStart', cwd: root },
      baseEnv({ CLAUDE_PROJECT_DIR: root }),
    );
    expect(status).toBe(0);
    expect(stdout).toBe('');
  });

  it('honors the PBI_AGENT_KIT_NO_DICT_REMINDER opt-out', () => {
    const root = makeDir();
    writeFileSync(path.join(root, 'Sales.pbip'), '{}');
    const { status, stdout } = runHook(
      { hook_event_name: 'SessionStart', cwd: root },
      baseEnv({ CLAUDE_PROJECT_DIR: root, PBI_AGENT_KIT_NO_DICT_REMINDER: '1' }),
    );
    expect(status).toBe(0);
    expect(stdout).toBe('');
  });

  it('resolves the project from CLAUDE_PROJECT_DIR, not CLAUDE_PLUGIN_ROOT', () => {
    const project = makeDir();
    const pluginRoot = makeDir();
    writeFileSync(path.join(project, 'Sales.pbip'), '{}');
    // plugin root has NO pbip; if the hook wrongly used it, it would stay silent.
    const { status, stdout } = runHook(
      { hook_event_name: 'SessionStart' },
      baseEnv({ CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: pluginRoot }),
    );
    expect(status).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('falls back to payload.cwd when CLAUDE_PROJECT_DIR is unset', () => {
    const project = makeDir();
    const elsewhere = makeDir();
    writeFileSync(path.join(project, 'Sales.pbip'), '{}');
    // Process cwd points at a non-project dir; only payload.cwd points at the project.
    const { status, stdout } = runHook(
      { hook_event_name: 'SessionStart', cwd: project },
      baseEnv(),
      elsewhere,
    );
    expect(status).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('de-dupes across sessions via the CLAUDE_PLUGIN_DATA marker', () => {
    const root = makeDir();
    const dataDir = makeDir();
    writeFileSync(path.join(root, 'Sales.pbip'), '{}');
    const env = baseEnv({ CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_DATA: dataDir });
    const first = runHook({ hook_event_name: 'SessionStart', cwd: root }, env);
    const second = runHook({ hook_event_name: 'SessionStart', cwd: root }, env);
    expect(first.stdout.length).toBeGreaterThan(0);
    expect(second.stdout).toBe('');
  });

  it('NEVER blocks: always exit 0, no decision/permission/continue:false', () => {
    const root = makeDir();
    writeFileSync(path.join(root, 'Sales.pbip'), '{}');
    const { status, stdout } = runHook(
      { hook_event_name: 'SessionStart', cwd: root },
      baseEnv({ CLAUDE_PROJECT_DIR: root }),
    );
    expect(status).toBe(0);
    expect(stdout).not.toContain('"decision"');
    expect(stdout).not.toContain('permissionDecision');
    expect(stdout).not.toContain('"continue":false');
  });

  it('exits 0 on malformed stdin', () => {
    const root = makeDir();
    writeFileSync(path.join(root, 'Sales.pbip'), '{}');
    const result = spawnSync(process.execPath, [HOOK], {
      input: 'not json',
      env: baseEnv({ CLAUDE_PROJECT_DIR: root }),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
  });

  it('command name is NOT blocked by the modeling scope guard (rename regression guard)', () => {
    const result = spawnSync(process.execPath, [SCOPE_GUARD], {
      input: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        prompt: '/pbi-init-data-dictionary create a data dictionary',
      }),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect((result.stdout ?? '').trim()).toBe('');
  });
});
