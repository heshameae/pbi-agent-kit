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
  // When the live model snapshot could not enumerate measures (measuresCaptured
  // === false), a reference that resolves to neither a known column nor a known
  // measure may be an existing measure the enumeration simply could not see.
  // Set this true to treat such unresolved references as assumed-valid measures
  // (the Microsoft engine still rejects genuinely bad refs at write time).
  // Column resolution is unaffected — columns enumerate reliably.
  readonly assumeUnknownMeasuresExist?: boolean;
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
    measureCountsByName.set(uncommitted.name, (measureCountsByName.get(uncommitted.name) ?? 0) + 1);
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
    // Table resolves but the member does not. When measures are un-enumerable,
    // this may be an existing measure we cannot see — assume valid (engine is
    // the backstop). The table existence check above still catches bad tables.
    if (!hasColumn && !hasMeasure && !options.assumeUnknownMeasuresExist) missing.push(ref);
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
    // count === 0: unknown bare reference. When measures are un-enumerable the
    // count map is incomplete, so assume it is an existing measure (engine is
    // the backstop) rather than blocking the write.
    if (options.assumeUnknownMeasuresExist) continue;
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
