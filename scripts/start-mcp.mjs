#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMarkerPath,
  computeBuildFingerprint,
  readBuildMarker,
  writeBuildMarker,
} from './build-fingerprint.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT?.trim()
  ? process.env.CLAUDE_PLUGIN_ROOT
  : path.resolve(scriptDir, '..');
const serverPath = path.join(pluginRoot, 'packages', 'mcp', 'dist', 'server.js');

function stderr(message) {
  process.stderr.write(`${message}\n`);
}

function signalExitCode(signal) {
  const signalNumbers = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGTERM: 15,
  };
  return 128 + (signalNumbers[signal] ?? 1);
}

function isBuildStale() {
  if (!existsSync(serverPath)) return { stale: true, reason: 'compiled server missing' };
  const fingerprint = computeBuildFingerprint(pluginRoot);
  const marker = readBuildMarker(pluginRoot);
  if (!marker || typeof marker.sha256 !== 'string') {
    return { stale: true, reason: 'build marker missing', fingerprint };
  }
  if (marker.sha256 !== fingerprint.sha256) {
    return { stale: true, reason: 'build marker mismatch', fingerprint, marker };
  }
  return { stale: false, reason: 'build marker current', fingerprint, marker };
}

function ensureBuilt() {
  const initial = isBuildStale();
  if (!initial.stale) {
    stderr(
      `pbi-agent-kit: loaded build ${initial.marker.sha256.slice(0, 12)} from ${buildMarkerPath(pluginRoot)} generated ${initial.marker.generatedAt ?? 'unknown time'}.`,
    );
    return;
  }

  stderr(`pbi-agent-kit: compiled MCP server stale (${initial.reason}); running \`pnpm build\`.`);
  // shell:true on Windows so the `pnpm` shim (pnpm.cmd) resolves — bare
  // spawnSync('pnpm', …) throws ENOENT on Windows because Node won't run a
  // .cmd without a shell. Harmless on macOS/Linux.
  const build = spawnSync('pnpm', ['build'], {
    cwd: pluginRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  if (build.status === 0 && existsSync(serverPath)) {
    const marker = writeBuildMarker(pluginRoot);
    stderr(
      `pbi-agent-kit: loaded build ${marker.sha256.slice(0, 12)} from ${buildMarkerPath(pluginRoot)} generated ${marker.generatedAt}.`,
    );
    return;
  }

  stderr('pbi-agent-kit: could not build the MCP server.');
  stderr('Run `pnpm install` and `pnpm build` in the plugin repository, then restart Claude Code.');
  if (build.error) stderr(String(build.error.message));
  if (String(build.stdout ?? '').trim()) stderr(String(build.stdout).trim());
  if (String(build.stderr ?? '').trim()) stderr(String(build.stderr).trim());
  process.exit(build.status ?? 1);
}

ensureBuilt();

const child = spawn(process.execPath, [serverPath], {
  cwd: pluginRoot,
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(signalExitCode(signal));
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  stderr(`pbi-agent-kit: failed to start MCP server: ${error.message}`);
  process.exit(1);
});
