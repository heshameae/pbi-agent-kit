import { describe, expect, it } from 'vitest';
import {
  isBooleanType,
  isNumericType,
  isStringType,
  isTemporalType,
  normalizeDataType,
  toCanonicalDataType,
} from '../../src/modeling/data-types.js';

describe('modeling data type normalization', () => {
  it('normalizes source casing without changing comparison semantics', () => {
    expect(normalizeDataType(' String ')).toBe('string');
    expect(normalizeDataType('DateTime')).toBe('datetime');
    expect(normalizeDataType('dateTime')).toBe('datetime');
  });

  it('classifies live PascalCase and TMDL lower/camel variants', () => {
    for (const dataType of ['String', 'string']) {
      expect(isStringType(dataType)).toBe(true);
    }

    for (const dataType of ['Date', 'date', 'DateTime', 'dateTime', 'DateTimeZone']) {
      expect(isTemporalType(dataType)).toBe(true);
    }

    for (const dataType of ['Int64', 'int64', 'Decimal', 'decimal', 'Double', 'double']) {
      expect(isNumericType(dataType)).toBe(true);
    }

    for (const dataType of ['Boolean', 'boolean']) {
      expect(isBooleanType(dataType)).toBe(true);
    }
  });

  it('returns canonical known types and undefined for unknown values', () => {
    expect(toCanonicalDataType('Decimal')).toBe('decimal');
    expect(toCanonicalDataType('DateTimeZone')).toBe('datetimezone');
    expect(toCanonicalDataType('unknown')).toBeUndefined();
  });
});
