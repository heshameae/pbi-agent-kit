import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE_THEME,
  SCHEMA_BOOKMARK,
  SCHEMA_BOOKMARKS_METADATA,
  SCHEMA_PAGE,
  SCHEMA_PAGES_METADATA,
  SCHEMA_REPORT,
  SCHEMA_VERSION,
  SCHEMA_VISUAL_CONTAINER,
  SUPPORTED_VISUAL_TYPES,
  VISUAL_TYPE_ALIASES,
  isSupportedVisualType,
  qualifiedFieldName,
  resolveVisualType,
} from '../../src/pbir/schemas.js';

describe('schemas: URL versions (pinned, do not bump without verifying in Desktop)', () => {
  it('visualContainer → 2.7.0', () => {
    expect(SCHEMA_VISUAL_CONTAINER).toMatch(/visualContainer\/2\.7\.0\/schema\.json$/);
  });
  it('page → 2.1.0', () => {
    expect(SCHEMA_PAGE).toMatch(/page\/2\.1\.0\/schema\.json$/);
  });
  it('report → 3.2.0 (matches Desktop Mar 2026)', () => {
    expect(SCHEMA_REPORT).toMatch(/report\/3\.2\.0\/schema\.json$/);
  });
  it('pagesMetadata → 1.0.0', () => {
    expect(SCHEMA_PAGES_METADATA).toMatch(/pagesMetadata\/1\.0\.0\/schema\.json$/);
  });
  it('versionMetadata → 1.0.0', () => {
    expect(SCHEMA_VERSION).toMatch(/versionMetadata\/1\.0\.0\/schema\.json$/);
  });
  it('bookmark → 2.1.0', () => {
    expect(SCHEMA_BOOKMARK).toMatch(/bookmark\/2\.1\.0\/schema\.json$/);
  });
  it('bookmarksMetadata → 1.0.0', () => {
    expect(SCHEMA_BOOKMARKS_METADATA).toMatch(/bookmarksMetadata\/1\.0\.0\/schema\.json$/);
  });
  it('all URLs share the developer.microsoft.com prefix', () => {
    for (const url of [
      SCHEMA_REPORT,
      SCHEMA_PAGE,
      SCHEMA_PAGES_METADATA,
      SCHEMA_VERSION,
      SCHEMA_VISUAL_CONTAINER,
      SCHEMA_BOOKMARK,
      SCHEMA_BOOKMARKS_METADATA,
    ]) {
      expect(url.startsWith('https://developer.microsoft.com/json-schemas/fabric/')).toBe(true);
    }
  });
});

describe('schemas: supported visual types', () => {
  it('has 32 canonical types', () => {
    expect(SUPPORTED_VISUAL_TYPES).toHaveLength(32);
  });

  it.each([
    'barChart',
    'lineChart',
    'card',
    'tableEx',
    'pivotTable',
    'slicer',
    'kpi',
    'gauge',
    'donutChart',
    'pageNavigator',
    'azureMap',
  ])('recognises canonical type "%s"', (type) => {
    expect(isSupportedVisualType(type)).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(isSupportedVisualType('bogus')).toBe(false);
    expect(isSupportedVisualType('')).toBe(false);
  });
});

describe('schemas: alias resolution', () => {
  it.each([
    ['bar', 'barChart'],
    ['bar_chart', 'barChart'],
    ['line', 'lineChart'],
    ['pie', 'donutChart'],
    ['donut', 'donutChart'],
    ['matrix', 'pivotTable'],
    ['table', 'tableEx'],
    ['combo', 'lineStackedColumnComboChart'],
    ['combo_chart', 'lineStackedColumnComboChart'],
    ['button', 'actionButton'],
    ['modern_card', 'cardVisual'],
    ['map', 'azureMap'],
    ['tile_slicer', 'advancedSlicerVisual'],
    ['navigator', 'pageNavigator'],
  ])('resolves alias "%s" → "%s"', (alias, expected) => {
    expect(resolveVisualType(alias)).toBe(expected);
  });

  it('passes canonical names through unchanged', () => {
    for (const t of SUPPORTED_VISUAL_TYPES) {
      expect(resolveVisualType(t)).toBe(t);
    }
  });

  it('returns null for unknown input', () => {
    expect(resolveVisualType('bogus')).toBeNull();
    expect(resolveVisualType('')).toBeNull();
  });

  it('every alias resolves to a supported type', () => {
    for (const target of Object.values(VISUAL_TYPE_ALIASES)) {
      expect(isSupportedVisualType(target)).toBe(true);
    }
  });
});

describe('schemas: DEFAULT_BASE_THEME', () => {
  it('uses CY26SU02 / object versions / SharedResources (Desktop Mar 2026)', () => {
    expect(DEFAULT_BASE_THEME).toEqual({
      name: 'CY26SU02',
      reportVersionAtImport: {
        visual: '2.6.0',
        report: '3.1.0',
        page: '2.3.0',
      },
      type: 'SharedResources',
    });
  });
});

describe('schemas: qualifiedFieldName', () => {
  it('formats as Table[Column]', () => {
    expect(
      qualifiedFieldName({ role: 'Y', table: 'Sales', column: 'Revenue', isMeasure: true }),
    ).toBe('Sales[Revenue]');
  });

  it('handles column names with spaces', () => {
    expect(
      qualifiedFieldName({
        role: 'Y',
        table: 'Sales',
        column: 'Total Revenue',
        isMeasure: true,
      }),
    ).toBe('Sales[Total Revenue]');
  });
});
