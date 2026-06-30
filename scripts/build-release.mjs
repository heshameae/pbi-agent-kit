#!/usr/bin/env node
// Deterministic, OFFLINE release-artifact builder. Writes under release-artifacts/:
//   - pbi-agent-kit-<version>.zip      git archive of the ref (source + committed dist)
//   - package-lock-<version>.json      the authoritative pinned dependency manifest (SBOM)
//   - sbom-<version>.json              best-effort resolved prod dependency tree
//   - test-evidence-<version>.txt      `npm test` output + exit code
//   - SHA256SUMS-<version>.txt         checksums of every artifact above
//
// No network. Usage: node scripts/build-release.mjs [ref]
//   ref defaults to the v<version> tag if it exists, else HEAD.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const winShell = process.platform === 'win32';
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const OUT = path.join(root, 'release-artifacts');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
}
function hasTag(tag) {
  return run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]).status === 0;
}
function fail(message) {
  process.stderr.write(`build-release: ${message}\n`);
  process.exit(1);
}

const ref = process.argv[2] || (hasTag(`v${version}`) ? `v${version}` : 'HEAD');

// 1. Release-readiness gate: refuse to package a ref that would ship no server.
const verify = run(process.execPath, ['scripts/verify-release-artifact.mjs', ref]);
process.stdout.write(verify.stdout || '');
if (verify.status !== 0) {
  process.stderr.write(verify.stderr || '');
  fail(`ref "${ref}" is not release-ready.`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 2. Source + committed-dist zip (tracked files only; node_modules / vendor / artifacts excluded).
const zipName = `pbi-agent-kit-${version}.zip`;
const archive = run('git', [
  'archive',
  '--format=zip',
  `--prefix=pbi-agent-kit-${version}/`,
  '-o',
  path.join(OUT, zipName),
  ref,
]);
if (archive.status !== 0) fail(`git archive failed: ${archive.stderr}`);
process.stdout.write(`  wrote ${zipName}\n`);

// 3. Dependency manifest: the pinned lockfile is the authoritative SBOM; add a
//    best-effort resolved prod tree alongside it.
const lockPath = path.join(root, 'package-lock.json');
if (!existsSync(lockPath)) {
  fail('package-lock.json is missing — run `npm install` and commit it before cutting a release.');
}
copyFileSync(lockPath, path.join(OUT, `package-lock-${version}.json`));
process.stdout.write(`  wrote package-lock-${version}.json\n`);

const sbom = run('npm', ['ls', '--all', '--omit=dev', '--json'], { shell: winShell });
const sbomContent = sbom.stdout.trim()
  ? sbom.stdout
  : JSON.stringify(
      { note: 'npm ls unavailable; package-lock.json is the authoritative manifest', version },
      null,
      2,
    );
writeFileSync(path.join(OUT, `sbom-${version}.json`), sbomContent);
process.stdout.write(`  wrote sbom-${version}.json\n`);

// 4. Test evidence.
const test = run('npm', ['test'], { shell: winShell });
writeFileSync(
  path.join(OUT, `test-evidence-${version}.txt`),
  `pbi-agent-kit ${version} — test evidence (ref ${ref})\nexit code: ${test.status}\n\n${test.stdout || ''}\n${test.stderr || ''}`,
);
process.stdout.write(`  wrote test-evidence-${version}.txt (tests exit ${test.status})\n`);
if (test.status !== 0) fail('tests failed — refusing to finalize release artifacts.');

// 5. SHA-256 checksum manifest over every artifact.
const sumsName = `SHA256SUMS-${version}.txt`;
const files = readdirSync(OUT)
  .filter((f) => f !== sumsName)
  .sort();
const sums = files
  .map(
    (f) =>
      `${createHash('sha256')
        .update(readFileSync(path.join(OUT, f)))
        .digest('hex')}  ${f}`,
  )
  .join('\n');
writeFileSync(path.join(OUT, sumsName), `${sums}\n`);
process.stdout.write(`  wrote ${sumsName}\n`);

process.stdout.write(
  `\nbuild-release: v${version} artifacts ready in ${path.relative(root, OUT)}/ (from ref "${ref}")\n`,
);
