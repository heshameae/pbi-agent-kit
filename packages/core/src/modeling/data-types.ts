import type { TMDLColumn } from './types.js';

export type CanonicalDataType =
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'datetimezone'
  | 'decimal'
  | 'double'
  | 'int64'
  | 'string';

const CANONICAL_DATA_TYPES = new Set<CanonicalDataType>([
  'boolean',
  'date',
  'datetime',
  'datetimezone',
  'decimal',
  'double',
  'int64',
  'string',
]);

const TEMPORAL_TYPES = new Set<CanonicalDataType>(['date', 'datetime', 'datetimezone']);
const NUMERIC_TYPES = new Set<CanonicalDataType>(['int64', 'decimal', 'double']);

export function normalizeDataType(dataType: string): string {
  return dataType.trim().toLowerCase();
}

export function toCanonicalDataType(dataType: string): CanonicalDataType | undefined {
  const normalized = normalizeDataType(dataType);
  return CANONICAL_DATA_TYPES.has(normalized as CanonicalDataType)
    ? (normalized as CanonicalDataType)
    : undefined;
}

export function isTemporalType(dataType: string): boolean {
  return TEMPORAL_TYPES.has(normalizeDataType(dataType) as CanonicalDataType);
}

export function isNumericType(dataType: string): boolean {
  return NUMERIC_TYPES.has(normalizeDataType(dataType) as CanonicalDataType);
}

export function isStringType(dataType: string): boolean {
  return normalizeDataType(dataType) === 'string';
}

export function isBooleanType(dataType: string): boolean {
  return normalizeDataType(dataType) === 'boolean';
}

export function isTemporalColumn(column: TMDLColumn): boolean {
  return isTemporalType(column.dataType);
}

export function isNumericColumn(column: TMDLColumn): boolean {
  return isNumericType(column.dataType);
}

// Engine-default-Sum aggregation semantics: in Tabular the DEFAULT summarization for a
// numeric column is Sum, and TMDL/Desktop only serialize an explicit `summarizeBy:` line
// when it DIFFERS from that default — so a numeric column with summarizeBy undefined IS
// aggregatable (implicit Sum); only an explicit `none` makes it non-aggregating.
// SCOPE: this key-INCLUSIVE notion is used ONLY by BPA MOD014 (which must flag a numeric
// KEY that auto-sums) and, via isMeasureLikeNumeric (naming.ts), by star-schema's axis
// test. The fact-classifier, grain, and field-index intentionally use a STRICTER
// explicit-`summarizeBy` signal instead — treating an undefined-summarizeBy numeric as
// aggregatable there over-classified a dimension carrying a numeric attribute as a fact
// (adversarial-verify regression). Do NOT route those three through this helper.
// DATASET-AGNOSTIC: keys off canonical type + summarizeBy only, no field names.
export function isAggregatableNumeric(column: {
  readonly dataType: string;
  readonly summarizeBy?: string;
}): boolean {
  if (!isNumericType(column.dataType)) return false;
  return (column.summarizeBy ?? '').toLowerCase() !== 'none';
}
