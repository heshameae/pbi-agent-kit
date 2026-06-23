# pbi-agent-kit — development notes

For maintainers working in this repo. It does not load for end users, whose Claude Code runs in their own project folder.

## Rules
- Dataset-agnostic: never hardcode table, column, measure, or value names. Everything must work against any model.
- No Python for Power BI artifacts: do not use `python`/`pip` (or one-liners) to read, parse, or mutate `.SemanticModel`, `.tmdl`, `.pbip`, `.pbix`, or `.csv` files. Use the TypeScript MCP tools and repo-native Node tooling; if the tool surface cannot do something, stop and report it as unsupported.
- Modeling-only scope: no report, page, or visual authoring.

## Workflow
- Run `pnpm -r test` and `pnpm lint` before and after changes; keep them green.
- `pnpm build` (core builds before mcp); keep `packages/{core,mcp}/dist` and the build marker committed and consistent so offline installs ship a runnable server.
- Commit only when asked.
