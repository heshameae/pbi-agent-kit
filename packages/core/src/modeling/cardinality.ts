import type { Cardinality } from './types.js';

// Derive a relationship's precise cardinality from its two endpoint
// cardinalities. Power BI / TMDL expresses each side independently as
// `fromCardinality` / `toCardinality` (each `many` or `one`); the relationship
// cardinality is the (from, to) pair:
//   many + one  → manyToOne   (the normal star-schema FK → dim-key edge)
//   one  + many → oneToMany
//   one  + one  → oneToOne
//   many + many → manyToMany  (true M:M, e.g. a bridge)
//   absent      → manyToOne   (Power BI's default when a side is omitted)
//
// This fixes the prior bug where seeing `many` on EITHER side collapsed to
// manyToMany — mislabeling every ordinary 1:many edge and tripping MOD003.
// Factored into one place so the TMDL parser and the live model-driver
// snapshot derive cardinality identically.
export function deriveCardinality(fromCard?: string, toCard?: string): Cardinality {
  const from = normalizeSide(fromCard);
  const to = normalizeSide(toCard);

  if (from === 'many' && to === 'many') return 'manyToMany';
  if (from === 'one' && to === 'many') return 'oneToMany';
  if (from === 'one' && to === 'one') return 'oneToOne';
  // many+one and the all-absent default both resolve to the PBI default.
  return 'manyToOne';
}

type Side = 'many' | 'one' | undefined;

function normalizeSide(value?: string): Side {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'many') return 'many';
  if (v === 'one') return 'one';
  return undefined;
}
