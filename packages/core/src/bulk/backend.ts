// Bulk visual operations — filter + fan-out over visual_backend functions.
//
// Ported from pbi-cli's core/bulk_backend.py. Uses fnmatch-style globs
// (translated to regex) for name patterns.

import { VisualBindValidationError, VisualTypeError } from '../errors.js';
import { resolveVisualType } from '../pbir/schemas.js';
import { type VisualListItem, visualDelete, visualList, visualUpdate } from '../visual/backend.js';
import {
  type BindingValidationFinding,
  type VisualBindingValidationReport,
  validateVisualBindingPlan,
} from '../visual/bind-validator.js';
import { type VisualBinding, visualBind } from '../visual/bind.js';

// -- Filtering -------------------------------------------------------------

export interface VisualWhereOptions {
  readonly visualType?: string;
  readonly namePattern?: string;
  readonly xMin?: number;
  readonly xMax?: number;
  readonly yMin?: number;
  readonly yMax?: number;
}

/** Translate an fnmatch-style glob to a JS RegExp (anchored). */
function globToRegex(glob: string): RegExp {
  // Escape regex chars except * and ?, then map * → .*  and  ? → .
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** Filter visuals on a page by type / name-glob / position bounds. */
export function visualWhere(
  definitionPath: string,
  pageName: string,
  opts: VisualWhereOptions = {},
): VisualListItem[] {
  let resolvedType: string | null = null;
  if (opts.visualType !== undefined) {
    resolvedType = resolveVisualType(opts.visualType);
    if (resolvedType === null) throw new VisualTypeError(opts.visualType);
  }

  const pattern = opts.namePattern ? globToRegex(opts.namePattern) : null;
  const all = visualList(definitionPath, pageName);

  return all.filter((v) => {
    if (resolvedType !== null && v.visualType !== resolvedType) return false;
    if (pattern !== null && !pattern.test(v.name)) return false;
    if (opts.xMin !== undefined && v.x < opts.xMin) return false;
    if (opts.xMax !== undefined && v.x > opts.xMax) return false;
    if (opts.yMin !== undefined && v.y < opts.yMin) return false;
    if (opts.yMax !== undefined && v.y > opts.yMax) return false;
    return true;
  });
}

// -- Bulk bind -------------------------------------------------------------

export interface VisualBulkBindOptions {
  readonly visualType: string;
  readonly bindings: readonly VisualBinding[];
  readonly namePattern?: string;
  readonly modelPath?: string;
}

/** Apply the same bindings to every visual matching type + name-pattern. */
export function visualBulkBind(
  definitionPath: string,
  pageName: string,
  opts: VisualBulkBindOptions,
): {
  bound: number;
  page: string;
  type: string;
  visuals: string[];
  bindings: readonly VisualBinding[];
  validation: {
    readonly status: 'valid' | 'skipped';
    readonly checked: number;
  };
} {
  const resolvedType = resolveVisualType(opts.visualType);
  if (resolvedType === null) throw new VisualTypeError(opts.visualType);

  const matching = visualWhere(definitionPath, pageName, {
    visualType: opts.visualType,
    namePattern: opts.namePattern,
  });

  const validations = matching.map((v) =>
    validateVisualBindingPlan(definitionPath, pageName, v.name, opts.bindings, {
      modelPath: opts.modelPath,
    }),
  );
  const blocked = validations.filter((validation) => validation.blockedWrite);
  if (blocked.length > 0) {
    throw new VisualBindValidationError(bulkValidationReport(pageName, resolvedType, blocked));
  }

  const bound: string[] = [];
  for (const v of matching) {
    visualBind(definitionPath, pageName, v.name, opts.bindings, { modelPath: opts.modelPath });
    bound.push(v.name);
  }

  const anyModelSkipped = validations.some((validation) => validation.status === 'skipped');

  return {
    bound: bound.length,
    page: pageName,
    type: resolvedType,
    visuals: bound,
    bindings: opts.bindings,
    validation: {
      status: anyModelSkipped ? 'skipped' : 'valid',
      checked: validations.length,
    },
  };
}

function bulkValidationReport(
  page: string,
  visualType: string,
  blocked: readonly VisualBindingValidationReport[],
): Record<string, unknown> & { findings: readonly BindingValidationFinding[] } {
  const findings = blocked.flatMap((validation) =>
    validation.findings
      .filter((finding) => finding.severity === 'error')
      .map((finding) => ({
        ...finding,
        reason: `Visual '${validation.visual}' failed because ${finding.reason}`,
      })),
  );
  const codes: Record<string, number> = {};
  for (const finding of findings) {
    codes[finding.code] = (codes[finding.code] ?? 0) + 1;
  }

  return {
    status: 'blocked',
    blockedWrite: true,
    page,
    visual: '*',
    visualType,
    findings,
    telemetry: {
      refusalCount: blocked.length,
      errorCount: findings.length,
      warningCount: 0,
      codes,
    },
  };
}

// -- Bulk update -----------------------------------------------------------

export interface VisualBulkUpdateOptions {
  readonly whereType?: string;
  readonly whereNamePattern?: string;
  readonly setHidden?: boolean;
  readonly setWidth?: number;
  readonly setHeight?: number;
  readonly setX?: number;
  readonly setY?: number;
}

/**
 * Apply position/size/visibility updates to every matching visual. At least
 * one `set*` option is required (prevents accidental no-op).
 */
export function visualBulkUpdate(
  definitionPath: string,
  pageName: string,
  opts: VisualBulkUpdateOptions,
): { updated: number; page: string; visuals: string[] } {
  const hasUpdate =
    opts.setHidden !== undefined ||
    opts.setWidth !== undefined ||
    opts.setHeight !== undefined ||
    opts.setX !== undefined ||
    opts.setY !== undefined;
  if (!hasUpdate) {
    throw new Error('At least one set* argument must be provided to bulk-update');
  }

  const matching = visualWhere(definitionPath, pageName, {
    visualType: opts.whereType,
    namePattern: opts.whereNamePattern,
  });

  const updated: string[] = [];
  for (const v of matching) {
    visualUpdate(definitionPath, pageName, v.name, {
      x: opts.setX,
      y: opts.setY,
      width: opts.setWidth,
      height: opts.setHeight,
      hidden: opts.setHidden,
    });
    updated.push(v.name);
  }
  return { updated: updated.length, page: pageName, visuals: updated };
}

// -- Bulk delete -----------------------------------------------------------

export interface VisualBulkDeleteOptions {
  readonly whereType?: string;
  readonly whereNamePattern?: string;
}

/**
 * Delete every visual matching the filter. At least one `where*` is required
 * (prevents accidental wipe of all visuals on a page).
 */
export function visualBulkDelete(
  definitionPath: string,
  pageName: string,
  opts: VisualBulkDeleteOptions,
): { deleted: number; page: string; visuals: string[] } {
  if (opts.whereType === undefined && opts.whereNamePattern === undefined) {
    throw new Error(
      'Provide at least whereType or whereNamePattern to prevent accidental bulk deletion',
    );
  }

  const matching = visualWhere(definitionPath, pageName, {
    visualType: opts.whereType,
    namePattern: opts.whereNamePattern,
  });

  const deleted: string[] = [];
  for (const v of matching) {
    visualDelete(definitionPath, pageName, v.name);
    deleted.push(v.name);
  }
  return { deleted: deleted.length, page: pageName, visuals: deleted };
}
