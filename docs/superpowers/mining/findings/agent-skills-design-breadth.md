# Mining findings: practicalswan/agent-skills — design/UX + breadth
Source: agent-skills.xml

## Relevance summary
Richer than expected on the **design axis**. The five design skills (`canvas-design`, `frontend-design`, `premium-frontend-ui`, `web-design-reviewer`, `stitch-design`) plus `codebase-to-course/design-system` carry a substantial body of *transferable* visual-design theory — Gestalt principles, visual hierarchy, spacing/grid systems, color theory + harmony, WCAG a11y thresholds, type pairing/scale, elevation models, and design-review checklists — that maps cleanly onto our `layout-patterns`, `theme-cascade`, `kpi/table-design-rules`, `audience-styles`, and report-reviewer. The implementation layer (Tailwind/React/shadcn/Stitch-MCP/GSAP/Remotion) is web-runtime and reference-only. Everything else in the repo (~45 dirs: cloud patterns, language stacks, testing, devops, MCP/agent meta, electronics) is LOW relevance and discarded. Net: ~6 high-value design extractions + 1 process-pattern note; the rest discarded.

## High-value extractions

### Gestalt + visual-hierarchy + alignment/whitespace principles → maps to layout-patterns, report-reviewer
- What it is: A clean, medium-agnostic statement of the fundamentals that govern any visual canvas — directly applicable to laying out report pages and grading them.
- Key content (transferable, paste-ready as rules):
  - **Proximity spacing tiers**: related elements 4–8px; grouped sections 24–48px; major sections 64–96px. ("If something looks off, check alignment first.")
  - **Similarity**: every element of the same role shares one visual treatment (all primary KPIs identical; break similarity *intentionally* to create a single focal point — e.g. one accent-colored card in a grid of neutral cards).
  - **Figure/ground**: elevate focal content with subtle shadow / dimmed backdrop (modal/overlay logic → applies to spotlight cards, drill-through panels).
  - **Visual hierarchy levers**: size, weight, color-contrast, position. "A viewer should identify the #1/#2/#3 most important elements within 3 seconds." Top-left scanned first (LTR); F- and Z-pattern.
  - **Alignment rule**: every element must be visually anchored to at least one other via a shared edge/axis. Right-align numeric columns.
  - **Whitespace**: line-height 1.5–1.75x; "when in doubt add whitespace — cramped feels amateur, generous feels premium." Macro vs micro whitespace.
  - **8px spatial grid**: all dimensions/spacing snap to multiples of 8 (padding 8/16/24/32; radius 4/8/12/16) — scales cleanly across DPI. 12-column grid divides by 1/2/3/4/6/12.
  - **Principle review checklist** (12 items: proximity, similarity, closure, continuity, figure/ground, hierarchy, balance, contrast, repetition, alignment, whitespace, type, grid).
- Source: `canvas-design/references/design-principles.md`
- Quality: 5 — concise, concrete numeric values, framework-free.
- Recommendation: adapt (translate px tiers to PBI report units; the principles + the 12-item checklist are gold for report-reviewer).

### Color psychology + harmony + industry palettes + 60-30-10 → maps to theme-cascade, audience-styles, kpi-design-rules
- What it is: A practical color reference: emotional/cultural associations, harmony types, ready industry palettes, and accessibility-aware status colors.
- Key content (transferable):
  - **Finance palette caution**: red implies *loss* — avoid red as a general accent on financial dashboards; reserve it for alerts/negative. Green = profit/growth. Blue = "safest", trust/enterprise. (Directly relevant to KPI conditional formatting + exec themes.)
  - **Harmony types** for building a palette: complementary (one must dominate — never equal proportion), analogous (calm, add a neutral for contrast), triadic/tetradic (rich — good for *data-viz* multi-series, but let one dominate), monochromatic (elegant, add one accent).
  - **60-30-10 distribution** (dominant/secondary/accent) — appears in 3 skills; a strong default for theme construction and page composition.
  - **Status palette that survives color-blindness**: success #38A169 + check icon, warning #D69E2E + triangle, error #E53E3E + cross, info #3182CE + info icon. ~8% of men have CVD; **never encode meaning by color alone** — pair with icon/label/pattern. Avoid red/green-only status (deuteranopia).
  - **Pure yellow fails WCAG on white** — darken to #92700C+ for text/labels.
  - Industry starter palettes (Finance/SaaS/Health/Education) with hex — useful seed sets for `audience-styles`.
- Source: `canvas-design/references/color-psychology.md`
- Quality: 5 — but the specific hex sets are *seed examples*, NOT defaults to hardcode (flag below).
- Recommendation: adapt (encode as principles + a *generator* approach in theme-cascade; do NOT bake the example hexes in as the only palette).
- HARDCODING FLAG: tempting to lift the industry hex palettes verbatim. Per project rule, theme-cascade must remain dataset/brand-agnostic — treat these as illustrative seeds chosen by harmony rules, not fixed values.

### Typography pairing + modular type scale + elevation model → maps to theme-cascade, kpi/table-design-rules
- What it is: Rules for type hierarchy and depth that translate to PBI text classes, KPI typography, and card elevation.
- Key content (transferable):
  - **Limit to 2 typefaces** (heading + body), 3 absolute max; contrast in structure, harmony in quality; match x-heights.
  - **Modular type scale** ratios from a 16px base: Minor Third 1.2, Major Third 1.25, Perfect Fourth 1.333, Golden 1.618 — pick one ratio and derive the whole scale (consistent heading sizes across report pages).
  - **Weight ladder**: 600–700 headings, 500 interactive/labels, 400 body, 300 large-display only.
  - **Color-as-hierarchy**: near-black primary text, gray-600 secondary, gray-400 metadata/disabled.
  - **Elevation as discrete levels** (from the philosophy example): L0 page (no shadow) → L1 cards `0 1px 3px /.06` → L2 popovers `0 4px 12px /.08` → L3 modals `0 8px 24px /.12` + overlay. Pair with `codebase-to-course` rule: **use warm-tinted RGBA shadows, never pure black**.
  - Premium type bar: massive scale contrast for hero/headline numbers vs crisp 16px+ body (relevant to big-number KPI cards).
- Source: `canvas-design/references/design-principles.md`, `canvas-design/examples/design-philosophy-example.md`, `premium-frontend-ui/SKILL.md`, `codebase-to-course/references/design-system.md`
- Quality: 4 — type scale + elevation tiers are directly reusable; premium "12vw clamp" sizing is web-only.
- Recommendation: adapt.

### Visual-inspection checklist + P0–P3 priority matrix + two-stage review → maps to report-reviewer
- What it is: A high-signal QA checklist and a severity rubric for visual review — almost directly portable to a report-reviewer agent.
- Key content (transferable):
  - **Categories**: layout/overflow/alignment, typography/readability (40–80 chars per line; 16px+ body; clear heading hierarchy; no clipping), color/contrast (4.5:1 / 3:1 thresholds; unified brand/error/success colors), interactive states, color-vision-diversity ("info conveyed by shape+text not just color; charts consider CVD").
  - **Priority matrix**: P0 critical (overlap, content disappearance) / P1 high (unreadable text, inoperable control) / P2 medium (alignment, spacing inconsistency) / P3 low (minor color/position) — a ready severity scheme for reviewer output.
  - **Two-stage review workflow**: capture current state → fix source → re-check the same views. (PBI analog: snapshot/inspect report JSON → fix → re-validate.)
  - Anti-pattern shared across skills: "fixing content and presentation in one pass" — separate structural vs visual passes.
- Source: `web-design-reviewer/references/visual-checklist.md`, `web-design-reviewer/SKILL.md`
- Quality: 5 — the checklist + P0–P3 matrix are the single most reusable artifact for our reviewer.
- Recommendation: adapt (drop responsive/browser/Playwright items; keep layout/typo/contrast/CVD/priority-matrix).

### Audience-driven "design philosophy" document template → maps to audience-styles, bi-pattern-library
- What it is: A worked end-to-end design brief (recipe app) whose *structure* is an excellent template for codifying exec/analyst/ops report styles.
- Key content (transferable structure + ideas):
  - Flow: **Core Intent → Guiding Principles → Aesthetic Direction (color/type/spatial/elevation/iconography/radius/motion) → Inspirations → Anti-Patterns → Philosophy→UI Translation (concrete component sketches) → Living Document**.
  - Each design choice is a **table with role + value + rationale ("why")**; "every decision must be traceable to a principle, or the decision is wrong / a new principle is needed."
  - Transferable principles: **Clarity over cleverness** (find key info <2s), **progressive disclosure** (default view minimal; details collapsible — maps to drill-through/tooltips/bookmarks), **warm empty states** (encouraging copy + clear next action — maps to no-data report states), large touch targets, icon+label never icon-only.
  - **Explicit anti-pattern table** (auto-play, low-contrast text, icon-only nav, infinite scroll, decorative-over-content) — a model for an audience-styles "don't" list.
- Source: `canvas-design/examples/design-philosophy-example.md`, `canvas-design/SKILL.md`
- Quality: 5 — the template is the value; recipe content is throwaway.
- Recommendation: adapt (use as the skeleton for each audience persona doc in `audience-styles`).

### Design-token extraction → structured DESIGN.md format + categorical "actor colors" → maps to theme-cascade
- What it is: A repeatable workflow to *extract* design tokens and emit a structured token document, plus a categorical-palette idea for series colors.
- Key content (transferable):
  - **Token doc structure**: Brand identity/personality → Color palette (Primary/Neutral/Semantic, each row = name + hex + role) → Type scale (size/weight/line-height/usage) → Component styles → Layout principles → Spacing scale. (A ready schema for theme-cascade output / theme JSON documentation.)
  - **Extraction workflow**: retrieve → extract tokens → translate raw values into descriptive design language (name + hex + role + *why*) → synthesize. ("Define the Atmosphere" with evocative adjectives before picking colors.)
  - **"Actor colors"** (`codebase-to-course`): assign each major entity its own *mutually distinguishable* categorical color, kept distinct from the accent — exactly the requirement for Power BI categorical/series palettes (dataColors). Plus **alternating section backgrounds** for visual rhythm.
- Source: `stitch-design/examples/design-system-example.md`, `stitch-design/SKILL.md`, `codebase-to-course/references/design-system.md`
- Quality: 4 — schema + actor-color concept transfer well; Stitch-MCP/shadcn `:root` CSS-var mechanics are reference-only.
- Recommendation: adapt (token-doc schema + categorical-color rule), reference-only (CSS/shadcn specifics).

### Accessibility thresholds worth enforcing in PBI reports → maps to report-reviewer, kpi/table-design-rules
- What it is: WCAG 2.2 numbers and color-independence rules that apply to any visual artifact, including dashboards.
- Key content (transferable, the rest is HTML/ARIA → reference-only):
  - Contrast: normal text 4.5:1, large text (≥18pt/14pt bold) 3:1, **UI components/graphical objects 3:1** (covers chart elements, borders, KPI text).
  - **Min target size 24×24 CSS px (WCAG 2.2)** / 44×44 recommended — relevant to interactive report buttons/slicers.
  - Color independence: errors/status identified in **text, not color alone**; left-border/icon + color, not color alone.
  - Logical heading hierarchy, no skipped levels (maps to report title/section heading consistency).
- Source: `frontend-design/references/accessibility-checklist.md`, `frontend-design/SKILL.md`
- Quality: 3 — most of the file is React/ARIA/keyboard code (reference-only); the thresholds + color-independence are the keepers.
- Recommendation: reference-only for the code; adopt the numeric thresholds + color-independence rule.

## Process-pattern note (worth flagging, not design)
- Every SKILL.md in this repo shares a **consistent authoring template**: YAML frontmatter (name/description/version/tags) → "Use when…" symptom→action triggers (description states *when*, never *what*) → body → **Anti-Patterns section placed immediately before the quality checklist** → **Verification Protocol** (pass/fail checks + one pressure-test scenario + a measurable success metric: "zero untested success claims; every claim maps to a command/artifact") → Portability/MCP-fallback → Related Skills. `writing-skills` frames skill creation as **TDD (RED-GREEN-REFACTOR)**: run a baseline pressure scenario and watch an agent fail *before* writing the skill; token budgets (technique 300–700w, pattern 250–600w, reference 150–350w in SKILL.md). `documentation-quality`: active voice, present tense, document error scenarios, no vague descriptions.
- Source: all `*/SKILL.md`, `writing-skills/SKILL.md`, `documentation-quality/references/writing-standards.md`
- Recommendation: reference-only — a sensible house style for our own skill docs (verification-protocol + anti-patterns-before-checklist + "Use when" triggers are worth mirroring). Likely overlaps with the skills-authoring sources mined by the sibling/other agents.

## Cross-source overlap flags
- **60-30-10 rule, WCAG 4.5:1/3:1 thresholds, and "never color alone / CVD-safe status palette"** appear in 3+ skills here and will almost certainly recur in any other design-oriented source (e.g. data-goblin reports plugin, awesome-copilot UI guidance). Consolidate into ONE theme-cascade/a11y rule set; cite once.
- **Design-token document schema** (color rows = name+hex+role; type scale table) overlaps conceptually with Power BI **theme JSON** structure mined by the powerbi-modeling/reports sibling agent — reconcile so theme-cascade has a single canonical token→theme.json mapping.
- **"Actor/categorical colors"** concept overlaps with Power BI `dataColors`/series-palette guidance the data sibling agent likely captured — merge.
- **SKILL.md authoring template + TDD-for-skills** overlaps heavily with skills-authoring/meta repos (claude-skills-borghei, antigravity-awesome-skills, awesome-copilot-meta) — defer canonical version to those; do not duplicate.
- **Elevation/shadow tiers + warm-tinted shadows** may overlap with any "premium UI" guidance elsewhere; keep one elevation ladder.

## Discarded / not relevant (substantial — most of the repo)
- **cloud-design-patterns/** (anti-corruption layer, BFF, gateway aggregation/routing/offloading, messaging, reliability) — backend architecture, zero design transfer.
- **react-development/, nextjs-development/, vite-development/, javascript-development/** — hooks galleries (useDebounce/useFetch/useMediaQuery…), JSX/App-Router patterns, build config. Pure web-runtime code; non-Node-PBI; reference-only at best, discarded.
- **frontend-design tailwind-component-patterns + button/responsive code, premium-frontend-ui motion system (GSAP/Lenis/Framer/R3F, scroll narratives, magnetic cursors, parallax), stitch shadcn-components + stitch-mcp-commands + Remotion video** — implementation-specific to web/MCP toolchains; the *principles* were extracted above, the code is discarded.
- **web-testing/** (Playwright page objects, e2e specs, selectors) and **web-design-reviewer Playwright MCP mapping** — browser E2E automation; not applicable to TS/PBI authoring (kept only the visual checklist + priority matrix).
- **Language/stack skills**: sql-development, mysql/tsql, mongodb-mongoose, php-development, java-docs/junit, csharp-xunit, dotnet-best-practices, microsoft-development, azure-integrations, cloud — out of scope (sibling agent owns SQL/modeling; rest irrelevant).
- **Agent/process meta**: agent-task-mapping, agentic-eval, subagent-delegation/-driven-development, dispatching-parallel-agents, custom-agent-usage, executing-plans, writing-plans, systematic-debugging, TDD, code-review skills, serena-usage, using-git-worktrees, verification-before-completion — general dev process; not design; the one cross-cutting authoring/verification pattern is noted above.
- **Docs/office/misc**: documentation-authoring/-automation/-patterns/-verification, notion-docs, jupyter-notebook, excel-sheet, spreadsheet-formula-helper, powerpoint-ppt, word-document, pdf, codebase-to-course (kept only its design-system tokens + actor-colors), notebooklm-management — content-tooling, not visual design.
- **Security/other**: secret-scanning, security-review, infostealer-malware-detector, breaking-changes-management, code-quality, code-examples-sync, avoid-ai-writing, brainstorming, **legacy-circuit-mockups** (6502/EEPROM/breadboard electronics!) — entirely unrelated.
