import type {
  RelationshipFinding,
  TMDLColumn,
  TMDLModel,
  TMDLRelationship,
  TMDLTable,
} from './types.js';

export function checkRelationships(model: TMDLModel): ReadonlyArray<RelationshipFinding> {
  const findings: RelationshipFinding[] = [];
  const tableByName = new Map(model.tables.map((t) => [t.name, t]));

  for (const r of model.relationships) {
    const from = tableByName.get(r.fromTable);
    const to = tableByName.get(r.toTable);

    if (!from) {
      findings.push({
        level: 'error',
        relationshipId: r.id,
        message: `fromTable "${r.fromTable}" does not exist in model.`,
      });
      continue;
    }
    if (!to) {
      findings.push({
        level: 'error',
        relationshipId: r.id,
        message: `toTable "${r.toTable}" does not exist in model.`,
      });
      continue;
    }

    const fromCol = from.columns.find((c) => c.name === r.fromColumn);
    if (!fromCol) {
      findings.push({
        level: 'error',
        relationshipId: r.id,
        message: `Column "${r.fromColumn}" does not exist on table "${r.fromTable}".`,
      });
      continue;
    }

    const toCol = to.columns.find((c) => c.name === r.toColumn);
    if (!toCol) {
      findings.push({
        level: 'error',
        relationshipId: r.id,
        message: `Column "${r.toColumn}" does not exist on table "${r.toTable}".`,
      });
      continue;
    }

    if (!typesCompatible(fromCol, toCol)) {
      findings.push({
        level: 'error',
        relationshipId: r.id,
        message: `Key data types differ: ${r.fromTable}[${r.fromColumn}]=${fromCol.dataType} vs ${r.toTable}[${r.toColumn}]=${toCol.dataType}.`,
      });
    }
  }

  findings.push(...detectCycles(model));
  findings.push(...detectAmbiguousPaths(model));

  return findings;
}

function typesCompatible(a: TMDLColumn, b: TMDLColumn): boolean {
  if (a.dataType === b.dataType) return true;
  const numerics = new Set(['int64', 'decimal', 'double']);
  if (numerics.has(a.dataType) && numerics.has(b.dataType)) return true;
  const temporal = new Set(['date', 'dateTime']);
  if (temporal.has(a.dataType) && temporal.has(b.dataType)) return true;
  return false;
}

function detectCycles(model: TMDLModel): ReadonlyArray<RelationshipFinding> {
  const adj = new Map<string, { neighbor: string; relId: string }[]>();
  for (const r of model.relationships) {
    if (!r.isActive) continue;
    pushAdj(adj, r.fromTable, r.toTable, r.id);
    pushAdj(adj, r.toTable, r.fromTable, r.id);
  }

  const findings: RelationshipFinding[] = [];
  const visited = new Set<string>();

  const tables = Array.from(new Set(model.tables.map((t) => t.name)));
  for (const start of tables) {
    if (visited.has(start)) continue;
    const stack: { node: string; parent: string | null; viaRel: string | null }[] = [
      { node: start, parent: null, viaRel: null },
    ];
    const localSeen = new Map<string, string | null>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      const { node, parent, viaRel } = current;
      if (localSeen.has(node)) {
        if (viaRel) {
          findings.push({
            level: 'warning',
            relationshipId: viaRel,
            message: `Active-relationship cycle detected through "${node}". Power BI tolerates one inactive relationship between any two tables — verify this is intentional.`,
          });
        }
        continue;
      }
      localSeen.set(node, parent);
      visited.add(node);
      for (const next of adj.get(node) ?? []) {
        if (next.relId === viaRel) continue;
        stack.push({ node: next.neighbor, parent: node, viaRel: next.relId });
      }
    }
  }

  return dedupeByRelId(findings);
}

function detectAmbiguousPaths(model: TMDLModel): ReadonlyArray<RelationshipFinding> {
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const seen = new Map<string, string[]>();
  for (const r of model.relationships) {
    if (!r.isActive) continue;
    const k = pairKey(r.fromTable, r.toTable);
    const list = seen.get(k) ?? [];
    list.push(r.id);
    seen.set(k, list);
  }

  const findings: RelationshipFinding[] = [];
  for (const [pair, ids] of seen) {
    if (ids.length > 1) {
      for (const id of ids) {
        findings.push({
          level: 'error',
          relationshipId: id,
          message: `Multiple active relationships between the same table pair (${pair.replace('|', ' / ')}). Only one active relationship is allowed; deactivate the others.`,
        });
      }
    }
  }
  return findings;
}

function pushAdj(
  adj: Map<string, { neighbor: string; relId: string }[]>,
  from: string,
  to: string,
  relId: string,
): void {
  const list = adj.get(from) ?? [];
  list.push({ neighbor: to, relId });
  adj.set(from, list);
}

function dedupeByRelId(
  items: ReadonlyArray<RelationshipFinding>,
): ReadonlyArray<RelationshipFinding> {
  const out: RelationshipFinding[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const k = `${it.level}|${it.relationshipId}|${it.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
