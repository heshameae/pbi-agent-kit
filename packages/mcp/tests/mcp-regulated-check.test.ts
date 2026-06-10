// Regulated-readiness must BLOCK at the MCP tool boundary.
//
// This drives the real `pbi_model_regulated_check` MCP tool handler end-to-end
// over the in-memory transport (no faked pass). The handler always runs with
// regulatedEnterprise enabled; we invoke it with an EMPTY policyEvidence object
// against a real TMDL fixture model. The launch contract is that missing audit
// evidence keeps regulated readiness `blocked` (never silently `passed`) and
// surfaces a non-empty missingEvidence list — the tool must never infer bank
// safety from model structure alone.
//
// We pass the fixture via `modelPath` and disable the live probe
// (PBI_REPORT_MCP_DISABLE_LIVE_PROBE=1) so the handler takes its deterministic
// offline branch: parse the TMDL folder, then run modelDoctor with
// { regulatedEnterprise: true, policyEvidence } — the exact code path a live
// invocation would reach after snapshotting. No live Power BI Desktop is needed.
// Dataset-agnostic: we assert on the gate's structural status/missingEvidence
// only, never on any field, column, or table name from the fixture.

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, setModelDriverForTests } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAR_FIXTURE = path.resolve(__dirname, '../../core/tests/modeling/fixtures/star-good');

const tempRoots: string[] = [];

beforeEach(() => {
  // Force the deterministic offline branch of the handler — never probe for a
  // live Power BI Desktop instance from CI.
  process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
});

afterEach(() => {
  // biome-ignore lint/performance/noDelete: tests must restore the process environment
  delete process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE;
  setModelDriverForTests(null);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function semanticModelFixture(source: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pbi-regulated-check-'));
  tempRoots.push(root);
  const definition = path.join(root, 'Fixture.SemanticModel', 'definition');
  cpSync(source, definition, { recursive: true });
  return definition;
}

async function callTool(name: string, args: Record<string, unknown>) {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}

function jsonPayload(result: Awaited<ReturnType<typeof callTool>>): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, unknown>;
  }
  const text = result.content.find((c) => c.type === 'text')?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

type RegulatedReadiness = {
  status?: string;
  missingEvidence?: unknown;
  aiExposure?: { status?: string; missingEvidence?: unknown };
};

describe('pbi_model_regulated_check MCP boundary', () => {
  it('blocks with a non-empty missingEvidence list when policyEvidence is EMPTY', async () => {
    const result = await callTool('pbi_model_regulated_check', {
      modelPath: semanticModelFixture(STAR_FIXTURE),
      policyEvidence: {},
    });

    const regulated = jsonPayload(result).regulatedEnterprise as RegulatedReadiness | undefined;

    expect(regulated, 'regulatedEnterprise readiness should be present').toBeDefined();
    expect(regulated?.status).toBe('blocked');
    expect(regulated?.status).not.toBe('passed');
    expect(Array.isArray(regulated?.missingEvidence)).toBe(true);
    expect((regulated?.missingEvidence as unknown[]).length).toBeGreaterThan(0);
  });

  it('blocks when policyEvidence is MISSING entirely (no inference of bank safety)', async () => {
    const result = await callTool('pbi_model_regulated_check', {
      modelPath: semanticModelFixture(STAR_FIXTURE),
    });

    const regulated = jsonPayload(result).regulatedEnterprise as RegulatedReadiness | undefined;

    expect(regulated?.status).toBe('blocked');
    expect((regulated?.missingEvidence as unknown[]).length).toBeGreaterThan(0);
  });
});
