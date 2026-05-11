// Deterministic JSON I/O for PBIR files.
//
// Ported from pbi-cli's read/write helpers in core/report_backend.py and
// visual_backend.py. The formatting MUST match pbi-cli's byte-for-byte
// because Power BI Desktop is sensitive to file-level diffs (line endings,
// trailing newlines, indent style, Unicode escaping).
//
// Python contract (reference):
//   json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
//
// Node equivalent:
//   JSON.stringify(data, null, 2) + "\n", utf-8 (default), no BOM
//
// Node's JSON.stringify default behaviour matches Python's defaults for our
// purposes: 2-space indent, no escaping of <, >, &, ', no trailing comma,
// keys in insertion order, no Unicode escaping for non-ASCII characters.
// Trailing newline is appended manually (both engines).

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Read a JSON file as UTF-8 and parse it. */
export function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/**
 * Write `data` as pretty-printed JSON with a trailing newline.
 *
 * Matches pbi-cli's `json.dumps(data, indent=2, ensure_ascii=False) + "\n"`
 * with UTF-8 encoding. Creates parent directories if missing.
 */
export function writeJson(filePath: string, data: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const content = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Generate a PBIR-compatible identifier: 10 random bytes as 20-char lowercase
 * hex. Matches Python's `secrets.token_hex(10)` output exactly.
 *
 * Used for page, visual, and bookmark folder names.
 */
export function generateId(): string {
  return randomBytes(10).toString('hex');
}
