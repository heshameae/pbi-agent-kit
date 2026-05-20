#!/usr/bin/env node
//
// PostToolUse on powerbi-modeling.database_operations.
// Clears that connection's pending-measure list when `ExportToTmdlFolder`
// successfully writes the model to disk.
// Why: once exported, those measures are real TMDL fields the gate can
// see on disk. Keeping stale entries would let bad references slip
// through if a Create was later rolled back.
//
import { importCore } from './lib/core-import.mjs';
import {
  allow,
  extractToolResponse,
  failOpenWithLog,
  normalizeRequest,
  readStdinJson,
} from './lib/hook-io.mjs';

async function main() {
  const input = await readStdinJson();
  const request = normalizeRequest(input);

  if (request.operation !== 'ExportToTmdlFolder') {
    allow();
    return;
  }

  if (!toolResponseLooksSuccessful(extractToolResponse(input))) {
    allow();
    return;
  }

  const core = await importCore();
  const sidecarRoot = core.resolveSidecarRoot();
  const connection = resolveConnectionForExport(core, sidecarRoot, request);
  if (!connection) {
    allow();
    return;
  }

  core.clearUncommittedMeasures(sidecarRoot, connection.connectionName);
  allow();
}

function resolveConnectionForExport(core, sidecarRoot, request) {
  const named = core.resolveConnection(sidecarRoot, request.connectionName);
  if (named) return named;

  const folderPath =
    typeof request.tmdlFolderPath === 'string'
      ? request.tmdlFolderPath
      : typeof request.folderPath === 'string'
        ? request.folderPath
        : null;
  if (folderPath === null) return null;
  const sidecar = core.readConnections(sidecarRoot);
  for (const record of Object.values(sidecar.connections)) {
    if (record.folderPath === folderPath) return record;
  }
  return null;
}

function toolResponseLooksSuccessful(response) {
  if (!response) return true;
  if (response.isError === true) return false;
  const structured = response.structuredContent;
  if (structured && typeof structured === 'object' && 'error' in structured) return false;
  return true;
}

main().catch((err) => failOpenWithLog(err));
