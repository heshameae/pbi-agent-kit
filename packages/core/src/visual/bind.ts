// Visual data binding — connects a visual's data roles to model fields.
//
// Ported from pbi-cli's core/visual_backend.py `visual_bind` (lines 540-631)
// and `_parse_field_ref` (lines 638-652).
//
// This is the most empirical-knowledge file in the entire port: the JSON
// shape of a projection is what Power BI Desktop expects and what its
// validators check. Do not "improve" the shapes.
//
// Measure projection (e.g. `MyTable[My Measure With Spaces]` bound to Y):
//   {
//     "field": { "Measure": { "Expression": { "SourceRef": { "Entity": "MyTable" } }, "Property": "My Measure With Spaces" } },
//     "queryRef": "MyTable.My Measure With Spaces",
//     "nativeQueryRef": "My Measure With Spaces"
//   }
//
// Column projection (e.g. `MyOtherTable[MyColumn]` bound to Category):
//   {
//     "field": { "Column": { "Expression": { "SourceRef": { "Entity": "MyOtherTable" } }, "Property": "MyColumn" } },
//     "queryRef": "MyOtherTable.MyColumn",
//     "nativeQueryRef": "MyColumn",
//     "active": true                  // ← Columns get this; Measures do NOT
//   }
//
// Aggregated-column projection (e.g. summable column `MyTable[MyNumColumn]`
// bound to Values — required when binding a column with `summarizeBy != "None"`
// to a measure-style role; otherwise Desktop renders "Something's wrong"):
//   {
//     "field": {
//       "Aggregation": {
//         "Expression": { "Column": { "Expression": { "SourceRef": { "Entity": "MyTable" } }, "Property": "MyNumColumn" } },
//         "Function": 0
//       }
//     },
//     "queryRef": "Sum(MyTable.MyNumColumn)",
//     "nativeQueryRef": "Sum of MyNumColumn",
//     "active": true
//   }

import { existsSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError, VisualBindValidationError } from '../errors.js';
import { readJson, writeJson } from '../pbir/io.js';
import { getVisualDir } from '../pbir/path.js';
import { type VisualBindingValidationReport, validateVisualBindingPlan } from './bind-validator.js';
import { parseFieldRef } from './field-ref.js';
import { MEASURE_ROLES, ROLE_ALIASES } from './roles.js';

export { parseFieldRef } from './field-ref.js';

// -- Types -----------------------------------------------------------------

export interface VisualBinding {
  /** Role name — either canonical PBIR ("Y", "Category") or user-friendly alias ("value", "category"). */
  readonly role: string;
  /** Field reference in `Table[Column]` notation. */
  readonly field: string;
  /** If true, force-treat as a Measure regardless of role heuristic. */
  readonly measure?: boolean;
  /**
   * Wrap a column field in an aggregation function. Required when binding a
   * column with `summarizeBy != "None"` to a measure-style role (Values, Y,
   * Indicator, etc.) — otherwise Desktop shows "Something's wrong with one
   * or more fields" because it expects an aggregated expression there.
   *
   * Ignored when `measure: true` (measures are already aggregated by their
   * DAX expression and have no AggregationContext).
   */
  readonly aggregation?: AggregationKind;
}

/** Aggregation functions supported on column-typed bindings. */
export type AggregationKind = 'sum' | 'avg' | 'count' | 'min' | 'max';

/** PBI's internal Function code for each aggregation. */
const AGGREGATION_FUNCTION: Readonly<Record<AggregationKind, number>> = {
  sum: 0,
  avg: 1,
  count: 2,
  min: 3,
  max: 4,
};

/** User-visible name in `queryRef` (e.g. "Sum(Table.Col)") and `nativeQueryRef` (e.g. "Sum of Col"). */
const AGGREGATION_LABEL: Readonly<Record<AggregationKind, string>> = {
  sum: 'Sum',
  avg: 'Average',
  count: 'Count',
  min: 'Min',
  max: 'Max',
};

export interface AppliedBinding {
  readonly role: string;
  readonly field: string;
  readonly queryRef: string;
}

export interface VisualBindResult {
  readonly status: 'bound';
  readonly name: string;
  readonly page: string;
  readonly bindings: readonly AppliedBinding[];
  readonly validation?: VisualBindingValidationReport;
}

export interface VisualBindOptions {
  /** Optional .SemanticModel/definition path. If omitted, sibling model is auto-resolved. */
  readonly modelPath?: string;
}

// -- Parse helpers ---------------------------------------------------------

// -- Operation -------------------------------------------------------------

/**
 * Bind one or more semantic-model fields to a visual's data roles.
 *
 * Role resolution: user-friendly aliases (e.g. `value` → `Y` for barChart)
 * via `ROLE_ALIASES[visualType]`; otherwise the role is passed through
 * verbatim.
 *
 * Measure-vs-Column inference: the explicit `measure` flag on a binding
 * wins; otherwise membership in `MEASURE_ROLES` decides.
 *
 * Bindings are APPENDED to existing projections. Roles missing from
 * queryState are created with an empty projections array first.
 */
export function visualBind(
  definitionPath: string,
  pageName: string,
  visualName: string,
  bindings: readonly VisualBinding[],
  options: VisualBindOptions = {},
): VisualBindResult {
  const validation = validateVisualBindingPlan(
    definitionPath,
    pageName,
    visualName,
    bindings,
    options,
  );
  if (validation.blockedWrite) {
    throw new VisualBindValidationError(validation);
  }

  const vfile = path.join(getVisualDir(definitionPath, pageName, visualName), 'visual.json');
  if (!existsSync(vfile)) {
    throw new PbiCoreError(`Visual '${visualName}' not found on page '${pageName}'.`);
  }

  const data = readJson(vfile) as Record<string, unknown>;
  const visualConfig = (data.visual as Record<string, unknown>) ?? {};
  const visualType = typeof visualConfig.visualType === 'string' ? visualConfig.visualType : '';

  // Ensure visual.query.queryState exists.
  const query = (visualConfig.query as Record<string, unknown>) ?? {};
  const queryState = (query.queryState as Record<string, unknown>) ?? {};

  const aliasMap: Readonly<Record<string, string>> =
    visualType in ROLE_ALIASES
      ? ((ROLE_ALIASES as Record<string, Readonly<Record<string, string>>>)[visualType] ?? {})
      : {};

  const applied: AppliedBinding[] = [];

  for (const b of bindings) {
    // Resolve role alias. Aliases are lowercased in the table; user input
    // can be any case. Canonical names pass through.
    const userRole = b.role;
    const pbirRole = aliasMap[userRole.toLowerCase()] ?? userRole;

    const { table, column } = parseFieldRef(b.field);
    const isMeasure = b.measure ?? MEASURE_ROLES.has(pbirRole);
    if (isMeasure && b.aggregation !== undefined) {
      throw new PbiCoreError(
        `Field '${b.field}' is a Measure; pass either measure:true OR aggregation, not both. Measures are already aggregated by their DAX expression.`,
      );
    }
    const aggregation = !isMeasure ? b.aggregation : undefined;

    let fieldExpr: Record<string, unknown>;
    let queryRef: string;
    let nativeQueryRef: string;

    if (isMeasure) {
      fieldExpr = {
        Measure: {
          Expression: { SourceRef: { Entity: table } },
          Property: column,
        },
      };
      queryRef = `${table}.${column}`;
      nativeQueryRef = column;
    } else if (aggregation !== undefined) {
      // Aggregated column — required for summarizable columns in Values/Y roles.
      fieldExpr = {
        Aggregation: {
          Expression: {
            Column: {
              Expression: { SourceRef: { Entity: table } },
              Property: column,
            },
          },
          Function: AGGREGATION_FUNCTION[aggregation],
        },
      };
      const label = AGGREGATION_LABEL[aggregation];
      queryRef = `${label}(${table}.${column})`;
      nativeQueryRef = `${label} of ${column}`;
    } else {
      // Identity column — used for Category, Legend, Rows, Columns, and table dims.
      fieldExpr = {
        Column: {
          Expression: { SourceRef: { Entity: table } },
          Property: column,
        },
      };
      queryRef = `${table}.${column}`;
      nativeQueryRef = column;
    }

    const projection: Record<string, unknown> = {
      field: fieldExpr,
      queryRef,
      nativeQueryRef,
    };
    // Columns (with or without aggregation) get "active: true"; measures do NOT.
    if (!isMeasure) projection.active = true;

    // Append to role's projections.
    const existing = (queryState[pbirRole] as Record<string, unknown>) ?? { projections: [] };
    const projections = Array.isArray(existing.projections) ? existing.projections : [];
    queryState[pbirRole] = {
      ...existing,
      projections: [...projections, projection],
    };

    applied.push({ role: pbirRole, field: b.field, queryRef });
  }

  // Write back.
  const updatedVisual = {
    ...visualConfig,
    query: { ...query, queryState },
  };
  writeJson(vfile, { ...data, visual: updatedVisual });

  return {
    status: 'bound',
    name: visualName,
    page: pageName,
    bindings: applied,
    validation,
  };
}
