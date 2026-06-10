# Adversarial Claude Modeling Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the failure modes that made Claude spend minutes looping through low-level modeling tools, refresh unnecessarily, mutate partial star-schema state, and leak raw JSON into the response.

**Architecture:** Use adversarial agents with disjoint ownership: one proves DAX row evidence, one proves mutation safety, one proves Claude-facing tool ergonomics, and one attacks retry/idempotency. Production changes remain dataset-agnostic and live through MCP/TypeScript paths only.

**Tech Stack:** TypeScript, Zod, MCP SDK, Vitest, Power BI modeling MCP wrapper, Claude Code plugin contracts.

---

## File Structure

- `packages/mcp/src/model-bridge/model-driver.ts`: normalize DAX results and harden retry behavior for non-idempotent writes.
- `packages/mcp/tests/model-driver.test.ts`: driver-level DAX result and retry tests.
- `packages/mcp/src/server.ts`: MCP tool response wrapper, governed Date preflight, star-schema apply behavior, tool descriptions, optional output schema support.
- `packages/mcp/tests/model-list-tools.test.ts`: server-boundary `pbi_dax_query` tests.
- `packages/mcp/tests/model-date-grain-plan.test.ts`: governed Date table no-mutation and refresh-policy tests.
- `packages/mcp/tests/model-star-schema-plan.test.ts`: star-schema dry-run/preflight/apply tests.
- `packages/mcp/tests/tool-registry.test.ts`: tool description, annotation, output schema, and modeling surface tests.
- `packages/mcp/tests/claude-contracts.test.ts`: Claude plugin behavior contracts.
- `docs/system-improvements.md`: concise planned/verified behavior log.

---

## Agent Workflow

Run these agents adversarially. Each agent must try to prove the proposed behavior wrong with a failing test before implementation is accepted.

1. **DAX Evidence Agent**
   - Owns: `packages/mcp/src/model-bridge/model-driver.ts`, `packages/mcp/tests/model-driver.test.ts`, `packages/mcp/tests/model-list-tools.test.ts`.
   - Attacks: DAX executes but returns zero parseable rows, malformed tabular payloads, file-paged results, and server-boundary row loss.
   - Must not edit Date or star-schema workflow code.

2. **Mutation Safety Agent**
   - Owns: `packages/mcp/tests/model-date-grain-plan.test.ts`, `packages/mcp/tests/model-star-schema-plan.test.ts`.
   - Attacks: any create/mark/relationship/hide-FK write that can occur before all required proof is available.
   - Writes tests first; production `server.ts` implementation is integrated by the coordinator to avoid conflicts.

3. **Claude Ergonomics Agent**
   - Owns: `packages/mcp/tests/tool-registry.test.ts`, `packages/mcp/tests/claude-contracts.test.ts`.
   - Attacks: raw JSON text duplication, missing output schemas on high-value tools, long/truncated descriptions, noisy result text, and missing Claude Code sizing hints.
   - Must not weaken gates to make outputs shorter.

4. **Retry/Idempotency Agent**
   - Owns: `packages/mcp/src/model-bridge/model-driver.ts`, `packages/mcp/tests/model-driver.test.ts`.
   - Attacks: non-idempotent live writes retried after transport drop without readback/reconciliation.
   - Must keep read operation reconnect retry behavior intact.

5. **Coordinator**
   - Owns shared `packages/mcp/src/server.ts` implementation and final integration.
   - Resolves conflicts, keeps tool paths dataset-agnostic, and runs verification.

---

### Task 1: DAX Row Evidence Cannot Masquerade As Empty Data

**Files:**
- Modify: `packages/mcp/src/model-bridge/model-driver.ts`
- Test: `packages/mcp/tests/model-driver.test.ts`
- Test: `packages/mcp/tests/model-list-tools.test.ts`

- [ ] **Step 1: Add a server-boundary DAX query test**

Add a test that stubs the driver and calls the MCP tool:

```ts
it('returns pbi_dax_query rows through the server boundary without dropping structured rows', async () => {
  process.env.PBI_REPORT_MCP_DISABLE_LIVE_PROBE = '1';
  setModelDriverForTests({
    async ensureConnection() {
      return { mode: 'live', connectionString: 'Data Source=localhost:61234;' };
    },
    async daxQuery() {
      return {
        columns: ['[Label]', '[Value]'],
        rows: [{ '[Label]': 'ok', '[Value]': 1 }],
        rowCount: 1,
      };
    },
  } as unknown as Parameters<typeof setModelDriverForTests>[0]);

  const result = await withClient((client) =>
    client.callTool({ name: 'pbi_dax_query', arguments: { query: 'EVALUATE ROW("Value", 1)' } }),
  );

  const payload = jsonPayload(result);
  expect(payload.result).toMatchObject({
    columns: ['[Label]', '[Value]'],
    rows: [{ '[Label]': 'ok', '[Value]': 1 }],
    rowCount: 1,
  });
});
```

Run: `pnpm --filter pbi-report-mcp test -- tests/model-list-tools.test.ts`
Expected: FAIL if server serialization drops rows; PASS if current wrapper already preserves them.

- [ ] **Step 2: Add malformed DAX payload tests**

Add driver tests for local columnar envelopes where `columns` exist but `rows` contains malformed primitive rows. Expected behavior must be explicit: either throw a deterministic error or return diagnostics with nonzero malformed count. Do not silently return `rows: []` with `rowCount > 0`.

Run: `pnpm --filter pbi-report-mcp test -- tests/model-driver.test.ts`
Expected: FAIL until malformed payload behavior is explicit.

- [ ] **Step 3: Implement minimal normalization hardening**

If malformed rows are currently silent, update `normalizeDaxResult()` so malformed tabular rows cannot look like valid empty data. Keep existing support for:
- `content[].text` JSON
- `data.columns` + positional `data.rows`
- REST `results[].tables[].rows`
- `success:false` envelopes
- truncated/file-paged metadata

- [ ] **Step 4: Verify**

Run: `pnpm --filter pbi-report-mcp test -- tests/model-driver.test.ts tests/model-list-tools.test.ts`
Expected: PASS.

---

### Task 2: No Date Mutation Before Preflight Proof

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Test: `packages/mcp/tests/model-date-grain-plan.test.ts`

- [ ] **Step 1: Add no-mutation test for failed governed Date proof**

Add a test where `daxQuery()` throws before any Date table exists. Assert:
- `createTable` is not called
- `updateColumn` is not called
- `markAsDateTable` is not called
- `createRelationship` is not called
- result is structured `isError` with `gate: governed-date-table-create`, `status: blocked`, `reason: probe-failed`

Run: `pnpm --filter pbi-report-mcp test -- tests/model-date-grain-plan.test.ts`
Expected: FAIL if governed create still writes before final proof.

- [ ] **Step 2: Add explicit refresh-policy test**

Add a test where `rangePolicy` is present but `refreshBeforeProbe` is omitted. Expected result:

```ts
expect(payload.status).toBe('needs-user-input');
expect(payload.clarifyingQuestions).toEqual(
  expect.arrayContaining([expect.objectContaining({ id: 'refresh_before_probe' })]),
);
expect(connected).toBe(false);
expect(created).toBe(false);
```

Run: `pnpm --filter pbi-report-mcp test -- tests/model-date-grain-plan.test.ts`
Expected: FAIL until refresh policy is explicit.

- [ ] **Step 3: Implement preflight proof**

In `createGovernedDateTable()`:
- ask for `refreshBeforeProbe` when omitted
- optionally refresh only when explicitly true
- run a pre-create DAX grain/range proof against all required fact date columns
- fail before `createTable()` when DAX rows are missing, malformed, or probe throws
- only then create the Date table, harden columns, mark as Date, and create relationships

Do not use `CALENDARAUTO()`. Do not infer calendar bounds from prompt text. Use dynamic fact-anchored DAX only.

- [ ] **Step 4: Verify**

Run: `pnpm --filter pbi-report-mcp test -- tests/model-date-grain-plan.test.ts`
Expected: PASS.

---

### Task 3: Star-Schema Apply Must Have Dry-Run And No Partial Commit Surprise

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Test: `packages/mcp/tests/model-star-schema-plan.test.ts`
- Test: `packages/mcp/tests/tool-registry.test.ts`

- [ ] **Step 1: Add dry-run schema and behavior tests**

Add `dryRun` to `pbi_model_apply_star_schema_join`. Test:
- `dryRun: true` returns planned operations and validation gates
- no driver write method is called
- temporal axes block the whole plan
- returned result names the next tool for temporal Date axes

Run: `pnpm --filter pbi-report-mcp test -- tests/model-star-schema-plan.test.ts tests/tool-registry.test.ts`
Expected: FAIL until `dryRun` exists.

- [ ] **Step 2: Add all-gates-before-writes test**

Create a fake driver where relationship gate proof fails. Assert no table create, no refresh, no column update, no relationship create, and no FK hide are called.

Run: `pnpm --filter pbi-report-mcp test -- tests/model-star-schema-plan.test.ts`
Expected: FAIL if `applyStarSchemaJoin()` still creates tables before relationship/date gates prove all writes.

- [ ] **Step 3: Implement preflight phase**

Split `applyStarSchemaJoin()` into:
- `buildStarSchemaApplyPlan()`
- `preflightStarSchemaApply()`
- `executeStarSchemaApply()`

Preflight must collect all create/update/relationship checks before the first mutation. Apply can still be sequential if Microsoft transactions are unavailable, but no known failure should be discovered after the first write.

- [ ] **Step 4: Verify**

Run: `pnpm --filter pbi-report-mcp test -- tests/model-star-schema-plan.test.ts tests/tool-registry.test.ts`
Expected: PASS.

---

### Task 4: Claude-Facing Tool Results Must Be Summaries Plus Structured Content

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Test: `packages/mcp/tests/tool-registry.test.ts`
- Test: `packages/mcp/tests/claude-contracts.test.ts`

- [ ] **Step 1: Add response contract test**

Add a test that calls a representative object-returning tool and asserts:

```ts
const text = result.content.find((item) => item.type === 'text')?.text ?? '';
expect(text).not.toBe(JSON.stringify(result.structuredContent, null, 2));
expect(text.length).toBeLessThan(800);
```

Run: `pnpm --filter pbi-report-mcp test -- tests/claude-contracts.test.ts`
Expected: FAIL while `tool()` returns full pretty JSON text.

- [ ] **Step 2: Implement concise text rendering**

Change the shared `tool()` wrapper so object results return:
- short status text in `content`
- full payload in `structuredContent`
- bounded error text on error

Keep full structured data intact for programmatic callers.

- [ ] **Step 3: Add output schema support for high-value tools**

Add optional output schema support to `ToolDefinition` and register it for:
- `pbi_model_plan_star_schema_join`
- `pbi_model_apply_star_schema_join`
- `pbi_model_plan_date_table`
- `pbi_dax_query`

Run: `pnpm --filter pbi-report-mcp test -- tests/tool-registry.test.ts`
Expected: PASS with output schemas present for these tools.

- [ ] **Step 4: Verify**

Run: `pnpm --filter pbi-report-mcp test -- tests/tool-registry.test.ts tests/claude-contracts.test.ts`
Expected: PASS.

---

### Task 5: Non-Idempotent Write Retry Must Not Duplicate Mutations

**Files:**
- Modify: `packages/mcp/src/model-bridge/model-driver.ts`
- Test: `packages/mcp/tests/model-driver.test.ts`

- [ ] **Step 1: Add duplicate-write retry test**

Create a fake client where a create operation mutates internal state, then throws a connection-drop error. Assert the driver does not call the same non-idempotent create twice without a readback/reconciliation path.

Run: `pnpm --filter pbi-report-mcp test -- tests/model-driver.test.ts`
Expected: FAIL if `#write()` retries create blindly.

- [ ] **Step 2: Implement write retry classification**

Keep reconnect retry for read operations. For non-idempotent writes:
- do not retry `Create` operations automatically after a connection drop
- surface a deterministic `write-result-unknown` error with next-step guidance
- allow idempotent `Update`, `Activate`, `Deactivate`, and `Refresh` retries only when already covered by tests

- [ ] **Step 3: Verify**

Run: `pnpm --filter pbi-report-mcp test -- tests/model-driver.test.ts`
Expected: PASS.

---

### Task 6: Documentation And System Improvement Log

**Files:**
- Modify: `docs/system-improvements.md`
- Modify: `agents/model-builder.md`
- Modify: `skills/modeling-semantic-model/SKILL.md`
- Test: `packages/mcp/tests/claude-contracts.test.ts`

- [ ] **Step 1: Update agent/skill rules**

Require Claude/model-builder to use:
- `pbi_model_apply_star_schema_join` for cross-fact non-temporal shared dimensions
- `pbi_model_plan_date_table` / `pbi_date_table_create_governed` for Date axes
- no manual replay of `pbi_table_create` + `pbi_relationship_create`
- no `pbi_model_refresh` unless the user or tool input explicitly approves refresh

- [ ] **Step 2: Update system improvements**

Use `skills-internal/system-improvements/SKILL.md`. Update existing rows instead of appending duplicates:
- Live DAX probe result handling
- Governed Date table create
- Star schema planner/apply
- Claude MCP response hygiene

- [ ] **Step 3: Verify**

Run: `pnpm --filter pbi-report-mcp test -- tests/claude-contracts.test.ts`
Expected: PASS.

---

## Final Verification

Run:

```bash
pnpm --filter pbi-report-mcp test -- tests/model-driver.test.ts tests/model-list-tools.test.ts tests/model-date-grain-plan.test.ts tests/model-star-schema-plan.test.ts tests/tool-registry.test.ts tests/claude-contracts.test.ts
pnpm --filter pbi-core test -- tests/modeling/date-grain-plan.test.ts
pnpm build
```

Expected:
- all targeted tests pass
- build passes
- no Python commands used
- no dataset-specific fields or names introduced outside generic fixtures
- Claude-facing text output is bounded and structured payloads remain available
