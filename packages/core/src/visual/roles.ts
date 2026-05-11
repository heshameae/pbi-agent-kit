// Per-visual-type data-role tables.
//
// Ported verbatim from pbi-cli's core/visual_backend.py:49-174.
// These encode empirical knowledge of which roles each visual accepts and
// which default to Measure (vs Column) references when binding. Changing
// any of this without testing against Desktop will produce visuals that
// parse but render empty.

import type { VisualType } from '../pbir/schemas.js';

// PBIR canonical roles per visual type.
export const VISUAL_DATA_ROLES: Readonly<Record<VisualType, readonly string[]>> = {
  // Original 9
  barChart: ['Category', 'Y', 'Legend'],
  lineChart: ['Category', 'Y', 'Legend'],
  card: ['Values'],
  tableEx: ['Values'],
  pivotTable: ['Rows', 'Values', 'Columns'],
  slicer: ['Values'],
  kpi: ['Indicator', 'Goal', 'TrendLine'],
  gauge: ['Y', 'MaxValue'],
  donutChart: ['Category', 'Y', 'Legend'],
  // v3.1.0
  columnChart: ['Category', 'Y', 'Legend'],
  areaChart: ['Category', 'Y', 'Legend'],
  ribbonChart: ['Category', 'Y', 'Legend'],
  waterfallChart: ['Category', 'Y', 'Breakdown'],
  scatterChart: ['Details', 'X', 'Y', 'Size', 'Legend'],
  funnelChart: ['Category', 'Y'],
  multiRowCard: ['Values'],
  treemap: ['Category', 'Values'],
  cardNew: ['Fields'],
  stackedBarChart: ['Category', 'Y', 'Legend'],
  lineStackedColumnComboChart: ['Category', 'ColumnY', 'LineY', 'Legend'],
  // v3.4.0
  cardVisual: ['Data'],
  actionButton: [],
  // v3.5.0
  clusteredColumnChart: ['Category', 'Y', 'Legend'],
  clusteredBarChart: ['Category', 'Y', 'Legend'],
  textSlicer: ['Values'],
  listSlicer: ['Values'],
  // v3.6.0
  image: [],
  shape: [],
  textbox: [],
  pageNavigator: [],
  advancedSlicerVisual: ['Values'],
  // v3.8.0
  azureMap: ['Category', 'Size'],
};

// Roles that default to Measure references (not Column) when binding.
// Verbatim from MEASURE_ROLES frozenset.
export const MEASURE_ROLES: ReadonlySet<string> = new Set([
  'Y',
  'Values',
  'Fields',
  'Indicator',
  'Goal',
  'ColumnY',
  'LineY',
  'X',
  'Size',
  'Data',
  'MaxValue',
]);

export function isMeasureRole(role: string): boolean {
  return MEASURE_ROLES.has(role);
}

// User-friendly role aliases per visual type → PBIR canonical role.
// Verbatim from ROLE_ALIASES dict.
export const ROLE_ALIASES: Readonly<Record<VisualType, Readonly<Record<string, string>>>> = {
  // Original 9
  barChart: { category: 'Category', value: 'Y', legend: 'Legend' },
  lineChart: { category: 'Category', value: 'Y', legend: 'Legend' },
  card: { field: 'Values', value: 'Values' },
  tableEx: { value: 'Values', column: 'Values' },
  pivotTable: { row: 'Rows', value: 'Values', column: 'Columns' },
  slicer: { value: 'Values', field: 'Values' },
  kpi: {
    indicator: 'Indicator',
    value: 'Indicator',
    goal: 'Goal',
    trend_line: 'TrendLine',
    trend: 'TrendLine',
  },
  gauge: {
    value: 'Y',
    max: 'MaxValue',
    max_value: 'MaxValue',
    target: 'MaxValue',
  },
  donutChart: { category: 'Category', value: 'Y', legend: 'Legend' },
  // v3.1.0
  columnChart: { category: 'Category', value: 'Y', legend: 'Legend' },
  areaChart: { category: 'Category', value: 'Y', legend: 'Legend' },
  ribbonChart: { category: 'Category', value: 'Y', legend: 'Legend' },
  waterfallChart: { category: 'Category', value: 'Y', breakdown: 'Breakdown' },
  scatterChart: {
    x: 'X',
    y: 'Y',
    detail: 'Details',
    size: 'Size',
    legend: 'Legend',
    value: 'Y',
  },
  funnelChart: { category: 'Category', value: 'Y' },
  multiRowCard: { field: 'Values', value: 'Values' },
  treemap: { category: 'Category', value: 'Values' },
  cardNew: { field: 'Fields', value: 'Fields' },
  stackedBarChart: { category: 'Category', value: 'Y', legend: 'Legend' },
  lineStackedColumnComboChart: {
    category: 'Category',
    column: 'ColumnY',
    line: 'LineY',
    legend: 'Legend',
    value: 'ColumnY',
  },
  // v3.4.0
  cardVisual: { field: 'Data', value: 'Data' },
  actionButton: {},
  // v3.5.0
  clusteredColumnChart: { category: 'Category', value: 'Y', legend: 'Legend' },
  clusteredBarChart: { category: 'Category', value: 'Y', legend: 'Legend' },
  textSlicer: { value: 'Values', field: 'Values' },
  listSlicer: { value: 'Values', field: 'Values' },
  // v3.6.0
  image: {},
  shape: {},
  textbox: {},
  pageNavigator: {},
  advancedSlicerVisual: { value: 'Values', field: 'Values' },
  // v3.8.0
  azureMap: { category: 'Category', value: 'Size', size: 'Size' },
};

/**
 * Resolve a user-friendly role alias (or canonical name) to a canonical PBIR
 * role for a given visual type. Returns `null` if the role isn't valid for the
 * type.
 */
export function resolveRole(visualType: VisualType, role: string): string | null {
  const validRoles = VISUAL_DATA_ROLES[visualType];
  if (validRoles.includes(role)) return role;
  const aliases = ROLE_ALIASES[visualType];
  const aliased = aliases[role.toLowerCase()];
  if (aliased !== undefined && validRoles.includes(aliased)) return aliased;
  return null;
}
