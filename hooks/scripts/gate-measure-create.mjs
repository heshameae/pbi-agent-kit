#!/usr/bin/env node
//
// PreToolUse on powerbi-modeling.measure_operations.
// Blocks `Create` if any DAX expression references a column or measure
// that doesn't exist in the connected model (or in this same batch).
// Why: catches typos before they land in TMDL and surface as a silent
// "Something's wrong" error the next time the .pbip opens in Desktop.
//
import { importCore } from './lib/core-import.mjs';
import {
  allow,
  deny,
  extractDefinitions,
  normalizeRequest,
  readStdinJson,
} from './lib/hook-io.mjs';

async function main() {
  const input = await readStdinJson();
  const request = normalizeRequest(input);

  if (request.operation !== 'Create') {
    allow();
    return;
  }

  const definitions = extractDefinitions(request);
  if (definitions.length === 0) {
    allow();
    return;
  }

  const core = await importCore();
  const sidecarRoot = core.resolveSidecarRoot();
  const connection = core.resolveConnection(sidecarRoot, request.connectionName);

  if (!connection) {
    deny({
      reason: 'No active Power BI modeling connection is known to pbi-mcp-ts hooks.',
      fix: [
        'Run mcp__powerbi-modeling__connection_operations ConnectFolder once before creating measures.',
        'If you connected via a different session, re-run ConnectFolder to register the connection with the gate.',
      ],
      connectionName: request.connectionName ?? null,
    });
    return;
  }

  let model;
  try {
    model = core.parseTMDLFolder(connection.folderPath);
  } catch (err) {
    deny({
      reason: `Could not parse semantic model at ${connection.folderPath}: ${err.message}`,
      fix: ['Verify the connection points to a valid .SemanticModel/definition folder.'],
    });
    return;
  }

  const uncommitted = core.readUncommittedMeasures(sidecarRoot, connection.connectionName);

  // DAX is declarative: a Create batch may legitimately reference other measures
  // defined in the same batch. Treat every {tableName, name} pair in this request
  // as if it were already uncommitted so the per-definition reference check sees
  // its sibling definitions.
  const batchUncommitted = [
    ...uncommitted.map((u) => ({ table: u.table, name: u.name })),
    ...definitions
      .filter(
        (def) =>
          typeof def?.tableName === 'string' &&
          def.tableName.length > 0 &&
          typeof def?.name === 'string' &&
          def.name.length > 0,
      )
      .map((def) => ({ table: def.tableName, name: def.name })),
  ];

  const denials = [];
  for (const def of definitions) {
    const expression = typeof def?.expression === 'string' ? def.expression : null;
    const hostTable = typeof def?.tableName === 'string' ? def.tableName : undefined;
    if (!expression) continue;
    const result = core.daxReferenceCheck(expression, model, {
      hostTable,
      uncommittedMeasures: batchUncommitted,
    });
    if (!result.valid) {
      denials.push({
        measure: hostTable ? `${hostTable}[${def.name ?? ''}]` : def.name ?? '<unnamed>',
        missing: result.missing,
        ambiguous: result.ambiguous,
        unsupported: result.unsupported,
      });
    }
  }

  if (denials.length > 0) {
    deny({
      reason:
        'pbi_dax_reference_check blocked this measure_operations.Create: DAX references missing or ambiguous.',
      denials,
      fix: [
        'Fix the DAX expression so every Table[Field] reference resolves in the connected model.',
        'If the missing reference is a measure you have not committed yet, create it earlier in this same batch.',
      ],
    });
    return;
  }

  allow();
}

main().catch((err) =>
  deny({
    reason: 'pbi-mcp-ts gate-measure-create hook crashed before validation completed.',
    error: err?.message ?? String(err),
    fix: ['Run `pnpm -F pbi-core build` so the validator can load.'],
  }),
);
