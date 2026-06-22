---
description: Create an optional .pbi-agent-kit/data-dictionary.yaml business-context file from a dataset-agnostic template, then fill it via clarifying questions. Business meaning only; live MCP tools still prove field existence.
allowed-tools: Read, Write, AskUserQuestion
disable-model-invocation: true
---

# /pbi-init-data-dictionary

Create the optional, project-local business-context file and help the user fill it. This file carries **business meaning only** (term definitions, owners, measure intent). It never proves that a table, column, or measure exists — live MCP model tools do that.

## Instructions

1. **Resolve the project root** — the user's Power BI project folder (where their `*.pbip` file or `*.SemanticModel` directory lives). The target file is `<project-root>/.pbi-agent-kit/data-dictionary.yaml`.

2. **Never overwrite.** If `.pbi-agent-kit/data-dictionary.yaml` already exists, do NOT modify it. Report its path and stop — offer to review or extend it instead.

3. **Write the template.** Create the `.pbi-agent-kit/` directory if needed and write `data-dictionary.yaml` from the dataset-agnostic template below. Keep every entry `status: draft` and keep all placeholders. Do NOT infer business definitions, owners, or `sourceRefs` from table/column names — placeholders stay until the user (or governed context) supplies real values.

   ```yaml
   version: 1
   status: draft
   owners:
     - id: <owner-id>
       label: <owner-name-or-team>

   terms:
     - id: <term-id>
       status: draft
       label: <business-term>
       definition: <plain-language-business-meaning>
       owner: <owner-id>
       sourceRefs:
         - <Table[Field]>
       grain: <business-grain>
       caveats:
         - <known-ambiguity-or-policy>

   measureIntents:
     - name: <proposed-measure-name>
       status: draft
       owner: <owner-id>
       definition: <business-definition-of-the-number>
       sourceRefs:
         - <Table[Field]>
       grain: <evaluation-grain>
       additivity: <additive|semi-additive|non-additive|unknown>
       filters:
         - <business-filter-or-scope>
       format:
         unit: <currency|percent|count|duration|other>
         formatString: <power-bi-format-string>
       timeIntelligence:
         required: false
         datePolicy: <calendar|fiscal|none|unknown>
         incompletePeriod: <include|exclude|needs-confirmation>
       caveats:
         - <calculation-risk-or-open-question>
   ```

4. **Fill it via clarifying questions.** Use `AskUserQuestion` to capture only the **unobservable business choices** a model cannot reveal: the business term/measure name and definition, the owner, the business grain, additivity, allocation / missing-target behavior, date policy (calendar/fiscal), and the status (`draft` | `confirmed` | `deprecated`). Reuse the project's clarifying-question rules:
   - A term or measure intent stays `draft` (and any dependent spec stays `needs-user-input`) until the user, domain owner, or governed spec confirms the meaning.
   - Do NOT assert that any field exists. Leave `sourceRefs` as placeholders or set them only to refs the user explicitly confirms; live MCP model tools must still verify field existence before any write.
   - Flip `status: confirmed` only on explicit user/owner confirmation. Use `deprecated` for retired-but-documented terms.

5. **Non-interactive fallback.** If clarifying questions are not possible (e.g. a non-interactive run), write the placeholder template with all entries left `draft` and stop, telling the user to fill it later or re-run interactively.

## Governance note (surface this to the user)

Treat the data dictionary as **governed business content**. It can hold sensitive or PII-adjacent definitions. The plugin never commits it, and this repo's `.gitignore` does not travel to the user's project — so the user must decide deliberately whether to commit `.pbi-agent-kit/data-dictionary.yaml` in their own source control, and avoid putting confidential values in it.
