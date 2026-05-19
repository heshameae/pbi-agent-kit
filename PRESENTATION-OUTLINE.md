# pbi-mcp-ts — Presentation Outline

**Format:** ~12 slides, 15-20 minutes. Adjust depth per audience (technical vs stakeholder).

**Status legend used throughout:**
- ✓ shipped
- 🔄 in flight (this sprint or next)
- ⬜ planned (later)
- ⚠ known gap / not working reliably

---

## Slide 1 — Title

**Title:** pbi-mcp-ts — AI-native authoring for Power BI

**Tagline:** A Claude Code plugin that lets users build, model, and audit Power BI dashboards through natural language.

**Speaker notes:**
- One sentence positioning: "Talk to Claude. Get a working dashboard."
- Mention: TypeScript port of pbi-cli (our older Python project), pairs with Microsoft's official modeling MCP for the semantic-model layer.

---

## Slide 2 — The two layers

**Visual:** Split-screen diagram.

| Report layer (we own) | Modeling layer (Microsoft owns; we wrap + validate) |
|---|---|
| `.Report` / PBIR JSON | `.SemanticModel` / TMDL |
| Pages, visuals, bindings, filters, bookmarks, themes, formats, layout | Tables, columns, measures, relationships, DAX |
| 46 MCP tools | 1 MCP tool (`pbi_model_check`), wraps Microsoft's MCP for the rest |
| 13 skills + 5 agents | 2 skills + 2 agents |

**Speaker notes:**
- Why split this way: the two folders have completely different formats and lifecycles. PBIR is JSON we can edit freely; TMDL is a Microsoft DSL whose write semantics live in their MCP server.
- We DON'T replicate Microsoft's modeling MCP. We pair with it (vendored at `bin/powerbi-modeling-mcp`) and add validators on top.

---

## Slide 3 — How users actually invoke us

**Visual:** Stack diagram showing the four surfaces.

| Surface | When it fires | Examples |
|---|---|---|
| **Skills** | Auto-triggered by natural language match | "make me a sales overview" → scaffold-overview |
| **Agents** | Invoked deliberately by skills or user | "review the layout" → designer agent |
| **Hooks** | Run automatically on tool-call events | After every report write → PBIR validator |
| **MCP tools** | Primitive verbs called by skills/agents | `pbi_visual_add`, `pbi_model_check`, etc. |

**Speaker notes:**
- Skills are high-volume, low-stakes. Agents are low-volume, high-judgment.
- Hooks enforce invariants the LLM might forget.
- MCP tools are the actual atoms — everything else composes them.

---

## Slide 4 — Report layer (agents, skills, hooks)

**Visual:** Three-column table.

### Agents (5)

| Agent | What it does | Status |
|---|---|---|
| **bind-doctor** | Cross-checks every visual binding against the model; surfaces missing fields, measure-vs-column shape mismatches, blocked bridge axes | ✓ shipped (rewriting in flight) |
| **bulk-operator** | Sweeps changes across many visuals (rename, resize, delete by pattern) | ✓ shipped |
| **designer** | Audits layout — alignment, sizing, spacing — and can apply fixes | ✓ shipped |
| **report-reviewer** | End-to-end audit of structural validity, best practices, UX issues | ✓ shipped |
| **report-validator** | Runs PBIR structural validation; minimal output, isolated context | ✓ shipped (also runs as hook) |

### Skills (13)

| Family | Skills |
|---|---|
| **CRUD** (read/write primitives) | report, pages, visuals, themes, filters, bookmarks, format, bulk, layout |
| **Composition** (dashboard scaffolds) | scaffold, scaffold-overview, scaffold-kpi-grid, scaffold-drill |

### Hooks (1)

| Hook | When it fires | Job |
|---|---|---|
| PBIR validator | PostToolUse on any write | Auto-run `pbi_report_validate`; fail loud |

**Speaker notes:**
- The CRUD skills are thin — they wrap MCP tools 1:1. The composition skills are recipes — they decide visual count, types, and layout at runtime.
- bind-doctor sits in the report layer because it WRITES nothing to the model — it just reads both sides.

---

## Slide 5 — Modeling layer (agents, skills)

**Visual:** Two-column table.

### Agents (2)

| Agent | What it does | Status |
|---|---|---|
| **data-architect** | Shapes the model: classifies tables, detects archetypes, creates dim tables / relationships, applies the **shared-dim-first** restructure (TREATAS bridge as fallback) | ✓ shipped, ⚠ reliability issues |
| **model-doctor** | Runs BPA rules (15 rules), grain analysis, relationship pre-flight (cycles, type mismatch, ambiguous active paths) | ✓ shipped (Phase 8.8) |

### Skills (2)

| Skill | What it does | Status |
|---|---|---|
| **measure-architect** | DAX synthesis from intent: YoY / MoM / QoQ / YTD / rolling / vs-target / share-of. Picks model-level vs visual-scoped, sets formatString. | ✓ shipped, ⚠ fabrication-prone |
| **time-intelligence** | Date-source detector + DAX template library for time-based patterns | ✓ shipped |

### MCP tools we own (1)

- **`pbi_model_check`** — runs grain + BPA + relationship checks, returns structured report. Read-only, no DAX execution.

### MCP tools we depend on (Microsoft's modeling MCP)

- `connection_operations` (ConnectFolder), `table_operations`, `column_operations`, `measure_operations`, `relationship_operations`, `database_operations` (ExportToTmdlFolder), `dax_query_operations`

**Speaker notes:**
- The modeling layer is THIN compared to report layer. Most of the action (writes) goes through Microsoft's MCP — we add validators and orchestration around it.
- ⚠ flag the architect: this is the agent that misbehaves. Last session it skipped its own gate and produced a corrupted dashboard. We've added prompt-level fixes (Phase 8.9), but the deterministic-orchestration sprint will move those to code-enforced gates.

---

## Slide 6 — How we pair with Microsoft's modeling MCP

**Visual:** Sequence diagram showing the handshake.

1. Scaffold detects multi-fact model.
2. Scaffold invokes data-architect.
3. data-architect calls Microsoft's `connection_operations.ConnectFolder` (in-memory).
4. data-architect runs `table_operations.List`, `column_operations.GetColumns`, etc.
5. data-architect proposes shared-dim restructure → user approves.
6. data-architect calls `table_operations.Create`, `relationship_operations.Create`, `column_operations.Update isHidden:true` via Microsoft's MCP.
7. data-architect calls `database_operations.ExportToTmdlFolder` to flush in-memory writes to disk.
8. data-architect invokes our **model-doctor** to validate the new state.
9. model-doctor passes → scaffold proceeds to bind visuals.

**Speaker notes:**
- The Export step is critical. Microsoft's MCP keeps writes in-memory only; without ExportToTmdlFolder, every measure / table / relationship vanishes when Desktop reopens.
- Vendored binary at `bin/powerbi-modeling-mcp` (Mac arm64, ad-hoc signed for Gatekeeper). Auto-loaded via plugin's `.mcp.json`.
- We do NOT need Power BI Desktop running for measure / relationship CRUD. Live DAX execution is the only thing that needs Desktop — and we don't use it yet.

---

## Slide 7 — Roadmap: where we came from

**Visual:** Timeline.

```
pbi-cli (Python, ~2024-2025)
   │  Engine + CLI. No agents. No modeling validators. No Claude Code integration.
   │
   ▼ port to TypeScript (current project)
pbi-mcp-ts (TypeScript, 2025-2026)
   ├── Phases 0-4: engine + validators + visual CRUD + binding + filters/bookmarks/format/bulk
   ├── Phase 5:    commander CLI
   ├── Phase 6:    filter/bookmark/format/bulk feature parity with pbi-cli
   ├── Phase 7:    MCP server over stdio
   ├── Phase 8:    Claude Code plugin layer (skills + subagents + hook + slash commands)
   ├── Phase 8.5:  composition layer (layout primitives + 3 dashboard scaffolds + designer)
   ├── Phase 8.7:  intent + modeling synthesis (measure-architect, data-architect, time-intel)
   ├── Phase 8.8:  modeling validators package (TMDL parser + BPA + grain + relationships)
   ├── Phase 8.9:  orchestration hardening via prompt rules (just landed)
   └── (next):     Deterministic orchestration sprint
```

**Speaker notes:**
- pbi-cli was the proven baseline — engine shapes were copied byte-for-byte where applicable.
- We are AHEAD of pbi-cli in agent capabilities. pbi-cli has zero agents, zero modeling validators, zero scaffolds.
- Recent intensity: Phases 8.5 / 8.7 / 8.8 / 8.9 all landed in the last ~6 weeks.

---

## Slide 8 — Roadmap: what's done

**Tighten this slide if pressed for time — the metrics on Slide 12 cover much of it.**

### Engine (`packages/core/`, dataset-agnostic, 500 tests)
- ✓ PBIR parsing, schemas, structural validators
- ✓ Visual CRUD, bind, calc, backend
- ✓ Filters (categorical, TopN, relative-date), bookmarks, format, bulk, layout
- ✓ Modeling validators package (Phase 8.8): TMDL parser, BPA engine (15 rules), grain analysis, relationship pre-flight, doctor orchestrator

### MCP server (47 tools)
- ✓ Stdio transport, full coverage of engine surface
- ✓ 1 modeling tool (`pbi_model_check`); rest are report-layer

### Claude Code plugin
- ✓ 16 skills + 7 agents + 1 hook live
- ✓ Plugin manifest registers everything
- ✓ Auto-connect to Microsoft's modeling MCP on scaffold trigger

### CLI
- ✓ Commander CLI with full verb coverage

**Speaker notes:**
- 500 tests pass. All builds clean. Both code and prompts just passed dual-agent dataset-agnostic audits (zero hardcoding of the dev test fixture).

---

## Slide 9 — Roadmap: in flight (this sprint + next)

### Sprint A — Deterministic orchestration (1-2 weeks, planning happening now)

**Problem:** Every gate today is a markdown sentence in a skill / agent prompt. The LLM can rationalize bypass. Last session bypassed three gates and produced a corrupted dashboard.

**Solution:** Move enforcement from prompts to code-level tool boundaries. Brief at `HANDOVER-DETERMINISTIC-ORCHESTRATION.md`. Concrete deliverables (subject to plan approval):

- 🔄 `pbi_visual_bind_check` — deterministic pre-flight for visual bindings (missing fields, kind mismatch, blocked bridge axis). Already sketched into `pbi-bind-doctor`.
- 🔄 `pbi_measure_create_safe` — wraps Microsoft's `measure_operations.Create` with reference verification first. No more `Profit Target = Sales Target × 0.15` fabrications.
- 🔄 Architect certification — issued by data-architect, validated by bind tools.
- 🔄 Refusal-shaped errors — every safe tool returns structured options on violation, not free-text.

### Sprint B — Naming refresh (small, parallel)

- 🔄 Move from formal names (architect / doctor / operator / designer) to function-obvious names (`model-builder`, `dax-writer`, `model-linter`, `binding-checker`, `report-linter`, `report-auditor`, `layout-aligner`, `bulk-editor`).
- 🔄 Rename touches ~30 files (skills, agents, plugin manifest, cross-references). Engine code unaffected.

**Speaker notes:**
- The deterministic sprint is the BIG one. The naming refresh is cosmetic but makes everything more legible going forward.
- The handover doc has full architectural options (token-gated tools vs validators-baked-in vs workflow runner) for the fresh planning session to evaluate.

---

## Slide 10 — Roadmap: what's next (after this sprint)

| Phase | What | Why | Estimate |
|---|---|---|---|
| **8.8b** ⬜ | Live DAX execution / empirical grain probe | Catch column-value-overlap mismatches (cardinality verification). Currently we can verify structural shape but not whether two `Category` columns actually have the same vocabulary. | 1 week, Windows + Desktop only |
| **9** ⬜ | Desktop auto-sync (Windows-only) | Automate close-save-reopen of Power BI Desktop after model writes via PowerShell / SendKeys helper. Eliminates manual reload step. | 3-4 days |
| **10** ⬜ | Release polish | README, setup docs, optional npm publish, optional Claude Code marketplace submission | 2-3 days |

**Speaker notes:**
- Phase 8.8b is gated on Windows + a real Desktop install — deferred until first Windows user demand.
- Phase 9 is the "make it production-ready for daily use" milestone. Right now users still have to manually reload Desktop after writes.
- Phase 10 is the "share it" milestone. Decide whether to publish broadly or keep internal.

---

## Slide 11 — What still needs tightening (the honest list)

**Visual:** This slide is intentionally not glossed over. Audience trust depends on showing what's broken.

### Modeling layer reliability (the biggest one)

- ⚠ **data-architect was bypassed** in the most recent real-world test. The "MUST invoke" gate is currently a markdown rule; the LLM rationalized skipping it.
- ⚠ **measure-architect fabricated** a `Profit Target = Sales Target × 0.15` measure to fill a gap in source data. The "no fabrication" rule is currently a markdown rule.
- ⚠ **TREATAS-bridge default produced wrong numbers** on Sub-Category visuals because Targets has no Sub-Category column. The "shared-dim first" rewrite landed in Phase 8.9 but is also markdown.
- ✓ **Fix:** the deterministic orchestration sprint (Slide 9) hardens all three into code-enforced gates.

### Validation gaps

- ⚠ PBIR validator catches structural errors but NOT semantic correctness. A dashboard with mathematically wrong numbers can pass validation cleanly.
- ⚠ No cardinality verification (column-value overlap between bridged keys) — Phase 8.8b will close this.

### Open report-layer bugs

- ⚠ TopN filter shape mismatch with current Power BI Desktop (Task #32). Engine emits the shape from pbi-cli, which Desktop silently rejects. Needs a Desktop ground-truth comparison to fix.

### External dependency risk

- ⚠ Microsoft's modeling MCP is vendored. Version pinning concern if their API surface shifts. No mitigation yet beyond "don't auto-update."

**Speaker notes:**
- This slide is the trust-builder. Don't skip it. The audience knows nothing's perfect; pretending otherwise tanks credibility.
- Frame each gap with the fix path. Every ⚠ has either a sprint that addresses it or a clear "we know, here's the trade-off."

---

## Slide 12 — Numbers

**Visual:** Big numbers, low chrome.

| | |
|---|---:|
| MCP tools | **47** |
| Skills | **16** |
| Agents | **7** |
| Hooks | **1** |
| Tests passing | **500 / 500** |
| BPA rules | **15** |
| Dashboard scaffolds | **3** |
| Phases shipped | **9** (0 → 8.9) |
| Approximate timeline | **~9 months** |

**Speaker notes:**
- Drop one or two of these if the audience doesn't care for raw numbers — they're support material, not the headline.
- The "500 tests" number is meaningful because the engine is dataset-agnostic — those tests run against synthetic fixtures, not Demo.pbip.

---

## Slide 13 — Close

**Title:** What we're betting on next.

**Three points:**
1. **Deterministic orchestration** — markdown rules drift; code-enforced gates don't. Sprint planning in flight.
2. **Modeling reliability** — the architect must be impossible to bypass. The fabrication firewall must be impossible to defeat. By end of next sprint.
3. **Production readiness** — Phase 9 (Desktop auto-sync) + Phase 10 (release polish) get this out the door for daily use beyond the internal team.

**Closing line (pick one):**
- "We're 80% of the way to a tool that builds Power BI dashboards from a sentence. The last 20% is making the orchestration impossible to break."
- "From `pbi-cli` (Python, no agents) to `pbi-mcp-ts` (TypeScript, 7 agents, 16 skills, 47 MCP tools) in 9 months. The next 6 weeks tighten the bolts so the modeling layer stops fabricating."

**Speaker notes:**
- Land on a concrete next milestone, not abstract "we'll keep iterating."

---

## Appendix — Visuals to commission (if you want them)

1. **The two-layer diagram** (Slide 2) — split-screen showing report (.Report / PBIR) vs modeling (.SemanticModel / TMDL) with the file structure visible.
2. **The four-surface stack** (Slide 3) — skills / agents / hooks / MCP tools, with arrows showing how they compose.
3. **The pairing diagram** (Slide 6) — sequence showing data-architect orchestrating Microsoft's MCP + our model-doctor.
4. **The roadmap timeline** (Slide 7) — pbi-cli on the left, pbi-mcp-ts phases on the right, "in flight" + "next" stacked at the end.

If you don't want to commission visuals, all of these can be done as monospace ASCII boxes in slide-friendly markdown — happy to draft any of them.

---

## Appendix — Audience tuning

- **Internal engineers:** lean on Slides 4, 5, 6, 11. Skip 1, 12, 13. Add a slide on the testing strategy + the dataset-agnostic discipline.
- **Stakeholders / PMs:** lean on Slides 2, 7, 9, 10, 11, 13. Skip 4, 5, 6 detail. Replace with "what users can do today" demo screenshots.
- **External community / talk:** keep all slides, add a live demo between 6 and 7 ("here's me asking Claude to build a dashboard"). Open-source the plugin if you haven't.

---

## Appendix — What this presentation deliberately does NOT cover

- Specific MCP tool schemas (too low-level for a deck — link the repo if asked).
- DAX patterns the measure-architect synthesizes (separate talk if there's interest).
- The dataset-agnostic audit methodology (engineering blog post material, not slide material).
- Deep dive on TMDL parsing (Phase 8.8 detail; reserve for a technical follow-up).

If any of these come up in Q&A, point to the repo + the relevant memory or HANDOVER doc.
