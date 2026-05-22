---
name: lineage-analysis
description: "Use when discovering downstream reports connected to a semantic model, auditing model impact before changes, identifying orphaned reports, or mapping cross-workspace dependencies"
user-invocable: false
---

# Lineage Analysis

Trace downstream dependencies from a semantic model to all connected reports across the tenant. No admin permissions required — workspace contributor access is sufficient.

## When to Use

- Before modifying or deleting a semantic model, to understand impact
- Auditing which reports are connected to a model and where they live
- Identifying orphaned or test reports connected to production models
- Cross-workspace dependency mapping

## When NOT to Use

- Auditing DAX measure quality or model design — use `pbi-model-doctor` or `modeling-semantic-model`
- Refreshing or scheduling semantic models — that is a separate concern
- Impact analysis across dataflows, notebooks, or other non-report Fabric items — see the note on full dependency mapping below

## What Downstream Discovery Covers

Downstream discovery finds all Power BI reports in workspaces the caller can access that are bound to the target semantic model (matched by `datasetId`). Results are grouped by workspace. With contributor access across ~100 workspaces, this typically completes in under 10 seconds.

## What It Does NOT Discover

A semantic model can be consumed by item types beyond Power BI reports. The downstream report scan does **not** discover:

- Analyze in Excel workbooks (`.xlsx` live connections)
- Composite models (other semantic models chaining via DirectQuery)
- Explorations (ad-hoc visual explorations in the Power BI service)
- Fabric notebooks (connecting via Spark or sempy)
- Fabric data agents
- Paginated reports (`.rdl`)
- Dataflows referencing the model
- Third-party tools connecting via XMLA

## Result Interpretation

| Field | Meaning |
|-------|---------|
| Report format `PBIR` | Modern format, editable as JSON |
| Report format `PBIRLegacy` | Legacy format, needs conversion to PBIR for direct editing |
| Reports in unexpected workspaces | May indicate copies, forks, or thin reports pointing at a shared model |
| Many downstream reports | High-impact model — changes require coordination |

## Full Dependency Mapping

For dependency mapping that includes all item types listed above (not just Power BI reports), use the Fabric lineage APIs (`fab api "admin/groups/{id}/lineage"`) or the lineage view in the Power BI service UI.

For bulk lineage analysis across many models simultaneously, use the admin scan APIs (`admin/workspaces/getInfo`) rather than per-model queries — running per-model queries in a loop over dozens of models generates excessive API calls and risks throttling.

## Architecture Note

The source reference for this skill includes a Python script (`scripts/get-downstream-reports.py`) for REST API-based lineage scanning. This project uses MCP tools rather than Python REST scripts. MCP-based lineage tooling for this project is TBD. In the interim, the Fabric lineage view in the Power BI service UI is the recommended path for interactive dependency investigation.
