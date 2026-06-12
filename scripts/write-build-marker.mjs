#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBuildMarker } from './build-fingerprint.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, '..');
const marker = writeBuildMarker(pluginRoot);

process.stderr.write(
  `pbi-mcp-ts: wrote build marker ${marker.sha256.slice(0, 12)} (${marker.inputCount} inputs).\n`,
);
