# Measure Intent Contract

Every model measure must be grounded in a confirmed business definition before DAX is written. Correct DAX for the wrong business definition is still wrong.

## Gate

No confirmed measure intent means no measure write. A `draft` intent may be captured during planning, but it belongs in a `DashboardSpec` with `status: "needs-user-input"` and `clarifyingQuestions`; it must not be treated as ready implementation input. A `confirmed` intent is the minimum input for `pbi_measure_create` or `pbi_measure_update`.

Use live model metadata plus confirmed business evidence. Valid business evidence can be direct user confirmation, domain-owner confirmation, a governed spec, or a supplied business data dictionary/glossary. Live model inventory tools prove model objects and canonical references exist; they do not prove business meaning by themselves.

## Required Evidence

For each planned measure, capture:

- `name`: user-facing measure name.
- `owner`: business owner or accountable stakeholder when known.
- `definition`: business definition in words, not only DAX.
- `sourceRefs`: model-confirmed table, column, and measure refs such as `Table[Field]`.
- `grain`: calculation grain and expected visual grain.
- `additivity`: additive, semi-additive, non-additive, ratio, snapshot, or other confirmed behavior.
- `filters`: included/excluded populations, status filters, currency/scenario filters, and other required business scope.
- `format` / `unit`: currency, count, percent, basis points, days, or other confirmed unit.
- `caveats`: exclusions, known limitations, and reconciliation notes.
- `timeIntelligence`: required when the measure uses time-intelligence semantics.

## No-Assumption Rule

Never infer a formula from table names, field names, banking vocabulary, existing workaround DAX, sample values, or a likely domain convention. If confirmed business evidence is absent, ask instead of writing; a data dictionary/glossary is recommended context, not a required file. If the dictionary/glossary says only `draft`, or if the model contains similarly named fields, ask which source is authoritative rather than choosing silently.

## Time-Intelligence Confirmation

Before writing time-intelligence measures, confirm:

- Base measure intent and source refs are confirmed.
- Date policy is confirmed: observed fact range, full calendar/fiscal years, explicit future horizon, or user-specified range.
- Date table proof exists from governed model tools, and the Date table is marked or can be marked safely.
- Date grain proof exists where the write depends on daily, monthly, fiscal-period, or incomplete-period behavior.
- Fiscal/calendar policy, year start, week policy, and incomplete-period behavior are explicit.
- Blank, zero, carry-forward, or allocation behavior is confirmed for missing periods.

If any item is missing and it could change the result, return `needs-user-input` with concise clarifying questions.

## Responsibilities

- `data-analyst` owns draft dictionary and measure intent planning, then marks each item `draft` or `confirmed`.
- `model-builder` writes only from confirmed measure intent and refuses draft or inferred formulas.
- `report-builder` binds visuals only to confirmed metrics, targets, and RAG semantics.
- `model-reviewer` treats missing confirmed business evidence as semantic readiness risk, not a structural model error.
