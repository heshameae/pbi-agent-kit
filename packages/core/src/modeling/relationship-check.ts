import { isNumericType, isTemporalType, normalizeDataType } from './data-types.js';
import { classifyTable } from './fact-classifier.js';
import {
  type DirectedFilterEdge,
  directedFilterEdgesFromRelationships,
  edgeDisjointDirectedPaths,
  pathsDifferByIntermediate,
} from './field-index.js';
import type {
  CrossFilteringBehavior,
  RelationshipFinding,
  TMDLColumn,
  TMDLModel,
  TMDLRelationship,
  TMDLTable,
} from './types.js';

// --- single-candidate pre-write validation -----------------------------
// `relationshipCheck` validates ONE proposed relationship against the model
// before it is written (mirrors daxReferenceCheck: pure, returns structured
// blocking/warning reasons). `checkRelationships` (below) audits the whole
// existing model; this gates a create/update so we never push a broken edge.

export interface RelationshipCandidate {
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
  readonly isActive?: boolean;
  readonly crossFilteringBehavior?: CrossFilteringBehavior;
}

export interface RelationshipReason {
  readonly code: string;
  readonly message: string;
}

export interface RelationshipCheckResult {
  readonly valid: boolean;
  readonly blocking: readonly RelationshipReason[];
  readonly warnings: readonly RelationshipReason[];
}

export interface RelationshipCheckOptions {
  // Exclude this existing relationship id from the ambiguity check so an Update
  // that re-points an edge doesn't flag itself as a second active path.
  readonly ignoreRelationshipId?: string;
}

// Unordered table-pair key (A|B === B|A), matching detectAmbiguousPaths.
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function relationshipCheck(
  candidate: RelationshipCandidate,
  model: TMDLModel,
  options: RelationshipCheckOptions = {},
): RelationshipCheckResult {
  const blocking: RelationshipReason[] = [];
  const warnings: RelationshipReason[] = [];

  const tableByName = new Map(model.tables.map((t) => [t.name, t]));
  const from = tableByName.get(candidate.fromTable);
  const to = tableByName.get(candidate.toTable);

  // R1/R2: endpoint tables must exist.
  if (!from) {
    blocking.push({
      code: 'from-table-missing',
      message: `fromTable "${candidate.fromTable}" does not exist in model.`,
    });
  }
  if (!to) {
    blocking.push({
      code: 'to-table-missing',
      message: `toTable "${candidate.toTable}" does not exist in model.`,
    });
  }

  // R3/R4: endpoint columns must exist (only checkable once the table resolves).
  const fromCol = from?.columns.find((c) => c.name === candidate.fromColumn);
  const toCol = to?.columns.find((c) => c.name === candidate.toColumn);
  if (from && !fromCol) {
    blocking.push({
      code: 'from-column-missing',
      message: `Column "${candidate.fromColumn}" does not exist on table "${candidate.fromTable}".`,
    });
  }
  if (to && !toCol) {
    blocking.push({
      code: 'to-column-missing',
      message: `Column "${candidate.toColumn}" does not exist on table "${candidate.toTable}".`,
    });
  }

  // R5: key data types must be compatible (reuses the shared typesCompatible).
  if (fromCol && toCol && !typesCompatible(fromCol, toCol)) {
    blocking.push({
      code: 'type-mismatch',
      message: `Key data types differ: ${candidate.fromTable}[${candidate.fromColumn}]=${fromCol.dataType} vs ${candidate.toTable}[${candidate.toColumn}]=${toCol.dataType}.`,
    });
  }

  if (from && to && looksFactLike(model, from) && looksFactLike(model, to)) {
    blocking.push({
      code: 'direct-fact-to-fact',
      message: `Direct relationship between fact-like tables "${candidate.fromTable}" and "${candidate.toTable}" is refused. Use shared dimensions / star-schema modeling instead of joining facts directly.`,
    });
  }

  // R7: a relationship from a column to itself is never valid.
  if (candidate.fromTable === candidate.toTable && candidate.fromColumn === candidate.toColumn) {
    blocking.push({
      code: 'self-loop',
      message: `Relationship endpoints are identical (${candidate.fromTable}[${candidate.fromColumn}]). A table cannot relate to itself on the same column.`,
    });
  }

  // R6: adding a second ACTIVE relationship on the same table pair is ambiguous.
  // Only when the candidate itself would be active; honor ignoreRelationshipId
  // so an Update editing an existing active edge doesn't flag itself.
  if (candidate.isActive !== false) {
    const candidatePair = pairKey(candidate.fromTable, candidate.toTable);
    const conflict = model.relationships.some(
      (r) =>
        r.isActive &&
        r.id !== options.ignoreRelationshipId &&
        pairKey(r.fromTable, r.toTable) === candidatePair,
    );
    if (conflict) {
      blocking.push({
        code: 'ambiguous-active-path',
        message: `Another active relationship already exists between "${candidate.fromTable}" and "${candidate.toTable}". Only one active relationship is allowed per table pair; make this one inactive or deactivate the other.`,
      });
    } else if (from && to) {
      // R6b: a multi-hop DIAMOND. The same-pair case (above) is owned by
      // ambiguous-active-path; here the candidate would create a SECOND distinct
      // directed filter route between some pair of tables via different
      // intermediates. Reuse MOD017's directed edge-disjoint detector (shared via
      // field-index.ts) so the gate and the audit rule agree by construction —
      // this blocks a genuine diamond yet lets a legitimate galaxy/conformed-dim
      // schema (2nd fact → 2nd shared dim) through.
      if (createsAmbiguousDiamond(model, candidate, options.ignoreRelationshipId)) {
        blocking.push({
          code: 'ambiguous-diamond-path',
          message: `Adding this relationship creates an ambiguous filter path: "${candidate.fromTable}" and "${candidate.toTable}" are already connected through other tables. Power BI would have two ways to propagate filters between them. Make this relationship inactive, or remove an edge from the existing path.`,
        });
      }
    }
  }

  // R8: bidirectional cross-filtering is allowed but warned (filter-propagation risk).
  if (candidate.crossFilteringBehavior === 'both') {
    warnings.push({
      code: 'bidirectional',
      message: `Bidirectional cross-filtering between "${candidate.fromTable}" and "${candidate.toTable}" can create ambiguous filter propagation. Prefer single direction unless a many-to-many bridge requires it.`,
    });
  }

  return { valid: blocking.length === 0, blocking, warnings };
}

function looksFactLike(model: TMDLModel, table: TMDLTable): boolean {
  const classification = classifyTable(model, table.name);
  if (classification.kind === 'fact' && classification.confidence >= 0.6) return true;
  return table.columns.some(
    (column) =>
      isNumericType(column.dataType) &&
      column.summarizeBy !== undefined &&
      column.summarizeBy.toLowerCase() !== 'none',
  );
}

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

// Would ADDING the candidate create an ambiguous multi-hop (diamond) filter path?
//
// This MUST agree with the whole-model audit rule MOD017, which counts
// edge-disjoint DIRECTED filter paths and flags a pair only when ≥2 such paths
// differ by an intermediate table. So we reuse MOD017's EXACT detector
// (edgeDisjointDirectedPaths / pathsDifferByIntermediate from field-index.ts)
// rather than an undirected reachability check.
//
// An undirected "is there any other path between the endpoints" test
// over-blocks: it refuses a textbook galaxy/conformed-dimension schema (a 2nd
// fact relating to a 2nd shared dimension), which is correct star design that
// MOD017 leaves alone. A directed check only between the candidate's own two
// endpoints would under-block: a genuine diamond created by candidate C→D makes
// a DIFFERENT pair ambiguous (e.g. (D,A)), not (C,D). So we build the directed
// active-filter edge set (minus ignoreRelationshipId), tentatively add the
// candidate's directed edge(s) with the same semantics as
// directedFilterEdgesFromRelationships (to→from, plus from→to when bidirectional),
// and run the MOD017 detector over EVERY ordered pair of tables, blocking only a
// diamond the candidate newly introduces (ambiguous after the write, not before) —
// an apex can sit UPSTREAM of the new edge, so a forward-only walk would miss it.
// By construction the gate and MOD017 now agree.
function createsAmbiguousDiamond(
  model: TMDLModel,
  candidate: RelationshipCandidate,
  ignoreRelationshipId?: string,
): boolean {
  const preEdges: DirectedFilterEdge[] = directedFilterEdgesFromRelationships(
    model.relationships.filter((r) => r.id !== ignoreRelationshipId),
  );

  // Tentatively add the candidate's directed edge(s); same semantics as
  // directedFilterEdgesFromRelationships (filters flow to-side → from-side, plus
  // from-side → to-side when bidirectional).
  const candidateEdges: DirectedFilterEdge[] = [
    { from: candidate.toTable, to: candidate.fromTable, relationshipId: '__candidate__' },
  ];
  if (candidate.crossFilteringBehavior === 'both') {
    candidateEdges.push({
      from: candidate.fromTable,
      to: candidate.toTable,
      relationshipId: '__candidate__',
    });
  }
  const postEdges = [...preEdges, ...candidateEdges];

  // Probe EVERY ordered (src, dst) pair over all tables incident to the post-write
  // edge set. Not a forward-reachable closure of the candidate's endpoints: a
  // diamond apex can sit UPSTREAM of the new edge (candidate C→D can make pair
  // (D,A) ambiguous), which a forward-only walk misses. Both ordered directions are
  // probed because edgeDisjointDirectedPaths is DIRECTIONAL. Block only a diamond
  // the candidate INTRODUCES — ambiguous after the write but not before — so a
  // pre-existing diamond doesn't cause this unrelated write to be refused, and the
  // gate matches MOD017 (run on the post-write model) by construction. (MOD017 also
  // skips auto-date tables; the gate keeps them, but they are pure filter sources —
  // never path intermediates — so the gate can only be equal-or-stricter, never
  // laxer, and never diverges on a well-formed model.)
  const nodes = new Set<string>();
  for (const e of postEdges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  const isDiamond = (edges: DirectedFilterEdge[], src: string, dst: string): boolean => {
    const paths = edgeDisjointDirectedPaths(edges, src, dst);
    return paths.length >= 2 && pathsDifferByIntermediate(paths);
  };
  for (const src of nodes) {
    for (const dst of nodes) {
      if (src === dst) continue;
      if (isDiamond(postEdges, src, dst) && !isDiamond(preEdges, src, dst)) return true;
    }
  }
  return false;
}

export function typesCompatible(a: TMDLColumn, b: TMDLColumn): boolean {
  const leftDataType = normalizeDataType(a.dataType);
  const rightDataType = normalizeDataType(b.dataType);
  if (leftDataType === rightDataType) return true;
  if (isNumericType(leftDataType) && isNumericType(rightDataType)) return true;
  if (isTemporalType(leftDataType) && isTemporalType(rightDataType)) return true;
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
