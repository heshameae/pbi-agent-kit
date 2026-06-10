import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function runGuardPayload(payload: Record<string, unknown>) {
  const script = path.join(root, 'hooks/scripts/guard-no-python-powerbi-ops.mjs');
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
  });
}

function runScopePayload(payload: Record<string, unknown>) {
  const script = path.join(root, 'hooks/scripts/guard-modeling-beta-scope.mjs');
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
  });
}

function runGuard(command: string) {
  return runGuardPayload({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  });
}

describe('Claude model-operation contracts', () => {
  it('registers a PreToolUse Bash guard for Python Power BI artifact surgery', () => {
    const hooks = JSON.parse(readRepoFile('hooks/hooks.json')) as {
      hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
    };
    const bashHooks = hooks.hooks?.PreToolUse?.filter((entry) => entry.matcher === 'Bash') ?? [];
    expect(JSON.stringify(bashHooks)).toContain('guard-no-python-powerbi-ops.mjs');
  });

  it('registers a PreToolUse guard for raw Power BI artifact edits', () => {
    const hooks = JSON.parse(readRepoFile('hooks/hooks.json')) as {
      hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
    };
    const editHooks =
      hooks.hooks?.PreToolUse?.filter((entry) =>
        /Edit|Write|MultiEdit|Update/.test(entry.matcher ?? ''),
      ) ?? [];
    expect(JSON.stringify(editHooks)).toContain('guard-no-python-powerbi-ops.mjs');
  });

  it('registers a PreToolUse guard for direct Microsoft modeling MCP calls', () => {
    const hooks = JSON.parse(readRepoFile('hooks/hooks.json')) as {
      hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> };
    };
    const msMcpHooks =
      hooks.hooks?.PreToolUse?.filter((entry) => /mcp__\.\*/.test(entry.matcher ?? '')) ?? [];
    expect(JSON.stringify(msMcpHooks)).toContain('guard-no-python-powerbi-ops.mjs');
  });

  it('registers modeling-beta scope hooks before prompts, slash expansions, and report tools', () => {
    const hooks = JSON.parse(readRepoFile('hooks/hooks.json')) as {
      hooks?: {
        UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }>;
        UserPromptExpansion?: Array<{ hooks?: Array<{ command?: string }> }>;
        PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>;
      };
    };
    expect(JSON.stringify(hooks.hooks?.UserPromptSubmit ?? [])).toContain(
      'guard-modeling-beta-scope.mjs',
    );
    expect(JSON.stringify(hooks.hooks?.UserPromptExpansion ?? [])).toContain(
      'guard-modeling-beta-scope.mjs',
    );
    const toolScopeHooks =
      hooks.hooks?.PreToolUse?.filter((entry) => /Skill|Task|mcp__/.test(entry.matcher ?? '')) ??
      [];
    expect(JSON.stringify(toolScopeHooks)).toContain('guard-modeling-beta-scope.mjs');
  });

  it('blocks report/dashboard authoring prompts before Claude processes them', () => {
    for (const prompt of [
      'Build me an executive dashboard.',
      'Create a Power BI report page with visuals and slicers.',
      'Design a dashboard layout for the leadership team.',
      'Show revenue by month in a chart on a new report page.',
      'Generate a PBIR report with bookmarks and a theme.',
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

  it('allows reporting-adjacent modeling prep prompts through the scope hook', () => {
    for (const prompt of [
      'Prepare the semantic model for an executive dashboard.',
      'What measures do I need for an actuals vs targets report?',
      'Build the measures for the future dashboard, but do not create report pages.',
      'Inspect the live model, list tables, measures, relationships, and run model check.',
      'Plan a Date table and relationships so reporting can use a governed calendar.',
      'Why is report authoring unavailable in the modeling beta?',
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

  it('adds scope context for mixed report-authoring and modeling prompts', () => {
    for (const prompt of [
      'Build a dashboard and create the missing measures.',
      'Design visuals and check the relationships.',
      'Publish the report and refresh the semantic model.',
    ]) {
      const result = runScopePayload({
        hook_event_name: 'UserPromptSubmit',
        prompt,
      });
      expect(result.status, prompt).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.decision, prompt).toBeUndefined();
      expect(output.additionalContext, prompt).toContain('Modeling beta scope');
      expect(output.additionalContext, prompt).toContain(
        'Continue only explicit semantic-model work',
      );
    }
  });

  it('blocks direct report skill expansion and stale report/PBIR tool calls', () => {
    const expansion = runScopePayload({
      hook_event_name: 'UserPromptExpansion',
      prompt: '/pbi-mcp-ts:planning-dashboards Build an executive dashboard',
    });
    expect(JSON.parse(expansion.stdout).decision).toBe('block');

    const reportTool = runScopePayload({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__plugin_pbi-mcp-ts_pbi-report__pbi_visual_add',
      tool_input: { pageName: 'Executive' },
    });
    const reportToolDecision = JSON.parse(reportTool.stdout);
    expect(reportToolDecision.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(reportToolDecision.hookSpecificOutput.permissionDecisionReason).toContain(
      'Report authoring is not available',
    );

    const skillTool = runScopePayload({
      hook_event_name: 'PreToolUse',
      tool_name: 'Skill',
      tool_input: { skill: 'pbi-mcp-ts:planning-dashboards' },
    });
    const skillDecision = JSON.parse(skillTool.stdout);
    expect(skillDecision.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('blocks Python commands that touch semantic-model artifacts', () => {
    const result = runGuard(
      "python3 -c \"path = '/tmp/Demo.SemanticModel/definition/tables/Date.tmdl'; open(path, 'wb').write(b'x')\"",
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Python must not be used');
  });

  it('blocks Python commands used only for data inspection', () => {
    const result = runGuard('python3 -c "import csv; print(\'range\')"');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Python must not be used');
  });

  it('blocks common Python package-runner entrypoints too', () => {
    for (const command of [
      'pip install pandas',
      '/usr/bin/python3 -c "print(1)"',
      '.venv/bin/python -c "print(1)"',
      '"/usr/bin/python3" -c "print(1)"',
      '".venv/bin/python" -c "print(1)"',
      '"/tmp/path with spaces/python3" -c "print(1)"',
      'uv run python -c "print(1)"',
      'poetry run python3 -c "print(1)"',
    ]) {
      const result = runGuard(command);
      expect(result.status, command).toBe(2);
      expect(result.stderr, command).toContain('Python must not be used');
    }
  });

  it('allows ordinary non-Python development commands', () => {
    const result = runGuard('pnpm --filter pbi-report-mcp test');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('allows text searches that mention Python without invoking it', () => {
    const result = runGuard('rg "python3" agents skills');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('blocks raw edits to Power BI artifacts outside the plugin repo', () => {
    for (const toolName of ['Edit', 'Write', 'MultiEdit']) {
      const result = runGuardPayload({
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: {
          file_path:
            '/Users/example/Documents/pbi-demo/Demo.SemanticModel/definition/tables/Calendar.tmdl',
        },
      });
      expect(result.status, toolName).toBe(2);
      expect(result.stderr, toolName).toContain('raw Power BI artifact edits are not allowed');
    }
  });

  it('blocks raw edits to Power BI artifacts inside the plugin repo unless allowlisted', () => {
    for (const toolName of ['Edit', 'Write', 'MultiEdit']) {
      const result = runGuardPayload({
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: {
          file_path: path.join(root, 'dashboard/Truth.SemanticModel/definition/model.tmdl'),
        },
      });
      expect(result.status, toolName).toBe(2);
      expect(result.stderr, toolName).toContain('raw Power BI artifact edits are not allowed');
    }
  });

  it('allows repository fixture edits for local development', () => {
    const result = runGuardPayload({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(
          root,
          'packages/core/tests/modeling/fixtures/star-good/tables/Calendar.tmdl',
        ),
      },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('blocks Bash file-surgery commands against Power BI artifacts', () => {
    for (const command of [
      "node -e \"require('fs').writeFileSync('dashboard/Truth.SemanticModel/definition/model.tmdl', '')\"",
      "node -e \"const { writeFileSync } = require('fs'); writeFileSync('dashboard/Truth.SemanticModel/definition/model.tmdl', '')\"",
      "node -e \"require('fs/promises').writeFile('dashboard/Truth.SemanticModel/definition/model.tmdl', '')\"",
      "node -e \"require('fs').createWriteStream('dashboard/Truth.SemanticModel/definition/model.tmdl').end('x')\"",
      "node -e \"const fs = require('fs'); const fd = fs.openSync('dashboard/Truth.SemanticModel/definition/model.tmdl', 'w'); fs.writeSync(fd, 'x')\"",
      "node -e \"require('fs').cpSync('package.json', 'dashboard/Truth.SemanticModel/definition/model.tmdl')\"",
      "sed -i '' 's/a/b/g' dashboard/Truth.SemanticModel/definition/model.tmdl",
      "jq '.x=1' dashboard/Truth.Report/definition/report.json > dashboard/Truth.Report/definition/report.json",
      "perl -pi -e 's/a/b/g' dashboard/Truth.pbip",
      "printf 'x' > dashboard/Truth.SemanticModel/definition/model.tmdl",
      'cat package.json > dashboard/Truth.SemanticModel/definition/model.tmdl',
    ]) {
      const result = runGuard(command);
      expect(result.status, command).toBe(2);
      expect(result.stderr, command).toContain('raw Power BI artifact file surgery');
    }
  });

  it('blocks direct Microsoft modeling MCP write tools so wrapper gates cannot be bypassed', () => {
    for (const toolName of [
      'mcp__powerbi_modeling_mcp__measure_operations',
      'mcp__powerbi_modeling_mcp__relationship_operations',
      'mcp__custom_alias__table_operations',
    ]) {
      const result = runGuardPayload({
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: { request: { operation: 'Create' } },
      });
      expect(result.status, toolName).toBe(2);
      expect(result.stderr, toolName).toContain('Direct Microsoft Power BI modeling MCP writes');
    }
  });

  it('keeps model-facing agents and skills explicit about no Python/file-surgery fallback', () => {
    const contractFiles = [
      'AGENTS.md',
      'CLAUDE.md',
      'agents/data-analyst.md',
      'agents/model-builder.md',
      'agents/model-reviewer.md',
      'skills/modeling-semantic-model/SKILL.md',
      'skills-report/planning-dashboards/SKILL.md',
      'skills-report/planning-dashboards/references/intake-protocol.md',
      'skills/reviewing-models/SKILL.md',
      'skills-report/pbi-report/SKILL.md',
    ];

    for (const file of contractFiles) {
      const text = readRepoFile(file).toLowerCase();
      expect(text, file).toContain('python');
      expect(text, file).toContain('mcp');
      expect(text, file).toMatch(/unsupported|blocked|stop/);
    }
  });

  it('keeps layout skill guidance on wrapper model inventory tools', () => {
    const text = readRepoFile('skills-report/pbi-layout/SKILL.md');

    expect(text).toContain('pbi_model_list_tables');
    expect(text).toContain('pbi_model_list_measures');
    expect(text).not.toContain('@microsoft/powerbi-modeling-mcp');
  });

  it('keeps dashboard/model workflows explicit about the semantic clarification gate', () => {
    const contractFiles = [
      'docs/system-improvements.md',
      'skills-report/planning-dashboards/SKILL.md',
      'skills-report/planning-dashboards/references/intake-protocol.md',
      'agents/data-analyst.md',
      'agents/model-builder.md',
      'agents-report/report-builder.md',
      'agents/model-reviewer.md',
    ];

    for (const file of contractFiles) {
      const text = readRepoFile(file).toLowerCase();
      expect(text, file).toContain('semantic clarification gate');
      expect(text, file).toContain('date');
      expect(text, file).toMatch(/target|budget|forecast/);
      expect(text, file).toMatch(/ask|clarifyingquestions|needs-user-input/);
    }
  });

  it('keeps measure authoring grounded in confirmed intent and dictionary evidence', () => {
    const contractFiles = [
      'skills/authoring-measures/SKILL.md',
      'skills/authoring-measures/references/measure-intent-contract.md',
      'skills-report/planning-dashboards/SKILL.md',
      'skills-report/planning-dashboards/references/intake-protocol.md',
      'skills-report/planning-dashboards/references/metric-contract.md',
      'skills-report/planning-dashboards/references/model-discovery.md',
      'skills/modeling-semantic-model/references/ai-readiness.md',
      'skills/modeling-semantic-model/references/naming.md',
      'agents/data-analyst.md',
      'agents/model-builder.md',
      'agents/model-reviewer.md',
      'agents-report/report-builder.md',
    ];

    for (const file of contractFiles) {
      const text = readRepoFile(file).toLowerCase();
      expect(text, file).toContain('measure intent');
      expect(text, file).toMatch(/data dictionary|glossary/);
      expect(text, file).toContain('draft');
      expect(text, file).toContain('confirmed');
      expect(text, file).toContain('needs-user-input');
      expect(text, file).toMatch(
        /no-assumption|do not infer|never infer|never invent|do not guess/,
      );
      expect(text, file).toMatch(/time-intelligence|time intelligence/);
    }
  });

  it('keeps user data dictionaries recommended but not mandatory', () => {
    const docs = readRepoFile('docs/data-dictionary.md').toLowerCase();
    expect(docs).toContain('optional');
    expect(docs).toContain('do not block');
    expect(docs).toContain('business context only');

    const measureIntent = readRepoFile(
      'skills/authoring-measures/references/measure-intent-contract.md',
    ).toLowerCase();
    expect(measureIntent).toContain('recommended context, not a required file');
    expect(measureIntent).toMatch(/direct user confirmation|governed spec|dictionary\/glossary/);

    const modelBuilder = readRepoFile('agents/model-builder.md').toLowerCase();
    expect(modelBuilder).toContain('dictionary/glossary can confirm business meaning');
    expect(modelBuilder).toContain('proves refs exist, not business meaning');
  });

  it('keeps banking KPI guidance as a dataset-agnostic question bank', () => {
    const text = readRepoFile(
      'skills-report/planning-dashboards/references/banking-kpi-guidance.md',
    ).toLowerCase();

    expect(text).toContain('question bank');
    expect(text).toContain('not a formula library');
    for (const term of [
      'casa',
      'nim',
      'nims',
      'customer advances',
      'customer deposits',
      'net impairment',
      'net cor',
      'ftp',
      'stp',
      'payments',
      'collections',
      'transactions',
      'headcount',
      'regulated reporting',
    ]) {
      expect(text).toContain(term);
    }
    expect(text).toMatch(/ask|confirm|clarif/);
    expect(text).toMatch(/no-assumption|do not infer|never infer|never invent|do not guess/);
  });

  it('keeps Date table workflows on the governed create path', () => {
    const contractFiles = [
      'docs/system-improvements.md',
      'skills/modeling-semantic-model/SKILL.md',
      'skills-report/planning-dashboards/SKILL.md',
      'skills-report/planning-dashboards/references/intake-protocol.md',
      'agents/data-analyst.md',
      'agents/model-builder.md',
      'agents/model-reviewer.md',
    ];

    for (const file of contractFiles) {
      const text = readRepoFile(file);
      const lower = text.toLowerCase();
      expect(text, file).toContain('pbi_model_plan_date_table');
      expect(text, file).toMatch(/pbi_date_table_create_governed|pbi_table_mark_as_date/);
      expect(lower, file).toMatch(/observed fact min\/max|recommendedrange|fact-anchored/);
      expect(text, file).toMatch(/futureHorizonDays|future horizon|forecast-horizon/);
      expect(lower, file).toMatch(/today\(\)|now\(\)|today\/now/);
      expect(lower, file).toMatch(/never|do not|refused|rejected/);
      expect(lower, file).toMatch(/pbi_dax_query[\s\S]{0,180}fallback|fallback[\s\S]{0,180}pbi_dax_query/);
      expect(lower, file).toMatch(/manual dax|prompt-generated dax|provide dax/);
    }
  });

  it('requires observable target/date grain to be probed before asking the user', () => {
    const contractFiles = [
      'docs/system-improvements.md',
      'skills/modeling-semantic-model/SKILL.md',
      'agents/data-analyst.md',
      'agents/model-builder.md',
      'agents/model-reviewer.md',
    ];

    for (const file of contractFiles) {
      const text = readRepoFile(file);
      const lower = text.toLowerCase();
      expect(text, file).toContain('pbi_model_plan_actuals_targets_join');
      expect(text, file).toContain('pbi_model_plan_date_grain');
      expect(lower, file).toMatch(/before asking|before any grain question/);
      expect(lower, file).toMatch(/observable|observed/);
      expect(lower, file).toMatch(/target grain|date grain/);
      expect(lower, file).toMatch(/allocation|missing-date|missing target/);
    }
  });

  it('auto-scans only modeling agents (report agents live outside the scanned agents/ dir)', () => {
    // Scope is enforced by directory isolation, not a manifest allowlist. An
    // explicit `agents` file-path array suppressed default discovery and loaded
    // ZERO agents in this Claude Code version, so the manifest carries no agents
    // key and the agents/ directory must contain only the modeling agents.
    const manifest = JSON.parse(readRepoFile('.claude-plugin/plugin.json')) as {
      agents?: string[];
    };
    expect(manifest.agents).toBeUndefined();

    const scannedAgents = readdirSync(path.join(root, 'agents'))
      .filter((file) => file.endsWith('.md'))
      .sort();
    expect(scannedAgents).toEqual(['data-analyst.md', 'model-builder.md', 'model-reviewer.md']);
    expect(scannedAgents).not.toContain('report-builder.md');
    expect(scannedAgents).not.toContain('report-reviewer.md');

    // Report agents are preserved out of the scanned surface for the dogfood profile.
    const reportAgents = readdirSync(path.join(root, 'agents-report'))
      .filter((file) => file.endsWith('.md'))
      .sort();
    expect(reportAgents).toEqual(['report-builder.md', 'report-reviewer.md']);
  });

  it('installs the modeling beta MCP server and auto-scans only modeling skills', () => {
    const manifest = JSON.parse(readRepoFile('.claude-plugin/plugin.json')) as {
      mcpServers?: string;
      skills?: string[];
      agents?: string[];
    };
    expect(manifest.mcpServers).toBe('./.mcp.json');
    // A manifest `skills` list ADDS to the default skills/ scan (it does not
    // exclude), so scope is enforced by what physically sits under skills/.
    expect(manifest.skills).toBeUndefined();
    expect(manifest.agents).toBeUndefined();

    const scannedSkills = readdirSync(path.join(root, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(scannedSkills).toEqual([
      'authoring-measures',
      'modeling-semantic-model',
      'pbi-init-config',
      'power-query',
      'reviewing-models',
    ]);
    for (const reportSkill of [
      'designing-reports',
      'pbi-report',
      'pbi-pages',
      'pbi-visuals',
      'pbi-layout',
      'pbi-themes',
      'pbi-filters',
      'pbi-bookmarks',
      'pbi-status',
      'pbi-validate',
      'planning-dashboards',
      'reviewing-reports',
    ]) {
      expect(scannedSkills, reportSkill).not.toContain(reportSkill);
    }

    const mcp = JSON.parse(readRepoFile('.mcp.json')) as {
      mcpServers?: Record<
        string,
        { command?: string; args?: string[]; env?: Record<string, string> }
      >;
    };
    const betaServer = mcp.mcpServers?.['pbi-modeling-beta'];
    expect(betaServer?.command).toBe('node');
    expect(betaServer?.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/scripts/start-mcp.mjs']);
    expect(betaServer?.env?.PBI_MCP_SURFACE).toBe('modeling');
    expect(mcp.mcpServers?.['pbi-report']).toBeUndefined();

    const readme = readRepoFile('README.md');
    expect(readme).toContain('pnpm install');
    expect(readme).toContain('pnpm build');

    const launcher = readRepoFile('scripts/start-mcp.mjs');
    expect(launcher).toContain("spawnSync('pnpm', ['build']");
    expect(launcher).toContain("stdio: ['ignore', 'pipe', 'pipe']");
    expect(launcher).toContain('isBuildStale');
    expect(launcher).toContain('packages/mcp/src');
    expect(launcher).toContain('packages/core/src');
  });

  it('teaches the modeling beta to refuse dashboard/report authoring gracefully', () => {
    const contractFiles = [
      '.claude-plugin/plugin.json',
      'README.md',
      'hooks/scripts/guard-modeling-beta-scope.mjs',
      'skills/modeling-semantic-model/SKILL.md',
      'skills/authoring-measures/SKILL.md',
      'skills/power-query/SKILL.md',
      'agents/data-analyst.md',
      'docs/system-improvements.md',
    ];

    for (const file of contractFiles) {
      const text = readRepoFile(file).toLowerCase();
      expect(text, file).toContain('modeling');
      expect(text, file).toMatch(/dashboard|report/);
      expect(text, file).toMatch(/unavailable|not available/);
      expect(text, file).toMatch(/modeling-only|modeling only/);
    }
  });

  it('keeps modeling beta bundled front-door files from loading dashboard authoring paths', () => {
    const frontDoorFiles = [
      'agents/data-analyst.md',
      'hooks/scripts/guard-modeling-beta-scope.mjs',
      'skills/authoring-measures/SKILL.md',
      'skills/modeling-semantic-model/SKILL.md',
      'skills/power-query/SKILL.md',
    ];

    for (const file of frontDoorFiles) {
      const text = readRepoFile(file).toLowerCase();
      expect(text, file).not.toContain('i can build this');
      expect(text, file).not.toMatch(/route to `?report-builder`?/);
      expect(text, file).not.toMatch(/use the `?pbi-visuals`?/);
      expect(text, file).not.toMatch(/use the `?pbi-filters`?/);
    }
  });

  it('keeps live refresh separate from Ctrl+S persistence', () => {
    const contractFiles = [
      'docs/system-improvements.md',
      'skills/modeling-semantic-model/SKILL.md',
      'agents/model-builder.md',
    ];

    for (const file of contractFiles) {
      const text = readRepoFile(file).toLowerCase();
      expect(text, file).toContain('pbi_model_refresh');
      expect(text, file).toContain('ctrl+s');
      expect(text, file).toMatch(/persist|persistence/);
      expect(text, file).toMatch(/refresh|materialization|materialize/);
    }
  });

  it('keeps PBIR report writes separate from Desktop Ctrl+S persistence', () => {
    const contractFiles = [
      'docs/system-improvements.md',
      'skills-report/pbi-report/SKILL.md',
      'agents-report/report-builder.md',
    ];

    for (const file of contractFiles) {
      const text = readRepoFile(file).toLowerCase();
      expect(text, file).toContain('pbir');
      expect(text, file).toMatch(/disk|files/);
      expect(text, file).toContain('ctrl+s');
      expect(text, file).toMatch(/do not|never/);
      expect(text, file).toMatch(/stale|overwrite/);
      expect(text, file).toMatch(/close\/reopen|reload|reopen/);
    }
  });
});
