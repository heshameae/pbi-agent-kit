#!/usr/bin/env node
// SessionStart detector: if the user is working in a Power BI project that has no
// optional business-context file (.pbi-agent-kit/data-dictionary.yaml), inject a
// one-time, NON-BLOCKING nudge suggesting /pbi-init-data-dictionary.
//
// Hard guarantees (defense for the modeling beta — never disrupt existing flows):
//   - ALWAYS exits 0. Never blocks. Never emits decision:block / continue:false /
//     permissionDecision. SessionStart cannot block by contract; we also wrap
//     everything and exit 0 on any error.
//   - Inspects the USER's project dir (CLAUDE_PROJECT_DIR -> payload.cwd -> cwd),
//     never CLAUDE_PLUGIN_ROOT. Presence-only (existsSync); never opens/reads the
//     file, so zero dataset content is touched.
//   - Only nudges inside a real Power BI project (a *.pbip file or *.SemanticModel
//     directory at the project root), so it never nags in unrelated folders.
//   - Best-effort cross-session de-dup; opt out entirely with
//     PBI_AGENT_KIT_NO_DICT_REMINDER=1.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OPT_OUT_ENV = 'PBI_AGENT_KIT_NO_DICT_REMINDER';
const DICT_RELATIVE = path.join('.pbi-agent-kit', 'data-dictionary.yaml');
const COMMAND = '/pbi-init-data-dictionary';

function exitSilent() {
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function resolveProjectRoot(payload) {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR?.trim();
  if (fromEnv) return fromEnv;
  const fromPayload = typeof payload?.cwd === 'string' ? payload.cwd.trim() : '';
  if (fromPayload) return fromPayload;
  return process.cwd();
}

// A real Power BI project shows a *.pbip file or a *.SemanticModel directory at
// the project root. We never deep-walk and never read file contents.
function looksLikePowerBiProject(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (entry.isFile() && lower.endsWith('.pbip')) return true;
    if (entry.isDirectory() && lower.endsWith('.semanticmodel')) return true;
  }
  return false;
}

// Cross-session de-dup so a given project is nudged at most once. The marker lives
// under CLAUDE_PLUGIN_DATA when available; if it is unset/unwritable we simply fall
// back to once-per-session cadence (SessionStart fires once per session anyway).
// We never write into the user's project folder.
function markerPath(root) {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA?.trim();
  if (!dataDir) return undefined;
  const hash = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
  return path.join(dataDir, 'dict-reminder', `${hash}.json`);
}

function alreadyNudged(root) {
  const marker = markerPath(root);
  return marker ? existsSync(marker) : false;
}

function recordNudge(root) {
  try {
    const marker = markerPath(root);
    if (!marker) return;
    mkdirSync(path.dirname(marker), { recursive: true });
    writeFileSync(marker, JSON.stringify({ schemaVersion: 1 }));
  } catch {
    // Best effort only; failing to record just means we may nudge again next session.
  }
}

function emitNudge(eventName) {
  const additionalContext = [
    'No business-context file (.pbi-agent-kit/data-dictionary.yaml) was found in this Power BI project.',
    'It is optional and never required for modeling work.',
    'To capture business meaning (term definitions, owners, and measure intent),',
    `the command ${COMMAND} can create a dataset-agnostic template and fill it via clarifying questions.`,
    'Live MCP model tools, not this file, prove that fields exist.',
  ].join(' ');
  const systemMessage = `pbi-agent-kit: no optional data dictionary found — ${COMMAND} can create one (optional, non-blocking).`;
  process.stdout.write(
    JSON.stringify({
      systemMessage,
      hookSpecificOutput: {
        hookEventName: eventName || 'SessionStart',
        additionalContext,
      },
    }),
  );
  process.exit(0);
}

async function main() {
  if (process.env[OPT_OUT_ENV] === '1') exitSilent();

  let payload = {};
  try {
    const raw = await readStdin();
    if (raw) payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  const eventName = String(payload.hook_event_name ?? payload.hookEventName ?? 'SessionStart');
  const root = resolveProjectRoot(payload);

  // Already have a dictionary -> nothing to do, ever.
  if (existsSync(path.join(root, DICT_RELATIVE))) exitSilent();
  // Only nudge inside a real Power BI project.
  if (!looksLikePowerBiProject(root)) exitSilent();
  // Best-effort cross-session de-dup.
  if (alreadyNudged(root)) exitSilent();

  recordNudge(root);
  emitNudge(eventName);
}

main().catch(() => process.exit(0));
