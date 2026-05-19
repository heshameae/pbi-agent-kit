import type { BridgeAnalysis, GrainReport, TMDLColumn, TMDLModel, TMDLTable } from './types.js';

export function isDateLikeColumn(column: TMDLColumn): boolean {
  if (column.dataType === 'dateTime' || column.dataType === 'date') return true;
  return /(^|\s)(date|year|month|quarter|week|day)(\s|$)/i.test(column.name);
}

export function isKeyLikeColumn(column: TMDLColumn): boolean {
  if (column.isKey) return true;
  return /(id|key|code|sku|number)$/i.test(column.name);
}

export function dimColumnsOf(table: TMDLTable): ReadonlyArray<TMDLColumn> {
  return table.columns.filter(
    (c) => !c.isHidden && !isAggregatedNumericColumn(c) && !isLineageOnly(c),
  );
}

function isAggregatedNumericColumn(column: TMDLColumn): boolean {
  if (column.summarizeBy && column.summarizeBy !== 'none') {
    if (
      column.dataType === 'int64' ||
      column.dataType === 'decimal' ||
      column.dataType === 'double'
    ) {
      return true;
    }
  }
  return false;
}

function isLineageOnly(column: TMDLColumn): boolean {
  return false;
}

export function inferGrain(table: TMDLTable): ReadonlyArray<string> {
  const dims = dimColumnsOf(table);
  const keys = dims.filter((c) => isKeyLikeColumn(c));
  if (keys.length > 0) return keys.map((c) => c.name);

  const dates = dims.filter((c) => isDateLikeColumn(c));
  const firstDate = dates[0];
  if (firstDate) return [firstDate.name];

  return dims.slice(0, 3).map((c) => c.name);
}

export function buildGrainReport(model: TMDLModel): GrainReport {
  const tableGrains: Record<string, ReadonlyArray<string>> = {};
  for (const table of model.tables) {
    if (table.isAutoDateTable) continue;
    tableGrains[table.name] = inferGrain(table);
  }
  return { tableGrains };
}

export function validateBridge(
  model: TMDLModel,
  fromTable: string,
  toTable: string,
  intendedAxes?: ReadonlyArray<string>,
): BridgeAnalysis {
  const from = model.tables.find((t) => t.name === fromTable);
  const to = model.tables.find((t) => t.name === toTable);

  if (!from) {
    throw new Error(`Table not found: ${fromTable}`);
  }
  if (!to) {
    throw new Error(`Table not found: ${toTable}`);
  }

  const fromDims = dimColumnsOf(from).map((c) => c.name);
  const toDims = dimColumnsOf(to).map((c) => c.name);
  const toSet = new Set(toDims);

  const bridgeCovers = fromDims.filter((c) => toSet.has(c));
  const coversSet = new Set(bridgeCovers);

  const bridgeUncovered = (intendedAxes ?? []).filter((axis) => !coversSet.has(axis));
  const bridgeBlockedAxes = fromDims.filter((c) => !coversSet.has(c));

  return {
    fromTable,
    toTable,
    bridgeCovers,
    bridgeUncovered,
    bridgeBlockedAxes,
  };
}
