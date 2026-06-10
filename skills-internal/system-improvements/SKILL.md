---
name: system-improvements
description: Local development maintenance for pbi-mcp-ts. Use when a behavior, guard, planner, workflow, agent rule, skill rule, clarifying-question policy, or deterministic Power BI modeling/reporting gate is added, changed, reverted, contradicted, or superseded and docs/system-improvements.md must be updated. Triggers on system improvements, capture this learning, update improvement log, behavior hardening, deterministic gate, semantic clarification gate, clarifying questions, prompt failure, agent workflow fix, or Power BI best-practice guard.
---

# System Improvements

Maintain `docs/system-improvements.md` as the concise source of truth for pbi-mcp-ts behavior and logic hardening.

## Scope

- This local development skill lives under `skills/`; beta packaging may expose only selected user-facing skills.
- Use it only for local development maintenance of `docs/system-improvements.md`.
- Do not use it for ordinary report authoring, model authoring, model review, or visual editing.
- Update only `docs/system-improvements.md` unless the user asks for related code or docs changes.
- Keep entries dataset-agnostic. Never add demo table, column, or measure names.

## Workflow

1. Read `docs/system-improvements.md`.
2. Decide whether the learning is new, corrective, contradictory, or superseding.
3. Update the existing row when possible.
4. Delete stale or contradicted rows instead of keeping history noise.
5. Add a new row only when no existing row covers the behavior.
6. Include reference files for every row.
7. Keep text short: area, improvement, why, references.

## Rules

- Do not use Python.
- Do not add long narratives, recaps, or meeting notes.
- Do not duplicate an existing improvement under a new name.
- If implementation is not verified, say `planned` or `unverified` in the row.
- If a later change reverses a decision, replace the old row with the current behavior.
- Production behavior described here must stay dataset-agnostic.

## Output

After editing, report:

- Rows added
- Rows updated
- Rows deleted
- Verification run, if any
