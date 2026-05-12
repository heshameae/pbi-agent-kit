// Visual calculations — DAX expressions that run inside the visual's scope.
//
// Ported from pbi-cli's core/visual_backend.py `visual_calc_*` functions
// (lines 734-868). Stored as NativeVisualCalculation projections inside
// `visual.query.queryState[role].projections[]`.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError } from '../errors.js';
import { readJson, writeJson } from '../pbir/io.js';
import { getVisualDir } from '../pbir/path.js';

export interface VisualCalcAddResult {
  readonly status: 'added';
  readonly visual: string;
  readonly name: string;
  readonly role: string;
  readonly expression: string;
}

export interface VisualCalc {
  readonly name: string;
  readonly expression: string;
  readonly role: string;
  readonly queryRef: string;
}

/**
 * Add (or replace) a visual calculation. Idempotent — if a calc with the
 * same `calcName` already exists in the given role, it's replaced.
 */
export function visualCalcAdd(
  definitionPath: string,
  pageName: string,
  visualName: string,
  calcName: string,
  expression: string,
  role = 'Y',
): VisualCalcAddResult {
  const vfile = path.join(getVisualDir(definitionPath, pageName, visualName), 'visual.json');
  if (!existsSync(vfile)) {
    throw new PbiCoreError(`Visual '${visualName}' not found on page '${pageName}'.`);
  }

  const data = readJson(vfile) as Record<string, unknown>;
  const visualConfig = (data.visual as Record<string, unknown>) ?? {};
  const query = (visualConfig.query as Record<string, unknown>) ?? {};
  const queryState = (query.queryState as Record<string, unknown>) ?? {};
  const roleState = (queryState[role] as Record<string, unknown>) ?? { projections: [] };
  const existing = Array.isArray(roleState.projections) ? roleState.projections : [];

  const newProj = {
    field: {
      NativeVisualCalculation: {
        Language: 'dax',
        Expression: expression,
        Name: calcName,
      },
    },
    queryRef: 'select',
    nativeQueryRef: calcName,
  };

  // Replace existing calc with the same name; otherwise append.
  let replaced = false;
  const updated: unknown[] = [];
  for (const projRaw of existing) {
    const proj = (projRaw as Record<string, unknown>) ?? {};
    const field = (proj.field as Record<string, unknown>) ?? {};
    const nvc = (field.NativeVisualCalculation as Record<string, unknown>) ?? {};
    if (nvc.Name === calcName) {
      updated.push(newProj);
      replaced = true;
    } else {
      updated.push(proj);
    }
  }
  if (!replaced) updated.push(newProj);

  queryState[role] = { ...roleState, projections: updated };
  const updatedVisual = { ...visualConfig, query: { ...query, queryState } };
  writeJson(vfile, { ...data, visual: updatedVisual });

  return { status: 'added', visual: visualName, name: calcName, role, expression };
}

/** List every visual calculation across all roles. */
export function visualCalcList(
  definitionPath: string,
  pageName: string,
  visualName: string,
): VisualCalc[] {
  const vfile = path.join(getVisualDir(definitionPath, pageName, visualName), 'visual.json');
  if (!existsSync(vfile)) {
    throw new PbiCoreError(`Visual '${visualName}' not found on page '${pageName}'.`);
  }

  const data = readJson(vfile) as Record<string, unknown>;
  const visualConfig = (data.visual as Record<string, unknown>) ?? {};
  const query = (visualConfig.query as Record<string, unknown>) ?? {};
  const queryState = (query.queryState as Record<string, unknown>) ?? {};

  const results: VisualCalc[] = [];
  for (const [role, stateValue] of Object.entries(queryState)) {
    const state = (stateValue as Record<string, unknown>) ?? {};
    const projections = Array.isArray(state.projections) ? state.projections : [];
    for (const projRaw of projections) {
      const proj = (projRaw as Record<string, unknown>) ?? {};
      const field = (proj.field as Record<string, unknown>) ?? {};
      const nvc = field.NativeVisualCalculation as Record<string, unknown> | undefined;
      if (nvc) {
        results.push({
          name: typeof nvc.Name === 'string' ? nvc.Name : '',
          expression: typeof nvc.Expression === 'string' ? nvc.Expression : '',
          role,
          queryRef: typeof proj.queryRef === 'string' ? proj.queryRef : 'select',
        });
      }
    }
  }
  return results;
}

/** Delete a visual calculation by name. Throws if not found. */
export function visualCalcDelete(
  definitionPath: string,
  pageName: string,
  visualName: string,
  calcName: string,
): { status: 'deleted'; visual: string; name: string } {
  const vfile = path.join(getVisualDir(definitionPath, pageName, visualName), 'visual.json');
  if (!existsSync(vfile)) {
    throw new PbiCoreError(`Visual '${visualName}' not found on page '${pageName}'.`);
  }

  const data = readJson(vfile) as Record<string, unknown>;
  const visualConfig = (data.visual as Record<string, unknown>) ?? {};
  const query = (visualConfig.query as Record<string, unknown>) ?? {};
  const queryState = (query.queryState as Record<string, unknown>) ?? {};

  let found = false;
  for (const [role, stateValue] of Object.entries(queryState)) {
    const state = (stateValue as Record<string, unknown>) ?? {};
    const projections = Array.isArray(state.projections) ? state.projections : [];
    const filtered = projections.filter((projRaw) => {
      const proj = (projRaw as Record<string, unknown>) ?? {};
      const field = (proj.field as Record<string, unknown>) ?? {};
      const nvc = (field.NativeVisualCalculation as Record<string, unknown>) ?? {};
      return nvc.Name !== calcName;
    });
    if (filtered.length < projections.length) {
      queryState[role] = { ...state, projections: filtered };
      found = true;
    }
  }

  if (!found) {
    throw new PbiCoreError(`Visual calculation '${calcName}' not found in visual '${visualName}'.`);
  }

  const updatedVisual = { ...visualConfig, query: { ...query, queryState } };
  writeJson(vfile, { ...data, visual: updatedVisual });
  return { status: 'deleted', visual: visualName, name: calcName };
}
