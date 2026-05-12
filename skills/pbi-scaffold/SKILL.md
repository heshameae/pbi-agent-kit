---
description: Scaffold a new Power BI report project (.pbip + .Report + blank .SemanticModel) in the current directory.
disable-model-invocation: true
arguments: [name]
argument-hint: <report-name>
allowed-tools: mcp__pbi-report__pbi_report_create mcp__pbi-report__pbi_report_validate
---

# /pbi-scaffold $name

Scaffold a complete .pbip project named `$name` in the current working directory.

## Instructions

1. If `$name` is empty/missing, ask the user for a name and stop.
2. Call:
   ```
   mcp__pbi-report__pbi_report_create({
     targetPath: <cwd>,
     name: $name
   })
   ```
3. Confirm the file layout with `mcp__pbi-report__pbi_report_validate` against the new `<name>.Report/` — it should be valid with zero errors.
4. Print a one-line confirmation:
   ```
   ✓ Scaffolded $name.pbip in <cwd>. Open it in Power BI Desktop to verify.
   ```
5. Suggest one obvious next step (e.g. "Want to add a page? Use the pbi-pages skill.").
