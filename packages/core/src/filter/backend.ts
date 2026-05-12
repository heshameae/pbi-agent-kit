// Page-level and visual-level filters.
//
// Ported from pbi-cli's core/filter_backend.py. Filters live in
// `filterConfig.filters[]` inside either `pages/<name>/page.json` (page
// scope) or `pages/<page>/visuals/<visual>/visual.json` (visual scope).
//
// Critical empirical detail (from pbi-cli, verified in Desktop):
//   - Page-level filters get `"howCreated": "User"`. Visual-level don't.
//   - Power BI literals: `"123L"` for int, `"3.14D"` for double,
//     single-quoted for strings. Mixing these wrong = filter doesn't apply.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError } from '../errors.js';
import { generateId, readJson, writeJson } from '../pbir/io.js';
import { getPageDir, getVisualDir } from '../pbir/path.js';

// -- Types -----------------------------------------------------------------

export type FilterScope = 'page' | 'visual';

export interface FilterRef {
  /** Target page name */
  readonly page: string;
  /** If set, the filter targets this visual; otherwise it's page-level. */
  readonly visual?: string;
}

export interface AddFilterResult {
  readonly status: 'added';
  readonly name: string;
  readonly type: 'Categorical' | 'TopN' | 'RelativeDate';
  readonly scope: FilterScope;
}

// -- Internal helpers ------------------------------------------------------

function targetFile(definitionPath: string, ref: FilterRef): string {
  if (ref.visual === undefined) {
    return path.join(getPageDir(definitionPath, ref.page), 'page.json');
  }
  return path.join(getVisualDir(definitionPath, ref.page, ref.visual), 'visual.json');
}

function getFilters(data: Record<string, unknown>): Record<string, unknown>[] {
  const fc = data.filterConfig as Record<string, unknown> | undefined;
  if (!fc) return [];
  return Array.isArray(fc.filters) ? (fc.filters as Record<string, unknown>[]) : [];
}

function setFilters(
  data: Record<string, unknown>,
  filters: Record<string, unknown>[],
): Record<string, unknown> {
  const fc = { ...((data.filterConfig as Record<string, unknown>) ?? {}), filters };
  return { ...data, filterConfig: fc };
}

function readTarget(
  definitionPath: string,
  ref: FilterRef,
): {
  file: string;
  data: Record<string, unknown>;
  scope: FilterScope;
} {
  const file = targetFile(definitionPath, ref);
  if (!existsSync(file)) {
    throw new PbiCoreError(`File not found: ${file}`);
  }
  return {
    file,
    data: readJson(file) as Record<string, unknown>,
    scope: ref.visual === undefined ? 'page' : 'visual',
  };
}

/**
 * Convert a CLI string value to a typed Power BI literal:
 *   "123"   → "123L"   (int64)
 *   "3.14"  → "3.14D"  (double)
 *   "text"  → "'text'" (string)
 */
function toPbiLiteral(value: string): string {
  if (/^-?\d+$/.test(value)) return `${value}L`;
  if (/^-?\d+\.\d+$/.test(value)) return `${value}D`;
  return `'${value}'`;
}

// -- List ------------------------------------------------------------------

/** List filters on a page or visual. */
export function filterList(definitionPath: string, ref: FilterRef): Record<string, unknown>[] {
  const { data } = readTarget(definitionPath, ref);
  return getFilters(data);
}

// -- Categorical -----------------------------------------------------------

export interface AddCategoricalOptions extends FilterRef {
  readonly table: string;
  readonly column: string;
  readonly values: readonly string[];
  readonly name?: string;
}

/** Add a categorical (IN-list) filter to a page or visual. */
export function filterAddCategorical(
  definitionPath: string,
  opts: AddCategoricalOptions,
): AddFilterResult {
  const { file, data, scope } = readTarget(definitionPath, opts);
  const filterName = opts.name ?? generateId();
  const alias = (opts.table[0] ?? 'x').toLowerCase();

  const whereValues: unknown[][] = opts.values.map((v) => [
    { Literal: { Value: toPbiLiteral(v) } },
  ]);

  const entry: Record<string, unknown> = {
    name: filterName,
    field: {
      Column: {
        Expression: { SourceRef: { Entity: opts.table } },
        Property: opts.column,
      },
    },
    type: 'Categorical',
    filter: {
      Version: 2,
      From: [{ Name: alias, Entity: opts.table, Type: 0 }],
      Where: [
        {
          Condition: {
            In: {
              Expressions: [
                {
                  Column: {
                    Expression: { SourceRef: { Source: alias } },
                    Property: opts.column,
                  },
                },
              ],
              Values: whereValues,
            },
          },
        },
      ],
    },
  };

  if (scope === 'page') entry.howCreated = 'User';

  const filters = [...getFilters(data), entry];
  writeJson(file, setFilters(data, filters));

  return { status: 'added', name: filterName, type: 'Categorical', scope };
}

// -- TopN ------------------------------------------------------------------

export interface AddTopNOptions extends FilterRef {
  readonly table: string;
  readonly column: string;
  readonly n: number;
  readonly orderByTable: string;
  readonly orderByColumn: string;
  readonly direction?: 'Top' | 'Bottom';
  readonly name?: string;
}

/**
 * Add a TopN filter. `direction` defaults to 'Top'. The direction maps to
 * PBI's OrderBy Direction code: Top=2 (Descending), Bottom=1 (Ascending).
 */
export function filterAddTopN(
  definitionPath: string,
  opts: AddTopNOptions,
): AddFilterResult & { n: number; direction: 'Top' | 'Bottom' } {
  const direction = opts.direction ?? 'Top';
  if (direction !== 'Top' && direction !== 'Bottom') {
    throw new PbiCoreError(`direction must be 'Top' or 'Bottom', got '${direction}'.`);
  }
  const pbiDirection = direction === 'Top' ? 2 : 1;

  const { file, data, scope } = readTarget(definitionPath, opts);
  const filterName = opts.name ?? generateId();
  const catAlias = (opts.table[0] ?? 'x').toLowerCase();
  let ordAlias = (opts.orderByTable[0] ?? 'y').toLowerCase();
  if (ordAlias === catAlias && opts.orderByTable !== opts.table) {
    ordAlias = `${ordAlias}2`;
  }
  const sameTable = opts.orderByTable === opts.table;

  const innerFrom: Record<string, unknown>[] = [{ Name: catAlias, Entity: opts.table, Type: 0 }];
  if (!sameTable) {
    innerFrom.push({ Name: ordAlias, Entity: opts.orderByTable, Type: 0 });
  }

  const entry: Record<string, unknown> = {
    name: filterName,
    field: {
      Column: {
        Expression: { SourceRef: { Entity: opts.table } },
        Property: opts.column,
      },
    },
    type: 'TopN',
    filter: {
      Version: 2,
      From: [
        {
          Name: 'subquery',
          Expression: {
            Subquery: {
              Query: {
                Version: 2,
                From: innerFrom,
                Select: [
                  {
                    Column: {
                      Expression: { SourceRef: { Source: catAlias } },
                      Property: opts.column,
                    },
                    Name: 'field',
                  },
                ],
                OrderBy: [
                  {
                    Direction: pbiDirection,
                    Expression: {
                      Aggregation: {
                        Expression: {
                          Column: {
                            Expression: {
                              SourceRef: { Source: sameTable ? catAlias : ordAlias },
                            },
                            Property: opts.orderByColumn,
                          },
                        },
                        Function: 0,
                      },
                    },
                  },
                ],
                Top: opts.n,
              },
            },
          },
          Type: 2,
        },
        { Name: catAlias, Entity: opts.table, Type: 0 },
      ],
      Where: [
        {
          Condition: {
            In: {
              Expressions: [
                {
                  Column: {
                    Expression: { SourceRef: { Source: catAlias } },
                    Property: opts.column,
                  },
                },
              ],
              Table: { SourceRef: { Source: 'subquery' } },
            },
          },
        },
      ],
    },
  };

  if (scope === 'page') entry.howCreated = 'User';

  const filters = [...getFilters(data), entry];
  writeJson(file, setFilters(data, filters));

  return {
    status: 'added',
    name: filterName,
    type: 'TopN',
    scope,
    n: opts.n,
    direction,
  };
}

// -- Relative date ---------------------------------------------------------

const TIME_UNITS = { days: 0, weeks: 1, months: 2, years: 3 } as const;
export type TimeUnit = keyof typeof TIME_UNITS;

export interface AddRelativeDateOptions extends FilterRef {
  readonly table: string;
  readonly column: string;
  readonly amount: number;
  readonly timeUnit: TimeUnit;
  readonly name?: string;
}

/**
 * Add a RelativeDate filter (e.g. "last 30 days") to a page or visual.
 * Matches rows where `column` falls in the last `amount` `timeUnit`
 * relative to today (inclusive of current period boundary).
 */
export function filterAddRelativeDate(
  definitionPath: string,
  opts: AddRelativeDateOptions,
): AddFilterResult & { amount: number; timeUnit: TimeUnit } {
  if (!(opts.timeUnit in TIME_UNITS)) {
    throw new PbiCoreError(
      `timeUnit must be one of ${Object.keys(TIME_UNITS).join(', ')}, got '${opts.timeUnit}'.`,
    );
  }
  const code = TIME_UNITS[opts.timeUnit];
  const daysCode = TIME_UNITS.days;

  const { file, data, scope } = readTarget(definitionPath, opts);
  const filterName = opts.name ?? generateId();
  const alias = (opts.table[0] ?? 'x').toLowerCase();

  const lowerBound = {
    DateSpan: {
      Expression: {
        DateAdd: {
          Expression: {
            DateAdd: {
              Expression: { Now: {} },
              Amount: 1,
              TimeUnit: daysCode,
            },
          },
          Amount: -opts.amount,
          TimeUnit: code,
        },
      },
      TimeUnit: daysCode,
    },
  };

  const upperBound = {
    DateSpan: {
      Expression: { Now: {} },
      TimeUnit: daysCode,
    },
  };

  const entry: Record<string, unknown> = {
    name: filterName,
    field: {
      Column: {
        Expression: { SourceRef: { Entity: opts.table } },
        Property: opts.column,
      },
    },
    type: 'RelativeDate',
    filter: {
      Version: 2,
      From: [{ Name: alias, Entity: opts.table, Type: 0 }],
      Where: [
        {
          Condition: {
            Between: {
              Expression: {
                Column: {
                  Expression: { SourceRef: { Source: alias } },
                  Property: opts.column,
                },
              },
              LowerBound: lowerBound,
              UpperBound: upperBound,
            },
          },
        },
      ],
    },
  };

  if (scope === 'page') entry.howCreated = 'User';

  const filters = [...getFilters(data), entry];
  writeJson(file, setFilters(data, filters));

  return {
    status: 'added',
    name: filterName,
    type: 'RelativeDate',
    scope,
    amount: opts.amount,
    timeUnit: opts.timeUnit,
  };
}

// -- Remove / Clear --------------------------------------------------------

/** Remove a single filter by name. */
export function filterRemove(
  definitionPath: string,
  ref: FilterRef,
  filterName: string,
): { status: 'removed'; name: string } {
  const { file, data } = readTarget(definitionPath, ref);
  const filters = getFilters(data);
  const remaining = filters.filter((f) => f.name !== filterName);
  if (remaining.length === filters.length) {
    const where = ref.visual ? `visual '${ref.visual}'` : `page '${ref.page}'`;
    throw new PbiCoreError(`Filter '${filterName}' not found on ${where}.`);
  }
  writeJson(file, setFilters(data, remaining));
  return { status: 'removed', name: filterName };
}

/** Clear ALL filters on a page or visual. */
export function filterClear(
  definitionPath: string,
  ref: FilterRef,
): { status: 'cleared'; removed: number; scope: FilterScope } {
  const { file, data, scope } = readTarget(definitionPath, ref);
  const filters = getFilters(data);
  writeJson(file, setFilters(data, []));
  return { status: 'cleared', removed: filters.length, scope };
}
