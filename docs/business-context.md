# Business Context (starter)

A freeform place to tell the assistant what your data means, so it writes better measures and checks. Optional but recommended.

Copy this into `business-context.md` (or `.pbi-agent-kit/business-context.md`) in your own project, fill it in, and reference it from your project `CLAUDE.md` so it loads every session. It gives meaning only; the assistant still checks the live model to prove a field exists before using it. Pair it with the structured `.pbi-agent-kit/data-dictionary.yaml` (see [data-dictionary.md](data-dictionary.md)).

## What we do
One or two lines on the business or domain, and who uses these reports.

## Audience and decisions
Who reads the reports and what decisions they make from them.

## Key KPIs
The metrics that matter, and how the business defines each one in plain words (for example, what counts as "active", which sales are "net").

## Terminology
Acronyms and terms, and what they mean here.

## Calendar
Fiscal year start, week definition, and any period conventions (for example, fiscal vs calendar reporting).

## Conventions
Naming, units, currency, rounding, and what "good" looks like.

## Caveats
Known data quality issues, gaps, or things to watch out for.
