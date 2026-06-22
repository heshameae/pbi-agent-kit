# Optional Data Dictionary

Use a data dictionary when the agent needs business meaning that is not reliably encoded in the semantic model. The recommended project-local path is:

```text
.pbi-agent-kit/data-dictionary.yaml
```

> **Quick start:** run `/pbi-init-data-dictionary` to create this file from the template below and fill it via clarifying questions. When the file is absent in a Power BI project, a non-blocking SessionStart reminder also points you to that command (silence it with `PBI_AGENT_KIT_NO_DICT_REMINDER=1`).
>
> **Governance:** treat the dictionary as governed business content — it can hold sensitive or PII-adjacent definitions. The plugin never commits it, and this repo's `.gitignore` does not travel to your project, so decide deliberately whether to commit `.pbi-agent-kit/data-dictionary.yaml` in your own source control, and avoid putting confidential values in it.

The file is optional. Do not block model discovery, analysis, or reporting work just because it is absent. When it is present, treat it as business context only: it can explain what a term means, who owns it, and whether an intended measure definition is draft or confirmed. It does not prove that a table, column, or measure exists. Live MCP model tools must still verify field existence and canonical refs before any write.

## Status Model

Use `draft` for unresolved language, candidate mappings, or proposed measure intent. Use `confirmed` only when the user, domain owner, governed spec, or accepted project context has confirmed the meaning. A ready write plan must not depend on draft business meaning.

`deprecated` is allowed for business terms that remain documented for history but should not be used for new plans.

## Dataset-Agnostic Template

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

Keep placeholders until live model tools or the user provide real dataset-specific values. Do not infer business definitions from table or column names alone.
