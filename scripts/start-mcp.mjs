#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT?.trim()
  ? process.env.CLAUDE_PLUGIN_ROOT
  : path.resolve(scriptDir, '..');
const serverPath = path.join(pluginRoot, 'packages', 'mcp', 'dist', 'server.js');
const buildInputPaths = [
  path.join(pluginRoot, 'packages/mcp/src'),
  path.join(pluginRoot, 'packages/core/src'),
  path.join(pluginRoot, 'packages/mcp/package.json'),
  path.join(pluginRoot, 'packages/core/package.json'),
  path.join(pluginRoot, 'package.json'),
  path.join(pluginRoot, 'pnpm-lock.yaml'),
];

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

function newestMtimeMs(targetPath) {
  if (!existsSync(targetPath)) return 0;
  const stats = statSync(targetPath);
  if (!stats.isDirectory()) return stats.mtimeMs;

  let newest = stats.mtimeMs;
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const entryPath = path.join(targetPath, entry.name);
    newest = Math.max(newest, newestMtimeMs(entryPath));
  }
  return newest;
}

function isBuildStale() {
  if (!existsSync(serverPath)) return true;
  const builtAt = statSync(serverPath).mtimeMs;
  return buildInputPaths.some((inputPath) => newestMtimeMs(inputPath) > builtAt);
}

function ensureBuilt() {
  if (!isBuildStale()) return;

  stderr('pbi-mcp-ts: compiled MCP server missing or stale; running `pnpm build`.');
  // shell:true on Windows so the `pnpm` shim (pnpm.cmd) resolves — bare
  // spawnSync('pnpm', …) throws ENOENT on Windows because Node won't run a
  // .cmd without a shell. Harmless on macOS/Linux.
  const build = spawnSync('pnpm', ['build'], {
    cwd: pluginRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  if (build.status === 0 && existsSync(serverPath)) return;

  stderr('pbi-mcp-ts: could not build the MCP server.');
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
  stderr(`pbi-mcp-ts: failed to start MCP server: ${error.message}`);
  process.exit(1);
});
