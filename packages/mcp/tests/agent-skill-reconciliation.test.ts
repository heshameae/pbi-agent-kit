// Deterministic reconciliation backstop (audit gap: nothing reconciled agent/skill
// frontmatter against reality, so stale skill references and invented/stale MCP tool
// names drifted in silently — e.g. a skill or agent naming a tool that no longer
// exists, which fails only at runtime and pushes an agent to improvise). This test
// fails CI when:
//   1. an agent's `skills:` lists a skill that does not exist on disk, or
//   2. any MCP tool named in an agent's `tools:` or a skill's `allowed-tools` is NOT a
//      tool the server actually registers (a phantom/stale tool name).
// Pure structural check over real frontmatter + the live tool registry — no network,
// no LLM. NOTE: we deliberately do NOT require a skill's allowed-tools to be a subset
// of the loading agent's tools — read-only agents (e.g. data-analyst) legitimately load
// authoring/modeling skills for their GUIDANCE without granting those skills' write tools.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const MCP_TOOL_PREFIX = 'mcp__plugin_pbi-agent-kit_pbi-modeling-beta__';

function frontmatter(md: string): string {
  return /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
}

function commaListField(fm: string, key: string): string[] {
  const raw = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm)?.[1] ?? '';
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function bracketListField(fm: string, key: string): string[] {
  const raw = new RegExp(`^${key}:\\s*\\[(.*?)\\]`, 'm').exec(fm)?.[1] ?? '';
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

interface FrontmatterSource {
  source: string; // file label for error messages
  mcpTools: string[];
  skills: string[];
}

function loadAgentFrontmatter(): FrontmatterSource[] {
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fm = frontmatter(readFileSync(path.join(AGENTS_DIR, f), 'utf8'));
      return {
        source: `agents/${f}`,
        mcpTools: commaListField(fm, 'tools').filter((t) => t.startsWith(MCP_TOOL_PREFIX)),
        skills: bracketListField(fm, 'skills'),
      };
    });
}

function loadSkillFrontmatter(): FrontmatterSource[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(SKILLS_DIR, d.name, 'SKILL.md')))
    .map((d) => {
      const fm = frontmatter(readFileSync(path.join(SKILLS_DIR, d.name, 'SKILL.md'), 'utf8'));
      return {
        source: `skills/${d.name}/SKILL.md`,
        mcpTools: commaListField(fm, 'allowed-tools').filter((t) => t.startsWith(MCP_TOOL_PREFIX)),
        skills: [],
      };
    });
}

describe('agent ↔ skill reconciliation', () => {
  let registeredTools: Set<string>;

  beforeAll(async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      // Frontmatter uses the namespaced form mcp__plugin_..._<tool>; the registry uses bare names.
      registeredTools = new Set(tools.map((t) => `${MCP_TOOL_PREFIX}${t.name}`));
    } finally {
      await client.close();
    }
  });

  it('every skill an agent loads exists on disk', () => {
    const missing: string[] = [];
    for (const agent of loadAgentFrontmatter()) {
      for (const skill of agent.skills) {
        if (!existsSync(path.join(SKILLS_DIR, skill, 'SKILL.md'))) {
          missing.push(`${agent.source} → ${skill}`);
        }
      }
    }
    expect(missing, `agents load skills that do not exist: ${missing.join('; ')}`).toEqual([]);
  });

  it('every MCP tool named in agent/skill frontmatter is actually registered', () => {
    const phantom: string[] = [];
    for (const src of [...loadAgentFrontmatter(), ...loadSkillFrontmatter()]) {
      for (const tool of src.mcpTools) {
        if (!registeredTools.has(tool)) phantom.push(`${src.source}: ${tool}`);
      }
    }
    expect(
      phantom,
      `frontmatter names MCP tools that the server does not register:\n${phantom.join('\n')}`,
    ).toEqual([]);
  });
});

// Walk every markdown file under a directory (recursively), returning [relPath, text].
function allMarkdown(dir: string, base = dir): Array<[string, string]> {
  if (!existsSync(dir)) return [];
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allMarkdown(full, base));
    else if (entry.name.endsWith('.md'))
      out.push([path.relative(base, full), readFileSync(full, 'utf8')]);
  }
  return out;
}

describe('phantom-capability + code-namespace guards', () => {
  it('no agent/skill markdown instructs a DMV/INFO scope-probe function (not available in the beta)', () => {
    // The modeling-only beta exposes no INFO.VIEW.* / DMV query path; a doc that names
    // one pushes an agent to call a tool that does not exist. (Removed from
    // model-builder.md once already — this keeps it from drifting back in.)
    const hits: string[] = [];
    for (const root of [AGENTS_DIR, SKILLS_DIR]) {
      for (const [rel, text] of allMarkdown(root)) {
        if (/INFO\.VIEW\./.test(text)) hits.push(`${path.basename(root)}/${rel}`);
      }
    }
    expect(hits, `phantom DMV/INFO scope-probe reference found in: ${hits.join(', ')}`).toEqual([]);
  });

  it('the authoring-measures performance catalog stays in the PERF namespace (no DAX### collision)', () => {
    // bpa.ts / pbi_model_check emit `DAX###` rule ids; the performance-pattern catalog
    // uses `PERF###`. If a `DAX###` token reappears under authoring-measures it collides
    // with the enforced ids and an agent maps a checker finding to the wrong remediation
    // (audit finding H-D). The enforced `DAX###` ids live only in reviewing-models.
    const authoringDir = path.join(SKILLS_DIR, 'authoring-measures');
    const hits: string[] = [];
    for (const [rel, text] of allMarkdown(authoringDir)) {
      if (/DAX[0-9]{3}/.test(text)) hits.push(`authoring-measures/${rel}`);
    }
    expect(
      hits,
      `DAX### code tokens (should be PERF###) found under authoring-measures: ${hits.join(', ')}`,
    ).toEqual([]);
  });
});
