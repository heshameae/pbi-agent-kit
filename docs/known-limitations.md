# Known Limitations (v0.1.0)

Disclosed-risk sheet for this release. These are deliberate scope boundaries and known behavioral caveats of the modeling-only beta. Dataset-agnostic: none of these depend on a specific model.

## Scope

- **Modeling-only.** Report, dashboard, page, visual, and PBIR authoring are unavailable. A Claude Code hook refuses report-authoring prompts, stale report skill/agent expansion, and report/PBIR tool calls. Mixed prompts continue only the explicit modeling task.
- **No raw artifact surgery.** Agents do not hand-edit `.SemanticModel` / `.Report` / `.tmdl` / `.pbip` / `.pbix` / `.pbit` / `.pbir` / `.csv` files. All model changes go through the wrapper's gated tools. Unsupported operations are reported as unsupported rather than worked around.
- **No Python.** Power BI artifact operations never use Python; the toolchain is TypeScript/Node only.

## Readiness is not certification

- A clean structural model check is **not** a compliance approval, a bank-safe launch signal, or an RLS-leakage proof.
- `pbi_model_regulated_check` captures evidence and blocks when evidence is missing; it does **not** certify compliance.
- **RLS is read/evidence-only in this beta:** no role authoring, assignment, "View as" testing, or leakage proof. Formal compliance sign-off and RLS leakage validation remain the team's responsibility.
- Copilot / data-agent exposure additionally requires AI schema scope, RLS leakage tests, tenant settings, and approved instructions; AI-readiness checks here are structural/metadata-only.

## Runtime dependencies

- **Live Power BI Desktop dependency.** Live model reads and writes require an open Power BI Desktop instance reachable by the wrapper. There is an offline folder-read fallback, but live editing is not available offline.
- **Windows + approved Microsoft MCP artifact.** The runtime is Windows-only with no internet. The Microsoft Power BI modeling MCP must be provided as an approved local executable. The wrapper resolves it automatically when vendored under `<plugin>/vendor/powerbi-modeling-mcp/`, or from `PBI_MODELING_MCP_COMMAND`; if neither is present it fails closed (it does not fetch via `npx`). See `docs/install-offline-windows.md`.
- **Microsoft MCP version.** Validated against Microsoft Power BI modeling MCP `0.5.0-beta.2` (also exercised on `0.5.10`). The Microsoft MCP is provided separately and is not in the repo; the approved version you provision governs the actual runtime, and behavior may differ on other versions.
- **Prebuilt server required.** The plugin ships a prebuilt compiled server. The launcher fails closed on a missing/stale build rather than building on the runtime (an on-demand build is a dev-only opt-in via `PBI_AGENT_KIT_ALLOW_RUNTIME_BUILD=1`).

## Live-write caveats

Some live property writes are **best-effort and not asserted on read-back**, because the live Import-mode model can report a value that differs from what was written:

- `isKey` and `isHidden` column writes are never asserted on read-back (Import-mode List can omit the key, which reads back as `false` even when the write landed). Date-key readiness is proven from probe **data**, not the `isKey` metadata flag.
- Marking a table as a Date table (`dataCategory:Time`) can silently no-op on an Import model; the date key is proven from data, so the mark is treated as best-effort and never deadlocks downstream work.
- The governed Date-table policy annotation write/read wire shape is unverified against the live Microsoft MCP; it is gated behind try/catch, reported as `verified:false`, and degrades to prior behavior without blocking.
- For pure measure-add flows, a successful `pbi_measure_create` and individual `pbi_measure_create_batch.measuresCreated` entries are authoritative. Do not re-issue writes because a later `pbi_model_list_measures` read is delayed, incomplete, or stale. If a batch response has `refused > 0`, report the refused items as incomplete/blocking instead of treating the whole request as done.

These are handled defensively (proof-from-data, non-blocking degradation) so they do not produce wrong numbers, but they are disclosed here because the tool mutates regulated semantic models.

## Distribution

- Some helper scripts in `scripts/` are development-only (macOS/Parallels bridge; an internet-dependent setup helper) and are not part of the supported offline install path. The offline path uses `PBI_MODELING_MCP_COMMAND` and never invokes them.
