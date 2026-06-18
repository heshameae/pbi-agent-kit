import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const BUILD_MARKER_RELATIVE_PATH = path.join(
  'packages',
  'mcp',
  'dist',
  'pbi-agent-kit-build.json',
);

export function buildInputPaths(pluginRoot) {
  return [
    path.join(pluginRoot, 'packages/mcp/src'),
    path.join(pluginRoot, 'packages/core/src'),
    path.join(pluginRoot, 'packages/mcp/package.json'),
    path.join(pluginRoot, 'packages/core/package.json'),
    path.join(pluginRoot, 'packages/mcp/tsconfig.json'),
    path.join(pluginRoot, 'packages/core/tsconfig.json'),
    path.join(pluginRoot, 'package.json'),
    path.join(pluginRoot, 'pnpm-lock.yaml'),
    path.join(pluginRoot, 'pnpm-workspace.yaml'),
    path.join(pluginRoot, 'tsconfig.base.json'),
    path.join(pluginRoot, 'scripts/build-fingerprint.mjs'),
    path.join(pluginRoot, 'scripts/write-build-marker.mjs'),
    path.join(pluginRoot, 'scripts/start-mcp.mjs'),
  ];
}

export function buildMarkerPath(pluginRoot) {
  return path.join(pluginRoot, BUILD_MARKER_RELATIVE_PATH);
}

export function computeBuildFingerprint(pluginRoot) {
  const files = buildInputPaths(pluginRoot)
    .flatMap((inputPath) => collectFiles(inputPath))
    .sort();
  const hash = createHash('sha256');
  let newestMtimeMs = 0;

  for (const filePath of files) {
    const rel = path.relative(pluginRoot, filePath).split(path.sep).join('/');
    const stats = statSync(filePath);
    newestMtimeMs = Math.max(newestMtimeMs, stats.mtimeMs);
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(filePath));
    hash.update('\0');
  }

  return {
    sha256: hash.digest('hex'),
    inputCount: files.length,
    newestMtimeMs,
  };
}

export function readBuildMarker(pluginRoot) {
  const markerPath = buildMarkerPath(pluginRoot);
  if (!existsSync(markerPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeBuildMarker(pluginRoot) {
  const markerPath = buildMarkerPath(pluginRoot);
  const fingerprint = computeBuildFingerprint(pluginRoot);
  const marker = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...fingerprint,
  };
  mkdirSync(path.dirname(markerPath), { recursive: true });
  writeMarkerFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

function writeMarkerFile(markerPath, content) {
  const tempPath = `${markerPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, content);
    if (existsSync(markerPath)) {
      try {
        chmodSync(markerPath, 0o666);
      } catch {
        // Best effort: copied Windows builds can preserve a read-only bit.
      }
      rmSync(markerPath, { force: true });
    }
    renameSync(tempPath, markerPath);
  } catch (err) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures and surface the original write error.
    }
    throw err;
  }
}

function collectFiles(targetPath) {
  if (!existsSync(targetPath)) return [];
  const stats = statSync(targetPath);
  if (!stats.isDirectory()) return [targetPath];

  const out = [];
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === '.git') continue;
    out.push(...collectFiles(path.join(targetPath, entry.name)));
  }
  return out;
}
