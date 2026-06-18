import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

describe('pbi-modeling-mcp tool registry', () => {
  it('registers pbi_dax_reference_check as a read-only tool', async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    try {
      const list = await client.listTools();
      const dax = list.tools.find((tool) => tool.name === 'pbi_dax_reference_check');
      expect(dax).toBeDefined();
      expect(dax?.annotations?.readOnlyHint).toBe(true);
    } finally {
      await client.close();
    }
  });
});
