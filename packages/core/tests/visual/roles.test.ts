import { describe, expect, it } from 'vitest';
import {
  MEASURE_ROLES,
  ROLE_ALIASES,
  SUPPORTED_VISUAL_TYPES,
  VISUAL_DATA_ROLES,
  type VisualType,
  isMeasureRole,
  resolveRole,
} from '../../src/index.js';

describe('roles: VISUAL_DATA_ROLES covers every supported type', () => {
  it.each(SUPPORTED_VISUAL_TYPES)('%s has a roles entry (may be empty)', (type: VisualType) => {
    expect(VISUAL_DATA_ROLES).toHaveProperty(type);
    expect(Array.isArray(VISUAL_DATA_ROLES[type])).toBe(true);
  });
});

describe('roles: ROLE_ALIASES covers every supported type', () => {
  it.each(SUPPORTED_VISUAL_TYPES)('%s has an aliases entry (may be empty)', (type: VisualType) => {
    expect(ROLE_ALIASES).toHaveProperty(type);
  });
});

describe('roles: measure-role inference', () => {
  it.each(['Y', 'Values', 'Fields', 'Indicator', 'Goal', 'Size', 'Data', 'MaxValue'])(
    'role "%s" is a measure role',
    (r) => {
      expect(isMeasureRole(r)).toBe(true);
      expect(MEASURE_ROLES.has(r)).toBe(true);
    },
  );

  it.each(['Category', 'Legend', 'Rows', 'Columns', 'Details', 'TrendLine', 'Breakdown'])(
    'role "%s" is NOT a measure role',
    (r) => {
      expect(isMeasureRole(r)).toBe(false);
    },
  );
});

describe('roles: resolveRole', () => {
  it.each([
    ['barChart', 'category', 'Category'],
    ['barChart', 'value', 'Y'],
    ['barChart', 'legend', 'Legend'],
    ['barChart', 'Category', 'Category'], // canonical passes through
    ['barChart', 'Y', 'Y'],
    ['card', 'field', 'Values'],
    ['card', 'value', 'Values'],
    ['pivotTable', 'row', 'Rows'],
    ['pivotTable', 'column', 'Columns'],
    ['kpi', 'value', 'Indicator'],
    ['kpi', 'trend', 'TrendLine'],
    ['gauge', 'max', 'MaxValue'],
    ['gauge', 'target', 'MaxValue'],
    ['scatterChart', 'detail', 'Details'],
    ['scatterChart', 'x', 'X'],
    ['lineStackedColumnComboChart', 'column', 'ColumnY'],
    ['lineStackedColumnComboChart', 'line', 'LineY'],
    ['azureMap', 'value', 'Size'],
  ] as const)('resolveRole(%s, %s) → %s', (type, role, expected) => {
    expect(resolveRole(type, role)).toBe(expected);
  });

  it('returns null for unknown role on a visual', () => {
    expect(resolveRole('barChart', 'bogus')).toBeNull();
  });

  it('returns null for any role on actionButton (no roles)', () => {
    expect(resolveRole('actionButton', 'value')).toBeNull();
    expect(resolveRole('actionButton', 'Category')).toBeNull();
  });
});

describe('roles: aliases resolve to valid canonical roles', () => {
  it('every alias target appears in its visual type roles', () => {
    for (const [type, aliases] of Object.entries(ROLE_ALIASES) as Array<
      [VisualType, Readonly<Record<string, string>>]
    >) {
      const validRoles = VISUAL_DATA_ROLES[type];
      for (const [aliasFrom, aliasTo] of Object.entries(aliases)) {
        expect(
          validRoles.includes(aliasTo),
          `Alias ${type}.${aliasFrom} → ${aliasTo} but ${aliasTo} is not in VISUAL_DATA_ROLES[${type}] = [${validRoles.join(', ')}]`,
        ).toBe(true);
      }
    }
  });
});
