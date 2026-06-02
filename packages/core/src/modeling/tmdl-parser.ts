import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { deriveCardinality } from './cardinality.js';
import type {
  CrossFilteringBehavior,
  StorageMode,
  TMDLColumn,
  TMDLMeasure,
  TMDLModel,
  TMDLRelationship,
  TMDLRole,
  TMDLRolePermission,
  TMDLTable,
} from './types.js';

const AUTO_DATE_PREFIXES = ['LocalDateTable_', 'DateTableTemplate_'];

// Map a TMDL partition `mode:` token to a StorageMode (case-insensitive).
function normalizeStorageMode(value: string): StorageMode | undefined {
  switch (value.trim().toLowerCase()) {
    case 'import':
      return 'import';
    case 'directquery':
      return 'directQuery';
    case 'dual':
      return 'dual';
    case 'directlake':
      return 'directLake';
    default:
      return undefined;
  }
}

// Scan upward from a header line for the nearest `///` description block.
function scanDescriptionAbove(
  allLines: ReadonlyArray<string>,
  headerIndex: number,
): string | undefined {
  for (let k = headerIndex - 1; k >= 0; k--) {
    const above = (allLines[k] ?? '').trim();
    if (!above) continue;
    if (above.startsWith('///')) {
      return above.replace(/^\/\/\/\s?/, '').trim();
    }
    break;
  }
  return undefined;
}

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

  // RLS roles are serialized one file per role under a sibling `roles/` dir.
  const rolesDir = path.join(definitionPath, 'roles');
  const roles: TMDLRole[] = [];
  if (existsSync(rolesDir) && statSync(rolesDir).isDirectory()) {
    for (const entry of readdirSync(rolesDir)) {
      if (!entry.endsWith('.tmdl')) continue;
      const parsed = parseRoleFile(readFileSync(path.join(rolesDir, entry), 'utf8'));
      if (parsed) roles.push(parsed);
    }
  }

  // Omit `roles` entirely when the model has no RLS so it stays undefined.
  return {
    modelPath: definitionPath,
    tables,
    relationships,
    ...(roles.length > 0 ? { roles } : {}),
  };
}

export function parseTableFile(content: string): TMDLTable | null {
  const lines = content.split(/\r?\n/);
  let tableName: string | null = null;
  let tableIsHidden = false;
  let tableIsCalculated = false;
  let tableDescription: string | undefined;
  let storageMode: StorageMode | undefined;
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
        // `///` description above the `table` header.
        tableDescription = scanDescriptionAbove(lines, i);
        i++;
        continue;
      }
    }

    if (tableName !== null) {
      if (/^isHidden:\s*true$/i.test(line)) tableIsHidden = true;
      if (/^calculated$/i.test(line)) tableIsCalculated = true;
      const descMatch = /^description:\s*(.+)$/i.exec(line);
      if (descMatch?.[1] !== undefined) tableDescription = descMatch[1].trim();
      // storageMode lives on the table's partition `mode:` sub-block, not the
      // table object. A table has one storage mode in practice — first wins.
      if (storageMode === undefined) {
        const modeMatch = /^mode:\s*(\w+)/i.exec(line);
        if (modeMatch?.[1]) storageMode = normalizeStorageMode(modeMatch[1]);
      }
    }

    const colMatch = /^column\s+(.+)$/.exec(line);
    const parsedColumnHeader = colMatch?.[1];
    if (parsedColumnHeader && tableName !== null) {
      const { name: colName, inlineExpression, hasEquals } = parseColumnHeader(parsedColumnHeader);
      const block = collectBlock(lines, i);
      const col = buildColumn(
        tableName,
        colName,
        inlineExpression,
        hasEquals,
        block.body,
        lines,
        i,
      );
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
    ...(tableDescription !== undefined ? { description: tableDescription } : {}),
    ...(storageMode !== undefined ? { storageMode } : {}),
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

// Parse a single TMDL role file (`<definition>/roles/<RoleName>.tmdl`):
//   role 'Sales Manager'
//     modelPermission: read
//     tablePermission Sales = 'Sales'[Region] = "West"
//     tablePermission Customer =
//       'Customer'[Country] IN VALUES(...)
// A static role has `tablePermission X =` with no filter (or no permission lines).
export function parseRoleFile(content: string): TMDLRole | null {
  const lines = content.split(/\r?\n/);
  let roleName: string | null = null;
  const tablePermissions: TMDLRolePermission[] = [];

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

    if (roleName === null) {
      const m = /^role\s+(.+)$/.exec(line);
      const parsed = m?.[1];
      if (parsed) {
        roleName = unquoteIdent(parsed.trim());
        i++;
        continue;
      }
    }

    const permMatch = /^tablePermission\s+(.+)$/.exec(line);
    const permHeader = permMatch?.[1];
    if (permHeader && roleName !== null) {
      const { name: table, inlineExpression } = splitHeaderOnEquals(permHeader);
      const block = collectBlock(lines, i);
      const exprLines: string[] = [];
      if (inlineExpression !== undefined) exprLines.push(inlineExpression);
      for (const bodyRaw of block.body) {
        const bodyLine = bodyRaw.trim();
        if (!bodyLine) continue;
        exprLines.push(bodyLine);
      }
      if (table) {
        tablePermissions.push({ table, filterExpression: exprLines.join('\n').trim() });
      }
      i = block.nextIndex;
      continue;
    }

    i++;
  }

  if (roleName === null) return null;
  return { name: roleName, tablePermissions };
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

// Split a header `rest` (everything after `measure `/`column `) on the first
// `=` into an identifier name and an optional inline expression (RHS DAX).
// `hasEquals` distinguishes `column X =` (calc, multi-line continuation to
// follow) from `column X` (a plain data column) even when the inline RHS is empty.
function splitHeaderOnEquals(rest: string): {
  name: string;
  inlineExpression?: string;
  hasEquals: boolean;
} {
  const eqIdx = rest.indexOf('=');
  if (eqIdx < 0) {
    return { name: unquoteIdent(rest.trim()), hasEquals: false };
  }
  const namePart = rest.slice(0, eqIdx).trim();
  const exprPart = rest.slice(eqIdx + 1).trim();
  return {
    name: unquoteIdent(namePart),
    inlineExpression: exprPart.length > 0 ? exprPart : undefined,
    hasEquals: true,
  };
}

function parseMeasureHeader(rest: string): { name: string; inlineExpression?: string } {
  return splitHeaderOnEquals(rest);
}

// A calc column header is `column 'X' = <DAX>` (inline) or `column X =` then an
// indented continuation. Mirrors parseMeasureHeader exactly.
function parseColumnHeader(rest: string): {
  name: string;
  inlineExpression?: string;
  hasEquals: boolean;
} {
  return splitHeaderOnEquals(rest);
}

function buildColumn(
  table: string,
  name: string,
  inlineExpression: string | undefined,
  hasEquals: boolean,
  body: ReadonlyArray<string>,
  allLines: ReadonlyArray<string>,
  headerIndex: number,
): TMDLColumn {
  let dataType = 'string';
  let summarizeBy: string | undefined;
  let sourceColumn: string | undefined;
  let dataCategory: string | undefined;
  let formatString: string | undefined;
  let isHidden = false;
  let isKey = false;
  let isCalculated = false;
  let description: string | undefined;
  let displayFolder: string | undefined;
  let sortByColumn: string | undefined;
  let isAvailableInMdx: boolean | undefined;

  // An `=` on the header means this IS a calculated column even if the
  // `calculated` token is absent (Desktop emits it, but be tolerant). This holds
  // for both the inline form (`column X = <DAX>`) and the multi-line form
  // (`column X =` then indented continuation), so key off `hasEquals`.
  const exprLines: string[] = [];
  if (inlineExpression !== undefined) exprLines.push(inlineExpression);
  if (hasEquals) isCalculated = true;
  // Guard: only absorb trailing non-prop body lines as DAX continuation once a
  // calc signal (header `=` or the `calculated` token) has been seen, so a
  // malformed data-column body can't accidentally swallow a stray line.
  let sawCalcSignal = hasEquals;

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
      else if (key === 'dataCategory') dataCategory = unquoteIdent(value);
      else if (key === 'formatString') formatString = value;
      else if (key === 'isHidden' && /true/i.test(value)) isHidden = true;
      else if (key === 'isKey' && /true/i.test(value)) isKey = true;
      else if (key === 'description') description = value;
      else if (key === 'displayFolder') displayFolder = value;
      else if (key === 'sortByColumn') sortByColumn = unquoteIdent(value);
      else if (key === 'isAvailableInMDX') isAvailableInMdx = /true/i.test(value);
      continue;
    }
    if (/^calculated$/i.test(line)) {
      isCalculated = true;
      sawCalcSignal = true;
      continue;
    }
    // A non-prop, non-token line is a DAX continuation — only when calculated.
    if (sawCalcSignal) exprLines.push(line);
  }

  // `///` description above the column header wins over a body description:
  // line when both exist (mirrors the measure path).
  const aboveDescription = scanDescriptionAbove(allLines, headerIndex);
  if (aboveDescription !== undefined) description = aboveDescription;

  const expression = exprLines.join('\n').trim() || undefined;

  return {
    table,
    name,
    dataType,
    summarizeBy,
    sourceColumn,
    dataCategory,
    formatString,
    isHidden,
    isKey,
    isCalculated,
    ...(expression !== undefined ? { expression } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(displayFolder !== undefined ? { displayFolder } : {}),
    ...(sortByColumn !== undefined ? { sortByColumn } : {}),
    ...(isAvailableInMdx !== undefined ? { isAvailableInMdx } : {}),
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
  let displayFolder: string | undefined;
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
      } else {
        displayFolder = line.slice('displayFolder:'.length).trim();
      }
      continue;
    }
    if (/^[a-zA-Z_][\w]*\s*:/.test(line)) continue;
    exprLines.push(line);
  }

  // `///` description above the measure header (preserves prior behavior:
  // an above-header `///` wins over a body description: line when both exist).
  const aboveDescription = scanDescriptionAbove(allLines, headerIndex);
  if (aboveDescription !== undefined) description = aboveDescription;

  return {
    table,
    name,
    expression: exprLines.join('\n').trim(),
    formatString,
    isHidden,
    description,
    ...(displayFolder !== undefined ? { displayFolder } : {}),
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
  let fromCardinality: string | undefined;
  let toCardinality: string | undefined;
  let relyOnReferentialIntegrity: boolean | undefined;

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
    } else if (key === 'fromCardinality') {
      fromCardinality = value;
    } else if (key === 'toCardinality') {
      toCardinality = value;
    } else if (key === 'relyOnReferentialIntegrity') {
      relyOnReferentialIntegrity = /true/i.test(value);
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
    // Derive from BOTH sides via the shared helper; absent → manyToOne (PBI default).
    cardinality: deriveCardinality(fromCardinality, toCardinality),
    ...(relyOnReferentialIntegrity !== undefined ? { relyOnReferentialIntegrity } : {}),
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
