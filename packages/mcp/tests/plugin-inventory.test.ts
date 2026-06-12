// EFFECTIVE-INVENTORY packaging launch gate.
//
// This is the deterministic, CI-safe launch gate that would have caught the two
// packaging defects this beta shipped with: (1) the report-skill leak — report
// skills/agents bleeding into the modeling-only surface — and (2) Agents(0) —
// the plugin manifest declaring agents/skills in a way that produced an empty
// effective inventory. The manual equivalent is `claude plugin details` showing
// Skills (5) + Agents (3); this gate asserts the same effective inventory purely
// from the on-disk repo layout, so it does NOT depend on the `claude` CLI.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/mcp/tests -> repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');

function repoPath(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts);
}

function dirNames(...parts: string[]): string[] {
  return readdirSync(repoPath(...parts), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function markdownNames(...parts: string[]): string[] {
  return readdirSync(repoPath(...parts), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

const MODELING_SKILLS = [
  'authoring-measures',
  'modeling-semantic-model',
  'pbi-init-config',
  'power-query',
  'reviewing-models',
];

const MODELING_AGENTS = ['data-analyst.md', 'model-builder.md', 'model-reviewer.md'];

// The 12 report skills that must never appear under skills/ (they live in
// archive/skills/). Hardcoding the packaging inventory here is intentional and is
// NOT a dataset hardcode — these are first-party skill directory names that the
// launch gate exists to pin.
const REPORT_SKILLS = [
  'designing-reports',
  'pbi-bookmarks',
  'pbi-filters',
  'pbi-layout',
  'pbi-pages',
  'pbi-report',
  'pbi-status',
  'pbi-themes',
  'pbi-validate',
  'pbi-visuals',
  'planning-dashboards',
  'reviewing-reports',
];

const ARCHIVED_REPORT_SKILLS = [
  ...REPORT_SKILLS,
  'pbi-scaffold',
  'pbi-scaffold-drill',
  'pbi-scaffold-kpi-grid',
  'pbi-scaffold-overview',
];

const REPORT_AGENTS = [
  'pbi-designer.md',
  'pbi-report-reviewer.md',
  'pbi-report-validator.md',
  'report-builder.md',
  'report-reviewer.md',
];

describe('plugin effective-inventory launch gate', () => {
  describe('.claude-plugin/plugin.json', () => {
    const manifest = JSON.parse(
      readFileSync(repoPath('.claude-plugin', 'plugin.json'), 'utf8'),
    ) as Record<string, unknown>;

    it('declares no explicit skills key (relies on default skill scan)', () => {
      expect(Object.hasOwn(manifest, 'skills')).toBe(false);
    });

    it('declares no explicit agents key (relies on default agent scan)', () => {
      expect(Object.hasOwn(manifest, 'agents')).toBe(false);
    });

    it('points mcpServers at the modeling-only ./.mcp.json', () => {
      expect(manifest.mcpServers).toBe('./.mcp.json');
    });
  });

  describe('skills/ effective inventory', () => {
    it('contains exactly the 5 modeling skills', () => {
      expect(dirNames('skills')).toEqual([...MODELING_SKILLS].sort());
    });

    it('ships a SKILL.md in every modeling skill', () => {
      for (const skill of MODELING_SKILLS) {
        const skillFile = repoPath('skills', skill, 'SKILL.md');
        expect(existsSync(skillFile), `${skill}/SKILL.md should exist`).toBe(true);
        expect(statSync(skillFile).isFile(), `${skill}/SKILL.md should be a file`).toBe(true);
      }
    });
  });

  describe('agents/ effective inventory', () => {
    it('contains exactly the 3 modeling agents', () => {
      expect(markdownNames('agents')).toEqual([...MODELING_AGENTS].sort());
    });
  });

  describe('report surface is fully partitioned out of the modeling package', () => {
    it('none of the 12 report skills appear under skills/', () => {
      const shipped = new Set(dirNames('skills'));
      for (const reportSkill of REPORT_SKILLS) {
        expect(shipped.has(reportSkill), `${reportSkill} must NOT be under skills/`).toBe(false);
      }
    });

    it('all report-authoring skills exist under archive/skills/', () => {
      const reportShipped = new Set(dirNames('archive/skills'));
      for (const reportSkill of ARCHIVED_REPORT_SKILLS) {
        expect(
          reportShipped.has(reportSkill),
          `${reportSkill} should be under archive/skills/`,
        ).toBe(true);
      }
    });

    it('report agents live under archive/agents/ and NOT under agents/', () => {
      const modelingAgents = new Set(markdownNames('agents'));
      const reportAgents = new Set(markdownNames('archive/agents'));
      for (const agent of REPORT_AGENTS) {
        expect(modelingAgents.has(agent), `${agent} must NOT be under agents/`).toBe(false);
        expect(reportAgents.has(agent), `${agent} should be under archive/agents/`).toBe(true);
      }
    });
  });

  describe('orphan manifests are absent', () => {
    it('does not ship .claude-plugin/plugin.modeling.json', () => {
      expect(existsSync(repoPath('.claude-plugin', 'plugin.modeling.json'))).toBe(false);
    });

    it('does not ship .mcp.modeling.json', () => {
      expect(existsSync(repoPath('.mcp.modeling.json'))).toBe(false);
    });
  });

  describe('hooks/hooks.json', () => {
    const hooks = JSON.parse(readFileSync(repoPath('hooks', 'hooks.json'), 'utf8')) as {
      hooks?: Record<string, unknown>;
    };
    const hookKeys = hooks.hooks ?? {};

    it('keeps UserPromptSubmit, UserPromptExpansion, and PreToolUse', () => {
      expect(Object.hasOwn(hookKeys, 'UserPromptSubmit')).toBe(true);
      expect(Object.hasOwn(hookKeys, 'UserPromptExpansion')).toBe(true);
      expect(Object.hasOwn(hookKeys, 'PreToolUse')).toBe(true);
    });

    it('no longer registers a PostToolUse block', () => {
      expect(Object.hasOwn(hookKeys, 'PostToolUse')).toBe(false);
    });
  });
});
