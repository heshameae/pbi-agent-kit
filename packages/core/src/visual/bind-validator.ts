import { existsSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError } from '../errors.js';
import { modelDoctor } from '../modeling/doctor.js';
import {
  type ModelColumnField,
  type ModelField,
  type ModelFieldIndex,
  type ModelMeasureField,
  buildModelFieldIndex,
  defaultAggregationForColumn,
  findMeasure,
  findModelField,
  hasDirectedFilterPath,
  isSummarizableColumn,
  resolveSemanticModelDefinition,
  resolveSiblingSemanticModelDefinition,
} from '../modeling/index.js';
import { readJson } from '../pbir/io.js';
import { getVisualDir } from '../pbir/path.js';
import type { AggregationKind, VisualBinding } from './bind.js';
import { parseFieldRef } from './field-ref.js';
import { MEASURE_ROLES, ROLE_ALIASES } from './roles.js';

export type BindingValidationStatus = 'valid' | 'blocked' | 'skipped';
export type BindingValidationSeverity = 'error' | 'warning' | 'info';

export interface BindingValidationFinding {
  readonly code: string;
  readonly severity: BindingValidationSeverity;
  readonly role?: string;
  readonly field?: string;
  readonly reason: string;
  readonly fixOptions?: readonly string[];
}

export interface BindingValidationTelemetry {
  readonly refusalCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly codes: Readonly<Record<string, number>>;
}

export interface VisualBindingValidationReport {
  readonly status: BindingValidationStatus;
  readonly blockedWrite: boolean;
  readonly page: string;
  readonly visual: string;
  readonly visualType: string;
  readonly modelPath?: string;
  readonly modelFingerprint?: string;
  readonly findings: readonly BindingValidationFinding[];
  readonly telemetry: BindingValidationTelemetry;
}

export interface ValidateVisualBindingPlanOptions {
  readonly modelPath?: string;
}

interface NormalizedBinding {
  readonly role: string;
  readonly field: string;
  readonly table: string;
  readonly name: string;
  readonly shape: 'measure' | 'column';
  readonly aggregation?: AggregationKind;
  readonly source: 'existing' | 'proposed';
}

export function validateVisualBindingPlan(
  definitionPath: string,
  pageName: string,
  visualName: string,
  proposedBindings: readonly VisualBinding[] = [],
  options: ValidateVisualBindingPlanOptions = {},
): VisualBindingValidationReport {
  const visualData = readVisualJson(definitionPath, pageName, visualName);
  const visualConfig = (visualData.visual as Record<string, unknown>) ?? {};
  const visualType = typeof visualConfig.visualType === 'string' ? visualConfig.visualType : '';
  const findings: BindingValidationFinding[] = [];

  const resolution =
    options.modelPath !== undefined
      ? resolveSemanticModelDefinition(options.modelPath)
      : resolveSiblingSemanticModelDefinition(definitionPath);

  if (resolution.status !== 'found' || resolution.definitionPath === undefined) {
    if (resolution.status === 'not-found' && options.modelPath === undefined) {
      findings.push({
        code: 'MODEL_NOT_FOUND',
        severity: 'info',
        reason: 'No sibling semantic model was found; model-aware binding checks were skipped.',
        fixOptions: ['Pass modelPath to enable model-aware validation.'],
      });
      return report('skipped', pageName, visualName, visualType, undefined, undefined, findings);
    }

    findings.push({
      code: resolution.status === 'ambiguous' ? 'MODEL_AMBIGUOUS' : 'MODEL_NOT_FOUND',
      severity: 'error',
      reason: resolution.reason ?? 'Semantic model could not be resolved.',
      fixOptions:
        resolution.status === 'ambiguous'
          ? ['Pass modelPath explicitly.', `Candidates: ${resolution.candidates.join(', ')}`]
          : ['Pass a valid .SemanticModel/definition modelPath.'],
    });
    return report('blocked', pageName, visualName, visualType, undefined, undefined, findings);
  }

  let index: ModelFieldIndex;
  try {
    index = buildModelFieldIndex(resolution.definitionPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    findings.push({
      code: 'MODEL_PARSE_FAILED',
      severity: 'error',
      reason: `Semantic model could not be parsed: ${message}`,
      fixOptions: ['Check that modelPath points at a valid TMDL definition folder.'],
    });
    return report(
      'blocked',
      pageName,
      visualName,
      visualType,
      resolution.definitionPath,
      undefined,
      findings,
    );
  }

  if (options.modelPath === undefined && index.model.tables.length === 0) {
    findings.push({
      code: 'MODEL_EMPTY',
      severity: 'info',
      reason: 'The sibling semantic model has no tables; model-aware binding checks were skipped.',
      fixOptions: [
        'Pass modelPath to a populated semantic model to enable model-aware validation.',
      ],
    });
    return report(
      'skipped',
      pageName,
      visualName,
      visualType,
      index.modelPath,
      index.modelFingerprint,
      findings,
    );
  }

  const bindings = [
    ...extractExistingBindings(visualConfig),
    ...normalizeProposedBindings(visualType, proposedBindings, findings),
  ];

  validateModelDoctorFindings(index, bindings, findings);
  validateFieldBindings(index, bindings, findings);
  validateAxisMeasureCompatibility(index, bindings, findings);

  return report(
    hasErrors(findings) ? 'blocked' : 'valid',
    pageName,
    visualName,
    visualType,
    index.modelPath,
    index.modelFingerprint,
    findings,
  );
}

function readVisualJson(
  definitionPath: string,
  pageName: string,
  visualName: string,
): Record<string, unknown> {
  const vfile = path.join(getVisualDir(definitionPath, pageName, visualName), 'visual.json');
  if (!existsSync(vfile)) {
    throw new PbiCoreError(`Visual '${visualName}' not found on page '${pageName}'.`);
  }
  return readJson(vfile) as Record<string, unknown>;
}

function normalizeProposedBindings(
  visualType: string,
  bindings: readonly VisualBinding[],
  findings: BindingValidationFinding[],
): NormalizedBinding[] {
  const aliasMap =
    visualType in ROLE_ALIASES
      ? ((ROLE_ALIASES as Record<string, Readonly<Record<string, string>>>)[visualType] ?? {})
      : {};

  const normalized: NormalizedBinding[] = [];

  for (const binding of bindings) {
    const role = aliasMap[binding.role.toLowerCase()] ?? binding.role;
    let parsed: { table: string; column: string };
    try {
      parsed = parseFieldRef(binding.field);
    } catch (err) {
      findings.push({
        code: 'INVALID_FIELD_REF',
        severity: 'error',
        role,
        field: binding.field,
        reason: err instanceof Error ? err.message : String(err),
        fixOptions: ['Use Table[Field] notation.'],
      });
      continue;
    }

    normalized.push({
      role,
      field: binding.field,
      table: parsed.table,
      name: parsed.column,
      shape: (binding.measure ?? MEASURE_ROLES.has(role)) ? 'measure' : 'column',
      aggregation: binding.aggregation,
      source: 'proposed',
    });
  }

  return normalized;
}

function extractExistingBindings(visualConfig: Record<string, unknown>): NormalizedBinding[] {
  const query = (visualConfig.query as Record<string, unknown>) ?? {};
  const queryState = (query.queryState as Record<string, unknown>) ?? {};
  const bindings: NormalizedBinding[] = [];

  for (const [role, stateValue] of Object.entries(queryState)) {
    const state = (stateValue as Record<string, unknown>) ?? {};
    const projections = Array.isArray(state.projections) ? state.projections : [];
    for (const projectionRaw of projections) {
      const projection = (projectionRaw as Record<string, unknown>) ?? {};
      const field = (projection.field as Record<string, unknown>) ?? {};
      const extracted = extractProjectedField(role, field, projection);
      if (extracted) bindings.push(extracted);
    }
  }

  return bindings;
}

function extractProjectedField(
  role: string,
  field: Record<string, unknown>,
  projection: Record<string, unknown>,
): NormalizedBinding | null {
  const measure = field.Measure as Record<string, unknown> | undefined;
  if (measure) {
    const ref = sourceRefAndProperty(measure);
    if (!ref) return null;
    return {
      role,
      field: `${ref.table}[${ref.name}]`,
      table: ref.table,
      name: ref.name,
      shape: 'measure',
      source: 'existing',
    };
  }

  const column = field.Column as Record<string, unknown> | undefined;
  if (column) {
    const ref = sourceRefAndProperty(column);
    if (!ref) return null;
    return {
      role,
      field: `${ref.table}[${ref.name}]`,
      table: ref.table,
      name: ref.name,
      shape: 'column',
      source: 'existing',
    };
  }

  const aggregation = field.Aggregation as Record<string, unknown> | undefined;
  const expression = aggregation?.Expression as Record<string, unknown> | undefined;
  const aggregatedColumn = expression?.Column as Record<string, unknown> | undefined;
  if (aggregatedColumn) {
    const ref = sourceRefAndProperty(aggregatedColumn);
    if (!ref) return null;
    return {
      role,
      field: `${ref.table}[${ref.name}]`,
      table: ref.table,
      name: ref.name,
      shape: 'column',
      aggregation: aggregationKindFromQueryRef(projection.queryRef),
      source: 'existing',
    };
  }

  return null;
}

function sourceRefAndProperty(
  item: Record<string, unknown>,
): { table: string; name: string } | null {
  const expression = (item.Expression as Record<string, unknown>) ?? {};
  const sourceRef = (expression.SourceRef as Record<string, unknown>) ?? {};
  const table =
    typeof sourceRef.Entity === 'string'
      ? sourceRef.Entity
      : typeof sourceRef.Source === 'string'
        ? sourceRef.Source
        : null;
  const name = typeof item.Property === 'string' ? item.Property : null;
  if (!table || !name) return null;
  return { table, name };
}

function aggregationKindFromQueryRef(value: unknown): AggregationKind | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('Sum(')) return 'sum';
  if (value.startsWith('Average(')) return 'avg';
  if (value.startsWith('Count(')) return 'count';
  if (value.startsWith('Min(')) return 'min';
  if (value.startsWith('Max(')) return 'max';
  return undefined;
}

function validateFieldBindings(
  index: ModelFieldIndex,
  bindings: readonly NormalizedBinding[],
  findings: BindingValidationFinding[],
): void {
  for (const binding of bindings) {
    const field = findModelField(index, binding.table, binding.name);
    if (!field) {
      const tableExists = index.tables[binding.table] !== undefined;
      findings.push({
        code: tableExists ? 'FIELD_NOT_FOUND' : 'TABLE_NOT_FOUND',
        severity: 'error',
        role: binding.role,
        field: binding.field,
        reason: tableExists
          ? `Table '${binding.table}' exists, but field '${binding.name}' does not exist as a column or measure.`
          : `Table '${binding.table}' does not exist in the semantic model.`,
        fixOptions: tableExists
          ? [
              'Bind a field that exists in the model.',
              'Create the missing model measure before binding.',
            ]
          : ['Use a table name that exists in the semantic model.'],
      });
      continue;
    }

    if (binding.shape === 'measure') validateMeasureShape(binding, field, findings);
    else validateColumnShape(index, binding, field, findings);
  }
}

function validateMeasureShape(
  binding: NormalizedBinding,
  field: ModelField,
  findings: BindingValidationFinding[],
): void {
  if (binding.aggregation !== undefined) {
    findings.push({
      code: 'AGGREGATION_ON_MEASURE',
      severity: 'error',
      role: binding.role,
      field: binding.field,
      reason: `Aggregation '${binding.aggregation}' was provided for a measure-shaped binding.`,
      fixOptions: [
        'Remove aggregation for measures.',
        'Use measure:false if this is intended to be a column.',
      ],
    });
  }

  if (field.kind !== 'measure') {
    findings.push({
      code: 'KIND_MISMATCH_MEASURE_FLAG',
      severity: 'error',
      role: binding.role,
      field: binding.field,
      reason: `The binding uses Measure shape, but '${binding.field}' is a column in the semantic model.`,
      fixOptions: [
        'Pass measure:false for columns.',
        'Use aggregation when binding a numeric column to a value role.',
      ],
    });
    return;
  }

  validateMeasureProvenance(binding, field, findings);
}

function validateColumnShape(
  index: ModelFieldIndex,
  binding: NormalizedBinding,
  field: ModelField,
  findings: BindingValidationFinding[],
): void {
  if (field.kind !== 'column') {
    findings.push({
      code: 'KIND_MISMATCH_COLUMN_FLAG',
      severity: 'error',
      role: binding.role,
      field: binding.field,
      reason: `The binding uses Column shape, but '${binding.field}' is a measure in the semantic model.`,
      fixOptions: ['Pass measure:true for measures.'],
    });
    return;
  }

  if (MEASURE_ROLES.has(binding.role) && isSummarizableColumn(field) && !binding.aggregation) {
    const defaultAggregation = defaultAggregationForColumn(field);
    findings.push({
      code: 'MISSING_AGGREGATION',
      severity: 'error',
      role: binding.role,
      field: binding.field,
      reason: `Column '${binding.field}' is summarizable and is bound to value role '${binding.role}' without an aggregation.`,
      fixOptions: [
        defaultAggregation
          ? `Pass aggregation:"${defaultAggregation}".`
          : 'Pass an explicit aggregation.',
      ],
    });
  }

  if (field.isHidden) {
    const replacement = findVisibleReplacement(index, field);
    if (replacement) {
      findings.push({
        code: 'HIDDEN_FIELD_SUPERSEDED',
        severity: 'error',
        role: binding.role,
        field: binding.field,
        reason: `Hidden field '${binding.field}' appears to be superseded by visible related field '${replacement}'.`,
        fixOptions: [`Bind '${replacement}' instead.`],
      });
    } else {
      findings.push({
        code: 'HIDDEN_FIELD',
        severity: 'warning',
        role: binding.role,
        field: binding.field,
        reason: `Field '${binding.field}' is hidden in the semantic model.`,
        fixOptions: [
          'Prefer a visible field unless the user explicitly asked for this hidden field.',
        ],
      });
    }
  }
}

function validateAxisMeasureCompatibility(
  index: ModelFieldIndex,
  bindings: readonly NormalizedBinding[],
  findings: BindingValidationFinding[],
): void {
  const axes = bindings.filter((binding) => {
    if (binding.shape !== 'column') return false;
    return binding.aggregation === undefined;
  });
  const measures = bindings.filter((binding) => binding.shape === 'measure');

  for (const measureBinding of measures) {
    const measure = findMeasure(index, measureBinding.table, measureBinding.name);
    if (!measure) continue;
    const bridge = index.treatasBridgeMeasures[`${measure.table}[${measure.name}]`];

    for (const axis of axes) {
      if (bridge && !isBridgeCoveredAxis(index, axis, bridge)) {
        findings.push({
          code: 'BRIDGE_BLOCKED_AXIS',
          severity: 'error',
          role: measureBinding.role,
          field: measureBinding.field,
          reason: `TREATAS bridge measure '${measureBinding.field}' does not cover axis '${axis.field}'.`,
          fixOptions: [
            'Remove the bridged measure from this visual.',
            'Use an actuals-only measure on this axis.',
            'Create a shared dimension or add the missing axis to the target-side data before comparing at this grain.',
          ],
        });
        continue;
      }

      if (bridge) continue;

      if (!hasDirectedFilterPath(index, axis.table, measure.table)) {
        findings.push({
          code: 'NO_FILTER_PATH',
          severity: 'error',
          role: measureBinding.role,
          field: measureBinding.field,
          reason: `Axis '${axis.field}' has no active relationship path to measure table '${measure.table}'.`,
          fixOptions: [
            'Bind the visual to a related dimension.',
            'Create a conformed dimension/relationship before comparing these fields.',
            'Use a measure that is valid for the axis table.',
          ],
        });
      }
    }
  }
}

function validateModelDoctorFindings(
  index: ModelFieldIndex,
  bindings: readonly NormalizedBinding[],
  findings: BindingValidationFinding[],
): void {
  const doctor = modelDoctor(index.model);
  const boundKeys = new Set(bindings.map((binding) => `${binding.table}[${binding.name}]`));

  for (const relationshipFinding of doctor.relationships) {
    if (relationshipFinding.level !== 'error') continue;
    findings.push({
      code: 'MODEL_RELATIONSHIP_ERROR',
      severity: 'error',
      reason: relationshipFinding.message,
      fixOptions: ['Fix the relationship error before binding visuals against this model.'],
    });
  }

  for (const bpa of doctor.bpa) {
    const key = objectRefKey(bpa.object);
    const affectsBoundField = key !== null && boundKeys.has(key);
    const blocks =
      (bpa.severity === 'error' && affectsBoundField) ||
      (bpa.ruleId === 'DAX005' && affectsBoundField);
    if (!blocks) continue;

    findings.push({
      code: `MODEL_${bpa.ruleId}`,
      severity: 'error',
      field: key ?? undefined,
      reason: bpa.message,
      fixOptions: bpa.fix ? [bpa.fix] : ['Fix the model finding before binding this field.'],
    });
  }
}

function validateMeasureProvenance(
  binding: NormalizedBinding,
  measure: ModelMeasureField,
  findings: BindingValidationFinding[],
): void {
  if (!looksLikeTargetProxy(measure)) return;
  if (measure.description?.trim().startsWith('Proxy: user-approved.')) return;

  findings.push({
    code: 'UNAPPROVED_PROXY_MEASURE',
    severity: 'error',
    role: binding.role,
    field: binding.field,
    reason: `Measure '${binding.field}' looks like a numeric-literal proxy for a target/budget-style metric but is not marked as user-approved.`,
    fixOptions: [
      'Use a direct source metric from the model.',
      'Ask the user for an explicit proxy formula before creating/binding the measure.',
      'If approved by the user, set description to: Proxy: user-approved. Source: <formula/reason>. Replace when real source data is available.',
    ],
  });
}

function looksLikeTargetProxy(measure: ModelMeasureField): boolean {
  if (!/(target|budget|plan|forecast|quota|goal)/i.test(measure.name)) return false;
  const expression = stripDaxComments(measure.expression);
  return /(\]|\))\s*[*\/]\s*\d+(?:\.\d+)?/.test(expression);
}

function stripDaxComments(expr: string): string {
  return expr
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1 ')
    .replace(/(^|\s)--[^\n]*/g, '$1 ');
}

function findVisibleReplacement(index: ModelFieldIndex, column: ModelColumnField): string | null {
  for (const table of Object.values(index.tables)) {
    if (table.name === column.table) continue;
    const candidate = table.columns[column.name];
    if (!candidate || candidate.isHidden) continue;
    if (!hasDirectedFilterPath(index, table.name, column.table)) continue;
    return `${table.name}[${candidate.name}]`;
  }
  return null;
}

function isBridgeCoveredAxis(
  index: ModelFieldIndex,
  axis: NormalizedBinding,
  bridge: { coveredAxes: readonly string[]; fromTables: readonly string[] },
): boolean {
  if (!bridge.coveredAxes.includes(axis.name)) return false;
  return bridge.fromTables.some(
    (fromTable) => axis.table === fromTable || hasDirectedFilterPath(index, axis.table, fromTable),
  );
}

function objectRefKey(object: string): string | null {
  const match = /^'([^']+)'\[([^\]]+)\]$/.exec(object);
  if (!match || !match[1] || !match[2]) return null;
  return `${match[1]}[${match[2]}]`;
}

function hasErrors(findings: readonly BindingValidationFinding[]): boolean {
  return findings.some((finding) => finding.severity === 'error');
}

function report(
  status: BindingValidationStatus,
  page: string,
  visual: string,
  visualType: string,
  modelPath: string | undefined,
  modelFingerprint: string | undefined,
  findings: readonly BindingValidationFinding[],
): VisualBindingValidationReport {
  const telemetry = telemetryFor(findings);
  return {
    status,
    blockedWrite: status === 'blocked',
    page,
    visual,
    visualType,
    modelPath,
    modelFingerprint,
    findings,
    telemetry,
  };
}

function telemetryFor(findings: readonly BindingValidationFinding[]): BindingValidationTelemetry {
  const codes: Record<string, number> = {};
  let errorCount = 0;
  let warningCount = 0;

  for (const finding of findings) {
    codes[finding.code] = (codes[finding.code] ?? 0) + 1;
    if (finding.severity === 'error') errorCount++;
    if (finding.severity === 'warning') warningCount++;
  }

  return {
    refusalCount: errorCount > 0 ? 1 : 0,
    errorCount,
    warningCount,
    codes,
  };
}
