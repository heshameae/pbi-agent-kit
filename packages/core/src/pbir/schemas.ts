// PBIR (Power BI Enhanced Report Format) schema URLs, supported types,
// aliases, and defaults.
//
// Ported from pbi-cli's core/pbir_models.py (MIT). Constants are empirically
// pinned to versions Power BI Desktop accepts — wrong URL = file won't open.

// -- Schema URLs ------------------------------------------------------------

// Power BI Desktop (March 2026, build 2.152) writes report/3.2.0.
// Earlier pbi-cli versions used 1.2.0 — that's now rejected by Desktop's
// validator when the report has visuals.
export const SCHEMA_REPORT =
  'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.2.0/schema.json';

export const SCHEMA_PAGE =
  'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json';

export const SCHEMA_PAGES_METADATA =
  'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json';

export const SCHEMA_VERSION =
  'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json';

export const SCHEMA_VISUAL_CONTAINER =
  'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.7.0/schema.json';

export const SCHEMA_BOOKMARKS_METADATA =
  'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/bookmarksMetadata/1.0.0/schema.json';

export const SCHEMA_BOOKMARK =
  'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/bookmark/2.1.0/schema.json';

// Fabric git-integration .platform file schema (used in <name>.Report/.platform
// and <name>.SemanticModel/.platform).
export const SCHEMA_PLATFORM =
  'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json';

// -- Supported visual types (32) -------------------------------------------

export const SUPPORTED_VISUAL_TYPES = [
  // Original 9
  'barChart',
  'lineChart',
  'card',
  'pivotTable',
  'tableEx',
  'slicer',
  'kpi',
  'gauge',
  'donutChart',
  // v3.1.0
  'columnChart',
  'areaChart',
  'ribbonChart',
  'waterfallChart',
  'scatterChart',
  'funnelChart',
  'multiRowCard',
  'treemap',
  'cardNew',
  'stackedBarChart',
  'lineStackedColumnComboChart',
  // v3.4.0
  'cardVisual',
  'actionButton',
  // v3.5.0
  'clusteredColumnChart',
  'clusteredBarChart',
  'textSlicer',
  'listSlicer',
  // v3.6.0
  'image',
  'shape',
  'textbox',
  'pageNavigator',
  'advancedSlicerVisual',
  // v3.8.0
  'azureMap',
] as const;

export type VisualType = (typeof SUPPORTED_VISUAL_TYPES)[number];

const SUPPORTED_SET: ReadonlySet<string> = new Set<string>(SUPPORTED_VISUAL_TYPES);

export function isSupportedVisualType(value: string): value is VisualType {
  return SUPPORTED_SET.has(value);
}

// -- User-friendly aliases → canonical visualType --------------------------

export const VISUAL_TYPE_ALIASES: Readonly<Record<string, VisualType>> = {
  // Original 9
  bar_chart: 'barChart',
  bar: 'barChart',
  line_chart: 'lineChart',
  line: 'lineChart',
  card: 'card',
  table: 'tableEx',
  matrix: 'pivotTable',
  slicer: 'slicer',
  kpi: 'kpi',
  gauge: 'gauge',
  donut: 'donutChart',
  donut_chart: 'donutChart',
  pie: 'donutChart',
  // v3.1.0
  column: 'columnChart',
  column_chart: 'columnChart',
  area: 'areaChart',
  area_chart: 'areaChart',
  ribbon: 'ribbonChart',
  ribbon_chart: 'ribbonChart',
  waterfall: 'waterfallChart',
  waterfall_chart: 'waterfallChart',
  scatter: 'scatterChart',
  scatter_chart: 'scatterChart',
  funnel: 'funnelChart',
  funnel_chart: 'funnelChart',
  multi_row_card: 'multiRowCard',
  treemap: 'treemap',
  card_new: 'cardNew',
  new_card: 'cardNew',
  stacked_bar: 'stackedBarChart',
  stacked_bar_chart: 'stackedBarChart',
  combo: 'lineStackedColumnComboChart',
  combo_chart: 'lineStackedColumnComboChart',
  // v3.4.0
  card_visual: 'cardVisual',
  modern_card: 'cardVisual',
  action_button: 'actionButton',
  button: 'actionButton',
  // v3.5.0
  clustered_column: 'clusteredColumnChart',
  clustered_column_chart: 'clusteredColumnChart',
  clustered_bar: 'clusteredBarChart',
  clustered_bar_chart: 'clusteredBarChart',
  text_slicer: 'textSlicer',
  list_slicer: 'listSlicer',
  // v3.6.0
  img: 'image',
  text_box: 'textbox',
  page_navigator: 'pageNavigator',
  page_nav: 'pageNavigator',
  navigator: 'pageNavigator',
  advanced_slicer: 'advancedSlicerVisual',
  adv_slicer: 'advancedSlicerVisual',
  tile_slicer: 'advancedSlicerVisual',
  // v3.8.0
  azure_map: 'azureMap',
  map: 'azureMap',
};

/**
 * Resolve any user-friendly alias or canonical name to a canonical VisualType.
 * Returns `null` if the input is not recognised.
 */
export function resolveVisualType(input: string): VisualType | null {
  if (isSupportedVisualType(input)) return input;
  return VISUAL_TYPE_ALIASES[input] ?? null;
}

// -- Default base theme ----------------------------------------------------

// Base theme shipped with Power BI Desktop (March 2026, build 2.152).
// The reportVersionAtImport field changed from a string to an object in
// recent Desktop builds — older `"5.55"` is no longer accepted.
export const DEFAULT_BASE_THEME = {
  name: 'CY26SU02',
  reportVersionAtImport: {
    visual: '2.6.0',
    report: '3.1.0',
    page: '2.3.0',
  },
  type: 'SharedResources',
} as const;

// -- Plain types mirroring frozen dataclasses ------------------------------

export interface PbirPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  tabOrder: number;
}

export interface PbirVisual {
  name: string;
  visualType: string;
  position: PbirPosition;
  pageName: string;
  folderPath: string;
  hasQuery: boolean;
}

export interface PbirPage {
  name: string;
  displayName: string;
  ordinal: number;
  width: number;
  height: number;
  displayOption: string;
  visualCount: number;
  folderPath: string;
}

export interface PbirReport {
  name: string;
  definitionPath: string;
  pageCount: number;
  themeName: string;
  pages: PbirPage[];
}

export interface FieldBinding {
  role: string;
  table: string;
  column: string;
  isMeasure: boolean;
}

/** `Table[Column]` notation. */
export function qualifiedFieldName(b: FieldBinding): string {
  return `${b.table}[${b.column}]`;
}
