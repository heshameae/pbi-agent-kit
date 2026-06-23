# Changelog

All notable changes to `pbi-agent-kit` are documented here. This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-06-22

First release. **Scope: modeling workflows only.** Report, page, and visual authoring are unavailable in this beta.

### Added
- **Modeling-only MCP server** (`pbi-modeling-beta`) that wraps Microsoft's Power BI modeling MCP and runs deterministic gates before any write: governed Date tables, star-schema / actuals-targets joins, measure-intent–gated DAX, the time-intelligence blank-risk cap, relationship gates, model checks, and regulated-readiness evidence.
- **Claude Code plugin surface**: 4 modeling skills, 3 modeling agents, scope + no-Python guard hooks, and `.mcp.json` auto-registration.
- **Offline / Windows runtime support**: the wrapper resolves a locally vendored Microsoft MCP executable (or `PBI_MODELING_MCP_COMMAND`) and **fails closed** when unconfigured instead of reaching the network; the compiled server ships prebuilt and the launcher never builds on the runtime by default (dev opt-in via `PBI_AGENT_KIT_ALLOW_RUNTIME_BUILD=1`).
- **Release gate** `scripts/verify-release-artifact.mjs` (`pnpm verify:release`) that fails if a tag would ship without a compiled server.
- **Optional data-dictionary UX**: a non-blocking `SessionStart` reminder and the `/pbi-init-data-dictionary` command that scaffolds `.pbi-agent-kit/data-dictionary.yaml` and fills it via clarifying questions. Opt out with `PBI_AGENT_KIT_NO_DICT_REMINDER=1`.
- **Release tooling** `scripts/build-release.mjs` (`pnpm release`): offline source+dist zip, dependency manifest, test evidence, and a SHA-256 checksum manifest.
- **Docs**: `docs/install-offline-windows.md` (offline Windows install) and `docs/known-limitations.md` (disclosed-risk sheet).

### Notes
- **Readiness is not certification**; RLS is read/evidence-only. See `docs/known-limitations.md`.
- The release zip (`git archive`) contains **source + compiled `dist`**. The Microsoft MCP binary is **not included**; provide the approved build for your CPU under `vendor/powerbi-modeling-mcp/` or via `PBI_MODELING_MCP_COMMAND`. A runnable offline bundle also needs production `node_modules` (`pnpm install --prod`). See `docs/install-offline-windows.md`.
- Validated against Microsoft Power BI modeling MCP `0.5.0-beta.2`; also exercised on `0.5.10` (`win32-x64` and `win32-arm64`). The MCP binary is provided separately, not shipped.
