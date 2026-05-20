#!/usr/bin/env node
//
// PostToolUse on powerbi-modeling.connection_operations.
// Records every `ConnectFolder` in the sidecar so later hooks know
// which TMDL folder is active.
// Why: Microsoft's MCP holds connection state in memory only; without
// this, the gate has no idea which model to validate against.
//
import path from 'node:path';
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

  if (request.operation !== 'ConnectFolder') {
    allow();
    return;
  }

  const folderPath = typeof request.folderPath === 'string' ? request.folderPath : null;
  if (!folderPath) {
    allow();
    return;
  }

  const toolResponse = extractToolResponse(input);
  const structured = toolResponse?.structuredContent;
  const responseName =
    structured && typeof structured.connectionName === 'string'
      ? structured.connectionName
      : undefined;
  const requestName =
    typeof request.connectionName === 'string' ? request.connectionName : undefined;
  const connectionName = responseName ?? requestName ?? deriveConnectionNameFromFolder(folderPath);

  if (!connectionName) {
    allow();
    return;
  }

  const core = await importCore();
  const sidecarRoot = core.resolveSidecarRoot();
  core.upsertConnection(sidecarRoot, {
    connectionName,
    folderPath,
    connectedAt: new Date().toISOString(),
  });

  allow();
}

function deriveConnectionNameFromFolder(folderPath) {
  let current = folderPath;
  for (let i = 0; i < 6; i++) {
    const base = path.basename(current);
    if (base.endsWith('.SemanticModel')) {
      return base.slice(0, base.length - '.SemanticModel'.length);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

main().catch((err) => failOpenWithLog(err));
