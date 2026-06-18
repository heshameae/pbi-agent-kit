// CANONICAL structural key/identifier name matcher, shared by the BPA gates
// (MOD014 / FMT003 / MOD010 / MOD022), star-schema planning, grain inference, and
// any other consumer that needs the "is this column a key/identifier by name?"
// signal — so they agree BY CONSTRUCTION instead of drifting across hand-copied
// regexes (the prior state: bpa.ts and star-schema-plan.ts carried byte-identical
// copies while grain.ts used a weaker ad-hoc pattern that false-matched additive
// counts and missed year/postal/etc.).
//
// Matches camelCase/PascalCase suffixes ("CustomerKey", "ProductID", "MonthNo") and
// separated/standalone tokens ("customer key", "month_no"). DATASET-AGNOSTIC: a
// structural name signal, never a specific dataset field. Standalone `number`/`no`
// are deliberately EXCLUDED because they false-match additive counts like
// "Number of Orders"/"No of Items" (legitimately summarizeBy:sum); the camelCase
// suffix branch still catches identifier forms like "OrderNumber"/"LineNo".
import { isAggregatableNumeric } from './data-types.js';
export function looksLikeKeyName(name) {
    if (/[a-z0-9](Key|Id|ID|Code|SKU|Guid|GUID|Number|No)\b/.test(name))
        return true;
    return /(^|[^a-z])(id|key|code|sku|guid|postal|zip|year|monthno|weekno|daynumber)([^a-z]|$)/i.test(name);
}
// Total-order, locale-INDEPENDENT name comparator (code-unit order, NOT
// localeCompare). Shared by every determinism sort (parser, BPA, data dictionary,
// list-tables) so identical models produce byte-identical, machine-independent
// ordering regardless of filesystem readdir order.
export function compareByName(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
// The AXIS-side "measure-like" notion used by star-schema-plan: a numeric column that
// behaves as an aggregatable QUANTITY/measure rather than an identifier — aggregatable
// (engine-default Sum or explicit non-none) AND not a key by flag or name — so it is
// NOT offered as a shared dimension axis. It is deliberately DISTINCT from both:
//  - isAggregatableNumeric (key-INCLUSIVE: a numeric key auto-sums, so MOD014 flags it); and
//  - the fact classifier / grain / field-index, which use a STRICTER explicit-summarizeBy
//    signal. Routing those through this (engine-default-Sum) notion over-classified a
//    dimension carrying a numeric attribute (Weight/Latitude/FiscalYear, no summarizeBy)
//    as a fact and dropped numeric surrogate keys out of the grain/axis set
//    (adversarial-verify regression) — so this helper is intentionally scoped to the
//    star-schema axis test only.
export function isMeasureLikeNumeric(column) {
    return isAggregatableNumeric(column) && !column.isKey && !looksLikeKeyName(column.name);
}
//# sourceMappingURL=naming.js.map