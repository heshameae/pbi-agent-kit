# Banking KPI Guidance

This is a dataset-agnostic question bank, not a formula library. Banking terms often have regulatory, product, entity, currency, and period-specific definitions. Never infer a formula from a KPI name, field name, or common industry usage; use these prompts to confirm measure intent, data dictionary/glossary meaning, and model evidence.

Use `draft` for unconfirmed interpretations. Only mark a banking KPI `confirmed` when the user or governed data dictionary/glossary supplies the business definition and live model discovery proves the referenced fields. If an answer could change the number, return `needs-user-input` with clarifying questions before measure or visual writes.

## Core Questions

- What decision does the KPI support, and who owns the definition?
- Which model-confirmed source refs support the numerator, denominator, filters, and grain?
- Is the definition group, entity, branch, product, customer, account, or transaction level?
- Which currency, exchange-rate policy, consolidation scope, and elimination policy applies?
- Which reporting basis applies: management, statutory, regulatory, risk, finance, or operations?
- Does the metric use point-in-time balance, average balance, flow over period, or rolling window?
- Are targets, RAG thresholds, and peer benchmarks confirmed or still draft?
- Are period comparisons calendar-based, fiscal, regulatory reporting periods, or business days?

## KPI Question Bank

| Topic | Clarify before planning formulas or visuals |
|---|---|
| CASA | Which deposit products count as current or savings accounts? Are zero-balance, dormant, blocked, sweep, and intercompany accounts included? Is the grain account, customer, branch, or product? |
| NIM / NIMS | Which income and expense components are included? Is the denominator average earning assets, average assets, or another confirmed base? Does the definition use management FTP, statutory interest, or regulatory treatment? |
| Customer advances | Which lending products count as advances? Are accrued interest, provisions, write-offs, off-balance exposures, and related-party balances included? Is the metric gross, net, funded, outstanding, or disbursed? |
| Customer deposits | Which deposit classes are customer deposits versus bank/intercompany/funding balances? Are margin deposits, escrow, dormant, restricted, and foreign-currency balances included? |
| Net impairment | Which impairment stages, write-offs, recoveries, overlays, and model adjustments are included? Is the sign convention expense-positive or income-positive? |
| Net CoR | What exposure base is used, what annualization policy applies, and are recoveries, write-backs, overlays, and exceptional items included? |
| FTP | Which funds-transfer-pricing curve, product mapping, repricing tenor, liquidity premium, and effective-date policy applies? Is FTP a source measure, adjustment, or allocation? |
| STP | What counts as straight-through processing: no manual touch, no repair queue, no exception, or same-day completion? What is the event grain and cutoff window? |
| Payments / collections | Which channels, statuses, reversals, fees, failed items, duplicate attempts, and settlement dates count? Are payments and collections customer-facing, operational, or accounting events? |
| Transactions | What is a transaction for this dashboard: authorization, posting, settlement, ledger entry, or customer-visible event? How are reversals, duplicates, and fees handled? |
| Headcount | Is the source HR, finance, or operations? Are contractors, vacancies, secondees, outsourced roles, part-time FTE, and transfers included? Which effective-date policy applies? |
| Regulated reporting | Which report, jurisdiction, filing calendar, signoff owner, lineage evidence, and control status applies? Are draft management KPIs allowed, or must visuals use only confirmed regulatory definitions? |

## Ambiguity Traps

- Same label, different owners: finance, risk, treasury, and operations may use the same KPI name for different definitions.
- Balance versus flow: a field that looks monetary may be a point-in-time balance, movement, average, or adjustment.
- Sign conventions: impairments, recoveries, provisions, and FTP charges may reverse sign across source systems.
- Time policy: value date, posting date, booking date, settlement date, and reporting date can all be valid and produce different results.
- Entity scope: branch, legal entity, group, product, segment, and regulatory perimeter can change both source refs and filters.

## Output Discipline

Record unresolved banking definitions as `draft` measure intent with specific `clarifyingQuestions`. Do not write measures, targets, RAG thresholds, or time-intelligence comparisons from draft intent. Once the user confirms the definition and live discovery validates the source refs, mark the measure intent `confirmed`.
