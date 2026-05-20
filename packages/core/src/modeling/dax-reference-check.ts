import type { TMDLModel, TMDLTable } from './types.js';

export interface DaxReference {
  readonly table?: string;
  readonly name: string;
  readonly raw: string;
}

export interface UncommittedMeasureRef {
  readonly table: string;
  readonly name: string;
}

export interface DaxReferenceCheckOptions {
  readonly hostTable?: string;
  readonly uncommittedMeasures?: readonly UncommittedMeasureRef[];
}

export interface DaxReferenceCheckResult {
  readonly valid: boolean;
  readonly missing: readonly DaxReference[];
  readonly ambiguous: readonly DaxReference[];
  readonly unsupported: readonly string[];
}

const QUALIFIED_REF_RE = /'([^']+)'\[([^\]]+)\]|([A-Za-z_][\w]*)\[([^\]]+)\]/g;
const BARE_REF_RE = /\[([^\]]+)\]/g;

export function daxReferenceCheck(
  expression: string,
  model: TMDLModel,
  options: DaxReferenceCheckOptions = {},
): DaxReferenceCheckResult {
  const hostTable = options.hostTable;
  const uncommittedMeasures = options.uncommittedMeasures ?? [];

  const tablesByName = new Map<string, TMDLTable>();
  for (const table of model.tables) tablesByName.set(table.name, table);

  const measureCountsByName = new Map<string, number>();
  for (const table of model.tables) {
    for (const measure of table.measures) {
      measureCountsByName.set(measure.name, (measureCountsByName.get(measure.name) ?? 0) + 1);
    }
  }
  for (const uncommitted of uncommittedMeasures) {
    measureCountsByName.set(
      uncommitted.name,
      (measureCountsByName.get(uncommitted.name) ?? 0) + 1,
    );
  }

  const missing: DaxReference[] = [];
  const ambiguous: DaxReference[] = [];
  const unsupported: string[] = [];

  const stripped = stripStringsAndComments(expression);

  for (const match of stripped.matchAll(QUALIFIED_REF_RE)) {
    const table = match[1] ?? match[3];
    const name = match[2] ?? match[4];
    if (!table || !name) {
      unsupported.push(match[0]);
      continue;
    }
    const ref: DaxReference = { table, name, raw: `${table}[${name}]` };
    const tableEntry = tablesByName.get(table);
    if (!tableEntry) {
      missing.push(ref);
      continue;
    }
    const hasColumn = tableEntry.columns.some((column) => column.name === name);
    const hasMeasure =
      tableEntry.measures.some((measure) => measure.name === name) ||
      uncommittedMeasures.some(
        (uncommitted) => uncommitted.table === table && uncommitted.name === name,
      );
    if (!hasColumn && !hasMeasure) missing.push(ref);
  }

  const withoutQualified = stripped.replace(QUALIFIED_REF_RE, ' ');

  for (const match of withoutQualified.matchAll(BARE_REF_RE)) {
    const name = match[1];
    if (!name) continue;
    const ref: DaxReference = { name, raw: `[${name}]` };

    if (hostTable !== undefined) {
      const host = tablesByName.get(hostTable);
      if (host) {
        const hostHasMeasure =
          host.measures.some((measure) => measure.name === name) ||
          uncommittedMeasures.some(
            (uncommitted) => uncommitted.table === hostTable && uncommitted.name === name,
          );
        const hostHasColumn = host.columns.some((column) => column.name === name);
        if (hostHasMeasure || hostHasColumn) continue;
      }
    }

    const count = measureCountsByName.get(name) ?? 0;
    if (count === 1) continue;
    if (count > 1) {
      ambiguous.push(ref);
      continue;
    }
    missing.push(ref);
  }

  const valid = missing.length === 0 && ambiguous.length === 0 && unsupported.length === 0;
  return { valid, missing, ambiguous, unsupported };
}

function stripStringsAndComments(expression: string): string {
  let cleaned = expression.replace(/"(?:""|[^"])*"/g, ' ');
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, ' ');
  cleaned = cleaned.replace(/\/\/[^\n]*/g, ' ');
  cleaned = cleaned.replace(/--[^\n]*/g, ' ');
  return cleaned;
}
