#!/usr/bin/env node
// pbi-modeling-mcp — MCP server exposing governed semantic-model operations.
//
// Stdio transport. Designed to run as a child process of any MCP-capable
// agent (Claude Code, Claude Desktop, Cursor, VS Code, Cline, …) and as
// part of the pbi-agent-kit plugin via its `.mcp.json`.
//
// All tools are prefixed `pbi_` to avoid collision with Microsoft's
// `@microsoft/powerbi-modeling-mcp` (which is wrapped behind this governed surface).

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  GOVERNED_DATE_TABLE_ANNOTATIONS,
  MAX_FUTURE_HORIZON_DAYS,
  type MeasureIntent,
  MeasureIntentSchema,
  type RegulatedEnterprisePolicyEvidence,
  type RelationshipReason,
  type TMDLMeasure,
  type TMDLModel,
  type TMDLRelationship,
  VERSION,
  buildDataDictionary,
  buildDateGrainProbeQuery,
  buildDateTableCoverageProbeQuery,
  buildModelFieldIndexFromModel,
  buildTimeIntelligenceMeasureExpression,
  calendarOvershootsFactDay,
  compareByName,
  daxReferenceCheck,
  deriveRequiredDateCoverageFacts,
  detectCalendarMaxAnchorCap,
  expressionUsesTimeIntelligence,
  findCalendarSourceRisks,
  findColumn,
  findMeasure,
  hasCompleteDateGrainProof,
  hasCompleteDateTableKeyProof,
  isNumericType,
  isTemporalType,
  isYearEndDateLiteral,
  modelDoctor,
  modelDoctorFromFolder,
  normalizeDataType,
  parseBarePeriodToDate,
  parseDateGrainProbeResult,
  parseDateTableCoverageProbeResult,
  parseTMDLFolder,
  planDateGrain,
  planDateTableCoverage,
  planStarSchemaSharedDimensions,
  readGovernedDatePolicy,
  relationshipCheck,
  validateDashboardSpec,
} from 'pbi-core';
import { z } from 'zod';
import {
  type ColumnUpdate,
  type ConnectOpts,
  type ConnectionInfo,
  ModelDriver,
  type ModelSnapshotOptions,
  type TableInventoryRow,
  redactConnectionSecrets,
} from './model-bridge/model-driver.js';
import { getMsMcpClient } from './model-bridge/ms-mcp-client.js';

function createMcpServer(): McpServer {
  return new McpServer({
    name: 'pbi-modeling-mcp-server',
    version: VERSION,
  });
}

const server = createMcpServer();

// -- Helper: register a tool with consistent error handling ----------------

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
};

type ToolDefinition = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputShape: z.ZodRawShape;
  readonly annotations: ToolAnnotations;
  // biome-ignore lint/suspicious/noExplicitAny: MCP SDK callback generic is stored erased
  readonly callback: any;
};

const toolDefinitions: ToolDefinition[] = [];

function summarizeToolResult(name: string, result: unknown): string {
  if (result === null || result === undefined) return `${name}: ok`;
  if (typeof result !== 'object' || Array.isArray(result)) {
    const text = String(result);
    return text.length > 500 ? `${text.slice(0, 497)}...` : text;
  }

  const obj = result as Record<string, unknown>;
  const parts = [name];
  for (const key of ['status', 'mode', 'applied', 'dryRun']) {
    const value = obj[key];
    if (value !== undefined) parts.push(`${key}=${String(value)}`);
  }
  for (const key of [
    'tables',
    'columns',
    'measures',
    'relationships',
    'operations',
    'plannedOperations',
    'blockers',
    'warnings',
  ]) {
    const value = obj[key];
    if (Array.isArray(value)) parts.push(`${key}=${value.length}`);
  }
  const counts = obj.counts;
  if (counts !== null && typeof counts === 'object' && !Array.isArray(counts)) {
    const rendered = Object.entries(counts as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ');
    if (rendered) parts.push(`counts(${rendered})`);
  }
  return `${parts.join(' ')}. Full payload is in structuredContent.`;
}

function registerToolDefinition(target: McpServer, definition: ToolDefinition): void {
  target.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputShape,
      annotations: { openWorldHint: false, ...definition.annotations },
    },
    definition.callback,
  );
}

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
      const structured =
        result !== null && typeof result === 'object'
          ? (result as Record<string, unknown>)
          : { value: result };
      return {
        content: [{ type: 'text' as const, text: summarizeToolResult(name, result) }],
        structuredContent: structured,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const report =
        err !== null && typeof err === 'object' && 'report' in err
          ? (err as { report?: unknown }).report
          : undefined;
      const structured =
        report !== undefined && report !== null && typeof report === 'object'
          ? { error: msg, ...(report as Record<string, unknown>) }
          : { error: msg };
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        structuredContent: structured,
      };
    }
  };

  const definition: ToolDefinition = {
    name,
    title,
    description,
    inputShape,
    annotations,
    callback,
  };
  toolDefinitions.push(definition);
  registerToolDefinition(server, definition);
}

export interface BuildServerOptions {
  readonly surface?: 'modeling';
}

const MODELING_SURFACE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'pbi_model_check',
  'pbi_model_regulated_check',
  'pbi_model_snapshot',
  'pbi_model_list_tables',
  'pbi_model_list_columns',
  'pbi_model_list_measures',
  'pbi_model_list_relationships',
  'pbi_data_dictionary_get',
  'pbi_model_plan_star_schema_join',
  'pbi_model_plan_actuals_targets_join',
  'pbi_model_apply_star_schema_join',
  'pbi_model_plan_date_grain',
  'pbi_model_plan_date_table',
  'pbi_model_refresh',
  'pbi_model_export',
  'pbi_dax_query',
  'pbi_dax_reference_check',
  'pbi_measure_create',
  'pbi_measure_create_batch',
  'pbi_measure_update',
  'pbi_measure_delete',
  'pbi_table_create',
  'pbi_table_update',
  'pbi_table_mark_as_date',
  'pbi_table_delete',
  'pbi_column_create',
  'pbi_column_update',
  'pbi_column_delete',
  'pbi_relationship_create',
  'pbi_relationship_update',
  'pbi_relationship_activate',
  'pbi_relationship_deactivate',
  'pbi_relationship_delete',
  'pbi_date_table_create_governed',
  'pbi_spec_validate',
] as const);

// Shared field-shape fragments.
const LIVE_MODEL_PERSISTENCE =
  'Live semantic-model metadata is updated in Power BI Desktop — press Ctrl+S in Desktop to persist the model metadata.';
const FOLDER_MODEL_PERSISTENCE = 'Call pbi_model_export to write the TMDL to disk.';
// MAX_FUTURE_HORIZON_DAYS is imported from pbi-core so the zod input bound, the
// relationship gate, and readGovernedDatePolicy's annotation clamp share one ceiling.
const FUTURE_HORIZON_DAYS_FIELD = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_FUTURE_HORIZON_DAYS)
  .optional()
  .describe('Explicit allowed days beyond observed fact max dates. Defaults to 0; maximum 3660.');
const DATE_PROOF_FORBIDDEN_FALLBACK_TOOLS = [
  'pbi_dax_query',
  'pbi_model_refresh',
  'pbi_table_create',
  'pbi_table_update',
  'pbi_table_mark_as_date',
  'pbi_column_create',
  'pbi_column_update',
  'pbi_relationship_create',
  'pbi_relationship_update',
  'pbi_relationship_activate',
] as const;
const DATE_PROOF_BLOCKED_NEXT_STEP =
  'Report this structured Date-proof blocker and stop before any Date write. If the user explicitly approves processing/import refresh, rerun pbi_date_table_create_governed with refreshBeforeProbe:true; do not call pbi_model_refresh directly, do not retry with probeData:false, do not run manual DAX probes, and do not use primitive Date writes as a fallback. If the blocker is proof-parse-shape-unrecognized or probeStatus.status is parse-shape-unrecognized/evidenceRows:0 from a ROW()-based proof, treat it as a tool/parse defect: report it verbatim and stop; do not claim the model is empty and do not use pbi_dax_query, pbi_model_refresh, manual DAX, probeData:false, or primitive Date/relationship writes.';
const DATE_PROOF_PARSE_SHAPE_RATIONALE =
  'A ROW()-based Date proof is constructed to emit at least one tabular row for each expected proof row even when source tables are empty; zero parsed evidence indicates an unrecognized or lost tool/host result shape, not an empty model.';
const DATE_PROOF_PARSE_SHAPE_MESSAGE =
  'Date proof returned zero parsed evidence from a generated ROW()-based query. This is a tool/parse defect to report, not evidence that the model is empty; stop before Date writes and do not run alternate diagnostics as a workaround.';

function dateProofBlockedGuidance(): Record<string, unknown> {
  return {
    blockedAction: 'stop-before-date-write',
    nextStep: DATE_PROOF_BLOCKED_NEXT_STEP,
    forbiddenFallbackTools: [...DATE_PROOF_FORBIDDEN_FALLBACK_TOOLS],
    forbiddenFallbackInputs: ['probeData:false'],
  };
}

function dateProofParseShapeGuidance(): Record<string, unknown> {
  return {
    blockedAction: 'stop-before-date-write',
    nextStep:
      'Report the structured proof-parse-shape-unrecognized blocker verbatim and STOP. This is a Date-proof tool/parse defect, not evidence that the model is empty; do not run pbi_dax_query or pbi_model_refresh, do not retry with probeData:false, do not request model processing or Desktop restart, and do not use manual DAX or primitive Date/relationship writes as a workaround.',
    forbiddenFallbackTools: [...DATE_PROOF_FORBIDDEN_FALLBACK_TOOLS],
    forbiddenFallbackModes: [
      'manual DAX',
      'probeData:false',
      'model processing',
      'Desktop restart',
      'primitive Date writes',
      'primitive relationship writes',
    ],
    forbiddenFallbackInputs: ['probeData:false'],
  };
}

function resolveSemanticModelDefinition(input?: string): string {
  const start = input ? path.resolve(input) : process.cwd();
  const candidates: string[] = [];

  if (existsSync(start) && statSync(start).isDirectory()) {
    if (path.basename(start) === 'definition') candidates.push(start);
    candidates.push(path.join(start, 'definition'));
    if (start.endsWith('.SemanticModel')) {
      candidates.push(path.join(start, 'definition'));
    }
    const parent = path.dirname(start);
    if (existsSync(parent)) {
      for (const entry of readdirSync(parent)) {
        if (entry.endsWith('.SemanticModel')) {
          candidates.push(path.join(parent, entry, 'definition'));
        }
      }
    }
    for (const entry of readdirSync(start)) {
      if (entry.endsWith('.SemanticModel')) {
        candidates.push(path.join(start, entry, 'definition'));
      }
    }
  } else if (existsSync(start) && start.endsWith('.pbip')) {
    const dir = path.dirname(start);
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith('.SemanticModel')) {
        candidates.push(path.join(dir, entry, 'definition'));
      }
    }
  }

  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) return c;
  }

  throw new Error(
    `Could not locate a .SemanticModel/definition folder from "${input ?? process.cwd()}". Pass an explicit modelPath.`,
  );
}

tool(
  'pbi_model_check',
  'Model Doctor — TMDL Validators',
  'Run live-first semantic-model validators: grain inference, BPA-style DAX/modeling/formatting rules, and relationship pre-flight (missing keys, type mismatch, ambiguous paths, cycles). Uses the live Power BI Desktop/env-pinned model when available; modelPath is the offline fallback. Pass bridgeIntent { fromTable, toTable, axes? } to also compute bridge_covers / bridge_uncovered / bridge_blocked_axes for a TREATAS cross-fact analysis. Read-only; no live DAX execution.',
  {
    modelPath: z
      .string()
      .optional()
      .describe(
        'Path to a .SemanticModel folder, its definition/ folder, a .pbip file, or a directory that contains a sibling .SemanticModel. Auto-detected from cwd if omitted.',
      ),
    model: z
      .string()
      .optional()
      .describe(
        'When MULTIPLE Power BI Desktop instances are open, the target model/file name or listed port. Omit when only one instance is open or when the connection is env-pinned.',
      ),
    bridgeIntent: z
      .object({
        fromTable: z.string().describe('Actuals (many-side) fact table.'),
        toTable: z.string().describe('Targets / lookup fact table.'),
        axes: z
          .array(z.string())
          .optional()
          .describe(
            'Visual axes the user intends to slice by. Any axis not in bridge_covers ends up in bridge_uncovered.',
          ),
      })
      .optional()
      .describe(
        'Optional TREATAS bridge intent. When provided, the report includes a bridge analysis identifying which axes the bridge covers and which are structurally blocked.',
      ),
    live: z
      .boolean()
      .optional()
      .describe(
        'Force a live Power BI Desktop/env-pinned read. When true, modelPath is ignored and no offline fallback is used.',
      ),
  },
  { readOnlyHint: true, idempotentHint: true },
  async (input) => {
    if (input.live) {
      const drv = getModelDriver();
      const conn = await connectModel(drv, undefined, input.model);
      const model = await readDriverSnapshot(drv, '(live)', {}, conn);
      return modelDoctor(model, { bridgeIntent: input.bridgeIntent });
    }
    if (input.modelPath) {
      const snapshot = await snapshotModel(input.modelPath, input.model);
      return modelDoctor(snapshot.model, { bridgeIntent: input.bridgeIntent });
    }
    const drv = getModelDriver();
    if (await hasLiveModelCandidate(drv)) {
      const conn = await connectModel(drv, undefined, input.model);
      const model = await readDriverSnapshot(drv, '(live)', {}, conn);
      return modelDoctor(model, { bridgeIntent: input.bridgeIntent });
    }
    return modelDoctorFromFolder(resolveSemanticModelDefinition(), {
      bridgeIntent: input.bridgeIntent,
    });
  },
);

tool(
  'pbi_model_regulated_check',
  'Regulated Enterprise Model Check',
  'Run model doctor with regulated-enterprise evidence gates. Reports captured vs not captured security/governance metadata, blocks Copilot/data-agent exposure unless AI schema scope, RLS leakage tests, tenant settings, and approved instructions are evidenced, and treats missing policy evidence as blocked rather than clean.',
  {
    modelPath: z
      .string()
      .optional()
      .describe(
        'Path to a .SemanticModel folder, its definition/ folder, a .pbip file, or a directory that contains a sibling .SemanticModel. Auto-detected from cwd if omitted.',
      ),
    model: z
      .string()
      .optional()
      .describe(
        'When MULTIPLE Power BI Desktop instances are open, the target model/file name or listed port. Omit when only one instance is open or when the connection is env-pinned.',
      ),
    bridgeIntent: z
      .object({
        fromTable: z.string().describe('Actuals (many-side) fact table.'),
        toTable: z.string().describe('Targets / lookup fact table.'),
        axes: z.array(z.string()).optional().describe('Visual axes the user intends to slice by.'),
      })
      .optional()
      .describe('Optional cross-fact bridge intent to include in the model doctor output.'),
    policyEvidence: z
      .object({
        rlsTestResults: z.unknown().optional(),
        sensitivityClassification: z.unknown().optional(),
        olsRequirements: z.unknown().optional(),
        lineage: z.unknown().optional(),
        refreshEvidence: z.unknown().optional(),
        metricOwnerSignoff: z.unknown().optional(),
        openExceptions: z.unknown().optional(),
        serviceGovernance: z.unknown().optional(),
        copilotExposure: z.enum(['in-scope', 'out-of-scope']).optional(),
        copilot: z
          .object({
            aiSchemaScope: z.unknown().optional(),
            rlsLeakageTests: z.unknown().optional(),
            tenantSettings: z.unknown().optional(),
            approvedInstructions: z.unknown().optional(),
          })
          .optional(),
      })
      .optional()
      .describe(
        'External audit evidence. Missing required evidence keeps regulated readiness blocked; this tool never infers bank safety from model structure alone.',
      ),
    live: z
      .boolean()
      .optional()
      .describe(
        'Force a live Power BI Desktop/env-pinned read. When true, modelPath is ignored and no offline fallback is used.',
      ),
  },
  { readOnlyHint: true, idempotentHint: true },
  async (input) => {
    const options = {
      bridgeIntent: input.bridgeIntent,
      regulatedEnterprise: true,
      policyEvidence: input.policyEvidence as RegulatedEnterprisePolicyEvidence | undefined,
    };
    if (input.live) {
      const drv = getModelDriver();
      const conn = await connectModel(drv, undefined, input.model);
      const model = await readDriverSnapshot(drv, '(live)', {}, conn);
      return modelDoctor(model, options);
    }
    if (input.modelPath) {
      const snapshot = await snapshotModel(input.modelPath, input.model);
      return modelDoctor(snapshot.model, options);
    }
    const drv = getModelDriver();
    if (await hasLiveModelCandidate(drv)) {
      const conn = await connectModel(drv, undefined, input.model);
      const model = await readDriverSnapshot(drv, '(live)', {}, conn);
      return modelDoctor(model, options);
    }
    return modelDoctorFromFolder(resolveSemanticModelDefinition(), options);
  },
);

tool(
  'pbi_dax_reference_check',
  'Check DAX References',
  'Read-only lexical DAX reference check against a .SemanticModel/definition folder. Verifies qualified Table[Field] and bare [Measure] references; fails closed on missing or ambiguous references.',
  {
    modelPath: z
      .string()
      .describe('Path to .SemanticModel/definition, .SemanticModel, .pbip, or containing folder.'),
    expression: z.string().describe('DAX expression to check.'),
    hostTable: z
      .string()
      .optional()
      .describe('Host table for same-table bare [Measure] references.'),
  },
  { readOnlyHint: true, idempotentHint: true },
  (input) => {
    const definitionPath = resolveSemanticModelDefinition(input.modelPath);
    const model = parseTMDLFolder(definitionPath);
    return daxReferenceCheck(input.expression, model, { hostTable: input.hostTable });
  },
);

// =========================================================================
// MODELING — LIVE (wrapped Microsoft Power BI modeling MCP)
// =========================================================================
//
// These tools drive Microsoft's modeling MCP, which we spawn as an INTERNAL
// child subprocess (see model-bridge/) rather than register as a peer. Reads
// assemble the live model into a TMDLModel so the existing validators reuse;
// pbi_measure_create runs an in-code DAX-reference gate before any write — the
// deterministic replacement for the old gate-measure-create PreToolUse hook.

let modelDriver: ModelDriver | null = null;
function getModelDriver(): ModelDriver {
  if (!modelDriver) modelDriver = new ModelDriver(getMsMcpClient());
  return modelDriver;
}

export function setModelDriverForTests(driver: ModelDriver | null): void {
  modelDriver = driver;
}

const MODEL_FOLDER_FIELD = z
  .string()
  .optional()
  .describe(
    'Semantic-model OFFLINE fallback only. Leave UNSET whenever Power BI Desktop is open — model writes auto-target the live Desktop instance and appear immediately (the user presses Ctrl+S to persist live semantic-model metadata). Set it only for headless/offline editing of a .SemanticModel/definition when no Desktop is running; folder writes land on TMDL disk files and an already-open Desktop will not see them until the model is reopened.',
  );

const MODEL_SELECT_FIELD = z
  .string()
  .optional()
  .describe(
    'When MULTIPLE Power BI Desktop instances are open, the target model/file name (e.g. "Sales") or listed port (e.g. "59186"). Paths and .pbix/.SemanticModel suffixes are ignored for names, case-insensitive. Omit when only one instance is open or when the connection is env-pinned.',
  );

const INCLUDE_COLUMNS_FIELD = z
  .boolean()
  .optional()
  .describe(
    "Include each table's full column array. Defaults to false to keep table inventory fast and low-token; use pbi_model_list_columns for column-focused work.",
  );

const INCLUDE_MEASURES_FIELD = z
  .boolean()
  .optional()
  .describe(
    "Include each table's full measure array. Defaults to false to keep table inventory fast and low-token; use pbi_model_list_measures for measure-focused work.",
  );

const MEASURE_INTENT_FIELD = MeasureIntentSchema.describe(
  'Confirmed business intent evidence for this measure write. Required for create and update calls: status must be confirmed, sourceRefs must resolve in the target model, and time-intelligence DAX requires Date policy evidence. When the DAX uses time intelligence, timeIntelligence must include dateRefs, dateTable, dateColumn, grain, calendarPolicy, and incompletePeriodBehavior.',
);

const RELATIONSHIP_CARDINALITY_FIELD = z
  .literal('manyToOne')
  .optional()
  .describe(
    'Relationship cardinality. Currently only "manyToOne" is supported because fromTable is the foreign-key/many side and toTable is the primary-key/one side.',
  );

// Build the driver ConnectOpts from the two optional selectors. Returns undefined
// only when BOTH are absent (live-first, first-connection-wins). When a folderPath
// is given it is resolved to a .SemanticModel/definition; `model` selects which open
// Desktop instance to target when several are running.
function resolveConnectOpts(folderPath?: string, model?: string): ConnectOpts | undefined {
  if (!folderPath && !model) return undefined;
  return {
    folderPath: folderPath ? resolveSemanticModelDefinition(folderPath) : undefined,
    model,
  };
}

function resolveLivePreferredConnectOpts(folderPath?: string, model?: string): ConnectOpts {
  let resolvedFolderPath: string | undefined;
  if (folderPath) {
    try {
      resolvedFolderPath = resolveSemanticModelDefinition(folderPath);
    } catch {
      resolvedFolderPath = folderPath;
    }
  }
  return {
    ...(resolvedFolderPath ? { folderPath: resolvedFolderPath } : {}),
    model,
    livePreferred: true,
  };
}

async function connectModel(
  drv: ModelDriver,
  folderPath?: string,
  model?: string,
): Promise<ConnectionInfo> {
  if (folderPath && (await hasLiveModelCandidate(drv))) {
    return drv.ensureConnection(resolveLivePreferredConnectOpts(folderPath, model));
  }
  if (!folderPath) {
    return drv.ensureConnection({ model, livePreferred: true });
  }
  return drv.ensureConnection(resolveConnectOpts(folderPath, model));
}

// Read a model snapshot. A supplied folderPath is still an offline fallback:
// when a live Desktop instance is discoverable, reads bind to the live model;
// otherwise folder mode uses pbi-core's pure-TS TMDL parser. Both yield the
// same TMDLModel shape.
async function snapshotModel(
  folderPath?: string,
  model?: string,
  options: ModelSnapshotOptions = {},
): Promise<{ mode: 'live' | 'folder'; model: TMDLModel; connection?: ConnectionInfo }> {
  if (folderPath) {
    const drv = getModelDriver();
    if (await hasLiveModelCandidate(drv)) {
      const conn = await drv.ensureConnection(resolveLivePreferredConnectOpts(folderPath, model));
      if (conn.mode === 'live') {
        return {
          mode: 'live',
          model: await readDriverSnapshot(drv, '(live)', options, conn),
          connection: conn,
        };
      }
    }
    const resolvedFolderPath = resolveSemanticModelDefinition(folderPath);
    return { mode: 'folder', model: parseTMDLFolder(resolvedFolderPath) };
  }
  const drv = getModelDriver();
  const conn = await connectModel(drv, folderPath, model);
  return {
    mode: conn.mode,
    model: await readDriverSnapshot(drv, '(live)', options, conn),
    connection: conn,
  };
}

async function readDriverSnapshot(
  drv: ModelDriver,
  modelPath: string | undefined,
  options: ModelSnapshotOptions,
  expectedConnection?: ConnectionInfo,
  cacheMode: 'fresh' | 'cached' = 'fresh',
): Promise<TMDLModel> {
  const maybeDriver = drv as ModelDriver & {
    getFreshSnapshot?: (
      expectedConnection?: ConnectionInfo,
      options?: ModelSnapshotOptions,
    ) => Promise<TMDLModel>;
    getModelSnapshot?: (
      modelPath?: string,
      options?: ModelSnapshotOptions,
      expectedConnection?: ConnectionInfo,
    ) => Promise<TMDLModel>;
    getCachedSnapshot?: (
      expectedConnection?: ConnectionInfo,
      options?: ModelSnapshotOptions,
    ) => Promise<TMDLModel>;
  };
  if (cacheMode === 'cached' && typeof maybeDriver.getCachedSnapshot === 'function') {
    return maybeDriver.getCachedSnapshot(expectedConnection, options);
  }
  if (typeof maybeDriver.getFreshSnapshot === 'function') {
    return maybeDriver.getFreshSnapshot(expectedConnection, options);
  }
  if (typeof maybeDriver.getModelSnapshot === 'function') {
    return maybeDriver.getModelSnapshot(modelPath, options, expectedConnection);
  }
  if (typeof maybeDriver.getCachedSnapshot === 'function') {
    return maybeDriver.getCachedSnapshot(expectedConnection, options);
  }
  throw new Error('Model driver does not expose a snapshot method.');
}

async function hasLiveModelCandidate(drv: ModelDriver): Promise<boolean> {
  if (process.env.PBI_MODELING_MCP_CONNECTION_STRING?.trim()) return true;
  if (process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE === '1') return false;
  try {
    return (await drv.listLiveInstances()).length > 0;
  } catch {
    return false;
  }
}

// Snapshot for the write gate. Connects FIRST (live-first), then gates against
// the model the write will actually target: the live in-memory model in live
// mode, or the resolved folder offline. This keeps the DAX gate consistent with
// where the write lands — important now that live-first means a write can go
// live even when the caller passed a folderPath (e.g. Desktop is open).
async function snapshotForWrite(
  folderPath?: string,
  model?: string,
  options: ModelSnapshotOptions = { includeMeasures: false, includeRoles: false },
): Promise<{
  mode: 'live' | 'folder';
  model: TMDLModel;
  driver: ModelDriver;
  connection: ConnectionInfo;
}> {
  const drv = getModelDriver();
  if (folderPath) {
    if (await hasLiveModelCandidate(drv)) {
      const conn = await drv.ensureConnection(resolveLivePreferredConnectOpts(folderPath, model));
      if (conn.mode === 'live') {
        return {
          mode: 'live',
          model: await readDriverSnapshot(drv, '(live)', options, conn, 'cached'),
          driver: drv,
          connection: conn,
        };
      }
    }
    const resolvedFolderPath = resolveSemanticModelDefinition(folderPath);
    const conn = await drv.ensureConnection({
      folderPath: resolvedFolderPath,
      model,
      forceFolder: true,
    });
    return {
      mode: 'folder',
      model: parseTMDLFolder(resolvedFolderPath),
      driver: drv,
      connection: conn,
    };
  }
  const conn = await connectModel(drv, folderPath, model);
  return {
    mode: 'live',
    model: await readDriverSnapshot(drv, '(live)', options, conn, 'cached'),
    driver: drv,
    connection: conn,
  };
}

function modelWithoutMeasures(model: TMDLModel): TMDLModel {
  return {
    ...model,
    tables: model.tables.map((table) => ({ ...table, measures: [] })),
  };
}

function stageCreatedMeasure(
  model: TMDLModel,
  def: {
    readonly tableName: string;
    readonly name: string;
    readonly expression?: string;
    readonly formatString?: string;
    readonly description?: string;
  },
): TMDLModel {
  const measure: TMDLMeasure = {
    table: def.tableName,
    name: def.name,
    expression: def.expression ?? '',
    formatString: def.formatString,
    isHidden: false,
    description: def.description,
    annotations: {},
  };
  return {
    ...model,
    tables: model.tables.map((table) =>
      table.name === def.tableName ? { ...table, measures: [...table.measures, measure] } : table,
    ),
  };
}

function tableInventory(
  model: TMDLModel,
  opts: { includeColumns?: boolean; includeMeasures?: boolean } = {},
): Array<Record<string, unknown>> {
  return (
    model.tables
      .map((table) => ({
        name: table.name,
        isHidden: table.isHidden,
        isCalculated: table.isCalculated,
        isAutoDateTable: table.isAutoDateTable,
        dataCategory: table.dataCategory,
        storageMode: table.storageMode,
        description: table.description,
        columnCount: table.columns.length,
        measureCount: table.measures.length,
        ...(opts.includeColumns ? { columns: table.columns } : {}),
        ...(opts.includeMeasures ? { measures: table.measures } : {}),
      }))
      // Canonical code-unit name order so pbi_model_list_tables is byte-identical
      // run-to-run. Folder mode is already canonical via the parser sort; this also
      // normalizes LIVE mode, where model.tables arrives in host-return order.
      .sort((a, b) => compareByName(a.name, b.name))
  );
}

const LIVE_DISCOVERY_REMEDIATION = [
  'Re-run pbi_model_list_tables or pbi_model_snapshot with the same model selector to confirm the table exists in the currently targeted model.',
  'If multiple Power BI Desktop windows are open, pass model with the intended file/model name or listed port, or close the other windows before retrying.',
  'If the table was added or reshaped in Power Query or by calculated-table DAX, apply the query changes and run pbi_model_refresh; Ctrl+S only persists metadata and does not materialize pending model-shape changes.',
  'If you edited TMDL/PBIP files on disk while Desktop is open, close and reopen the .pbip so Desktop reloads disk state before saving from Desktop.',
] as const;

function liveTargetSummary(
  mode: 'live' | 'folder',
  connection: ConnectionInfo | undefined,
  modelSelector: string | undefined,
): Record<string, unknown> {
  if (!connection) {
    return {
      mode,
      modelSelector: modelSelector ?? null,
      status: 'not-connected',
    };
  }
  if (connection.mode === 'live') {
    return {
      mode: 'live',
      modelSelector: modelSelector ?? null,
      connectionString: redactConnectionSecrets(connection.connectionString ?? '(missing)'),
    };
  }
  return {
    mode: 'folder',
    modelSelector: modelSelector ?? null,
    folderPath: connection.folderPath,
  };
}

function observedTableSummary(model: TMDLModel): Record<string, unknown> {
  return {
    count: model.tables.length,
    visibleCount: model.tables.filter((table) => table.isHidden !== true).length,
    hiddenCount: model.tables.filter((table) => table.isHidden === true).length,
    sampleNames: model.tables.slice(0, 25).map((table) => table.name),
  };
}

function observedTableInventorySummary(
  tables: ReadonlyArray<Record<string, unknown> | TableInventoryRow>,
): Record<string, unknown> {
  return {
    count: tables.length,
    sampleNames: tables
      .map((table) => table.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
      .slice(0, 25),
  };
}

function liveDiscoveryDiagnostics(input: {
  readonly reason: string;
  readonly mode: 'live' | 'folder';
  readonly connection?: ConnectionInfo;
  readonly modelSelector?: string;
  readonly requestedTables?: ReadonlyArray<string>;
  readonly model?: TMDLModel;
  readonly tables?: ReadonlyArray<Record<string, unknown> | TableInventoryRow>;
}): Record<string, unknown> {
  return {
    reason: input.reason,
    liveTarget: liveTargetSummary(input.mode, input.connection, input.modelSelector),
    ...(input.requestedTables && input.requestedTables.length > 0
      ? { requestedTables: [...new Set(input.requestedTables)] }
      : {}),
    ...(input.model ? { observedTables: observedTableSummary(input.model) } : {}),
    ...(input.tables ? { observedTables: observedTableInventorySummary(input.tables) } : {}),
    remediation: [...LIVE_DISCOVERY_REMEDIATION],
  };
}

function tableMissingDiagnostics(input: {
  readonly reason: string;
  readonly mode: 'live' | 'folder';
  readonly model: TMDLModel;
  readonly connection?: ConnectionInfo;
  readonly modelSelector?: string;
  readonly requestedTables: ReadonlyArray<string>;
}): Record<string, unknown> {
  return liveDiscoveryDiagnostics(input);
}

function hasMissingTableReason(reasons: ReadonlyArray<{ readonly code?: string }>): boolean {
  return reasons.some(
    (reason) => reason.code !== undefined && /table.*missing|table-not-found/.test(reason.code),
  );
}

function missingDaxReferenceTables(
  missing: ReadonlyArray<{ readonly table?: string }>,
  model: TMDLModel,
): string[] {
  const existing = new Set(model.tables.map((table) => table.name));
  return [
    ...new Set(
      missing
        .map((ref) => ref.table)
        .filter((table): table is string => table !== undefined && !existing.has(table)),
    ),
  ];
}

function daxReferenceCheckReport(input: {
  readonly check: ReturnType<typeof daxReferenceCheck>;
  readonly mode: 'live' | 'folder';
  readonly model: TMDLModel;
  readonly connection?: ConnectionInfo;
  readonly modelSelector?: string;
}): Record<string, unknown> {
  const missingTables = missingDaxReferenceTables(input.check.missing, input.model);
  return {
    gate: 'dax-reference-check',
    missing: input.check.missing,
    ambiguous: input.check.ambiguous,
    unsupported: input.check.unsupported,
    ...(missingTables.length > 0
      ? {
          diagnostics: tableMissingDiagnostics({
            reason: 'dax-reference-table-not-found',
            mode: input.mode,
            model: input.model,
            connection: input.connection,
            modelSelector: input.modelSelector,
            requestedTables: missingTables,
          }),
        }
      : {}),
  };
}

function assertTableExistsForWrite(input: {
  readonly tool: string;
  readonly action: string;
  readonly tableName: string;
  readonly mode: 'live' | 'folder';
  readonly model: TMDLModel;
  readonly connection?: ConnectionInfo;
  readonly modelSelector?: string;
}): void {
  if (input.model.tables.some((table) => table.name === input.tableName)) return;
  throwInputValidationError(
    `${input.action} refused: table "${input.tableName}" was not found in the targeted model.`,
    {
      tool: input.tool,
      reason: 'table-not-found',
      tableName: input.tableName,
      diagnostics: tableMissingDiagnostics({
        reason: 'requested-table-not-found',
        mode: input.mode,
        model: input.model,
        connection: input.connection,
        modelSelector: input.modelSelector,
        requestedTables: [input.tableName],
      }),
    },
  );
}

function normalizeModelObjectName(name: string): string {
  return name.trim().toLowerCase();
}

function assertMeasureNameDoesNotCollideWithColumn(input: {
  readonly tool: string;
  readonly tableName: string;
  readonly measureName: string;
  readonly model: TMDLModel;
}): void {
  const table = input.model.tables.find((candidate) => candidate.name === input.tableName);
  if (!table) return;
  const normalizedMeasureName = normalizeModelObjectName(input.measureName);
  const collision = table.columns.find(
    (column) => normalizeModelObjectName(column.name) === normalizedMeasureName,
  );
  if (!collision) return;
  const suggestion = `Total ${input.measureName.trim()}`;
  throwInputValidationError(
    `Measure write refused: measure "${input.measureName}" would collide with existing column "${collision.name}" on table "${input.tableName}". Rename the measure, e.g. "${suggestion}".`,
    {
      tool: input.tool,
      reason: 'measure-column-name-collision',
      tableName: input.tableName,
      measureName: input.measureName,
      columnName: collision.name,
      suggestedName: suggestion,
    },
  );
}

async function tableInventoryForRead(
  folderPath: string | undefined,
  model: string | undefined,
  opts: { includeColumns?: boolean; includeMeasures?: boolean } = {},
): Promise<{
  mode: 'live' | 'folder';
  tables: Array<Record<string, unknown> | TableInventoryRow>;
}> {
  if (opts.includeColumns || opts.includeMeasures) {
    const snapshot = await snapshotModel(folderPath, model);
    const tables = tableInventory(snapshot.model, opts);
    return {
      mode: snapshot.mode,
      tables,
      ...(snapshot.mode === 'live' && tables.length === 0
        ? {
            diagnostics: liveDiscoveryDiagnostics({
              reason: 'live-table-inventory-empty',
              mode: snapshot.mode,
              connection: snapshot.connection,
              modelSelector: model,
              model: snapshot.model,
            }),
          }
        : {}),
    };
  }

  if (folderPath) {
    const drv = getModelDriver();
    if (await hasLiveModelCandidate(drv)) {
      const conn = await drv.ensureConnection(resolveLivePreferredConnectOpts(folderPath, model));
      if (conn.mode === 'live') {
        const tables = await drv.listTableInventoryRaw(conn);
        return {
          mode: 'live',
          tables,
          ...(tables.length === 0
            ? {
                diagnostics: liveDiscoveryDiagnostics({
                  reason: 'live-table-inventory-empty',
                  mode: 'live',
                  connection: conn,
                  modelSelector: model,
                  tables,
                }),
              }
            : {}),
        };
      }
    }
    const resolvedFolderPath = resolveSemanticModelDefinition(folderPath);
    return { mode: 'folder', tables: tableInventory(parseTMDLFolder(resolvedFolderPath)) };
  }

  const drv = getModelDriver();
  const conn = await connectModel(drv, folderPath, model);
  if (conn.mode === 'live') {
    const tables = await drv.listTableInventoryRaw(conn);
    return {
      mode: 'live',
      tables,
      ...(tables.length === 0
        ? {
            diagnostics: liveDiscoveryDiagnostics({
              reason: 'live-table-inventory-empty',
              mode: 'live',
              connection: conn,
              modelSelector: model,
              tables,
            }),
          }
        : {}),
    };
  }
  return { mode: 'folder', tables: tableInventory(parseTMDLFolder(conn.folderPath as string)) };
}

interface StarSchemaJoinPlannerOptions {
  readonly leftTable: string;
  readonly rightTable: string;
  readonly axes?: ReadonlyArray<string>;
}

interface ActualsTargetsJoinPlannerInput extends StarSchemaJoinPlannerOptions {
  readonly dateRefs?: ReadonlyArray<{
    readonly tableName: string;
    readonly dateColumn: string;
  }>;
  readonly dateTable?: string;
  readonly dateColumn?: string;
  readonly futureHorizonDays?: number;
  readonly probeData?: boolean;
  readonly folderPath?: string;
  readonly model?: string;
}

interface StarSchemaJoinApplyInput extends StarSchemaJoinPlannerOptions {
  readonly axes: ReadonlyArray<string>;
  readonly dryRun?: boolean;
  readonly refreshAfterCreate?: boolean;
  readonly runModelCheck?: boolean;
  readonly folderPath?: string;
  readonly model?: string;
}

interface DateGrainPlannerInput {
  readonly facts: ReadonlyArray<{
    readonly tableName: string;
    readonly dateColumn: string;
  }>;
  readonly dateTable?: string;
  readonly dateColumn?: string;
  readonly futureHorizonDays?: number;
  readonly probeData?: boolean;
  readonly scanMeasures?: boolean;
  readonly folderPath?: string;
  readonly model?: string;
}

interface DateTablePlannerInput {
  readonly dateTable: string;
  readonly dateColumn: string;
  readonly facts: ReadonlyArray<{
    readonly tableName: string;
    readonly dateColumn: string;
  }>;
  readonly futureHorizonDays?: number;
  readonly probeData?: boolean;
  readonly folderPath?: string;
  readonly model?: string;
}

type GovernedDateRangePolicy =
  | 'observed-min-max'
  | 'observed-full-years'
  | 'observed-min-max-plus-future-horizon'
  | 'observed-full-years-plus-future-horizon';

interface GovernedDateTableCreateInput {
  readonly tableName: string;
  readonly dateColumn: string;
  readonly facts: ReadonlyArray<{
    readonly tableName: string;
    readonly dateColumn: string;
  }>;
  readonly rangePolicy?: GovernedDateRangePolicy;
  readonly futureHorizonDays?: number;
  readonly refreshBeforeProbe?: boolean;
  readonly createRelationships?: boolean;
  readonly description?: string;
  readonly folderPath?: string;
  readonly model?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStarSchemaPlan(plan: unknown): Record<string, unknown> {
  if (!isRecord(plan)) {
    return {
      design: 'star-schema-shared-dimension',
      blockers: [],
      proposedDimensions: [],
      relationshipWrites: [],
      relationshipRepairWrites: [],
      hideFkWrites: [],
      keyColumnWrites: [],
      directFactRelationshipAllowed: false,
      value: plan,
    };
  }

  const axisPlans = Array.isArray(plan.plans) ? plan.plans.filter(isRecord) : [];
  const sanitizedAxisPlans = axisPlans.map((axisPlan) => {
    const axisWritePlan = Array.isArray(axisPlan.writePlan)
      ? axisPlan.writePlan.filter(isRecord)
      : [];
    const hasExecutableCreateTable = axisWritePlan.some(
      (item) => item.action === 'create-calculated-table',
    );
    if (hasExecutableCreateTable || typeof axisPlan.daxExpression !== 'string') return axisPlan;
    const { daxExpression: _daxExpression, ...safeAxisPlan } = axisPlan;
    return safeAxisPlan;
  });
  const proposedDimensions =
    Array.isArray(plan.proposedDimensions) || sanitizedAxisPlans.length === 0
      ? plan.proposedDimensions
      : sanitizedAxisPlans.flatMap((axisPlan) => {
          const axisWritePlan = Array.isArray(axisPlan.writePlan)
            ? axisPlan.writePlan.filter(isRecord)
            : [];
          if (axisWritePlan.length === 0) return [];
          const createTable = axisWritePlan.find(
            (item) => item.action === 'create-calculated-table',
          );
          return [
            {
              name: axisPlan.proposedDimensionTableName,
              axis: axisPlan.axis,
              source: axisPlan.source,
              sourceTables: [axisPlan.leftTable, axisPlan.rightTable],
              ...(isRecord(createTable) && typeof createTable.expression === 'string'
                ? {
                    createTableWrite: {
                      name: createTable.tableName ?? axisPlan.proposedDimensionTableName,
                      expression: createTable.expression,
                    },
                  }
                : {}),
            },
          ];
        });

  const writePlanItems = axisPlans.flatMap((axisPlan) =>
    Array.isArray(axisPlan.writePlan) ? axisPlan.writePlan.filter(isRecord) : [],
  );
  const relationshipWrites =
    Array.isArray(plan.relationshipWrites) || writePlanItems.length === 0
      ? plan.relationshipWrites
      : writePlanItems
          .filter((item) => item.action === 'create-relationships')
          .flatMap((item) => (Array.isArray(item.relationships) ? item.relationships : []));
  const relationshipRepairWrites =
    Array.isArray(plan.relationshipRepairWrites) || writePlanItems.length === 0
      ? plan.relationshipRepairWrites
      : writePlanItems
          .filter((item) => item.action === 'repair-relationships')
          .flatMap((item) => (Array.isArray(item.relationships) ? item.relationships : []));
  const hideFkWrites =
    Array.isArray(plan.hideFkWrites) || writePlanItems.length === 0
      ? plan.hideFkWrites
      : writePlanItems
          .filter((item) => item.action === 'hide-source-columns')
          .flatMap((item) =>
            Array.isArray(item.columns)
              ? item.columns.filter(isRecord).map((column) => ({
                  tableName: column.table,
                  name: column.column,
                  isHidden: true,
                }))
              : [],
          );
  const keyColumnWrites =
    Array.isArray(plan.keyColumnWrites) || writePlanItems.length === 0
      ? plan.keyColumnWrites
      : writePlanItems
          .filter((item) => item.action === 'configure-dimension-key')
          .map((item) => ({
            tableName: item.tableName,
            name: item.columnName,
            summarizeBy: item.summarizeBy,
            isKey: item.isKey,
          }));

  return {
    ...plan,
    plans: sanitizedAxisPlans,
    proposedDimensions: proposedDimensions ?? [],
    relationshipWrites: relationshipWrites ?? [],
    relationshipRepairWrites: relationshipRepairWrites ?? [],
    hideFkWrites: hideFkWrites ?? [],
    keyColumnWrites: keyColumnWrites ?? [],
    directFactRelationshipAllowed: false,
  };
}

function planStarSchemaJoin(model: TMDLModel, opts: StarSchemaJoinPlannerOptions): unknown {
  const plan = planStarSchemaSharedDimensions(model, opts.leftTable, opts.rightTable, {
    axes: opts.axes,
  });
  const normalized = normalizeStarSchemaPlan(plan);
  const dateAxisRequirement = sharedTemporalDateAxisRequirement(model, opts);
  return {
    ...normalized,
    ...(dateAxisRequirement ? { dateAxisRequirement } : {}),
  };
}

function dedupeStrings(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function routeActualsTargetsAxes(
  model: TMDLModel,
  input: Pick<ActualsTargetsJoinPlannerInput, 'leftTable' | 'rightTable' | 'axes'>,
): {
  readonly dimensionAxes: ReadonlyArray<string>;
  readonly temporalAxes: ReadonlyArray<string>;
  readonly sharedTemporalAxes: ReadonlyArray<string>;
} {
  const left = model.tables.find((table) => table.name === input.leftTable);
  const right = model.tables.find((table) => table.name === input.rightTable);
  if (!left || !right) {
    return {
      dimensionAxes: input.axes ?? [],
      temporalAxes: [],
      sharedTemporalAxes: [],
    };
  }

  const rightColumnNames = new Set(right.columns.map((column) => column.name));
  const sharedAxes = dedupeStrings(
    left.columns.map((column) => column.name).filter((name) => rightColumnNames.has(name)),
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const candidates = input.axes ? dedupeStrings(input.axes) : sharedAxes;
  const dimensionAxes: string[] = [];
  const temporalAxes: string[] = [];
  const sharedTemporalAxes: string[] = [];

  for (const axis of sharedAxes) {
    const leftColumn = left.columns.find((column) => column.name === axis);
    const rightColumn = right.columns.find((column) => column.name === axis);
    if (
      leftColumn &&
      rightColumn &&
      isTemporalDataType(leftColumn.dataType) &&
      isTemporalDataType(rightColumn.dataType)
    ) {
      sharedTemporalAxes.push(axis);
    }
  }

  for (const axis of candidates) {
    const leftColumn = left.columns.find((column) => column.name === axis);
    const rightColumn = right.columns.find((column) => column.name === axis);
    if (
      leftColumn &&
      rightColumn &&
      isTemporalDataType(leftColumn.dataType) &&
      isTemporalDataType(rightColumn.dataType)
    ) {
      temporalAxes.push(axis);
    } else {
      dimensionAxes.push(axis);
    }
  }

  return { dimensionAxes, temporalAxes, sharedTemporalAxes };
}

function syntheticStarSchemaPlan(
  leftTable: string,
  rightTable: string,
  reason: string,
): Record<string, unknown> {
  return {
    design: 'star-schema-shared-dimension',
    directFactRelationshipAllowed: false,
    leftTable,
    rightTable,
    plans: [],
    blockers: [],
    proposedDimensions: [],
    relationshipWrites: [],
    relationshipRepairWrites: [],
    hideFkWrites: [],
    keyColumnWrites: [],
    reason,
  };
}

function dedupeDateRefs(
  refs: ReadonlyArray<{ readonly tableName: string; readonly dateColumn: string }>,
): Array<{ readonly tableName: string; readonly dateColumn: string }> {
  const seen = new Set<string>();
  const out: Array<{ readonly tableName: string; readonly dateColumn: string }> = [];
  for (const ref of refs) {
    const key = `${ref.tableName}\u0000${ref.dateColumn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tableName: ref.tableName, dateColumn: ref.dateColumn });
  }
  return out;
}

function discoverDateRefsForTables(
  input: Pick<ActualsTargetsJoinPlannerInput, 'leftTable' | 'rightTable'>,
  temporalAxes: ReadonlyArray<string>,
): Array<{ readonly tableName: string; readonly dateColumn: string }> {
  return dedupeDateRefs(
    temporalAxes.flatMap((axis) => [
      { tableName: input.leftTable, dateColumn: axis },
      { tableName: input.rightTable, dateColumn: axis },
    ]),
  );
}

function actualsTargetsRemainingBusinessQuestions(): ReadonlyArray<Record<string, unknown>> {
  return [
    {
      topic: 'allocation-or-missing-target-behavior',
      reason:
        'Date grain and shared axes are observable from metadata/proof; allocation, carry-forward, blank/zero handling, and missing-target behavior are business policy.',
    },
  ];
}

const GOVERNED_DATE_AXIS_REQUIRED_REASON =
  'Cross-fact modeling with temporal axes requires one governed Date table shared by every participating fact. Auto LocalDateTable relationships are per-column implementation details and do not provide a conformed report axis.';

function governedDateAxisRequirement(
  model: TMDLModel,
  input: {
    readonly dateRefs: ReadonlyArray<{ readonly tableName: string; readonly dateColumn: string }>;
    readonly temporalAxes?: ReadonlyArray<string>;
    readonly effectiveDateEndpoint?: {
      readonly dateTable: string;
      readonly dateColumn: string;
      readonly source: string;
    };
  },
): Record<string, unknown> | undefined {
  const dateRefs = dedupeDateRefs(input.dateRefs);
  if (dateRefs.length === 0) return undefined;
  const temporalAxes = dedupeStrings(input.temporalAxes ?? []);
  const inferredEndpoint =
    input.effectiveDateEndpoint === undefined
      ? inferCommonGovernedDateEndpoint(model, dateRefs)
      : undefined;
  const endpoint =
    input.effectiveDateEndpoint ??
    (inferredEndpoint
      ? {
          ...inferredEndpoint,
          source: 'existing-governed-relationships',
        }
      : undefined);

  if (endpoint) {
    return {
      status: 'governed-date-table-present',
      dateTable: endpoint.dateTable,
      dateColumn: endpoint.dateColumn,
      source: endpoint.source,
      ...(temporalAxes.length > 0 ? { temporalAxes } : {}),
      dateRefs,
    };
  }

  return {
    status: 'governed-date-table-required',
    reason: GOVERNED_DATE_AXIS_REQUIRED_REASON,
    suggestedTool: 'pbi_date_table_create_governed',
    suggestedPlanTools: ['pbi_model_plan_date_table', 'pbi_model_plan_date_grain'],
    ...(temporalAxes.length > 0 ? { temporalAxes } : {}),
    dateRefs,
  };
}

function sharedTemporalDateAxisRequirement(
  model: TMDLModel,
  input: Pick<StarSchemaJoinPlannerOptions, 'leftTable' | 'rightTable' | 'axes'>,
): Record<string, unknown> | undefined {
  const axisRouting = routeActualsTargetsAxes(model, input);
  const temporalAxes =
    axisRouting.temporalAxes.length > 0 ? axisRouting.temporalAxes : axisRouting.sharedTemporalAxes;
  if (temporalAxes.length === 0) return undefined;
  return governedDateAxisRequirement(model, {
    temporalAxes,
    dateRefs: discoverDateRefsForTables(input, temporalAxes),
  });
}

function relationshipDateEndpointForFactRef(
  relationship: TMDLRelationship,
  ref: { readonly tableName: string; readonly dateColumn: string },
): { readonly tableName: string; readonly dateColumn: string } | undefined {
  if (relationship.fromTable === ref.tableName && relationship.fromColumn === ref.dateColumn) {
    return { tableName: relationship.toTable, dateColumn: relationship.toColumn };
  }
  if (relationship.toTable === ref.tableName && relationship.toColumn === ref.dateColumn) {
    return { tableName: relationship.fromTable, dateColumn: relationship.fromColumn };
  }
  return undefined;
}

function inferCommonGovernedDateEndpoint(
  model: TMDLModel,
  dateRefs: ReadonlyArray<{ readonly tableName: string; readonly dateColumn: string }>,
): { readonly dateTable: string; readonly dateColumn: string } | undefined {
  let commonEndpoint: { readonly dateTable: string; readonly dateColumn: string } | undefined;
  for (const ref of dateRefs) {
    const endpoints = dedupeDateRefs(
      model.relationships
        .filter((relationship) => relationship.isActive === true)
        .map((relationship) => relationshipDateEndpointForFactRef(relationship, ref))
        .filter((endpoint): endpoint is { tableName: string; dateColumn: string } => {
          if (!endpoint) return false;
          // Mark-INDEPENDENT detection, consistent with the relationship/mark/coverage write
          // gates (looksLikeDateRelationshipEndpoint + markReadiness.ready). The dataCategory
          // "Time" mark is unobservable on a live Import read, so requiring it here made the
          // actuals/targets readiness planner fail to recognize a real, fact-related, non-auto
          // Date table — steering the agent to recreate/re-mark a table that is already the
          // de-facto governed axis. A non-auto temporal column to which every participating
          // fact has an active relationship IS that axis; the live coverage/grain proof that
          // runs next in planActualsTargetsJoin enforces the actual data-cleanliness safety,
          // and auto LocalDateTables are still excluded.
          return looksLikeDateRelationshipEndpoint(model, endpoint.tableName, endpoint.dateColumn);
        }),
    );
    if (endpoints.length !== 1) return undefined;
    const endpoint = endpoints[0];
    if (!endpoint) return undefined;
    if (!commonEndpoint) {
      commonEndpoint = {
        dateTable: endpoint.tableName,
        dateColumn: endpoint.dateColumn,
      };
      continue;
    }
    if (
      commonEndpoint.dateTable !== endpoint.tableName ||
      commonEndpoint.dateColumn !== endpoint.dateColumn
    ) {
      return undefined;
    }
  }
  return commonEndpoint;
}

function sourceBlockers(source: string, blockers: ReadonlyArray<Record<string, unknown>>) {
  return blockers.map((blocker) => ({ source, ...blocker }));
}

async function planActualsTargetsJoin(
  input: ActualsTargetsJoinPlannerInput,
): Promise<Record<string, unknown>> {
  const { mode, model } = await snapshotModel(input.folderPath, input.model, {
    includeMeasures: false,
    includeRoles: false,
  });
  const axisRouting = routeActualsTargetsAxes(model, input);
  const starSchemaPlan =
    axisRouting.dimensionAxes.length > 0
      ? (planStarSchemaJoin(model, {
          leftTable: input.leftTable,
          rightTable: input.rightTable,
          axes: axisRouting.dimensionAxes,
        }) as Record<string, unknown>)
      : syntheticStarSchemaPlan(
          input.leftTable,
          input.rightTable,
          'No non-temporal shared axes require shared-dimension planning.',
        );

  const dateRefs =
    input.dateRefs && input.dateRefs.length > 0
      ? dedupeDateRefs(input.dateRefs)
      : discoverDateRefsForTables(
          input,
          axisRouting.temporalAxes.length > 0
            ? axisRouting.temporalAxes
            : axisRouting.sharedTemporalAxes,
        );
  const explicitDateEndpoint =
    input.dateTable && input.dateColumn
      ? {
          dateTable: input.dateTable,
          dateColumn: input.dateColumn,
          source: 'input' as const,
        }
      : undefined;
  const partialDateEndpointSupplied =
    (input.dateTable !== undefined && input.dateColumn === undefined) ||
    (input.dateTable === undefined && input.dateColumn !== undefined);
  const inferredDateEndpoint =
    explicitDateEndpoint === undefined && dateRefs.length > 0
      ? inferCommonGovernedDateEndpoint(model, dateRefs)
      : undefined;
  const effectiveDateEndpoint =
    explicitDateEndpoint ??
    (inferredDateEndpoint
      ? {
          ...inferredDateEndpoint,
          source: 'existing-governed-relationships' as const,
        }
      : undefined);
  const starBlockers = records(starSchemaPlan.blockers);
  const requiredInputs: Record<string, unknown>[] = [];
  let dateGrainPlan: Record<string, unknown> = {
    probeStatus: {
      status: 'not-run',
      reason:
        'No shared temporal columns were discovered. Provide dateRefs to run deterministic date-grain proof.',
    },
    facts: [],
    blockers: [
      {
        code: 'date-refs-required',
        message:
          'No shared temporal columns were discovered between the requested tables. Pass explicit dateRefs for the actual/target date columns.',
      },
    ],
  };

  if (dateRefs.length === 0) {
    requiredInputs.push({
      topic: 'date-refs',
      reason:
        'The model metadata did not expose a same-name temporal column on both tables. This is a date role selection, not a grain question.',
    });
  } else {
    if (partialDateEndpointSupplied) {
      requiredInputs.push({
        topic: 'governed-date-table',
        reason:
          'Both dateTable and dateColumn are required to validate a governed shared Date axis for actuals/targets joins.',
        dateTable: input.dateTable,
        dateColumn: input.dateColumn,
      });
    } else if (!effectiveDateEndpoint) {
      requiredInputs.push({
        topic: 'governed-date-table',
        reason: GOVERNED_DATE_AXIS_REQUIRED_REASON,
        suggestedTool: 'pbi_date_table_create_governed',
        dateRefs,
      });
    }
    const datePayload = await planDateGrainForRead({
      facts: dateRefs,
      dateTable: effectiveDateEndpoint?.dateTable,
      dateColumn: effectiveDateEndpoint?.dateColumn,
      futureHorizonDays: input.futureHorizonDays,
      probeData: input.probeData,
      folderPath: input.folderPath,
      model: input.model,
    });
    const datePlan = isRecord(datePayload.plan) ? datePayload.plan : {};
    dateGrainPlan = {
      probeStatus: datePayload.probeStatus,
      facts: Array.isArray(datePlan.facts) ? datePlan.facts : [],
      blockers: Array.isArray(datePlan.blockers) ? datePlan.blockers : [],
      ...(Array.isArray(datePlan.autoDateTables)
        ? { autoDateTables: datePlan.autoDateTables }
        : {}),
      ...(datePlan.dateTableCoverage !== undefined
        ? { dateTableCoverage: datePlan.dateTableCoverage }
        : {}),
    };
  }

  if (input.dateRefs === undefined && axisRouting.sharedTemporalAxes.length > 1) {
    requiredInputs.push({
      topic: 'date-role',
      reason:
        'Multiple shared temporal columns were discovered. The tool proved grain for the discovered candidates, but the active actuals/targets date role is business semantics.',
      candidates: axisRouting.sharedTemporalAxes,
    });
  }

  const dateBlockers = records(dateGrainPlan.blockers);
  const dateTableCoverage = isRecord(dateGrainPlan.dateTableCoverage)
    ? dateGrainPlan.dateTableCoverage
    : undefined;
  const rawDateTableCoverageBlockers = dateTableCoverage ? records(dateTableCoverage.blockers) : [];
  // Key off markReadiness.ready (data-proven-key aware), NOT coverage.status, exactly like
  // enforceMarkAsDateGate (server.ts), enforceDateRelationshipWriteGate, and buildWritePlan.
  // coverage.status is "blocked" purely because of the cosmetic date-table-not-marked /
  // date-column-not-key blockers when an Import mark no-ops (or is unobservable), even though
  // the key is fully data-proven and the table is usable. Using status here re-blocked this
  // read-only readiness planner for a clean, data-proven, unmarked, source-less Import Date
  // table and steered the agent to recreate/re-mark it — the same deadlock the write gates
  // already removed. markReadiness.blockingForMark drops the two cosmetic premark codes when
  // the key is proven from data while keeping every real proof blocker (blanks/dups/gaps/
  // time/coverage/source-risk/end-after-fact-max).
  const coverageMarkReadiness = isRecord(dateTableCoverage?.markReadiness)
    ? dateTableCoverage.markReadiness
    : undefined;
  const coverageReady = coverageMarkReadiness?.ready === true;
  const blockingForMark = coverageMarkReadiness
    ? records(coverageMarkReadiness.blockingForMark)
    : rawDateTableCoverageBlockers;
  const dateTableCoverageBlockers =
    dateTableCoverage && !coverageReady
      ? blockingForMark.length > 0
        ? blockingForMark
        : [
            {
              code: 'date-table-coverage-not-valid',
              status: dateTableCoverage.status,
              message:
                'The governed Date table coverage proof did not return valid coverage for the actuals/targets date refs.',
            },
          ]
      : [];
  // Relay the non-blocking calendar-source caveat (unreadable Import source) so the agent
  // surfaces an honest warning instead of a refusal.
  const dateTableCoverageWarnings = dateTableCoverage
    ? records(dateTableCoverage.warnings).map((warning) => String(warning.message ?? ''))
    : [];
  const blockers = [
    ...sourceBlockers('star-schema', starBlockers),
    ...sourceBlockers('date-grain', dateBlockers),
    ...sourceBlockers('date-table', dateTableCoverageBlockers),
  ];
  const probeStatus = isRecord(dateGrainPlan.probeStatus) ? dateGrainPlan.probeStatus : {};
  const status =
    blockers.length > 0
      ? 'blocked'
      : requiredInputs.length > 0
        ? 'needs-user-input'
        : probeStatus.status === 'succeeded'
          ? 'ready'
          : 'proof-incomplete';

  return {
    status,
    mode,
    leftTable: input.leftTable,
    rightTable: input.rightTable,
    dimensionAxes: axisRouting.dimensionAxes,
    routedTemporalAxes:
      axisRouting.temporalAxes.length > 0
        ? axisRouting.temporalAxes
        : axisRouting.sharedTemporalAxes,
    dateRefs,
    ...(dateRefs.length > 0
      ? {
          dateAxisRequirement: effectiveDateEndpoint
            ? governedDateAxisRequirement(model, {
                dateRefs,
                temporalAxes:
                  axisRouting.temporalAxes.length > 0
                    ? axisRouting.temporalAxes
                    : axisRouting.sharedTemporalAxes,
                effectiveDateEndpoint,
              })
            : governedDateAxisRequirement(model, {
                dateRefs,
                temporalAxes:
                  axisRouting.temporalAxes.length > 0
                    ? axisRouting.temporalAxes
                    : axisRouting.sharedTemporalAxes,
              }),
        }
      : {}),
    starSchemaPlan,
    dateGrainPlan,
    remainingBusinessQuestions: actualsTargetsRemainingBusinessQuestions(),
    ...(blockers.length > 0 ? { blockers } : {}),
    ...(dateTableCoverageWarnings.length > 0
      ? { dateTableWarnings: dateTableCoverageWarnings }
      : {}),
    ...(requiredInputs.length > 0 ? { requiredInputs } : {}),
  };
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function dateAxisRequirementFromPlan(
  plan: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return isRecord(plan.dateAxisRequirement) ? plan.dateAxisRequirement : undefined;
}

function unresolvedDateAxisRequirement(
  plan: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const requirement = dateAxisRequirementFromPlan(plan);
  return requirement?.status === 'governed-date-table-required' ? requirement : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function boolField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function requiredStringField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = stringField(record, key);
  if (value) return value;
  throwInputValidationError(`Star-schema apply refused: missing ${context}.${key}.`, {
    gate: 'star-schema-apply',
    reason: 'invalid-planner-write',
    context,
    record,
  });
}

function planHasBlockers(plan: Record<string, unknown>): boolean {
  return records(plan.blockers).length > 0;
}

function assertExecutableStarSchemaPlan(plan: Record<string, unknown>): void {
  if (plan.design !== 'star-schema-shared-dimension') {
    throwInputValidationError(
      'Star-schema apply refused: planner did not return star-schema design.',
      {
        gate: 'star-schema-apply',
        reason: 'unexpected-design',
        design: plan.design,
        plan,
      },
    );
  }
  if (plan.directFactRelationshipAllowed !== false) {
    throwInputValidationError(
      'Star-schema apply refused: direct fact relationships are not an executable design.',
      {
        gate: 'star-schema-apply',
        reason: 'direct-fact-relationship-not-allowed',
        plan,
      },
    );
  }
  if (planHasBlockers(plan)) {
    throwInputValidationError('Star-schema apply refused: planner returned blockers.', {
      gate: 'star-schema-apply',
      reason: 'planner-blockers',
      blockers: plan.blockers,
      plan,
    });
  }
}

function assertExplicitStarSchemaApplyAxes(axes: ReadonlyArray<string>): void {
  const normalized = axes.map((axis) => axis.trim());
  if (normalized.length === 0 || normalized.some((axis) => axis.length === 0)) {
    throwInputValidationError(
      'Star-schema apply refused: pass explicit non-empty axes for write workflows.',
      {
        gate: 'star-schema-apply',
        reason: 'missing-explicit-axes',
        axes,
      },
    );
  }
  const seen = new Set<string>();
  const duplicate = normalized.find((axis) => {
    if (seen.has(axis)) return true;
    seen.add(axis);
    return false;
  });
  if (duplicate) {
    throwInputValidationError('Star-schema apply refused: duplicate axes are not allowed.', {
      gate: 'star-schema-apply',
      reason: 'duplicate-axis',
      axis: duplicate,
      axes,
    });
  }
}

function proposedDimensionCreateWrites(
  plan: Record<string, unknown>,
): Array<{ name: string; expression: string }> {
  return records(plan.proposedDimensions).flatMap((dimension) => {
    const createTableWrite = dimension.createTableWrite;
    if (!isRecord(createTableWrite)) return [];
    return [
      {
        name: requiredStringField(createTableWrite, 'name', 'createTableWrite'),
        expression: requiredStringField(createTableWrite, 'expression', 'createTableWrite'),
      },
    ];
  });
}

function keyColumnWrites(plan: Record<string, unknown>): ColumnUpdate[] {
  return records(plan.keyColumnWrites).map((write) => ({
    tableName: requiredStringField(write, 'tableName', 'keyColumnWrite'),
    name: requiredStringField(write, 'name', 'keyColumnWrite'),
    summarizeBy: stringField(write, 'summarizeBy') ?? 'none',
    isKey: boolField(write, 'isKey') ?? true,
  }));
}

function hideFkWrites(plan: Record<string, unknown>): ColumnUpdate[] {
  return records(plan.hideFkWrites).map((write) => ({
    tableName: requiredStringField(write, 'tableName', 'hideFkWrite'),
    name: requiredStringField(write, 'name', 'hideFkWrite'),
    isHidden: true,
  }));
}

function relationshipCreateWrites(plan: Record<string, unknown>) {
  return records(plan.relationshipWrites).map((write) => ({
    fromTable: requiredStringField(write, 'fromTable', 'relationshipWrite'),
    fromColumn: requiredStringField(write, 'fromColumn', 'relationshipWrite'),
    toTable: requiredStringField(write, 'toTable', 'relationshipWrite'),
    toColumn: requiredStringField(write, 'toColumn', 'relationshipWrite'),
    cardinality: 'manyToOne' as const,
    crossFilteringBehavior: 'single' as const,
    isActive: true,
  }));
}

function relationshipRepairWrites(plan: Record<string, unknown>) {
  return records(plan.relationshipRepairWrites).map((write) => ({
    id: requiredStringField(write, 'id', 'relationshipRepairWrite'),
    fromTable: requiredStringField(write, 'fromTable', 'relationshipRepairWrite'),
    fromColumn: requiredStringField(write, 'fromColumn', 'relationshipRepairWrite'),
    toTable: requiredStringField(write, 'toTable', 'relationshipRepairWrite'),
    toColumn: requiredStringField(write, 'toColumn', 'relationshipRepairWrite'),
    cardinality: 'manyToOne' as const,
    crossFilteringBehavior: 'single' as const,
    isActive: true,
  }));
}

function plannedStarSchemaOperations(
  createTableWrites: ReadonlyArray<{ readonly name: string; readonly expression: string }>,
  keyWrites: ReadonlyArray<ColumnUpdate>,
  repairWrites: ReturnType<typeof relationshipRepairWrites>,
  createRelationshipWrites: ReturnType<typeof relationshipCreateWrites>,
  sourceHideWrites: ReadonlyArray<ColumnUpdate>,
  refreshAfterCreate: boolean,
): Array<Record<string, unknown>> {
  return [
    ...createTableWrites.map((write) => ({
      action: 'create-calculated-table',
      tableName: write.name,
    })),
    ...(refreshAfterCreate && createTableWrites.length > 0
      ? [{ action: 'refresh-model', refreshType: 'Calculate' }]
      : []),
    ...keyWrites.map((write) => ({
      action: 'configure-dimension-key',
      tableName: write.tableName,
      columnName: write.name,
      ...(write.dataType !== undefined ? { dataType: write.dataType } : {}),
    })),
    ...repairWrites.map((write) => ({
      action: 'repair-relationship',
      relationshipId: write.id,
    })),
    ...createRelationshipWrites.map((write) => ({
      action: 'create-relationship',
      fromTable: write.fromTable,
      fromColumn: write.fromColumn,
      toTable: write.toTable,
      toColumn: write.toColumn,
    })),
    ...sourceHideWrites.map((write) => ({
      action: 'hide-source-column',
      tableName: write.tableName,
      columnName: write.name,
    })),
  ];
}

function inferStarDimensionKeyDataTypes(
  model: TMDLModel,
  plan: Record<string, unknown>,
): Map<string, string> {
  const tableByName = new Map(model.tables.map((table) => [table.name, table]));
  const out = new Map<string, string>();
  for (const axisPlan of records(plan.plans)) {
    if (axisPlan.source !== 'new-calculated-table') continue;
    const axis = stringField(axisPlan, 'axis');
    const leftTable = stringField(axisPlan, 'leftTable');
    const rightTable = stringField(axisPlan, 'rightTable');
    const dimensionTable = stringField(axisPlan, 'proposedDimensionTableName');
    const dimensionKeyColumn = stringField(axisPlan, 'dimensionKeyColumn') ?? axis;
    if (!axis || !leftTable || !rightTable || !dimensionTable || !dimensionKeyColumn) continue;
    const leftColumn = tableByName.get(leftTable)?.columns.find((column) => column.name === axis);
    const rightColumn = tableByName.get(rightTable)?.columns.find((column) => column.name === axis);
    const dataType = commonStarDimensionKeyDataType(leftColumn?.dataType, rightColumn?.dataType);
    if (!dataType) continue;
    out.set(`${dimensionTable}\u0000${dimensionKeyColumn}`, dataType);
  }
  return out;
}

function commonStarDimensionKeyDataType(
  leftDataType: string | undefined,
  rightDataType: string | undefined,
): string | undefined {
  if (!leftDataType || !rightDataType) return undefined;
  const left = normalizeDataType(leftDataType);
  const right = normalizeDataType(rightDataType);
  if (left === right) return leftDataType;
  if (isNumericType(left) && isNumericType(right)) {
    if (left === 'double' || right === 'double') return 'double';
    if (left === 'decimal' || right === 'decimal') return 'decimal';
    return 'int64';
  }
  return undefined;
}

function withDimensionKeyDataTypes(
  writes: ReadonlyArray<ColumnUpdate>,
  dataTypes: Map<string, string>,
): ColumnUpdate[] {
  return writes.map((write) => ({
    ...write,
    dataType: dataTypes.get(`${write.tableName}\u0000${write.name}`),
  }));
}

function normalizeDaxForComparison(expression: string | undefined): string | undefined {
  return expression?.replace(/\s+/g, ' ').trim().toLowerCase();
}

function tableExpressionForComparison(table: {
  readonly expression?: string;
  readonly partitionSources?: ReadonlyArray<{ readonly expression: string }>;
}): string | undefined {
  return normalizeDaxForComparison(
    table.expression ?? table.partitionSources?.find((source) => source.expression)?.expression,
  );
}

function assertNoPartialStarSchemaDimensionArtifact(
  model: TMDLModel,
  plan: Record<string, unknown>,
  createTableWrites: ReadonlyArray<{ readonly name: string; readonly expression: string }>,
): void {
  for (const axisPlan of records(plan.plans)) {
    if (axisPlan.source !== 'new-calculated-table') continue;
    const axis = stringField(axisPlan, 'axis');
    const plannedTable = stringField(axisPlan, 'proposedDimensionTableName');
    if (!axis || !plannedTable) continue;
    const existingAxisTable = model.tables.find(
      (table) =>
        table.name !== plannedTable &&
        table.name === axis &&
        table.columns.some((column) => column.name === axis),
    );
    if (!existingAxisTable) continue;
    throwInputValidationError(
      'Star-schema apply refused: a planned generated dimension table already exists but is not covered by the planner output.',
      {
        gate: 'star-schema-apply',
        reason: 'partial-generated-dimension-artifact',
        existingTable: existingAxisTable.name,
        plannedTable,
        axis,
      },
    );
  }
  for (const write of createTableWrites) {
    const existingSameName = model.tables.find((table) => table.name === write.name);
    if (existingSameName) {
      throwInputValidationError(
        'Star-schema apply refused: a planned generated dimension table already exists but is not covered by the planner output.',
        {
          gate: 'star-schema-apply',
          reason: 'partial-generated-dimension-artifact',
          existingTable: existingSameName.name,
          plannedTable: write.name,
        },
      );
    }
    const plannedExpression = normalizeDaxForComparison(write.expression);
    if (!plannedExpression) continue;
    const existing = model.tables.find(
      (table) =>
        table.name !== write.name && tableExpressionForComparison(table) === plannedExpression,
    );
    if (!existing) continue;
    throwInputValidationError(
      'Star-schema apply refused: a matching generated dimension table already exists but is not covered by the planner output.',
      {
        gate: 'star-schema-apply',
        reason: 'partial-generated-dimension-artifact',
        existingTable: existing.name,
        plannedTable: write.name,
      },
    );
  }
}

function findStarSchemaModelColumn(model: TMDLModel, tableName: string, columnName: string) {
  return model.tables
    .find((table) => table.name === tableName)
    ?.columns.find((column) => column.name === columnName);
}

function relationshipMatches(
  existing: TMDLRelationship,
  planned: {
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly toTable: string;
    readonly toColumn: string;
  },
): boolean {
  return (
    existing.fromTable === planned.fromTable &&
    existing.fromColumn === planned.fromColumn &&
    existing.toTable === planned.toTable &&
    existing.toColumn === planned.toColumn &&
    existing.isActive === true &&
    existing.crossFilteringBehavior === 'single' &&
    existing.cardinality === 'manyToOne'
  );
}

function validateAppliedStarSchemaPlan(
  finalModel: TMDLModel,
  plan: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const failures: Array<Record<string, unknown>> = [];
  for (const write of keyColumnWrites(plan)) {
    const column = findStarSchemaModelColumn(finalModel, write.tableName, write.name);
    if (!column) {
      failures.push({
        code: 'missing-dimension-key-column',
        tableName: write.tableName,
        columnName: write.name,
      });
      continue;
    }
    if (column.isKey !== true) {
      failures.push({
        code: 'dimension-key-not-marked',
        tableName: write.tableName,
        columnName: write.name,
      });
    }
    if (column.summarizeBy !== 'none') {
      failures.push({
        code:
          column.summarizeBy === undefined
            ? 'dimension-key-summarizeby-missing'
            : 'dimension-key-summarizes',
        tableName: write.tableName,
        columnName: write.name,
        summarizeBy: column.summarizeBy,
      });
    }
    if (!column.dataType || normalizeDataType(column.dataType) === 'unknown') {
      failures.push({
        code: 'dimension-key-data-type-missing',
        tableName: write.tableName,
        columnName: write.name,
      });
    }
  }
  for (const write of hideFkWrites(plan)) {
    const column = findStarSchemaModelColumn(finalModel, write.tableName, write.name);
    if (!column) {
      failures.push({
        code: 'missing-source-column',
        tableName: write.tableName,
        columnName: write.name,
      });
      continue;
    }
    if (column.isHidden !== true) {
      failures.push({
        code: 'source-column-still-visible',
        tableName: write.tableName,
        columnName: write.name,
      });
    }
  }
  for (const write of [...relationshipCreateWrites(plan), ...relationshipRepairWrites(plan)]) {
    if (
      !finalModel.relationships.some((relationship) => relationshipMatches(relationship, write))
    ) {
      failures.push({
        code: 'relationship-not-applied',
        fromTable: write.fromTable,
        fromColumn: write.fromColumn,
        toTable: write.toTable,
        toColumn: write.toColumn,
      });
    }
  }
  return failures;
}

async function gateStarSchemaCreateRelationshipWrite(
  drv: ModelDriver,
  connection: ConnectionInfo,
  write: ReturnType<typeof relationshipCreateWrites>[number],
): Promise<RelationshipReason[]> {
  const model = await readDriverSnapshot(
    drv,
    '(live)',
    { includeMeasures: true, includeRoles: false },
    connection,
  );
  const check = relationshipCheck(write, model);
  if (!check.valid) {
    throwInputValidationError('Star-schema apply refused: relationship create gate failed.', {
      gate: 'star-schema-apply',
      reason: 'relationship-create-gate-failed',
      write,
      blocking: check.blocking,
      warnings: check.warnings,
    });
  }
  const dateTableWarnings = await enforceDateRelationshipWriteGate(
    'live',
    model,
    connection,
    write,
    'create-date-relationship',
  );
  // Relay the non-blocking calendar-source caveat (unreadable Import source) as a warning
  // reason so star-schema apply surfaces it honestly instead of silently dropping it.
  return [
    ...check.warnings,
    ...dateTableWarnings.map((message) => ({ code: 'calendar-source-unproven', message })),
  ];
}

async function gateStarSchemaRepairRelationshipWrite(
  drv: ModelDriver,
  connection: ConnectionInfo,
  write: ReturnType<typeof relationshipRepairWrites>[number],
): Promise<RelationshipReason[]> {
  const model = await readDriverSnapshot(
    drv,
    '(live)',
    { includeMeasures: true, includeRoles: false },
    connection,
  );
  const existing = model.relationships.find((relationship) => relationship.id === write.id);
  if (!existing) {
    throwInputValidationError('Star-schema apply refused: relationship repair target is missing.', {
      gate: 'star-schema-apply',
      reason: 'relationship-repair-target-missing',
      relationshipId: write.id,
      write,
    });
  }
  enforceProvenRelationshipIdentity(existing, 'update');
  if (
    existing.fromTable !== write.fromTable ||
    existing.fromColumn !== write.fromColumn ||
    existing.toTable !== write.toTable ||
    existing.toColumn !== write.toColumn
  ) {
    throwInputValidationError(
      'Star-schema apply refused: relationship repair target changed since planning.',
      {
        gate: 'star-schema-apply',
        reason: 'relationship-repair-target-changed',
        relationshipId: write.id,
        expected: {
          fromTable: write.fromTable,
          fromColumn: write.fromColumn,
          toTable: write.toTable,
          toColumn: write.toColumn,
        },
        actual: {
          fromTable: existing.fromTable,
          fromColumn: existing.fromColumn,
          toTable: existing.toTable,
          toColumn: existing.toColumn,
        },
      },
    );
  }
  if (existing.cardinality !== write.cardinality) {
    throwInputValidationError(
      'Star-schema apply refused: relationship repair target changed since planning.',
      {
        gate: 'star-schema-apply',
        reason: 'relationship-repair-target-changed',
        relationshipId: write.id,
        expectedCardinality: write.cardinality,
        actualCardinality: existing.cardinality,
      },
    );
  }
  if (existing.isActive === true && existing.crossFilteringBehavior === 'single') {
    throwInputValidationError(
      'Star-schema apply refused: relationship repair target is no longer in a repairable state.',
      {
        gate: 'star-schema-apply',
        reason: 'relationship-repair-target-not-executable',
        relationshipId: write.id,
        actual: existing,
      },
    );
  }
  const check = relationshipCheck(write, model, { ignoreRelationshipId: write.id });
  if (!check.valid) {
    throwInputValidationError('Star-schema apply refused: relationship repair gate failed.', {
      gate: 'star-schema-apply',
      reason: 'relationship-repair-gate-failed',
      write,
      blocking: check.blocking,
      warnings: check.warnings,
    });
  }
  await enforceDateRelationshipWriteGate(
    'live',
    model,
    connection,
    {
      id: write.id,
      fromTable: write.fromTable,
      fromColumn: write.fromColumn,
      toTable: write.toTable,
      toColumn: write.toColumn,
      isActive: true,
      crossFilteringBehavior: write.crossFilteringBehavior,
    },
    'activate-date-relationship',
  );
  return [...check.warnings];
}

function modelWithStarSchemaSyntheticDimensions(
  model: TMDLModel,
  createTableWrites: ReadonlyArray<{ readonly name: string; readonly expression: string }>,
  keyWrites: ReadonlyArray<ColumnUpdate>,
): TMDLModel {
  const keyWritesByTable = new Map<string, ColumnUpdate[]>();
  for (const write of keyWrites) {
    const writes = keyWritesByTable.get(write.tableName) ?? [];
    writes.push(write);
    keyWritesByTable.set(write.tableName, writes);
  }

  const tables = model.tables.map((table) => ({
    ...table,
    columns: table.columns.map((column) => {
      const write = keyWrites
        .filter((candidate) => candidate.tableName === table.name)
        .find((candidate) => candidate.name === column.name);
      if (!write) return column;
      return {
        ...column,
        ...(write.dataType !== undefined ? { dataType: write.dataType } : {}),
        ...(write.summarizeBy !== undefined ? { summarizeBy: write.summarizeBy } : {}),
        ...(write.isKey !== undefined ? { isKey: write.isKey } : {}),
      };
    }),
  }));

  const existingTableNames = new Set(tables.map((table) => table.name));
  for (const write of createTableWrites) {
    if (existingTableNames.has(write.name)) continue;
    const plannedKeys = keyWritesByTable.get(write.name) ?? [];
    tables.push({
      name: write.name,
      columns: plannedKeys.map((keyWrite) => ({
        table: write.name,
        name: keyWrite.name,
        dataType: keyWrite.dataType ?? 'unknown',
        ...(keyWrite.summarizeBy !== undefined ? { summarizeBy: keyWrite.summarizeBy } : {}),
        isHidden: false,
        isKey: keyWrite.isKey === true,
        isCalculated: false,
      })),
      measures: [],
      isHidden: false,
      isCalculated: true,
      isAutoDateTable: false,
      expression: write.expression,
      partitionSources: [{ kind: 'calculated', expression: write.expression }],
    });
    existingTableNames.add(write.name);
  }

  return { ...model, tables };
}

function modelWithStarSchemaPreflightRelationship(
  model: TMDLModel,
  relationship:
    | ReturnType<typeof relationshipCreateWrites>[number]
    | ReturnType<typeof relationshipRepairWrites>[number],
): TMDLModel {
  const id =
    'id' in relationship
      ? relationship.id
      : `__preflight__:${relationship.fromTable}[${relationship.fromColumn}]->${relationship.toTable}[${relationship.toColumn}]`;
  return {
    ...model,
    relationships: [
      ...model.relationships.filter((existing) => existing.id !== id),
      {
        id,
        identityProven: true,
        fromTable: relationship.fromTable,
        fromColumn: relationship.fromColumn,
        toTable: relationship.toTable,
        toColumn: relationship.toColumn,
        isActive: relationship.isActive,
        crossFilteringBehavior: relationship.crossFilteringBehavior,
        cardinality: relationship.cardinality,
      },
    ],
  };
}

function gateStarSchemaCreateRelationshipWriteOnModel(
  model: TMDLModel,
  write: ReturnType<typeof relationshipCreateWrites>[number],
): void {
  const check = relationshipCheck(write, model);
  if (!check.valid) {
    throwInputValidationError('Star-schema apply refused: relationship create gate failed.', {
      gate: 'star-schema-apply',
      reason: 'relationship-create-gate-failed',
      write,
      blocking: check.blocking,
      warnings: check.warnings,
    });
  }
}

function gateStarSchemaRepairRelationshipWriteOnModel(
  model: TMDLModel,
  write: ReturnType<typeof relationshipRepairWrites>[number],
): void {
  const existing = model.relationships.find((relationship) => relationship.id === write.id);
  if (!existing) {
    throwInputValidationError('Star-schema apply refused: relationship repair target is missing.', {
      gate: 'star-schema-apply',
      reason: 'relationship-repair-target-missing',
      relationshipId: write.id,
      write,
    });
  }
  enforceProvenRelationshipIdentity(existing, 'update');
  if (
    existing.fromTable !== write.fromTable ||
    existing.fromColumn !== write.fromColumn ||
    existing.toTable !== write.toTable ||
    existing.toColumn !== write.toColumn ||
    existing.cardinality !== write.cardinality
  ) {
    throwInputValidationError(
      'Star-schema apply refused: relationship repair target changed since planning.',
      {
        gate: 'star-schema-apply',
        reason: 'relationship-repair-target-changed',
        relationshipId: write.id,
        expected: {
          fromTable: write.fromTable,
          fromColumn: write.fromColumn,
          toTable: write.toTable,
          toColumn: write.toColumn,
          cardinality: write.cardinality,
        },
        actual: {
          fromTable: existing.fromTable,
          fromColumn: existing.fromColumn,
          toTable: existing.toTable,
          toColumn: existing.toColumn,
          cardinality: existing.cardinality,
        },
      },
    );
  }
  if (existing.isActive === true && existing.crossFilteringBehavior === 'single') {
    throwInputValidationError(
      'Star-schema apply refused: relationship repair target is no longer in a repairable state.',
      {
        gate: 'star-schema-apply',
        reason: 'relationship-repair-target-not-executable',
        relationshipId: write.id,
        actual: existing,
      },
    );
  }
  const check = relationshipCheck(write, model, { ignoreRelationshipId: write.id });
  if (!check.valid) {
    throwInputValidationError('Star-schema apply refused: relationship repair gate failed.', {
      gate: 'star-schema-apply',
      reason: 'relationship-repair-gate-failed',
      write,
      blocking: check.blocking,
      warnings: check.warnings,
    });
  }
}

async function preflightStarSchemaRelationshipWrites(
  drv: ModelDriver,
  connection: ConnectionInfo,
  plan: Record<string, unknown>,
  createTableWrites: ReadonlyArray<{ readonly name: string; readonly expression: string }>,
  keyWrites: ReadonlyArray<ColumnUpdate>,
  repairWrites: ReturnType<typeof relationshipRepairWrites>,
  createRelationshipWrites: ReturnType<typeof relationshipCreateWrites>,
): Promise<void> {
  const latestModel = await readDriverSnapshot(
    drv,
    '(live)',
    { includeMeasures: true, includeRoles: false },
    connection,
  );
  assertNoPartialStarSchemaDimensionArtifact(latestModel, plan, createTableWrites);
  let preflightModel = modelWithStarSchemaSyntheticDimensions(
    latestModel,
    createTableWrites,
    keyWrites,
  );
  for (const write of repairWrites) {
    gateStarSchemaRepairRelationshipWriteOnModel(preflightModel, write);
    preflightModel = modelWithStarSchemaPreflightRelationship(preflightModel, write);
  }
  for (const write of createRelationshipWrites) {
    gateStarSchemaCreateRelationshipWriteOnModel(preflightModel, write);
    preflightModel = modelWithStarSchemaPreflightRelationship(preflightModel, write);
  }
}

async function applyStarSchemaJoin(
  input: StarSchemaJoinApplyInput,
): Promise<Record<string, unknown>> {
  assertExplicitStarSchemaApplyAxes(input.axes);
  const {
    mode,
    model,
    driver: drv,
    connection,
  } = await snapshotForWrite(input.folderPath, input.model, {
    includeMeasures: true,
    includeRoles: false,
  });
  if (mode !== 'live') {
    throwInputValidationError(
      'Star-schema apply refused: batched shared-dimension writes require a live Power BI Desktop model.',
      {
        gate: 'star-schema-apply',
        reason: 'not-live',
        mode,
      },
    );
  }
  const plan = (await planStarSchemaJoin(model, {
    leftTable: input.leftTable,
    rightTable: input.rightTable,
    axes: input.axes,
  })) as Record<string, unknown>;
  assertExecutableStarSchemaPlan(plan);

  const createTableWrites = proposedDimensionCreateWrites(plan);
  assertNoPartialStarSchemaDimensionArtifact(model, plan, createTableWrites);
  const keyWrites = withDimensionKeyDataTypes(
    keyColumnWrites(plan),
    inferStarDimensionKeyDataTypes(model, plan),
  );
  const repairWrites = relationshipRepairWrites(plan);
  const createRelationshipWrites = relationshipCreateWrites(plan);
  const sourceHideWrites = hideFkWrites(plan);
  const plannedOperations = plannedStarSchemaOperations(
    createTableWrites,
    keyWrites,
    repairWrites,
    createRelationshipWrites,
    sourceHideWrites,
    input.refreshAfterCreate !== false,
  );

  const initialDateAxisRequirement = dateAxisRequirementFromPlan(plan);
  const initialUnresolvedDateAxisRequirement = unresolvedDateAxisRequirement(plan);
  if (input.dryRun === true) {
    return {
      applied: false,
      dryRun: true,
      mode,
      plan,
      plannedOperations,
      ...(initialDateAxisRequirement ? { dateAxisRequirement: initialDateAxisRequirement } : {}),
      ...(initialUnresolvedDateAxisRequirement
        ? { completionStatus: 'shared-dimensions-planned-date-axis-incomplete' }
        : {}),
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
    };
  }

  const operations: Array<Record<string, unknown>> = [];
  await preflightStarSchemaRelationshipWrites(
    drv,
    connection,
    plan,
    createTableWrites,
    keyWrites,
    repairWrites,
    createRelationshipWrites,
  );
  const relationshipWarnings: RelationshipReason[] = [];

  for (const write of createTableWrites) {
    operations.push({
      action: 'create-calculated-table',
      tableName: write.name,
      result: await drv.createTable({ name: write.name, expression: write.expression }, connection),
    });
  }

  if (mode === 'live' && createTableWrites.length > 0 && input.refreshAfterCreate !== false) {
    operations.push({
      action: 'refresh-model',
      refreshType: 'Calculate',
      result: await drv.refreshModel('Calculate', connection),
    });
  }

  for (const write of keyWrites) {
    enforceNoDirectDateTableMetadataWrite(model, {
      kind: 'column',
      tableName: write.tableName,
      columnName: write.name,
      dataType: write.dataType,
      isKey: write.isKey,
    });
    operations.push({
      action: 'configure-dimension-key',
      tableName: write.tableName,
      columnName: write.name,
      result: await drv.updateColumn(write, connection),
    });
  }

  for (const write of repairWrites) {
    relationshipWarnings.push(
      ...(await gateStarSchemaRepairRelationshipWrite(drv, connection, write)),
    );
    operations.push({
      action: 'repair-relationship',
      relationshipId: write.id,
      result: await drv.updateRelationship(write, connection),
    });
  }

  for (const write of createRelationshipWrites) {
    relationshipWarnings.push(
      ...(await gateStarSchemaCreateRelationshipWrite(drv, connection, write)),
    );
    operations.push({
      action: 'create-relationship',
      fromTable: write.fromTable,
      fromColumn: write.fromColumn,
      toTable: write.toTable,
      toColumn: write.toColumn,
      result: await drv.createRelationship(write, connection),
    });
  }

  for (const write of sourceHideWrites) {
    operations.push({
      action: 'hide-source-column',
      tableName: write.tableName,
      columnName: write.name,
      result: await drv.updateColumn(write, connection),
    });
  }

  const finalModel = await readDriverSnapshot(
    drv,
    mode === 'live' ? '(live)' : undefined,
    {
      includeMeasures: true,
      includeRoles: false,
    },
    connection,
  );
  const finalPlan = (await planStarSchemaJoin(finalModel, {
    leftTable: input.leftTable,
    rightTable: input.rightTable,
    axes: input.axes,
  })) as Record<string, unknown>;
  const finalDateAxisRequirement =
    dateAxisRequirementFromPlan(finalPlan) ?? initialDateAxisRequirement;
  const finalUnresolvedDateAxisRequirement =
    finalDateAxisRequirement?.status === 'governed-date-table-required'
      ? finalDateAxisRequirement
      : undefined;
  const validationFailures = [
    ...validateAppliedStarSchemaPlan(finalModel, plan),
    ...records(finalPlan.blockers).map((blocker) => ({
      code: 'final-planner-blocker',
      blocker,
    })),
  ];
  if (validationFailures.length > 0) {
    throwInputValidationError(
      'Star-schema apply completed writes but final validation did not pass.',
      {
        gate: 'star-schema-apply',
        reason: 'post-write-validation-failed',
        failures: validationFailures,
        initialPlan: plan,
        finalPlan,
        operations,
      },
    );
  }

  return {
    applied: true,
    mode,
    initialPlan: plan,
    plannedOperations,
    operations,
    validation: {
      finalPlannerBlockers: [],
      appliedStateFailures: [],
    },
    relationshipWarnings,
    ...(finalDateAxisRequirement ? { dateAxisRequirement: finalDateAxisRequirement } : {}),
    ...(finalUnresolvedDateAxisRequirement
      ? { completionStatus: 'shared-dimensions-applied-date-axis-incomplete' }
      : {}),
    ...(input.runModelCheck === true
      ? {
          modelCheck: modelDoctor(finalModel, {
            bridgeIntent: {
              fromTable: input.leftTable,
              toTable: input.rightTable,
              axes: input.axes,
            },
          }),
        }
      : {}),
    persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
  };
}

// Summarize a (normalized) DAX result so a probe that returns no usable evidence
// can always show WHAT came back (row count, columns, a sample row, file-paging)
// instead of a silent empty. Bounded/structure-only — carries no secrets.
function daxResultDiagnostics(raw: unknown): Record<string, unknown> {
  const diagnosticRows = collectDaxDiagnosticRows(raw);
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const rowCount =
      typeof obj.rowCount === 'number'
        ? Math.max(obj.rowCount, diagnosticRows.length)
        : diagnosticRows.length;
    return {
      rowCount,
      ...(Array.isArray(obj.columns) ? { columns: obj.columns } : {}),
      ...(diagnosticRows.length > 0 ? { sampleRow: diagnosticRows[0] } : {}),
      ...(obj.wasTruncated === true ? { wasTruncated: true, filePath: obj.filePath ?? null } : {}),
      ...(isRecord(obj.rawDiagnostics) ? { rawDiagnostics: obj.rawDiagnostics } : {}),
    };
  }
  if (Array.isArray(raw)) {
    return {
      rowCount: diagnosticRows.length,
      ...(diagnosticRows.length > 0 ? { sampleRow: diagnosticRows[0] } : {}),
    };
  }
  return { rowCount: 0, rawType: raw === null ? 'null' : typeof raw };
}

function diagnosticRowCount(diagnostics: Record<string, unknown>): number {
  const rowCount = diagnostics.rowCount;
  return typeof rowCount === 'number' && Number.isFinite(rowCount) ? rowCount : 0;
}

function collectDaxDiagnosticRows(payload: unknown, depth = 0): unknown[] {
  if (depth > 8) return [];
  if (Array.isArray(payload)) {
    if (payload.every((item) => isDiagnosticRowRecord(item))) return payload;
    return payload.flatMap((item) => collectDaxDiagnosticRows(item, depth + 1));
  }
  if (payload === null || typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.rows)) return record.rows;

  for (const key of ['data', 'value', 'values', 'results', 'tables']) {
    const rows = collectDaxDiagnosticRows(record[key], depth + 1);
    if (rows.length > 0) return rows;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'columns') continue;
    const rows = collectDaxDiagnosticRows(value, depth + 1);
    if (rows.length > 0) return rows;
  }
  return [];
}

function isDiagnosticRowRecord(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return !['rows', 'data', 'value', 'values', 'results', 'tables'].some((key) => key in record);
}

function dateProofParseShapeStatus(
  diagnostics: Record<string, unknown>,
  parsedEvidenceRows: number,
  expectedEvidenceRows = 0,
): Record<string, unknown> | undefined {
  if (parsedEvidenceRows > 0) return undefined;
  if (diagnosticRowCount(diagnostics) === 0 && expectedEvidenceRows <= 0) return undefined;
  return {
    status: 'parse-shape-unrecognized',
    reason: 'proof-parse-shape-unrecognized',
    message: DATE_PROOF_PARSE_SHAPE_MESSAGE,
    rationale: DATE_PROOF_PARSE_SHAPE_RATIONALE,
    diagnostics,
    ...dateProofParseShapeGuidance(),
  };
}

function dateProofParseShapeBlockedPayload(
  diagnostics: Record<string, unknown>,
  parsedEvidenceRows: number,
  expectedEvidenceRows = 0,
): Record<string, unknown> | undefined {
  if (parsedEvidenceRows > 0) return undefined;
  if (diagnosticRowCount(diagnostics) === 0 && expectedEvidenceRows <= 0) return undefined;
  return {
    code: 'proof-parse-shape-unrecognized',
    reason: 'proof-parse-shape-unrecognized',
    message: DATE_PROOF_PARSE_SHAPE_MESSAGE,
    rationale: DATE_PROOF_PARSE_SHAPE_RATIONALE,
    probeDiagnostics: diagnostics,
    ...dateProofParseShapeGuidance(),
  };
}

function dateTableCoverageEvidenceRows(
  evidence: ReturnType<typeof parseDateTableCoverageProbeResult>,
): number {
  return (evidence.dateTable ? 1 : 0) + evidence.facts.length;
}

async function planDateGrainForRead(
  input: DateGrainPlannerInput,
): Promise<Record<string, unknown>> {
  const {
    mode,
    model: snapshot,
    connection,
  } = await snapshotModel(input.folderPath, input.model, {
    includeMeasures: input.scanMeasures === true,
    includeRoles: false,
  });
  const model = input.scanMeasures === true ? snapshot : modelWithoutMeasures(snapshot);
  const shouldProbe = input.probeData !== false;
  const startedAt = Date.now();
  let evidence: ReturnType<typeof parseDateGrainProbeResult> = [];
  let coverageEvidence: ReturnType<typeof parseDateTableCoverageProbeResult> = { facts: [] };
  let probeStatus: Record<string, unknown> = {
    status: shouldProbe ? 'not-run' : 'skipped',
    reason: shouldProbe ? undefined : 'probeData=false',
  };

  const coverageQuery =
    input.dateTable && input.dateColumn
      ? buildDateTableCoverageProbeQuery(model, {
          dateTable: input.dateTable,
          dateColumn: input.dateColumn,
          facts: input.facts,
          futureHorizonDays: input.futureHorizonDays,
        })
      : undefined;
  const query = coverageQuery ?? buildDateGrainProbeQuery(model, input.facts);
  const eligibleFacts = eligibleDateFacts(model, input.facts);
  if (!query) {
    probeStatus = {
      status: 'not-supported-by-metadata',
      reason: 'No requested fact date column has a date/dateTime data type.',
      queriedFacts: 0,
    };
  } else if (shouldProbe && mode === 'live') {
    try {
      const raw = await getModelDriver().daxQuery(query, connection, {
        includeRawDiagnostics: true,
      });
      evidence = parseDateGrainProbeResult(raw);
      if (coverageQuery) {
        coverageEvidence = parseDateTableCoverageProbeResult(raw);
      }
      const diagnostics = daxResultDiagnostics(raw);
      const expectedEvidenceRows = input.facts.filter((fact) =>
        evidence.some(
          (row) => row.tableName === fact.tableName && row.dateColumn === fact.dateColumn,
        ),
      ).length;
      const parseShapeStatus = dateProofParseShapeStatus(
        diagnostics,
        evidence.length,
        eligibleFacts.length,
      );
      // A row whose __table/__column parsed but whose numeric/date METRICS did not (e.g. a
      // non-ISO date serialization the parser can't read) is NOT a successful proof — it is
      // the exact contradiction (status 'succeeded' + persistent blockers) that drove the
      // agent thrash loop. Status 'succeeded' now requires COMPLETE proof; an incomplete one
      // surfaces 'proof-incomplete' (a tool/serialization defect, routed to STOP), never
      // 'succeeded'. Dataset-agnostic: keys off field presence only.
      const allRowsPresent = expectedEvidenceRows === eligibleFacts.length;
      const dateTableComplete =
        !coverageQuery || hasCompleteDateTableKeyProof(coverageEvidence.dateTable);
      const incompleteFacts = eligibleFacts
        .filter(
          (fact) =>
            !hasCompleteDateGrainProof(
              evidence.find(
                (row) => row.tableName === fact.tableName && row.dateColumn === fact.dateColumn,
              ),
            ),
        )
        .map((fact) => `${fact.tableName}[${fact.dateColumn}]`);
      const proofComplete = allRowsPresent && dateTableComplete && incompleteFacts.length === 0;
      probeStatus = proofComplete
        ? {
            status: 'succeeded',
            evidenceRows: evidence.length,
            expectedEvidenceRows: eligibleFacts.length,
            queriedFacts: eligibleFacts.length,
          }
        : parseShapeStatus
          ? {
              ...parseShapeStatus,
              evidenceRows: evidence.length,
              expectedEvidenceRows: eligibleFacts.length,
              queriedFacts: eligibleFacts.length,
            }
          : allRowsPresent
            ? {
                status: 'proof-incomplete',
                evidenceRows: evidence.length,
                expectedEvidenceRows: eligibleFacts.length,
                queriedFacts: eligibleFacts.length,
                reason:
                  'The probe returned a row for each requested column, but one or more numeric/date metrics did not parse (a probe/serialization defect, not an empty model). Report this and STOP; do not retry with probeData:false, run manual DAX, or mutate the model.',
                ...(dateTableComplete ? {} : { dateTableProofIncomplete: true }),
                ...(incompleteFacts.length > 0 ? { incompleteFacts } : {}),
                diagnostics,
              }
            : {
                status: 'incomplete',
                evidenceRows: evidence.length,
                expectedEvidenceRows: eligibleFacts.length,
                queriedFacts: eligibleFacts.length,
                reason:
                  'The live DAX probe returned no parseable evidence for at least one requested fact date column.',
                diagnostics,
              };
    } catch (err) {
      probeStatus = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        queriedFacts: eligibleFacts.length,
      };
    }
  } else if (shouldProbe && mode === 'folder') {
    probeStatus = {
      status: 'not-run-folder-mode',
      reason: 'Live DAX probing requires a running Power BI Desktop model.',
      queriedFacts: 0,
    };
  } else if (!shouldProbe) {
    probeStatus = {
      status: 'skipped',
      reason: 'probeData=false',
      queriedFacts: 0,
    };
  }

  return {
    mode,
    probeStatus: { ...probeStatus, durationMs: Date.now() - startedAt, probeMode: 'proof' },
    plan: planDateGrain(
      model,
      {
        facts: input.facts,
        dateTable: input.dateTable,
        dateColumn: input.dateColumn,
        futureHorizonDays: input.futureHorizonDays,
        ...(coverageEvidence.dateTable ? { dateTableCoverageEvidence: coverageEvidence } : {}),
      },
      evidence,
    ),
  };
}

async function planDateTableForRead(
  input: DateTablePlannerInput,
): Promise<Record<string, unknown>> {
  const { mode, model, connection } = await snapshotModel(input.folderPath, input.model, {
    includeMeasures: true,
    includeRoles: false,
  });
  const requiredFacts = deriveRequiredDateCoverageFacts(model, input);
  const shouldProbe = input.probeData !== false;
  const startedAt = Date.now();
  let evidence: ReturnType<typeof parseDateTableCoverageProbeResult> = { facts: [] };
  let probeStatus: Record<string, unknown> = {
    status: shouldProbe ? 'not-run' : 'skipped',
    reason: shouldProbe ? undefined : 'probeData=false',
  };
  const query = buildDateTableCoverageProbeQuery(model, {
    dateTable: input.dateTable,
    dateColumn: input.dateColumn,
    facts: requiredFacts,
    futureHorizonDays: input.futureHorizonDays,
  });
  const eligibleFacts = eligibleDateFacts(model, requiredFacts);

  if (!query) {
    probeStatus = {
      status: 'not-supported-by-metadata',
      reason: 'No requested date-table/fact date columns have a date/dateTime data type.',
      queriedFacts: 0,
    };
  } else if (shouldProbe && mode === 'live') {
    try {
      const raw = await getModelDriver().daxQuery(query, connection, {
        includeRawDiagnostics: true,
      });
      evidence = parseDateTableCoverageProbeResult(raw);
      const diagnostics = daxResultDiagnostics(raw);
      const factEvidenceRows = eligibleFacts.filter((fact) =>
        evidence.facts.some(
          (row) => row.tableName === fact.tableName && row.dateColumn === fact.dateColumn,
        ),
      ).length;
      const hasDateTableEvidence = evidence.dateTable !== undefined;
      const parsedEvidenceRows = dateTableCoverageEvidenceRows(evidence);
      const parseShapeStatus = dateProofParseShapeStatus(
        diagnostics,
        parsedEvidenceRows,
        1 + eligibleFacts.length,
      );
      // 'succeeded' requires COMPLETE proof, not merely present rows: the date-table key
      // proof and every eligible fact's grain proof must parse all metrics. A present-but-
      // unparsed-metric row (e.g. non-ISO date serialization) surfaces 'proof-incomplete'
      // (routed to STOP), never 'succeeded' — closing the status-lies-to-the-agent gap that
      // drove the thrash loop. Dataset-agnostic: field presence only.
      const allRowsPresent = hasDateTableEvidence && factEvidenceRows === eligibleFacts.length;
      const dateTableComplete = hasCompleteDateTableKeyProof(evidence.dateTable);
      const incompleteFacts = eligibleFacts
        .filter(
          (fact) =>
            !hasCompleteDateGrainProof(
              evidence.facts.find(
                (row) => row.tableName === fact.tableName && row.dateColumn === fact.dateColumn,
              ),
            ),
        )
        .map((fact) => `${fact.tableName}[${fact.dateColumn}]`);
      const proofComplete = allRowsPresent && dateTableComplete && incompleteFacts.length === 0;
      probeStatus = proofComplete
        ? {
            status: 'succeeded',
            evidenceRows: 1 + evidence.facts.length,
            expectedEvidenceRows: 1 + eligibleFacts.length,
            queriedFacts: eligibleFacts.length,
          }
        : parseShapeStatus
          ? {
              ...parseShapeStatus,
              evidenceRows: parsedEvidenceRows,
              expectedEvidenceRows: 1 + eligibleFacts.length,
              queriedFacts: eligibleFacts.length,
            }
          : allRowsPresent
            ? {
                status: 'proof-incomplete',
                evidenceRows: parsedEvidenceRows,
                expectedEvidenceRows: 1 + eligibleFacts.length,
                queriedFacts: eligibleFacts.length,
                reason:
                  'The probe returned the date-table row and a row per fact, but one or more numeric/date metrics did not parse (a probe/serialization defect, not an empty model). Report this and STOP; do not retry with probeData:false, run manual DAX, or mutate the model.',
                ...(dateTableComplete ? {} : { dateTableProofIncomplete: true }),
                ...(incompleteFacts.length > 0 ? { incompleteFacts } : {}),
                diagnostics,
              }
            : {
                status: 'incomplete',
                evidenceRows: parsedEvidenceRows,
                expectedEvidenceRows: 1 + eligibleFacts.length,
                queriedFacts: eligibleFacts.length,
                reason: 'The live DAX probe returned incomplete date-table coverage evidence.',
                diagnostics,
              };
    } catch (err) {
      probeStatus = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        queriedFacts: eligibleFacts.length,
      };
    }
  } else if (shouldProbe && mode === 'folder') {
    probeStatus = {
      status: 'not-run-folder-mode',
      reason: 'Live DAX probing requires a running Power BI Desktop model.',
      queriedFacts: 0,
    };
  } else if (!shouldProbe) {
    probeStatus = {
      status: 'skipped',
      reason: 'probeData=false',
      queriedFacts: 0,
    };
  }

  return {
    mode,
    probeStatus: { ...probeStatus, durationMs: Date.now() - startedAt, probeMode: 'proof' },
    plan: planDateTableCoverage(model, { ...input, facts: requiredFacts }, evidence),
  };
}

function validateGovernedDateTableCreateInput(
  model: TMDLModel,
  input: GovernedDateTableCreateInput,
): ReadonlyArray<Record<string, unknown>> {
  const blockers: Record<string, unknown>[] = [];
  if (model.tables.some((table) => table.name === input.tableName)) {
    blockers.push({
      code: 'date-table-already-exists',
      tableName: input.tableName,
      message: `Table "${input.tableName}" already exists. Use pbi_model_plan_date_table and pbi_table_mark_as_date for existing Date tables.`,
    });
  }

  for (const fact of input.facts) {
    const table = model.tables.find((candidate) => candidate.name === fact.tableName);
    const column = table?.columns.find((candidate) => candidate.name === fact.dateColumn);
    if (!table) {
      blockers.push({
        code: 'fact-table-not-found',
        tableName: fact.tableName,
        dateColumn: fact.dateColumn,
        message: `Fact table "${fact.tableName}" does not exist.`,
      });
      continue;
    }
    if (!column) {
      blockers.push({
        code: 'fact-date-column-not-found',
        tableName: fact.tableName,
        dateColumn: fact.dateColumn,
        message: `Fact date column "${fact.dateColumn}" does not exist on "${fact.tableName}".`,
      });
      continue;
    }
    if (!isTemporalDataType(column.dataType)) {
      blockers.push({
        code: 'fact-date-column-not-temporal',
        tableName: fact.tableName,
        dateColumn: fact.dateColumn,
        dataType: column.dataType,
        message: `Fact date column "${fact.tableName}"[${fact.dateColumn}] is ${column.dataType}, not date/dateTime.`,
      });
    }
  }

  return blockers;
}

function governedDateTableQuestions(
  input: GovernedDateTableCreateInput,
): ReadonlyArray<Record<string, unknown>> {
  const questions: Record<string, unknown>[] = [];
  if (input.rangePolicy === undefined) {
    questions.push({
      id: 'date_range_policy',
      prompt:
        'What Date table range policy should be used? (1) observed-min-max — the calendar ENDS at the last real fact date [DEFAULT for historical YTD/QTD/MTD reporting; no forecasting]; (2) observed-full-years — pad to whole calendar years (Jan 1–Dec 31) around the observed data; (3) observed-min-max-plus-future-horizon / observed-full-years-plus-future-horizon — extend the calendar past the last fact date, ONLY when explicitly modeling future/budget/forecast dates. Note: any future-horizon policy makes default-context (no date slicer) time-intelligence measures return BLANK over the empty future tail, so do not choose it for plain historical analysis.',
      requiredFor: 'Date table creation',
    });
  }
  if (
    input.rangePolicy?.includes('future-horizon') &&
    (input.futureHorizonDays === undefined || input.futureHorizonDays <= 0)
  ) {
    questions.push({
      id: 'future_horizon_days',
      prompt:
        'How many days beyond the observed max fact date should the Date table extend, and why is that horizon required?',
      requiredFor: 'Forecast/calendar padding policy',
    });
  }
  if (
    input.rangePolicy !== undefined &&
    !input.rangePolicy.includes('future-horizon') &&
    input.futureHorizonDays !== undefined &&
    input.futureHorizonDays > 0
  ) {
    questions.push({
      id: 'future_horizon_policy_conflict',
      prompt:
        'You supplied futureHorizonDays but selected a no-future-horizon range policy. Should the Date table include future dates?',
      requiredFor: 'Calendar policy consistency',
    });
  }
  if (input.refreshBeforeProbe === undefined) {
    questions.push({
      id: 'refresh_before_probe',
      prompt:
        'Should the live model be refreshed before probing fact date ranges? Choose true only when data/materialized calculated tables may be stale.',
      requiredFor: 'Live proof latency and freshness policy',
    });
  }
  return questions;
}

async function refreshLiveModelIfRequested(
  drv: ModelDriver,
  mode: 'live' | 'folder',
  connection: ConnectionInfo,
  enabled: boolean,
  phase: string,
  refreshType: 'Automatic' | 'Full' | 'Calculate' = 'Automatic',
): Promise<Record<string, unknown>> {
  if (!enabled) return { phase, skipped: true, reason: 'refreshBeforeProbe=false' };
  if (mode !== 'live') return { phase, skipped: true, reason: 'not-live' };
  try {
    const result = await drv.refreshModel(refreshType, connection);
    return { phase, attempted: true, refreshType, result };
  } catch (err) {
    throwDateGateError(`Live model refresh failed during governed Date table create (${phase}).`, {
      gate: 'governed-date-table-create',
      status: 'blocked',
      reason: 'refresh-failed',
      phase,
      refreshType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function enforceGovernedDateCreateFactProof(
  drv: ModelDriver,
  connection: ConnectionInfo,
  model: TMDLModel,
  facts: ReadonlyArray<{ readonly tableName: string; readonly dateColumn: string }>,
): Promise<void> {
  const query = buildDateGrainProbeQuery(model, facts);
  const eligibleFacts = eligibleDateFacts(model, facts);
  if (!query || eligibleFacts.length === 0) {
    throwDateGateError('Governed Date table create refused: fact date columns are not probeable.', {
      gate: 'governed-date-table-create',
      status: 'blocked',
      reason: 'not-probeable',
      facts,
      ...dateProofBlockedGuidance(),
    });
  }

  let raw: unknown;
  try {
    raw = await drv.daxQuery(query, connection, { includeRawDiagnostics: true });
  } catch (err) {
    throwDateGateError('Governed Date table create refused: pre-create fact-date proof failed.', {
      gate: 'governed-date-table-create',
      status: 'blocked',
      reason: 'probe-failed',
      error: err instanceof Error ? err.message : String(err),
      facts,
      ...dateProofBlockedGuidance(),
    });
  }

  const evidence = parseDateGrainProbeResult(raw);
  const diagnostics = daxResultDiagnostics(raw);
  const missingFacts = eligibleFacts.filter(
    (fact) =>
      !evidence.some(
        (row) => row.tableName === fact.tableName && row.dateColumn === fact.dateColumn,
      ),
  );
  if (missingFacts.length > 0) {
    const parseShapeBlocker = dateProofParseShapeBlockedPayload(
      diagnostics,
      evidence.length,
      eligibleFacts.length,
    );
    throwDateGateError(
      parseShapeBlocker
        ? 'Governed Date table create refused: pre-create fact-date proof result shape was not recognized.'
        : 'Governed Date table create refused: pre-create fact-date proof was incomplete.',
      {
        gate: 'governed-date-table-create',
        status: 'blocked',
        reason: parseShapeBlocker ? 'proof-parse-shape-unrecognized' : 'fact-date-proof-missing',
        missingFacts,
        evidenceRows: evidence.length,
        ...(parseShapeBlocker ?? {
          probeDiagnostics: diagnostics,
          ...dateProofBlockedGuidance(),
        }),
      },
    );
  }
}

function buildGovernedDateTableExpression(
  input: GovernedDateTableCreateInput & { readonly rangePolicy: GovernedDateRangePolicy },
): string {
  const factDateSets = input.facts.map((fact) => {
    const ref = daxColumnRef(fact.tableName, fact.dateColumn);
    return [
      'SELECTCOLUMNS(',
      `    FILTER(${quoteDaxTable(fact.tableName)}, NOT ISBLANK(${ref})),`,
      `    "__date", DATE(YEAR(${ref}), MONTH(${ref}), DAY(${ref}))`,
      ')',
    ].join('\n');
  });
  const firstFactDateSet = factDateSets[0] ?? '';
  const factDatesExpression =
    factDateSets.length === 1
      ? firstFactDateSet
      : `DISTINCT(UNION(\n${factDateSets.map((set) => indentBlock(set, 4)).join(',\n')}\n))`;
  const startExpression = input.rangePolicy.includes('full-years')
    ? 'DATE(YEAR(__MinDate), 1, 1)'
    : '__MinDate';
  const futureHorizonDays = input.futureHorizonDays ?? 0;
  const paddedMaxExpression =
    input.rangePolicy.includes('future-horizon') && futureHorizonDays > 0
      ? `__MaxDate + ${futureHorizonDays}`
      : '__MaxDate';
  const endExpression =
    input.rangePolicy === 'observed-full-years'
      ? 'DATE(YEAR(__MaxDate), 12, 31)'
      : paddedMaxExpression;

  return [
    'VAR __FactDates =',
    indentBlock(factDatesExpression, 4),
    'VAR __MinDate = MINX(__FactDates, [__date])',
    'VAR __MaxDate = MAXX(__FactDates, [__date])',
    `VAR __StartDate = ${startExpression}`,
    `VAR __EndDate = ${endExpression}`,
    'VAR __BaseCalendar =',
    '    ADDCOLUMNS(',
    '        CALENDAR(__StartDate, __EndDate),',
    '        "Year", YEAR([Date]),',
    '        "Quarter", "Q" & QUARTER([Date]),',
    '        "Quarter No", QUARTER([Date]),',
    '        "Month No", MONTH([Date]),',
    '        "Month Name", FORMAT([Date], "MMMM"),',
    '        "Month Short", FORMAT([Date], "MMM"),',
    '        "Year Month", FORMAT([Date], "YYYY-MM"),',
    '        "Day", DAY([Date]),',
    '        "Day Of Week", FORMAT([Date], "DDDD"),',
    '        "Day Of Week No", WEEKDAY([Date], 2),',
    '        "Is Weekend", WEEKDAY([Date], 2) >= 6',
    '    )',
    'RETURN',
    '    SELECTCOLUMNS(',
    '        __BaseCalendar,',
    `        ${daxString(input.dateColumn)}, [Date],`,
    '        "Year", [Year],',
    '        "Quarter", [Quarter],',
    '        "Quarter No", [Quarter No],',
    '        "Month No", [Month No],',
    '        "Month Name", [Month Name],',
    '        "Month Short", [Month Short],',
    '        "Year Month", [Year Month],',
    '        "Day", [Day],',
    '        "Day Of Week", [Day Of Week],',
    '        "Day Of Week No", [Day Of Week No],',
    '        "Is Weekend", [Is Weekend]',
    '    )',
  ].join('\n');
}

function governedDateTableColumnMetadata(
  tableName: string,
  dateColumn: string,
): ReadonlyArray<ColumnUpdate> {
  return [
    {
      tableName,
      name: dateColumn,
      dataType: 'dateTime',
      summarizeBy: 'none',
      formatString: 'General Date',
    },
    { tableName, name: 'Year', dataType: 'int64', summarizeBy: 'none', formatString: '0' },
    { tableName, name: 'Quarter', dataType: 'string', summarizeBy: 'none' },
    { tableName, name: 'Quarter No', dataType: 'int64', summarizeBy: 'none', formatString: '0' },
    { tableName, name: 'Month No', dataType: 'int64', summarizeBy: 'none', formatString: '0' },
    {
      tableName,
      name: 'Month Name',
      dataType: 'string',
      summarizeBy: 'none',
      sortByColumn: 'Month No',
    },
    {
      tableName,
      name: 'Month Short',
      dataType: 'string',
      summarizeBy: 'none',
      sortByColumn: 'Month No',
    },
    { tableName, name: 'Year Month', dataType: 'string', summarizeBy: 'none' },
    { tableName, name: 'Day', dataType: 'int64', summarizeBy: 'none', formatString: '0' },
    { tableName, name: 'Day Of Week', dataType: 'string', summarizeBy: 'none' },
    {
      tableName,
      name: 'Day Of Week No',
      dataType: 'int64',
      summarizeBy: 'none',
      formatString: '0',
    },
    { tableName, name: 'Is Weekend', dataType: 'boolean', summarizeBy: 'none' },
  ];
}

async function hardenGovernedDateTableColumnMetadata(
  drv: ModelDriver,
  connection: ConnectionInfo,
  tableName: string,
  dateColumn: string,
): Promise<ReadonlyArray<unknown>> {
  const results: unknown[] = [];
  for (const column of governedDateTableColumnMetadata(tableName, dateColumn)) {
    try {
      results.push(await drv.updateColumn(column, connection));
    } catch (err) {
      throwDateGateError('Governed Date table create refused: column metadata hardening failed.', {
        gate: 'governed-date-table-create',
        status: 'blocked',
        reason: 'column-metadata-hardening-failed',
        tableName,
        columnName: column.name,
        requestedMetadata: column,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

async function createGovernedDateTable(
  input: GovernedDateTableCreateInput,
): Promise<Record<string, unknown>> {
  const questions = governedDateTableQuestions(input);
  if (questions.length > 0) {
    return {
      status: 'needs-user-input',
      tool: 'pbi_date_table_create_governed',
      clarifyingQuestions: questions,
      message:
        'Date table creation refused until the calendar range policy is explicit. Do not guess literal dates or use TODAY()/NOW() anchors.',
    };
  }

  const rangePolicy = input.rangePolicy as GovernedDateRangePolicy;
  const {
    mode,
    model,
    driver: drv,
    connection,
  } = await snapshotForWrite(input.folderPath, input.model, {
    includeMeasures: false,
    includeRoles: false,
  });
  if (mode !== 'live') {
    throwDateGateError('Governed Date table create refused: live mode is required.', {
      gate: 'governed-date-table-create',
      status: 'blocked',
      reason: 'not-live',
      message:
        'This tool refreshes and proves the live model before marking the Date table. Folder-mode calendar writes cannot prove row coverage.',
    });
  }

  const blockers = validateGovernedDateTableCreateInput(model, input);
  if (blockers.length > 0) {
    throwDateGateError('Governed Date table create refused: input validation failed.', {
      gate: 'governed-date-table-create',
      status: 'blocked',
      blockers,
      ...(hasMissingTableReason(blockers)
        ? {
            diagnostics: tableMissingDiagnostics({
              reason: 'governed-date-fact-table-not-found',
              mode,
              model,
              connection,
              modelSelector: input.model,
              requestedTables: input.facts.map((fact) => fact.tableName),
            }),
          }
        : {}),
    });
  }
  const governedFacts = deriveRequiredDateCoverageFacts(model, {
    dateTable: input.tableName,
    dateColumn: input.dateColumn,
    facts: input.facts,
    futureHorizonDays: input.futureHorizonDays,
  });

  const refreshes: Record<string, unknown>[] = [];
  refreshes.push(
    await refreshLiveModelIfRequested(
      drv,
      mode,
      connection,
      input.refreshBeforeProbe === true,
      'before-create',
      'Automatic',
    ),
  );
  await enforceGovernedDateCreateFactProof(drv, connection, model, governedFacts);
  const expression = buildGovernedDateTableExpression({
    ...input,
    facts: governedFacts,
    rangePolicy,
  });
  const createResult = await drv.createTable(
    {
      name: input.tableName,
      expression,
      description:
        input.description ??
        'Governed Date table generated from observed fact date columns with an explicit calendar range policy.',
    },
    connection,
  );
  refreshes.push(
    await refreshLiveModelIfRequested(drv, mode, connection, true, 'after-create', 'Calculate'),
  );
  const columnMetadataResults = await hardenGovernedDateTableColumnMetadata(
    drv,
    connection,
    input.tableName,
    input.dateColumn,
  );

  const afterCreate = await readDriverSnapshot(
    drv,
    '(live)',
    { includeMeasures: false, includeRoles: false },
    connection,
  );
  const afterCreateWithSource = modelWithTrustedDateTableSource(
    afterCreate,
    input.tableName,
    expression,
  );
  await enforceMarkAsDateGate(
    mode,
    afterCreateWithSource,
    connection,
    input.tableName,
    input.dateColumn,
    governedFacts,
    input.futureHorizonDays,
    rangePolicy === 'observed-full-years',
  );
  const markResult = await drv.markAsDateTable(input.tableName, input.dateColumn, connection);

  // Persist the calendar-range/horizon policy as a table annotation so later mark/relationship/
  // plan steps don't re-block on end-after-fact-max or require re-supplying futureHorizonDays
  // (P5/circular). Best-effort: the MS MCP annotation write shape is UNVERIFIED, so a rejection
  // degrades to a warning and never blocks the governed create.
  let dateTablePolicyStamp: Record<string, unknown>;
  try {
    await drv.updateTable(
      {
        name: input.tableName,
        annotations: {
          [GOVERNED_DATE_TABLE_ANNOTATIONS.governedByTool]: 'true',
          [GOVERNED_DATE_TABLE_ANNOTATIONS.rangePolicy]: rangePolicy,
          [GOVERNED_DATE_TABLE_ANNOTATIONS.futureHorizonDays]: String(input.futureHorizonDays ?? 0),
        },
      },
      connection,
    );
    // The annotation write is accepted by the host, but tableUpdateApplied does NOT
    // assert annotations on read-back (the annotation wire shape is UNVERIFIED), so we
    // cannot confirm the stamp actually persisted. Report it honestly as attempted-but-
    // unverified rather than a definitive stamped:true the agent would over-trust. (If
    // the stamp did not persist, the only consequence is later steps re-run the proof.)
    dateTablePolicyStamp = {
      stamped: true,
      verified: false,
      note: 'Annotation write accepted but not verified on read-back (annotations are not asserted; UNVERIFIED MS MCP write shape). If it did not persist, later steps will re-run the date proof.',
    };
  } catch (err) {
    dateTablePolicyStamp = {
      stamped: false,
      warning:
        'Could not persist the governed Date-table range/horizon policy annotation (UNVERIFIED MS MCP write shape). Non-fatal; later steps may re-require futureHorizonDays until verified on a live model.',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const relationshipResults: unknown[] = [];
  if (input.createRelationships !== false) {
    const afterMark = await readDriverSnapshot(
      drv,
      '(live)',
      { includeMeasures: false, includeRoles: false },
      connection,
    );
    const afterMarkWithSource = modelWithTrustedDateTableSource(
      afterMark,
      input.tableName,
      expression,
    );
    const activeDateRelationshipTables = new Set(
      afterMarkWithSource.relationships
        .filter(
          (relationship) =>
            relationship.isActive &&
            relationship.toTable === input.tableName &&
            relationship.toColumn === input.dateColumn,
        )
        .map((relationship) => relationship.fromTable),
    );
    for (const fact of governedFacts) {
      const exists = afterMark.relationships.some(
        (relationship) =>
          relationship.fromTable === fact.tableName &&
          relationship.fromColumn === fact.dateColumn &&
          relationship.toTable === input.tableName &&
          relationship.toColumn === input.dateColumn,
      );
      if (exists) continue;
      const isActive = !activeDateRelationshipTables.has(fact.tableName);
      const candidate = {
        fromTable: fact.tableName,
        fromColumn: fact.dateColumn,
        toTable: input.tableName,
        toColumn: input.dateColumn,
        isActive,
        crossFilteringBehavior: 'single' as const,
      };
      const check = relationshipCheck(candidate, afterMarkWithSource);
      if (!check.valid) {
        throwDateGateError(
          'Governed Date table relationship create refused: relationship check failed.',
          {
            gate: 'governed-date-table-create',
            status: 'blocked',
            reason: 'relationship-check-blocked',
            fact,
            blocking: check.blocking,
          },
        );
      }
      await enforceDateRelationshipWriteGate(
        'live',
        afterMarkWithSource,
        connection,
        candidate,
        'create-date-relationship',
        {
          futureHorizonDays: input.futureHorizonDays,
          gate: 'governed-date-table-create',
          coverageFacts: governedFacts,
          allowCalendarEndAfterFactMax: rangePolicy === 'observed-full-years',
        },
      );
      relationshipResults.push(
        await drv.createRelationship(
          {
            fromTable: fact.tableName,
            fromColumn: fact.dateColumn,
            toTable: input.tableName,
            toColumn: input.dateColumn,
            cardinality: 'manyToOne',
            crossFilteringBehavior: 'single',
            isActive,
          },
          connection,
        ),
      );
      if (isActive) activeDateRelationshipTables.add(fact.tableName);
    }
  }

  const finalSnapshot = await readDriverSnapshot(
    drv,
    '(live)',
    { includeMeasures: false, includeRoles: false },
    connection,
  );
  const finalSnapshotWithSource = modelWithTrustedDateTableSource(
    finalSnapshot,
    input.tableName,
    expression,
  );
  const coverageQuery = buildDateTableCoverageProbeQuery(finalSnapshotWithSource, {
    dateTable: input.tableName,
    dateColumn: input.dateColumn,
    facts: governedFacts,
    futureHorizonDays: input.futureHorizonDays,
    allowCalendarEndAfterFactMax: rangePolicy === 'observed-full-years',
  });
  // The date table, key metadata, and relationships are already committed above.
  // daxQuery now throws on a DAX engine error / non-tabular result, so guard the
  // coverage probe: a probe failure must report a blocked coverage proof (with the
  // error) rather than abort the tool and hide what was already created.
  let rawCoverage: unknown;
  let coverageProbeError: string | undefined;
  if (coverageQuery) {
    try {
      rawCoverage = await drv.daxQuery(coverageQuery, connection, {
        includeRawDiagnostics: true,
      });
    } catch (err) {
      coverageProbeError = err instanceof Error ? err.message : String(err);
    }
  }
  const coverageEvidence =
    coverageQuery && coverageProbeError === undefined
      ? parseDateTableCoverageProbeResult(rawCoverage)
      : { facts: [] };
  const coverageEvidenceRows = dateTableCoverageEvidenceRows(coverageEvidence);
  const coverageDiagnostics =
    coverageQuery && coverageProbeError === undefined
      ? daxResultDiagnostics(rawCoverage)
      : undefined;
  const coverageParseShapeBlocker =
    coverageDiagnostics !== undefined
      ? dateProofParseShapeBlockedPayload(
          coverageDiagnostics,
          coverageEvidenceRows,
          1 + governedFacts.length,
        )
      : undefined;
  const coverage = planDateTableCoverage(
    finalSnapshotWithSource,
    {
      dateTable: input.tableName,
      dateColumn: input.dateColumn,
      facts: governedFacts,
      futureHorizonDays: input.futureHorizonDays,
      allowCalendarEndAfterFactMax: rangePolicy === 'observed-full-years',
    },
    coverageEvidence,
  );

  // Deterministic, dataset-agnostic warning: a future-horizon calendar extends past
  // the last fact date, so default-context (no date slicer) TOTALYTD/QTD/MTD will be
  // BLANK over the empty future tail. Surface this as an expected consequence instead
  // of letting it resurface later as a "measures came back empty" bug.
  const futureHorizonWarning = rangePolicy.includes('future-horizon')
    ? 'This Date table extends beyond the last fact date (future-horizon policy). Default-context period-to-date measures (TOTALYTD/QTD/MTD) will return BLANK without a date selection. Add a date slicer, or author the measures to default to the last date with data (cap the upper bound per measure, at day grain). For pure historical reporting, recreate with rangePolicy "observed-min-max".'
    : undefined;

  // A no-op dataCategory mark (Import host accepted but did not reflect it) must
  // NOT report the whole governed create as "blocked": the table, data-proven key,
  // and relationships are all committed and usable. Surface it as a non-blocking
  // warning so the agent reports it honestly instead of inventing manual Desktop
  // steps or treating the table as unusable.
  const markNotApplied = isRecord(markResult) && markResult.dataCategoryNotApplied === true;
  const markWarning = markNotApplied
    ? `The Date table was created and its key is proven from data, but the host did not reflect the dataCategory="Time" mark on a fresh read (a known Import-mode metadata no-op). Relationships and explicit-column time intelligence (TOTALYTD(<measure>, '${input.tableName}'[${input.dateColumn}])) work regardless. Built-in/implicit time intelligence and the Date-hierarchy UX stay off until the table is marked in Power BI Desktop (Model view → right-click → Mark as date table). Do NOT block on this and do NOT claim Import tables cannot be marked.`
    : undefined;
  // Use markReadiness.ready (data-proven-key aware), not coverage.status: status is
  // "blocked" purely because of the cosmetic date-table-not-marked blocker when the
  // mark no-ops, even though the table is fully usable. markReadiness.ready keeps
  // every real proof blocker but ignores the cosmetic mark when the key is proven.
  const usable = coverage.markReadiness.ready && !coverageParseShapeBlocker;
  return {
    status: usable ? 'created' : 'blocked',
    mode,
    tableName: input.tableName,
    dateColumn: input.dateColumn,
    rangePolicy,
    futureHorizonDays: input.futureHorizonDays ?? 0,
    ...(futureHorizonWarning ? { futureHorizonWarning } : {}),
    ...(markWarning ? { markWarning } : {}),
    expression,
    refreshes,
    createResult,
    columnMetadataResults,
    markResult,
    dateTablePolicyStamp,
    relationshipResults,
    coverage,
    ...(coverageParseShapeBlocker
      ? {
          evidenceRows: coverageEvidenceRows,
          ...coverageParseShapeBlocker,
        }
      : {}),
    ...(coverageProbeError !== undefined ? { coverageProbeError } : {}),
    ...(!usable && coverageQuery && !coverageParseShapeBlocker
      ? { probeDiagnostics: coverageDiagnostics ?? daxResultDiagnostics(rawCoverage) }
      : {}),
    persist: LIVE_MODEL_PERSISTENCE,
  };
}

function modelWithTrustedDateTableSource(
  model: TMDLModel,
  tableName: string,
  expression: string,
): TMDLModel {
  return {
    ...model,
    tables: model.tables.map((table) =>
      table.name === tableName
        ? {
            ...table,
            expression,
            partitionSources: [{ kind: 'calculated', expression }],
          }
        : table,
    ),
  };
}

function quoteDaxTable(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function daxColumnRef(tableName: string, columnName: string): string {
  return `${quoteDaxTable(tableName)}[${columnName.replace(/]/g, ']]')}]`;
}

function daxString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function indentBlock(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function eligibleDateFacts(
  model: TMDLModel,
  facts: ReadonlyArray<{ readonly tableName: string; readonly dateColumn: string }>,
): ReadonlyArray<{ readonly tableName: string; readonly dateColumn: string }> {
  return facts.filter((fact) => {
    const table = model.tables.find((candidate) => candidate.name === fact.tableName);
    const column = table?.columns.find((candidate) => candidate.name === fact.dateColumn);
    return column !== undefined && isTemporalType(column.dataType);
  });
}

type DateRelationshipGateAction = 'create-date-relationship' | 'activate-date-relationship';

async function enforceDateRelationshipWriteGate(
  mode: 'live' | 'folder',
  model: TMDLModel,
  connection: ConnectionInfo,
  candidate: {
    readonly id?: string;
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly toTable: string;
    readonly toColumn: string;
    readonly isActive: boolean;
    readonly crossFilteringBehavior?: string;
  },
  requiredAction: DateRelationshipGateAction,
  gateOptions:
    | number
    | {
        readonly futureHorizonDays?: number;
        readonly gate?: string;
        readonly coverageFacts?: ReadonlyArray<{
          readonly tableName: string;
          readonly dateColumn: string;
        }>;
        readonly allowCalendarEndAfterFactMax?: boolean;
      } = 0,
): Promise<string[]> {
  // Seed the calendar-range/horizon policy from the Date table's persisted governed stamp
  // when the caller omits it, so a governed full-years Date table does not re-block on
  // end-after-fact-max and callers need not re-supply futureHorizonDays (P5/circular).
  const governedDatePolicy = readGovernedDatePolicy(
    model.tables.find((table) => table.name === candidate.toTable),
  );
  const requestedFutureHorizonDays =
    typeof gateOptions === 'number' ? gateOptions : gateOptions.futureHorizonDays;
  const futureHorizonDays = requestedFutureHorizonDays ?? governedDatePolicy.futureHorizonDays ?? 0;
  if (futureHorizonDays > MAX_FUTURE_HORIZON_DAYS) {
    throwDateGateError(
      `Date relationship write refused: futureHorizonDays exceeds ${MAX_FUTURE_HORIZON_DAYS}.`,
      {
        gate:
          typeof gateOptions === 'number'
            ? 'date-grain-write-gate'
            : (gateOptions.gate ?? 'date-grain-write-gate'),
        status: 'blocked',
        reason: 'future-horizon-too-large',
        futureHorizonDays,
        maximumFutureHorizonDays: MAX_FUTURE_HORIZON_DAYS,
        candidate,
      },
    );
  }
  const gate =
    typeof gateOptions === 'number'
      ? 'date-grain-write-gate'
      : (gateOptions.gate ?? 'date-grain-write-gate');
  const coverageFacts = typeof gateOptions === 'number' ? undefined : gateOptions.coverageFacts;
  const allowCalendarEndAfterFactMax =
    (typeof gateOptions === 'number' ? undefined : gateOptions.allowCalendarEndAfterFactMax) ??
    governedDatePolicy.allowCalendarEndAfterFactMax ??
    false;
  if (!looksLikeDateRelationshipCandidate(model, candidate)) return [];
  // The endpoint must be a real, non-auto temporal column — but NOT necessarily
  // carry the dataCategory="Time" mark. The mark is a host-side metadata write
  // that silently no-ops on Import models (markAsDateTable returns
  // dataCategoryNotApplied), and gating relationship creation on its read-back
  // deadlocks a relationship whose key is fully proven from data. TOM allows the
  // relationship regardless of the mark, and explicit-column time intelligence
  // (TOTALYTD(<m>, 'Date'[Date])) works on an unmarked-but-data-proven contiguous
  // key. The real safety — a unique, contiguous, non-blank daily key that covers
  // every fact — is enforced below by the live coverage/grain proof via
  // markReadiness.ready, exactly as the mark gate already does (P-livewrite).
  if (!looksLikeDateRelationshipEndpoint(model, candidate.toTable, candidate.toColumn)) {
    throwDateGateError(
      'Date relationship write refused: target date endpoint is not a governed temporal date column (missing/non-date column, or an auto LocalDateTable).',
      {
        gate,
        status: 'blocked',
        reason: 'date-endpoint-not-temporal',
        candidate,
      },
    );
  }
  if (mode !== 'live') {
    throwDateGateError('Date relationship writes require a live date-grain proof.', {
      gate,
      status: 'blocked',
      reason: 'not-live',
      candidate,
    });
  }

  const fact = { tableName: candidate.fromTable, dateColumn: candidate.fromColumn };
  const effectiveCrossFiltering = candidate.crossFilteringBehavior ?? 'single';
  if (effectiveCrossFiltering !== 'single') {
    throwDateGateError(
      'Date relationship write refused: active date relationships must use single-direction cross filtering.',
      {
        gate,
        status: 'blocked',
        reason: 'unsupported-cross-filter',
        candidate,
        crossFilteringBehavior: effectiveCrossFiltering,
      },
    );
  }

  const requiredFacts = deriveRequiredDateCoverageFacts(model, {
    dateTable: candidate.toTable,
    dateColumn: candidate.toColumn,
    facts: coverageFacts ?? [fact],
    futureHorizonDays,
  });
  const coverageQuery = buildDateTableCoverageProbeQuery(model, {
    dateTable: candidate.toTable,
    dateColumn: candidate.toColumn,
    facts: requiredFacts,
    futureHorizonDays,
  });
  if (!coverageQuery) {
    throwDateGateError('Date relationship write refused: fact date column is not probeable.', {
      gate,
      status: 'blocked',
      reason: 'not-probeable',
      candidate,
    });
  }

  let raw: unknown;
  try {
    raw = await getModelDriver().daxQuery(coverageQuery, connection, {
      includeRawDiagnostics: true,
    });
  } catch (err) {
    throwDateGateError('Date relationship write refused: date-grain proof failed.', {
      gate,
      status: 'blocked',
      reason: 'probe-failed',
      error: err instanceof Error ? err.message : String(err),
      candidate,
    });
  }

  const evidence = parseDateGrainProbeResult(raw);
  const coverageEvidence = parseDateTableCoverageProbeResult(raw);
  const diagnostics = daxResultDiagnostics(raw);
  const coverageParseShapeBlocker = dateProofParseShapeBlockedPayload(
    diagnostics,
    dateTableCoverageEvidenceRows(coverageEvidence),
    1 + requiredFacts.length,
  );
  if (coverageParseShapeBlocker) {
    throwDateGateError(
      'Date relationship write refused: Date-table proof result shape was not recognized.',
      {
        gate,
        status: 'blocked',
        candidate,
        evidenceRows: dateTableCoverageEvidenceRows(coverageEvidence),
        ...coverageParseShapeBlocker,
      },
    );
  }
  const coverage = planDateTableCoverage(
    model,
    {
      dateTable: candidate.toTable,
      dateColumn: candidate.toColumn,
      facts: requiredFacts,
      futureHorizonDays,
      allowCalendarEndAfterFactMax,
    },
    coverageEvidence,
  );
  // Use markReadiness.ready, not coverage.status: ready drops the two cosmetic
  // pre-mark blockers (date-table-not-marked / date-column-not-key) WHEN the key is
  // proven from data, while keeping every real proof blocker (blanks, duplicates,
  // gaps, time component, missing coverage, end-after-fact-max, source risk). This
  // mirrors the mark gate (enforceMarkAsDateGate) so a no-op dataCategory mark can
  // no longer deadlock a relationship whose key is fully data-proven, but a genuine
  // data defect still blocks. coverage.status alone would re-block on the cosmetic
  // mark and reintroduce the deadlock this gate just removed above.
  if (!coverage.markReadiness.ready) {
    throwDateGateError('Date relationship write refused: Date-table coverage proof is blocked.', {
      gate,
      status: 'blocked',
      reason: 'date-table-coverage-blocked',
      candidate,
      coverage,
      probeDiagnostics: diagnostics,
    });
  }
  const grainParseShapeBlocker = dateProofParseShapeBlockedPayload(
    diagnostics,
    evidence.length,
    requiredFacts.length,
  );
  if (grainParseShapeBlocker) {
    throwDateGateError(
      'Date relationship write refused: date-grain proof result shape was not recognized.',
      {
        gate,
        status: 'blocked',
        candidate,
        evidenceRows: evidence.length,
        ...grainParseShapeBlocker,
      },
    );
  }
  const plan = planDateGrain(
    model,
    {
      facts: requiredFacts,
      dateTable: candidate.toTable,
      dateColumn: candidate.toColumn,
      dateTableCoverageEvidence: coverageEvidence,
      futureHorizonDays,
      allowCalendarEndAfterFactMax,
    },
    evidence,
  );
  const factPlan = plan.facts.find(
    (candidatePlan) =>
      candidatePlan.tableName === fact.tableName && candidatePlan.dateColumn === fact.dateColumn,
  );
  const matchingWrite = factPlan?.writePlan.some((item) => {
    if (requiredAction === 'activate-date-relationship') {
      return item.action === 'activate-date-relationship' && item.id === candidate.id;
    }
    return (
      item.action === 'create-date-relationship' &&
      item.fromTable === candidate.fromTable &&
      item.fromColumn === candidate.fromColumn &&
      item.toTable === candidate.toTable &&
      item.toColumn === candidate.toColumn &&
      item.crossFilteringBehavior === effectiveCrossFiltering
    );
  });

  const inactiveCreateSafe =
    requiredAction === 'create-date-relationship' &&
    candidate.isActive === false &&
    factPlan?.observedGrain === 'day' &&
    factPlan.measureGuidance.safeVisualDateGrain === 'day-or-above';

  if (factPlan?.observedGrain !== 'day' || (matchingWrite !== true && !inactiveCreateSafe)) {
    throwDateGateError(
      `Date relationship write refused: observed grain is "${factPlan?.observedGrain ?? 'unknown'}", not proven daily with a matching planner write.`,
      {
        gate,
        status: 'blocked',
        reason: 'date-grain-write-plan-blocked',
        requiredAction,
        candidate,
        observedGrain: factPlan?.observedGrain,
        evidenceRows: evidence.length,
        plan,
        probeDiagnostics: diagnostics,
      },
    );
  }
  // Relay non-blocking caveats (e.g. an unreadable calendar source on a live Import model)
  // so the caller can surface them honestly; they did NOT refuse the relationship write.
  return coverage.warnings.map((warning) => warning.message);
}

function looksLikeDateRelationshipCandidate(
  model: TMDLModel,
  candidate: {
    readonly fromTable: string;
    readonly fromColumn: string;
    readonly toTable: string;
    readonly toColumn: string;
  },
): boolean {
  const fromColumn = findModelColumn(model, candidate.fromTable, candidate.fromColumn);
  const toTable = model.tables.find((table) => table.name === candidate.toTable);
  const toColumn = findModelColumn(model, candidate.toTable, candidate.toColumn);
  return (
    fromColumn !== undefined &&
    toColumn !== undefined &&
    toTable !== undefined &&
    isTemporalDataType(fromColumn.dataType) &&
    isTemporalDataType(toColumn.dataType)
  );
}

function looksLikeGovernedDateEndpoint(
  model: TMDLModel,
  tableName: string,
  columnName: string,
): boolean {
  const table = model.tables.find((candidate) => candidate.name === tableName);
  const column = findModelColumn(model, tableName, columnName);
  if (!table || !column || table.isAutoDateTable) return false;
  const temporal = isTemporalDataType(column.dataType);
  const marked = isTimeDataCategory(table.dataCategory) || isTimeDataCategory(column.dataCategory);
  return temporal && marked;
}

// A valid Date-relationship endpoint: a real, non-auto temporal date column. This
// deliberately does NOT require the dataCategory="Time" mark — the mark is a
// host-side metadata write that silently no-ops on Import models, and the actual
// data-proven-key safety is enforced separately by the live coverage/grain proof
// (markReadiness.ready). The auto LocalDateTable exclusion is kept because binding
// to an engine-generated date table is never the intended governed endpoint.
function looksLikeDateRelationshipEndpoint(
  model: TMDLModel,
  tableName: string,
  columnName: string,
): boolean {
  const table = model.tables.find((candidate) => candidate.name === tableName);
  const column = findModelColumn(model, tableName, columnName);
  if (!table || !column || table.isAutoDateTable) return false;
  return isTemporalDataType(column.dataType);
}

function findModelColumn(
  model: TMDLModel,
  tableName: string,
  columnName: string,
):
  | { readonly dataType: string; readonly dataCategory?: string; readonly isKey: boolean }
  | undefined {
  return model.tables
    .find((table) => table.name === tableName)
    ?.columns.find((column) => column.name === columnName);
}

function isTemporalDataType(dataType: string | undefined): boolean {
  return dataType !== undefined && isTemporalType(dataType);
}

function isTimeDataCategory(dataCategory: string | undefined): boolean {
  return dataCategory?.toLowerCase() === 'time';
}

function throwDateGateError(message: string, report: Record<string, unknown>): never {
  const err = new Error(message) as Error & { report?: unknown };
  err.report = report;
  throw err;
}

function throwInputValidationError(message: string, report: Record<string, unknown>): never {
  const err = new Error(message) as Error & { report?: unknown };
  err.report = { gate: 'tool-input-validation', status: 'blocked', ...report };
  throw err;
}

function enforceMeasureIntentForWrite(
  toolName: string,
  measureName: string,
  expression: string | undefined,
  measureIntent: MeasureIntent | undefined,
  model: TMDLModel,
): void {
  if (!measureIntent) {
    throwInputValidationError('Measure write refused: confirmed measureIntent is required.', {
      tool: toolName,
      reason: 'missing-measure-intent',
      measureName,
    });
  }

  const parsed = MeasureIntentSchema.safeParse(measureIntent);
  if (!parsed.success) {
    throwInputValidationError('Measure write refused: measureIntent is invalid.', {
      tool: toolName,
      reason: 'invalid-measure-intent',
      measureName,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const intent = parsed.data;
  if (intent.status !== 'confirmed') {
    throwInputValidationError('Measure write refused: measureIntent must be confirmed.', {
      tool: toolName,
      reason: 'draft-measure-intent',
      measureName,
      intentStatus: intent.status,
    });
  }
  if (intent.measureName !== measureName) {
    throwInputValidationError('Measure write refused: measureIntent measureName does not match.', {
      tool: toolName,
      reason: 'measure-intent-name-mismatch',
      measureName,
      intentMeasureName: intent.measureName,
    });
  }

  const fieldIndex = buildModelFieldIndexFromModel(model);
  const missingRefs = intent.sourceRefs.filter((ref) =>
    ref.kind === 'column'
      ? findColumn(fieldIndex, ref.table, ref.column) === null
      : findMeasure(fieldIndex, ref.table, ref.column) === null,
  );
  if (missingRefs.length > 0) {
    throwInputValidationError(
      'Measure write refused: measureIntent sourceRefs are not in the model.',
      {
        tool: toolName,
        reason: 'measure-intent-source-ref-missing',
        measureName,
        missingRefs,
      },
    );
  }

  if (expression && expressionUsesTimeIntelligence(expression)) {
    if (!hasMeasureIntentTimeEvidence(intent)) {
      throwInputValidationError(
        'Measure write refused: time-intelligence DAX requires confirmed timeIntelligence evidence.',
        {
          tool: toolName,
          reason: 'missing-time-intelligence-evidence',
          measureName,
          required: [
            'dateRefs',
            'dateTable',
            'dateColumn',
            'grain',
            'calendarPolicy',
            'incompletePeriodBehavior',
          ],
        },
      );
    }
    const time = intent.timeIntelligence;
    const missingDateRefs = time.dateRefs.filter(
      (ref) => findColumn(fieldIndex, ref.table, ref.column) === null,
    );
    if (missingDateRefs.length > 0) {
      throwInputValidationError(
        'Measure write refused: timeIntelligence dateRefs are not in the model.',
        {
          tool: toolName,
          reason: 'measure-intent-date-ref-missing',
          measureName,
          missingRefs: missingDateRefs,
        },
      );
    }
    if (findColumn(fieldIndex, time.dateTable, time.dateColumn) === null) {
      throwInputValidationError(
        'Measure write refused: timeIntelligence dateTable/dateColumn is not in the model.',
        {
          tool: toolName,
          reason: 'measure-intent-date-column-missing',
          measureName,
          dateTable: time.dateTable,
          dateColumn: time.dateColumn,
        },
      );
    }
  }
}

type MeasureIntentWithTimeEvidence = MeasureIntent & {
  timeIntelligence: {
    dateRefs: NonNullable<NonNullable<MeasureIntent['timeIntelligence']>['dateRefs']>;
    dateTable: string;
    dateColumn: string;
    grain: string;
    calendarPolicy: string;
    incompletePeriodBehavior: string;
  };
};

function hasMeasureIntentTimeEvidence(
  intent: MeasureIntent,
): intent is MeasureIntentWithTimeEvidence {
  const time = intent.timeIntelligence;
  return (
    time !== undefined &&
    (time.dateRefs?.length ?? 0) > 0 &&
    time.dateTable !== undefined &&
    time.dateColumn !== undefined &&
    time.grain !== undefined &&
    time.calendarPolicy !== undefined &&
    time.incompletePeriodBehavior !== undefined
  );
}

type BlankRiskFact = {
  readonly tableName: string;
  readonly dateColumn: string;
};

function dateEvidenceKey(fact: BlankRiskFact): string {
  return `${fact.tableName}\u0000${fact.dateColumn}`;
}

function isDateTableLikeForBlankRisk(table: TMDLModel['tables'][number]): boolean {
  return isTimeDataCategory(table.dataCategory);
}

function deriveActiveDateAxisFactsForBlankRisk(
  model: TMDLModel,
  dateTable: string,
  dateColumn: string,
): ReadonlyArray<BlankRiskFact> {
  const tableByName = new Map(model.tables.map((table) => [table.name, table]));
  const facts = new Map<string, BlankRiskFact>();
  const addFact = (tableName: string, columnName: string): void => {
    const table = tableByName.get(tableName);
    const column = table?.columns.find((candidate) => candidate.name === columnName);
    if (!table || !column || !isTemporalType(column.dataType)) return;
    if (table.name === dateTable || table.isAutoDateTable || isDateTableLikeForBlankRisk(table)) {
      return;
    }
    const fact = { tableName, dateColumn: columnName };
    facts.set(dateEvidenceKey(fact), fact);
  };

  for (const relationship of model.relationships) {
    if (!relationship.isActive) continue;
    const fromIsDate =
      relationship.fromTable === dateTable && relationship.fromColumn === dateColumn;
    const toIsDate = relationship.toTable === dateTable && relationship.toColumn === dateColumn;
    if (fromIsDate) addFact(relationship.toTable, relationship.toColumn);
    if (toIsDate) addFact(relationship.fromTable, relationship.fromColumn);
  }

  return [...facts.values()];
}

function modelForBlankRiskProbe(
  model: TMDLModel,
  dateTable: string,
  dateColumn: string,
  facts: ReadonlyArray<BlankRiskFact>,
): TMDLModel {
  const factKeys = new Set(facts.map(dateEvidenceKey));
  const tables = model.tables
    .filter(
      (table) => table.name === dateTable || facts.some((fact) => fact.tableName === table.name),
    )
    .map((table) => {
      if (table.name === dateTable) {
        return {
          ...table,
          columns: table.columns.filter((column) => column.name === dateColumn),
          measures: [],
        };
      }
      const factColumns = facts
        .filter((fact) => fact.tableName === table.name)
        .map((fact) => fact.dateColumn);
      return {
        ...table,
        columns: table.columns.filter((column) => factColumns.includes(column.name)),
        measures: [],
      };
    });
  return {
    ...model,
    tables,
    relationships: model.relationships.filter((relationship) => {
      if (!relationship.isActive) return false;
      const fromIsDate =
        relationship.fromTable === dateTable && relationship.fromColumn === dateColumn;
      const toIsDate = relationship.toTable === dateTable && relationship.toColumn === dateColumn;
      if (fromIsDate) {
        return factKeys.has(
          dateEvidenceKey({
            tableName: relationship.toTable,
            dateColumn: relationship.toColumn,
          }),
        );
      }
      if (toIsDate) {
        return factKeys.has(
          dateEvidenceKey({
            tableName: relationship.fromTable,
            dateColumn: relationship.fromColumn,
          }),
        );
      }
      return false;
    }),
  };
}

function hasUsableMaxDate(value: string | undefined): boolean {
  if (value === undefined) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(parsed)) return false;
  const date = new Date(parsed);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function refuseUnverifiedTimeIntelligenceBlankRisk(input: {
  readonly toolName: string;
  readonly measureName: string;
  readonly period: string;
  readonly dateTable: string;
  readonly dateColumn: string;
  readonly facts: ReadonlyArray<BlankRiskFact>;
  readonly unverifiedReason: string;
  readonly probeError?: string;
}): never {
  throwInputValidationError(
    `Measure write refused: "${input.measureName}" is a ${input.period} period-to-date measure, but the Date table "${input.dateTable}"[${input.dateColumn}] may extend past the related fact data and the blank-risk probe could not prove the relevant fact max date. Add a date slicer, fix the calendar to an observed-min-max policy, or supply the capped _AsOf pattern before writing this measure.`,
    {
      tool: input.toolName,
      reason: 'time-intelligence-blank-risk-unverified',
      measureName: input.measureName,
      period: input.period,
      dateTable: input.dateTable,
      dateColumn: input.dateColumn,
      facts: input.facts,
      unverifiedReason: input.unverifiedReason,
      ...(input.probeError ? { probeError: input.probeError } : {}),
    },
  );
}

// Default-context BLANK guard for period-to-date measures. A bare
// TOTALYTD/QTD/MTD over a Date table whose calendar extends past THIS measure's
// own fact returns BLANK with no date slicer — the exact field failure, and the
// common multi-fact case where one shared Date table spans the union of fact
// max-dates (observed-min-max cannot fix it; the calendar must still cover the
// longer fact). Detect it with a live max-vs-max probe and refuse with the
// deterministic capped (shape-B) expression, so a silently-blank measure is never
// written. Dataset-agnostic: every name flows from the model relationships / probe.
// A probe failure on a recognized period-to-date form fails closed.
async function enforceTimeIntelligenceNotBlankInDefaultContext(
  connection: ConnectionInfo,
  model: TMDLModel,
  toolName: string,
  measureName: string,
  expression: string,
  intent: MeasureIntent | undefined,
): Promise<string | undefined> {
  if (!expressionUsesTimeIntelligence(expression)) return undefined;
  const time = intent?.timeIntelligence;
  const bare = parseBarePeriodToDate(expression);
  // BOTH paths — the bare blank-risk rebuild AND the already-capped calendar-max-anchor
  // advisory — require a declared TI date axis plus a live overshoot probe.
  if (time?.dateTable === undefined || time.dateColumn === undefined) {
    if (bare) {
      refuseUnverifiedTimeIntelligenceBlankRisk({
        toolName,
        measureName,
        period: bare.period,
        dateTable: bare.datesRef,
        dateColumn: bare.datesRef,
        facts: [],
        unverifiedReason: 'missing-declared-date-axis',
      });
    }
    return undefined;
  }
  // The measure's actual date axis must match the intent's declared Date axis. If a
  // user authored the period-to-date over a DIFFERENT calendar than intent declares,
  // rebuilding the cap on the intent's axis would silently swap the calendar and
  // change every value. Check this before the live probe so missing proof cannot hide
  // an axis mismatch.
  const declaredDatesRef = `'${time.dateTable.replace(/'/g, "''")}'[${time.dateColumn}]`;
  if (bare && normalizeDaxRef(bare.datesRef) !== normalizeDaxRef(declaredDatesRef)) {
    throwInputValidationError(
      `Measure write refused: "${measureName}" applies ${bare.period} over ${bare.datesRef}, but its declared time-intelligence date axis is ${declaredDatesRef}. Re-point the measure to the declared Date axis, or correct the intent — the blank-risk cap will not silently swap the calendar.`,
      {
        tool: toolName,
        reason: 'time-intelligence-date-axis-mismatch',
        measureName,
        expressionDatesRef: bare.datesRef,
        declaredDatesRef,
      },
    );
  }
  const facts = deriveActiveDateAxisFactsForBlankRisk(model, time.dateTable, time.dateColumn);
  if (facts.length === 0) {
    if (bare) {
      refuseUnverifiedTimeIntelligenceBlankRisk({
        toolName,
        measureName,
        period: bare.period,
        dateTable: time.dateTable,
        dateColumn: time.dateColumn,
        facts,
        unverifiedReason: 'no-active-fact-date-relationship',
      });
    }
    return undefined;
  }
  const probeModel = modelForBlankRiskProbe(model, time.dateTable, time.dateColumn, facts);
  const query = buildDateTableCoverageProbeQuery(probeModel, {
    dateTable: time.dateTable,
    dateColumn: time.dateColumn,
    facts,
  });
  if (!query) {
    if (bare) {
      refuseUnverifiedTimeIntelligenceBlankRisk({
        toolName,
        measureName,
        period: bare.period,
        dateTable: time.dateTable,
        dateColumn: time.dateColumn,
        facts,
        unverifiedReason: 'probe-query-unavailable',
      });
    }
    return undefined;
  }
  let raw: unknown;
  try {
    raw = await getModelDriver().daxQuery(query, connection, { includeRawDiagnostics: true });
  } catch (err) {
    // The probe could not run. For a recognized bare period-to-date form, fail closed:
    // writing uncapped would be silently wrong when the calendar outruns the fact.
    if (!bare) return undefined;
    refuseUnverifiedTimeIntelligenceBlankRisk({
      toolName,
      measureName,
      period: bare.period,
      dateTable: time.dateTable,
      dateColumn: time.dateColumn,
      facts,
      unverifiedReason: 'probe-error',
      probeError: err instanceof Error ? err.message : String(err),
    });
  }
  const evidence = parseDateTableCoverageProbeResult(raw);
  const calendarMaxDate = evidence.dateTable?.maxDate;
  if (!hasUsableMaxDate(calendarMaxDate)) {
    if (bare) {
      refuseUnverifiedTimeIntelligenceBlankRisk({
        toolName,
        measureName,
        period: bare.period,
        dateTable: time.dateTable,
        dateColumn: time.dateColumn,
        facts,
        unverifiedReason: 'missing-date-table-evidence',
      });
    }
    return undefined;
  }
  const factEvidenceByKey = new Map(
    evidence.facts.map((fact) => [
      dateEvidenceKey({ tableName: fact.tableName, dateColumn: fact.dateColumn }),
      fact,
    ]),
  );
  const missingFacts = facts.filter((fact) => {
    const factEvidence = factEvidenceByKey.get(dateEvidenceKey(fact));
    return !hasUsableMaxDate(factEvidence?.maxDate);
  });
  if (missingFacts.length > 0) {
    if (bare) {
      refuseUnverifiedTimeIntelligenceBlankRisk({
        toolName,
        measureName,
        period: bare.period,
        dateTable: time.dateTable,
        dateColumn: time.dateColumn,
        facts,
        unverifiedReason: 'missing-fact-evidence',
      });
    }
    return undefined;
  }
  const overshootFacts = facts.filter((fact) => {
    const factEvidence = factEvidenceByKey.get(dateEvidenceKey(fact));
    return calendarOvershootsFactDay(calendarMaxDate, factEvidence?.maxDate);
  });
  // No overshoot → a bare period-to-date is safe in default context, AND a calendar-max
  // anchor is harmless (it resolves to a date that has data), so nothing to refuse here.
  if (overshootFacts.length === 0) return undefined;
  if (!bare) {
    // The measure is already capped (carries an _AsOf / date `<=` upper bound) AND the
    // calendar genuinely overshoots the facts. If the cap LOOKS anchored at the calendar
    // END (MAX/LASTDATE of the date axis with date filters cleared) rather than the last
    // date with DATA — the field regression that blanks the measure in every context —
    // surface a NON-BLOCKING advisory. This is best-effort detection of a semantic
    // property (see detectCalendarMaxAnchorCap), so it must NOT hard-refuse: a spurious
    // match on a legitimate compound measure (a period-to-date co-located with an unrelated
    // calendar-anchored rolling window) would otherwise break valid authoring. The measure
    // is written; the warning tells the author to verify and, if blank, re-anchor.
    if (detectCalendarMaxAnchorCap(expression, time.dateTable, time.dateColumn)) {
      return `Possible blank-in-every-context cap in "${measureName}": its period-to-date upper bound appears to anchor at the CALENDAR end of '${time.dateTable}'[${time.dateColumn}] (MAX/LASTDATE of the date axis with date filters cleared), and this Date table extends past the facts (a shared calendar covering a later fact such as Ship Date, or a future horizon). If the measure is BLANK in default (no-slicer) context, re-anchor the cap at THIS measure's own last non-blank date: VAR _LastData = CALCULATE(MAXX(FILTER(VALUES('${time.dateTable}'[${time.dateColumn}]), NOT ISBLANK(CALCULATE(<base measure>))), '${time.dateTable}'[${time.dateColumn}]), REMOVEFILTERS('${time.dateTable}')). Never anchor a period-to-date cap at MAX/LASTDATE of the date table. (If this measure is a legitimate compound expression whose calendar anchor feeds an unrelated rolling window, ignore this note.)`;
    }
    return undefined;
  }
  // Pick the overshoot fact deterministically: prefer the one whose table the
  // measure's base expression actually aggregates (so the cap anchors to the right
  // fact in a multi-fact intent), falling back to the first overshooting fact.
  const overshootFact =
    overshootFacts.find((fact) =>
      baseExpressionReferencesTable(bare.baseExpression, fact.tableName),
    ) ?? overshootFacts[0];
  if (!overshootFact) return;

  // Extra top-level TOTAL*TD args (a fiscal year_end_date and/or a filter predicate)
  // must NOT be silently dropped by the rebuild — that would change the result. Only a
  // recognized fiscal year-end literal (YTD) can be safely re-threaded; anything else
  // (a filter, a non-YTD extra arg, or multiple extras) is refused with a manual-cap
  // instruction instead of an auto-correction that loses the user's filtering.
  let yearEndDate: string | undefined;
  if (bare.extraArgs.length > 0) {
    const soleYearEnd =
      bare.period === 'YTD' &&
      bare.extraArgs.length === 1 &&
      bare.extraArgs[0] !== undefined &&
      isYearEndDateLiteral(bare.extraArgs[0]);
    if (soleYearEnd) {
      yearEndDate = bare.extraArgs[0];
    } else {
      throwInputValidationError(
        `Measure write refused: "${measureName}" is a bare ${bare.period} measure whose Date table extends past "${overshootFact.tableName}"[${overshootFact.dateColumn}] (BLANK in default context), but it carries additional TOTAL*TD argument(s) (${bare.extraArgs.join(', ')}) that cannot be re-threaded automatically without changing the result. Add the upper-bound cap by hand: wrap the base with a "<date> <= last-data-date" filter (see buildTimeIntelligenceMeasureExpression shape B).`,
        {
          tool: toolName,
          reason: 'time-intelligence-default-context-blank-risk-manual',
          measureName,
          period: bare.period,
          extraArgs: bare.extraArgs,
          fact: overshootFact,
          calendarMaxDate: calendarMaxDate ?? null,
        },
      );
    }
  }

  const correctedExpression = buildTimeIntelligenceMeasureExpression({
    period: bare.period,
    baseExpression: bare.baseExpression,
    dateTable: time.dateTable,
    dateKeyColumn: time.dateColumn,
    ...(yearEndDate !== undefined ? { yearEndDate } : {}),
    // Anchor the cap at THIS measure's own last non-blank date (measure-relative),
    // not at the overshoot fact's date column — so it stays correct for any role
    // (Order Date vs Ship Date) and for row-filtered measures, and can never be
    // "improved" into a calendar-max anchor that blanks (the field regression).
    capToLastDataPeriod: true,
  });
  throwInputValidationError(
    `Measure write refused: "${measureName}" is a bare ${bare.period} measure, but the Date table "${time.dateTable}" extends past the last date in "${overshootFact.tableName}"[${overshootFact.dateColumn}], so it returns BLANK in default (no-slicer) context. Write the capped expression in correctedExpression instead — it caps the upper bound at this fact's last data date, per measure, at day grain, so default, slicer, and drill-down contexts are all correct.`,
    {
      tool: toolName,
      reason: 'time-intelligence-default-context-blank-risk',
      measureName,
      period: bare.period,
      dateTable: time.dateTable,
      dateColumn: time.dateColumn,
      fact: overshootFact,
      calendarMaxDate: calendarMaxDate ?? null,
      correctedExpression,
    },
  );
}

// Normalize a DAX column ref for comparison: drop whitespace AND surrounding single
// quotes so quoting/spacing differences do not produce false mismatches. DAX treats an
// unquoted single-token table name identically to its quoted form (Calendar[Date] ==
// 'Calendar'[Date]), so a same-axis measure authored either way must compare equal —
// otherwise a correctly-authored unquoted measure is wrongly refused as an axis mismatch.
function normalizeDaxRef(ref: string): string {
  // Case-INSENSITIVE: DAX identifiers are case-insensitive, so 'Calendar'[Date] and
  // 'Calendar'[date] are the SAME axis and must compare equal (else a same-axis measure
  // authored with different casing is falsely refused as an axis mismatch). Whitespace and
  // the outer table quotes are also normalized so 'Calendar'[Date] == Calendar[Date].
  return ref.replace(/\s+/g, '').replace(/'/g, '').toLowerCase();
}

// True when a TOTAL*TD base expression references the given table by its DAX-quoted
// name ('Table'[...]) — a structural, dataset-agnostic check used to anchor the cap
// to the fact the measure actually aggregates. Falls back gracefully (no match) so
// callers default to the first overshooting fact.
function baseExpressionReferencesTable(baseExpression: string, tableName: string): boolean {
  const quoted = `'${tableName.replace(/'/g, "''")}'`;
  return baseExpression.includes(quoted) || baseExpression.includes(`${tableName}[`);
}

// Best-effort, dataset-agnostic pre-flight DAX reference check for a calculated-column
// expression. ADVISORY ONLY (never blocks): the live engine also validates on write,
// but that rejection is UNVERIFIED against the MS modeling MCP, so surfacing an
// obviously-broken reference up front (the same deterministic gate the measure path
// runs) is strictly better than relying on the engine alone. Bare `[Column]` refs
// resolve against the hostTable row context, so normal self/sibling references do not
// false-positive. Returns undefined when there is no expression or it resolves cleanly.
function calcExpressionReferenceAdvisory(
  model: TMDLModel,
  hostTable: string,
  expression: string | undefined,
): Record<string, unknown> | undefined {
  if (expression === undefined || expression.trim() === '') return undefined;
  const check = daxReferenceCheck(expression, model, { hostTable });
  if (check.valid) return undefined;
  return {
    advisory: 'calc-expression-reference-check',
    note: 'Pre-flight reference check found names that do not resolve in the current model. The engine also validates on write; confirm these are intended (e.g. a sibling column created in the same batch) rather than a typo before relying on the calculated column.',
    ...(check.missing.length > 0 ? { missing: check.missing.map((r) => r.raw) } : {}),
    ...(check.ambiguous.length > 0 ? { ambiguous: check.ambiguous.map((r) => r.raw) } : {}),
    ...(check.unsupported.length > 0 ? { unsupported: check.unsupported } : {}),
  };
}

function enforceProvenRelationshipIdentity(
  relationship: TMDLRelationship,
  operation: string,
): void {
  if (relationship.identityProven !== true) {
    throwDateGateError(
      `Refused: relationship "${relationship.id}" does not have a proven model identity for ${operation}.`,
      {
        gate: 'relationship-check',
        status: 'blocked',
        reason: 'relationship-id-missing',
        id: relationship.id,
        operation,
      },
    );
  }
}

function enforceNoDirectDateTableMetadataWrite(
  model: TMDLModel,
  input:
    | {
        readonly kind: 'table';
        readonly tableName: string;
        readonly dataCategory?: string;
      }
    | {
        readonly kind: 'column';
        readonly tableName: string;
        readonly columnName: string;
        readonly dataType?: string;
        readonly isKey?: boolean;
        readonly dataCategory?: string;
        readonly expression?: string;
      },
): void {
  if (input.kind === 'table') {
    if (isTimeDataCategory(input.dataCategory)) {
      throwDateGateError(
        'Direct table dataCategory:"Time" writes are refused. Use pbi_table_mark_as_date with date-table coverage facts so the live continuity/coverage gate runs.',
        {
          gate: 'direct-date-table-metadata-gate',
          status: 'blocked',
          reason: 'use-mark-as-date-tool',
          tableName: input.tableName,
        },
      );
    }
    return;
  }

  const existingColumn = findModelColumn(model, input.tableName, input.columnName);
  const effectiveDataType = input.dataType ?? existingColumn?.dataType;
  const effectiveIsKey = input.isKey ?? existingColumn?.isKey ?? false;
  const table = model.tables.find((candidate) => candidate.name === input.tableName);
  const effectiveColumnCategory = input.dataCategory ?? existingColumn?.dataCategory;
  const marksDateTable =
    isTimeDataCategory(table?.dataCategory) || isTimeDataCategory(effectiveColumnCategory);
  const touchesDateMetadata =
    input.dataType !== undefined || input.isKey !== undefined || input.dataCategory !== undefined;
  const wouldSetTimeCategory = isTimeDataCategory(input.dataCategory);
  const wouldCreateMarkedDateKey =
    touchesDateMetadata &&
    effectiveIsKey &&
    isTemporalDataType(effectiveDataType) &&
    marksDateTable;
  const wouldMutateMarkedDateKeyExpression =
    input.expression !== undefined && effectiveIsKey && marksDateTable;
  if (wouldSetTimeCategory || wouldCreateMarkedDateKey || wouldMutateMarkedDateKeyExpression) {
    throwDateGateError(
      'Direct Date-table key/category writes are refused. Use pbi_table_mark_as_date with date-table coverage facts so the live continuity/coverage gate runs.',
      {
        gate: 'direct-date-table-metadata-gate',
        status: 'blocked',
        reason: wouldMutateMarkedDateKeyExpression
          ? 'date-key-expression-update-refused'
          : 'use-mark-as-date-tool',
        tableName: input.tableName,
        columnName: input.columnName,
        dataType: effectiveDataType,
        isKey: effectiveIsKey,
        dataCategory: effectiveColumnCategory,
      },
    );
  }
}

function enforceNoVolatileCalendarTableCreate(input: {
  readonly name: string;
  readonly expression?: string;
  readonly mExpression?: string;
}): void {
  const risks = findCalendarSourceRisks([
    ...(input.expression !== undefined
      ? [{ kind: 'calculated', expression: input.expression }]
      : []),
    ...(input.mExpression !== undefined ? [{ kind: 'm', expression: input.mExpression }] : []),
  ]);
  const risk = risks[0];
  if (risk) {
    throwDateGateError('Date table creation refused: ungoverned calendar bounds are not allowed.', {
      gate: 'date-table-create-gate',
      status: 'blocked',
      reason: risk.code,
      tableName: input.name,
      sourceKind: risk.sourceKind,
      message: risk.message,
    });
  }
  if (looksLikeCalendarTableCreate(input)) {
    throwDateGateError(
      'Date table creation refused: generic table creation cannot prove calendar coverage. Use pbi_model_plan_date_table against an existing governed Date table before relying on Date fields, and do not create calendar bounds from prompt judgment.',
      {
        gate: 'date-table-create-gate',
        status: 'blocked',
        reason: 'date-table-create-requires-coverage-proof',
        tableName: input.name,
      },
    );
  }
}

function looksLikeCalendarTableCreate(input: {
  readonly name: string;
  readonly expression?: string;
  readonly mExpression?: string;
}): boolean {
  // The NAME heuristic is a genuine second signal, NOT redundant with the expression
  // patterns: it catches date tables built via shapes the patterns below miss (e.g.
  // SELECTCOLUMNS of a source date column), routing them to the governed date-table
  // tool. It is an English-language routing convenience (false positives are low-harm —
  // a clear "use the governed tool" message), consistent with the name heuristics used
  // elsewhere in the deterministic layer (grain.ts). NOTE (audit D1, deferred): the
  // token list is English-only; a future improvement could make it configurable for
  // non-English models without weakening this guardrail.
  if (looksLikeCalendarTableName(input.name)) return true;
  const expression = [input.expression, input.mExpression].filter(Boolean).join('\n');
  return (
    /\b(?:CALENDAR|CALENDARAUTO)\s*\(/i.test(expression) ||
    /\bGENERATESERIES\s*\(\s*DATE\s*\(/i.test(expression) ||
    /\bList\.Dates\s*\(/i.test(expression) ||
    /\bList\.Generate\s*\(/i.test(expression)
  );
}

function looksLikeCalendarTableName(name: string): boolean {
  const tokens = tokenizeTableName(name);
  return tokens.some((token) => ['date', 'dates', 'calendar'].includes(token));
}

function tokenizeTableName(name: string): string[] {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

async function enforceMarkAsDateGate(
  mode: 'live' | 'folder',
  model: TMDLModel,
  connection: ConnectionInfo,
  tableName: string,
  dateColumn: string,
  facts: ReadonlyArray<{ readonly tableName: string; readonly dateColumn: string }>,
  futureHorizonDays: number | undefined,
  allowCalendarEndAfterFactMax = false,
): Promise<string[]> {
  const table = model.tables.find((candidate) => candidate.name === tableName);
  const column = table?.columns.find((candidate) => candidate.name === dateColumn);
  if (!table || !column || table.isAutoDateTable || !isTemporalType(column.dataType)) {
    throwDateGateError(
      'Mark-as-date refused: table/column metadata is not a valid governed date key.',
      {
        gate: 'mark-as-date-table-gate',
        tableName,
        dateColumn,
        tableExists: table !== undefined,
        columnExists: column !== undefined,
        isAutoDateTable: table?.isAutoDateTable ?? false,
        dataType: column?.dataType,
      },
    );
  }
  if (mode !== 'live') {
    throwDateGateError('Mark-as-date refused: live date-key proof is required.', {
      gate: 'mark-as-date-table-gate',
      tableName,
      dateColumn,
      reason: 'not-live',
    });
  }
  const requiredFacts = deriveRequiredDateCoverageFacts(model, {
    dateTable: tableName,
    dateColumn,
    facts,
    futureHorizonDays,
  });
  const query = buildDateTableCoverageProbeQuery(model, {
    dateTable: tableName,
    dateColumn,
    facts: requiredFacts,
  });
  if (!query) {
    throwDateGateError('Mark-as-date refused: date key is not probeable.', {
      gate: 'mark-as-date-table-gate',
      tableName,
      dateColumn,
      reason: 'not-probeable',
    });
  }
  let raw: unknown;
  try {
    raw = await getModelDriver().daxQuery(query, connection, { includeRawDiagnostics: true });
  } catch (err) {
    throwDateGateError('Mark-as-date refused: date-table coverage proof failed.', {
      gate: 'mark-as-date-table-gate',
      status: 'blocked',
      reason: 'probe-failed',
      tableName,
      dateColumn,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const evidence = parseDateTableCoverageProbeResult(raw);
  const diagnostics = daxResultDiagnostics(raw);
  const parseShapeBlocker = dateProofParseShapeBlockedPayload(
    diagnostics,
    dateTableCoverageEvidenceRows(evidence),
    1 + requiredFacts.length,
  );
  if (parseShapeBlocker) {
    throwDateGateError('Mark-as-date refused: date-table proof result shape was not recognized.', {
      gate: 'mark-as-date-table-gate',
      tableName,
      dateColumn,
      evidenceRows: dateTableCoverageEvidenceRows(evidence),
      ...parseShapeBlocker,
    });
  }
  const coverage = planDateTableCoverage(
    model,
    {
      dateTable: tableName,
      dateColumn,
      facts: requiredFacts,
      futureHorizonDays,
      allowCalendarEndAfterFactMax,
    },
    evidence,
  );
  // Single-source the allowed-blocker policy from the planner's data-proven readiness signal
  // instead of inlining a code filter here (P2/P3). markReadiness.blockingForMark drops the
  // two pre-mark metadata blockers (date-table-not-marked, date-column-not-key) ONLY when the
  // key is proven from data — so an Import Date table whose isKey write was rejected still
  // marks, while every real proof blocker (blanks/dups/gaps/time/coverage/source/end-after) holds.
  const blockers = coverage.markReadiness.blockingForMark;
  if (blockers.length > 0) {
    throwDateGateError('Mark-as-date refused: date-table coverage/key proof is blocked.', {
      gate: 'mark-as-date-table-gate',
      tableName,
      dateColumn,
      blockers,
      coverage,
      probeDiagnostics: diagnostics,
    });
  }
  // Relay non-blocking caveats (e.g. an unreadable calendar source on a live Import model)
  // so the caller can surface them honestly; they did NOT refuse the mark.
  return coverage.warnings.map((warning) => warning.message);
}

tool(
  'pbi_model_snapshot',
  'Read Live Model',
  'Connect to the model (live Power BI Desktop instance, else folder fallback) and return the full semantic model: tables, columns, measures, relationships. Read-only.',
  { folderPath: MODEL_FOLDER_FIELD, model: MODEL_SELECT_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  async (input) => {
    const snapshot = await snapshotModel(input.folderPath, input.model);
    return {
      mode: snapshot.mode,
      liveTarget: liveTargetSummary(snapshot.mode, snapshot.connection, input.model),
      model: snapshot.model,
    };
  },
);

tool(
  'pbi_model_list_tables',
  'List Tables',
  'List table inventory in the model (live Desktop instance, else folder). Default live mode uses a fast table-only read and returns table-level metadata, with counts when available; opt into full nested field payload only when needed.',
  {
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
    includeColumns: INCLUDE_COLUMNS_FIELD,
    includeMeasures: INCLUDE_MEASURES_FIELD,
  },
  { readOnlyHint: true, idempotentHint: true },
  async (input) => {
    return tableInventoryForRead(input.folderPath, input.model, {
      includeColumns: input.includeColumns,
      includeMeasures: input.includeMeasures,
    });
  },
);

tool(
  'pbi_data_dictionary_get',
  'Get Data Dictionary',
  'Return a read-only canonical data dictionary projection from semantic model metadata only: tables, fields, measures, relationships, counts, and Table[Field] refs. This is model metadata, not business meaning; it never reads rows, executes DAX, or infers formulas, KPIs, ownership, or business definitions.',
  {
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
    includeHidden: z
      .boolean()
      .optional()
      .describe('Include hidden tables, columns, and measures. Defaults to false.'),
    includeExpressions: z
      .boolean()
      .optional()
      .describe('Include DAX expressions for calculated tables, calculated columns, and measures.'),
    includeNested: z
      .boolean()
      .optional()
      .describe(
        'Include duplicate nested fields/measures inside each table. Defaults to false; top-level fields/measures are always returned.',
      ),
    tableNames: z
      .array(z.string())
      .optional()
      .describe('Optional exact table-name filter to keep the metadata payload small.'),
    refs: z
      .array(z.string())
      .optional()
      .describe(
        'Optional exact canonical ref filter such as Table[Field] for columns or measures.',
      ),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  async (input) => {
    const snapshot = await snapshotModel(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    return {
      mode: snapshot.mode,
      ...buildDataDictionary(snapshot.model, {
        includeHidden: input.includeHidden,
        includeExpressions: input.includeExpressions,
        includeNested: input.includeNested,
        tableNames: input.tableNames,
        refs: input.refs,
      }),
    };
  },
);

tool(
  'pbi_model_plan_star_schema_join',
  'Plan Star-Schema Join',
  'Return a deterministic star-schema/shared-dimension plan for a cross-fact join or TREATAS/MOD009/MOD010 remediation. Read-only: this tool does not write anything. It returns the proposed design, blockers, dimensions, key-column writes, relationship create writes, relationship repair writes, hide-FK writes, and whether a direct fact relationship is allowed. If the requested tables also expose shared temporal axes, the plan includes dateAxisRequirement: one governed Date table shared by every participating fact is required; LocalDateTable relationships are not a conformed report axis, so use pbi_date_table_create_governed rather than manual Date-table or relationship steps.',
  {
    leftTable: z.string().describe('First table in the requested join.'),
    rightTable: z.string().describe('Second table in the requested join.'),
    axes: z
      .array(z.string())
      .optional()
      .describe(
        'Optional shared axes/key column names to evaluate. If omitted, the planner considers shared column names from the model snapshot.',
      ),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  async (input) => {
    const { mode, model, connection } = await snapshotModel(input.folderPath, input.model);
    const plan = (await planStarSchemaJoin(model, {
      leftTable: input.leftTable,
      rightTable: input.rightTable,
      axes: input.axes,
    })) as Record<string, unknown>;
    const blockers = records(plan.blockers);
    return {
      mode,
      plan,
      ...(hasMissingTableReason(blockers)
        ? {
            diagnostics: tableMissingDiagnostics({
              reason: 'planner-table-not-found',
              mode,
              model,
              connection,
              modelSelector: input.model,
              requestedTables: [input.leftTable, input.rightTable],
            }),
          }
        : {}),
    };
  },
);

tool(
  'pbi_model_plan_actuals_targets_join',
  'Plan Actuals/Targets Join',
  'Return a deterministic read-only actuals/targets join readiness plan that combines star-schema shared-dimension planning with batched date-grain proof before asking the user any grain question. It routes temporal axes to date-grain planning, routes non-temporal axes to star-schema planning, and requires one governed Date table shared by every participating fact before reporting ready. Auto LocalDateTable relationships are not a conformed actuals/targets date axis; when dateAxisRequirement says governed-date-table-required, use pbi_date_table_create_governed for the Date table and relationships. Ask only for unobservable business policy such as allocation or missing-target behavior.',
  {
    leftTable: z.string().describe('Actuals/source table in the requested comparison.'),
    rightTable: z.string().describe('Targets/source table in the requested comparison.'),
    axes: z
      .array(z.string())
      .optional()
      .describe(
        'Optional shared axes/key column names to evaluate. Temporal axes are routed to date-grain planning; non-temporal axes are routed to star-schema shared dimensions. If omitted, the tool discovers same-name shared columns from metadata.',
      ),
    dateRefs: z
      .array(
        z.object({
          tableName: z.string().describe('Fact-like table containing the date column.'),
          dateColumn: z.string().describe('Date/dateTime column to include in the grain proof.'),
        }),
      )
      .optional()
      .describe(
        'Optional explicit actual/target date columns. Use only when metadata has no same-name shared temporal column or multiple date roles require a specific role.',
      ),
    dateTable: z
      .string()
      .optional()
      .describe('Optional existing governed Date table to validate for coverage.'),
    dateColumn: z
      .string()
      .optional()
      .describe('Optional date column on dateTable for coverage validation.'),
    futureHorizonDays: FUTURE_HORIZON_DAYS_FIELD,
    probeData: z
      .boolean()
      .optional()
      .describe('Defaults to true. Set false only for metadata-only planning without live proof.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  (input) => planActualsTargetsJoin(input),
);

tool(
  'pbi_model_apply_star_schema_join',
  'Apply Star-Schema Join',
  'Batch-apply or dry-run a deterministic planner-backed shared-dimension star-schema remediation to a live Power BI Desktop model. Requires explicit axes, re-plans from the targeted live model, refuses planner blockers, creates/reuses calculated dimensions, refreshes calculated metadata, hardens dimension key data types, configures keys, repairs/creates single-direction many-to-one relationships, hides fact-side FK fields, and validates the final state. If the model also has shared temporal axes, the response carries dateAxisRequirement and is date-axis incomplete until one governed Date table is shared by every participating fact; LocalDateTable relationships are not sufficient, so use pbi_date_table_create_governed for the Date table and Date relationships.',
  {
    leftTable: z.string().describe('First fact/source table in the requested cross-fact join.'),
    rightTable: z.string().describe('Second fact/source table in the requested cross-fact join.'),
    axes: z
      .array(z.string())
      .min(1)
      .describe(
        'Explicit shared axes/key column names to apply. Required for writes so accidental same-name columns are not remediated silently.',
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe('When true, returns the executable write plan and performs no writes.'),
    refreshAfterCreate: z
      .boolean()
      .optional()
      .describe('Defaults to true in live mode after calculated dimension creation.'),
    runModelCheck: z
      .boolean()
      .optional()
      .describe(
        'Optional. When true, also returns pbi_model_check/modelDoctor output after targeted validation passes.',
      ),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: false },
  (input) => applyStarSchemaJoin(input),
);

tool(
  'pbi_model_plan_date_grain',
  'Plan Date Grain',
  'Return a deterministic date-grain plan for fact date columns before activating date relationships, simplifying target/actual measures, or before asking the user to choose target grain/day/month/year. In live mode it runs one generated read-only DAX probe for all requested facts; in folder mode it fails closed with metadata-only guidance. Use observedGrain/probeStatus as the evidence for observable date grain. If proof fails, is incomplete, or returns parse-shape-unrecognized/evidenceRows:0 from the ROW()-based proof, report the structured blocker/status and STOP before Date relationship activation or measure rewrite; do not claim the model is empty, use pbi_dax_query/manual DAX/pbi_model_refresh, retry with probeData:false, or fall back to primitive Date/relationship writes. Ask the user only for business semantics the model cannot prove, such as allocation or missing-target behavior. It also reports auto date tables so agents can avoid slow, repetitive LocalDateTable inventories.',
  {
    facts: z
      .array(
        z.object({
          tableName: z.string().describe('Fact-like table to inspect.'),
          dateColumn: z.string().describe('Date/dateTime column on that fact-like table.'),
        }),
      )
      .min(1)
      .describe(
        'Fact date columns to probe. Batch related actual/target facts here so the tool can use one live DAX query.',
      ),
    dateTable: z
      .string()
      .optional()
      .describe('Optional governed date dimension table to evaluate relationships against.'),
    dateColumn: z
      .string()
      .optional()
      .describe('Optional governed date dimension key column to evaluate relationships against.'),
    futureHorizonDays: FUTURE_HORIZON_DAYS_FIELD,
    probeData: z
      .boolean()
      .optional()
      .describe(
        'Defaults to true. In live mode, run one read-only DAX proof to prove observed date grain. Set false only for an initial metadata-only plan; never use probeData:false as recovery after failed, incomplete, or parse-shape proof.',
      ),
    scanMeasures: z
      .boolean()
      .optional()
      .describe(
        'Defaults to false for low latency. Set true only when planning to rewrite measures and you want candidate date-truncating TREATAS measures returned.',
      ),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  (input) => planDateGrainForRead(input),
);

tool(
  'pbi_model_plan_date_table',
  'Plan Date Table Coverage',
  'Return a deterministic coverage plan for a governed Date table before editing calendar bounds, marking a date table, disabling auto date/time, or relying on Date-table fields for target/actual analysis. In live mode it runs one read-only DAX proof over the date table and the complete model-derived fact-date coverage set. It blocks volatile TODAY()/NOW()/M current-date anchors, literal hardcoded calendar bounds, blanks, duplicate date keys, gaps, and Date tables that do not cover observed fact min/max dates. Date ranges extending beyond observed fact max dates require explicit futureHorizonDays. A blocked, non-succeeded, or parse-shape-unrecognized proof is not actionable coverage evidence; report it and STOP with no calendar edit, mark-as-date, pbi_dax_query/manual DAX/pbi_model_refresh fallback, probeData:false retry, or primitive Date write.',
  {
    dateTable: z.string().describe('Governed Date/Calendar table to validate.'),
    dateColumn: z.string().describe('Daily date key column on the governed Date/Calendar table.'),
    facts: z
      .array(
        z.object({
          tableName: z.string().describe('Fact-like table whose date range must be covered.'),
          dateColumn: z.string().describe('Date/dateTime column on that fact-like table.'),
        }),
      )
      .min(1)
      .describe(
        'Seed fact date columns to prove coverage against. The tool expands this list to every model-derived fact-date column that must be covered.',
      ),
    futureHorizonDays: FUTURE_HORIZON_DAYS_FIELD,
    probeData: z
      .boolean()
      .optional()
      .describe(
        'Defaults to true. In live mode, run one exact read-only DAX proof. Set false only for an initial metadata-only plan; writes must not rely on skipped proof, and probeData:false is forbidden as recovery after failed, incomplete, or parse-shape proof.',
      ),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  (input) => planDateTableForRead(input),
);

tool(
  'pbi_date_table_create_governed',
  'Create Governed Date Table',
  'Create, optionally refresh with explicit refreshBeforeProbe authorization, prove, harden metadata, mark, and optionally relate a governed Date table in the live model. This is the only write path for new Date/Calendar tables. It asks for clarifyingQuestions instead of writing when calendar policy or refreshBeforeProbe policy is ambiguous, generates dynamic fact-anchored DAX from supplied date columns, never uses literal guessed DATE bounds or TODAY()/NOW(), never refreshes before proof unless refreshBeforeProbe is explicitly true, writes explicit generated-column dataType/summarize/sort metadata, marks the table as a Date table, and creates single-direction many-to-one fact date relationships when requested. Import models may reject the column isKey write; table dataCategory:Time plus live unique/continuous Date-key proof is accepted. For multiple date roles on one fact table, the first role is active and later roles are inactive. If proof blocks or returns proof-parse-shape-unrecognized/evidenceRows:0 from the ROW()-based proof, report that blocker verbatim and STOP; do not claim the model is empty, use pbi_dax_query/manual DAX/pbi_model_refresh, retry with probeData:false, or reconstruct the Date table through pbi_table_create/pbi_column_update/pbi_relationship_create primitives.',
  {
    tableName: z.string().describe('Name of the Date/Calendar table to create.'),
    dateColumn: z
      .string()
      .describe('Name of the date key column to create and mark on the Date table.'),
    facts: z
      .array(
        z.object({
          tableName: z.string().describe('Fact-like table whose dates drive calendar coverage.'),
          dateColumn: z.string().describe('Date/dateTime column on that fact-like table.'),
        }),
      )
      .min(1)
      .describe(
        'Fact date columns that must be covered. Pass all actual/target/budget/forecast date columns involved in the analysis.',
      ),
    rangePolicy: z
      .enum([
        'observed-min-max',
        'observed-full-years',
        'observed-min-max-plus-future-horizon',
        'observed-full-years-plus-future-horizon',
      ])
      .optional()
      .describe(
        'Explicit calendar policy. Omit to get clarifyingQuestions instead of a write. No silent default is allowed.',
      ),
    futureHorizonDays: FUTURE_HORIZON_DAYS_FIELD,
    refreshBeforeProbe: z
      .boolean()
      .optional()
      .describe(
        'Explicit pre-proof refresh policy. If omitted, the tool returns needs-user-input. Set true only when refresh is authorized; set false to prove without pre-probe refresh.',
      ),
    createRelationships: z
      .boolean()
      .optional()
      .describe(
        'Defaults to true. Create single-direction many-to-one relationships from each fact date column to the new Date table; for multiple date roles on one fact table, the first role is active and later roles are inactive.',
      ),
    description: z.string().optional().describe('Optional table description.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: false },
  (input) => createGovernedDateTable(input),
);

tool(
  'pbi_model_refresh',
  'Refresh Live Model',
  'Refresh/process the connected live Power BI Desktop semantic model through the Microsoft Modeling MCP only when the user explicitly authorizes processing/import refresh. Requires confirmReprocess:true (an explicit per-call authorization) because a refresh re-processes Import data and can change every measure value and probe result. Use this instead of asking the user to click Refresh when a modeling workflow needs Import data materialized. Never use this as a fallback after proof-parse-shape-unrecognized, parse-shape-unrecognized/evidenceRows:0 from a ROW()-based Date proof, or any Date proof blocker that instructs STOP. Folder mode is refused because refresh is a live engine operation.',
  {
    refreshType: z
      .enum(['Automatic', 'Full', 'Calculate'])
      .optional()
      .describe('Defaults to Automatic. Use Calculate after calculated-table metadata writes.'),
    confirmReprocess: z
      .boolean()
      .optional()
      .describe(
        'Must be explicitly true to authorize the reprocess. A refresh re-materializes Import data and can change measure values and probe results, so it is gated behind this per-call consent rather than being callable as a silent fallback.',
      ),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: true },
  async (input) => {
    // Deterministic authorization backstop: a result-affecting reprocess must carry an
    // explicit confirmReprocess:true, so an agent cannot invoke it as a silent fallback
    // (e.g. to turn a parse-shape-unrecognized STOP into a re-probe). Mirrors the
    // refreshBeforeProbe gate used inside the governed Date-create path.
    if (input.confirmReprocess !== true) {
      throwInputValidationError(
        'Model refresh refused: a reprocess re-materializes Import data and can change measure values, so it requires explicit authorization. Re-call with confirmReprocess:true only when the user has approved processing/import refresh.',
        {
          tool: 'pbi_model_refresh',
          reason: 'refresh-not-authorized',
        },
      );
    }
    const drv = getModelDriver();
    const connection = await connectModel(drv, input.folderPath, input.model);
    if (connection.mode !== 'live') {
      throwInputValidationError('Model refresh refused: refresh requires a live Desktop model.', {
        tool: 'pbi_model_refresh',
        reason: 'not-live',
        mode: connection.mode,
      });
    }
    return {
      refreshed: true,
      mode: connection.mode,
      refreshType: input.refreshType ?? 'Automatic',
      result: await drv.refreshModel(input.refreshType ?? 'Automatic', connection),
    };
  },
);

tool(
  'pbi_model_list_columns',
  'List Columns',
  'List the columns in the model (live Desktop instance, else folder). Read-only.',
  { folderPath: MODEL_FOLDER_FIELD, model: MODEL_SELECT_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  async (input) => {
    const { mode, model } = await snapshotModel(input.folderPath, input.model, {
      includeMeasures: false,
      includeRoles: false,
    });
    return { mode, columns: model.tables.flatMap((t) => t.columns) };
  },
);

tool(
  'pbi_model_list_measures',
  'List Measures',
  'List the measures in the model (live Desktop instance, else folder). Read-only.',
  { folderPath: MODEL_FOLDER_FIELD, model: MODEL_SELECT_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  async (input) => {
    const { mode, model } = await snapshotModel(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    return { mode, measures: model.tables.flatMap((t) => t.measures) };
  },
);

tool(
  'pbi_model_list_relationships',
  'List Relationships',
  'List the relationships in the model (live Desktop instance, else folder). Read-only.',
  { folderPath: MODEL_FOLDER_FIELD, model: MODEL_SELECT_FIELD },
  { readOnlyHint: true, idempotentHint: true },
  async (input) => {
    const { mode, model } = await snapshotModel(input.folderPath, input.model, {
      includeMeasures: false,
      includeRoles: false,
    });
    return { mode, relationships: model.relationships };
  },
);

tool(
  'pbi_dax_query',
  'Execute DAX Query (read-only)',
  'Run a read-only DAX query against the connected model and return the normalized result. For ad-hoc inspection/aggregate checks only; not a write path, not a Date-table proof fallback, not a date-grain diagnostic, and does not authorize Date writes. If pbi_date_table_create_governed, pbi_model_plan_date_table, or pbi_model_plan_date_grain blocks, returns incomplete proof, or returns proof-parse-shape-unrecognized/parse-shape-unrecognized/evidenceRows:0 from a ROW()-based proof, report that structured blocker/status and stop. Do not use pbi_dax_query, manual DAX, primitive Date writes, or relationship writes to bypass the governed Date proof.',
  {
    query: z.string().describe('A DAX query (e.g. EVALUATE ...).'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { readOnlyHint: true, idempotentHint: true },
  async (input) => {
    const drv = getModelDriver();
    const connection = await connectModel(drv, input.folderPath, input.model);
    return drv.daxQuery(input.query, connection);
  },
);

tool(
  'pbi_measure_create',
  'Create Measure (DAX-gated)',
  'Create a measure on the connected model. HARD GATE: confirmed measure intent is required before DAX is accepted, and time-intelligence DAX requires confirmed Date policy evidence. Then an in-code DAX-reference check runs against the live model — if the expression references a table/column/measure that does not exist (or is ambiguous), the create is REFUSED and nothing is written. On success in live mode the measure appears in Desktop immediately; press Ctrl+S to persist live semantic-model metadata. In folder mode, call pbi_model_export.',
  {
    tableName: z.string().describe('Home table for the measure.'),
    name: z.string().describe('Measure name (must be unique in the model).'),
    expression: z.string().describe('DAX expression.'),
    measureIntent: MEASURE_INTENT_FIELD,
    formatString: z.string().optional().describe('Format string (bare TMDL backslash form).'),
    description: z.string().optional().describe('Optional measure description.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: false },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    assertTableExistsForWrite({
      tool: 'pbi_measure_create',
      action: 'Measure create',
      tableName: input.tableName,
      mode,
      model,
      connection,
      modelSelector: input.model,
    });
    assertMeasureNameDoesNotCollideWithColumn({
      tool: 'pbi_measure_create',
      tableName: input.tableName,
      measureName: input.name,
      model,
    });
    enforceMeasureIntentForWrite(
      'pbi_measure_create',
      input.name,
      input.expression,
      input.measureIntent,
      model,
    );
    const blankRiskWarning = await enforceTimeIntelligenceNotBlankInDefaultContext(
      connection,
      model,
      'pbi_measure_create',
      input.name,
      input.expression,
      input.measureIntent,
    );
    const check = daxReferenceCheck(input.expression, model, { hostTable: input.tableName });
    if (!check.valid) {
      const err = new Error(
        `Refused: measure "${input.name}" references fields not present in the model.`,
      ) as Error & { report?: unknown };
      err.report = daxReferenceCheckReport({
        check,
        mode,
        model,
        connection,
        modelSelector: input.model,
      });
      throw err;
    }
    const result = await drv.createMeasure(
      {
        tableName: input.tableName,
        name: input.name,
        expression: input.expression,
        formatString: input.formatString,
        description: input.description,
      },
      connection,
    );
    return {
      created: true,
      mode,
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      // Surface the blank-risk probe-failure warning so a "could not verify" is not lost
      // (the gate returns it instead of failing open silently when the probe errors).
      ...(blankRiskWarning ? { blankRiskWarning } : {}),
      result,
    };
  },
);

tool(
  'pbi_measure_create_batch',
  'Create Measures Batch (DAX-gated)',
  'Create multiple measures on the connected model in array order. Each measure runs the same table, confirmed intent, time-intelligence, and DAX-reference gate as pbi_measure_create; any measure that fails a gate is refused and reported without aborting later measures. Put base measures before dependent measures so intra-batch references can resolve. On success in live mode the measures appear in Desktop immediately; press Ctrl+S to persist live semantic-model metadata. In folder mode, call pbi_model_export.',
  {
    measures: z
      .array(
        z.object({
          tableName: z.string().describe('Home table for the measure.'),
          name: z.string().describe('Measure name (must be unique in the model).'),
          expression: z.string().describe('DAX expression.'),
          measureIntent: MEASURE_INTENT_FIELD,
          formatString: z.string().optional().describe('Format string (bare TMDL backslash form).'),
          description: z.string().optional().describe('Optional measure description.'),
        }),
      )
      .min(1)
      .describe('Measures to create, ordered with base measures before dependents.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: false },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    let workingModel = model;
    const seen = new Set<string>();
    const measuresCreated: Array<Record<string, unknown>> = [];
    const measuresRefused: Array<Record<string, unknown>> = [];

    for (const measure of input.measures) {
      try {
        const measureKey = `${normalizeModelObjectName(measure.tableName)}\u0000${normalizeModelObjectName(measure.name)}`;
        if (seen.has(measureKey)) {
          throwInputValidationError(
            `Measure create batch refused: duplicate measure "${measure.name}" in table "${measure.tableName}".`,
            {
              tool: 'pbi_measure_create_batch',
              reason: 'batch-duplicate-name',
              tableName: measure.tableName,
              measureName: measure.name,
            },
          );
        }
        assertTableExistsForWrite({
          tool: 'pbi_measure_create_batch',
          action: 'Measure create',
          tableName: measure.tableName,
          mode,
          model: workingModel,
          connection,
          modelSelector: input.model,
        });
        assertMeasureNameDoesNotCollideWithColumn({
          tool: 'pbi_measure_create_batch',
          tableName: measure.tableName,
          measureName: measure.name,
          model: workingModel,
        });
        enforceMeasureIntentForWrite(
          'pbi_measure_create_batch',
          measure.name,
          measure.expression,
          measure.measureIntent,
          workingModel,
        );
        const blankRiskWarning = await enforceTimeIntelligenceNotBlankInDefaultContext(
          connection,
          workingModel,
          'pbi_measure_create_batch',
          measure.name,
          measure.expression,
          measure.measureIntent,
        );
        const check = daxReferenceCheck(measure.expression, workingModel, {
          hostTable: measure.tableName,
        });
        if (!check.valid) {
          const err = new Error(
            `Refused: measure "${measure.name}" references fields not present in the model.`,
          ) as Error & { report?: unknown };
          err.report = daxReferenceCheckReport({
            check,
            mode,
            model: workingModel,
            connection,
            modelSelector: input.model,
          });
          throw err;
        }
        const definition = {
          tableName: measure.tableName,
          name: measure.name,
          expression: measure.expression,
          formatString: measure.formatString,
          description: measure.description,
        };
        const result = await drv.createMeasure(definition, connection);
        workingModel = stageCreatedMeasure(workingModel, definition);
        seen.add(measureKey);
        measuresCreated.push({
          tableName: measure.tableName,
          name: measure.name,
          ...(blankRiskWarning ? { blankRiskWarning } : {}),
          result,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const report =
          err !== null && typeof err === 'object' && 'report' in err
            ? (err as { report?: unknown }).report
            : undefined;
        if (report === undefined || report === null || typeof report !== 'object') {
          throw err;
        }
        measuresRefused.push({
          ...(report as Record<string, unknown>),
          tableName: measure.tableName,
          name: measure.name,
          error: message,
        });
      }
    }

    return {
      created: measuresCreated.length,
      refused: measuresRefused.length,
      mode,
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      measuresCreated,
      measuresRefused,
    };
  },
);

tool(
  'pbi_measure_update',
  'Update Measure (DAX-gated)',
  'Update an existing measure. Confirmed measure intent is required for every update, including metadata-only changes. If a new expression is supplied, time-intelligence DAX requires confirmed Date policy evidence and the expression passes the same in-code DAX-reference gate as create.',
  {
    tableName: z.string().describe('Home table of the measure.'),
    name: z.string().describe('Measure name to update.'),
    expression: z.string().optional().describe('New DAX expression.'),
    measureIntent: MEASURE_INTENT_FIELD,
    formatString: z.string().optional(),
    description: z.string().optional(),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: true },
  async (input) => {
    if (
      input.expression === undefined &&
      input.formatString === undefined &&
      input.description === undefined
    ) {
      throwInputValidationError('Measure update refused: no mutable fields were supplied.', {
        tool: 'pbi_measure_update',
        reason: 'no-fields-to-update',
        requiredOneOf: ['expression', 'formatString', 'description'],
      });
    }
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    assertTableExistsForWrite({
      tool: 'pbi_measure_update',
      action: 'Measure update',
      tableName: input.tableName,
      mode,
      model,
      connection,
      modelSelector: input.model,
    });
    enforceMeasureIntentForWrite(
      'pbi_measure_update',
      input.name,
      input.expression,
      input.measureIntent,
      model,
    );
    let blankRiskWarning: string | undefined;
    if (input.expression !== undefined) {
      blankRiskWarning = await enforceTimeIntelligenceNotBlankInDefaultContext(
        connection,
        model,
        'pbi_measure_update',
        input.name,
        input.expression,
        input.measureIntent,
      );
      const check = daxReferenceCheck(input.expression, model, { hostTable: input.tableName });
      if (!check.valid) {
        const missingTables = missingDaxReferenceTables(check.missing, model);
        const err = new Error(
          `Refused: measure "${input.name}" references fields not present in the model.`,
        ) as Error & { report?: unknown };
        err.report = {
          gate: 'dax-reference-check',
          missing: check.missing,
          ambiguous: check.ambiguous,
          unsupported: check.unsupported,
          ...(missingTables.length > 0
            ? {
                diagnostics: tableMissingDiagnostics({
                  reason: 'dax-reference-table-not-found',
                  mode,
                  model,
                  connection,
                  modelSelector: input.model,
                  requestedTables: missingTables,
                }),
              }
            : {}),
        };
        throw err;
      }
    }
    const result = await drv.updateMeasure(
      {
        tableName: input.tableName,
        name: input.name,
        expression: input.expression,
        formatString: input.formatString,
        description: input.description,
      },
      connection,
    );
    return {
      updated: true,
      mode,
      ...(blankRiskWarning ? { blankRiskWarning } : {}),
      result,
    };
  },
);

// --- DELETE-DEPENDENCY PRE-FLIGHT (non-blocking advisory) ----------------
// Surface what currently depends on a delete target WITHOUT refusing the
// delete. The engine still does the authoritative post-hoc validation; these
// warnings just give the agent/user a heads-up about likely breakage.
//
// Reference detection reuses the exported daxReferenceCheck (NO new DAX parser):
// we compare reference resolution of each expression against the full model vs.
// a model with the delete target removed. A reference that resolves in the full
// model but becomes missing/ambiguous once the target is gone is a dependency.
// Everything is dataset-agnostic — only the model's own names drive the result.

function unresolvedRefCount(expression: string, model: TMDLModel, hostTable?: string): number {
  const result = daxReferenceCheck(expression, model, hostTable ? { hostTable } : {});
  return result.missing.length + result.ambiguous.length;
}

// True when removing the target breaks a reference that the full model resolved.
function expressionDependsOnTarget(
  expression: string,
  fullModel: TMDLModel,
  modelWithoutTarget: TMDLModel,
  hostTable?: string,
): boolean {
  if (!expression) return false;
  const before = unresolvedRefCount(expression, fullModel, hostTable);
  const after = unresolvedRefCount(expression, modelWithoutTarget, hostTable);
  return after > before;
}

function modelWithoutTable(model: TMDLModel, tableName: string): TMDLModel {
  return {
    ...model,
    tables: model.tables.filter((table) => table.name !== tableName),
    relationships: model.relationships.filter(
      (rel) => rel.fromTable !== tableName && rel.toTable !== tableName,
    ),
  };
}

function modelWithoutColumn(model: TMDLModel, tableName: string, columnName: string): TMDLModel {
  return {
    ...model,
    tables: model.tables.map((table) =>
      table.name === tableName
        ? { ...table, columns: table.columns.filter((col) => col.name !== columnName) }
        : table,
    ),
  };
}

function modelWithoutMeasure(model: TMDLModel, tableName: string, measureName: string): TMDLModel {
  return {
    ...model,
    tables: model.tables.map((table) =>
      table.name === tableName
        ? { ...table, measures: table.measures.filter((m) => m.name !== measureName) }
        : table,
    ),
  };
}

// Iterate every measure + calculated-column expression and report those that
// depend on the target. `pruned` is the model with the target already removed.
function dependentExpressionWarnings(
  fullModel: TMDLModel,
  pruned: TMDLModel,
  label: (kind: 'measure' | 'calculated column', table: string, name: string) => string,
): string[] {
  const warnings: string[] = [];
  for (const table of fullModel.tables) {
    for (const measure of table.measures) {
      if (expressionDependsOnTarget(measure.expression, fullModel, pruned, table.name)) {
        warnings.push(label('measure', table.name, measure.name));
      }
    }
    for (const column of table.columns) {
      if (
        column.expression &&
        expressionDependsOnTarget(column.expression, fullModel, pruned, table.name)
      ) {
        warnings.push(label('calculated column', table.name, column.name));
      }
    }
  }
  return warnings;
}

// Each compute* helper is wrapped so a failure degrades to [] — the delete must
// never regress because dependency computation threw.
function computeTableDeleteDependencyWarnings(model: TMDLModel, tableName: string): string[] {
  try {
    const warnings: string[] = [];
    for (const rel of model.relationships) {
      if (rel.fromTable === tableName || rel.toTable === tableName) {
        warnings.push(
          `relationship "${rel.id}" (${rel.fromTable}[${rel.fromColumn}] -> ${rel.toTable}[${rel.toColumn}]) uses this table`,
        );
      }
    }
    const pruned = modelWithoutTable(model, tableName);
    warnings.push(
      ...dependentExpressionWarnings(
        model,
        pruned,
        (kind, table, name) => `${kind} "${table}[${name}]" references this table`,
      ),
    );
    return warnings;
  } catch {
    return [];
  }
}

function computeColumnDeleteDependencyWarnings(
  model: TMDLModel,
  tableName: string,
  columnName: string,
): string[] {
  try {
    const warnings: string[] = [];
    for (const rel of model.relationships) {
      const isFrom = rel.fromTable === tableName && rel.fromColumn === columnName;
      const isTo = rel.toTable === tableName && rel.toColumn === columnName;
      if (isFrom || isTo) {
        warnings.push(
          `relationship "${rel.id}" (${rel.fromTable}[${rel.fromColumn}] -> ${rel.toTable}[${rel.toColumn}]) uses this column`,
        );
      }
    }
    const pruned = modelWithoutColumn(model, tableName, columnName);
    warnings.push(
      ...dependentExpressionWarnings(
        model,
        pruned,
        (kind, table, name) => `${kind} "${table}[${name}]" references this column`,
      ),
    );
    return warnings;
  } catch {
    return [];
  }
}

function computeMeasureDeleteDependencyWarnings(
  model: TMDLModel,
  tableName: string,
  measureName: string,
): string[] {
  try {
    const pruned = modelWithoutMeasure(model, tableName, measureName);
    return dependentExpressionWarnings(
      model,
      pruned,
      (kind, table, name) => `${kind} "${table}[${name}]" references this measure`,
    );
  } catch {
    return [];
  }
}

function computeRelationshipDeleteDependencyWarnings(
  model: TMDLModel,
  relationship: TMDLRelationship,
): string[] {
  try {
    const warnings: string[] = [];
    if (relationship.isActive) {
      warnings.push(
        `relationship is active; filter propagation between ${relationship.fromTable} and ${relationship.toTable} will be lost`,
      );
    }
    if (relationship.crossFilteringBehavior === 'both') {
      warnings.push(
        `relationship is bidirectional; cross-filtering between ${relationship.fromTable} and ${relationship.toTable} will be lost`,
      );
    }
    return warnings;
  } catch {
    return [];
  }
}

tool(
  'pbi_measure_delete',
  'Delete Measure',
  'Delete a measure from the connected model.',
  {
    tableName: z.string().describe('Home table of the measure.'),
    name: z.string().describe('Measure name to delete.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: true, idempotentHint: false },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    assertTableExistsForWrite({
      tool: 'pbi_measure_delete',
      action: 'Measure delete',
      tableName: input.tableName,
      mode,
      model,
      connection,
      modelSelector: input.model,
    });
    const dependencyWarnings = computeMeasureDeleteDependencyWarnings(
      model,
      input.tableName,
      input.name,
    );
    const result = await drv.deleteMeasure(
      { tableName: input.tableName, name: input.name },
      connection,
    );
    return { deleted: true, mode, dependencyWarnings, result };
  },
);

// --- LIVE WRITE: TABLES --------------------------------------------------

tool(
  'pbi_table_create',
  'Create Table',
  'Create a non-Date table on the connected model. Pass `mExpression` for a Power Query (M) partition, or `expression` for a DAX calculated table (for example, SUMMARIZE/SELECTCOLUMNS/ADDCOLUMNS). A calculated-table expression defines the table AND its columns in its own row context, so it is validated by the modeling engine on create (invalid DAX is rejected with a clear error and nothing is written) — no pre-flight reference gate runs. HARD GATE: Date/calendar table creation is refused through this primitive tool, including dynamic-looking calculated sources; use pbi_date_table_create_governed for new Date/Calendar tables and pbi_model_plan_date_table for existing Date-table coverage checks. Do not manually replay cross-fact/shared-dimension star-schema table writes with this primitive tool; use pbi_model_apply_star_schema_join with explicit axes for cross-fact joins. On success in live mode the table appears in Desktop immediately; press Ctrl+S to persist live semantic-model metadata. In folder mode, call pbi_model_export.',
  {
    name: z.string().describe('Table name (must be unique in the model).'),
    mode: z
      .string()
      .optional()
      .describe('Storage mode (e.g. "import"). Defaults to the model default when omitted.'),
    mExpression: z
      .string()
      .optional()
      .describe('Power Query (M) partition expression for an imported/query table.'),
    expression: z
      .string()
      .optional()
      .describe(
        'DAX expression for a non-Date calculated table. Defines the table and its columns; validated by the engine on create.',
      ),
    description: z.string().optional().describe('Optional table description.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: false },
  async (input) => {
    if ((input.mExpression === undefined) === (input.expression === undefined)) {
      throwInputValidationError(
        'Table create refused: supply exactly one source expression, either mExpression or expression.',
        {
          tool: 'pbi_table_create',
          reason: 'invalid-source-expression-count',
          requiredExactlyOneOf: ['mExpression', 'expression'],
        },
      );
    }
    enforceNoVolatileCalendarTableCreate({
      name: input.name,
      expression: input.expression,
      mExpression: input.mExpression,
    });
    const drv = getModelDriver();
    const conn = await connectModel(drv, input.folderPath, input.model);
    const mode = conn.mode;
    const result = await drv.createTable(
      {
        name: input.name,
        mode: input.mode,
        mExpression: input.mExpression,
        expression: input.expression,
        description: input.description,
      },
      conn,
    );
    return {
      created: true,
      mode,
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      result,
    };
  },
);

tool(
  'pbi_table_update',
  'Update Table',
  'Update an existing table: rename, edit description, or toggle visibility. Direct `dataCategory:"Time"` writes are REFUSED because they bypass the Date-table continuity/coverage gate; use pbi_table_mark_as_date with fact coverage inputs. On success in live mode the change appears in Desktop immediately; press Ctrl+S to persist live semantic-model metadata. In folder mode, call pbi_model_export.',
  {
    name: z.string().describe('Table name to update.'),
    newName: z.string().optional().describe('New table name (rename).'),
    description: z.string().optional().describe('New table description.'),
    isHidden: z.boolean().optional().describe('Hide or show the table.'),
    dataCategory: z
      .string()
      .optional()
      // UNVERIFIED: MS-MCP `dataCategory` (table Update) key inferred (see TableUpdate in model-driver).
      .describe(
        'Table semantic category. `"Time"` is refused here; use pbi_table_mark_as_date with fact coverage inputs so the Date-table gate runs.',
      ),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: true },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    enforceNoDirectDateTableMetadataWrite(model, {
      kind: 'table',
      tableName: input.name,
      dataCategory: input.dataCategory,
    });
    assertTableExistsForWrite({
      tool: 'pbi_table_update',
      action: 'Table update',
      tableName: input.name,
      mode,
      model,
      connection,
      modelSelector: input.model,
    });
    const result = await drv.updateTable(
      {
        name: input.name,
        newName: input.newName,
        description: input.description,
        isHidden: input.isHidden,
        dataCategory: input.dataCategory,
      },
      connection,
    );
    return {
      updated: true,
      mode,
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      result,
    };
  },
);

tool(
  'pbi_table_mark_as_date',
  'Mark As Date Table',
  'Mark a table as the model date table so time-intelligence (DATEADD/SAMEPERIODLASTYEAR/TOTALYTD, etc.) works. HARD GATE: the chosen date key must be proven live as a continuous unique daily date/dateTime column with no blanks, duplicates, gaps, or auto-date table target, and the Date table must cover observed min/max dates for the complete model-derived fact-date coverage set, not just the caller-supplied sample. Volatile current-date anchors and literal hardcoded calendar bounds are refused. Folder-mode marking is refused because coverage cannot be proven. If coverage/key proof blocks or returns proof-parse-shape-unrecognized, report the blocker and STOP; do not use primitive table/column updates. Sets the table `dataCategory` to "Time" and attempts `isKey` on the given date column; Import models may reject the `isKey` write, in which case the live proof remains authoritative. Idempotent — re-marking an already-marked table is a no-op. On success in live mode the change appears in Desktop immediately; press Ctrl+S to persist live semantic-model metadata.',
  {
    tableName: z.string().describe('Table to mark as the date table.'),
    dateColumn: z
      .string()
      .describe('The continuous daily date column on that table to mark as the key (isKey).'),
    facts: z
      .array(
        z.object({
          tableName: z.string().describe('Fact-like table whose date range must be covered.'),
          dateColumn: z.string().describe('Date/dateTime column on that fact-like table.'),
        }),
      )
      .min(1)
      .describe(
        'Seed fact date columns that the governed Date table must cover. Required so the live coverage gate can expand to the complete model-derived coverage set and prove observed min/max before marking.',
      ),
    futureHorizonDays: FUTURE_HORIZON_DAYS_FIELD,
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: true },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    // Circular-proof short-circuit (P4/P2): a table our governed creator already proved and
    // marked carries the governedByTool stamp. Honor the advertised idempotent no-op and skip
    // the heavy coverage re-probe — but still CONFIRM dataCategory='Time' on the fresh snapshot
    // so we never report a stale no-op as success.
    const preTable = model.tables.find((candidate) => candidate.name === input.tableName);
    if (
      preTable !== undefined &&
      readGovernedDatePolicy(preTable).governedByTool &&
      looksLikeGovernedDateEndpoint(model, input.tableName, input.dateColumn)
    ) {
      return {
        marked: true,
        alreadyMarked: true,
        mode,
        persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      };
    }
    const markGateWarnings = await enforceMarkAsDateGate(
      mode,
      model,
      connection,
      input.tableName,
      input.dateColumn,
      input.facts,
      input.futureHorizonDays,
    );
    const result = await drv.markAsDateTable(input.tableName, input.dateColumn, connection);
    const readMarkVerification = () =>
      readDriverSnapshot(
        drv,
        mode === 'live' ? '(live)' : undefined,
        { includeMeasures: false, includeRoles: false },
        connection,
      );
    // Mark success requires only dataCategory='Time' on a fresh live read plus the pre-write
    // coverage proof that already passed — isKey is NOT required (Import models reject it; the
    // driver returns columnKeySkipped). One bounded re-read absorbs snapshot staleness.
    let verified = await readMarkVerification();
    if (!looksLikeGovernedDateEndpoint(verified, input.tableName, input.dateColumn)) {
      verified = await readMarkVerification();
    }
    const columnKeySkipped = isRecord(result) && result.columnKeySkipped === true;
    if (!looksLikeGovernedDateEndpoint(verified, input.tableName, input.dateColumn)) {
      // The host accepted the write but the mark did not reflect on a fresh read —
      // a known Import-mode metadata no-op. This is NOT a hard failure: the date key
      // is proven from data, so relationships and explicit-column time intelligence
      // work regardless. Return a non-blocking result instead of throwing, so the
      // caller reports it honestly and proceeds (relationships no longer gate on the
      // mark) rather than inventing manual Desktop steps or an "Import can't be
      // marked" rule.
      const verifiedTable = verified.tables.find((candidate) => candidate.name === input.tableName);
      const dataCategoryNotApplied = isRecord(result) && result.dataCategoryNotApplied === true;
      // The coverage/key gate ALREADY PASSED above (enforceMarkAsDateGate would have thrown
      // otherwise), so the date key is proven clean from live data and the mark write was
      // accepted by the host — only the dataCategory="Time" READ-BACK is unobservable (the
      // known Import no-op; the user sees the same after marking in Desktop). Report
      // marked:true with markObservable:false rather than marked:false, so the agent treats
      // the mark as DONE (it is, for relationships and explicit-column TI) and does NOT loop
      // re-marking / deleting / recreating the table. markObservable:false + the warning keep
      // it honest that the dataCategory metadata is not reflected and that built-in/implicit
      // time intelligence still needs the Desktop mark.
      return {
        marked: true,
        markObservable: false,
        mode,
        reason: dataCategoryNotApplied
          ? 'date-category-write-not-applied'
          : 'post-write-verification-failed',
        warning: `The mark write was accepted and the date key is proven clean from live data, but a fresh live read did not show dataCategory="Time". This is a host-side metadata no-op, NOT an "Import tables cannot be marked" rule (marking an Import table as a Date table is supported), and you will see the same unobservable read-back even after marking in Power BI Desktop. Relationships and explicit-column time intelligence (TOTALYTD(<measure>, '${input.tableName}'[${input.dateColumn}])) work regardless. Built-in/implicit time intelligence and the Date-hierarchy UX require marking the table in Power BI Desktop (Model view → right-click → Mark as date table). Treat the mark as DONE; do NOT re-mark, delete, or recreate the table over this.`,
        observedTableDataCategory: verifiedTable?.dataCategory ?? null,
        ...(columnKeySkipped ? { columnKeySkipped: true } : {}),
        ...(markGateWarnings.length > 0 ? { warnings: markGateWarnings } : {}),
        persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      };
    }
    return {
      marked: true,
      mode,
      ...(columnKeySkipped ? { columnKeySkipped: true } : {}),
      ...(markGateWarnings.length > 0 ? { warnings: markGateWarnings } : {}),
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      result,
    };
  },
);

tool(
  'pbi_table_delete',
  'Delete Table',
  'Delete a table (and its columns/measures) from the connected model.',
  {
    name: z.string().describe('Table name to delete.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: true, idempotentHint: false },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    assertTableExistsForWrite({
      tool: 'pbi_table_delete',
      action: 'Table delete',
      tableName: input.name,
      mode,
      model,
      connection,
      modelSelector: input.model,
    });
    const dependencyWarnings = computeTableDeleteDependencyWarnings(model, input.name);
    const result = await drv.deleteTable({ name: input.name }, connection);
    return { deleted: true, mode, dependencyWarnings, result };
  },
);

// --- LIVE WRITE: COLUMNS -------------------------------------------------

tool(
  'pbi_column_create',
  'Create Column',
  'Create a column on a table. Pass `sourceColumn` for a data column, or `expression` for a DAX calculated column. Calculated columns (via `expression`) are supported on imported (Power Query / M) tables too — not just calculated tables. A calculated-column expression runs in the host table’s row context and is validated by the modeling engine on create (invalid DAX is rejected with a clear error and nothing is written) — no pre-flight reference gate runs. On success in live mode the column appears in Desktop immediately; press Ctrl+S to persist live semantic-model metadata. In folder mode, call pbi_model_export.',
  {
    tableName: z.string().describe('Table that hosts the column.'),
    name: z.string().describe('Column name (must be unique on the table).'),
    dataType: z
      .string()
      .optional()
      .describe('Column data type (e.g. "int64", "string", "double", "dateTime").'),
    sourceColumn: z
      .string()
      .optional()
      .describe('Source column name for a data column (omit for a calculated column).'),
    expression: z
      .string()
      .optional()
      .describe(
        'DAX expression for a calculated column (runs in the host table’s row context). Validated by the engine on create.',
      ),
    formatString: z.string().optional().describe('Format string (bare TMDL backslash form).'),
    sortByColumn: z
      .string()
      .optional()
      // UNVERIFIED: MS-MCP `sortByColumn` write key inferred (see ColumnWrite in model-driver).
      .describe('Column on the same table used to sort this column.'),
    summarizeBy: z
      .string()
      .optional()
      .describe('Default aggregation (e.g. "none", "sum", "count").'),
    isHidden: z.boolean().optional().describe('Hide the column from the field list.'),
    isKey: z
      .boolean()
      .optional()
      // UNVERIFIED: MS-MCP `isKey` write key inferred (see ColumnWrite in model-driver).
      .describe(
        'Mark this column as the table primary key. Date-table key/category writes are refused here; use pbi_table_mark_as_date with fact coverage inputs.',
      ),
    dataCategory: z
      .string()
      .optional()
      // UNVERIFIED: MS-MCP `dataCategory` write key inferred (see ColumnWrite in model-driver).
      .describe(
        'Semantic data category (e.g. "City", "Country", "Latitude", "Longitude"). Geo categories drive map visuals.',
      ),
    description: z.string().optional().describe('Optional column description.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: false },
  async (input) => {
    if ((input.sourceColumn === undefined) === (input.expression === undefined)) {
      throwInputValidationError(
        'Column create refused: supply exactly one source path, either sourceColumn or expression.',
        {
          tool: 'pbi_column_create',
          reason: 'invalid-source-path-count',
          requiredExactlyOneOf: ['sourceColumn', 'expression'],
        },
      );
    }
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    enforceNoDirectDateTableMetadataWrite(model, {
      kind: 'column',
      tableName: input.tableName,
      columnName: input.name,
      dataType: input.dataType,
      isKey: input.isKey,
      dataCategory: input.dataCategory,
      expression: input.expression,
    });
    assertTableExistsForWrite({
      tool: 'pbi_column_create',
      action: 'Column create',
      tableName: input.tableName,
      mode,
      model,
      connection,
      modelSelector: input.model,
    });
    const result = await drv.createColumn(
      {
        tableName: input.tableName,
        name: input.name,
        dataType: input.dataType,
        sourceColumn: input.sourceColumn,
        expression: input.expression,
        formatString: input.formatString,
        sortByColumn: input.sortByColumn,
        summarizeBy: input.summarizeBy,
        isHidden: input.isHidden,
        isKey: input.isKey,
        dataCategory: input.dataCategory,
        description: input.description,
      },
      connection,
    );
    const referenceAdvisory = calcExpressionReferenceAdvisory(
      model,
      input.tableName,
      input.expression,
    );
    return {
      created: true,
      mode,
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      ...(referenceAdvisory ? { referenceAdvisory } : {}),
      result,
    };
  },
);

tool(
  'pbi_column_update',
  'Update Column',
  'Update an existing column: rename, change data type/format/summarizeBy/visibility, or edit a calculated column expression. Date-table key/category writes are REFUSED here because they bypass the Date-table continuity/coverage gate; use pbi_table_mark_as_date with fact coverage inputs. A new `expression` (calculated column) is validated by the modeling engine on update (invalid DAX is rejected and nothing is written). On success in live mode the change appears in Desktop immediately; press Ctrl+S to persist live semantic-model metadata. In folder mode, call pbi_model_export.',
  {
    tableName: z.string().describe('Table that hosts the column.'),
    name: z.string().describe('Column name to update.'),
    newName: z.string().optional().describe('New column name (rename).'),
    dataType: z.string().optional().describe('New data type.'),
    expression: z
      .string()
      .optional()
      .describe('New DAX expression for a calculated column. Validated by the engine on update.'),
    formatString: z.string().optional().describe('Format string (bare TMDL backslash form).'),
    sortByColumn: z
      .string()
      .optional()
      // UNVERIFIED: MS-MCP `sortByColumn` Update key inferred (see ColumnUpdate in model-driver).
      .describe('Column on the same table used to sort this column.'),
    summarizeBy: z.string().optional().describe('Default aggregation.'),
    isHidden: z.boolean().optional().describe('Hide or show the column.'),
    isKey: z
      .boolean()
      .optional()
      // UNVERIFIED: MS-MCP `isKey` Update key inferred (see ColumnUpdate in model-driver).
      .describe(
        'Mark/unmark this column as the table primary key. Marking a date-table key is refused here; use pbi_table_mark_as_date with fact coverage inputs.',
      ),
    dataCategory: z
      .string()
      .optional()
      // UNVERIFIED: MS-MCP `dataCategory` Update key inferred (see ColumnUpdate in model-driver).
      .describe('Semantic data category (e.g. "City", "Country", "Latitude", "Longitude").'),
    description: z.string().optional().describe('New column description.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: true },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    enforceNoDirectDateTableMetadataWrite(model, {
      kind: 'column',
      tableName: input.tableName,
      columnName: input.name,
      dataType: input.dataType,
      isKey: input.isKey,
      dataCategory: input.dataCategory,
      expression: input.expression,
    });
    assertTableExistsForWrite({
      tool: 'pbi_column_update',
      action: 'Column update',
      tableName: input.tableName,
      mode,
      model,
      connection,
      modelSelector: input.model,
    });
    const result = await drv.updateColumn(
      {
        tableName: input.tableName,
        name: input.name,
        newName: input.newName,
        dataType: input.dataType,
        expression: input.expression,
        formatString: input.formatString,
        sortByColumn: input.sortByColumn,
        summarizeBy: input.summarizeBy,
        isHidden: input.isHidden,
        isKey: input.isKey,
        dataCategory: input.dataCategory,
        description: input.description,
      },
      connection,
    );
    const referenceAdvisory = calcExpressionReferenceAdvisory(
      model,
      input.tableName,
      input.expression,
    );
    return {
      updated: true,
      mode,
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      ...(referenceAdvisory ? { referenceAdvisory } : {}),
      result,
    };
  },
);

tool(
  'pbi_column_delete',
  'Delete Column',
  'Delete a column from a table on the connected model.',
  {
    tableName: z.string().describe('Table that hosts the column.'),
    name: z.string().describe('Column name to delete.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: true, idempotentHint: false },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    assertTableExistsForWrite({
      tool: 'pbi_column_delete',
      action: 'Column delete',
      tableName: input.tableName,
      mode,
      model,
      connection,
      modelSelector: input.model,
    });
    const dependencyWarnings = computeColumnDeleteDependencyWarnings(
      model,
      input.tableName,
      input.name,
    );
    const result = await drv.deleteColumn(
      { tableName: input.tableName, name: input.name },
      connection,
    );
    return { deleted: true, mode, dependencyWarnings, result };
  },
);

// --- LIVE WRITE: RELATIONSHIPS -------------------------------------------

tool(
  'pbi_relationship_create',
  'Create Relationship (validity-gated)',
  'Create a relationship between two columns. HARD GATES: an in-code relationship check runs first against the live model; temporal Date relationship creates also require a governed marked Date endpoint, live Date-table coverage proof, live date-only day-grain proof, and single-direction filtering. Sparse fact dates are valid; Date-key continuity is proven on the Date table. Active temporal creates require a matching planner write; inactive role-playing Date relationships are allowed after proof. If an endpoint is missing, key types mismatch, an active path would become ambiguous, Date coverage/grain is not proven, proof parsing is unrecognized, or the temporal create is bidirectional, the create is REFUSED and nothing is written. Temporal proof failure means STOP and report the blocker; do not replay manual relationship writes. Do not manually replay cross-fact/shared-dimension star-schema relationship writes with this primitive tool; use pbi_model_apply_star_schema_join with explicit axes for cross-fact joins. Cardinality defaults to manyToOne and is sent to the modeling engine as fromCardinality/toCardinality. Bidirectional cross-filtering is allowed for non-date relationships but returned as an advisory warning. On success in live mode the relationship appears in Desktop immediately; press Ctrl+S to persist live semantic-model metadata. In folder mode, call pbi_model_export.',
  {
    fromTable: z.string().describe('Many-side table (the foreign-key side).'),
    fromColumn: z.string().describe('Foreign-key column on fromTable.'),
    toTable: z.string().describe('One-side table (the primary-key side).'),
    toColumn: z.string().describe('Key column on toTable.'),
    cardinality: RELATIONSHIP_CARDINALITY_FIELD,
    crossFilteringBehavior: z
      .enum(['single', 'both'])
      .optional()
      .describe('Filter propagation: "single" (default) or "both" (bidirectional).'),
    isActive: z.boolean().optional().describe('Whether the relationship is active (default true).'),
    futureHorizonDays: FUTURE_HORIZON_DAYS_FIELD,
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: false },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    const candidate = {
      fromTable: input.fromTable,
      fromColumn: input.fromColumn,
      toTable: input.toTable,
      toColumn: input.toColumn,
      isActive: input.isActive,
      crossFilteringBehavior: input.crossFilteringBehavior,
    };
    const check = relationshipCheck(candidate, model);
    if (!check.valid) {
      const err = new Error(
        `Refused: relationship ${input.fromTable}[${input.fromColumn}] → ${input.toTable}[${input.toColumn}] is not valid for the model.`,
      ) as Error & { report?: unknown };
      err.report = {
        gate: 'relationship-check',
        blocking: check.blocking,
        warnings: check.warnings,
        ...(hasMissingTableReason(check.blocking)
          ? {
              diagnostics: tableMissingDiagnostics({
                reason: 'relationship-endpoint-table-not-found',
                mode,
                model,
                connection,
                modelSelector: input.model,
                requestedTables: [input.fromTable, input.toTable],
              }),
            }
          : {}),
      };
      throw err;
    }
    const dateTableWarnings = await enforceDateRelationshipWriteGate(
      mode,
      model,
      connection,
      {
        fromTable: input.fromTable,
        fromColumn: input.fromColumn,
        toTable: input.toTable,
        toColumn: input.toColumn,
        isActive: input.isActive !== false,
        crossFilteringBehavior: input.crossFilteringBehavior ?? 'single',
      },
      'create-date-relationship',
      {
        futureHorizonDays: input.futureHorizonDays,
        // Prove the full model-derived coverage set (not just this one fact), matching the
        // governed creator / mark gate, so the standalone create can't pass a partial proof (P3).
        coverageFacts: deriveRequiredDateCoverageFacts(model, {
          dateTable: input.toTable,
          dateColumn: input.toColumn,
          facts: [{ tableName: input.fromTable, dateColumn: input.fromColumn }],
          futureHorizonDays: input.futureHorizonDays,
        }),
      },
    );
    const result = await drv.createRelationship(
      {
        fromTable: input.fromTable,
        fromColumn: input.fromColumn,
        toTable: input.toTable,
        toColumn: input.toColumn,
        cardinality: input.cardinality ?? 'manyToOne',
        crossFilteringBehavior: input.crossFilteringBehavior,
        isActive: input.isActive,
      },
      connection,
    );
    return {
      created: true,
      mode,
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      result,
      warnings: check.warnings,
      ...(dateTableWarnings.length > 0 ? { dateTableWarnings } : {}),
    };
  },
);

tool(
  'pbi_relationship_update',
  'Update Relationship (validity-gated)',
  'Update an existing relationship by id: re-point endpoints, change cardinality, change cross-filtering, or toggle active. The same in-code relationship check as create runs first (the edited row is excluded from the active-path ambiguity check). Activating/re-pointing an active temporal Date relationship, or changing its shape, also requires a governed marked Date endpoint, live Date-table coverage proof, live date-only day-grain proof, and single-direction filtering. Sparse fact dates are valid; Date-key continuity is proven on the Date table. On a structural/date-coverage/date-grain/parse-shape violation the update is REFUSED. Temporal proof failure means STOP and report the blocker; do not replay manual relationship writes. Bidirectional cross-filtering is allowed for non-date relationships but returned as an advisory warning. On success in live mode the change appears in Desktop immediately; press Ctrl+S to persist live semantic-model metadata. In folder mode, call pbi_model_export.',
  {
    id: z.string().describe('Relationship id to update.'),
    fromTable: z.string().optional().describe('New many-side table.'),
    fromColumn: z.string().optional().describe('New foreign-key column.'),
    toTable: z.string().optional().describe('New one-side table.'),
    toColumn: z.string().optional().describe('New key column.'),
    cardinality: RELATIONSHIP_CARDINALITY_FIELD,
    crossFilteringBehavior: z
      .enum(['single', 'both'])
      .optional()
      .describe('Filter propagation: "single" or "both" (bidirectional).'),
    isActive: z.boolean().optional().describe('Whether the relationship is active.'),
    futureHorizonDays: FUTURE_HORIZON_DAYS_FIELD,
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: true },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    const existing = model.relationships.find((r) => r.id === input.id);
    let warnings: RelationshipReason[] = [];
    let dateTableWarnings: string[] = [];
    if (!existing) {
      throwDateGateError(`Refused: relationship "${input.id}" was not found in the model.`, {
        gate: 'relationship-check',
        status: 'blocked',
        reason: 'relationship-not-found',
        id: input.id,
      });
    }
    enforceProvenRelationshipIdentity(existing, 'update');
    {
      const candidate = {
        fromTable: input.fromTable ?? existing.fromTable,
        fromColumn: input.fromColumn ?? existing.fromColumn,
        toTable: input.toTable ?? existing.toTable,
        toColumn: input.toColumn ?? existing.toColumn,
        isActive: input.isActive ?? existing.isActive,
        crossFilteringBehavior: input.crossFilteringBehavior ?? existing.crossFilteringBehavior,
      };
      const check = relationshipCheck(candidate, model, { ignoreRelationshipId: input.id });
      if (!check.valid) {
        const err = new Error(
          `Refused: updated relationship "${input.id}" is not valid for the model.`,
        ) as Error & { report?: unknown };
        err.report = {
          gate: 'relationship-check',
          blocking: check.blocking,
          warnings: check.warnings,
          ...(hasMissingTableReason(check.blocking)
            ? {
                diagnostics: tableMissingDiagnostics({
                  reason: 'relationship-endpoint-table-not-found',
                  mode,
                  model,
                  connection,
                  modelSelector: input.model,
                  requestedTables: [candidate.fromTable, candidate.toTable],
                }),
              }
            : {}),
        };
        throw err;
      }
      warnings = [...check.warnings];
      const endpointChanged =
        candidate.fromTable !== existing.fromTable ||
        candidate.fromColumn !== existing.fromColumn ||
        candidate.toTable !== existing.toTable ||
        candidate.toColumn !== existing.toColumn;
      const cardinalityChanged =
        input.cardinality !== undefined && input.cardinality !== existing.cardinality;
      const dateShapeChanged =
        candidate.crossFilteringBehavior !== existing.crossFilteringBehavior ||
        candidate.isActive !== existing.isActive ||
        cardinalityChanged;
      dateTableWarnings = await enforceDateRelationshipWriteGate(
        mode,
        model,
        connection,
        {
          id: existing.id,
          fromTable: candidate.fromTable,
          fromColumn: candidate.fromColumn,
          toTable: candidate.toTable,
          toColumn: candidate.toColumn,
          isActive: candidate.isActive && (dateShapeChanged || endpointChanged),
          crossFilteringBehavior: candidate.crossFilteringBehavior,
        },
        endpointChanged ? 'create-date-relationship' : 'activate-date-relationship',
        {
          futureHorizonDays: input.futureHorizonDays,
          coverageFacts: deriveRequiredDateCoverageFacts(model, {
            dateTable: candidate.toTable,
            dateColumn: candidate.toColumn,
            facts: [{ tableName: candidate.fromTable, dateColumn: candidate.fromColumn }],
            futureHorizonDays: input.futureHorizonDays,
          }),
        },
      );
    }
    const result = await drv.updateRelationship(
      {
        id: input.id,
        fromTable: input.fromTable,
        fromColumn: input.fromColumn,
        toTable: input.toTable,
        toColumn: input.toColumn,
        cardinality: input.cardinality,
        crossFilteringBehavior: input.crossFilteringBehavior,
        isActive: input.isActive,
      },
      connection,
    );
    return {
      updated: true,
      mode,
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      result,
      warnings,
      ...(dateTableWarnings.length > 0 ? { dateTableWarnings } : {}),
    };
  },
);

tool(
  'pbi_relationship_activate',
  'Activate Relationship',
  'Mark a relationship active by id. HARD GATE: temporal Date relationship activation requires a governed marked Date endpoint, live Date-table coverage proof, live date-only day-grain proof with observedGrain "day", a matching activate writePlan item, and single-direction filtering. Sparse fact dates are valid; Date-key continuity is proven on the Date table. If coverage/grain proof blocks or proof parsing is unrecognized, activation is REFUSED and nothing is written. Temporal proof failure means STOP and report the blocker; do not replay manual relationship writes. On success in live mode the change appears in Desktop immediately; press Ctrl+S to persist live semantic-model metadata. In folder mode, call pbi_model_export.',
  {
    id: z.string().describe('Relationship id to activate.'),
    futureHorizonDays: FUTURE_HORIZON_DAYS_FIELD,
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: true },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model, {
      includeMeasures: true,
      includeRoles: false,
    });
    const existing = model.relationships.find((relationship) => relationship.id === input.id);
    if (!existing) {
      throwDateGateError(`Refused: relationship "${input.id}" was not found in the model.`, {
        gate: 'relationship-check',
        status: 'blocked',
        reason: 'relationship-not-found',
        id: input.id,
      });
    }
    enforceProvenRelationshipIdentity(existing, 'activate');
    const check = relationshipCheck(
      {
        fromTable: existing.fromTable,
        fromColumn: existing.fromColumn,
        toTable: existing.toTable,
        toColumn: existing.toColumn,
        isActive: true,
        crossFilteringBehavior: existing.crossFilteringBehavior,
      },
      model,
      { ignoreRelationshipId: input.id },
    );
    if (!check.valid) {
      const err = new Error(
        `Refused: activating relationship "${input.id}" is not valid for the model.`,
      ) as Error & { report?: unknown };
      err.report = {
        gate: 'relationship-check',
        blocking: check.blocking,
        warnings: check.warnings,
      };
      throw err;
    }
    let dateTableWarnings: string[] = [];
    if (existing && !existing.isActive) {
      dateTableWarnings = await enforceDateRelationshipWriteGate(
        mode,
        model,
        connection,
        {
          id: existing.id,
          fromTable: existing.fromTable,
          fromColumn: existing.fromColumn,
          toTable: existing.toTable,
          toColumn: existing.toColumn,
          isActive: true,
          crossFilteringBehavior: existing.crossFilteringBehavior,
        },
        'activate-date-relationship',
        input.futureHorizonDays,
      );
    }
    const result = await drv.activateRelationship({ id: input.id }, connection);
    return {
      updated: true,
      mode,
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      result,
      warnings: check.warnings,
      ...(dateTableWarnings.length > 0 ? { dateTableWarnings } : {}),
    };
  },
);

tool(
  'pbi_relationship_deactivate',
  'Deactivate Relationship',
  'Mark a relationship inactive by id. On success in live mode the change appears in Desktop immediately; press Ctrl+S to persist live semantic-model metadata. In folder mode, call pbi_model_export.',
  {
    id: z.string().describe('Relationship id to deactivate.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: true },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model);
    const existing = model.relationships.find((relationship) => relationship.id === input.id);
    if (!existing) {
      throwDateGateError(`Refused: relationship "${input.id}" was not found in the model.`, {
        gate: 'relationship-check',
        status: 'blocked',
        reason: 'relationship-not-found',
        id: input.id,
      });
    }
    enforceProvenRelationshipIdentity(existing, 'deactivate');
    // Orphan guard: refuse to deactivate a fact's ONLY active date relationship when
    // no other active date relationship would remain on that same date FK. This
    // prevents the deactivate-before-create footgun that strips the working
    // (LocalDateTable) date relationship and leaves the fact with no date axis — the
    // broken half-state seen in the field. Creating the governed Date relationship as
    // active FIRST is allowed (it is a different table pair, so it does not trip
    // ambiguous-active-path), so the correct order is create-then-deactivate.
    const targetsDate = (relationship: TMDLRelationship): boolean =>
      isTemporalDataType(
        findModelColumn(model, relationship.toTable, relationship.toColumn)?.dataType,
      );
    if (existing.isActive && targetsDate(existing)) {
      const remainingActiveDateRel = model.relationships.some(
        (relationship) =>
          relationship.id !== existing.id &&
          relationship.isActive &&
          relationship.fromTable === existing.fromTable &&
          relationship.fromColumn === existing.fromColumn &&
          targetsDate(relationship),
      );
      if (!remainingActiveDateRel) {
        throwDateGateError(
          `Refused: deactivating this relationship would leave "${existing.fromTable}"[${existing.fromColumn}] with no active date relationship. Create the replacement governed Date relationship as active FIRST (allowed — it is a different table pair), then deactivate this one. Deactivating first leaves the fact with no date axis.`,
          {
            gate: 'relationship-check',
            status: 'blocked',
            reason: 'date-relationship-orphan',
            id: input.id,
            fromTable: existing.fromTable,
            fromColumn: existing.fromColumn,
          },
        );
      }
    }
    const result = await drv.deactivateRelationship({ id: input.id }, connection);
    return {
      updated: true,
      mode,
      persist: mode === 'live' ? LIVE_MODEL_PERSISTENCE : FOLDER_MODEL_PERSISTENCE,
      result,
    };
  },
);

tool(
  'pbi_relationship_delete',
  'Delete Relationship',
  'Delete a relationship by id from the connected model.',
  {
    id: z.string().describe('Relationship id to delete.'),
    folderPath: MODEL_FOLDER_FIELD,
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: true, idempotentHint: false },
  async (input) => {
    const {
      mode,
      model,
      driver: drv,
      connection,
    } = await snapshotForWrite(input.folderPath, input.model);
    const existing = model.relationships.find((relationship) => relationship.id === input.id);
    if (!existing) {
      throwDateGateError(`Refused: relationship "${input.id}" was not found in the model.`, {
        gate: 'relationship-check',
        status: 'blocked',
        reason: 'relationship-not-found',
        id: input.id,
      });
    }
    enforceProvenRelationshipIdentity(existing, 'delete');
    const dependencyWarnings = computeRelationshipDeleteDependencyWarnings(model, existing);
    const result = await drv.deleteRelationship({ id: input.id }, connection);
    return { deleted: true, mode, dependencyWarnings, result };
  },
);

tool(
  'pbi_model_export',
  'Export TMDL to Folder (folder-mode persistence)',
  'Persist a folder-mode model to its .SemanticModel/definition TMDL on disk. Requires folderPath and refuses live mode; live Desktop persistence is the user pressing Ctrl+S in Desktop.',
  {
    folderPath: z
      .string()
      .describe(
        'Required .SemanticModel/definition, .SemanticModel, .pbip, or containing folder to export to. Live Desktop models are refused; press Ctrl+S in Desktop for live persistence.',
      ),
    model: MODEL_SELECT_FIELD,
  },
  { destructiveHint: false, idempotentHint: true },
  async (input) => {
    const drv = getModelDriver();
    const resolvedFolder = resolveSemanticModelDefinition(input.folderPath);
    const conn = await drv.ensureConnection({
      folderPath: resolvedFolder,
      model: input.model,
      forceFolder: true,
    });
    if (conn.mode !== 'folder') {
      throwInputValidationError(
        'Model export refused: live models persist via Ctrl+S in Desktop.',
        {
          tool: 'pbi_model_export',
          reason: 'live-mode-refused',
          mode: conn.mode,
        },
      );
    }
    const exportFolder = conn.folderPath ?? resolvedFolder;
    return {
      exported: true,
      mode: conn.mode,
      folderPath: exportFolder,
      result: await drv.exportToTmdlFolder(exportFolder, conn),
    };
  },
);

tool(
  'pbi_spec_validate',
  'Validate DashboardSpec',
  'Validate a DashboardSpec — the MODELING-PREP build contract handed from pbi-data-analyst to pbi-model-builder — against the v6 schema. The spec declares WHAT to build into the semantic model (measures, relationships, Date/calendar tables and their grain/coverage), NOT report layout, pages, or visuals. Returns { valid, errors[] }. The model-builder MUST call this and refuse to act when valid is false.',
  { spec: z.unknown().describe('The DashboardSpec object to validate.') },
  { readOnlyHint: true, idempotentHint: true },
  (input) => validateDashboardSpec(input.spec),
);

// -- Boot ------------------------------------------------------------------

export function buildServer(options: BuildServerOptions = {}): McpServer {
  if (options.surface !== undefined && options.surface !== 'modeling') {
    throw new Error('This release exposes only the "modeling" MCP surface.');
  }
  const built = createMcpServer();
  for (const definition of toolDefinitions) {
    if (!MODELING_SURFACE_TOOL_NAMES.has(definition.name)) {
      throw new Error(`Unexpected non-modeling tool registered: ${definition.name}`);
    }
    registerToolDefinition(built, definition);
  }
  return built;
}

export function buildModelingServer(): McpServer {
  return buildServer();
}

async function main(): Promise<void> {
  const runtimeServer = buildServer();
  const transport = new StdioServerTransport();
  await runtimeServer.connect(transport);
  // IMPORTANT: stdio servers must NOT log to stdout (that's the protocol channel).
  process.stderr.write(`pbi-modeling-mcp-server v${VERSION} ready (stdio, modeling)\n`);
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  main().catch((err: unknown) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
