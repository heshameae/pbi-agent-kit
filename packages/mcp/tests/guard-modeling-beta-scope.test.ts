import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression gate for the widened modeling-beta scope guard. The guard script
// classifies prompts/slash-expansions and refuses report/dashboard authoring
// surfaces by NAME and by report MCP tool. This file pins the classification so
// the scope cannot silently narrow again. See claude-contracts.test.ts for the
// canonical runScopePayload / CLAUDE_PLUGIN_ROOT spawn pattern this mirrors.

const root = path.resolve(__dirname, '../../..');

function runScopePayload(payload: Record<string, unknown>) {
  const script = path.join(root, 'hooks/scripts/guard-modeling-beta-scope.mjs');
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
  });
}

describe('guard-modeling-beta-scope classification', () => {
  it('blocks direct report-authoring prompts on UserPromptSubmit', () => {
    for (const prompt of [
      'Build a dashboard page with visuals.',
      'Create a Power BI report with bookmarks.',
      'Design a report page with charts and slicers.',
      'Generate a PBIR report with a theme.',
    ]) {
      const result = runScopePayload({
        hook_event_name: 'UserPromptSubmit',
        prompt,
      });
      expect(result.status, prompt).toBe(0);
      const decision = JSON.parse(result.stdout);
      expect(decision.decision, prompt).toBe('block');
      expect(decision.reason, prompt).toContain('Report authoring is not available');
    }
  });

  // REGRESSION: each of these skill/agent names was previously UNGUARDED. They
  // correspond to skills physically relocated to skills-report/ (and the
  // dev-only lineage-analysis under skills-internal/), but they must still be
  // refused by NAME as defense-in-depth so a stale Skill call cannot reach a
  // report-authoring surface even though those skills are no longer
  // auto-scanned into the modeling-beta plugin.
  it('denies PreToolUse Skill calls for newly-guarded relocated report/dev skill names', () => {
    for (const skill of [
      'pbi-mcp-ts:pbi-bookmarks',
      'pbi-mcp-ts:pbi-status',
      'pbi-mcp-ts:pbi-validate',
      'pbi-mcp-ts:reviewing-reports',
      'pbi-mcp-ts:lineage-analysis',
    ]) {
      const result = runScopePayload({
        hook_event_name: 'PreToolUse',
        tool_name: 'Skill',
        tool_input: { skill },
      });
      expect(result.status, skill).toBe(0);
      const decision = JSON.parse(result.stdout);
      expect(decision.hookSpecificOutput.permissionDecision, skill).toBe('deny');
      expect(decision.hookSpecificOutput.permissionDecisionReason, skill).toContain(
        'Report authoring is not available',
      );
    }
  });

  it('blocks a UserPromptExpansion of a newly-guarded report-review skill by name', () => {
    const result = runScopePayload({
      hook_event_name: 'UserPromptExpansion',
      prompt: '/pbi-mcp-ts:reviewing-reports Review the report pages',
    });
    expect(result.status).toBe(0);
    const decision = JSON.parse(result.stdout);
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('Report authoring is not available');
  });

  it('denies report MCP tool calls so wrapper gates cannot be bypassed', () => {
    for (const toolName of [
      'mcp__plugin_pbi-mcp-ts_pbi-modeling-beta__pbi_visual_add',
      'mcp__plugin_pbi-mcp-ts_pbi-modeling-beta__pbi_page_add',
      'mcp__plugin_pbi-mcp-ts_pbi-modeling-beta__pbi_bookmark_create',
    ]) {
      const result = runScopePayload({
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: { pageName: 'Executive' },
      });
      expect(result.status, toolName).toBe(0);
      const decision = JSON.parse(result.stdout);
      expect(decision.hookSpecificOutput.permissionDecision, toolName).toBe('deny');
      expect(decision.hookSpecificOutput.permissionDecisionReason, toolName).toContain(
        'Report authoring is not available',
      );
    }
  });

  it('allows pure modeling prompts through without a decision', () => {
    for (const prompt of [
      'List tables and run model check.',
      'Plan a Date table and relationships.',
      'Inspect the live model, list measures and relationships.',
    ]) {
      const result = runScopePayload({
        hook_event_name: 'UserPromptSubmit',
        prompt,
      });
      expect(result.status, prompt).toBe(0);
      expect(result.stdout, prompt).toBe('');
      expect(result.stderr, prompt).toBe('');
    }
  });

  it('adds a scope notice for mixed report-authoring + modeling prompts', () => {
    for (const prompt of [
      'Build a dashboard and create the missing measures.',
      'Design the report visuals and check the relationships.',
    ]) {
      const result = runScopePayload({
        hook_event_name: 'UserPromptSubmit',
        prompt,
      });
      expect(result.status, prompt).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.decision, prompt).toBeUndefined();
      expect(output.additionalContext, prompt).toContain('Modeling beta scope');
    }
  });
});
