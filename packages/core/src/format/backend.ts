// Visual-level conditional formatting (background colors driven by data).
//
// Ported from pbi-cli's core/format_backend.py. Writes
// `visual.objects.values[]` entries with the right Power BI query-expression
// shape for one of three rule types:
//   - gradient   (linearGradient2 over an aggregated input)
//   - conditional (Comparison + Cases, e.g. cell > threshold)
//   - measure    (color comes from a DAX measure that returns a hex string)

import { existsSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError } from '../errors.js';
import { readJson, writeJson } from '../pbir/io.js';
import { getVisualDir } from '../pbir/path.js';

// -- Internal --------------------------------------------------------------

function visualFile(definitionPath: string, pageName: string, visualName: string): string {
  return path.join(getVisualDir(definitionPath, pageName, visualName), 'visual.json');
}

function loadVisual(
  definitionPath: string,
  pageName: string,
  visualName: string,
): { file: string; data: Record<string, unknown> } {
  const file = visualFile(definitionPath, pageName, visualName);
  if (!existsSync(file)) {
    throw new PbiCoreError(
      `Visual '${visualName}' not found on page '${pageName}'. Expected: ${file}`,
    );
  }
  return { file, data: readJson(file) as Record<string, unknown> };
}

/**
 * Replace the entry in `values` whose `selector.metadata === fieldQueryRef`,
 * or append the new entry if no match.
 */
function replaceOrAppend(
  values: Record<string, unknown>[],
  newEntry: Record<string, unknown>,
  fieldQueryRef: string,
): Record<string, unknown>[] {
  let replaced = false;
  const result = values.map((entry) => {
    const sel = (entry.selector as Record<string, unknown>) ?? {};
    if (sel.metadata === fieldQueryRef) {
      replaced = true;
      return newEntry;
    }
    return entry;
  });
  if (!replaced) result.push(newEntry);
  return result;
}

function setObjectsValues(
  data: Record<string, unknown>,
  values: Record<string, unknown>[],
): Record<string, unknown> {
  const visual = { ...((data.visual as Record<string, unknown>) ?? {}) };
  const objects = { ...((visual.objects as Record<string, unknown>) ?? {}), values };
  visual.objects = objects;
  return { ...data, visual };
}

// -- Public API ------------------------------------------------------------

export interface FormatGetResult {
  readonly visual: string;
  readonly objects: Record<string, unknown>;
}

/** Return the visual's current `objects` block (formatting state). */
export function formatGet(
  definitionPath: string,
  pageName: string,
  visualName: string,
): FormatGetResult {
  const { data } = loadVisual(definitionPath, pageName, visualName);
  const visual = (data.visual as Record<string, unknown>) ?? {};
  return {
    visual: visualName,
    objects: (visual.objects as Record<string, unknown>) ?? {},
  };
}

/** Clear ALL formatting on a visual (`visual.objects = {}`). */
export function formatClear(
  definitionPath: string,
  pageName: string,
  visualName: string,
): { status: 'cleared'; visual: string } {
  const { file, data } = loadVisual(definitionPath, pageName, visualName);
  const visual = { ...((data.visual as Record<string, unknown>) ?? {}), objects: {} };
  writeJson(file, { ...data, visual });
  return { status: 'cleared', visual: visualName };
}

// -- Gradient --------------------------------------------------------------

export interface FormatBackgroundGradientOptions {
  readonly inputTable: string;
  readonly inputColumn: string;
  readonly fieldQueryRef: string;
  readonly minColor?: string;
  readonly maxColor?: string;
}

/**
 * Add a linear gradient background-color rule. `fieldQueryRef` is the
 * `queryRef` of the visual column the rule applies to (the selector.metadata).
 */
export function formatBackgroundGradient(
  definitionPath: string,
  pageName: string,
  visualName: string,
  opts: FormatBackgroundGradientOptions,
): { status: 'applied'; visual: string; rule: 'gradient'; field: string } {
  const { file, data } = loadVisual(definitionPath, pageName, visualName);
  const visual = (data.visual as Record<string, unknown>) ?? {};
  const objects = (visual.objects as Record<string, unknown>) ?? {};
  const values = Array.isArray(objects.values) ? (objects.values as Record<string, unknown>[]) : [];

  const minColor = opts.minColor ?? 'minColor';
  const maxColor = opts.maxColor ?? 'maxColor';

  const newEntry: Record<string, unknown> = {
    properties: {
      backColor: {
        solid: {
          color: {
            expr: {
              FillRule: {
                Input: {
                  Aggregation: {
                    Expression: {
                      Column: {
                        Expression: { SourceRef: { Entity: opts.inputTable } },
                        Property: opts.inputColumn,
                      },
                    },
                    Function: 0,
                  },
                },
                FillRule: {
                  linearGradient2: {
                    min: { color: { Literal: { Value: `'${minColor}'` } } },
                    max: { color: { Literal: { Value: `'${maxColor}'` } } },
                    nullColoringStrategy: {
                      strategy: { Literal: { Value: "'asZero'" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    selector: {
      data: [{ dataViewWildcard: { matchingOption: 1 } }],
      metadata: opts.fieldQueryRef,
    },
  };

  const newValues = replaceOrAppend(values, newEntry, opts.fieldQueryRef);
  writeJson(file, setObjectsValues(data, newValues));

  return { status: 'applied', visual: visualName, rule: 'gradient', field: opts.fieldQueryRef };
}

// -- Conditional (threshold) -----------------------------------------------

export type Comparison = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
const COMPARISON_KINDS: Record<Comparison, number> = {
  eq: 0,
  neq: 1,
  gt: 2,
  gte: 3,
  lt: 4,
  lte: 5,
};

export interface FormatBackgroundConditionalOptions {
  readonly inputTable: string;
  readonly inputColumn: string;
  readonly threshold: number;
  readonly colorHex: string;
  readonly comparison?: Comparison;
  readonly fieldQueryRef?: string;
}

/**
 * Add a rule-based background color: if `aggregate(column) <comparison> threshold`
 * the cell is painted `colorHex`. Default comparison is `gt`.
 */
export function formatBackgroundConditional(
  definitionPath: string,
  pageName: string,
  visualName: string,
  opts: FormatBackgroundConditionalOptions,
): { status: 'applied'; visual: string; rule: 'conditional'; field: string } {
  const comparison = opts.comparison ?? 'gt';
  if (!(comparison in COMPARISON_KINDS)) {
    throw new PbiCoreError(
      `comparison must be one of ${Object.keys(COMPARISON_KINDS).join(', ')}, got '${comparison}'.`,
    );
  }
  const comparisonKind = COMPARISON_KINDS[comparison];
  const fieldQueryRef = opts.fieldQueryRef ?? `Sum(${opts.inputTable}.${opts.inputColumn})`;

  const { file, data } = loadVisual(definitionPath, pageName, visualName);
  const visual = (data.visual as Record<string, unknown>) ?? {};
  const objects = (visual.objects as Record<string, unknown>) ?? {};
  const values = Array.isArray(objects.values) ? (objects.values as Record<string, unknown>[]) : [];

  const newEntry: Record<string, unknown> = {
    properties: {
      backColor: {
        solid: {
          color: {
            expr: {
              Conditional: {
                Cases: [
                  {
                    Condition: {
                      Comparison: {
                        ComparisonKind: comparisonKind,
                        Left: {
                          Aggregation: {
                            Expression: {
                              Column: {
                                Expression: { SourceRef: { Entity: opts.inputTable } },
                                Property: opts.inputColumn,
                              },
                            },
                            Function: 0,
                          },
                        },
                        Right: { Literal: { Value: `${opts.threshold}D` } },
                      },
                    },
                    Value: { Literal: { Value: `'${opts.colorHex}'` } },
                  },
                ],
              },
            },
          },
        },
      },
    },
    selector: {
      data: [{ dataViewWildcard: { matchingOption: 1 } }],
      metadata: fieldQueryRef,
    },
  };

  const newValues = replaceOrAppend(values, newEntry, fieldQueryRef);
  writeJson(file, setObjectsValues(data, newValues));

  return { status: 'applied', visual: visualName, rule: 'conditional', field: fieldQueryRef };
}

// -- Measure-driven --------------------------------------------------------

export interface FormatBackgroundMeasureOptions {
  readonly measureTable: string;
  readonly measureProperty: string;
  readonly fieldQueryRef: string;
}

/** Background color comes from a DAX measure that returns a hex string. */
export function formatBackgroundMeasure(
  definitionPath: string,
  pageName: string,
  visualName: string,
  opts: FormatBackgroundMeasureOptions,
): { status: 'applied'; visual: string; rule: 'measure'; field: string } {
  const { file, data } = loadVisual(definitionPath, pageName, visualName);
  const visual = (data.visual as Record<string, unknown>) ?? {};
  const objects = (visual.objects as Record<string, unknown>) ?? {};
  const values = Array.isArray(objects.values) ? (objects.values as Record<string, unknown>[]) : [];

  const newEntry: Record<string, unknown> = {
    properties: {
      backColor: {
        solid: {
          color: {
            expr: {
              Measure: {
                Expression: { SourceRef: { Entity: opts.measureTable } },
                Property: opts.measureProperty,
              },
            },
          },
        },
      },
    },
    selector: {
      data: [{ dataViewWildcard: { matchingOption: 1 } }],
      metadata: opts.fieldQueryRef,
    },
  };

  const newValues = replaceOrAppend(values, newEntry, opts.fieldQueryRef);
  writeJson(file, setObjectsValues(data, newValues));

  return { status: 'applied', visual: visualName, rule: 'measure', field: opts.fieldQueryRef };
}
