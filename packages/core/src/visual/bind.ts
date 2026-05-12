// Visual data binding — connects a visual's data roles to model fields.
//
// Ported from pbi-cli's core/visual_backend.py `visual_bind` (lines 540-631)
// and `_parse_field_ref` (lines 638-652).
//
// This is the most empirical-knowledge file in the entire port: the JSON
// shape of a projection is what Power BI Desktop expects and what its
// validators check. Do not "improve" the shapes.
//
// Measure projection (e.g. `Sales[Total Revenue]` bound to Y):
//   {
//     "field": { "Measure": { "Expression": { "SourceRef": { "Entity": "Sales" } }, "Property": "Total Revenue" } },
//     "queryRef": "Sales.Total Revenue",
//     "nativeQueryRef": "Total Revenue"
//   }
//
// Column projection (e.g. `Geography[Region]` bound to Category):
//   {
//     "field": { "Column": { "Expression": { "SourceRef": { "Entity": "Geography" } }, "Property": "Region" } },
//     "queryRef": "Geography.Region",
//     "nativeQueryRef": "Region",
//     "active": true                  // ← Columns get this; Measures do NOT
//   }

import { existsSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError } from '../errors.js';
import { readJson, writeJson } from '../pbir/io.js';
import { getVisualDir } from '../pbir/path.js';
import { MEASURE_ROLES, ROLE_ALIASES } from './roles.js';

// -- Types -----------------------------------------------------------------

export interface VisualBinding {
  /** Role name — either canonical PBIR ("Y", "Category") or user-friendly alias ("value", "category"). */
  readonly role: string;
  /** Field reference in `Table[Column]` notation. */
  readonly field: string;
  /** If true, force-treat as a Measure regardless of role heuristic. */
  readonly measure?: boolean;
}

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
}

// -- Parse helpers ---------------------------------------------------------

const FIELD_REF_RE = /^(.+)\[(.+)\]$/;

/**
 * Parse a `Table[Column]` field reference into table/column parts.
 * Throws `PbiCoreError` on malformed input.
 */
export function parseFieldRef(ref: string): { table: string; column: string } {
  const match = FIELD_REF_RE.exec(ref.trim());
  if (!match) {
    throw new PbiCoreError(`Invalid field reference '${ref}'. Expected 'Table[Column]' format.`);
  }
  return {
    table: (match[1] ?? '').trim(),
    column: (match[2] ?? '').trim(),
  };
}

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
): VisualBindResult {
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
    const queryRef = `${table}.${column}`;

    const fieldExpr = isMeasure
      ? {
          Measure: {
            Expression: { SourceRef: { Entity: table } },
            Property: column,
          },
        }
      : {
          Column: {
            Expression: { SourceRef: { Entity: table } },
            Property: column,
          },
        };

    const projection: Record<string, unknown> = {
      field: fieldExpr,
      queryRef,
      nativeQueryRef: column,
    };
    // Columns get "active: true"; measures DO NOT (empirical, Desktop rejects
    // measures with active=true in some visuals).
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
  };
}
