import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  Cardinality,
  CrossFilteringBehavior,
  TMDLColumn,
  TMDLMeasure,
  TMDLModel,
  TMDLRelationship,
  TMDLTable,
} from './types.js';

const AUTO_DATE_PREFIXES = ['LocalDateTable_', 'DateTableTemplate_'];

export function parseTMDLFolder(definitionPath: string): TMDLModel {
  if (!existsSync(definitionPath) || !statSync(definitionPath).isDirectory()) {
    throw new Error(`TMDL definition folder not found: ${definitionPath}`);
  }

  const tablesDir = path.join(definitionPath, 'tables');
  const relationshipsFile = path.join(definitionPath, 'relationships.tmdl');

  const tables: TMDLTable[] = [];
  if (existsSync(tablesDir) && statSync(tablesDir).isDirectory()) {
    for (const entry of readdirSync(tablesDir)) {
      if (!entry.endsWith('.tmdl')) continue;
      const full = path.join(tablesDir, entry);
      const parsed = parseTableFile(readFileSync(full, 'utf8'));
      if (parsed) tables.push(parsed);
    }
  }

  const relationships: TMDLRelationship[] = existsSync(relationshipsFile)
    ? parseRelationshipsFile(readFileSync(relationshipsFile, 'utf8'))
    : [];

  return { modelPath: definitionPath, tables, relationships };
}

export function parseTableFile(content: string): TMDLTable | null {
  const lines = content.split(/\r?\n/);
  let tableName: string | null = null;
  let tableIsHidden = false;
  let tableIsCalculated = false;
  const columns: TMDLColumn[] = [];
  const measures: TMDLMeasure[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (raw === undefined) {
      i++;
      continue;
    }
    const line = raw.trim();
    if (!line || line.startsWith('///')) {
      i++;
      continue;
    }

    if (tableName === null) {
      const m = /^table\s+(.+)$/.exec(line);
      const parsedTableName = m?.[1];
      if (parsedTableName) {
        tableName = unquoteIdent(parsedTableName.trim());
        i++;
        continue;
      }
    }

    if (tableName !== null) {
      if (/^isHidden:\s*true$/i.test(line)) tableIsHidden = true;
      if (/^calculated$/i.test(line)) tableIsCalculated = true;
    }

    const colMatch = /^column\s+(.+)$/.exec(line);
    const parsedColumnName = colMatch?.[1];
    if (parsedColumnName && tableName !== null) {
      const colName = unquoteIdent(parsedColumnName.trim());
      const block = collectBlock(lines, i);
      const col = buildColumn(tableName, colName, block.body);
      columns.push(col);
      i = block.nextIndex;
      continue;
    }

    const measureMatch = /^measure\s+(.+)$/.exec(line);
    const parsedMeasureHeader = measureMatch?.[1];
    if (parsedMeasureHeader && tableName !== null) {
      const { name, inlineExpression } = parseMeasureHeader(parsedMeasureHeader);
      const block = collectBlock(lines, i);
      const measure = buildMeasure(tableName, name, inlineExpression, block.body, lines, i);
      measures.push(measure);
      i = block.nextIndex;
      continue;
    }

    i++;
  }

  if (tableName === null) return null;
  const finalTableName = tableName;

  return {
    name: finalTableName,
    columns,
    measures,
    isHidden: tableIsHidden,
    isCalculated: tableIsCalculated,
    isAutoDateTable: AUTO_DATE_PREFIXES.some((p) => finalTableName.startsWith(p)),
  };
}

export function parseRelationshipsFile(content: string): TMDLRelationship[] {
  const lines = content.split(/\r?\n/);
  const out: TMDLRelationship[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (raw === undefined) {
      i++;
      continue;
    }
    const line = raw.trim();
    const m = /^relationship\s+(.+)$/.exec(line);
    if (!m || !m[1]) {
      i++;
      continue;
    }
    const id = m[1].trim();
    const block = collectBlock(lines, i);
    const rel = buildRelationship(id, block.body);
    if (rel) out.push(rel);
    i = block.nextIndex;
  }

  return out;
}

interface CollectedBlock {
  readonly body: ReadonlyArray<string>;
  readonly nextIndex: number;
}

function collectBlock(lines: string[], headerIndex: number): CollectedBlock {
  const headerLine = lines[headerIndex] ?? '';
  const headerIndent = indentOf(headerLine);
  const body: string[] = [];
  let i = headerIndex + 1;
  while (i < lines.length) {
    const next = lines[i];
    if (next === undefined) break;
    if (next.trim() === '') {
      body.push(next);
      i++;
      continue;
    }
    if (indentOf(next) <= headerIndent) break;
    body.push(next);
    i++;
  }
  return { body, nextIndex: i };
}

function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === '\t') n += 1;
    else if (ch === ' ') n += 1;
    else break;
  }
  return n;
}

function unquoteIdent(s: string): string {
  const t = s.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t;
}

function unquoteAnnotationValue(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1);
  }
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      const parsed = JSON.parse(t) as unknown;
      if (typeof parsed === 'string') return parsed;
      return t.slice(1, -1);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

function parseMeasureHeader(rest: string): { name: string; inlineExpression?: string } {
  const eqIdx = rest.indexOf('=');
  if (eqIdx < 0) {
    return { name: unquoteIdent(rest.trim()) };
  }
  const namePart = rest.slice(0, eqIdx).trim();
  const exprPart = rest.slice(eqIdx + 1).trim();
  return {
    name: unquoteIdent(namePart),
    inlineExpression: exprPart.length > 0 ? exprPart : undefined,
  };
}

function buildColumn(table: string, name: string, body: ReadonlyArray<string>): TMDLColumn {
  let dataType = 'string';
  let summarizeBy: string | undefined;
  let sourceColumn: string | undefined;
  let isHidden = false;
  let isKey = false;
  let isCalculated = false;

  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;
    const propMatch = /^([a-zA-Z]+):\s*(.+)$/.exec(line);
    const key = propMatch?.[1];
    const rawValue = propMatch?.[2];
    if (key && rawValue) {
      const value = rawValue.trim();
      if (key === 'dataType') dataType = value;
      else if (key === 'summarizeBy') summarizeBy = value;
      else if (key === 'sourceColumn') sourceColumn = unquoteIdent(value);
      else if (key === 'isHidden' && /true/i.test(value)) isHidden = true;
      else if (key === 'isKey' && /true/i.test(value)) isKey = true;
      continue;
    }
    if (/^calculated$/i.test(line)) isCalculated = true;
  }

  return {
    table,
    name,
    dataType,
    summarizeBy,
    sourceColumn,
    isHidden,
    isKey,
    isCalculated,
  };
}

function buildMeasure(
  table: string,
  name: string,
  inlineExpression: string | undefined,
  body: ReadonlyArray<string>,
  allLines: ReadonlyArray<string>,
  headerIndex: number,
): TMDLMeasure {
  let formatString: string | undefined;
  let isHidden = false;
  let description: string | undefined;
  const annotations: Record<string, string> = {};

  const exprLines: string[] = [];
  if (inlineExpression) exprLines.push(inlineExpression);

  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('formatString:')) {
      formatString = line.slice('formatString:'.length).trim();
      continue;
    }
    if (line.startsWith('isHidden:') && /true/i.test(line)) {
      isHidden = true;
      continue;
    }
    if (line.startsWith('annotation ')) {
      const annotationMatch = /^annotation\s+([^\s=]+)\s*=\s*(.*)$/.exec(line);
      const annotationName = annotationMatch?.[1];
      const annotationValue = annotationMatch?.[2];
      if (annotationName && annotationValue !== undefined) {
        annotations[annotationName] = unquoteAnnotationValue(annotationValue);
      }
      continue;
    }
    if (line.startsWith('lineageTag:')) {
      continue;
    }
    if (line.startsWith('displayFolder:') || line.startsWith('description:')) {
      if (line.startsWith('description:')) {
        description = line.slice('description:'.length).trim();
      }
      continue;
    }
    if (/^[a-zA-Z_][\w]*\s*:/.test(line)) continue;
    exprLines.push(line);
  }

  for (let k = headerIndex - 1; k >= 0; k--) {
    const above = (allLines[k] ?? '').trim();
    if (!above) continue;
    if (above.startsWith('///')) {
      description = above.replace(/^\/\/\/\s?/, '').trim();
    }
    break;
  }

  return {
    table,
    name,
    expression: exprLines.join('\n').trim(),
    formatString,
    isHidden,
    description,
    annotations,
  };
}

function buildRelationship(id: string, body: ReadonlyArray<string>): TMDLRelationship | null {
  let fromTable: string | null = null;
  let fromColumn: string | null = null;
  let toTable: string | null = null;
  let toColumn: string | null = null;
  let isActive = true;
  let crossFilteringBehavior: CrossFilteringBehavior = 'single';
  let cardinality: Cardinality | undefined;

  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([a-zA-Z]+):\s*(.+)$/.exec(line);
    if (!m || !m[1] || !m[2]) continue;
    const key = m[1];
    const value = m[2].trim();

    if (key === 'fromColumn') {
      const parsed = splitTableColumn(value);
      if (parsed) {
        fromTable = parsed.table;
        fromColumn = parsed.column;
      }
    } else if (key === 'toColumn') {
      const parsed = splitTableColumn(value);
      if (parsed) {
        toTable = parsed.table;
        toColumn = parsed.column;
      }
    } else if (key === 'isActive' && /false/i.test(value)) {
      isActive = false;
    } else if (key === 'crossFilteringBehavior') {
      crossFilteringBehavior = /both/i.test(value) ? 'both' : 'single';
    } else if (key === 'fromCardinality' || key === 'toCardinality') {
      if (/many/i.test(value)) cardinality = 'manyToMany';
    }
  }

  if (!fromTable || !fromColumn || !toTable || !toColumn) return null;

  return {
    id,
    fromTable,
    fromColumn,
    toTable,
    toColumn,
    isActive,
    crossFilteringBehavior,
    cardinality,
  };
}

function splitTableColumn(value: string): { table: string; column: string } | null {
  const trimmed = value.trim();
  let i = 0;
  let table = '';
  if (trimmed[i] === "'") {
    const end = trimmed.indexOf("'", i + 1);
    if (end < 0) return null;
    table = trimmed.slice(i + 1, end);
    i = end + 1;
  } else {
    const dot = trimmed.indexOf('.');
    if (dot < 0) return null;
    table = trimmed.slice(0, dot);
    i = dot;
  }
  if (trimmed[i] !== '.') return null;
  i++;
  let column = trimmed.slice(i).trim();
  column = unquoteIdent(column);
  if (!table || !column) return null;
  return { table, column };
}
