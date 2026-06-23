# pbi-agent-kit development notes

For maintainers working in this repo. It does not load for end users, whose Claude Code runs in their own project folder.

## Rules
- Dataset-agnostic: never hardcode table, column, measure, or value names. Everything must work against any model.
- No Python for Power BI artifacts: do not use `python`/`pip` (or one-liners) to read, parse, or mutate `.SemanticModel`, `.tmdl`, `.pbip`, `.pbix`, or `.csv` files. Use the TypeScript MCP tools and repo-native Node tooling; if the tool surface cannot do something, stop and report it as unsupported.
- Modeling-only scope: no report, page, or visual authoring.
- Frozen contract: the modeling gates (`packages/core/src/modeling/date-grain-plan.ts`, `time-intelligence-plan.ts`, `relationship-check.ts`, and the gate code in `packages/mcp/src/server.ts`) and their tests are a behavior contract. Don't change their behavior unless that is the task; if a green test goes red, you broke it; revert rather than editing the test.

## Workflow
- Tests: `pnpm -r test` runs both packages (core + mcp); keep all green. `pnpm lint` runs Biome.
- Build marker: after editing anything under `packages/*/src` or the root `package.json`, run `pnpm build` (core builds before mcp) so `dist` and the build marker match the source; otherwise the offline launcher fails closed on a fresh checkout. Keep `packages/{core,mcp}/dist` and the marker committed.
- ARM dev machine: `vendor/` ships the `win32-x64` Microsoft MCP (for the deployment fleet); on ARM, set `PBI_MODELING_MCP_COMMAND` to a local `win32-arm64` build (the env var overrides the bundled exe).
- Commit only when asked.
