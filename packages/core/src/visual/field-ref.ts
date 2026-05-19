import { PbiCoreError } from '../errors.js';

const FIELD_REF_RE = /^(.+)\[(.+)\]$/;

/**
 * Parse a `Table[Column]` field reference into table/column parts.
 * Throws `PbiCoreError` on malformed input.
 */
export function parseFieldRef(ref: string): { table: string; column: string } {
  const match = FIELD_REF_RE.exec(ref.trim());
  if (!match) {
    throw new PbiCoreError(`Invalid field reference '${ref}'. Expected 'Table[Column]' format.`);
  }
  return {
    table: (match[1] ?? '').trim(),
    column: (match[2] ?? '').trim(),
  };
}
