# Skill Architecture Plan — task-grouped, lean SKILL.md + references

**Status:** Draft · **Date:** 2026-05-20 · **Owner:** Hesham Eissa
**Companions:** `2026-05-18-pbi-architecture-design.md` (v6) · `docs/superpowers/mining/ADOPTION-MAP.md` (source→destination paths) · `docs/superpowers/mining/review/01,02` (decisions)

## Decision
Replace the flat 13-skill "one topic = one skill" list with **6 task-grouped skills + 1 planning skill**, each a **lean SKILL.md router** (<500 words; description = *when to use* only) pointing at **`references/*.md`** (the heavy mined content, loaded on demand) and **`scripts/`** (executable/data). Per superpowers `writing-skills`. This keeps each SKILL.md small while the depth lives in references Claude pulls only when needed.

## Conventions (every skill obeys)
- **SKILL.md** = frontmatter (`name`, `description: "Use when …"` triggers only — NO workflow summary, or Claude follows the description and skips the body) + Overview (core principle, 1–2 sentences) + When-to / When-not + a Quick-Reference table + **pointers to `references/`** (by name, not `@`-links). Target <500 words.
- **`references/*.md`** = one file per coherent sub-topic; this is where the mined material goes. May be 100s of lines — that's fine, it's loaded on demand.
- **`scripts/`** = runnable helpers / data files (e.g., SVG example `.dax`, preview tools). BPA rule JSON does NOT live in a skill — it's engine data in `packages/core` (see ADOPTION-MAP).
- **Naming** = verb-first (`authoring-measures`, not `dax-patterns`). No `pbi-` prefix on the new shared skills — the plugin namespace prevents collisions (open item below).
- **Dataset-agnostic** — every table/column/measure name in any skill is a placeholder.
- **Iron Law (superpowers):** a skill isn't "done" until it's pressure-tested with a subagent baseline. Each build step ends with a test.

## Taxonomy (7 skills)

```
skills/
  authoring-measures/            (model-builder; ref: data-analyst, report-builder)
    SKILL.md
    references/
      dax-performance.md         DAX001–021 anti-pattern→rewrite + FE/SE engine model
      dax-query-rules.md         valid-query rules, qualify cols / unqualify measures, VAR/IFERROR/TREATAS authoring rules
      time-intelligence.md       date-table correctness, ~35-fn TI detector, lift-TI-to-outer-CALCULATE, target/comparison templates
      calc-groups.md             TMDL calculationGroup emission + TI item library + precedence
      advanced-templates.md      ABC/Pareto, RANKX, parent-child PATH, semi-additive, UDFs, 2025–26 fns
  modeling-semantic-model/       (model-builder; read: data-analyst)
    SKILL.md
    references/
      tmdl-grammar.md            syntax, indentation-depth table, enum sets, emission gotchas, file layout, partition templates
      columns-relationships.md   column rules + relationship rules + keys
      naming.md                  naming conventions + detection regexes
      rls.md                     RLS principles + filter library + TMDL role syntax + OLS
      power-query-m.md           folding catalog (folds/breaks/sometimes), safe write order, recipes
      ai-readiness.md            Q&A/AI model-prep checklist + valid-but-AI-hard nuance
  designing-reports/             (report-builder; ref: data-analyst)
    SKILL.md
    references/
      layout-grid.md             3-30-300 gradient, arithmetic spacing algorithm, size tables, default templates
      theme-cascade.md           4-level cascade, theme keys, container-name gotchas, compliance audit
      kpi-cards.md               card doctrine, display-unit algorithm
      tables.md                  table-vs-matrix, column order, CF strategy, auto-size gotcha
      chart-selection.md         question→visual matrix + analytical patterns (funnel/cohort) + architecture (medallion/Direct-Lake/M2M)
      audience-styles.md         exec/analyst/ops archetypes + storytelling + maturity ladders
  authoring-svg-visuals/         (report-builder)
    SKILL.md
    references/
      svg-doctrine.md            mechanism (data:image/svg, cardVisual, dataCategory), VAR structure, normalization, escaping/hex-#, <desc> sort, 32K limit
      extension-measures.md      reportExtensions.json schema, Text dataType, empty-file-delete rule
    scripts/
      examples/                  the 12 example measures as .dax (boxplot, bullet, sparkline, waterfall…)
  reviewing-models/              (model-reviewer)
    SKILL.md
    references/
      check-catalog.md           BPA semantic-rule catalog + grain/relationship/M:M/date-table heuristics + four-layer validation taxonomy
      output-format.md           severity scale, findings template, deterministic-first + safety-fixing rules
  reviewing-reports/             (report-reviewer)
    SKILL.md
    references/
      check-catalog.md           6 dimensions + design/binding/a11y/perf checklists + report-BPA + PBIR lineage checks
      output-format.md           severity + P0–P3 matrix, two-stage review
  planning-dashboards/           (data-analyst)   ← +1 beyond the accepted 6 (see open item)
    SKILL.md
    references/
      intake-protocol.md         clarifying-question protocol, audience framing, propose-before-building, sensible-defaults
      metric-contract.md         KPI definition contract + thresholds lint, hypothesis framing, primary/secondary/guardrail, ICE
      model-discovery.md         INFO.* progressive discovery + anti-fabrication grounding invariant
```

## Reference → primary source (exact per-row paths live in ADOPTION-MAP)
| Reference file | Primary source(s) | Action |
|---|---|---|
| authoring-measures/dax-performance.md | ruiromano dax-performance-optimization.md (dup dg3) | adopt |
| authoring-measures/dax-query-rules.md | ruiromano dax-query-guidelines.md + dg3 dax SKILL | adopt |
| authoring-measures/time-intelligence.md | dg3 + ruiromano (detector) + dg2 (targets); merge existing `pbi-date-intelligence` | adopt |
| authoring-measures/calc-groups.md | dg4 (DAX items) + skills-for-fabric/powerbi-master (TMDL) | adopt |
| authoring-measures/advanced-templates.md | awesome-copilot MEASURES-DAX + powerbi-master dax-patterns-advanced | adapt |
| modeling-semantic-model/tmdl-grammar.md | skills-for-fabric tmdl-authoring-guide (first-party) + dg1 object-properties + ruiromano TMDL.md | adopt |
| modeling-semantic-model/columns-relationships.md | dg1 column-properties + ruiromano modeling-guidelines | adopt |
| modeling-semantic-model/naming.md | dg3 naming-rules | adopt |
| modeling-semantic-model/rls.md | awesome-copilot RLS.md + dg4/skills-for-fabric TMDL role syntax | adopt |
| modeling-semantic-model/power-query-m.md | dg3 power-query/best-practices + skills-for-fabric dataflows | adopt |
| modeling-semantic-model/ai-readiness.md | dg3 ai-readiness.md | adopt |
| designing-reports/layout-grid.md | dg2 pbi-report-design (layout) | adopt |
| designing-reports/theme-cascade.md | dg2 modifying-theme-json + agent-skills-design-breadth (theory) | adopt |
| designing-reports/kpi-cards.md | dg2 cards-and-kpis | adopt |
| designing-reports/tables.md | dg2 tables-and-matrices | adopt |
| designing-reports/chart-selection.md | dg2 + awesome-copilot + claude-skills (patterns) + skills-for-fabric (architecture) | adopt |
| designing-reports/audience-styles.md | claude-skills + awesome-copilot + antigravity | adapt |
| authoring-svg-visuals/* | dg2 svg-visuals (+ dg1 reportExtensions) | adopt |
| reviewing-models/* | dg3 semantic-model-auditor + dg1 pbip-validator + powerbi-master taxonomy + BPA catalog | adopt |
| reviewing-reports/* | dg2 review-report + powerbi-agentic report-BPA + agent-skills-design-breadth | adopt |
| planning-dashboards/* | claude-skills-data-analytics + dg2 vague-prompts + skills-for-fabric INFO.* | adapt |

## Agent → skill wiring (`skills:` frontmatter)
| Agent | Loads skills | Notes |
|---|---|---|
| data-analyst | planning-dashboards, modeling-semantic-model (read), designing-reports (ref) | read-only; produces DashboardSpec |
| model-builder | authoring-measures, modeling-semantic-model | gated by gate-measure-create |
| model-reviewer | reviewing-models | read-only |
| report-builder | designing-reports, authoring-svg-visuals | one page per invocation |
| report-reviewer | reviewing-reports | read-only |

## Unchanged by this taxonomy (carry over from ADOPTION-MAP)
- **Pipeline skills** (`pbi-build/modify/fix-model/audit`) — already task-named; keep, lean SKILL.md.
- **Thin CRUD skills** (`pbi-report/pages/visuals/themes/filters/bookmarks/layout/setup/status/validate`) — wrap MCP tools; keep.
- **Hooks** (gate-measure-create, gate-data-analyst-readonly, block-destructive-commands/secrets/pnpm, config) — ADOPTION-MAP Infra/Model.
- **MCP/engine** (bpa.ts, pbi_dax_reference_check, pbi_model_check, pbi_visual_bind, pbi_spec_validate) — ADOPTION-MAP.
- **Packaging** (plugin.json, marketplace.json, catalog/index) — ADOPTION-MAP Infra.

## Migration from existing skills (16 on disk)
| Existing | Disposition |
|---|---|
| `pbi-measure-architect` | → `authoring-measures` (its DAX synthesis becomes the SKILL.md core + advanced-templates ref) |
| `pbi-date-intelligence` | → `authoring-measures/references/time-intelligence.md` (absorb) |
| `pbi-layout` (knowledge) | design knowledge → `designing-reports/references/layout-grid.md`; keep mechanical layout ops as CRUD |
| `pbi-themes` (knowledge) | theme knowledge → `designing-reports/references/theme-cascade.md`; keep theme-apply as CRUD |
| `pbi-scaffold*` (4) | → internal recipes (per v6), retire as standalone skills |
| `pbi-report/pages/visuals/filters/bookmarks/status/validate/init-config` | keep as thin CRUD |

## Build sequencing (P0 → P2; aligns with v6 "hard gates first, then foundations")
Hard gates (TMDL annotation parsing, dax-reference-check, gate-measure-create, visual_bind, BPA core) proceed per v6 — those are MCP/hook work, not skills. Skill foundations then build in this order:
1. **authoring-measures** + **modeling-semantic-model** (model-builder's knowledge) — P0/P1.
2. **reviewing-models** — P1.
3. **designing-reports** + **authoring-svg-visuals** — P1.
4. **reviewing-reports** — P1.
5. **planning-dashboards** — P1.
Per skill: write lean SKILL.md → fill `references/` from ADOPTION-MAP source paths (de-hardcode every name) → add `scripts/` if any → **pressure-test with a subagent baseline** → commit.

## Testing (superpowers Iron Law)
Each skill ships only after a baseline pressure scenario shows the gap and a with-skill run shows compliance. Discipline-ish skills (reviewing-*, authoring-measures' anti-patterns) get rationalization tables; reference-heavy skills get retrieval/gap tests.

## Open items (decide before scaffolding)
1. **`pbi-` prefix** on the 7 new skill names? Recommend **no** (clean verb names; plugin namespaces; existing CRUD skills stay `pbi-*`). Reversible find/replace.
2. **`planning-dashboards`** as a 7th skill vs folding the analyst protocol into the data-analyst agent body. Recommend **skill** (the KPI/metric-contract content is reused by report-builder, and it's testable).
3. **`time-intelligence`** lives as a reference under `authoring-measures` (chosen) — confirm vs. keeping the existing `pbi-date-intelligence` as a standalone skill.
