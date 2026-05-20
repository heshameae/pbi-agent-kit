# Hard Gates Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase A of the v6 architecture: deterministic DAX-reference and bridge-binding gates before any agent/skill migration.

**Architecture:** Put all reusable logic in `packages/core`. Expose read-only checks through `packages/mcp`. Run Claude Code hook scripts from `hooks/scripts`, importing built `packages/core/dist/index.js` directly. Keep existing agents/skills alive until these gates pass.

**Tech Stack:** TypeScript, Vitest, Node ESM hook scripts, Claude Code `PreToolUse` / `PostToolUse`, local MCP stdio server.

---

## Package Layout

- `packages/core`: the real implementation. Put parsers, validators, sidecar helpers, and bind-gate logic here.
- `packages/mcp`: thin MCP wrapper around `pbi-core` so Claude can call core functions as tools.
- `packages/cli`: human/script command wrapper around `pbi-core`. Phase A does not need new CLI commands unless hook debugging becomes painful.
- `hooks/scripts`: local Node scripts executed by Claude Code hooks. They must import `packages/core/dist/index.js`; they should not call MCP tools.

## Dataset-Agnostic Fixture Rule

All tests and examples in Phase A must use synthetic table/field names only. Use names like `FactPrimary`, `FactBridgeFrom`, `FactBridgeTo`, `DimShared`, `ValueMetric`, `PlanMetric`, `SharedAxis`, and `DetailAxis`. Do not use domain names from demo datasets or customer models.

---

## Phase A File Map

- Modify: `packages/core/src/modeling/types.ts`
- Modify: `packages/core/src/modeling/tmdl-parser.ts`
- Modify: `packages/core/src/modeling/field-index.ts`
- Modify: `packages/core/src/visual/bind-validator.ts`
- Modify: `packages/core/src/modeling/index.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/modeling/dax-reference-check.ts`
- Create: `packages/core/src/hooks/sidecar.ts`
- Create: `packages/core/tests/modeling/dax-reference-check.test.ts`
- Modify: `packages/core/tests/modeling/tmdl-parser.test.ts`
- Modify: `packages/core/tests/visual/bind-validator.test.ts`
- Create: `packages/core/tests/hooks/sidecar.test.ts`
- Modify: `packages/mcp/src/server.ts`
- Create: `packages/mcp/tests/dax-reference-check.test.ts`
- Create: `hooks/scripts/gate-measure-create.mjs`
- Create: `hooks/scripts/update-connection-sidecar.mjs`
- Create: `hooks/scripts/track-uncommitted-measure.mjs`
- Create: `hooks/scripts/clear-uncommitted-on-export.mjs`
- Create: `hooks/scripts/lib/hook-io.mjs`
- Create: `hooks/scripts/lib/core-import.mjs`
- Create: `hooks/tests/gate-measure-create.test.mjs`
- Create: `hooks/tests/sidecar-hooks.test.mjs`
- Modify: `hooks/hooks.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.gitignore`

---

## Task 1: TMDL Measure Annotations

**Files:**
- Modify: `packages/core/src/modeling/types.ts`
- Modify: `packages/core/src/modeling/tmdl-parser.ts`
- Modify: `packages/core/tests/modeling/tmdl-parser.test.ts`

- [ ] **Step 1: Add failing parser test**

Add this case to `packages/core/tests/modeling/tmdl-parser.test.ts`:

```ts
it('parses measure annotations', () => {
  const tbl = parseTableFile([
    'table FactBridgeFrom',
    '\tmeasure BridgeMetric = CALCULATE(SUM(FactBridgeTo[PlanMetric]), TREATAS(VALUES(FactBridgeFrom[SharedAxis]), FactBridgeTo[SharedAxis]))',
    '\t\tformatString: #,##0',
    '\t\tannotation pbi_bridge_from = FactBridgeFrom',
    '\t\tannotation pbi_bridge_to = FactBridgeTo',
    '\t\tannotation pbi_bridge_via = TREATAS',
    '\t\tannotation pbi_bridge_covers = "[\\"FactBridgeFrom[SharedAxis]\\"]"',
  ].join('\n'));

  expect(tbl?.measures[0]?.annotations).toEqual({
    pbi_bridge_from: 'FactBridgeFrom',
    pbi_bridge_to: 'FactBridgeTo',
    pbi_bridge_via: 'TREATAS',
    pbi_bridge_covers: '"[\\"FactBridgeFrom[SharedAxis]\\"]"',
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run: `pnpm -F pbi-core test -- tmdl-parser.test.ts`

Expected: FAIL because `annotations` does not exist on `TMDLMeasure`.

- [ ] **Step 3: Add annotation type**

In `packages/core/src/modeling/types.ts`, extend `TMDLMeasure`:

```ts
readonly annotations: Readonly<Record<string, string>>;
```

- [ ] **Step 4: Parse annotation lines**

In `buildMeasure()` in `packages/core/src/modeling/tmdl-parser.ts`, collect lines matching:

```ts
annotation <name> = <value>
```

Store `annotations[name] = unquoteIdent(value.trim())`. Keep existing expression parsing unchanged.

- [ ] **Step 5: Update every constructed `TMDLMeasure` test fixture**

Every inline `TMDLMeasure` object in tests must include `annotations: {}`.

- [ ] **Step 6: Run tests**

Run: `pnpm -F pbi-core test -- tmdl-parser.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modeling/types.ts packages/core/src/modeling/tmdl-parser.ts packages/core/tests/modeling/tmdl-parser.test.ts
git commit -m "feat(core): parse TMDL measure annotations"
```

---

## Task 2: DAX Reference Checker

**Files:**
- Create: `packages/core/src/modeling/dax-reference-check.ts`
- Modify: `packages/core/src/modeling/index.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/tests/modeling/dax-reference-check.test.ts`

- [ ] **Step 1: Add failing tests**

Create `packages/core/tests/modeling/dax-reference-check.test.ts` with cases for:

```ts
import { describe, expect, it } from 'vitest';
import { daxReferenceCheck } from '../../src/modeling/dax-reference-check.js';
import type { TMDLModel } from '../../src/modeling/types.js';

function model(): TMDLModel {
  return {
    modelPath: '/virtual',
    relationships: [],
    tables: [
      {
        name: 'FactPrimary',
        isHidden: false,
        isCalculated: false,
        isAutoDateTable: false,
        columns: [
          { table: 'FactPrimary', name: 'ValueMetric', dataType: 'decimal', isHidden: false, isKey: false, isCalculated: false },
        ],
        measures: [
          { table: 'FactPrimary', name: 'BaseMeasure', expression: 'SUM(FactPrimary[ValueMetric])', formatString: '#,##0', isHidden: false, annotations: {} },
        ],
      },
      {
        name: 'FactSecondary',
        isHidden: false,
        isCalculated: false,
        isAutoDateTable: false,
        columns: [
          { table: 'FactSecondary', name: 'PlanMetric', dataType: 'decimal', isHidden: false, isKey: false, isCalculated: false },
        ],
        measures: [
          { table: 'FactSecondary', name: 'BaseMeasure', expression: 'SUM(FactSecondary[PlanMetric])', formatString: '#,##0', isHidden: false, annotations: {} },
        ],
      },
    ],
  };
}

describe('daxReferenceCheck', () => {
  it('passes existing qualified columns and same-table bare measures', () => {
    expect(daxReferenceCheck('SUM(FactPrimary[ValueMetric]) + [BaseMeasure]', model(), { hostTable: 'FactPrimary' }).valid).toBe(true);
  });

  it('reports missing qualified references', () => {
    const result = daxReferenceCheck('SUM(FactPrimary[MissingField])', model(), { hostTable: 'FactPrimary' });
    expect(result.valid).toBe(false);
    expect(result.missing).toContainEqual({ table: 'FactPrimary', name: 'MissingField', raw: 'FactPrimary[MissingField]' });
  });

  it('reports ambiguous bare measures', () => {
    const result = daxReferenceCheck('[BaseMeasure]', model());
    expect(result.valid).toBe(false);
    expect(result.ambiguous[0]?.name).toBe('BaseMeasure');
  });

  it('ignores references in strings and comments', () => {
    const result = daxReferenceCheck('"FactPrimary[MissingField]" // [AlsoMissing]\nSUM(FactPrimary[ValueMetric])', model(), { hostTable: 'FactPrimary' });
    expect(result.valid).toBe(true);
  });

  it('accepts uncommitted measures in the same connection batch', () => {
    const result = daxReferenceCheck('[NewMeasureA] + 1', model(), {
      hostTable: 'FactPrimary',
      uncommittedMeasures: [{ table: 'FactPrimary', name: 'NewMeasureA' }],
    });
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run: `pnpm -F pbi-core test -- dax-reference-check.test.ts`

Expected: FAIL because `daxReferenceCheck` does not exist.

- [ ] **Step 3: Implement public types and function**

Create `packages/core/src/modeling/dax-reference-check.ts`:

```ts
export interface DaxReference {
  readonly table?: string;
  readonly name: string;
  readonly raw: string;
}

export interface UncommittedMeasureRef {
  readonly table: string;
  readonly name: string;
}

export interface DaxReferenceCheckOptions {
  readonly hostTable?: string;
  readonly uncommittedMeasures?: readonly UncommittedMeasureRef[];
}

export interface DaxReferenceCheckResult {
  readonly valid: boolean;
  readonly missing: readonly DaxReference[];
  readonly ambiguous: readonly DaxReference[];
  readonly unsupported: readonly string[];
}

export function daxReferenceCheck(
  expression: string,
  model: TMDLModel,
  options: DaxReferenceCheckOptions = {},
): DaxReferenceCheckResult;
```

Implementation rules:

- Strip DAX comments and string literals before matching.
- Qualified refs: match `('Table'|Table)[Name]`; valid if a column or measure exists on that table.
- Bare refs: match `[Name]` after removing qualified refs; valid if same-table measure exists, same-table column exists, or exactly one model/uncommitted measure has that name.
- If multiple model/uncommitted measures share a bare name and no `hostTable` resolves it, return `ambiguous`.
- Fail closed when expression contains unsupported table-qualified syntax the lexer cannot classify.

- [ ] **Step 4: Export from modeling and package root**

Add to `packages/core/src/modeling/index.ts`:

```ts
export * from './dax-reference-check.js';
```

`packages/core/src/index.ts` already exports `./modeling/index.js`.

- [ ] **Step 5: Run tests**

Run: `pnpm -F pbi-core test -- dax-reference-check.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modeling/dax-reference-check.ts packages/core/src/modeling/index.ts packages/core/tests/modeling/dax-reference-check.test.ts
git commit -m "feat(core): add DAX reference checker"
```

---

## Task 3: Sidecar Registry Helpers

**Files:**
- Create: `packages/core/src/hooks/sidecar.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/tests/hooks/sidecar.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Add failing sidecar tests**

Create `packages/core/tests/hooks/sidecar.test.ts` covering:

- Writes multiple connections keyed by `connectionName`.
- Tracks `lastUsedConnectionName`.
- Appends uncommitted measures per connection.
- Clears only one connection after export.
- Chooses sidecar root in this order: `PBI_MCP_SIDECAR_DIR`, `${CLAUDE_PROJECT_DIR}/.pbi-mcp-ts/sidecar`, `${CLAUDE_PLUGIN_DATA}/sidecar`.

- [ ] **Step 2: Run test and confirm failure**

Run: `pnpm -F pbi-core test -- sidecar.test.ts`

Expected: FAIL because sidecar helpers do not exist.

- [ ] **Step 3: Implement helper API**

Create `packages/core/src/hooks/sidecar.ts`:

```ts
export interface ConnectionRecord {
  readonly connectionName: string;
  readonly folderPath: string;
  readonly connectedAt: string;
}

export interface ConnectionsSidecar {
  readonly lastUsedConnectionName?: string;
  readonly connections: Readonly<Record<string, ConnectionRecord>>;
}

export interface UncommittedMeasureRecord {
  readonly table: string;
  readonly name: string;
  readonly expression?: string;
  readonly createdAt: string;
}

export function resolveSidecarRoot(env?: NodeJS.ProcessEnv): string;
export function readConnections(root: string): ConnectionsSidecar;
export function upsertConnection(root: string, record: ConnectionRecord): void;
export function resolveConnection(root: string, connectionName?: string): ConnectionRecord | null;
export function readUncommittedMeasures(root: string, connectionName: string): readonly UncommittedMeasureRecord[];
export function appendUncommittedMeasures(root: string, connectionName: string, measures: readonly Omit<UncommittedMeasureRecord, 'createdAt'>[]): void;
export function clearUncommittedMeasures(root: string, connectionName: string): void;
```

Implementation details:

- Use atomic write: write temp file, then `renameSync`.
- Create parent directories with `mkdirSync(root, { recursive: true })`.
- Use project-scoped state by default when `CLAUDE_PROJECT_DIR` is present.
- Keep files named `connections.json` and `uncommitted-measures.json`.

- [ ] **Step 4: Export sidecar helpers**

Add to `packages/core/src/index.ts`:

```ts
export * from './hooks/sidecar.js';
```

- [ ] **Step 5: Ignore project sidecar**

Add to `.gitignore`:

```gitignore
.pbi-mcp-ts/
```

- [ ] **Step 6: Run tests**

Run: `pnpm -F pbi-core test -- sidecar.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .gitignore packages/core/src/hooks/sidecar.ts packages/core/src/index.ts packages/core/tests/hooks/sidecar.test.ts
git commit -m "feat(core): add hook sidecar registry"
```

---

## Task 4: MCP Tool for DAX Reference Check

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Create: `packages/mcp/tests/dax-reference-check.test.ts`

- [ ] **Step 1: Add failing MCP smoke test**

Create `packages/mcp/tests/dax-reference-check.test.ts` that imports or launches the server the same way existing MCP smoke tests do and verifies tool registration includes `pbi_dax_reference_check`.

- [ ] **Step 2: Run test and confirm failure**

Run: `pnpm -F pbi-report-mcp test -- dax-reference-check.test.ts`

Expected: FAIL because tool is not registered.

- [ ] **Step 3: Register read-only tool**

In `packages/mcp/src/server.ts`, import:

```ts
daxReferenceCheck,
parseTMDLFolder,
```

Add tool:

```ts
tool(
  'pbi_dax_reference_check',
  'Check DAX References',
  'Read-only lexical DAX reference check against a .SemanticModel/definition folder. Verifies qualified Table[Field] and bare [Measure] references; fails closed on missing or ambiguous references.',
  {
    modelPath: z.string().describe('Path to .SemanticModel/definition, .SemanticModel, .pbip, or containing folder.'),
    expression: z.string().describe('DAX expression to check.'),
    hostTable: z.string().optional().describe('Host table for same-table bare [Measure] references.'),
  },
  { readOnlyHint: true, idempotentHint: true },
  (input) => {
    const definitionPath = resolveSemanticModelDefinition(input.modelPath);
    const model = parseTMDLFolder(definitionPath);
    return daxReferenceCheck(input.expression, model, { hostTable: input.hostTable });
  },
);
```

- [ ] **Step 4: Run tests**

Run: `pnpm -F pbi-report-mcp test -- dax-reference-check.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/server.ts packages/mcp/tests/dax-reference-check.test.ts
git commit -m "feat(mcp): expose DAX reference check tool"
```

---

## Task 5: Hook Scripts

**Files:**
- Create: `hooks/scripts/lib/core-import.mjs`
- Create: `hooks/scripts/lib/hook-io.mjs`
- Create: `hooks/scripts/gate-measure-create.mjs`
- Create: `hooks/scripts/update-connection-sidecar.mjs`
- Create: `hooks/scripts/track-uncommitted-measure.mjs`
- Create: `hooks/scripts/clear-uncommitted-on-export.mjs`
- Create: `hooks/tests/gate-measure-create.test.mjs`
- Create: `hooks/tests/sidecar-hooks.test.mjs`

- [ ] **Step 1: Add hook test fixtures**

Create tests that spawn each script with stdin JSON shaped like Claude Code hook input:

```json
{
  "tool_name": "mcp__powerbi-modeling__measure_operations",
  "tool_input": {
    "request": {
      "operation": "Create",
      "connectionName": "ModelConnectionA",
      "definitions": [
        { "tableName": "FactPrimary", "name": "InvalidMeasure", "expression": "SUM(FactPrimary[MissingField])" }
      ]
    }
  }
}
```

Also test the direct shape:

```json
{
  "tool_input": {
    "operation": "Create",
    "connectionName": "ModelConnectionA",
    "definitions": [
      { "tableName": "FactPrimary", "name": "ValidMeasure", "expression": "SUM(FactPrimary[ValueMetric])" }
    ]
  }
}
```

- [ ] **Step 2: Run hook tests and confirm failure**

Run: `node --test hooks/tests/*.test.mjs`

Expected: FAIL because scripts do not exist.

- [ ] **Step 3: Add shared hook IO helpers**

`hooks/scripts/lib/hook-io.mjs`:

- Read JSON from stdin.
- Normalize operation payload with `const request = input.tool_input?.request ?? input.tool_input ?? {};`.
- Extract definitions from `request.definitions ?? request.definition ?? []`.
- Write deny as exit code 2 with stderr JSON.

`hooks/scripts/lib/core-import.mjs`:

```js
export async function importCore() {
  return import(new URL('../../packages/core/dist/index.js', import.meta.url));
}
```

- [ ] **Step 4: Implement `gate-measure-create.mjs`**

Rules:

- Allow non-Create operations.
- Resolve connection with `resolveSidecarRoot()` + `resolveConnection(root, request.connectionName)`.
- Fail closed if no connection is found.
- Parse model from `connection.folderPath`.
- Read uncommitted measures for the same connection.
- Run `daxReferenceCheck(expression, model, { hostTable, uncommittedMeasures })` for every definition.
- Deny if any report has `missing`, `ambiguous`, or `unsupported`.

- [ ] **Step 5: Implement PostToolUse sidecar scripts**

`update-connection-sidecar.mjs`:

- Only handle `operation === "ConnectFolder"`.
- Derive `folderPath` from `request.folderPath`.
- Derive `connectionName` from `tool_response.structuredContent.connectionName`, `request.connectionName`, or basename of the `.SemanticModel` parent.
- Call `upsertConnection`.

`track-uncommitted-measure.mjs`:

- Only handle successful `operation === "Create"`.
- Resolve connection.
- Append created measure `{ table, name, expression }` for each definition.

`clear-uncommitted-on-export.mjs`:

- Only handle successful `operation === "ExportToTmdlFolder"`.
- Resolve connection by `request.connectionName` or folderPath match.
- Clear uncommitted measures for that connection.

- [ ] **Step 6: Build core before hook tests**

Run: `pnpm -F pbi-core build`

Expected: PASS and `packages/core/dist/index.js` exists.

- [ ] **Step 7: Run hook tests**

Run: `node --test hooks/tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add hooks/scripts hooks/tests
git commit -m "feat(hooks): gate unsafe measure creation"
```

---

## Task 6: Wire Claude Code Hooks

**Files:**
- Modify: `hooks/hooks.json`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Update hook config**

Merge these entries into existing `hooks/hooks.json`; keep the existing PBIR PostToolUse validator:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__powerbi-modeling__measure_operations",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/gate-measure-create.mjs"]
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "mcp__powerbi-modeling__connection_operations",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/update-connection-sidecar.mjs"]
          }
        ]
      },
      {
        "matcher": "mcp__powerbi-modeling__measure_operations",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/track-uncommitted-measure.mjs"]
          }
        ]
      },
      {
        "matcher": "mcp__powerbi-modeling__database_operations",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/clear-uncommitted-on-export.mjs"]
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Add plugin hook declaration**

Add to `.claude-plugin/plugin.json`:

```json
"hooks": "./hooks/hooks.json"
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); console.log('ok')"`

Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add hooks/hooks.json .claude-plugin/plugin.json
git commit -m "chore(plugin): register hard-gate hooks"
```

---

## Task 7: Bridge Annotation Enforcement in `pbi_visual_bind`

**Files:**
- Modify: `packages/core/src/modeling/field-index.ts`
- Modify: `packages/core/src/visual/bind-validator.ts`
- Modify: `packages/core/tests/visual/bind-validator.test.ts`

- [ ] **Step 1: Add failing bind-validator tests**

Add tests for:

- Measure has `pbi_bridge_from=FactBridgeFrom`, `pbi_bridge_to=FactBridgeTo`, `pbi_bridge_covers=["FactBridgeFrom[SharedAxis]"]`.
- Bind to axis `FactBridgeFrom[SharedAxis]` passes.
- Bind to axis `FactBridgeFrom[DetailAxis]` blocks with `BRIDGE_BLOCKED_AXIS`.
- Bind to unrelated same-name axis `DimOther[SharedAxis]` blocks.
- Bind to related dimension axis that filters `FactBridgeFrom[SharedAxis]` passes only when active relationship path exists.

- [ ] **Step 2: Run test and confirm failure**

Run: `pnpm -F pbi-core test -- bind-validator.test.ts`

Expected: FAIL because bridge annotations are ignored.

- [ ] **Step 3: Carry annotations into field index**

In `packages/core/src/modeling/field-index.ts`, add `annotations` to `ModelMeasureField` and copy from `TMDLMeasure`.

- [ ] **Step 4: Parse bridge metadata**

In `packages/core/src/visual/bind-validator.ts`, add helper:

```ts
function bridgeMetadataFor(measure: ModelMeasureField): {
  from: string;
  to: string;
  via: 'TREATAS' | 'USERELATIONSHIP';
  covers: readonly string[];
} | null
```

Rules:

- Return `null` if no bridge annotations exist.
- Parse `pbi_bridge_covers` JSON string.
- Covers entries are table-qualified `Table[Column]`.

- [ ] **Step 5: Enforce metadata before expression fallback**

In `validateAxisMeasureCompatibility()`:

- If bridge metadata exists, require every unaggregated axis to be covered or to filter a covered field on `bridge_from`.
- If no bridge metadata exists, keep current expression-derived TREATAS behavior so existing tests keep passing.

- [ ] **Step 6: Run tests**

Run: `pnpm -F pbi-core test -- bind-validator.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modeling/field-index.ts packages/core/src/visual/bind-validator.ts packages/core/tests/visual/bind-validator.test.ts
git commit -m "feat(core): enforce bridge annotations during visual binding"
```

---

## Task 8: Final Phase A Verification

**Files:**
- All Phase A files.

- [ ] **Step 1: Run package tests**

Run: `pnpm -r test`

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `pnpm -r build`

Expected: PASS.

- [ ] **Step 3: Run hook tests after build**

Run: `node --test hooks/tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 4: Manual hook smoke**

Run a denied create fixture against the built hook:

```bash
printf '%s\n' '{"tool_name":"mcp__powerbi-modeling__measure_operations","tool_input":{"operation":"Create","connectionName":"ModelConnectionA","definitions":[{"tableName":"FactPrimary","name":"InvalidMeasure","expression":"SUM(FactPrimary[MissingField])"}]}}' \
  | PBI_MCP_SIDECAR_DIR="$(pwd)/.tmp/sidecar" node hooks/scripts/gate-measure-create.mjs
```

Expected: exit code `2` and stderr lists `FactPrimary[MissingField]`.

- [ ] **Step 5: Commit verification fixes**

```bash
git status --short
git add <only Phase A files changed since last commit>
git commit -m "test: verify hard gates foundation"
```

Skip this commit if no files changed during verification.

---

## Stop Line

Stop Phase A here. Do not rename or delete any existing agents/skills until:

- `pnpm -r test` passes.
- `pnpm -r build` passes.
- Hook tests pass.
- `pbi_visual_bind` bridge annotation tests pass.
- The plugin manifest declares `hooks`.
