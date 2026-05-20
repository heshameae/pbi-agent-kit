#!/usr/bin/env node
//
// PostToolUse on powerbi-modeling.measure_operations.
// Records every successful `Create` in the sidecar.
// Why: between Create and ExportToTmdlFolder, the measure exists only
// in memory. Without this list the gate would deny any later measure
// that references it just because it's not on disk yet.
//
import { importCore } from './lib/core-import.mjs';
import {
  allow,
  extractDefinitions,
  extractToolResponse,
  failOpenWithLog,
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

  if (!toolResponseLooksSuccessful(extractToolResponse(input))) {
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
    allow();
    return;
  }

  const measures = definitions
    .map((def) => ({
      table: typeof def?.tableName === 'string' ? def.tableName : null,
      name: typeof def?.name === 'string' ? def.name : null,
      expression: typeof def?.expression === 'string' ? def.expression : undefined,
    }))
    .filter((m) => m.table !== null && m.name !== null);

  if (measures.length === 0) {
    allow();
    return;
  }

  core.appendUncommittedMeasures(sidecarRoot, connection.connectionName, measures);
  allow();
}

function toolResponseLooksSuccessful(response) {
  if (!response) return true;
  if (response.isError === true) return false;
  const structured = response.structuredContent;
  if (structured && typeof structured === 'object' && 'error' in structured) return false;
  return true;
}

main().catch((err) => failOpenWithLog(err));
