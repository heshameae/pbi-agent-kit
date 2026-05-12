#!/usr/bin/env node
// pbi-report-mcp — MCP server exposing pbi-core's PBIR operations.
//
// Stdio transport. Designed to run as a child process of any MCP-capable
// agent (Claude Code, Claude Desktop, Cursor, VS Code, Cline, …) and as
// part of the pbi-mcp-ts plugin via its `.mcp.json`.
//
// All tools are prefixed `pbi_` to avoid collision with Microsoft's
// `@microsoft/powerbi-modeling-mcp` (which covers the modeling layer
// side-by-side).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  VERSION,
  bookmarkAdd,
  bookmarkDelete,
  bookmarkGet,
  bookmarkList,
  bookmarkSetVisibility,
  filterAddCategorical,
  filterAddRelativeDate,
  filterAddTopN,
  filterClear,
  filterList,
  filterRemove,
  formatBackgroundConditional,
  formatBackgroundGradient,
  formatBackgroundMeasure,
  formatClear,
  formatGet,
  pageAdd,
  pageDelete,
  pageGet,
  pageList,
  pageSetBackground,
  pageSetVisibility,
  reportCreate,
  reportInfo,
  resolveReportPath,
  validateReportFull,
  visualAdd,
  visualBind,
  visualBulkBind,
  visualBulkDelete,
  visualBulkUpdate,
  visualCalcAdd,
  visualCalcDelete,
  visualCalcList,
  visualDelete,
  visualGet,
  visualList,
  visualSetContainer,
  visualUpdate,
  visualWhere,
} from 'pbi-core';
import { z } from 'zod';

const server = new McpServer({
  name: 'pbi-report-mcp-server',
  version: VERSION,
});

// -- Helper: register a tool with consistent error handling ----------------

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
};

function tool<TShape extends z.ZodRawShape>(
  name: string,
  title: string,
  description: string,
  inputShape: TShape,
  annotations: ToolAnnotations,
  handler: (input: z.infer<z.ZodObject<TShape>>) => unknown | Promise<unknown>,
): void {
  // The SDK's callback generic depends on the inputSchema in a way TS can't
  // easily thread through our generic wrapper. Cast the callback — Zod still
  // validates at runtime via the SDK's internal parsing.
  // biome-ignore lint/suspicious/noExplicitAny: SDK generic threading
  const callback: any = async (input: unknown) => {
    try {
      const result = await handler(input as z.infer<z.ZodObject<TShape>>);
      const json = JSON.stringify(result, null, 2);
      const structured =
        result !== null && typeof result === 'object'
          ? (result as Record<string, unknown>)
          : { value: result };
      return {
        content: [{ type: 'text' as const, text: json }],
        structuredContent: structured,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
      };
    }
  };

  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: inputShape,
      annotations: { openWorldHint: false, ...annotations },
    },
    callback,
  );
}

// Shared field-shape fragments.
const PATH_FIELD = z
  .string()
  .optional()
  .describe('Path to the .Report folder. Auto-detected from cwd if omitted.');
const PAGE_FIELD = z.string().describe('Page name/id (e.g. "overview" or a 20-char hex id).');
const VISUAL_FIELD = z.string().describe('Visual name/id within the page.');

function resolvePath(p?: string): string {
  return resolveReportPath(p);
}

// =========================================================================
// REPORT
// =========================================================================

tool(
  'pbi_report_create',
  'Create Power BI Report',
  'Scaffold a new .pbip project with empty .Report and (optionally) blank .SemanticModel folders. Produces files Power BI Desktop (Mar 2026+) accepts.',
  {
    targetPath: z.string().describe('Directory under which <name>.Report/ is created.'),
    name: z.string().describe('Logical report name (used for <name>.pbip and <name>.Report/).'),
    datasetPath: z
      .string()
      .optional()
      .describe(
        'Optional path to existing .SemanticModel; if omitted a blank model is scaffolded.',
      ),
  },
  { destructiveHint: false, idempotentHint: false },
  (input) =>
    reportCreate({
      targetPath: input.targetPath,
      name: input.name,
      datasetPath: input.datasetPath,
    }),
);

tool(
  'pbi_report_info',
  'Get Report Info',
  'Read metadata summary: page count, theme, per-page visual counts.',
  { path: PATH_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  (input) => reportInfo(resolvePath(input.path)),
);

tool(
  'pbi_report_validate',
  'Validate Report',
  'Run all 3 validation tiers (structural, schema, cross-file consistency). Returns errors/warnings/info.',
  { path: PATH_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  (input) => validateReportFull(resolvePath(input.path)),
);

// =========================================================================
// PAGES
// =========================================================================

tool(
  'pbi_page_list',
  'List Pages',
  'List all pages in the report, sorted by pages.json:pageOrder.',
  { path: PATH_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  (input) => pageList(resolvePath(input.path)),
);

tool(
  'pbi_page_get',
  'Get Page Details',
  'Return one page including filterConfig, visual count, visibility.',
  { path: PATH_FIELD, name: z.string().describe('Page name/id.') },
  { readOnlyHint: true, idempotentHint: true },
  (input) => pageGet(resolvePath(input.path), input.name),
);

tool(
  'pbi_page_add',
  'Add Page',
  'Create a new page. If `name` is omitted, a 20-char hex id is generated.',
  {
    path: PATH_FIELD,
    displayName: z.string().describe('Human-readable page name shown in tabs.'),
    name: z.string().optional(),
    width: z.number().int().default(1280),
    height: z.number().int().default(720),
    displayOption: z
      .enum(['FitToPage', 'FitToWidth', 'ActualSize', 'ActualSizeTopLeft'])
      .default('FitToPage'),
  },
  { destructiveHint: false, idempotentHint: false },
  (input) =>
    pageAdd(resolvePath(input.path), {
      displayName: input.displayName,
      name: input.name,
      width: input.width,
      height: input.height,
      displayOption: input.displayOption,
    }),
);

tool(
  'pbi_page_delete',
  'Delete Page',
  'Remove a page and ALL its visuals. Also removes it from pages.json:pageOrder.',
  { path: PATH_FIELD, name: z.string() },
  { destructiveHint: true },
  (input) => pageDelete(resolvePath(input.path), input.name),
);

tool(
  'pbi_page_set_background',
  'Set Page Background',
  'Set the page background colour (hex). `transparency` is 0 (opaque) to 100.',
  {
    path: PATH_FIELD,
    name: z.string(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{3,8}$/)
      .describe('Hex colour like "#F8F9FA".'),
    transparency: z.number().int().min(0).max(100).default(0),
  },
  { destructiveHint: false, idempotentHint: true },
  (input) =>
    pageSetBackground(resolvePath(input.path), input.name, input.color, input.transparency),
);

tool(
  'pbi_page_set_visibility',
  'Set Page Visibility',
  'Show or hide a page in the navigation. Hidden pages are still reachable via drillthrough.',
  { path: PATH_FIELD, name: z.string(), hidden: z.boolean() },
  { destructiveHint: false, idempotentHint: true },
  (input) => pageSetVisibility(resolvePath(input.path), input.name, input.hidden),
);

// =========================================================================
// VISUALS
// =========================================================================

const VISUAL_TYPE_FIELD = z
  .string()
  .describe(
    'Visual type, canonical or alias (bar, line, card, table, matrix, slicer, kpi, gauge, donut, scatter, funnel, area, ribbon, waterfall, etc.). All 32 PBIR types supported.',
  );

tool(
  'pbi_visual_list',
  'List Visuals',
  'List visuals on a page (excluding the visualGroup container type by default).',
  { path: PATH_FIELD, page: PAGE_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  (input) => visualList(resolvePath(input.path), input.page),
);

tool(
  'pbi_visual_get',
  'Get Visual Details',
  'Return visual details including current data bindings.',
  { path: PATH_FIELD, page: PAGE_FIELD, name: VISUAL_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  (input) => visualGet(resolvePath(input.path), input.page, input.name),
);

tool(
  'pbi_visual_add',
  'Add Visual',
  'Add a visual from the bundled visual templates. Empty (no bindings) — call pbi_visual_bind separately.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    visualType: VISUAL_TYPE_FIELD,
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  },
  { destructiveHint: false, idempotentHint: false },
  (input) =>
    visualAdd(resolvePath(input.path), input.page, {
      visualType: input.visualType,
      name: input.name,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
    }),
);

tool(
  'pbi_visual_update',
  'Update Visual',
  'Change position, size, or visibility of an existing visual.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    name: VISUAL_FIELD,
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    hidden: z.boolean().optional(),
  },
  { destructiveHint: false, idempotentHint: true },
  (input) =>
    visualUpdate(resolvePath(input.path), input.page, input.name, {
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      hidden: input.hidden,
    }),
);

tool(
  'pbi_visual_delete',
  'Delete Visual',
  'Remove a single visual and its folder.',
  { path: PATH_FIELD, page: PAGE_FIELD, name: VISUAL_FIELD },
  { destructiveHint: true },
  (input) => visualDelete(resolvePath(input.path), input.page, input.name),
);

tool(
  'pbi_visual_set_container',
  'Set Visual Container Chrome',
  'Set title, border, or background visibility on the container (chrome around the visual). Does NOT affect the visual data.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    name: VISUAL_FIELD,
    title: z.string().optional(),
    borderShow: z.boolean().optional(),
    backgroundShow: z.boolean().optional(),
  },
  { destructiveHint: false, idempotentHint: true },
  (input) =>
    visualSetContainer(resolvePath(input.path), input.page, input.name, {
      title: input.title,
      borderShow: input.borderShow,
      backgroundShow: input.backgroundShow,
    }),
);

tool(
  'pbi_visual_bind',
  'Bind Data to Visual',
  'Bind semantic-model fields to the visual\'s data roles. Roles can be canonical (Y, Category, Values) or aliases (value, category, field). Field reference format: "Table[Column]". Measure-vs-Column auto-detected by role; pass `measure:true` to override. Multiple bindings in one call append; bindings on the same role accumulate.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    name: VISUAL_FIELD,
    bindings: z
      .array(
        z.object({
          role: z.string().describe('Data role name (e.g. "Y", "Category", "value", "category").'),
          field: z
            .string()
            .describe('Field reference like "Sales[Revenue]" or "Geography[Region]".'),
          measure: z
            .boolean()
            .optional()
            .describe('Force-treat as Measure (default: inferred from role).'),
        }),
      )
      .min(1),
  },
  { destructiveHint: false, idempotentHint: false },
  (input) => visualBind(resolvePath(input.path), input.page, input.name, input.bindings),
);

tool(
  'pbi_visual_calc_add',
  'Add Visual Calculation',
  'Add a DAX visual calculation scoped to this visual. Idempotent — re-adding with the same `calcName` replaces.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    name: VISUAL_FIELD,
    calcName: z.string(),
    expression: z.string().describe('DAX expression, e.g. "RUNNINGSUM([Revenue])".'),
    role: z.string().default('Y').describe('Role to attach the calc to (default Y).'),
  },
  { destructiveHint: false, idempotentHint: true },
  (input) =>
    visualCalcAdd(
      resolvePath(input.path),
      input.page,
      input.name,
      input.calcName,
      input.expression,
      input.role,
    ),
);

tool(
  'pbi_visual_calc_list',
  'List Visual Calculations',
  'List all DAX visual calculations across all roles.',
  { path: PATH_FIELD, page: PAGE_FIELD, name: VISUAL_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  (input) => visualCalcList(resolvePath(input.path), input.page, input.name),
);

tool(
  'pbi_visual_calc_delete',
  'Delete Visual Calculation',
  'Remove a visual calculation by name. Throws if not found.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    name: VISUAL_FIELD,
    calcName: z.string(),
  },
  { destructiveHint: true },
  (input) => visualCalcDelete(resolvePath(input.path), input.page, input.name, input.calcName),
);

// =========================================================================
// FILTERS  (visual scope when `visual` is set; otherwise page scope)
// =========================================================================

tool(
  'pbi_filter_list',
  'List Filters',
  'List all filters on a page (or visual if `visual` is set).',
  { path: PATH_FIELD, page: PAGE_FIELD, visual: z.string().optional() },
  { readOnlyHint: true, idempotentHint: true },
  (input) => filterList(resolvePath(input.path), { page: input.page, visual: input.visual }),
);

tool(
  'pbi_filter_add_categorical',
  'Add Categorical Filter',
  'Add a filter that includes values from `values[]` for the given Table[Column]. Page-level filters get `howCreated="User"`; visual-level filters do not.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    visual: z.string().optional(),
    table: z.string(),
    column: z.string(),
    values: z
      .array(z.string())
      .min(1)
      .describe('String values; ints/doubles get encoded as PBI literals.'),
    name: z.string().optional(),
  },
  { destructiveHint: false, idempotentHint: false },
  (input) =>
    filterAddCategorical(resolvePath(input.path), {
      page: input.page,
      visual: input.visual,
      table: input.table,
      column: input.column,
      values: input.values,
      name: input.name,
    }),
);

tool(
  'pbi_filter_add_topn',
  'Add TopN Filter',
  'Add a "top N by measure" filter. `direction` is Top (descending) or Bottom (ascending).',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    visual: z.string().optional(),
    table: z.string(),
    column: z.string(),
    n: z.number().int().positive(),
    orderByTable: z.string(),
    orderByColumn: z.string(),
    direction: z.enum(['Top', 'Bottom']).default('Top'),
    name: z.string().optional(),
  },
  { destructiveHint: false, idempotentHint: false },
  (input) =>
    filterAddTopN(resolvePath(input.path), {
      page: input.page,
      visual: input.visual,
      table: input.table,
      column: input.column,
      n: input.n,
      orderByTable: input.orderByTable,
      orderByColumn: input.orderByColumn,
      direction: input.direction,
      name: input.name,
    }),
);

tool(
  'pbi_filter_add_relative_date',
  'Add Relative Date Filter',
  'Add a "last N {days|weeks|months|years}" filter relative to today.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    visual: z.string().optional(),
    table: z.string(),
    column: z.string(),
    amount: z.number().int().positive(),
    timeUnit: z.enum(['days', 'weeks', 'months', 'years']),
    name: z.string().optional(),
  },
  { destructiveHint: false, idempotentHint: false },
  (input) =>
    filterAddRelativeDate(resolvePath(input.path), {
      page: input.page,
      visual: input.visual,
      table: input.table,
      column: input.column,
      amount: input.amount,
      timeUnit: input.timeUnit,
      name: input.name,
    }),
);

tool(
  'pbi_filter_remove',
  'Remove Filter',
  'Remove a single filter by name from a page or visual.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    visual: z.string().optional(),
    name: z.string(),
  },
  { destructiveHint: true },
  (input) =>
    filterRemove(resolvePath(input.path), { page: input.page, visual: input.visual }, input.name),
);

tool(
  'pbi_filter_clear',
  'Clear All Filters',
  'Remove every filter on a page or visual. Returns count removed.',
  { path: PATH_FIELD, page: PAGE_FIELD, visual: z.string().optional() },
  { destructiveHint: true },
  (input) => filterClear(resolvePath(input.path), { page: input.page, visual: input.visual }),
);

// =========================================================================
// BOOKMARKS
// =========================================================================

tool(
  'pbi_bookmark_list',
  'List Bookmarks',
  'List all bookmarks with their display names and active sections.',
  { path: PATH_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  (input) => bookmarkList(resolvePath(input.path)),
);

tool(
  'pbi_bookmark_get',
  'Get Bookmark',
  'Return the full JSON of one bookmark (including explorationState).',
  { path: PATH_FIELD, name: z.string() },
  { readOnlyHint: true, idempotentHint: true },
  (input) => bookmarkGet(resolvePath(input.path), input.name),
);

tool(
  'pbi_bookmark_add',
  'Add Bookmark',
  'Create a new bookmark pointing at a page. Initialises an empty explorationState.',
  {
    path: PATH_FIELD,
    displayName: z.string(),
    targetPage: PAGE_FIELD,
    name: z.string().optional(),
  },
  { destructiveHint: false, idempotentHint: false },
  (input) => bookmarkAdd(resolvePath(input.path), input.displayName, input.targetPage, input.name),
);

tool(
  'pbi_bookmark_delete',
  'Delete Bookmark',
  'Remove a bookmark file and its entry in the bookmarks.json index.',
  { path: PATH_FIELD, name: z.string() },
  { destructiveHint: true },
  (input) => bookmarkDelete(resolvePath(input.path), input.name),
);

tool(
  'pbi_bookmark_set_visibility',
  'Set Visual Visibility in Bookmark',
  'Hide or show a specific visual when this bookmark is applied. Visibility = presence of singleVisual.display in the bookmark.',
  {
    path: PATH_FIELD,
    name: z.string().describe('Bookmark name.'),
    page: PAGE_FIELD,
    visual: VISUAL_FIELD,
    hidden: z.boolean(),
  },
  { destructiveHint: false, idempotentHint: true },
  (input) =>
    bookmarkSetVisibility(
      resolvePath(input.path),
      input.name,
      input.page,
      input.visual,
      input.hidden,
    ),
);

// =========================================================================
// FORMAT (visual conditional formatting)
// =========================================================================

tool(
  'pbi_format_get',
  'Get Visual Formatting',
  'Return the visual.objects block (current formatting state).',
  { path: PATH_FIELD, page: PAGE_FIELD, name: VISUAL_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  (input) => formatGet(resolvePath(input.path), input.page, input.name),
);

tool(
  'pbi_format_clear',
  'Clear Visual Formatting',
  'Clear ALL formatting (visual.objects = {}).',
  { path: PATH_FIELD, page: PAGE_FIELD, name: VISUAL_FIELD },
  { destructiveHint: true },
  (input) => formatClear(resolvePath(input.path), input.page, input.name),
);

tool(
  'pbi_format_background_gradient',
  'Background Gradient Rule',
  'Add a linear gradient background-colour rule driven by `inputTable[inputColumn]` aggregated.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    name: VISUAL_FIELD,
    inputTable: z.string(),
    inputColumn: z.string(),
    fieldQueryRef: z.string().describe('queryRef of the target column (selector.metadata).'),
    minColor: z.string().optional(),
    maxColor: z.string().optional(),
  },
  { destructiveHint: false, idempotentHint: true },
  (input) =>
    formatBackgroundGradient(resolvePath(input.path), input.page, input.name, {
      inputTable: input.inputTable,
      inputColumn: input.inputColumn,
      fieldQueryRef: input.fieldQueryRef,
      minColor: input.minColor,
      maxColor: input.maxColor,
    }),
);

tool(
  'pbi_format_background_conditional',
  'Background Conditional Rule',
  'Set background colour when `aggregate(inputColumn) {comparison} threshold`. Default comparison: gt.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    name: VISUAL_FIELD,
    inputTable: z.string(),
    inputColumn: z.string(),
    threshold: z.number(),
    colorHex: z.string().regex(/^#[0-9A-Fa-f]{3,8}$/),
    comparison: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']).default('gt'),
    fieldQueryRef: z
      .string()
      .optional()
      .describe('queryRef of the target column. Defaults to "Sum({inputTable}.{inputColumn})".'),
  },
  { destructiveHint: false, idempotentHint: true },
  (input) =>
    formatBackgroundConditional(resolvePath(input.path), input.page, input.name, {
      inputTable: input.inputTable,
      inputColumn: input.inputColumn,
      threshold: input.threshold,
      colorHex: input.colorHex,
      comparison: input.comparison,
      fieldQueryRef: input.fieldQueryRef,
    }),
);

tool(
  'pbi_format_background_measure',
  'Background Measure-Driven Rule',
  'Background colour comes from a DAX measure that returns a hex string.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    name: VISUAL_FIELD,
    measureTable: z.string(),
    measureProperty: z.string(),
    fieldQueryRef: z.string(),
  },
  { destructiveHint: false, idempotentHint: true },
  (input) =>
    formatBackgroundMeasure(resolvePath(input.path), input.page, input.name, {
      measureTable: input.measureTable,
      measureProperty: input.measureProperty,
      fieldQueryRef: input.fieldQueryRef,
    }),
);

// =========================================================================
// BULK
// =========================================================================

tool(
  'pbi_visual_where',
  'Filter Visuals',
  'Filter visuals on a page by type, name glob (fnmatch-style: *, ?), and/or position bounds. Returns matches.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    visualType: z.string().optional(),
    namePattern: z.string().optional(),
    xMin: z.number().optional(),
    xMax: z.number().optional(),
    yMin: z.number().optional(),
    yMax: z.number().optional(),
  },
  { readOnlyHint: true, idempotentHint: true },
  (input) =>
    visualWhere(resolvePath(input.path), input.page, {
      visualType: input.visualType,
      namePattern: input.namePattern,
      xMin: input.xMin,
      xMax: input.xMax,
      yMin: input.yMin,
      yMax: input.yMax,
    }),
);

tool(
  'pbi_visual_bulk_bind',
  'Bulk Bind Visuals',
  'Apply the same bindings to every visual of a given type (optionally filtered by name pattern).',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    visualType: VISUAL_TYPE_FIELD,
    namePattern: z.string().optional(),
    bindings: z
      .array(
        z.object({
          role: z.string(),
          field: z.string(),
          measure: z.boolean().optional(),
        }),
      )
      .min(1),
  },
  { destructiveHint: false, idempotentHint: false },
  (input) =>
    visualBulkBind(resolvePath(input.path), input.page, {
      visualType: input.visualType,
      namePattern: input.namePattern,
      bindings: input.bindings,
    }),
);

tool(
  'pbi_visual_bulk_update',
  'Bulk Update Visuals',
  'Apply position/size/hidden updates to every matching visual. At least one `set*` field is required.',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    whereType: z.string().optional(),
    whereNamePattern: z.string().optional(),
    setHidden: z.boolean().optional(),
    setWidth: z.number().optional(),
    setHeight: z.number().optional(),
    setX: z.number().optional(),
    setY: z.number().optional(),
  },
  { destructiveHint: false, idempotentHint: true },
  (input) =>
    visualBulkUpdate(resolvePath(input.path), input.page, {
      whereType: input.whereType,
      whereNamePattern: input.whereNamePattern,
      setHidden: input.setHidden,
      setWidth: input.setWidth,
      setHeight: input.setHeight,
      setX: input.setX,
      setY: input.setY,
    }),
);

tool(
  'pbi_visual_bulk_delete',
  'Bulk Delete Visuals',
  'Delete every visual matching the filter. At least one `where*` field is required (safety guard).',
  {
    path: PATH_FIELD,
    page: PAGE_FIELD,
    whereType: z.string().optional(),
    whereNamePattern: z.string().optional(),
  },
  { destructiveHint: true },
  (input) =>
    visualBulkDelete(resolvePath(input.path), input.page, {
      whereType: input.whereType,
      whereNamePattern: input.whereNamePattern,
    }),
);

// -- Boot ------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // IMPORTANT: stdio servers must NOT log to stdout (that's the protocol channel).
  process.stderr.write(`pbi-report-mcp-server v${VERSION} ready (stdio)\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
