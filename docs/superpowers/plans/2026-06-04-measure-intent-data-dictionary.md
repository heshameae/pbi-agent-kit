# Measure Intent and Data Dictionary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude Code plugin workflow that grounds all measure generation in confirmed business intent, optional data dictionaries, and live model metadata before any KPI or DAX measure writes.

**Architecture:** Keep banking knowledge in skills/references as dataset-agnostic guidance, add a read-only model dictionary projection for deterministic field grounding, and extend `DashboardSpec` with optional measure-intent evidence. Builders remain write-side agents; `data-analyst` owns planning, draft dictionaries, and confirmed measure intent.

**Tech Stack:** TypeScript, Zod, MCP SDK, Vitest, Claude Code plugin skills/agents.

---

## File Structure

- `packages/core/src/modeling/data-dictionary.ts`: pure projection from `TMDLModel` to canonical model dictionary metadata.
- `packages/core/tests/modeling/data-dictionary.test.ts`: TDD coverage for visible/default output, hidden/expression options, and canonical refs.
- `packages/mcp/src/server.ts`: read-only `pbi_data_dictionary_get` tool and modeling-only surface inclusion.
- `packages/mcp/tests/tool-registry.test.ts`: registry coverage for the new tool and modeling beta exposure.
- `packages/mcp/tests/model-list-tools.test.ts`: MCP invocation coverage over fixture models.
- `packages/core/src/types/spec.ts`: optional measure intent and business term contracts.
- `packages/core/tests/types/spec.test.ts`: schema tests for draft vs confirmed measure intent.
- `skills/authoring-measures/references/measure-intent-contract.md`: general measure intent and time-intelligence contract.
- `skills/planning-dashboards/references/banking-kpi-guidance.md`: banking/regulatory KPI vocabulary and ambiguity guide.
- `docs/data-dictionary.md`: optional user-owned business glossary template.
- Existing skills/agents/docs/tests: wire the no-assumption rule, dictionary behavior, and measure intent gate.

---

### Task 1: Core Read-Only Model Dictionary Projection

**Files:**
- Create: `packages/core/src/modeling/data-dictionary.ts`
- Modify: `packages/core/src/modeling/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/modeling/data-dictionary.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for `buildDataDictionary(model, options)`:
- default output excludes hidden columns/measures and excludes expressions
- `includeHidden` includes hidden fields
- `includeExpressions` includes DAX expressions
- canonical refs are `Table[Field]`

Run: `pnpm --filter pbi-core test -- tests/modeling/data-dictionary.test.ts`
Expected: FAIL because `data-dictionary.ts` does not exist.

- [ ] **Step 2: Implement projection**

Create a pure function with no I/O and no business inference:
- accepts `TMDLModel`
- returns counts, tables, fields, measures, relationships
- treats missing metadata as absent/unknown, not false
- never reads rows or executes DAX

- [ ] **Step 3: Export from core**

Export the function and types through `packages/core/src/modeling/index.ts` and `packages/core/src/index.ts`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter pbi-core test -- tests/modeling/data-dictionary.test.ts`
Expected: PASS.

---

### Task 2: MCP `pbi_data_dictionary_get` Tool

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Test: `packages/mcp/tests/tool-registry.test.ts`
- Test: `packages/mcp/tests/model-list-tools.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that:
- `pbi_data_dictionary_get` is registered as read-only/idempotent
- modeling-only surface includes the tool
- report/PBIR tools remain excluded from modeling-only surface
- fixture invocation returns canonical field refs and counts

Run: `pnpm --filter pbi-report-mcp test -- tests/tool-registry.test.ts tests/model-list-tools.test.ts`
Expected: FAIL because the tool is not registered.

- [ ] **Step 2: Register tool**

Add `pbi_data_dictionary_get` near existing model list tools:
- inputs: `folderPath`, `model`, `includeHidden`, `includeExpressions`
- output from `buildDataDictionary`
- read-only, idempotent
- description says this is model metadata only, not business meaning

- [ ] **Step 3: Add modeling surface inclusion**

Update `isModelingSurfaceTool` so `pbi_data_dictionary_` tools are included.

- [ ] **Step 4: Verify**

Run: `pnpm --filter pbi-report-mcp test -- tests/tool-registry.test.ts tests/model-list-tools.test.ts`
Expected: PASS.

---

### Task 3: Measure Intent Contract in `DashboardSpec`

**Files:**
- Modify: `packages/core/src/types/spec.ts`
- Test: `packages/core/tests/types/spec.test.ts`

- [ ] **Step 1: Write failing tests**

Add schema tests that:
- a ready spec rejects `measureIntents` with `status: "draft"`
- a needs-user-input spec accepts draft measure intents only when clarifying questions exist
- a ready spec accepts confirmed measure intents
- every `missingMeasures[]` item in a ready spec must have a confirmed matching `measureIntent` by measure name when `missingMeasures` is non-empty

Run: `pnpm --filter pbi-core test -- tests/types/spec.test.ts`
Expected: FAIL because measure intent schema does not exist.

- [ ] **Step 2: Add schemas**

Add optional `businessTerms` and `measureIntents` arrays:
- `BusinessTerm.status`: `draft | confirmed | deprecated`
- `MeasureIntent.status`: `draft | confirmed`
- measure intent fields include owner, definition, sourceRefs, grain, additivity, filters, format/unit, caveats, and optional time-intelligence fields.

- [ ] **Step 3: Add validation**

In `DashboardSpecSchema.superRefine`:
- `status: "ready"` rejects draft measure intents and draft business terms that are referenced by measure intents
- `status: "ready"` requires confirmed measure intent for every planned `missingMeasures[]`
- `needs-user-input` still requires `clarifyingQuestions`

- [ ] **Step 4: Verify**

Run: `pnpm --filter pbi-core test -- tests/types/spec.test.ts`
Expected: PASS.

---

### Task 4: Claude Code Skill and Agent Workflow

**Files:**
- Create: `skills/authoring-measures/references/measure-intent-contract.md`
- Create: `skills/planning-dashboards/references/banking-kpi-guidance.md`
- Modify: `skills/authoring-measures/SKILL.md`
- Modify: `skills/planning-dashboards/SKILL.md`
- Modify: `skills/planning-dashboards/references/intake-protocol.md`
- Modify: `skills/planning-dashboards/references/metric-contract.md`
- Modify: `skills/planning-dashboards/references/model-discovery.md`
- Modify: `skills/modeling-semantic-model/references/ai-readiness.md`
- Modify: `skills/modeling-semantic-model/references/naming.md`
- Modify: `agents/data-analyst.md`
- Modify: `agents/model-builder.md`
- Modify: `agents/model-reviewer.md`
- Modify: `agents/report-builder.md`
- Test: `packages/mcp/tests/claude-contracts.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests asserting the relevant skill/agent files mention:
- measure intent contract
- data dictionary/glossary
- `draft` and `confirmed`
- `needs-user-input`
- no-assumption/no inferred formula behavior
- time-intelligence confirmation before measure writes

Run: `pnpm --filter pbi-report-mcp test -- tests/claude-contracts.test.ts`
Expected: FAIL until docs are wired.

- [ ] **Step 2: Add measure intent reference**

Create a concise reference that says:
- correct DAX for the wrong business definition is still wrong
- no confirmed measure intent means no measure write
- time-intelligence measures require Date policy, Date table proof, grain proof where relevant, fiscal/calendar policy, and incomplete-period behavior

- [ ] **Step 3: Add banking KPI guidance**

Create a reference that is a question bank, not a formula library. Include CASA, NIM/NIMS, customer advances/deposits, net impairment, net CoR, FTP, STP, payments/collections, transactions, headcount, and regulated-reporting ambiguity traps.

- [ ] **Step 4: Wire skills and agents**

Update skills and agents so:
- `data-analyst` owns draft dictionary/measure-intent planning
- `model-builder` refuses writes from draft/unconfirmed measure intent
- `report-builder` refuses visuals with draft metric/target/RAG semantics
- `model-reviewer` reports missing dictionary evidence as semantic readiness, not structural error

- [ ] **Step 5: Verify**

Run: `pnpm --filter pbi-report-mcp test -- tests/claude-contracts.test.ts`
Expected: PASS.

---

### Task 5: Optional User Data Dictionary Docs and Beta Packaging

**Files:**
- Create: `docs/data-dictionary.md`
- Modify: `README.md`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `skills/pbi-init-config/SKILL.md`
- Modify: `docs/system-improvements.md`

- [ ] **Step 1: Add docs**

Document:
- recommended path `.pbi-mcp/data-dictionary.yaml`
- optional, not mandatory
- draft/confirmed status model
- dictionary is business meaning only; live MCP tools prove field existence
- dataset-agnostic YAML template

- [ ] **Step 2: Update onboarding**

Fix stale README beta status and add quickstart with:
- no dictionary path
- optional dictionary path
- `/mcp` verification
- raw Microsoft MCP warning

- [ ] **Step 3: Update marketplace/init config**

Expose modeling beta cleanly in marketplace/init config docs. Note dictionaries are context files, not MCP config.

- [ ] **Step 4: Update system improvements**

Amend the existing semantic clarification gate row to include measure intent, dictionary grounding, and draft/confirmed behavior.

- [ ] **Step 5: Verify**

Run: `pnpm lint`
Expected: PASS.

---

## Final Verification

- [ ] Run `pnpm -r test`
- [ ] Run `pnpm lint`
- [ ] Run `pnpm build`
- [ ] Request final review from a reviewer agent
- [ ] Fix all Critical/Important review findings and rerun affected tests
