import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Focused unit tests for the no-Python / no-raw-artifact-surgery PreToolUse
// guard. Blocks exit with status 2 and write a reason to stderr; allowed
// operations exit 0. See claude-contracts.test.ts for the canonical
// runGuardPayload / CLAUDE_PLUGIN_ROOT spawn pattern this mirrors. Artifact
// paths use a generic fixture path under tmp; no real dataset fields appear.

const root = path.resolve(__dirname, '../../..');

// Dataset-agnostic fixture artifact path. The name is arbitrary and carries no
// real table/column/field from any dataset.
const FIXTURE_ARTIFACT = '/tmp/pbi-guard-fixture/Fixture.SemanticModel/definition/model.tmdl';

function runGuardPayload(payload: Record<string, unknown>) {
  const script = path.join(root, 'hooks/scripts/guard-no-python-powerbi-ops.mjs');
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
  });
}

function runBash(command: string) {
  return runGuardPayload({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  });
}

describe('guard-no-python-powerbi-ops', () => {
  it('blocks Python invocation', () => {
    const result = runBash('python3 -c "print(1)"');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Python must not be used');
  });

  it('blocks raw artifact file surgery on a fixture artifact path', () => {
    const result = runBash(`sed -i '' 's/a/b/' ${FIXTURE_ARTIFACT}`);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('raw Power BI artifact file surgery');
  });

  it('blocks direct Microsoft modeling MCP writes', () => {
    const result = runGuardPayload({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__x__measure_operations',
      tool_input: { request: { operation: 'Create' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Direct Microsoft Power BI modeling MCP writes');
  });

  it('allows read-only Microsoft modeling MCP operations', () => {
    const result = runGuardPayload({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__x__measure_operations',
      tool_input: { request: { operation: 'Get' } },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('allows ordinary development commands', () => {
    const result = runBash('npm test');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
