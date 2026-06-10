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

Report/page/visual tools write PBIR files on disk. If Power BI Desktop is already open on the same `.pbip`, do not tell the user to press Ctrl+S after report-tool writes; that can overwrite the disk changes from Desktop's stale in-memory state. Tell the user to close/reopen or reload the `.pbip` first, then save only future Desktop edits.

For semantic-model follow-ups ("review the model", "join these tables", "create relationships", "fix measures"), route to `model-reviewer` or `model-builder` and keep the work live-first. Do not pass the sibling `.SemanticModel` path as `folderPath` just because report discovery found it; while Desktop is open, model tools should omit `folderPath` so edits land in the live in-memory model and appear immediately. Use `folderPath` only for true headless/offline work after no live Desktop instance is available.

Never use Python, Python one-liners, shell byte patches, or direct file surgery for pbi-mcp-ts operations, including data-range inspection, semantic-model/report fixes, TMDL/PBIP changes, or CSV probing. If a model/report operation is not supported by the MCP tool surface, route to the correct agent or report it as unsupported instead of patching files.

## Paths

If the user doesn't specify a `--path`, the MCP tools auto-detect from cwd (walk up looking for `*.Report/definition/report.json` or a `.pbip` sibling). Tell the user when you've auto-detected, so they can correct if needed.
