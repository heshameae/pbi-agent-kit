import type {
  BPAViolation,
  Severity,
  TMDLColumn,
  TMDLMeasure,
  TMDLModel,
  TMDLRelationship,
  TMDLTable,
} from './types.js';

export type BPARuleCategory =
  | 'DAX'
  | 'Performance'
  | 'Naming'
  | 'Modeling'
  | 'Maintenance'
  | 'Formatting';

export interface BPARule {
  readonly id: string;
  readonly name: string;
  readonly severity: Severity;
  readonly category: BPARuleCategory;
  readonly check: (model: TMDLModel) => ReadonlyArray<BPAViolation>;
}

export const BPA_RULES: ReadonlyArray<BPARule> = [
  {
    id: 'DAX001',
    name: 'Use DIVIDE() instead of the division operator',
    severity: 'warning',
    category: 'DAX',
    check: (model) =>
      forEachMeasure(model, (m) => {
        const expr = stripDaxComments(m.expression);
        if (/[^.\w]\/[^/*]/.test(` ${expr}`) && !/\bDIVIDE\s*\(/i.test(expr)) {
          return violation('DAX001', 'warning', 'DAX', measureRef(m), {
            message: 'Uses "/" operator; replace with DIVIDE() for divide-by-zero safety.',
            fix: 'Wrap numerator/denominator in DIVIDE(num, den[, alt]).',
          });
        }
        return null;
      }),
  },
  {
    id: 'DAX002',
    name: 'USERELATIONSHIP must be inside CALCULATE',
    severity: 'error',
    category: 'DAX',
    check: (model) =>
      forEachMeasure(model, (m) => {
        const expr = stripDaxComments(m.expression);
        if (!/\bUSERELATIONSHIP\s*\(/i.test(expr)) return null;
        if (!hasUserelationshipInCalculate(expr)) {
          return violation('DAX002', 'error', 'DAX', measureRef(m), {
            message:
              'USERELATIONSHIP found outside CALCULATE/CALCULATETABLE; will error at evaluation.',
            fix: 'Move USERELATIONSHIP into a CALCULATE filter argument.',
          });
        }
        return null;
      }),
  },
  {
    id: 'DAX003',
    name: 'IFERROR is slower than IF + ISBLANK',
    severity: 'info',
    category: 'Performance',
    check: (model) =>
      forEachMeasure(model, (m) => {
        const expr = stripDaxComments(m.expression);
        if (/\bIFERROR\s*\(/i.test(expr)) {
          return violation('DAX003', 'info', 'Performance', measureRef(m), {
            message: 'IFERROR forces sequential evaluation; consider IF(ISBLANK(...), alt, expr).',
          });
        }
        return null;
      }),
  },
  {
    id: 'FMT001',
    name: 'Measure missing formatString',
    severity: 'warning',
    category: 'Formatting',
    check: (model) =>
      forEachMeasure(model, (m) => {
        if (m.isHidden) return null;
        if (!m.formatString || m.formatString.trim() === '') {
          return violation('FMT001', 'warning', 'Formatting', measureRef(m), {
            message: 'Visible measure has no formatString; will render with default formatting.',
            fix: 'Add formatString. Currency: \\$#,0;(\\$#,0);\\$#,0. Percent: 0.0%;-0.0%;0.0%. Whole: #,##0.',
          });
        }
        return null;
      }),
  },
  {
    id: 'FMT002',
    name: 'formatString wrapped in TMDL triple quotes (will render as text)',
    severity: 'error',
    category: 'Formatting',
    check: (model) =>
      forEachMeasure(model, (m) => {
        if (!m.formatString) return null;
        if (m.formatString.startsWith('"""') || m.formatString.startsWith('"')) {
          return violation('FMT002', 'error', 'Formatting', measureRef(m), {
            message: 'formatString is quoted; Desktop will render the literal mask as text.',
            fix: 'Use bare TMDL form, e.g. \\$#,0;(\\$#,0);\\$#,0 — backslash-escape $ but no surrounding quotes.',
          });
        }
        return null;
      }),
  },
  {
    id: 'MOD001',
    name: 'Auto date/time table detected',
    severity: 'warning',
    category: 'Modeling',
    check: (model) => {
      const autoTables = model.tables.filter((t) => t.isAutoDateTable);
      if (autoTables.length === 0) return [];
      return [
        violation('MOD001', 'warning', 'Modeling', `Model.AutoDateTables(${autoTables.length})`, {
          message: `${autoTables.length} auto-generated date table(s) detected (LocalDateTable_* / DateTableTemplate_*). Bloats model size and complicates DAX.`,
          fix: 'Disable Auto Date/Time in Power BI Desktop options and add a proper user-built Date table.',
        }),
      ];
    },
  },
  {
    id: 'MOD002',
    name: 'Inactive relationship without USERELATIONSHIP usage',
    severity: 'info',
    category: 'Modeling',
    check: (model) => {
      const allDax = model.tables
        .flatMap((t) => t.measures)
        .map((m) => stripDaxComments(m.expression))
        .join('\n');
      const findings: BPAViolation[] = [];
      for (const r of model.relationships) {
        if (r.isActive) continue;
        const fromRef = `${r.fromTable}[${r.fromColumn}]`;
        const escaped = escapeRegex(fromRef);
        const used = new RegExp(`USERELATIONSHIP[^)]*${escaped}`, 'i').test(allDax);
        if (!used) {
          findings.push(
            violation('MOD002', 'info', 'Modeling', `Relationship.${r.id}`, {
              message: `Inactive relationship ${fromRef} → ${r.toTable}[${r.toColumn}] not referenced by any USERELATIONSHIP; consider removing.`,
            }),
          );
        }
      }
      return findings;
    },
  },
  {
    id: 'MOD003',
    name: 'Many-to-many cardinality (potential anti-pattern)',
    severity: 'warning',
    category: 'Modeling',
    check: (model) =>
      model.relationships
        .filter((r) => r.cardinality === 'manyToMany')
        .map((r) =>
          violation('MOD003', 'warning', 'Modeling', `Relationship.${r.id}`, {
            message: `Many-to-many relationship ${r.fromTable}[${r.fromColumn}] ↔ ${r.toTable}[${r.toColumn}]. Confirm a bridge table is correct here; otherwise replace with star-schema dim.`,
          }),
        ),
  },
  {
    id: 'MOD004',
    name: 'Bidirectional filter outside many-to-many bridge',
    severity: 'warning',
    category: 'Modeling',
    check: (model) =>
      model.relationships
        .filter((r) => r.crossFilteringBehavior === 'both' && r.cardinality !== 'manyToMany')
        .map((r) =>
          violation('MOD004', 'warning', 'Modeling', `Relationship.${r.id}`, {
            message: `Bidirectional filter on ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]. Use cautiously outside m:m bridges — ambiguity and circular-filter risk.`,
          }),
        ),
  },
  {
    id: 'MOD005',
    name: 'Foreign key column visible (not hidden)',
    severity: 'info',
    category: 'Modeling',
    check: (model) => {
      const findings: BPAViolation[] = [];
      const byTable = new Map(model.tables.map((t) => [t.name, t]));
      for (const r of model.relationships) {
        const fromTable = byTable.get(r.fromTable);
        if (!fromTable) continue;
        const col = fromTable.columns.find((c) => c.name === r.fromColumn);
        if (col && !col.isHidden) {
          findings.push(
            violation('MOD005', 'info', 'Modeling', columnRef(col), {
              message:
                'FK column on the many side is visible; users may slice on it instead of the dim attribute.',
              fix: `Set isHidden: true on ${columnRef(col)}.`,
            }),
          );
        }
      }
      return findings;
    },
  },
  {
    id: 'NAM001',
    name: 'Measure has the same name as a column on its host table',
    severity: 'error',
    category: 'Naming',
    check: (model) => {
      const findings: BPAViolation[] = [];
      for (const table of model.tables) {
        const colNames = new Set(table.columns.map((c) => c.name));
        for (const m of table.measures) {
          if (colNames.has(m.name)) {
            findings.push(
              violation('NAM001', 'error', 'Naming', measureRef(m), {
                message: `Measure name collides with column ${columnRefRaw(m.table, m.name)}; binding will be ambiguous.`,
                fix: `Rename measure to e.g. "Total ${m.name}" or "${m.name} Amount".`,
              }),
            );
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'MOD006',
    name: 'String column with summarizeBy != none',
    severity: 'info',
    category: 'Modeling',
    check: (model) => {
      const findings: BPAViolation[] = [];
      for (const table of model.tables) {
        for (const c of table.columns) {
          if (c.dataType === 'string' && c.summarizeBy && c.summarizeBy !== 'none') {
            findings.push(
              violation('MOD006', 'info', 'Modeling', columnRef(c), {
                message: `String column has summarizeBy=${c.summarizeBy}; should be "none".`,
                fix: 'Set summarizeBy: none.',
              }),
            );
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'DAX004',
    name: 'CALCULATE with no filter arguments',
    severity: 'info',
    category: 'DAX',
    check: (model) =>
      forEachMeasure(model, (m) => {
        const expr = stripDaxComments(m.expression);
        const re = /\bCALCULATE\s*\(([^()]|\([^()]*\))*\)/gi;
        const matches = expr.match(re) ?? [];
        for (const match of matches) {
          const inner = match.replace(/^CALCULATE\s*\(/i, '').replace(/\)$/, '');
          const commas = countTopLevelCommas(inner);
          if (commas === 0) {
            return violation('DAX004', 'info', 'DAX', measureRef(m), {
              message:
                'CALCULATE with no filter argument; equivalent to wrapping in parens. Consider removing.',
            });
          }
        }
        return null;
      }),
  },
  {
    id: 'MOD007',
    name: 'Empty table (no columns, no measures)',
    severity: 'info',
    category: 'Maintenance',
    check: (model) => {
      const findings: BPAViolation[] = [];
      for (const t of model.tables) {
        if (t.isAutoDateTable) continue;
        if (t.columns.length === 0 && t.measures.length === 0) {
          findings.push(
            violation('MOD007', 'info', 'Maintenance', `Table.${t.name}`, {
              message: 'Table has no columns and no measures.',
            }),
          );
        }
      }
      return findings;
    },
  },
  {
    id: 'DAX005',
    name: 'Reference to non-existent measure or column',
    severity: 'warning',
    category: 'DAX',
    check: (model) => {
      const measureNames = new Set<string>();
      const columnRefs = new Set<string>();
      const measureRefs = new Set<string>();
      for (const t of model.tables) {
        for (const m of t.measures) {
          measureNames.add(m.name);
          measureRefs.add(`${t.name}[${m.name}]`);
        }
        for (const c of t.columns) columnRefs.add(`${t.name}[${c.name}]`);
      }

      const findings: BPAViolation[] = [];
      for (const t of model.tables) {
        for (const m of t.measures) {
          const expr = stripDaxComments(m.expression);
          const qualifiedRefs = [...expr.matchAll(/('([^']+)'|([A-Za-z_][\w .-]*))\[([^\]]+)\]/g)];
          let expressionWithoutQualifiedRefs = expr;
          let hasQualifiedReferenceError = false;

          for (const match of qualifiedRefs) {
            const tableName = match[2] ?? match[3];
            const fieldName = match[4];
            if (!tableName || !fieldName) continue;
            if (columnRefs.has(`${tableName}[${fieldName}]`)) {
              expressionWithoutQualifiedRefs = expressionWithoutQualifiedRefs.replace(
                match[0],
                ' ',
              );
              continue;
            }
            if (measureRefs.has(`${tableName}[${fieldName}]`)) {
              expressionWithoutQualifiedRefs = expressionWithoutQualifiedRefs.replace(
                match[0],
                ' ',
              );
              continue;
            }
            findings.push(
              violation('DAX005', 'warning', 'DAX', measureRef(m), {
                message: `Qualified reference ${tableName}[${fieldName}] does not match any measure or column.`,
              }),
            );
            hasQualifiedReferenceError = true;
            break;
          }
          if (hasQualifiedReferenceError) continue;

          const bareMeasureRefs = [...expressionWithoutQualifiedRefs.matchAll(/\[([^\]]+)\]/g)]
            .map((x) => x[1])
            .filter((x): x is string => x !== undefined);
          for (const ref of bareMeasureRefs) {
            if (measureNames.has(ref)) continue;
            const sameTableCol = `${t.name}[${ref}]`;
            if (columnRefs.has(sameTableCol)) continue;
            findings.push(
              violation('DAX005', 'warning', 'DAX', measureRef(m), {
                message: `Bare reference [${ref}] does not match any measure or same-table column.`,
              }),
            );
            break;
          }
        }
      }
      return findings;
    },
  },
];

export function runBPA(model: TMDLModel): ReadonlyArray<BPAViolation> {
  const out: BPAViolation[] = [];
  for (const rule of BPA_RULES) {
    out.push(...rule.check(model));
  }
  return out;
}

function forEachMeasure(
  model: TMDLModel,
  fn: (m: TMDLMeasure, t: TMDLTable) => BPAViolation | null,
): ReadonlyArray<BPAViolation> {
  const out: BPAViolation[] = [];
  for (const t of model.tables) {
    for (const m of t.measures) {
      const v = fn(m, t);
      if (v) out.push(v);
    }
  }
  return out;
}

function violation(
  ruleId: string,
  severity: Severity,
  category: string,
  object: string,
  body: { message: string; fix?: string },
): BPAViolation {
  return {
    ruleId,
    severity,
    category,
    object,
    message: body.message,
    fix: body.fix,
  };
}

function measureRef(m: TMDLMeasure): string {
  return `'${m.table}'[${m.name}]`;
}

function columnRef(c: TMDLColumn): string {
  return `'${c.table}'[${c.name}]`;
}

function columnRefRaw(table: string, column: string): string {
  return `'${table}'[${column}]`;
}

function stripDaxComments(expr: string): string {
  return expr
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1 ')
    .replace(/(^|\s)--[^\n]*/g, '$1 ');
}

function hasUserelationshipInCalculate(expr: string): boolean {
  let depth = 0;
  let inCalculate = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '(') {
      const back = expr.slice(Math.max(0, i - 16), i).toUpperCase();
      if (/CALCULATE\s*$/.test(back) || /CALCULATETABLE\s*$/.test(back)) {
        inCalculate++;
      }
      depth++;
    } else if (ch === ')') {
      if (inCalculate > 0 && depth === inCalculate) inCalculate--;
      depth--;
    } else if (ch === 'U' || ch === 'u') {
      const ahead = expr.slice(i, i + 17).toUpperCase();
      if (ahead.startsWith('USERELATIONSHIP')) {
        if (inCalculate === 0) return false;
      }
    }
  }
  return true;
}

function countTopLevelCommas(s: string): number {
  let depth = 0;
  let count = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
