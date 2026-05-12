---
description: Scaffold, inspect, and validate Power BI report (.pbip) projects. Use when the user wants to create a new Power BI report, scaffold a .pbip, start a new dashboard, get information about an existing report, or run PBIR validation. Trigger phrases include "new report", "scaffold report", "create dashboard", "validate report", "report info", "what's in this .pbip", "PBIR structure", "fix PBIR errors".
allowed-tools: mcp__pbi-report__pbi_report_create mcp__pbi-report__pbi_report_info mcp__pbi-report__pbi_report_validate mcp__pbi-report__pbi_page_list
---

# Power BI Report Skill

For top-level report operations against PBIR (.pbip) projects.

## When to invoke each tool

| User says... | Use |
|---|---|
| "Create a new report named X" | `pbi_report_create` with `targetPath` (where) and `name: X` |
| "What's in this .pbip?" / "show me the report" | `pbi_report_info` (auto-detects path from cwd) |
| "Is the report valid?" / "check the structure" | `pbi_report_validate` — returns errors/warnings/info |

## Scaffolding a report

`pbi_report_create` writes a complete Desktop-compatible `.pbip` project:

```
<targetPath>/<name>.pbip
<targetPath>/<name>.Report/...
<targetPath>/<name>.SemanticModel/...   (only when datasetPath is omitted)
<targetPath>/<name>.Report/StaticResources/SharedResources/BaseThemes/CY26SU02.json
```

- Pass `datasetPath: "../Existing.SemanticModel"` to point at an existing model
- Omit `datasetPath` to scaffold a blank model alongside (gives Desktop something to open)

## Validation tiers

`pbi_report_validate` runs three tiers:
1. Structural — folder layout, required files
2. Schema — required fields per file type, displayOption values, name lengths
3. Cross-file — pageOrder ↔ folder consistency, visual-name uniqueness per page

Treat `errors` as blocking, `warnings` as fix-soon, `info` as informational.

## Common follow-ups

After creating a report, the user usually wants to:
1. Add pages → see `pbi-pages` skill
2. Add visuals → see `pbi-visuals` skill
3. Validate → `pbi_report_validate`

## Paths

If the user doesn't specify a `--path`, the MCP tools auto-detect from cwd (walk up looking for `*.Report/definition/report.json` or a `.pbip` sibling). Tell the user when you've auto-detected, so they can correct if needed.
