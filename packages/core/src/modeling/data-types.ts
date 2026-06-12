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
