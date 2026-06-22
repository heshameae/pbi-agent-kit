#!/usr/bin/env node
// Release gate: confirm the committed tree (what `git archive <ref>` ships) would
// actually include a runnable compiled MCP server. The ship-stopper this guards
// against is dist/ being built on disk but never committed, so a tag/zip handover
// silently ships no server.js. Run before tagging: `node scripts/verify-release-artifact.mjs [ref]`.
//
// No dependencies, no network. Uses `git ls-tree` because it reflects exactly the
// set of files `git archive` would include for the same ref.

import { spawnSync } from 'node:child_process';

const ref = process.argv[2] ?? 'HEAD';

const REQUIRED = [
  'packages/mcp/dist/server.js',
  'packages/mcp/dist/pbi-agent-kit-build.json',
  'packages/core/dist/index.js',
];

function trackedFiles(gitRef) {
  const result = spawnSync('git', ['ls-tree', '-r', '--name-only', gitRef], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(
      `verify-release-artifact: cannot list tree for ref "${gitRef}".\n${String(result.stderr ?? '').trim()}\n`,
    );
    process.exit(2);
  }
  return new Set(String(result.stdout).split('\n').filter(Boolean));
}

const tracked = trackedFiles(ref);
const missing = REQUIRED.filter((p) => !tracked.has(p));

if (missing.length > 0) {
  const missingList = missing.map((p) => `  - ${p}`).join('\n');
  process.stderr.write(
    `verify-release-artifact: ref "${ref}" is NOT release-ready. The compiled server is not committed,
so a tag/zip handover would ship a non-starting MCP server. Missing tracked files:
${missingList}

Fix: build, then commit the compiled output, e.g.
  pnpm install && pnpm build
  git add -f packages/core/dist packages/mcp/dist
  git commit -m "build: commit compiled dist for offline handover"
`,
  );
  process.exit(1);
}

process.stdout.write(
  `verify-release-artifact: ref "${ref}" ships a compiled server (${REQUIRED.length} required artifacts present).\n`,
);
process.exit(0);
