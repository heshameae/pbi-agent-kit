import { isTemporalType, normalizeDataType } from './data-types.js';
import { classifyTable } from './fact-classifier.js';
import { isMeasureLikeNumeric } from './naming.js';
import {
  type RelationshipReason,
  relationshipCheck,
  typesCompatible,
} from './relationship-check.js';
import type { TMDLColumn, TMDLModel, TMDLRelationship, TMDLTable } from './types.js';

export interface StarSchemaSharedDimensionPlanOptions {
  readonly axes?: ReadonlyArray<string>;
  readonly sharedColumns?: ReadonlyArray<string>;
}

export interface StarSchemaSharedDimensionPlanResult {
  readonly design: 'star-schema-shared-dimension';
  readonly directFactRelationshipAllowed: false;
  readonly leftTable: string;
  readonly rightTable: string;
  readonly plans: ReadonlyArray<StarSchemaSharedDimensionPlan>;
  readonly blockers: ReadonlyArray<StarSchemaSharedDimensionBlocker>;
}

export interface StarSchemaSharedDimensionPlan {
  readonly axis: string;
  readonly leftTable: string;
  readonly rightTable: string;
  readonly source: 'new-calculated-table' | 'existing-dimension';
  readonly proposedDimensionTableName: string;
  readonly dimensionKeyColumn: string;
  readonly daxExpression?: string;
  readonly writePlan: ReadonlyArray<StarSchemaWritePlanItem>;
}

export type StarSchemaWritePlanItem =
  | CreateCalculatedTablePlanItem
  | ConfigureDimensionKeyPlanItem
  | CreateRelationshipsPlanItem
  | RepairRelationshipsPlanItem
  | HideSourceColumnsPlanItem;

export interface CreateCalculatedTablePlanItem {
  readonly action: 'create-calculated-table';
  readonly tableName: string;
  readonly expression: string;
  readonly description: string;
}

export interface ConfigureDimensionKeyPlanItem {
  readonly action: 'configure-dimension-key';
  readonly tableName: string;
  readonly columnName: string;
  readonly summarizeBy: 'none';
  readonly isKey: true;
  readonly description: string;
}

export interface CreateRelationshipsPlanItem {
  readonly action: 'create-relationships';
  readonly relationships: ReadonlyArray<StarSchemaRelationshipPlan>;
  readonly description: string;
}

export interface StarSchemaRelationshipPlan {
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly cardinality: 'manyToOne';
  readonly crossFilteringBehavior: 'single';
  readonly isActive: true;
}

export interface RepairRelationshipsPlanItem {
  readonly action: 'repair-relationships';
  readonly relationships: ReadonlyArray<StarSchemaRelationshipRepairPlan>;
  readonly description: string;
}

export interface StarSchemaRelationshipRepairPlan extends StarSchemaRelationshipPlan {
  readonly id: string;
  readonly reason: 'inactive' | 'bidirectional';
}

export interface HideSourceColumnsPlanItem {
  readonly action: 'hide-source-columns';
  readonly columns: ReadonlyArray<StarSchemaColumnRef>;
  readonly description: string;
}

export interface StarSchemaColumnRef {
  readonly table: string;
  readonly column: string;
}

export type StarSchemaSharedDimensionBlocker =
  | TableNotFoundBlocker
  | AxisMissingBlocker
  | AxisTypeMismatchBlocker
  | AxisUnusableBlocker
  | RelationshipRepairUnsupportedBlocker
  | RelationshipWriteBlockedBlocker
  | NoSharedAxesBlocker
  | NoUsableSharedAxesBlocker;

export interface TableNotFoundBlocker {
  readonly code: 'table-not-found';
  readonly table: string;
  readonly message: string;
}

export interface AxisMissingBlocker {
  readonly code: 'axis-missing-on-left' | 'axis-missing-on-right';
  readonly axis: string;
  readonly message: string;
}

export interface AxisTypeMismatchBlocker {
  readonly code: 'axis-type-mismatch';
  readonly axis: string;
  readonly leftDataType: string;
  readonly rightDataType: string;
  readonly message: string;
}

export interface AxisUnusableBlocker {
  readonly code: 'axis-unusable-on-left' | 'axis-unusable-on-right';
  readonly axis: string;
  readonly table: string;
  readonly reason: 'calculated' | 'unsupported-data-type' | 'measure-like' | 'temporal-axis';
  readonly dataType?: string;
  readonly message: string;
}

export interface RelationshipRepairUnsupportedBlocker {
  readonly code: 'relationship-repair-unsupported';
  readonly axis: string;
  readonly relationshipId: string;
  readonly reason: 'wrong-cardinality' | 'wrong-direction' | 'relationship-id-missing';
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly message: string;
}

export interface RelationshipWriteBlockedBlocker {
  readonly code: 'relationship-write-blocked';
  readonly action: 'create-relationship' | 'repair-relationship';
  readonly axis: string;
  readonly relationshipId?: string;
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly blocking: ReadonlyArray<RelationshipReason>;
  readonly message: string;
}

export interface NoSharedAxesBlocker {
  readonly code: 'no-shared-axes';
  readonly message: string;
}

export interface NoUsableSharedAxesBlocker {
  readonly code: 'no-usable-shared-axes';
  readonly message: string;
}

const ALLOWED_SHARED_AXIS_DATA_TYPES = new Set([
  'string',
  'date',
  'datetime',
  'datetimezone',
  'int64',
  'decimal',
  'double',
]);

export function planStarSchemaSharedDimensions(
  model: TMDLModel,
  leftTable: string,
  rightTable: string,
  options: StarSchemaSharedDimensionPlanOptions = {},
): StarSchemaSharedDimensionPlanResult {
  const blockers: StarSchemaSharedDimensionBlocker[] = [];
  const tableByName = new Map(model.tables.map((table) => [table.name, table]));
  const left = tableByName.get(leftTable);
  const right = tableByName.get(rightTable);

  if (!left) {
    blockers.push({
      code: 'table-not-found',
      table: leftTable,
      message: `Table not found: ${leftTable}`,
    });
  }
  if (!right) {
    blockers.push({
      code: 'table-not-found',
      table: rightTable,
      message: `Table not found: ${rightTable}`,
    });
  }

  if (!left || !right) {
    return baseResult(leftTable, rightTable, [], blockers);
  }

  const axisNames = resolveAxisNames(left, right, options);
  if (axisNames.length === 0) {
    blockers.push({
      code: 'no-shared-axes',
      message: `No shared axes found between "${leftTable}" and "${rightTable}".`,
    });
    return baseResult(leftTable, rightTable, [], blockers);
  }

  const usedTableNames = new Set(model.tables.map((table) => table.name));
  const plans: StarSchemaSharedDimensionPlan[] = [];

  for (const axis of axisNames) {
    const leftColumn = left.columns.find((column) => column.name === axis);
    const rightColumn = right.columns.find((column) => column.name === axis);

    if (!leftColumn) {
      blockers.push({
        code: 'axis-missing-on-left',
        axis,
        message: `Axis "${axis}" does not exist on table "${leftTable}".`,
      });
      continue;
    }
    if (!rightColumn) {
      blockers.push({
        code: 'axis-missing-on-right',
        axis,
        message: `Axis "${axis}" does not exist on table "${rightTable}".`,
      });
      continue;
    }

    const leftUsabilityBlocker = axisUsabilityBlocker('left', leftColumn);
    if (leftUsabilityBlocker) {
      blockers.push(leftUsabilityBlocker);
      continue;
    }
    const rightUsabilityBlocker = axisUsabilityBlocker('right', rightColumn);
    if (rightUsabilityBlocker) {
      blockers.push(rightUsabilityBlocker);
      continue;
    }

    if (!typesCompatible(leftColumn, rightColumn)) {
      blockers.push({
        code: 'axis-type-mismatch',
        axis,
        leftDataType: leftColumn.dataType,
        rightDataType: rightColumn.dataType,
        message: `Axis "${axis}" has incompatible data types: ${leftTable}[${axis}]=${leftColumn.dataType} vs ${rightTable}[${axis}]=${rightColumn.dataType}.`,
      });
      continue;
    }
    if (isTemporalSharedAxis(leftColumn, rightColumn)) {
      blockers.push({
        code: 'axis-unusable-on-left',
        axis,
        table: leftTable,
        reason: 'temporal-axis',
        dataType: leftColumn.dataType,
        message: `Axis "${axis}" is temporal. Use pbi_model_plan_date_table and pbi_model_plan_date_grain for Date relationships instead of the star-schema shared-dimension planner.`,
      });
      continue;
    }

    const existingDimension = findExistingDimensionForAxis(
      model,
      axis,
      leftTable,
      rightTable,
      leftColumn,
      rightColumn,
    );
    const dimensionTableName =
      existingDimension?.table.name ?? proposeDimensionTableName(axis, usedTableNames);
    const dimensionKeyColumn = existingDimension?.keyColumn ?? {
      ...leftColumn,
      table: dimensionTableName,
      name: axis,
    };
    if (!existingDimension) usedTableNames.add(dimensionTableName);
    const daxExpression = existingDimension
      ? undefined
      : buildSharedDimensionDax(leftTable, rightTable, axis);

    const write = buildWritePlan(
      model,
      leftTable,
      rightTable,
      axis,
      dimensionTableName,
      dimensionKeyColumn,
      daxExpression,
    );

    plans.push({
      axis,
      leftTable,
      rightTable,
      source: existingDimension ? 'existing-dimension' : 'new-calculated-table',
      proposedDimensionTableName: dimensionTableName,
      dimensionKeyColumn: dimensionKeyColumn.name,
      ...(daxExpression !== undefined ? { daxExpression } : {}),
      writePlan: write.writePlan,
    });
    blockers.push(...write.blockers);
  }

  if (plans.length === 0 && !blockers.some((blocker) => blocker.code === 'no-shared-axes')) {
    blockers.push({
      code: 'no-usable-shared-axes',
      message: `No usable shared axes found between "${leftTable}" and "${rightTable}".`,
    });
  }

  return baseResult(leftTable, rightTable, plans, blockers);
}

function baseResult(
  leftTable: string,
  rightTable: string,
  plans: ReadonlyArray<StarSchemaSharedDimensionPlan>,
  blockers: ReadonlyArray<StarSchemaSharedDimensionBlocker>,
): StarSchemaSharedDimensionPlanResult {
  return {
    design: 'star-schema-shared-dimension',
    directFactRelationshipAllowed: false,
    leftTable,
    rightTable,
    plans,
    blockers,
  };
}

function resolveAxisNames(
  left: TMDLTable,
  right: TMDLTable,
  options: StarSchemaSharedDimensionPlanOptions,
): ReadonlyArray<string> {
  const requestedAxes = options.axes ?? options.sharedColumns;
  if (requestedAxes) return dedupe(requestedAxes);

  const rightColumnNames = new Set(right.columns.map((column) => column.name));
  return dedupe(
    left.columns.map((column) => column.name).filter((name) => rightColumnNames.has(name)),
  ).sort(compareCodePoint);
}

function compareCodePoint(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function dedupe(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function axisUsabilityBlocker(
  side: 'left' | 'right',
  column: TMDLColumn,
): AxisUnusableBlocker | undefined {
  const code = side === 'left' ? 'axis-unusable-on-left' : 'axis-unusable-on-right';
  if (column.isCalculated) {
    return {
      code,
      axis: column.name,
      table: column.table,
      reason: 'calculated',
      message: `Axis "${column.name}" on table "${column.table}" is calculated.`,
    };
  }
  if (!ALLOWED_SHARED_AXIS_DATA_TYPES.has(normalizeDataType(column.dataType))) {
    return {
      code,
      axis: column.name,
      table: column.table,
      reason: 'unsupported-data-type',
      dataType: column.dataType,
      message: `Axis "${column.name}" on table "${column.table}" has unsupported data type "${column.dataType}".`,
    };
  }
  if (isMeasureLikeColumn(column)) {
    return {
      code,
      axis: column.name,
      table: column.table,
      reason: 'measure-like',
      dataType: column.dataType,
      message: `Axis "${column.name}" on table "${column.table}" is numeric and summarized like a measure.`,
    };
  }
  return undefined;
}

function isTemporalSharedAxis(leftColumn: TMDLColumn, rightColumn: TMDLColumn): boolean {
  return isTemporalSharedAxisColumn(leftColumn) || isTemporalSharedAxisColumn(rightColumn);
}

function isTemporalSharedAxisColumn(column: TMDLColumn): boolean {
  return isTemporalType(column.dataType) || (column.dataCategory ?? '').toLowerCase() === 'time';
}

function isMeasureLikeColumn(column: TMDLColumn): boolean {
  // Engine-default Sum (undefined summarizeBy on a numeric column) is measure-like;
  // explicit `none` and numeric keys/identifiers are not. Shared helper keeps this
  // aligned with the fact-classifier / grain / field-index definitions (no behavior
  // change here — star-schema already excluded keys and treated undefined as Sum).
  return isMeasureLikeNumeric(column);
}

function looksIntrinsicallyFactLike(table: TMDLTable): boolean {
  return table.measures.length > 0 || table.columns.some(isMeasureLikeColumn);
}

function proposeDimensionTableName(axis: string, usedTableNames: Set<string>): string {
  if (!usedTableNames.has(axis)) return axis;

  for (const suffix of [' Shared', ' Lookup']) {
    const candidate = `${axis}${suffix}`;
    if (!usedTableNames.has(candidate)) return candidate;
  }

  let index = 2;
  while (usedTableNames.has(`${axis} Shared ${index}`)) {
    index += 1;
  }
  return `${axis} Shared ${index}`;
}

function findExistingDimensionForAxis(
  model: TMDLModel,
  axis: string,
  leftTable: string,
  rightTable: string,
  leftColumn: TMDLColumn,
  rightColumn: TMDLColumn,
): { readonly table: TMDLTable; readonly keyColumn: TMDLColumn } | undefined {
  const candidates: Array<{
    table: TMDLTable;
    keyColumn: TMDLColumn;
    nameRank: number | undefined;
    relationshipCoverage: number;
    unsupportedRepairCount: number;
    isKey: boolean;
  }> = [];
  for (const table of model.tables) {
    if (table.name === leftTable || table.name === rightTable) continue;
    const classification = classifyTable(model, table.name);
    if (classification.kind === 'fact') continue;
    if (classification.kind === 'unknown' && looksIntrinsicallyFactLike(table)) continue;
    for (const column of candidateDimensionKeyColumns(model.relationships, table, axis, [
      leftTable,
      rightTable,
    ])) {
      if (
        axisUsabilityBlocker('left', column) !== undefined ||
        !typesCompatible(column, leftColumn) ||
        !typesCompatible(column, rightColumn)
      ) {
        continue;
      }
      const nameRank = existingDimensionNameRank(table.name, axis);
      const relationshipCoverage = safeRelationshipCoverage(
        model.relationships,
        table.name,
        axis,
        column.name,
        [leftTable, rightTable],
      );
      const unsupportedRepairCount = unsupportedRelationshipRepairBlockers(
        model.relationships,
        axis,
        leftTable,
        rightTable,
        table.name,
        column.name,
      ).length;
      if (relationshipCoverage === 0 && unsupportedRepairCount === 0) continue;
      candidates.push({
        table,
        keyColumn: column,
        nameRank,
        relationshipCoverage,
        unsupportedRepairCount,
        isKey: column.isKey,
      });
    }
  }

  return candidates.sort(
    (a, b) =>
      a.unsupportedRepairCount - b.unsupportedRepairCount ||
      b.relationshipCoverage - a.relationshipCoverage ||
      (a.nameRank ?? Number.MAX_SAFE_INTEGER) - (b.nameRank ?? Number.MAX_SAFE_INTEGER) ||
      Number(b.isKey) - Number(a.isKey) ||
      compareCodePoint(a.keyColumn.name, b.keyColumn.name) ||
      compareCodePoint(a.table.name, b.table.name),
  )[0];
}

function candidateDimensionKeyColumns(
  relationships: ReadonlyArray<TMDLRelationship>,
  table: TMDLTable,
  axis: string,
  sourceTables: ReadonlyArray<string>,
): ReadonlyArray<TMDLColumn> {
  const byName = new Map(table.columns.map((column) => [column.name, column]));
  const candidates = new Map<string, TMDLColumn>();
  const sameName = byName.get(axis);
  if (sameName) candidates.set(sameName.name, sameName);
  for (const relationship of relationships) {
    for (const sourceTable of sourceTables) {
      if (
        relationship.fromTable === sourceTable &&
        relationship.fromColumn === axis &&
        relationship.toTable === table.name
      ) {
        const column = byName.get(relationship.toColumn);
        if (column) candidates.set(column.name, column);
      }
      if (
        relationship.toTable === sourceTable &&
        relationship.toColumn === axis &&
        relationship.fromTable === table.name
      ) {
        const column = byName.get(relationship.fromColumn);
        if (column) candidates.set(column.name, column);
      }
    }
  }
  return [...candidates.values()];
}

function existingDimensionNameRank(tableName: string, axis: string): number | undefined {
  if (tableName === axis) return 0;
  const table = normalizeDimensionName(tableName);
  const tableWithoutAffixes = normalizeDimensionName(tableName, { stripAffixes: true });
  const axisName = normalizeDimensionName(axis);
  const axisKeyStem = normalizeKeyStem(axis);
  if (table === axisName) return 1;
  if (tableWithoutAffixes === axisName) return 2;
  if (axisKeyStem && tableWithoutAffixes === axisKeyStem) return 3;
  if (axisKeyStem && table === axisKeyStem) return 4;
  return undefined;
}

function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularizeToken);
}

function normalizeDimensionName(name: string, opts: { stripAffixes?: boolean } = {}): string {
  const tokens = nameTokens(name);
  if (opts.stripAffixes) {
    while (tokens.length > 0 && DIMENSION_PREFIX_TOKENS.has(tokens[0] as string)) tokens.shift();
    while (tokens.length > 0 && DIMENSION_SUFFIX_TOKENS.has(tokens[tokens.length - 1] as string)) {
      tokens.pop();
    }
  }
  return tokens.join('');
}

const DIMENSION_PREFIX_TOKENS = new Set(['d', 'dim', 'dimension']);
const DIMENSION_SUFFIX_TOKENS = new Set(['dim', 'dimension', 'lookup', 'shared']);
const KEY_SUFFIX_TOKENS = new Set(['key', 'id', 'code']);

function normalizeKeyStem(name: string): string | undefined {
  const tokens = nameTokens(name);
  while (tokens.length > 1 && KEY_SUFFIX_TOKENS.has(tokens[tokens.length - 1] as string)) {
    tokens.pop();
  }
  const normalized = tokens.join('');
  return normalized.length > 0 ? normalized : undefined;
}

function singularizeToken(token: string): string {
  return token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token;
}

function buildSharedDimensionDax(leftTable: string, rightTable: string, axis: string): string {
  const leftTableRef = quoteDaxTableName(leftTable);
  const rightTableRef = quoteDaxTableName(rightTable);
  const axisAlias = quoteDaxString(axis);
  const columnRef = quoteDaxColumnName(axis);

  return [
    'DISTINCT(',
    '  UNION(',
    `    SELECTCOLUMNS(${leftTableRef}, ${axisAlias}, ${leftTableRef}${columnRef}),`,
    `    SELECTCOLUMNS(${rightTableRef}, ${axisAlias}, ${rightTableRef}${columnRef})`,
    '  )',
    ')',
  ].join('\n');
}

function quoteDaxTableName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function quoteDaxColumnName(name: string): string {
  return `[${name.replace(/\]/g, ']]')}]`;
}

function quoteDaxString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

interface BuildWritePlanResult {
  readonly writePlan: ReadonlyArray<StarSchemaWritePlanItem>;
  readonly blockers: ReadonlyArray<StarSchemaSharedDimensionBlocker>;
}

function buildWritePlan(
  model: TMDLModel,
  leftTable: string,
  rightTable: string,
  axis: string,
  dimensionTableName: string,
  dimensionKeyColumn: TMDLColumn,
  daxExpression: string | undefined,
): BuildWritePlanResult {
  const out: StarSchemaWritePlanItem[] = [];
  const blockers: StarSchemaSharedDimensionBlocker[] = [];
  if (daxExpression !== undefined) {
    out.push({
      action: 'create-calculated-table',
      tableName: dimensionTableName,
      expression: daxExpression,
      description: `Create calculated table "${dimensionTableName}" from the distinct "${axis}" values in both source tables.`,
    });
  }
  out.push({
    action: 'configure-dimension-key',
    tableName: dimensionTableName,
    columnName: dimensionKeyColumn.name,
    summarizeBy: 'none',
    isKey: true,
    description: `Mark ${dimensionTableName}[${dimensionKeyColumn.name}] as the dimension key and disable implicit summarization.`,
  });
  const relationships = [
    sharedDimensionRelationship(leftTable, axis, dimensionTableName, dimensionKeyColumn.name),
    sharedDimensionRelationship(rightTable, axis, dimensionTableName, dimensionKeyColumn.name),
  ];
  const missingRelationships: StarSchemaRelationshipPlan[] = [];
  const repairRelationships: StarSchemaRelationshipRepairPlan[] = [];
  let gateModel = modelWithPlannedDimension(model, dimensionTableName, dimensionKeyColumn);

  for (const relationship of relationships) {
    if (relationshipAlreadyExists(gateModel.relationships, relationship)) continue;
    const existing = findRelationshipWithSameEndpoints(model.relationships, relationship);
    if (existing) {
      const reason = relationshipRepairReason(existing, relationship);
      if (!reason) continue;
      if (!isExecutableRepairReason(reason)) {
        blockers.push(relationshipRepairUnsupportedBlocker(axis, existing, relationship, reason));
        continue;
      }
      const repair = {
        ...relationship,
        id: existing.id,
        reason,
      };
      const blocked = relationshipWriteBlocker('repair-relationship', axis, gateModel, repair);
      if (blocked) {
        blockers.push(blocked);
        continue;
      }
      repairRelationships.push(repair);
      gateModel = modelWithGateRelationship(gateModel, repair, existing.id);
      continue;
    }
    const blocked = relationshipWriteBlocker('create-relationship', axis, gateModel, relationship);
    if (blocked) {
      blockers.push(blocked);
      continue;
    }
    missingRelationships.push(relationship);
    gateModel = modelWithGateRelationship(gateModel, relationship);
  }
  if (missingRelationships.length > 0) {
    out.push({
      action: 'create-relationships',
      relationships: missingRelationships,
      description: `Create single-direction many-to-one relationships from each source table to "${dimensionTableName}".`,
    });
  }
  if (repairRelationships.length > 0) {
    out.push({
      action: 'repair-relationships',
      relationships: repairRelationships,
      description: `Repair existing relationships so each source table filters through "${dimensionTableName}" as active, single-direction, many-to-one edges.`,
    });
  }
  out.push({
    action: 'hide-source-columns',
    columns: [
      { table: leftTable, column: axis },
      { table: rightTable, column: axis },
    ],
    description: `Hide the source "${axis}" columns after relationships to "${dimensionTableName}" are in place.`,
  });
  if (blockers.length > 0) return { writePlan: [], blockers };
  return { writePlan: out, blockers };
}

function relationshipAlreadyExists(
  relationships: ReadonlyArray<TMDLRelationship>,
  planned: StarSchemaRelationshipPlan,
): boolean {
  return relationships.some((existing) => relationshipSatisfiesPlan(existing, planned));
}

function findRelationshipWithSameEndpoints(
  relationships: ReadonlyArray<TMDLRelationship>,
  planned: StarSchemaRelationshipPlan,
): TMDLRelationship | undefined {
  return relationships.find(
    (existing) =>
      (existing.fromTable === planned.fromTable &&
        existing.fromColumn === planned.fromColumn &&
        existing.toTable === planned.toTable &&
        existing.toColumn === planned.toColumn) ||
      (existing.fromTable === planned.toTable &&
        existing.fromColumn === planned.toColumn &&
        existing.toTable === planned.fromTable &&
        existing.toColumn === planned.fromColumn),
  );
}

type RelationshipRepairReason =
  | StarSchemaRelationshipRepairPlan['reason']
  | RelationshipRepairUnsupportedBlocker['reason'];

function relationshipRepairReason(
  existing: TMDLRelationship,
  planned: StarSchemaRelationshipPlan,
): RelationshipRepairReason | undefined {
  if (existing.identityProven !== true) return 'relationship-id-missing';
  const exact =
    existing.fromTable === planned.fromTable &&
    existing.fromColumn === planned.fromColumn &&
    existing.toTable === planned.toTable &&
    existing.toColumn === planned.toColumn;
  if (exact) {
    if (existing.cardinality !== 'manyToOne') {
      return 'wrong-cardinality';
    }
    if (!existing.isActive) return 'inactive';
    if (existing.crossFilteringBehavior !== 'single') return 'bidirectional';
    return undefined;
  }
  const reversed =
    existing.fromTable === planned.toTable &&
    existing.fromColumn === planned.toColumn &&
    existing.toTable === planned.fromTable &&
    existing.toColumn === planned.fromColumn;
  if (reversed) {
    if (existing.cardinality !== 'oneToMany') {
      return 'wrong-cardinality';
    }
    return 'wrong-direction';
  }
  return undefined;
}

function isExecutableRepairReason(
  reason: RelationshipRepairReason | undefined,
): reason is StarSchemaRelationshipRepairPlan['reason'] {
  return reason === 'inactive' || reason === 'bidirectional';
}

function safeRelationshipCoverage(
  relationships: ReadonlyArray<TMDLRelationship>,
  dimensionTable: string,
  axis: string,
  dimensionKeyColumn: string,
  sourceTables: ReadonlyArray<string>,
): number {
  let coverage = 0;
  for (const sourceTable of sourceTables) {
    const planned = sharedDimensionRelationship(
      sourceTable,
      axis,
      dimensionTable,
      dimensionKeyColumn,
    );
    if (relationshipAlreadyExists(relationships, planned)) {
      coverage += 1;
      continue;
    }
    const existing = findRelationshipWithSameEndpoints(relationships, planned);
    const reason = existing ? relationshipRepairReason(existing, planned) : undefined;
    if (isExecutableRepairReason(reason)) {
      coverage += 1;
    }
  }
  return coverage;
}

function unsupportedRelationshipRepairBlockers(
  relationships: ReadonlyArray<TMDLRelationship>,
  axis: string,
  leftTable: string,
  rightTable: string,
  dimensionTableName: string,
  dimensionKeyColumn: string,
): ReadonlyArray<RelationshipRepairUnsupportedBlocker> {
  const blockers: RelationshipRepairUnsupportedBlocker[] = [];
  for (const sourceTable of [leftTable, rightTable]) {
    const planned = sharedDimensionRelationship(
      sourceTable,
      axis,
      dimensionTableName,
      dimensionKeyColumn,
    );
    if (relationshipAlreadyExists(relationships, planned)) continue;
    const existing = findRelationshipWithSameEndpoints(relationships, planned);
    if (!existing) continue;
    const reason = relationshipRepairReason(existing, planned);
    if (!reason || isExecutableRepairReason(reason)) continue;
    blockers.push(relationshipRepairUnsupportedBlocker(axis, existing, planned, reason));
  }
  return blockers;
}

function relationshipRepairUnsupportedBlocker(
  axis: string,
  existing: TMDLRelationship,
  planned: StarSchemaRelationshipPlan,
  reason: RelationshipRepairUnsupportedBlocker['reason'],
): RelationshipRepairUnsupportedBlocker {
  const fix =
    reason === 'wrong-direction'
      ? 'Delete/recreate it with the planned many-side and one-side endpoints; the current MCP update path cannot safely repair relationship orientation/cardinality.'
      : reason === 'relationship-id-missing'
        ? 'Refresh relationship metadata or target the relationship by a proven model identity before attempting an automatic repair.'
        : 'Delete/recreate it as many-to-one, single-direction, active.';
  return {
    code: 'relationship-repair-unsupported',
    axis,
    relationshipId: existing.id,
    reason,
    fromTable: planned.fromTable,
    fromColumn: planned.fromColumn,
    toTable: planned.toTable,
    toColumn: planned.toColumn,
    message: `Relationship "${existing.id}" already connects ${planned.fromTable}[${planned.fromColumn}] to ${planned.toTable}[${planned.toColumn}] but is not safe for an automatic repair. ${fix}`,
  };
}

function relationshipWriteBlocker(
  action: RelationshipWriteBlockedBlocker['action'],
  axis: string,
  model: TMDLModel,
  relationship: StarSchemaRelationshipPlan | StarSchemaRelationshipRepairPlan,
): RelationshipWriteBlockedBlocker | undefined {
  const check = relationshipCheck(relationship, model, {
    ...('id' in relationship ? { ignoreRelationshipId: relationship.id } : {}),
  });
  if (check.valid) return undefined;
  return {
    code: 'relationship-write-blocked',
    action,
    axis,
    ...('id' in relationship ? { relationshipId: relationship.id } : {}),
    fromTable: relationship.fromTable,
    fromColumn: relationship.fromColumn,
    toTable: relationship.toTable,
    toColumn: relationship.toColumn,
    blocking: check.blocking,
    message: `Relationship ${relationship.fromTable}[${relationship.fromColumn}] → ${relationship.toTable}[${relationship.toColumn}] is blocked by the relationship pre-write gate.`,
  };
}

function modelWithPlannedDimension(
  model: TMDLModel,
  dimensionTableName: string,
  dimensionColumn: TMDLColumn,
): TMDLModel {
  if (model.tables.some((table) => table.name === dimensionTableName)) return model;
  return {
    ...model,
    tables: [
      ...model.tables,
      {
        name: dimensionTableName,
        columns: [
          {
            ...dimensionColumn,
            table: dimensionTableName,
            name: dimensionColumn.name,
            summarizeBy: 'none',
            isHidden: false,
            isKey: true,
            isCalculated: false,
          },
        ],
        measures: [],
        isHidden: false,
        isCalculated: true,
        isAutoDateTable: false,
      },
    ],
  };
}

function modelWithGateRelationship(
  model: TMDLModel,
  relationship: StarSchemaRelationshipPlan | StarSchemaRelationshipRepairPlan,
  replaceRelationshipId?: string,
): TMDLModel {
  const id =
    replaceRelationshipId ??
    `__planned__:${relationship.fromTable}[${relationship.fromColumn}]->${relationship.toTable}[${relationship.toColumn}]`;
  return {
    ...model,
    relationships: [
      ...model.relationships.filter((existing) => existing.id !== replaceRelationshipId),
      {
        id,
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

function relationshipSatisfiesPlan(
  existing: TMDLRelationship,
  planned: StarSchemaRelationshipPlan,
): boolean {
  if (!existing.isActive || existing.crossFilteringBehavior !== 'single') return false;
  const exact =
    existing.fromTable === planned.fromTable &&
    existing.fromColumn === planned.fromColumn &&
    existing.toTable === planned.toTable &&
    existing.toColumn === planned.toColumn;
  if (exact) return existing.cardinality === 'manyToOne';

  return false;
}

function sharedDimensionRelationship(
  sourceTable: string,
  axis: string,
  dimensionTableName: string,
  dimensionKeyColumn: string,
): StarSchemaRelationshipPlan {
  return {
    fromTable: sourceTable,
    fromColumn: axis,
    toTable: dimensionTableName,
    toColumn: dimensionKeyColumn,
    cardinality: 'manyToOne',
    crossFilteringBehavior: 'single',
    isActive: true,
  };
}
