import { isAggregatableNumeric, isNumericType, isStringType, isTemporalType, normalizeDataType, } from './data-types.js';
import { findCalendarSourceRisks } from './date-grain-plan.js';
import { daxReferenceCheck } from './dax-reference-check.js';
import { classifyTable } from './fact-classifier.js';
import { buildModelFieldIndexFromModel, directedFilterEdgesFromRelationships, edgeDisjointDirectedPaths, hasUndirectedRelationshipPath, pathsDifferByIntermediate, } from './field-index.js';
import { compareByName, looksLikeKeyName } from './naming.js';
import { typesCompatible } from './relationship-check.js';
export const BPA_RULES = [
    {
        // D4 `dg4:30294-30301` (USE_DIVIDE_FUNCTION) — scope includes
        // CalculatedColumn, so the check runs over measures AND calc columns via the
        // shared forEachExpressionObject iterator (regex body unchanged).
        id: 'DAX001',
        name: 'Use DIVIDE() instead of the division operator',
        severity: 'warning',
        category: 'DAX',
        check: (model) => forEachExpressionObject(model, (o) => {
            const expr = stripDaxComments(o.expression);
            if (/[^.\w]\/[^/*]/.test(` ${expr}`) && !/\bDIVIDE\s*\(/i.test(expr)) {
                return violation('DAX001', 'warning', 'DAX', o.object, {
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
        check: (model) => forEachMeasure(model, (m) => {
            const expr = stripDaxComments(m.expression);
            if (!/\bUSERELATIONSHIP\s*\(/i.test(expr))
                return null;
            if (!hasUserelationshipInCalculate(expr)) {
                return violation('DAX002', 'error', 'DAX', measureRef(m), {
                    message: 'USERELATIONSHIP found outside CALCULATE/CALCULATETABLE; will error at evaluation.',
                    fix: 'Move USERELATIONSHIP into a CALCULATE filter argument.',
                });
            }
            return null;
        }),
    },
    {
        // D5 `dg4:30304` AVOID_IFERROR — recalibrated info→warning per FINAL contract.
        id: 'DAX003',
        name: 'IFERROR is slower than IF + ISBLANK',
        severity: 'warning',
        category: 'Performance',
        check: (model) => forEachMeasure(model, (m) => {
            const expr = stripDaxComments(m.expression);
            if (/\bIFERROR\s*\(/i.test(expr)) {
                return violation('DAX003', 'warning', 'Performance', measureRef(m), {
                    message: 'IFERROR forces sequential evaluation; consider IF(ISBLANK(...), alt, expr).',
                });
            }
            return null;
        }),
    },
    {
        // C2 `dg4:30625` — recalibrated info→error per FINAL contract: a visible
        // measure with no format string is an AI/Copilot-readability + UX defect.
        id: 'FMT001',
        name: 'Measure missing formatString',
        severity: 'error',
        category: 'Formatting',
        check: (model) => forEachMeasure(model, (m) => {
            if (m.isHidden)
                return null;
            if (!m.formatString || m.formatString.trim() === '') {
                return violation('FMT001', 'error', 'Formatting', measureRef(m), {
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
        check: (model) => forEachMeasure(model, (m) => {
            if (!m.formatString)
                return null;
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
            if (autoTables.length === 0)
                return [];
            return [
                violation('MOD001', 'warning', 'Modeling', `Model.AutoDateTables(${autoTables.length})`, {
                    message: `${autoTables.length} auto-generated date table(s) detected (LocalDateTable_* / DateTableTemplate_*). Bloats model size and complicates DAX.`,
                    fix: 'Disable Auto Date/Time in Power BI Desktop options and add a proper user-built Date table.',
                }),
            ];
        },
    },
    {
        // A10 `dg3:5108` / `awesome-copilot-pbi-data.xml:18494-18526` / `dg4:30344`
        // — an inactive relationship not activated by any USERELATIONSHIP. Reframed
        // (suggest ADDING a USERELATIONSHIP measure, not deleting). ESCALATED to
        // error when the same table pair ALSO has a separate ACTIVE relationship on
        // DIFFERENT columns: queries silently fall back to the active path, slicing
        // by the wrong key (a role-playing dimension whose alternate role is dead).
        id: 'MOD002',
        name: 'Inactive relationship without USERELATIONSHIP usage',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const allDax = model.tables
                .flatMap((t) => t.measures)
                .map((m) => stripDaxComments(m.expression))
                .join('\n');
            const findings = [];
            for (const r of model.relationships) {
                if (r.isActive)
                    continue;
                const fromRef = `${r.fromTable}[${r.fromColumn}]`;
                const escaped = escapeRegex(fromRef);
                const used = new RegExp(`USERELATIONSHIP[^)]*${escaped}`, 'i').test(allDax);
                if (used)
                    continue;
                // Role-playing detection: a sibling ACTIVE relationship on the SAME
                // unordered table pair but DIFFERENT columns (column-pair signature
                // differs; guard active.id !== r.id).
                const rSig = columnPairSignature(r);
                const siblingActive = model.relationships.find((a) => a.id !== r.id && a.isActive && samePair(a, r) && columnPairSignature(a) !== rSig);
                if (siblingActive) {
                    findings.push(violation('MOD002', 'error', 'Modeling', `Relationship.${r.id}`, {
                        message: `Inactive relationship ${fromRef} → ${r.toTable}[${r.toColumn}] is a dead role-playing alternate: an active relationship already joins "${r.fromTable}" and "${r.toTable}" on different columns, so no measure can ever slice by this role — queries silently fall back to the active key.`,
                        fix: `Add a measure that activates it, e.g. CALCULATE([Measure], USERELATIONSHIP(${r.fromTable}[${r.fromColumn}], ${r.toTable}[${r.toColumn}])); or remove this relationship if the role is not needed.`,
                    }));
                }
                else {
                    findings.push(violation('MOD002', 'warning', 'Modeling', `Relationship.${r.id}`, {
                        message: `Inactive relationship ${fromRef} → ${r.toTable}[${r.toColumn}] is not activated by any USERELATIONSHIP; it has no effect until a measure uses it.`,
                        fix: `Add a measure that activates it via USERELATIONSHIP(${r.fromTable}[${r.fromColumn}], ${r.toTable}[${r.toColumn}]) inside CALCULATE, or remove it if unused.`,
                    }));
                }
            }
            return findings;
        },
    },
    {
        // A2-base + A9 folded in (`dg4:30185`, `awesome-copilot:18917`): a m:m
        // relationship is a smell; a BIDIRECTIONAL m:m with NEITHER endpoint a real
        // bridge table is ESCALATED to error (ambiguous filter propagation that
        // corrupts results). A bidi m:m through a proper bridge stays a warning.
        id: 'MOD003',
        name: 'Many-to-many cardinality (potential anti-pattern)',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => model.relationships
            .filter((r) => r.cardinality === 'manyToMany')
            .map((r) => {
            const base = `Many-to-many relationship ${r.fromTable}[${r.fromColumn}] ↔ ${r.toTable}[${r.toColumn}]. Confirm a bridge table is correct here; otherwise replace with star-schema dim.`;
            if (r.crossFilteringBehavior === 'both') {
                const bridged = isBridgeTable(model, r.fromTable) || isBridgeTable(model, r.toTable);
                const severity = bridged ? 'warning' : 'error';
                return violation('MOD003', severity, 'Modeling', `Relationship.${r.id}`, {
                    message: `${base} It is also bidirectional — a many-to-many relationship should be single-direction to avoid ambiguous filter propagation${bridged ? '' : ', and neither endpoint is a bridge table, so filters propagate ambiguously and corrupt results'}.`,
                    fix: 'Set crossFilteringBehavior to single, or introduce a proper bridge dimension.',
                });
            }
            return violation('MOD003', 'warning', 'Modeling', `Relationship.${r.id}`, {
                message: base,
            });
        }),
    },
    {
        id: 'MOD004',
        name: 'Bidirectional filter outside many-to-many bridge',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => model.relationships
            .filter((r) => r.crossFilteringBehavior === 'both' && r.cardinality !== 'manyToMany')
            .map((r) => violation('MOD004', 'warning', 'Modeling', `Relationship.${r.id}`, {
            message: `Bidirectional filter on ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]. Use cautiously outside m:m bridges — ambiguity and circular-filter risk.`,
        })),
    },
    {
        // A13 `dg4:30686` HIDE_FOREIGN_KEYS — recalibrated info→warning per FINAL contract.
        // Escalated to ERROR when the one-side/source field is also visible: that
        // creates duplicate user-facing fields where selecting the many-side key
        // bypasses the source-of-truth dimension and can produce wrong numbers.
        id: 'MOD005',
        name: 'Foreign key column visible (not hidden)',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const findings = [];
            const byTable = new Map(model.tables.map((t) => [t.name, t]));
            const seen = new Set();
            for (const r of model.relationships) {
                const fromTable = byTable.get(r.fromTable);
                const toTable = byTable.get(r.toTable);
                if (!fromTable || !toTable)
                    continue;
                const col = findColumn(fromTable, r.fromColumn);
                if (!col || col.isHidden)
                    continue;
                const key = `${col.table}\u0000${col.name}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                const sourceColumn = findColumn(toTable, r.toColumn);
                const sourceIsVisible = !!sourceColumn && !sourceColumn.isHidden && !toTable.isHidden;
                const duplicateVisibleName = sourceIsVisible && normalizeName(sourceColumn.name) === normalizeName(col.name);
                const severity = duplicateVisibleName ? 'error' : 'warning';
                const sourceRef = sourceColumn
                    ? columnRef(sourceColumn)
                    : columnRefRaw(r.toTable, r.toColumn);
                findings.push(violation('MOD005', severity, 'Modeling', columnRef(col), {
                    message: duplicateVisibleName
                        ? `FK column ${columnRef(col)} is visible and duplicates the source-of-truth dimension field ${sourceRef}; users can pick the fact-side field and bypass shared dimension filtering.`
                        : `FK column ${columnRef(col)} is visible on the many side of relationship ${r.id}; users may slice on it instead of the source-of-truth dimension field ${sourceRef}.`,
                    fix: `Set isHidden: true on ${columnRef(col)}. Keep the dimension/source field visible for report authors when it is the intended slicer/axis.`,
                }));
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
            const findings = [];
            for (const table of model.tables) {
                const colNames = new Set(table.columns.map((c) => c.name));
                for (const m of table.measures) {
                    if (colNames.has(m.name)) {
                        findings.push(violation('NAM001', 'error', 'Naming', measureRef(m), {
                            message: `Measure name collides with column ${columnRefRaw(m.table, m.name)}; binding will be ambiguous.`,
                            fix: `Rename measure to e.g. "Total ${m.name}" or "${m.name} Amount".`,
                        }));
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
            const findings = [];
            for (const table of model.tables) {
                for (const c of table.columns) {
                    if (isStringType(c.dataType) && c.summarizeBy && c.summarizeBy !== 'none') {
                        findings.push(violation('MOD006', 'info', 'Modeling', columnRef(c), {
                            message: `String column has summarizeBy=${c.summarizeBy}; should be "none".`,
                            fix: 'Set summarizeBy: none.',
                        }));
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
        check: (model) => forEachMeasure(model, (m) => {
            const expr = stripDaxComments(m.expression);
            const re = /\bCALCULATE\s*\(([^()]|\([^()]*\))*\)/gi;
            const matches = expr.match(re) ?? [];
            for (const match of matches) {
                const inner = match.replace(/^CALCULATE\s*\(/i, '').replace(/\)$/, '');
                const commas = countTopLevelCommas(inner);
                if (commas === 0) {
                    return violation('DAX004', 'info', 'DAX', measureRef(m), {
                        message: 'CALCULATE with no filter argument; equivalent to wrapping in parens. Consider removing.',
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
            const findings = [];
            for (const t of model.tables) {
                if (t.isAutoDateTable)
                    continue;
                if (t.columns.length === 0 && t.measures.length === 0) {
                    findings.push(violation('MOD007', 'info', 'Maintenance', `Table.${t.name}`, {
                        message: 'Table has no columns and no measures.',
                    }));
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
            const measureNames = new Set();
            const columnRefs = new Set();
            const measureRefs = new Set();
            for (const t of model.tables) {
                for (const m of t.measures) {
                    measureNames.add(m.name);
                    measureRefs.add(`${t.name}[${m.name}]`);
                }
                for (const c of t.columns)
                    columnRefs.add(`${t.name}[${c.name}]`);
            }
            const findings = [];
            for (const t of model.tables) {
                for (const m of t.measures) {
                    const expr = stripDaxComments(m.expression);
                    const qualifiedRefs = [...expr.matchAll(/('([^']+)'|([A-Za-z_][\w .-]*))\[([^\]]+)\]/g)];
                    let expressionWithoutQualifiedRefs = expr;
                    let hasQualifiedReferenceError = false;
                    for (const match of qualifiedRefs) {
                        const tableName = match[2] ?? match[3];
                        const fieldName = match[4];
                        if (!tableName || !fieldName)
                            continue;
                        if (columnRefs.has(`${tableName}[${fieldName}]`)) {
                            expressionWithoutQualifiedRefs = expressionWithoutQualifiedRefs.replace(match[0], ' ');
                            continue;
                        }
                        if (measureRefs.has(`${tableName}[${fieldName}]`)) {
                            expressionWithoutQualifiedRefs = expressionWithoutQualifiedRefs.replace(match[0], ' ');
                            continue;
                        }
                        findings.push(violation('DAX005', 'warning', 'DAX', measureRef(m), {
                            message: `Qualified reference ${tableName}[${fieldName}] does not match any measure or column.`,
                        }));
                        hasQualifiedReferenceError = true;
                        break;
                    }
                    if (hasQualifiedReferenceError)
                        continue;
                    const bareMeasureRefs = [...expressionWithoutQualifiedRefs.matchAll(/\[([^\]]+)\]/g)]
                        .map((x) => x[1])
                        .filter((x) => x !== undefined);
                    for (const ref of bareMeasureRefs) {
                        if (measureNames.has(ref))
                            continue;
                        const sameTableCol = `${t.name}[${ref}]`;
                        if (columnRefs.has(sameTableCol))
                            continue;
                        findings.push(violation('DAX005', 'warning', 'DAX', measureRef(m), {
                            message: `Bare reference [${ref}] does not match any measure or same-table column.`,
                        }));
                        break;
                    }
                }
            }
            // EXTEND `dg4:30254-30271` — the reference-existence scope includes
            // CalculatedColumn. Run the EXPORTED daxReferenceCheck (host-table aware,
            // strings/comments stripped) over each calc column with an expression;
            // emit one DAX005 per missing reference. Reuses the library matcher rather
            // than duplicating the inline measure regexes above. E3 owns blank-expr.
            for (const t of model.tables) {
                for (const col of t.columns) {
                    if (!col.isCalculated)
                        continue;
                    if (!col.expression || col.expression.trim() === '')
                        continue;
                    const result = daxReferenceCheck(col.expression, model, { hostTable: t.name });
                    for (const ref of result.missing) {
                        findings.push(violation('DAX005', 'warning', 'DAX', columnRefRaw(col.table, col.name), {
                            message: `Calculated column references ${ref.raw} which does not match any measure or column.`,
                        }));
                    }
                }
            }
            return findings;
        },
    },
    // === Tier 1: relationships / star-schema (FINAL contract) ===============
    {
        // A1 `dg4:30511` (ENSURE_TABLES_HAVE_RELATIONSHIPS) — orphan/disconnected
        // table. Tri-state severity (`dg3:402-406`): error for a fact-like isolated
        // table (silent data island), info when the table looks deliberate
        // (single-column param/what-if, small calc table, or auto-date), warning
        // otherwise. NEVER hard-blocks (advisory).
        id: 'MOD008',
        name: 'Table participates in no relationship (orphan)',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const related = relationshipEndpointTables(model);
            const findings = [];
            for (const t of model.tables) {
                if (t.isAutoDateTable)
                    continue; // MOD001 owns auto-date tables.
                if (related.has(t.name))
                    continue;
                // Order matters: a deliberate small/param table is info even if it has a
                // quantity column; a remaining table carrying measures/quantities is an
                // isolated FACT (error); everything else is a plain disconnected warning.
                // NOTE: classifyTable() needs a relationship to call something a fact, so
                // an orphan can never satisfy it — fact-likeness here is INTRINSIC (shape
                // only: measures and/or summarizable quantity columns).
                if (isDeliberatelyDisconnected(t)) {
                    findings.push(violation('MOD008', 'info', 'Modeling', `Table.${t.name}`, {
                        message: `Table "${t.name}" participates in no relationship. Looks deliberate (parameter / what-if / small calc / single-column) — verify it is intentional.`,
                    }));
                }
                else if (looksIntrinsicallyFactLike(t)) {
                    findings.push(violation('MOD008', 'error', 'Modeling', `Table.${t.name}`, {
                        message: `Fact-like table "${t.name}" participates in no relationship; it is a disconnected data island whose measures/quantities cannot be sliced by any dimension.`,
                        fix: 'Relate it to the shared dimensions (date + conformed dims) via single-direction relationships.',
                    }));
                }
                else {
                    findings.push(violation('MOD008', 'warning', 'Modeling', `Table.${t.name}`, {
                        message: `Table "${t.name}" participates in no relationship; it cannot be filtered by or filter any other table.`,
                        fix: 'Relate it into the model, or confirm it is intentionally standalone.',
                    }));
                }
            }
            return findings;
        },
    },
    {
        // A2 `awesome-copilot-pbi-data.xml:11851` — a relationship whose BOTH
        // endpoints are fact-like. Should be bridged through a shared dimension.
        id: 'MOD009',
        name: 'Fact-to-fact relationship',
        severity: 'error',
        category: 'Modeling',
        check: (model) => {
            const findings = [];
            // Require BOTH endpoints to be HIGH-confidence facts (>= 0.85 ≈ ≥2
            // corroborating signals). The minimum fact confidence is 0.75 (a single
            // signal — e.g. a snowflake intermediate dimension carrying one stray
            // summable numeric); excluding that tier prevents an error-severity false
            // positive on a mis-classified dimension. (Contract: "both endpoints fact-high".)
            const FACT_HIGH = 0.85;
            for (const r of model.relationships) {
                const from = classifyTable(model, r.fromTable);
                const to = classifyTable(model, r.toTable);
                if (from.kind === 'fact' &&
                    to.kind === 'fact' &&
                    from.confidence >= FACT_HIGH &&
                    to.confidence >= FACT_HIGH) {
                    findings.push(violation('MOD009', 'error', 'Modeling', `Relationship.${r.id}`, {
                        message: `Relationship directly joins two fact-like tables (${r.fromTable} ↔ ${r.toTable}); this creates incorrect filter propagation and grain issues.`,
                        fix: 'Remove the direct edge and relate both facts to a shared (conformed) dimension instead.',
                    }));
                }
            }
            return findings;
        },
    },
    {
        // A3 `awesome-copilot-pbi-data.xml:18923` — 2+ fact-like tables share a
        // same-named, non-key categorical column but have NO relationship path
        // between them: a conformed dimension is missing. Uses the field-index
        // undirected-path check.
        id: 'MOD010',
        name: 'Missing conformed dimension',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const facts = model.tables.filter((t) => classifyTable(model, t.name).kind === 'fact');
            if (facts.length < 2)
                return [];
            const index = buildModelFieldIndexFromModel(model);
            const findings = [];
            const reported = new Set();
            for (let a = 0; a < facts.length; a++) {
                for (let b = a + 1; b < facts.length; b++) {
                    const fa = facts[a];
                    const fb = facts[b];
                    if (!fa || !fb)
                        continue;
                    if (hasUndirectedRelationshipPath(index, fa.name, fb.name))
                        continue;
                    const shared = sharedCategoricalColumnNames(fa, fb);
                    for (const colName of shared) {
                        const key = `${fa.name}|${fb.name}|${colName}`;
                        if (reported.has(key))
                            continue;
                        reported.add(key);
                        findings.push(violation('MOD010', 'warning', 'Modeling', `Table.${fa.name}`, {
                            message: `Fact tables "${fa.name}" and "${fb.name}" both have a "${colName}" column but no shared dimension relates them; cross-fact analysis on ${colName} is impossible.`,
                            fix: `Build a conformed "${colName}" dimension (DISTINCT/SELECTCOLUMNS over the facts), relate both facts to it, and hide the FK columns.`,
                        }));
                    }
                }
            }
            return findings;
        },
    },
    {
        // A4 `dg4:30414` (RELATIONSHIP_COLUMNS_SAME_DATA_TYPE) — severity SPLIT via
        // the shared exported typesCompatible: a WIDENING mismatch (both numeric
        // {int64,decimal,double} or both temporal {date,dateTime}) is a warning —
        // it joins but hurts refresh/perf; a HARD-INCOMPATIBLE mismatch
        // (string↔int64, dateTime↔int64…) is an error — the relationship cannot
        // reliably match keys and produces wrong/empty results.
        id: 'MOD011',
        name: 'Relationship key data types differ',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const byTable = new Map(model.tables.map((t) => [t.name, t]));
            const findings = [];
            for (const r of model.relationships) {
                const fromCol = byTable.get(r.fromTable)?.columns.find((c) => c.name === r.fromColumn);
                const toCol = byTable.get(r.toTable)?.columns.find((c) => c.name === r.toColumn);
                if (!fromCol || !toCol)
                    continue;
                if (normalizeDataType(fromCol.dataType) === normalizeDataType(toCol.dataType))
                    continue;
                const widening = typesCompatible(fromCol, toCol);
                const severity = widening ? 'warning' : 'error';
                findings.push(violation('MOD011', severity, 'Modeling', `Relationship.${r.id}`, {
                    message: `Relationship key data types differ: ${r.fromTable}[${r.fromColumn}]=${fromCol.dataType} vs ${r.toTable}[${r.toColumn}]=${toCol.dataType}.${widening ? ' Both are the same family (widening) — it joins but hurts refresh/compression.' : ' These are incompatible types — the relationship cannot reliably match keys and will produce wrong or empty results.'}`,
                    fix: 'Change one column so both endpoints share an identical data type.',
                }));
            }
            return findings;
        },
    },
    {
        // A6 `dg4:30085` (SNOWFLAKE_SCHEMA_ARCHITECTURE) — a table that is BOTH a
        // from-side and a to-side (a dim chained onto another dim). Exclude
        // fact-like tables (a fact is naturally a from-side).
        id: 'MOD012',
        name: 'Snowflake schema (dimension chained onto dimension)',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const fromSides = new Set(model.relationships.map((r) => r.fromTable));
            const toSides = new Set(model.relationships.map((r) => r.toTable));
            const findings = [];
            for (const t of model.tables) {
                if (!fromSides.has(t.name) || !toSides.has(t.name))
                    continue;
                if (classifyTable(model, t.name).kind === 'fact')
                    continue;
                findings.push(violation('MOD012', 'warning', 'Modeling', `Table.${t.name}`, {
                    message: `Table "${t.name}" is both a from-side and a to-side of relationships (snowflake). Star schemas flatten dimensions for performance and simplicity.`,
                    fix: `Denormalize the chained attributes into "${t.name}" so it relates directly to the fact.`,
                }));
            }
            return findings;
        },
    },
    {
        // A7 `dg4:30125` — excessive bidirectional / many-to-many ratio. One
        // model-level finding when (both + manyToMany)/total > 0.30.
        id: 'MOD013',
        name: 'Excessive bidirectional / many-to-many relationships',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const total = model.relationships.length;
            if (total === 0)
                return [];
            const risky = model.relationships.filter((r) => r.crossFilteringBehavior === 'both' || r.cardinality === 'manyToMany').length;
            const ratio = risky / total;
            if (ratio <= 0.3)
                return [];
            const pct = Math.round(ratio * 100);
            return [
                violation('MOD013', 'warning', 'Modeling', `Model.Relationships(${risky}/${total})`, {
                    message: `${pct}% of relationships are bidirectional or many-to-many (${risky} of ${total}); >30% signals filter-propagation complexity and ambiguity risk.`,
                    fix: 'Replace bidirectional/m:m edges with single-direction star-schema relationships where possible.',
                }),
            ];
        },
    },
    {
        // A5 `dg4:30666` — relationship key columns should be integer (info).
        id: 'MOD015',
        name: 'Relationship key column is not an integer',
        severity: 'info',
        category: 'Modeling',
        check: (model) => {
            const byTable = new Map(model.tables.map((t) => [t.name, t]));
            const findings = [];
            const seen = new Set();
            for (const r of model.relationships) {
                const fromCol = byTable.get(r.fromTable)?.columns.find((c) => c.name === r.fromColumn);
                const toCol = byTable.get(r.toTable)?.columns.find((c) => c.name === r.toColumn);
                for (const [tableName, col] of [
                    [r.fromTable, fromCol],
                    [r.toTable, toCol],
                ]) {
                    if (!col || normalizeDataType(col.dataType) === 'int64')
                        continue;
                    const key = `${tableName}[${col.name}]`;
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    findings.push(violation('MOD015', 'info', 'Modeling', columnRefRaw(tableName, col.name), {
                        message: `Relationship key ${key} is ${col.dataType}; integer keys join faster and compress better.`,
                    }));
                }
            }
            return findings;
        },
    },
    {
        // A15 — TREATAS used to bridge two facts that should share a dimension
        // (a smell). Reuses the field-index treatasBridgeMeasures detector.
        id: 'MOD016',
        name: 'TREATAS bridge between facts (consider a conformed dimension)',
        severity: 'info',
        category: 'Modeling',
        check: (model) => {
            const index = buildModelFieldIndexFromModel(model);
            const findings = [];
            for (const bridge of Object.values(index.treatasBridgeMeasures)) {
                const fromFact = classifyTable(model, bridge.fromTable).kind === 'fact';
                const toFact = classifyTable(model, bridge.toTable).kind === 'fact';
                if (!fromFact || !toFact)
                    continue;
                findings.push(violation('MOD016', 'info', 'Modeling', `'${bridge.measure.table}'[${bridge.measure.name}]`, {
                    message: `Measure bridges facts "${bridge.fromTable}" → "${bridge.toTable}" via TREATAS. A shared (conformed) dimension would be simpler and more robust than a virtual relationship.`,
                    fix: 'Build a conformed dimension for the shared axis, relate both facts, then simplify this measure to a plain CALCULATE.',
                }));
            }
            return findings;
        },
    },
    // === Tier 2: columns / formatting / date / naming / error-prevention =====
    {
        // C1 `dg4:30635` (NUMERIC_COLUMN_SUMMARIZE_BY) — a visible numeric column
        // that is really a KEY/identifier (by name) must not auto-aggregate. The
        // name regex (key/id/year/postal/monthNo) is the canonical TE ruleset
        // pattern — a STRUCTURAL signal, NOT a dataset-specific identifier.
        id: 'MOD014',
        name: 'Numeric key column has summarizeBy != none',
        severity: 'error',
        category: 'Modeling',
        check: (model) => {
            const findings = [];
            for (const t of model.tables) {
                for (const c of t.columns) {
                    if (c.isHidden)
                        continue;
                    // Summing a numeric key is meaningless whether the Sum is EXPLICIT or the
                    // engine default. A numeric column with no `summarizeBy` line auto-sums
                    // (implicit Sum), so the prior `!c.summarizeBy` skip let an int64 Year /
                    // CustomerKey escape the gate while still summing in visuals. isAggregatableNumeric
                    // skips only an explicit `none` (and non-numerics).
                    if (!isAggregatableNumeric(c))
                        continue;
                    if (!looksLikeKeyName(c.name))
                        continue;
                    const effectiveSummarizeBy = c.summarizeBy ?? 'Sum (engine default)';
                    findings.push(violation('MOD014', 'error', 'Modeling', columnRef(c), {
                        message: `Numeric key/identifier column "${c.name}" has summarizeBy=${effectiveSummarizeBy}; summing a key produces meaningless totals.`,
                        fix: 'Set summarizeBy: none on this column.',
                    }));
                }
            }
            return findings;
        },
    },
    {
        // C3 `dg4:29840` — visible numeric column with no format string (warning).
        // Needs the new TMDLColumn.formatString field.
        id: 'FMT003',
        name: 'Visible numeric column has no formatString',
        severity: 'warning',
        category: 'Formatting',
        check: (model) => {
            const findings = [];
            for (const t of model.tables) {
                for (const c of t.columns) {
                    if (c.isHidden)
                        continue;
                    if (!isNumericType(c.dataType))
                        continue;
                    // A key/identifier (summarizeBy none + key-like name) needs no number format.
                    if (looksLikeKeyName(c.name) && (!c.summarizeBy || c.summarizeBy === 'none'))
                        continue;
                    if (!c.formatString || c.formatString.trim() === '') {
                        findings.push(violation('FMT003', 'warning', 'Formatting', columnRef(c), {
                            message: `Visible numeric column "${c.name}" has no formatString; it will render with default formatting.`,
                            fix: 'Add a formatString (e.g. #,0 or #,0.00).',
                        }));
                    }
                }
            }
            return findings;
        },
    },
    {
        // C4 `dg4:30013` — avoid floating-point (double) types (warning).
        id: 'FMT004',
        name: 'Column uses double (floating-point) data type',
        severity: 'warning',
        category: 'Formatting',
        check: (model) => {
            const findings = [];
            for (const t of model.tables) {
                for (const c of t.columns) {
                    if (normalizeDataType(c.dataType) === 'double') {
                        findings.push(violation('FMT004', 'warning', 'Formatting', columnRef(c), {
                            message: `Column "${c.name}" is a double (floating-point); use Fixed Decimal (decimal/currency) to avoid rounding error and improve compression.`,
                            fix: 'Change the data type to decimal (Fixed Decimal Number).',
                        }));
                    }
                }
            }
            return findings;
        },
    },
    {
        // B1 `dg4:30095` — the model should have a proper date table (a table
        // marked dataCategory=Time with a date/dateTime key). Needs the new
        // dataCategory field. One model-level finding.
        id: 'MODB1',
        name: 'Model has no date table',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const hasDateTable = model.tables.some((t) => isMarkedDateTable(t) ||
                t.columns.some((c) => isTimeDataCategory(c.dataCategory) && isTemporalType(c.dataType)));
            if (hasDateTable)
                return [];
            // Only nudge if there is at least one date/dateTime column to anchor on.
            const hasAnyDateColumn = model.tables.some((t) => t.columns.some((c) => isTemporalType(c.dataType)));
            if (!hasAnyDateColumn)
                return [];
            return [
                violation('MODB1', 'warning', 'Modeling', 'Model.DateTable', {
                    message: 'No table is marked as a date table (a column with dataCategory "Time"). Time-intelligence DAX (YTD/PY/YoY) needs a marked date dimension.',
                    fix: 'Use pbi_model_plan_date_table to prove complete fact-date coverage, then pbi_table_mark_as_date to mark the governed Date table/key. Do not set dataCategory metadata directly.',
                }),
            ];
        },
    },
    {
        // B2 `dg4:30105` — a table NAMED date/calendar that is not marked as a date
        // table (warning). The date/calendar name regex is the canonical TE pattern,
        // a STRUCTURAL signal, not a dataset identifier. Needs dataCategory.
        id: 'MODB2',
        name: 'Date/Calendar table not marked as a date table',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const findings = [];
            for (const t of model.tables) {
                if (t.isAutoDateTable)
                    continue;
                if (!looksLikeDateTableName(t.name))
                    continue;
                const marked = isMarkedDateTable(t) ||
                    t.columns.some((c) => isTimeDataCategory(c.dataCategory) && isTemporalType(c.dataType));
                if (marked)
                    continue;
                findings.push(violation('MODB2', 'warning', 'Modeling', `Table.${t.name}`, {
                    message: `Table "${t.name}" looks like a date dimension but is not marked as a date table; time-intelligence functions may not resolve it.`,
                    fix: 'Use pbi_model_plan_date_table to prove complete fact-date coverage, then pbi_table_mark_as_date to mark this governed Date table/key. Do not set dataCategory metadata directly.',
                }));
            }
            return findings;
        },
    },
    {
        // MOD029 `dg3-semantic-models.xml:5104` — a proper date table must span the
        // full range of fact data; `dg4-te-fabric-desktop-root.xml:30095-30114`
        // requires governed date/calendar tables instead of auto/prompt-created
        // implementation details. Literal or volatile calendar bounds are a generic
        // structural smell: the table may silently exclude facts or drift with the
        // system date. The fix path is the deterministic coverage planner, not a
        // prompt-chosen year.
        id: 'MOD029',
        name: 'Date table has unproven calendar bounds',
        severity: 'error',
        category: 'Modeling',
        check: (model) => {
            const findings = [];
            for (const t of model.tables) {
                if (t.isAutoDateTable)
                    continue;
                if (!isDateTableCandidate(t))
                    continue;
                const risks = findCalendarSourceRisks(dateTableSources(t));
                for (const risk of risks) {
                    findings.push(violation('MOD029', 'error', 'Modeling', `Table.${t.name}`, {
                        message: risk.code === 'volatile-calendar-anchor'
                            ? `Date/calendar table "${t.name}" uses a volatile current-date anchor in its source expression. Calendar coverage can drift and produce different numbers over time.`
                            : `Date/calendar table "${t.name}" uses literal hardcoded calendar bounds in its source expression. The range may not cover the observed fact min/max dates.`,
                        fix: 'Run pbi_model_plan_date_table to prove observed fact min/max coverage and use those bounds. Extend beyond observed max only with an explicit user-approved futureHorizonDays policy; do not use TODAY()/NOW() as the default anchor.',
                    }));
                }
            }
            return findings;
        },
    },
    {
        // C11 `dg4:30593` / `dg3:5214-28` — object-name hygiene. ERROR for
        // leading/trailing whitespace or control characters (these break TMDL /
        // references); WARNING for a Fact*/Dim* prefix or other special chars
        // (stylistic but discouraged). Regex-only; dataset-agnostic.
        id: 'NAM002',
        name: 'Object name hygiene',
        severity: 'error',
        category: 'Naming',
        check: (model) => {
            const findings = [];
            const check = (objectRef, name) => {
                if (hasLeadingTrailingSpace(name) || hasControlChars(name)) {
                    findings.push(violation('NAM002', 'error', 'Naming', objectRef, {
                        message: `Name "${name}" has leading/trailing whitespace or control characters; this breaks references and TMDL serialization.`,
                        fix: 'Trim whitespace and remove control characters from the name.',
                    }));
                    return;
                }
                // `dg4:29830` — an object named exactly a DAX reserved word forces
                // bracket/quote escaping everywhere and confuses references.
                if (isReservedWord(name)) {
                    findings.push(violation('NAM002', 'warning', 'Naming', objectRef, {
                        message: `Name "${name}" is a DAX reserved word; it must be quoted/bracketed everywhere and is easily confused with the function. Rename it.`,
                        fix: 'Use a distinct business name (e.g. "Calendar Date" instead of "Date").',
                    }));
                    return;
                }
                if (hasFactDimPrefix(name) || hasSpecialChars(name)) {
                    findings.push(violation('NAM002', 'warning', 'Naming', objectRef, {
                        message: `Name "${name}" uses a Fact/Dim prefix or special characters; prefer plain business names (e.g. "Sales", not "FactSales").`,
                        fix: 'Rename to a clean business-friendly name without Fact/Dim prefixes or special characters.',
                    }));
                }
            };
            for (const t of model.tables) {
                if (t.isAutoDateTable)
                    continue;
                check(`Table.${t.name}`, t.name);
                for (const c of t.columns)
                    check(columnRef(c), c.name);
                for (const m of t.measures)
                    check(measureRef(m), m.name);
            }
            return findings;
        },
    },
    {
        // E1 `dg4:30374` — a data (non-calculated) column must have a source column.
        // GUARD: only meaningful when the model actually expresses column sources.
        // Some ingestion paths (the live MS-MCP snapshot; shorthand fixtures) do not
        // surface sourceColumn at all — flagging every column then would be a false
        // positive. So require evidence: fire only if at least one column in the
        // model DOES carry a sourceColumn (i.e. the convention is in use) yet this
        // one does not.
        id: 'E1',
        name: 'Data column has no source column',
        severity: 'error',
        category: 'ErrorPrevention',
        check: (model) => {
            const modelExpressesSources = model.tables.some((t) => t.columns.some((c) => !c.isCalculated && c.sourceColumn && c.sourceColumn.trim() !== ''));
            if (!modelExpressesSources)
                return [];
            const findings = [];
            for (const t of model.tables) {
                if (t.isCalculated || t.isAutoDateTable)
                    continue;
                for (const c of t.columns) {
                    if (c.isCalculated)
                        continue;
                    if (!c.sourceColumn || c.sourceColumn.trim() === '') {
                        findings.push(violation('E1', 'error', 'ErrorPrevention', columnRef(c), {
                            message: `Data column "${c.name}" has no sourceColumn; it has nothing to load and will error or stay empty.`,
                            fix: 'Set sourceColumn, or convert it to a calculated column with an expression.',
                        }));
                    }
                }
            }
            return findings;
        },
    },
    {
        // E2 `dg4:30384` — an expression-reliant object (here: a measure) must have
        // a non-blank expression.
        id: 'E2',
        name: 'Measure has a blank expression',
        severity: 'error',
        category: 'ErrorPrevention',
        check: (model) => forEachMeasure(model, (m) => {
            if (!m.expression || m.expression.trim() === '') {
                return violation('E2', 'error', 'ErrorPrevention', measureRef(m), {
                    message: 'Measure has a blank expression; it will error when evaluated.',
                    fix: 'Provide a DAX expression for the measure.',
                });
            }
            return null;
        }),
    },
    // === Tier 3: DAX expression hygiene =====================================
    {
        // D1 `dg4:30254` — columns must be fully qualified ('Table'[Col]). A bare
        // [X] that resolves to a COLUMN (and is not a measure name) is unqualified.
        // Mirrors the DAX005 ref-classification machinery; column wins only when the
        // bare name is not also a measure name (avoids cross-fire with measures).
        id: 'DAX006',
        name: 'Column references should be fully qualified',
        severity: 'error',
        category: 'DAX',
        check: (model) => {
            const { measureNames, columnNames } = buildNameSets(model);
            const findings = [];
            for (const t of model.tables) {
                for (const m of t.measures) {
                    const expr = stripDaxComments(m.expression);
                    const withoutQualified = blankOutQualifiedRefs(expr);
                    for (const match of withoutQualified.matchAll(/\[([^\]]+)\]/g)) {
                        const name = match[1];
                        if (!name)
                            continue;
                        if (measureNames.has(name))
                            continue; // a bare measure ref — DAX007 territory, allowed here.
                        if (columnNames.has(name)) {
                            findings.push(violation('DAX006', 'error', 'DAX', measureRef(m), {
                                message: `Unqualified column reference [${name}]; columns must be written as 'Table'[Column].`,
                                fix: `Qualify it, e.g. '${columnTableFor(model, name) ?? 'Table'}'[${name}].`,
                            }));
                            break;
                        }
                    }
                }
            }
            return findings;
        },
    },
    {
        // D2 `dg4:30264` — measure references must NOT be table-qualified. A
        // qualified 'Table'[Name] that resolves to a MEASURE is the violation.
        id: 'DAX007',
        name: 'Measure references should not be table-qualified',
        severity: 'error',
        category: 'DAX',
        check: (model) => {
            const { measureNames, columnRefs } = buildNameSets(model);
            const findings = [];
            for (const t of model.tables) {
                for (const m of t.measures) {
                    const expr = stripDaxComments(m.expression);
                    for (const match of expr.matchAll(/('([^']+)'|([A-Za-z_][\w .-]*))\[([^\]]+)\]/g)) {
                        const tableName = match[2] ?? match[3];
                        const fieldName = match[4];
                        if (!tableName || !fieldName)
                            continue;
                        // Only a violation if it is a measure AND not a (legitimately
                        // qualified) column with the same name on that table.
                        if (measureNames.has(fieldName) && !columnRefs.has(`${tableName}[${fieldName}]`)) {
                            findings.push(violation('DAX007', 'error', 'DAX', measureRef(m), {
                                message: `Measure reference ${tableName}[${fieldName}] is table-qualified; measures should be referenced bare as [${fieldName}].`,
                                fix: `Write it as [${fieldName}].`,
                            }));
                            break;
                        }
                    }
                }
            }
            return findings;
        },
    },
    {
        // D3 `dg4:30274` — avoid duplicate measures (two measures with identical
        // whitespace-normalized DAX). One finding per duplicate group member.
        id: 'DAX008',
        name: 'Duplicate measure definitions',
        severity: 'warning',
        category: 'DAX',
        check: (model) => {
            const byNormalized = new Map();
            for (const t of model.tables) {
                for (const m of t.measures) {
                    const norm = normalizeDax(m.expression);
                    if (norm === '')
                        continue;
                    const list = byNormalized.get(norm) ?? [];
                    list.push({ table: m.table, name: m.name });
                    byNormalized.set(norm, list);
                }
            }
            const findings = [];
            for (const group of byNormalized.values()) {
                if (group.length < 2)
                    continue;
                // Sort peer refs so the human-readable message is canonical regardless of
                // table-parse order (the message text itself must not shuffle run-to-run).
                const others = group.map((g) => `'${g.table}'[${g.name}]`).sort(compareByName);
                for (const g of group) {
                    findings.push(violation('DAX008', 'warning', 'DAX', `'${g.table}'[${g.name}]`, {
                        message: `Measure has the same DAX as ${group.length - 1} other measure(s): ${others.filter((o) => o !== `'${g.table}'[${g.name}]`).join(', ')}. Consolidate to one.`,
                        fix: 'Keep one canonical measure and delete or re-point the duplicates.',
                    }));
                }
            }
            return findings;
        },
    },
    {
        // D6 `dg4:30284` — prefer TREATAS over INTERSECT (warning).
        id: 'DAX009',
        name: 'Use TREATAS instead of INTERSECT',
        severity: 'warning',
        category: 'DAX',
        check: (model) => forEachMeasure(model, (m) => {
            const expr = stripDaxComments(m.expression);
            if (/\bINTERSECT\s*\(/i.test(expr)) {
                return violation('DAX009', 'warning', 'DAX', measureRef(m), {
                    message: 'Uses INTERSECT; TREATAS is usually faster and clearer for applying a virtual relationship.',
                    fix: 'Replace INTERSECT(...) with TREATAS(...).',
                });
            }
            return null;
        }),
    },
    {
        // D7 `dg4:30314` — a measure must not be a bare direct reference to another
        // measure (just `[OtherMeasure]`). Adds an indirection with no value.
        id: 'DAX010',
        name: 'Measure is a direct reference to another measure',
        severity: 'warning',
        category: 'DAX',
        check: (model) => {
            const { measureNames } = buildNameSets(model);
            return forEachMeasure(model, (m) => {
                const body = stripDaxComments(m.expression).trim();
                const direct = /^\[([^\]]+)\]$/.exec(body) ?? /^'[^']+'\[([^\]]+)\]$/.exec(body);
                const ref = direct?.[1];
                if (ref && ref !== m.name && measureNames.has(ref)) {
                    return violation('DAX010', 'warning', 'DAX', measureRef(m), {
                        message: `Measure is just a direct reference to [${ref}]; this indirection adds maintenance cost with no benefit.`,
                        fix: `Reference [${ref}] directly where needed, or give this measure a distinct calculation.`,
                    });
                }
                return null;
            });
        },
    },
    {
        // D8 `dg4:30324` — filter column/measure values correctly: avoid passing a
        // whole table to FILTER inside CALCULATE (FILTER('T', 'T'[c]=...) /
        // FILTER('T', [m]>n)). Prefer a column predicate or KEEPFILTERS.
        id: 'DAX011',
        name: 'Table filter inside CALCULATE',
        severity: 'warning',
        category: 'DAX',
        check: (model) => forEachMeasure(model, (m) => {
            const expr = stripDaxComments(m.expression);
            if (!/\bCALCULATE\s*\(/i.test(expr))
                return null;
            // FILTER( <tableRef> , ... ) where the first arg is a table name/ref.
            if (/\bFILTER\s*\(\s*('[^']+'|[A-Za-z_][\w]*|ALL\s*\([^)]*\))\s*,/i.test(expr)) {
                return violation('DAX011', 'warning', 'DAX', measureRef(m), {
                    message: 'CALCULATE wraps FILTER over an entire table; this materializes the full table. Filter on a single column instead.',
                    fix: "Use a column predicate, e.g. CALCULATE(..., 'Table'[Col] = value), or wrap a narrow column in FILTER.",
                });
            }
            return null;
        }),
    },
    // === Wave 2: MOD008-class correctness rules =============================
    {
        // MOD017 `awesome-copilot-pbi-data.xml:18504-18508, :18571-18574, :18589,
        // :12259-12260` — an ambiguous multi-hop (diamond) filter path: A reaches B
        // both directly (or via one intermediate) AND via a DIFFERENT intermediate,
        // so Power BI has two ways to propagate filters. The existing
        // detectAmbiguousPaths only catches ≥2 rels on the SAME table pair; this
        // catches the cross-intermediate diamond. Edge-disjoint path counting over
        // the directed active-filter edge set; emit once per unordered pair.
        id: 'MOD017',
        name: 'Ambiguous multi-hop (diamond) filter path',
        severity: 'error',
        category: 'Modeling',
        check: (model) => {
            const allEdges = directedFilterEdgesFromRelationships(model.relationships);
            // Skip edges that touch an auto-date table (machine-generated).
            const autoDate = new Set(model.tables.filter((t) => t.isAutoDateTable).map((t) => t.name));
            const edges = allEdges.filter((e) => !autoDate.has(e.from) && !autoDate.has(e.to));
            const tables = model.tables.filter((t) => !t.isAutoDateTable).map((t) => t.name);
            const findings = [];
            const reported = new Set();
            for (let i = 0; i < tables.length; i++) {
                for (let j = 0; j < tables.length; j++) {
                    if (i === j)
                        continue;
                    const src = tables[i];
                    const dst = tables[j];
                    if (src === undefined || dst === undefined)
                        continue;
                    const key = src < dst ? `${src}|${dst}` : `${dst}|${src}`;
                    if (reported.has(key))
                        continue;
                    const paths = edgeDisjointDirectedPaths(edges, src, dst);
                    // Need ≥2 edge-disjoint paths that differ by ≥1 intermediate table, so
                    // the same-pair (length-1 vs length-1) case stays owned by the
                    // existing ambiguous-active-path error and a single dim fanning to two
                    // facts (both length-1) is NOT flagged.
                    if (paths.length < 2)
                        continue;
                    if (!pathsDifferByIntermediate(paths))
                        continue;
                    reported.add(key);
                    findings.push(violation('MOD017', 'error', 'Modeling', `Model.AmbiguousPath(${key})`, {
                        message: `Ambiguous filter path: "${src}" and "${dst}" are connected by two or more different active routes (through different intermediate tables). Power BI has multiple ways to propagate filters between them, producing unpredictable results.`,
                        fix: 'Make one of the redundant relationships inactive (activate it per-measure with USERELATIONSHIP), or remove an edge so a single path remains.',
                    }));
                }
            }
            return findings;
        },
    },
    {
        // MOD018 `dg3-semantic-models.xml:5104` — time-intelligence DAX is used but
        // NO table is marked as a date table (a column with dataCategory 'Time').
        // TI functions silently return BLANK without a marked date dimension.
        id: 'MOD018',
        name: 'Time-intelligence used but no marked date table',
        severity: 'error',
        category: 'Modeling',
        check: (model) => {
            // Reuse the EXACT MODB1/MODB2 marked-date predicate.
            const hasMarkedDate = model.tables.some((t) => isMarkedDateTable(t) ||
                t.columns.some((c) => isTimeDataCategory(c.dataCategory) && isTemporalType(c.dataType)));
            if (hasMarkedDate)
                return [];
            const tiRe = new RegExp(`\\b(${TIME_INTEL_FUNCTIONS.join('|')})\\s*\\(`, 'i');
            for (const t of model.tables) {
                for (const m of t.measures) {
                    const expr = stripDaxComments(m.expression);
                    if (tiRe.test(expr)) {
                        return [
                            violation('MOD018', 'error', 'Modeling', 'Model.DateTable', {
                                message: `Measure ${measureRef(m)} uses time-intelligence DAX, but no table is marked as a date table (no column has dataCategory "Time"). Time-intelligence functions return BLANK without a marked date dimension.`,
                                fix: 'Use pbi_model_plan_date_table to prove complete fact-date coverage, then pbi_table_mark_as_date to mark the governed Date table/key before authoring time-intelligence DAX. Do not set dataCategory metadata directly.',
                            }),
                        ];
                    }
                }
            }
            return [];
        },
    },
    {
        // MOD019 `awesome-copilot-pbi-data.xml:18918` ("Mixed grain facts |
        // Incorrect aggregations | Separate tables per grain" — the cross-fact grain
        // mismatch anti-pattern), `awesome-copilot-pbi-data.xml:18856-18862`
        // (consistent-grain principle) — HEURISTIC (highest FP risk, therefore
        // WARNING): a date dimension that ≥2 high-confidence facts relate to at
        // DIFFERENT grains (one day-grain, one coarse-grain). Advisory only.
        id: 'MOD019',
        name: 'Target-vs-actual grain mismatch (heuristic)',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const byTable = new Map(model.tables.map((t) => [t.name, t]));
            const findings = [];
            const reported = new Set();
            for (const d of model.tables) {
                if (d.isAutoDateTable)
                    continue;
                const isDateDim = isMarkedDateTable(d) ||
                    d.columns.some((c) => isTimeDataCategory(c.dataCategory) && isTemporalType(c.dataType)) ||
                    looksLikeDateTableName(d.name);
                if (!isDateDim)
                    continue;
                const factGrains = [];
                for (const r of model.relationships) {
                    if (!r.isActive)
                        continue;
                    let factName;
                    let toCol;
                    if (r.toTable === d.name) {
                        factName = r.fromTable;
                        toCol = r.toColumn;
                    }
                    else if (r.fromTable === d.name) {
                        factName = r.toTable;
                        toCol = r.fromColumn;
                    }
                    else
                        continue;
                    if (factName === undefined || toCol === undefined)
                        continue;
                    const cls = classifyTable(model, factName);
                    if (cls.kind !== 'fact' || cls.confidence < 0.85)
                        continue;
                    const dCol = byTable.get(d.name)?.columns.find((c) => c.name === toCol);
                    if (!dCol)
                        continue;
                    factGrains.push({ fact: factName, toColumn: toCol, grain: grainOf(dCol) });
                }
                // Pair up: one clearly day-grain + another clearly coarse-grain, on
                // DIFFERENT to-columns. Point at the coarse fact.
                for (const a of factGrains) {
                    for (const b of factGrains) {
                        if (a.fact === b.fact)
                            continue;
                        if (a.toColumn === b.toColumn)
                            continue; // same key → never fire
                        if (a.grain !== 'day' || b.grain !== 'coarse')
                            continue;
                        const key = `${[a.fact, b.fact].sort().join('|')}|${d.name}`;
                        if (reported.has(key))
                            continue;
                        reported.add(key);
                        findings.push(violation('MOD019', 'warning', 'Modeling', `Table.${b.fact}`, {
                            message: `Facts "${a.fact}" and "${b.fact}" relate to date dimension "${d.name}" at apparently different grains ("${a.fact}" via day-level ${d.name}[${a.toColumn}], "${b.fact}" via coarser ${d.name}[${b.toColumn}]). Mixing grains can double-count or misalign totals — confirm the intended grains.`,
                            fix: 'Relate both facts at a consistent grain (e.g. a shared day key, or a dedicated month/period dimension for the coarse fact).',
                        }));
                    }
                }
            }
            return findings;
        },
    },
    {
        // MOD020 `dg4-te-fabric-desktop-root.xml:30697` — the one-side (to) column of
        // a relationship should be marked isKey. Skipped for m:m (bridge FK, not a
        // key) and date tables. Deduped per toTable[toColumn].
        id: 'MOD020',
        name: 'Relationship one-side column is not marked as a key',
        severity: 'info',
        category: 'Modeling',
        check: (model) => {
            const byTable = new Map(model.tables.map((t) => [t.name, t]));
            const findings = [];
            const seen = new Set();
            for (const r of model.relationships) {
                if (r.cardinality === 'manyToMany')
                    continue;
                const toTable = byTable.get(r.toTable);
                const toCol = toTable?.columns.find((c) => c.name === r.toColumn);
                if (!toCol)
                    continue;
                if (toCol.isKey)
                    continue;
                // Skip date tables (their date column is the natural key, often unmarked).
                const isDateDim = (toTable !== undefined &&
                    (isMarkedDateTable(toTable) ||
                        toTable.columns.some((c) => isTimeDataCategory(c.dataCategory) && isTemporalType(c.dataType)))) ||
                    looksLikeDateTableName(r.toTable);
                if (isDateDim)
                    continue;
                const key = `${r.toTable}[${r.toColumn}]`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                findings.push(violation('MOD020', 'info', 'Modeling', columnRefRaw(r.toTable, r.toColumn), {
                    message: `Relationship key ${key} (the one-side of a relationship) is not marked as a key column. Marking primary keys improves model clarity and some engine optimizations.`,
                    fix: 'Set isKey: true on the dimension key column.',
                }));
            }
            return findings;
        },
    },
    {
        // MOD021 `awesome-copilot-pbi-data.xml:18455, :11829-11839` — a one-to-one
        // relationship is rare; usually the two tables should be merged.
        id: 'MOD021',
        name: 'One-to-one relationship advisory',
        severity: 'info',
        category: 'Modeling',
        check: (model) => model.relationships
            .filter((r) => r.cardinality === 'oneToOne')
            .map((r) => violation('MOD021', 'info', 'Modeling', `Relationship.${r.id}`, {
            message: `One-to-one relationship ${r.fromTable}[${r.fromColumn}] ↔ ${r.toTable}[${r.toColumn}]. One-to-one is rare; consider consolidating the two tables into one unless this is a deliberate split (e.g. isolating sensitive/PII columns).`,
            fix: 'Merge the two tables, or confirm the 1:1 split is intentional.',
        })),
    },
    {
        // MOD022 `dg4-te-fabric-desktop-root.xml:30639` — broad numeric-summarizeBy
        // advisory (companion to MOD014). Same canonical source rule as MOD014
        // (`dg4:30639`), split by key-name: MOD014 owns key-named numeric columns,
        // MOD022 owns the rest. De-escalated to INFO (firing at error on every
        // Sales/Quantity would false-positive every model). Rolled up to ONE info
        // per table (listing the offending columns) so a wide fact doesn't emit a
        // dozen identical lines.
        id: 'MOD022',
        name: 'Numeric columns auto-aggregate (prefer explicit measures)',
        severity: 'info',
        category: 'Modeling',
        check: (model) => {
            const findings = [];
            for (const t of model.tables) {
                if (t.isHidden)
                    continue;
                const offenders = [];
                for (const c of t.columns) {
                    if (c.isHidden)
                        continue;
                    if (!isNumericType(c.dataType))
                        continue;
                    if (!c.summarizeBy || c.summarizeBy.toLowerCase() === 'none')
                        continue;
                    if (looksLikeKeyName(c.name))
                        continue; // MOD014 owns key-named columns.
                    offenders.push(c.name);
                }
                if (offenders.length === 0)
                    continue;
                const list = offenders.map((n) => `"${n}"`).join(', ');
                findings.push(violation('MOD022', 'info', 'Modeling', `Table.${t.name}`, {
                    message: `Table "${t.name}" has ${offenders.length} numeric column(s) with summarizeBy set (${list}), so they auto-aggregate implicitly. Prefer summarizeBy=None plus explicit DAX measures for control and AI/Copilot visibility.`,
                    fix: 'Set summarizeBy: none on these columns and add explicit measures (e.g. SUM).',
                }));
            }
            return findings;
        },
    },
    {
        // MOD023 `dg4-te-fabric-desktop-root.xml:30404-30411` — a measure uses
        // USERELATIONSHIP against a table that ALSO carries RLS; this errors at
        // visual-evaluation time. GATED: no roles ⇒ no finding.
        id: 'MOD023',
        name: 'USERELATIONSHIP against a table with row-level security',
        severity: 'error',
        category: 'Modeling',
        check: (model) => {
            if (!model.roles?.length)
                return [];
            const securedTables = securedTableSet(model);
            if (securedTables.size === 0)
                return [];
            const findings = [];
            for (const t of model.tables) {
                for (const m of t.measures) {
                    const expr = stripDaxComments(m.expression);
                    const hitTables = new Set();
                    for (const call of expr.matchAll(/\bUSERELATIONSHIP\s*\(([^)]*)\)/gi)) {
                        const args = call[1] ?? '';
                        for (const ref of args.matchAll(QUALIFIED_REF_RE)) {
                            const tableName = ref[2] ?? ref[3];
                            if (tableName && securedTables.has(tableName))
                                hitTables.add(tableName);
                        }
                    }
                    for (const tableName of hitTables) {
                        findings.push(violation('MOD023', 'error', 'Modeling', measureRef(m), {
                            message: `Measure ${measureRef(m)} uses USERELATIONSHIP against "${tableName}", which has row-level security; this errors when the measure is evaluated in a visual.`,
                            fix: 'Remove RLS from that table, or use a non-USERELATIONSHIP pattern (e.g. a separate physical date role) for the alternate relationship.',
                        }));
                    }
                }
            }
            return findings;
        },
    },
    {
        // MOD024 `dg4-te-fabric-desktop-root.xml:30165-30172` (+ dynamic pattern
        // :30248-30250) — a many-to-many relationship touching a table secured by
        // DYNAMIC RLS (USERNAME/USERPRINCIPALNAME predicate) degrades query
        // performance severely. GATED on roles. Calibrated to WARNING (degradation,
        // not breakage — consistent with MOD003/MOD013).
        id: 'MOD024',
        name: 'Many-to-many relationship on a dynamic-RLS table',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            if (!model.roles?.length)
                return [];
            const dynamicSecured = dynamicSecuredTableSet(model);
            if (dynamicSecured.size === 0)
                return [];
            const findings = [];
            for (const r of model.relationships) {
                if (r.cardinality !== 'manyToMany')
                    continue;
                const securedEndpoint = dynamicSecured.has(r.fromTable)
                    ? r.fromTable
                    : dynamicSecured.has(r.toTable)
                        ? r.toTable
                        : undefined;
                if (securedEndpoint === undefined)
                    continue;
                findings.push(violation('MOD024', 'warning', 'Modeling', `Relationship.${r.id}`, {
                    message: `Many-to-many relationship ${r.fromTable}[${r.fromColumn}] ↔ ${r.toTable}[${r.toColumn}] touches "${securedEndpoint}", which uses dynamic row-level security; this combination severely degrades query performance.`,
                    fix: 'Replace the m:m with a single dimension relating many-to-one to the security table.',
                }));
            }
            return findings;
        },
    },
    {
        // MOD025 `awesome-copilot-pbi-data.xml:18480-18481, :18605-18608`; vocab
        // `dg4:58066-58072` — a bidirectional relationship into a SECURED table can
        // let filters propagate around the RLS boundary (row leak). GATED on roles.
        // Complements MOD004 (both may fire).
        id: 'MOD025',
        name: 'Bidirectional cross-filter into a secured table',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            if (!model.roles?.length)
                return [];
            const securedTables = securedTableSet(model);
            if (securedTables.size === 0)
                return [];
            const findings = [];
            for (const r of model.relationships) {
                if (r.crossFilteringBehavior !== 'both')
                    continue;
                const securedEndpoint = securedTables.has(r.fromTable)
                    ? r.fromTable
                    : securedTables.has(r.toTable)
                        ? r.toTable
                        : undefined;
                if (securedEndpoint === undefined)
                    continue;
                findings.push(violation('MOD025', 'warning', 'Modeling', `Relationship.${r.id}`, {
                    message: `Bidirectional relationship ${r.fromTable}[${r.fromColumn}] ↔ ${r.toTable}[${r.toColumn}] crosses into "${securedEndpoint}", which has row-level security; bidirectional filtering can bypass the RLS boundary and leak rows.`,
                    fix: 'Set crossFilteringBehavior to single, or design the filter direction to match the secured propagation path.',
                }));
            }
            return findings;
        },
    },
    {
        // MOD026 `dg4-te-fabric-desktop-root.xml:30521-30527`,
        // `dg3-semantic-models.xml:402-406` — a visible object with no description
        // hurts AI/Copilot/Q&A discoverability. GATED (E1-style): if NO object
        // anywhere has a description, the convention isn't captured ⇒ silent.
        id: 'MOD026',
        name: 'Visible object has no description',
        severity: 'info',
        category: 'Maintenance',
        check: (model) => {
            if (!modelExpressesDescriptions(model))
                return [];
            const findings = [];
            const blank = (s) => !s || s.trim() === '';
            for (const t of model.tables) {
                if (t.isAutoDateTable)
                    continue;
                if (!t.isHidden && blank(t.description)) {
                    findings.push(violation('MOD026', 'info', 'Maintenance', `Table.${t.name}`, {
                        message: `Visible table "${t.name}" has no description; descriptions improve Q&A/Copilot accuracy and developer discoverability.`,
                        fix: 'Add a description (TMDL /// comment) explaining the table.',
                    }));
                }
                for (const col of t.columns) {
                    if (!col.isHidden && blank(col.description)) {
                        findings.push(violation('MOD026', 'info', 'Maintenance', columnRef(col), {
                            message: `Visible column "${col.name}" has no description.`,
                            fix: 'Add a description (TMDL /// comment) explaining the column.',
                        }));
                    }
                }
                for (const m of t.measures) {
                    if (!m.isHidden && blank(m.description)) {
                        findings.push(violation('MOD026', 'info', 'Maintenance', measureRef(m), {
                            message: `Visible measure "${m.name}" has no description.`,
                            fix: 'Add a description (TMDL /// comment) explaining what the measure computes.',
                        }));
                    }
                }
            }
            return findings;
        },
    },
    {
        // MOD027 `dg4-te-fabric-desktop-root.xml:29771-29778` — a table with >10
        // visible measures none of which are in a display folder is hard to browse.
        // GATED: if NO measure anywhere has a displayFolder, the convention isn't
        // captured ⇒ silent.
        id: 'MOD027',
        name: 'Table has many visible measures with no display folder',
        severity: 'info',
        category: 'Maintenance',
        check: (model) => {
            if (!modelExpressesMeasureDisplayFolders(model))
                return [];
            const findings = [];
            for (const t of model.tables) {
                const visible = t.measures.filter((m) => !m.isHidden);
                const unfoldered = visible.filter((m) => !m.displayFolder || m.displayFolder.trim() === '');
                if (unfoldered.length > 10) {
                    findings.push(violation('MOD027', 'info', 'Maintenance', `Table.${t.name}`, {
                        message: `Table "${t.name}" has ${unfoldered.length} visible measures with no display folder; group related measures into display folders for navigability.`,
                        fix: 'Assign displayFolder to related measures (e.g. "Sales KPIs", "Ratios").',
                    }));
                }
            }
            return findings;
        },
    },
    {
        // MOD028 `awesome-copilot-pbi-data.xml:11854-11857`,
        // `dg4-te-fabric-desktop-root.xml:19766-19769` — "Assume referential
        // integrity" forces an INNER join that silently drops fact rows with no
        // matching dimension key. Only meaningful on DirectQuery. DOUBLE-GATED on
        // the RI flag AND a DirectQuery endpoint ⇒ inert unless both captured.
        id: 'MOD028',
        name: 'Assume referential integrity into a DirectQuery source',
        severity: 'warning',
        category: 'Modeling',
        check: (model) => {
            const byTable = new Map(model.tables.map((t) => [t.name, t]));
            const findings = [];
            for (const r of model.relationships) {
                if (r.relyOnReferentialIntegrity !== true)
                    continue;
                const fromMode = byTable.get(r.fromTable)?.storageMode;
                const toMode = byTable.get(r.toTable)?.storageMode;
                if (fromMode !== 'directQuery' && toMode !== 'directQuery')
                    continue;
                findings.push(violation('MOD028', 'warning', 'Modeling', `Relationship.${r.id}`, {
                    message: `Relationship ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}] has "Assume referential integrity" enabled on a DirectQuery source; this uses an INNER join and silently drops fact rows with no matching dimension key.`,
                    fix: 'Disable Assume RI unless every fact key is guaranteed to exist in the dimension.',
                }));
            }
            return findings;
        },
    },
    {
        // DAX012 `dg4:30364` — EVALUATEANDLOG is a debugging function that must not
        // ship in production measures (it materializes and logs intermediate results).
        id: 'DAX012',
        name: 'EVALUATEANDLOG in a production measure',
        severity: 'warning',
        category: 'DAX',
        check: (model) => forEachMeasure(model, (m) => {
            const expr = stripDaxComments(m.expression);
            if (/\bEVALUATEANDLOG\s*\(/i.test(expr)) {
                return violation('DAX012', 'warning', 'DAX', measureRef(m), {
                    message: 'Measure uses EVALUATEANDLOG, a debugging function; remove it before shipping to production.',
                    fix: 'Delete the EVALUATEANDLOG wrapper, keeping its first argument.',
                });
            }
            return null;
        }),
    },
    {
        // DAX013 `dg4:30354` / `dg4:30360` — a `1-(x/y)` / `1±DIVIDE(...)` literal
        // pattern. The leading number±(SUM/DIVIDE) anchor avoids matching a plain
        // `measure - DIVIDE(...)`. May co-fire with DAX001 (intentional).
        id: 'DAX013',
        name: 'Literal-number divide syntax (1-(x/y) / 1±DIVIDE)',
        severity: 'warning',
        category: 'DAX',
        check: (model) => forEachMeasure(model, (m) => {
            const expr = stripDaxComments(m.expression);
            const sumForm = /[0-9]+\s*[-+]\s*\(*\s*SUM\s*\(\s*'?[A-Za-z0-9 _]+'?\s*\[[A-Za-z0-9 _]+\]\s*\)\s*\//i;
            const divideForm = /[0-9]+\s*[-+]\s*DIVIDE\s*\(/i;
            if (sumForm.test(expr) || divideForm.test(expr)) {
                return violation('DAX013', 'warning', 'DAX', measureRef(m), {
                    message: 'Measure mixes a literal number with a raw division (e.g. 1-(x/y) or 1-DIVIDE(...)); this is brittle when the denominator is blank/zero. Wrap the ratio in DIVIDE and handle the blank case explicitly.',
                    fix: 'Compute the ratio with DIVIDE(num, den) into a variable, then combine with the literal.',
                });
            }
            return null;
        }),
    },
    {
        // DAX014 `dg3-semantic-models.xml:1080-1101` — BLANK-suppression patterns
        // (`+0`, `COALESCE(...,0)`, `IF(ISBLANK(...),0,...)`) force a measure to
        // return 0 instead of BLANK, inflating SUMMARIZECOLUMNS result sets with
        // spurious all-zero rows. Advisory (sometimes intentional). The gated
        // exception `+ IF(NOT ISEMPTY(...),0)` does NOT match (P1 anchor excludes it).
        id: 'DAX014',
        name: 'BLANK-suppression (returns 0 instead of BLANK)',
        severity: 'warning',
        category: 'DAX',
        check: (model) => forEachMeasure(model, (m) => {
            const expr = stripDaxComments(m.expression).replace(/"(?:""|[^"])*"/g, ' ');
            const p1 = /\+\s*0\s*(\)|$)/;
            const p2 = /\bCOALESCE\s*\([^()]*,\s*0\s*\)/i;
            const p3 = /\bIF\s*\(\s*ISBLANK\s*\([^()]*\)\s*,\s*0\s*,/i;
            if (p1.test(expr) || p2.test(expr) || p3.test(expr)) {
                return violation('DAX014', 'warning', 'DAX', measureRef(m), {
                    message: 'Measure suppresses BLANK (returns 0 via +0 / COALESCE(...,0) / IF(ISBLANK,0,...)); if not intentional, this inflates SUMMARIZECOLUMNS result sets with spurious all-zero rows.',
                    fix: 'Let the measure return BLANK for empty groups; only coerce to 0 where a visual genuinely requires it.',
                });
            }
            return null;
        }),
    },
    {
        // FMT005 `dg4:29860` — a measure NAMED like a percentage (ends in
        // %/percent/percentage) whose format string has no `%`. "Rate" is DROPPED
        // (too unit-ambiguous — would flag Exchange/Interest Rate). FMT001 owns the
        // blank-format case.
        id: 'FMT005',
        name: 'Percentage-named measure has no % in its format string',
        severity: 'warning',
        category: 'Formatting',
        check: (model) => forEachMeasure(model, (m) => {
            if (m.isHidden)
                return null;
            if (!m.formatString || m.formatString.trim() === '')
                return null; // FMT001 owns blank.
            if (!looksLikePercentageMeasure(m.name))
                return null;
            if (m.formatString.includes('%'))
                return null;
            return violation('FMT005', 'warning', 'Formatting', measureRef(m), {
                message: `Measure "${m.name}" is named like a percentage but its format string "${m.formatString}" has no "%"; it will render as a raw number (e.g. 0.42 instead of 42%).`,
                fix: 'Use a percentage format string, e.g. 0.0%;-0.0%;0.0%.',
            });
        }),
    },
    {
        // FMT006 `dg4:30676` — a geography column with no dataCategory set; mapping
        // visuals can't place it. String country/continent/city names, or
        // decimal/double lat/long columns (prefix-gated by numeric type).
        id: 'FMT006',
        name: 'Geography column missing dataCategory',
        severity: 'info',
        category: 'Formatting',
        check: (model) => {
            const findings = [];
            for (const t of model.tables) {
                for (const c of t.columns) {
                    if (c.dataCategory && c.dataCategory.trim() !== '')
                        continue;
                    const lower = c.name.toLowerCase();
                    const isGeoString = isStringType(c.dataType) &&
                        (lower.includes('country') || lower.includes('continent') || lower.includes('city'));
                    // EXACT name match (not prefix) so "latency"/"longshore"/"long term
                    // value" don't false-positive — mirrors the mined source (dg4:30676
                    // uses `Name.ToLower() == "latitude"/"longitude"`, exact equality).
                    const isLatLong = ['decimal', 'double'].includes(normalizeDataType(c.dataType)) &&
                        /^(lat|long|latitude|longitude)$/i.test(lower);
                    if (isGeoString || isLatLong) {
                        findings.push(violation('FMT006', 'info', 'Formatting', columnRef(c), {
                            message: `Column "${c.name}" looks like geographic data but has no dataCategory; mapping visuals (filled map, ArcGIS) need a geography dataCategory to place it correctly.`,
                            fix: 'Set dataCategory (e.g. Country, City, Latitude, Longitude).',
                        }));
                    }
                }
            }
            return findings;
        },
    },
    {
        // FMT007 `dg4:30728-30733` — a string month column with no sortByColumn
        // sorts alphabetically (Apr, Aug, Dec...). Excludes "Months" (plural —
        // usually a count). Gated implicitly by sortByColumn capture (warning is
        // acceptable — degrades to "verify month sort").
        id: 'FMT007',
        name: 'String month column has no sortByColumn',
        severity: 'warning',
        category: 'Formatting',
        check: (model) => {
            const findings = [];
            for (const t of model.tables) {
                if (t.isAutoDateTable)
                    continue;
                for (const c of t.columns) {
                    if (!isStringType(c.dataType))
                        continue;
                    if (!/month/i.test(c.name))
                        continue;
                    if (/months/i.test(c.name))
                        continue;
                    if (c.sortByColumn && c.sortByColumn.trim() !== '')
                        continue;
                    findings.push(violation('FMT007', 'warning', 'Formatting', columnRef(c), {
                        message: `String month column "${c.name}" has no sort-by column; it will sort alphabetically (Apr, Aug, Dec...) instead of chronologically.`,
                        fix: 'Set sortByColumn to a numeric month-number column (1-12).',
                    }));
                }
            }
            return findings;
        },
    },
    {
        // E3 `dg4:30384-30391` — a calculated column with a blank expression errors
        // or shows no values (sibling of E2 for measures). GATED (E1-style): if NO
        // calc column anywhere has a non-empty expression, the convention isn't
        // captured ⇒ silent.
        id: 'E3',
        name: 'Calculated column has a blank expression',
        severity: 'error',
        category: 'ErrorPrevention',
        check: (model) => {
            const modelExpressesCalcColumns = model.tables.some((t) => t.columns.some((c) => c.isCalculated && c.expression && c.expression.trim() !== ''));
            if (!modelExpressesCalcColumns)
                return [];
            const findings = [];
            for (const t of model.tables) {
                for (const c of t.columns) {
                    if (!c.isCalculated)
                        continue;
                    if (!c.expression || c.expression.trim() === '') {
                        findings.push(violation('E3', 'error', 'ErrorPrevention', columnRef(c), {
                            message: `Calculated column "${c.name}" has a blank expression; it will error or show no values.`,
                            fix: 'Provide a DAX expression, or make it a data column with a sourceColumn.',
                        }));
                    }
                }
            }
            return findings;
        },
    },
    {
        // E4 `dg4:30446-30453` — a column with isAvailableInMDX=false that is the
        // target of (or itself carries) a sortByColumn errors in Excel/MDX clients
        // and breaks the dependent sort. Fires ONLY on an EXPLICIT false (undefined
        // ⇒ default true ⇒ safe). Hierarchy/variation half DEFERRED (not captured).
        id: 'E4',
        name: 'isAvailableInMDX=false on a sort-by target column',
        severity: 'error',
        category: 'ErrorPrevention',
        check: (model) => {
            const targets = new Set();
            for (const t of model.tables) {
                for (const c of t.columns) {
                    if (c.sortByColumn && c.sortByColumn.trim() !== '') {
                        targets.add(`${t.name}[${c.sortByColumn}]`);
                    }
                }
            }
            const findings = [];
            for (const t of model.tables) {
                for (const c of t.columns) {
                    if (c.isAvailableInMdx !== false)
                        continue; // only explicit false.
                    const isTarget = targets.has(`${t.name}[${c.name}]`);
                    const hasOwnSort = !!c.sortByColumn && c.sortByColumn.trim() !== '';
                    if (!isTarget && !hasOwnSort)
                        continue;
                    findings.push(violation('E4', 'error', 'ErrorPrevention', columnRef(c), {
                        message: `Column "${c.name}" has isAvailableInMDX=false but participates in a sort-by relationship; this errors in Excel/MDX clients and breaks the sort.`,
                        fix: 'Set isAvailableInMDX to true on this column.',
                    }));
                }
            }
            return findings;
        },
    },
    {
        // E5 `dg4:30435` — control characters in a measure description corrupt the
        // metadata/serialization. Uses a whitespace-EXCLUDING control set (Gotcha
        // #1/#2): tab/newline/CR are LEGAL in descriptions, so this must NOT reuse
        // hasControlChars (which would false-positive at error on every multi-line
        // description). Measure-only until M4 column/table descriptions land.
        id: 'E5',
        name: 'Control characters in a measure description',
        severity: 'error',
        category: 'ErrorPrevention',
        check: (model) => forEachMeasure(model, (m) => {
            if (m.description && NON_WS_CONTROL.test(m.description)) {
                return violation('E5', 'error', 'ErrorPrevention', measureRef(m), {
                    message: `Measure "${m.name}" has a description containing non-whitespace control characters; this corrupts TMDL/metadata serialization.`,
                    fix: 'Remove the control characters from the description.',
                });
            }
            return null;
        }),
    },
];
export function runBPA(model) {
    const out = [];
    for (const rule of BPA_RULES) {
        out.push(...rule.check(model));
    }
    // Impose a canonical, machine-independent order so the review output is
    // byte-identical run-to-run regardless of table-parse (filesystem) order. Sort by
    // (ruleId, object, message) — all model-derived strings, code-unit comparison.
    // The determinism guarantee no longer depends on the upstream parser's ordering.
    out.sort((a, b) => compareByName(a.ruleId, b.ruleId) ||
        compareByName(a.object, b.object) ||
        compareByName(a.message, b.message));
    return out;
}
function forEachMeasure(model, fn) {
    const out = [];
    for (const t of model.tables) {
        for (const m of t.measures) {
            const v = fn(m, t);
            if (v)
                out.push(v);
        }
    }
    return out;
}
function forEachExpressionObject(model, fn) {
    const out = [];
    for (const t of model.tables) {
        for (const m of t.measures) {
            const v = fn({
                table: m.table,
                name: m.name,
                expression: m.expression,
                isHidden: m.isHidden,
                kind: 'measure',
                object: measureRef(m),
            });
            if (v)
                out.push(v);
        }
        for (const c of t.columns) {
            if (!c.isCalculated)
                continue;
            if (!c.expression || c.expression.trim() === '')
                continue;
            const v = fn({
                table: c.table,
                name: c.name,
                expression: c.expression,
                isHidden: c.isHidden,
                kind: 'calcColumn',
                object: columnRefRaw(c.table, c.name),
            });
            if (v)
                out.push(v);
        }
    }
    return out;
}
function violation(ruleId, severity, category, object, body) {
    return {
        ruleId,
        severity,
        category,
        object,
        message: body.message,
        fix: body.fix,
    };
}
function measureRef(m) {
    return `'${m.table}'[${m.name}]`;
}
function columnRef(c) {
    return `'${c.table}'[${c.name}]`;
}
function columnRefRaw(table, column) {
    return `'${table}'[${column}]`;
}
function findColumn(table, columnName) {
    const normalized = normalizeName(columnName);
    return table.columns.find((column) => normalizeName(column.name) === normalized);
}
function normalizeName(name) {
    return name.trim().toLowerCase();
}
function stripDaxComments(expr) {
    return expr
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|\s)\/\/[^\n]*/g, '$1 ')
        .replace(/(^|\s)--[^\n]*/g, '$1 ');
}
function hasUserelationshipInCalculate(expr) {
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
        }
        else if (ch === ')') {
            if (inCalculate > 0 && depth === inCalculate)
                inCalculate--;
            depth--;
        }
        else if (ch === 'U' || ch === 'u') {
            const ahead = expr.slice(i, i + 17).toUpperCase();
            if (ahead.startsWith('USERELATIONSHIP')) {
                if (inCalculate === 0)
                    return false;
            }
        }
    }
    return true;
}
function countTopLevelCommas(s) {
    let depth = 0;
    let count = 0;
    for (const ch of s) {
        if (ch === '(')
            depth++;
        else if (ch === ')')
            depth--;
        else if (ch === ',' && depth === 0)
            count++;
    }
    return count;
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// --- helpers for the new (Tier 1-3) rules -------------------------------
// Every table that appears on either side of any relationship.
function relationshipEndpointTables(model) {
    const set = new Set();
    for (const r of model.relationships) {
        set.add(r.fromTable);
        set.add(r.toTable);
    }
    return set;
}
// MOD008 "looks deliberate" heuristic (info severity): a single-column table
// (parameter / what-if), a small calculated lookup (calc + <=2 cols + 0
// measures, e.g. a field-parameter or disconnected slicer source), or an
// auto-date table. Purely structural.
function isDeliberatelyDisconnected(table) {
    if (table.isAutoDateTable)
        return true;
    if (table.columns.length <= 1 && table.measures.length === 0)
        return true;
    if (table.isCalculated && table.columns.length <= 2 && table.measures.length === 0)
        return true;
    return false;
}
// Intrinsic (shape-only) fact-likeness for the MOD008 orphan check, where the
// relationship-based classifier cannot apply (an orphan has no edges): a table
// carrying measures and/or aggregatable quantity columns is a would-be fact.
function looksIntrinsicallyFactLike(table) {
    if (table.measures.length > 0)
        return true;
    return table.columns.some((c) => isNumericType(c.dataType) && !!c.summarizeBy && c.summarizeBy.toLowerCase() !== 'none');
}
// Same-named, non-key categorical (string) columns shared by two tables — the
// signal that a conformed dimension is missing (MOD010).
function sharedCategoricalColumnNames(a, b) {
    const aCols = new Map(a.columns.map((c) => [c.name, c]));
    const out = [];
    for (const c of b.columns) {
        const peer = aCols.get(c.name);
        if (!peer)
            continue;
        if (!isStringType(c.dataType) || !isStringType(peer.dataType))
            continue;
        if (c.isKey || peer.isKey)
            continue;
        if (looksLikeKeyName(c.name))
            continue;
        out.push(c.name);
    }
    return out;
}
function isTimeDataCategory(dataCategory) {
    return (dataCategory ?? '').toLowerCase() === 'time';
}
function isMarkedDateTable(table) {
    if (!isTimeDataCategory(table.dataCategory))
        return false;
    return table.columns.some((column) => column.isKey && isTemporalType(column.dataType));
}
function isDateTableCandidate(table) {
    if (isMarkedDateTable(table) || looksLikeDateTableName(table.name))
        return true;
    return table.columns.some((column) => isTimeDataCategory(column.dataCategory) && isTemporalType(column.dataType));
}
function dateTableSources(table) {
    const sources = [
        ...(table.expression !== undefined
            ? [{ kind: 'calculated', expression: table.expression }]
            : []),
        ...(table.partitionSources ?? []),
    ];
    const seen = new Set();
    return sources.filter((source) => {
        const key = source.expression?.replace(/\s+/g, ' ').trim() ?? '';
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
// CANONICAL Tabular-Editor ruleset name patterns (key/ID/year/postal/monthNo) —
// STRUCTURAL signals identifying identifier-like columns, NOT dataset-specific
// CANONICAL TE pattern for date-dimension table names — STRUCTURAL, not a
// dataset identifier. Used by MODB2.
function looksLikeDateTableName(name) {
    return /(^|[^a-z])(date|calendar|dates|dim\s*date)([^a-z]|$)/i.test(name);
}
// --- Wave 2 helpers (MOD017-028, DAX012-014, FMT005-007, E3-E5, NAM002) ---
// Qualified DAX reference matcher 'Table'[Col] / Table[Col]. Group 2 = quoted
// table name, group 3 = bare table name, group 4 = field. Shared by MOD023.
const QUALIFIED_REF_RE = /('([^']+)'|([A-Za-z_][\w .-]*))\[([^\]]+)\]/g;
// Time-intelligence function set (uppercase) for MOD018. Generic DAX tokens,
// not dataset fields. `\s*\(` (added at the call site) requires a function call.
const TIME_INTEL_FUNCTIONS = [
    'DATEADD',
    'SAMEPERIODLASTYEAR',
    'TOTALYTD',
    'TOTALQTD',
    'TOTALMTD',
    'DATESYTD',
    'DATESQTD',
    'DATESMTD',
    'PARALLELPERIOD',
    'DATESBETWEEN',
    'DATESINPERIOD',
    'PREVIOUSYEAR',
    'PREVIOUSQUARTER',
    'PREVIOUSMONTH',
    'PREVIOUSDAY',
    'NEXTYEAR',
    'NEXTQUARTER',
    'NEXTMONTH',
    'NEXTDAY',
    'STARTOFYEAR',
    'STARTOFQUARTER',
    'STARTOFMONTH',
    'ENDOFYEAR',
    'ENDOFQUARTER',
    'ENDOFMONTH',
    'OPENINGBALANCEYEAR',
    'OPENINGBALANCEQUARTER',
    'OPENINGBALANCEMONTH',
    'CLOSINGBALANCEYEAR',
    'CLOSINGBALANCEQUARTER',
    'CLOSINGBALANCEMONTH',
];
// E5 control-char set — Gotcha #1/#2: ESCAPE SEQUENCES (never raw bytes), and
// EXCLUDES whitespace (\t=09, \n=0a, \r=0d) which is legal in a description.
// Must NOT reuse hasControlChars (which would false-positive on multi-line text).
// biome-ignore lint/suspicious/noControlCharactersInRegex: detecting non-whitespace control chars in a description is exactly E5's job (written as \xNN escape sequences, never raw bytes).
const NON_WS_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
// NAM002 reserved-word branch — EXACTLY the 13-token canonical set (`dg4:29830`),
// no additions (MINE-DON'T-INVENT).
function isReservedWord(name) {
    return /^(DATE|TIME|YEAR|MONTH|DAY|HOUR|MINUTE|SECOND|NOW|TODAY|TRUE|FALSE|BLANK)$/i.test(name.trim());
}
// FMT005 — a measure named like a percentage. "Rate" deliberately DROPPED
// (`dg4:29860` calibration: too unit-ambiguous; would flag Exchange/Interest Rate).
function looksLikePercentageMeasure(name) {
    return /(%|percent|percentage)$/i.test(name.trim());
}
// MOD019 grain classification of a date-dimension column. Generic structural
// tokens (NOT dataset fields): day-grain if the type is temporal or the name
// reads like a date/day; coarse-grain if int64/string AND the name reads like a
// month/quarter/year/week/period.
function grainOf(col) {
    const name = col.name;
    if (isTemporalType(col.dataType) || /(^|[^a-z])(date|day)([^a-z]|$)/i.test(name))
        return 'day';
    if ((normalizeDataType(col.dataType) === 'int64' || isStringType(col.dataType)) &&
        /(^|[^a-z])(month|quarter|year|week|period)([^a-z]|$)/i.test(name)) {
        return 'coarse';
    }
    return 'unknown';
}
// MOD003 bridge test: a table is a bridge if it is the to-side of AT LEAST two
// relationships, has NO measures, and is thin (every column key-like/FK). Uses
// >= 2 (not exactly 2) so a legitimate 3-way junction still counts as a bridge
// and doesn't wrongly escalate a bidi m:m through it to error.
function isBridgeTable(model, tableName) {
    const table = model.tables.find((t) => t.name === tableName);
    if (!table)
        return false;
    if (table.measures.length > 0)
        return false;
    const toSideCount = model.relationships.filter((r) => r.toTable === tableName).length;
    if (toSideCount < 2)
        return false;
    return table.columns.every((c) => c.isKey ||
        looksLikeKeyName(c.name) ||
        (isNumericType(c.dataType) && (!c.summarizeBy || c.summarizeBy.toLowerCase() === 'none')));
}
// MOD002 role-playing helpers.
function samePair(a, b) {
    const ka = a.fromTable < a.toTable ? `${a.fromTable}|${a.toTable}` : `${a.toTable}|${a.fromTable}`;
    const kb = b.fromTable < b.toTable ? `${b.fromTable}|${b.toTable}` : `${b.toTable}|${b.fromTable}`;
    return ka === kb;
}
function columnPairSignature(r) {
    // Unordered column-pair signature so direction differences don't matter.
    const a = `${r.fromTable}[${r.fromColumn}]`;
    const b = `${r.toTable}[${r.toColumn}]`;
    return a < b ? `${a}~${b}` : `${b}~${a}`;
}
// RLS helpers (MOD023/024/025). securedTableSet = every table named in any role
// permission that carries a non-empty filter predicate (a static allow-all
// permission with '' filter does not restrict rows). dynamicSecuredTableSet =
// the subset whose predicate uses a user-context function.
function securedTableSet(model) {
    const set = new Set();
    for (const role of model.roles ?? []) {
        for (const perm of role.tablePermissions) {
            if (perm.filterExpression.trim() !== '')
                set.add(perm.table);
        }
    }
    return set;
}
function dynamicSecuredTableSet(model) {
    const set = new Set();
    for (const role of model.roles ?? []) {
        for (const perm of role.tablePermissions) {
            if (perm.filterExpression.trim() !== '' &&
                /\b(USERNAME|USERPRINCIPALNAME)\s*\(/i.test(perm.filterExpression)) {
                set.add(perm.table);
            }
        }
    }
    return set;
}
// MOD026/MOD027 "convention expressed" guards (mirror E1's modelExpressesSources)
// so a missing/incomplete live capture yields SILENCE, never a false positive.
function modelExpressesDescriptions(model) {
    return model.tables.some((t) => (t.description && t.description.trim() !== '') ||
        t.columns.some((c) => c.description && c.description.trim() !== '') ||
        t.measures.some((m) => m.description && m.description.trim() !== ''));
}
function modelExpressesMeasureDisplayFolders(model) {
    return model.tables.some((t) => t.measures.some((m) => m.displayFolder && m.displayFolder.trim() !== ''));
}
// MOD017's edge-disjoint path detector (edgeDisjointDirectedPaths /
// pathsDifferByIntermediate) now lives in field-index.ts and is imported above,
// so the pre-write diamond gate (relationship-check.ts) can share the EXACT same
// directed detector without importing bpa.ts (which would cycle).
function hasLeadingTrailingSpace(name) {
    return name !== name.trim();
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are exactly what NAM002 detects in object names.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
function hasControlChars(name) {
    return CONTROL_CHARS.test(name);
}
function hasFactDimPrefix(name) {
    // Separator-delimited ("Fact Sales", "dim_product") or camelCase
    // ("FactSales", "DimProduct"). Prefix matched case-insensitively; the
    // camelCase form additionally requires a following uppercase letter.
    // camelCase branch is CASE-SENSITIVE: an `i` flag would make `[A-Z]` match
    // lowercase too, falsely flagging "Dimension"/"Factory". Only `DimX`/`FactX` match.
    return /^(fact|dim|dimension)[\s_]/i.test(name) || /^(Fact|Dim)(?=[A-Z])/.test(name);
}
// Special characters discouraged in object names (allow letters, digits, space,
// underscore, %, parentheses, and the common business connectors `&` and `/` —
// "Profit & Loss", "A/B Test", "Sales (USD)" are normal friendly names).
function hasSpecialChars(name) {
    return /[!@#$^*+=<>{}\[\]|\\~`]/.test(name);
}
function buildNameSets(model) {
    const measureNames = new Set();
    const columnNames = new Set();
    const columnRefs = new Set();
    for (const t of model.tables) {
        for (const m of t.measures)
            measureNames.add(m.name);
        for (const c of t.columns) {
            columnNames.add(c.name);
            columnRefs.add(`${t.name}[${c.name}]`);
        }
    }
    return { measureNames, columnNames, columnRefs };
}
function columnTableFor(model, columnName) {
    for (const t of model.tables) {
        if (t.columns.some((c) => c.name === columnName))
            return t.name;
    }
    return undefined;
}
// Blank out all table-qualified references ('T'[c] / T[c]) so a follow-up scan
// for bare [x] only sees unqualified references (mirrors DAX005's approach).
function blankOutQualifiedRefs(expr) {
    return expr.replace(/('[^']+'|[A-Za-z_][\w .-]*)\[[^\]]+\]/g, ' ');
}
function normalizeDax(expr) {
    return (stripDaxComments(expr)
        .replace(/\s+/g, ' ')
        // Drop incidental whitespace around structural tokens so duplicates that
        // differ only by spacing (e.g. "SUM( X )" vs "SUM(X)") still match. This
        // is whitespace-only normalization — it never alters identifiers/literals.
        .replace(/\s*([(),[\]])\s*/g, '$1')
        .trim()
        .toLowerCase());
}
//# sourceMappingURL=bpa.js.map