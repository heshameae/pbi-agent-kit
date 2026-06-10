DONT HARDCODE ANYTHING ESPECIALLY FIELDS FROM DATASETS OR ANYTHING - ALL OUR WORK SHOULD BE GENERALIZED AND SCALABLE AND SHOULD WORK FOR ANY DATASET OUT THERE. YOU AR FORBIDDEN FROM HARDCODING ANYTHING.

The production fix MUST BE ALWAYS dataset-agnostic.

Never use Python for pbi-mcp-ts operations. Do not use `python`, `python3`, `pip`, or Python one-liners to inspect data ranges, parse files, rewrite, patch CRLF, or mutate `.SemanticModel`, `.Report`, `.tmdl`, `.pbip`, CSV, or other Power BI project artifacts. Use the TypeScript MCP tools, deterministic planners, and repo-native Node/TypeScript tooling; if the tool surface cannot do it, stop and report the unsupported operation.

When behavior/logic hardening changes, deterministic gates, agent/skill rules, clarifying-question policy, or Power BI workflow learnings are added, changed, contradicted, or superseded, use the local `skills-internal/system-improvements` skill (read its SKILL.md and follow it; it is kept out of the auto-scanned beta surface) to update `docs/system-improvements.md`. Keep entries short, dataset-agnostic, and reference-backed; update or delete stale rows instead of appending duplicates.
