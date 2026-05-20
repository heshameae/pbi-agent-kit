# Mining findings: data-goblin reports plugin (design/visuals/themes/review)
Source: dg2-reports.xml

## Relevance summary
This is the single richest source mined so far for our report-design surface area. Nearly every focus skill has a near-1:1 counterpart here: `pbi-report-design` (layout/KPI/table/color rules) maps to layout-patterns + kpi-design-rules + table-design-rules; `modifying-theme-json` maps to theme-cascade; `svg-visuals` maps to svg-dax-patterns; `deneb-visuals` maps to bi-pattern-library/report-builder; `review-report` + `best-practices.md` map to report-reviewer. The content is dataset-agnostic, principle-driven, and includes concrete numeric grids, theme JSON key tables, copy-pasteable DAX SVG conventions, Vega-Lite spec patterns, and reviewer checklists. The Python/R visual skills are non-Node (matplotlib/ggplot2 PNG) and reference-only. The pbir-cli command surface is Python-tool-specific but the underlying PBIR JSON structures and property catalogue are directly reusable for our TS MCP tools.

## High-value extractions

### 3-30-300 detail-gradient layout rule → maps to layout-patterns / report-builder
- What it is: the foundational page-layout principle used everywhere in this plugin. Most important + least detailed top-left; least important + most detailed bottom-right.
- Key content (verbatim grid):
  - 3s = headline insight = KPIs/cards/titles top-left; 30s = context/trends = charts middle; 300s = granular detail = tables/matrices bottom-right.
  - Zone table: Zone 1 Summary (cards/kpi/slicers) height 150-200px; Zone 2 Analysis (charts/maps/gauges) 350-450px; Zone 3 Detail (tableEx/pivotTable) 350-450px.
  - Zone y-bands for 1280x720: Zone1 y:24-200, Zone2 y:216-600, Zone3 y:616-bottom.
- Source: `pbi-report-design/references/layout-guidelines.md`, `pbir-cli/references/layout.md`, `review-report/references/best-practices.md`
- Quality: 5 — consistent across 3 files, concrete numbers.
- Recommendation: adopt-as-is

### Symmetrical spacing + arithmetic position calculation → maps to layout-patterns
- What it is: the most-cited quality signal — equal gaps everywhere, computed arithmetically (not eyeballed). This is exactly the kind of deterministic rule our report-builder/MCP layout tool should enforce.
- Key content (verbatim algorithm):
  ```
  content_width = page_width - (2 * margin)
  total_gaps = gap * (num_visuals_in_row - 1)
  visual_width = (content_width - total_gaps) / num_visuals_in_row
  ```
  - Worked example: 4 visuals, 1280px page, margin=24, gap=16 → content=1232, gaps=48, width=(1232-48)/4=296 → x positions 24, 336, 648, 960.
  - Margins: 24-32px all sides equal. Gap: 16px min, 24px recommended. Grid: 8px or 16px increments.
  - **Vertical column alignment across rows (critical):** when rows share a vertical split, the gap position must align top-to-bottom even when visual widths differ. "Visuals close but not quite aligned" (4-8px off) is flagged as jarring.
  - Verification check: `visual_B.x - (visual_A.x + visual_A.width)` must be identical for all adjacent pairs.
- Source: `pbi-report-design/references/layout-guidelines.md`, `pbir-cli/references/layout.md`
- Quality: 5 — directly codifiable as a validation rule.
- Recommendation: adopt-as-is (encode as a layout validator/auto-layout helper in our MCP)

### Page dimensions + common visual sizes table → maps to layout-patterns
- Key content:
  - Page sizes: Standard 1280x720 (16:9 default), Full HD 1920x1080, Letter 816x1056 (portrait), 4:3 1280x960, Tooltip ~320x240.
  - **Always query actual page dims before placing/resizing — do not assume 1280x720.** When resizing via object model, set width/height before x/y to avoid out-of-bounds intermediate states.
  - Visual sizes: Card/KPI 200-300w x 100-150h (min 130px height for value+label); Chart small 400x300, medium 600x400, large 900x500, full-width content_width x 400-500; Table/Matrix content_width x 300-500; Slicer horizontal 200-400 x 56-80, vertical 150-200 x 200-400.
  - Title: x:24 y:24, 400-600w x 48-64h, 24pt bold; subtitle x:24 y:64-72, 32-48h, 14pt.
- Source: `layout-guidelines.md`, `pbir-cli/references/layout.md`
- Quality: 5
- Recommendation: adopt-as-is

### Worked executive-dashboard layout with spacing verification → maps to layout-patterns / report-builder default
- What it is: a fully-worked 1280x720 layout (title + 3 KPI row + trend/breakdown + full-width table) with arithmetic spacing proof. Excellent as our report-builder's default "executive dashboard" template.
- Key content (verbatim spacing proof):
  ```
  Title bottom:  16+56 = 72.   Gap to KPIs:   88-72  = 16  [ok]
  KPI bottom:    88+160= 248.  Gap to charts: 264-248 = 16 [ok]
  Chart bottom:  264+220=484.  Gap to table:  500-484 = 16 [ok]
  Table bottom:  500+196=696.  Bottom margin: 720-696 = 24 [ok]
  Left margin: 24. Right edge 24+1232=1256. Right margin 1280-1256=24 [ok]
  ```
  - Layout patterns also given for: "KPI row + 2 charts + table" (standard dashboard), "Main + supporting" (left 2/3 chart + stacked right 1/3), "KPI-heavy 2x2 grid + full-width trend".
  - Time-granularity inference table (filter context → trend grain): Year filter → Monthly; Quarter → Monthly/Weekly; Month → Daily/Weekly; No date filter → Monthly/Quarterly. Default to monthly if unsure.
- Source: `create-pbi-report/references/layout-example.md`, `pbir-cli/references/layout.md`
- Quality: 5
- Recommendation: adopt-as-is (seed our report-builder default template + audience-styles "executive")

### KPI / card design rules → maps to kpi-design-rules
- What it is: comprehensive KPI card design doctrine. Maps almost verbatim to our kpi-design-rules skill.
- Key content (rules + the load-bearing ones):
  - Every KPI must answer two questions: "Is this good or bad?" (target + gap) and "Is it getting better or worse?" (trend). A bare number is forbidden.
  - **Max 5 KPIs per page** (working memory ~3-4 chunks; 4 ideal, 5 ceiling).
  - **Actionable vs vanity metric test:** "If this number changed 20%, should someone act differently?" If no, it hasn't earned space.
  - Three elements: Actual value (largest) + Target/comparison (smaller) + Gap/delta in BOTH absolute and % (e.g., "+35.4M (+7.3%)").
  - **Always label the target** via `goals.goalText` = "1YP" / "Budget" / "3M Avg".
  - Conditional formatting goes on the **gap, not the primary value**. Pair color with a secondary cue (arrow/icon) for accessibility.
  - Size hierarchy: headline number > gap (colored) > target/trend (muted).
  - Prefer `kpi` visual type over `card` when a target exists (built-in Indicator/Goal/TrendLine roles).
  - Round aggressively ("518M" not "517,893,412"). Hide redundant subtitle. Show EITHER title OR category label, not both.
  - Card min height 130-150px (increase height before shrinking font if clipped).
- Target-source table (dataset-agnostic DAX templates):
  | Source | When | DAX |
  |---|---|---|
  | Prior year (1YP) | default | `CALCULATE([Measure], DATEADD('Date'[Date], -1, YEAR))` |
  | Prior month/period | short-term ops | `CALCULATE([Measure], DATEADD('Date'[Date], -1, MONTH))` |
  | Budget/forecast | when budget exists | direct measure ref |
  | Rolling avg | smoothing | `CALCULATE([Measure], DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -3, MONTH))` |
- **Display-unit selection algorithm (very reusable):** pick largest unit where displayed integer part >= 1; aim for 2-3 visible digits; precision 1 if one digit (3.8M), precision 0 if 2+ digits (35bn, 338K). Percentages always None+precision1. WARNING: "Auto" display units break when measures have custom format strings — query the actual value first and set explicit units per visual. KPI `indicatorDisplayUnits` enum: 0=Auto(avoid),1=None,1000=K,1e6=M,1e9=B,1e12=T.
- Accessible sentiment colors: `good:"#2B7A78"`, `bad:"#D4602E"` (teal/orange instead of green/red).
- Source: `pbi-report-design/references/cards-and-kpis.md` (+ SKILL.md summary)
- Quality: 5 — includes a full anti-pattern table and a 10-item review checklist.
- Recommendation: adopt-as-is (the DAX is generic template syntax, not hardcoded fields)

### Table / matrix design rules → maps to table-design-rules
- What it is: deliberate table-design doctrine ("subtract, don't add").
- Key content:
  - Decision-making first: define (1) what question the table answers, (2) who reads it + what action, (3) essential columns only, (4) what to see first (sort).
  - **Table vs matrix:** use `matrix` (pivotTable) when 2+ categorical columns form a hierarchy (parent>child); `tableEx` for flat lists. Flat table with repeating parent values is a top anti-pattern.
  - Column order: row labels/hierarchy (left) → primary measure → secondary measures → variance/delta (right).
  - **Sort by most important measure (often variance) descending**, not alphabetically. Time-detail tables sort ascending by date.
  - Formatting philosophy = subtract: strip/minimize gridlines (horizontal only if any), remove banded rows (or 2-3% opacity), row padding 6-10px, header Segoe UI Semibold 10-12pt, value Segoe UI 10-12pt.
  - Tables show MORE precision than KPIs — use model format string, NO display units.
  - Conditional formatting strategically: **data bars on primary measure column**, **color scales on variance columns only** (red warm = under, blue cool = over; avoid green). "Formatting everything means formatting nothing."
  - **Turn off auto-size column width when the table shares a row with another visual** — auto-size can exceed the container and create a horizontal scrollbar (a bad practice). Full-width tables can keep auto-size. (`columnHeaders.autoSizeColumnWidth=false`)
  - Sparklines/SVG inline visuals add "improving or declining?" context. Min height 180-200px (header + 5-8 rows).
- Source: `pbi-report-design/references/tables-and-matrices.md`
- Quality: 5 — includes anti-pattern table + checklist.
- Recommendation: adopt-as-is

### Color / accessibility rules → maps to theme-cascade + kpi/table rules + report-reviewer
- Key content:
  - Prefer theme colors over hex in visuals: `{"ThemeDataColor":{"ColorId":1,"Percent":0}}`. Hex literals only inside extension measures.
  - Semantic token names returned by CF measures: `good`, `bad`, `neutral`, `minColor`, `midColor`, `maxColor` (theme maps tokens → hex, so changing theme cascades to all CF).
  - WCAG 2.1: text 4.5:1, large text (18pt+) 3:1, UI components 3:1. Contrast examples table provided.
  - Colorblind-safe pairings: Blue+Orange (instead of red/green), Blue+Yellow, dark/light same hue. Always pair color with a secondary cue (arrow/icon/text/shape).
  - Max 6-8 distinct colors per visual; 5-7 palette max; muted/desaturated; no pure black (use #333); reserve saturated colors for emphasis/alerts.
  - CF best practices: theme tokens over hex; measure-driven preferred; apply sparingly (variance/gap not raw); accessible; theme-first.
- Source: `pbi-report-design/references/visual-colors.md`, `review-report/references/best-practices.md`
- Quality: 5
- Recommendation: adopt-as-is

### Theme formatting cascade (4-level) → maps to theme-cascade (PRIME)
- What it is: the core mental model for our theme-cascade skill — exactly how PBI resolves visual formatting.
- Key content (verbatim cascade):
  ```
  Level 1  Power BI built-in defaults
  Level 2  Theme wildcard      visualStyles["*"]["*"]          (ALL visuals)
  Level 3  Theme visual-type   visualStyles["lineChart"]["*"]  (per type)
  Level 4  Visual instance     visual.json objects + visualContainerObjects (wins)
  ```
  - Core principle: push as much as possible into levels 2-3; visual.json should hold only field bindings, position, and CF. Bespoke level-4 overrides only for true one-offs.
  - Diagnose-why-it-looks-this-way: walk up the cascade 4→3→2→built-in.
  - **Both `objects` and `visualContainerObjects` in visual.json map to the SAME `visualStyles[type][state]` section in the theme** — the visual.json distinction doesn't exist in the theme.
- Source: `modifying-theme-json/SKILL.md`, `theme-authoring.md`
- Quality: 5
- Recommendation: adopt-as-is

### Theme JSON structure: top-level keys + textClasses + wildcard minimum → maps to theme-cascade
- Key content (theme top-level key table):
  | Key | Purpose |
  |---|---|
  | `name` | display name |
  | `dataColors` (string[]) | ordered series palette (6-12; first = primary; muted; colorblind-safe) |
  | `good`/`bad`/`neutral` (flat hex) | CF sentiment tokens (NOT nested under sentimentColors — root-level keys) |
  | `maximum`/`center`/`minimum` | gradient extremes |
  | `foreground` variants | foreground, foregroundLight, foregroundDark, foregroundNeutralSecondary |
  | `background` variants | background, backgroundLight, backgroundNeutral, backgroundDark |
  | `textClasses` | typography per role |
  | `visualStyles` | `[type][state]` cascade |
  | extras | `tableAccent`, `hyperlink`, `shapeStroke`, `accent` |
- textClasses roles + sizes: `title` 14-16pt, `header` 12-14pt, `label` 11-12pt, `callout` (KPI value) 28-36pt, `dataTitle` 12pt, `boldLabel` 12pt, `largeTitle` 20-24pt. **Gotcha: textClasses color is a plain hex string (`"color":"#343a40"`), NOT the `{"solid":{"color":...}}` wrapper used in visualStyles** — using the wrapper makes the color silently ignored.
- Minimum viable wildcard (`visualStyles["*"]["*"]`): `title` show+fontSize 14+Segoe UI Semibold+color; `background.show:false`; `border.show:false`; `dropShadow.show:false`; `padding` 8 all sides. Recommended additions: `subTitle.show:false`, `divider.show:false`, `visualHeader.show:true`, `outspacePane`/`filterCard` (filter pane).
- Critical visual-type overrides (suppress chrome): `textbox`, `image`, `shape`, `actionButton`. Container-name gotchas: `kpi` uses `trendline` (lowercase, not trendLine); `card` uses `labels.color` (not fontColor); `tableEx` uses `backColor` (not backgroundColor); `pivotTable` (not `matrix`); `slicer` uses `textSize` (not fontSize); `multiRowCard` bar via `card.barShow`.
- Fonts: Segoe UI / Segoe UI Semibold (short name in visualStyles/textClasses; long CSS stack only in outspacePane/filterCard). Supported font list enumerated (Arial, Calibri, Consolas, DIN, Georgia, Segoe UI variants, Tahoma, Times New Roman, Trebuchet MS, Verdana, etc.).
- Schema: `reportThemeSchema-2.{version}.json` (versioned monthly with Desktop; latest noted 2.152, Mar 2026); Draft 7; used verbatim by Desktop to validate on import. Add `$schema` for IDE validation.
- Source: `modifying-theme-json/SKILL.md`, `references/theme-authoring.md`, `references/visual-type-overrides.md`
- Quality: 5 — the container-name gotchas alone are high value for our binder/validator.
- Recommendation: adopt-as-is

### Theme-compliance audit + stale-override classification → maps to theme-cascade / report-reviewer
- What it is: a systematic workflow for detecting/removing redundant visual-level formatting (theme "drift"). Directly useful for our report-reviewer + a theme-compliance MCP tool.
- Key content:
  - Override classification: **Stale** (duplicates theme value → remove), **Conflicting** (differs, no reason → promote or document), **Intentional exception** (keep + annotate), **Conditional formatting** (always keep).
  - Severity: Critical (chrome differing across multiple same-type visuals; dropShadow.show:true when theme false; hardcoded hex in dataPoint not matching dataColors). Warning (padding/radius/axis-font differing). Suggestion (null/empty keys; props the visual doesn't render).
  - Fix decision tree: CF? keep. Matches theme? stale→remove. Differs + only visual needing it? exception. Differs + 3+ visuals? promote to visual-type theme override then remove.
  - Common stale patterns: title font duplicated; background.show:false when theme already disables; axis font locked from before a font change; shadow left on after theme change.
  - **Theme JSON files are 75KB+/2000+ lines — never read the full file**; serialize into small fragments (`_config.json`, `_wildcards.json`, per-type files) or use targeted `jq` key extraction.
- Source: `modifying-theme-json/references/theme-compliance.md`, `theme-authoring.md`
- Quality: 5
- Recommendation: adapt (workflow is tool-agnostic; our TS MCP can implement the classify/promote logic; jq examples are illustrative)

### SVG-via-DAX conventions → maps to svg-dax-patterns (PRIME, in-scope per task)
- What it is: the full doctrine for DAX measures returning inline SVG (`dataCategory: ImageUrl`). In scope per HARD RULES (SVG authored via DAX is allowed). Maps to svg-dax-patterns.
- Key content (load-bearing conventions):
  - Mechanism: DAX returns string prefixed `data:image/svg+xml;utf8,`; measure `dataCategory=ImageUrl`; stored as extension measure in `reportExtensions.json`.
  - Supported visuals + binding: Table `tableEx` / Matrix `pivotTable` via `grid.imageHeight`/`grid.imageWidth` (default 25h x 100w); Image `image` via `sourceType='imageData'` + `sourceField`; Card `cardVisual` via `callout.imageFX`; Slicer `advancedSlicerVisual` header images. **Classic `card` does NOT support SVG — use `cardVisual`.**
  - **VAR-based structure (mandatory):** CONFIG (inputs/scope/colors) → NORMALIZATION (scale to SVG coords) → SVG ELEMENTS (one VAR per shape) → ASSEMBLY (concatenate back-to-front) → RETURN.
  - **Axis normalization (critical):** raw values can't be pixel coords. Pattern: `_AxisMax = CALCULATE(MAXX(_Scope,[Measure]), REMOVEFILTERS('Table'[GroupCol])) * 1.1`; `_Normalized = DIVIDE(_Value,_AxisMax) * _AxisRange`. ALLSELECTED for slicer-responsive axis, ALL for fixed.
  - **HASONEVALUE guard** around table/matrix SVG to avoid evaluating on subtotal/total rows.
  - **`<desc>` sort trick:** embed `"<desc>" & FORMAT(_Value,"000000000000") & "</desc>"` so the image column is sortable by value.
  - Escaping/colors: single quotes for SVG attributes (avoid DAX double-quote escaping); double quotes in DAX escaped as `""`; **hex colors with `#` only — never `%23` URL-encoding (causes VisualDataProxyExecutionUnknownError in image visuals), never named colors**; `viewBox` for responsive scaling; `xmlns` required; no JavaScript.
  - SVG Y=0 at top — invert: `_Y = 100 - [Normalized]`. Elements render in document order (first=back).
  - CONCATENATEX for series: `CONCATENATEX(_Table, [X] & "," & (100-[Y]), " ", [Date], ASC)` → polyline points.
  - Limits: ~32K char limit on RENDERED string (not DAX); CONCATENATEX over 30+ rows easily exceeds — prefer polylines over dots, integer coords. No interactivity.
  - **Preview-first workflow:** query real values → write static SVG to `/tmp/mockup.svg` → open in browser → iterate → then convert to DAX. Round coords to 1-2 decimals for perf.
  - reportExtensions.json shape: `{ "name":"extension", "entities":[{"name":"<Table>","measures":[{"name":"...","dataType":"Text","dataCategory":"ImageUrl","expression":"...","displayFolder":"SVG Charts"}]}] }`. Bind via SourceRef `{"Schema":"extension","Entity":"<Table>"}`.
- Source: `svg-visuals/SKILL.md`, `references/svg-table-matrix.md`, `references/svg-elements.md`, `references/svg-image-visual.md`
- Quality: 5
- Recommendation: adopt-as-is (all DAX is generic template syntax)

### SVG element reference + ready-made measure patterns → maps to svg-dax-patterns
- What it is: SVG primitive cheat-sheet for DAX + 12 complete example measures.
- Key content: rect/circle/line/polyline/text/path(M,L,A,C,Q,Z)/group(translate,rotate,scale)/linearGradient/svg-container attribute tables (verbatim in svg-elements.md). Example measures (in `svg-visuals/examples/*.dax`): boxplot, bullet-chart (actual bar + target line + baseline + sentiment dot), dumbbell, ibcs-bar, jitter-plot, lollipop-conditional, overlapping-bars (+variance), progress-bar, sparkline (polyline+CONCATENATEX), status-pill, waterfall (OFFSET cumulative + connectors). Image-visual patterns: KPI header card, sparkline-with-endpoint-dot, multi-metric dashboard tile (with viewBox sizing table 300x60 KPI / 300x50 sparkline / 200x80 tile / 600x40 banner).
  - Data Bar (simplest): `<rect width=_W fill=_Color opacity=0.7 rx=2/>` + label text at x=_W+3.
  - Adaptive number-format SWITCH: `<=1E3 "#,0"`, `<=1E6 "#,0, K"`, `<=1E9 "#,0,, M"`, else `"#,0,,, B"`.
- Source: `svg-visuals/references/svg-elements.md`, `svg-visuals/examples/*.dax`, `references/svg-image-visual.md`
- Quality: 5
- Recommendation: adopt-as-is (extract the DAX snippets verbatim into svg-dax-patterns)

### SVG UDF-library awareness ("don't reinvent") → maps to svg-dax-patterns
- What it is: prefer existing DAX UDF libraries before writing custom SVG. Useful guidance to embed in our skill.
- Key content: PowerofBI.IBCS (Andrzej Leszkiewicz — IBCS bar/column/waterfall/P&L; daxlib.org/package/PowerofBI.IBCS); DaxLib.SVG (Jake Duddy — 3-tier Viz./Compound./Element. API: area/bars/boxplot/heatmap/jitter/line/pill/progressbar/violin; daxlib.org/package/DaxLib.SVG); PowerBI MacGuyver Toolbox (Stepan Resl/Data Goblins — C# scripts gen SVG measures; 20+ bar/14+ line/24+ KPI). Detection: look for functions starting `PowerofBI.IBCS.`, `Viz.`, `Compound.`, `Element.`. Libraries install into the model, not the report.
- Source: `svg-visuals/SKILL.md`, `references/community-examples.md`
- Quality: 4 — mostly external links; the "check before building" + detection heuristic is the reusable bit.
- Recommendation: reference-only (note libs; don't vendor)

### Deneb (Vega-Lite) spec patterns → maps to bi-pattern-library / report-builder
- What it is: declarative custom-visual patterns. In scope (TS/JSON, no Python runtime).
- Key content:
  - Visual identity: visualType `deneb7E15AEF80B9E4D4F8E12924291ECE89A`; must register in report.json `publicCustomVisuals` array or it shows "Can't display this visual." Bundled Vega 6.2.0 / Vega-Lite 6.4.1 (use `v6.json` schema). Single `dataset` data role. Default 10K row limit (`dataLimit.override`).
  - **Data binding differs:** Vega-Lite `"data":{"name":"dataset"}` (object); Vega `"data":[{"name":"dataset"}]` (array). Prefer Vega-Lite unless signals/events/force layouts needed.
  - **Field-name escaping is context-dependent:** standalone spec files use `datum["Field Name"]` (JSON double-quote escaping); INSIDE PBIR visual.json the whole spec is a single-quoted DAX literal so field names with spaces use DOUBLED single quotes `datum[''Field Name'']`. Special chars (`.[]\"`) → `_`; spaces preserved.
  - Theme integration: `pbiColor(0)` (theme color by index), `pbiColor(0,-0.3)` (darken), `pbiColor("negative"/"positive"/"bad"/"good"/"neutral")` sentiment; schemes `pbiColorNominal`/`pbiColorOrdinal`/`pbiColorLinear`/`pbiColorDivergent`.
  - Responsive (Vega): `"width":{"signal":"pbiContainerWidth - 25"}`, `"height":{"signal":"pbiContainerHeight - 27"}`. Config: `autosize:fit`, `view.stroke:transparent`, `font:Segoe UI`.
  - Interactivity flags (visual objects): `enableTooltips`(true), `enableContextMenu`(true), `enableSelection`(false→cross-filter via `__selected__`), `enableHighlight`(false→`<field>__highlight` fields). Runtime fields: `__row__` (replaces removed `__identity__`/`__key__` in 1.9), `__selected__`, `<field>__highlight`, `<field>__formatted`, `<field>__format`.
  - Ready spec patterns provided verbatim (vega-lite-patterns.md): vertical/horizontal bar (`sort:"-y"`/`"-x"`), bar with cross-highlighting (2-layer opacity), line (point+tooltip), area-fill, scatter, heatmap (rect+pbiColorLinear), donut (arc innerRadius), faceted bullet-with-target (window-rank top-10 + facet row + bar/tick/text layers), lollipop (rule+point layers), stacked bar, waterfall (chained window/calculate transforms), sparkline small-multiple (facet + width 200 height 30 + axis null).
- Source: `deneb-visuals/SKILL.md`, `references/vega-lite-patterns.md`, `references/vega-patterns.md`
- Quality: 5
- Recommendation: adopt-as-is (Vega-Lite specs are dataset-agnostic JSON templates)

### Report-review heuristics (6 dimensions + checklists) → maps to report-reviewer (PRIME)
- What it is: the structured report-evaluation framework. Maps directly to our report-reviewer agent (read-only, categorized findings).
- Key content:
  - **Reviewing philosophy:** an LLM can't assert a report "looks good"; provide observations/suggestions, ask if deviations are intentional, don't extrapolate. Best practices are defaults not mandates. Claude tends to UNDERESTIMATE font readability — always confirm sizes with the user. Watch for (Blank) values, repeating values, query errors when viewing.
  - Six dimensions: (1) Usage/adoption [production only], (2) Design/layout, (3) Data-model binding, (4) Performance, (5) Metadata/governance, (6) Accessibility/standards/docs. Scope to what's needed.
  - Lifecycle gate: Development (no usage data → design/binding/perf/a11y), Testing (+ verify testers using), Production (+ full usage/distribution/export).
  - **Design checklist (directly reusable, categorized):** page titles present; equal spacing; detail gradient; intentional+accessible color; consistent fonts; visual count ~12-15 max/page; no empty visuals (all bound); custom theme (not default); axes start at 0 unless intentional; default sort on all visuals; selection-pane labels; mobile layout if relevant; visual headers configured; intentional interactions; slicer Apply buttons for perf; synced slicers across pages.
  - Binding checklist: thin report (published model not embedded); all bindings resolve; extension measures sparingly; no orphaned refs; measures vs columns correct; no stray visual-level filters.
  - Severity scale: **Critical** (broken/security/unused-consuming-capacity), **High** (perf impacting users / major design violations / missing bindings), **Medium** (inconsistencies / partial a11y), **Low** (polish/style).
  - Findings output format (verbatim template): USAGE SIGNAL block + CRITICAL/HIGH/MEDIUM/LOW grouped with `[Category]` tags and specific locations + recommended fixes.
- Source: `review-report/SKILL.md`, `review-report/references/best-practices.md`
- Quality: 5 — our report-reviewer can adopt the dimensions, checklists, severity scale, and output format almost verbatim.
- Recommendation: adopt-as-is (drop the Python usage scripts; keep design/binding/a11y heuristics)

### Chart-selection / visual-vocabulary matrix → maps to bi-pattern-library / report-builder / report-reviewer
- What it is: question→visual-type decision tables (two versions). Core of bi-pattern-library.
- Key content (merged):
  | Question | Use | Avoid |
  |---|---|---|
  | Current value? | card/kpi (kpi if target) | gauge, pie |
  | Compare categories? | bar (horizontal preferred — labels readable) | pie >3, donut |
  | Trend over time? | line, area | bar (implies discrete) |
  | Composition? | stacked bar, treemap | pie >5 |
  | Distribution? | histogram, box plot (Deneb/SVG), swarm | default visuals |
  | Relationship? | scatter | line (implies sequence) |
  | Two periods? | slope, dumbbell (Deneb/SVG) | side-by-side bars |
  | Part-to-whole? | stacked 100%, waterfall | pie |
  | Cumulative effect? | waterfall | — |
  | Filter? | slicer/advancedSlicerVisual (max 3) | — |
  - Charting best practices: axes start at 0 except trend-focused line (note in subtitle if not); horizontal bars > vertical; avoid pie/donut (suggest small-radius donut if insisted); sort descending by value (ascending if negatives need attention, categorical for dates); data labels instead of axis ticks for bars (keep axis title).
  - Anti-patterns: pie >5 slices, dual-axis (misleading scales → small multiples), gauges, default interactions, too many macgyvered/custom visuals (maintenance burden).
  - Custom-visual routing: Deneb (interactive/Vega), SVG measures (inline table/card graphics), Python (matplotlib statistical), R (ggplot2 statistical). Always discuss with user before committing to custom.
- Source: `review-report/references/best-practices.md`, `pbir-cli/references/layout.md`
- Quality: 5
- Recommendation: adopt-as-is

### Reviewer sub-agent designs (deneb/svg/python/r) → maps to report-reviewer pattern
- What it is: four narrow read-only reviewer agents (model: sonnet, tools Read/Grep/Glob, output "PASS/FAIL per item, max 3 design suggestions, verdict READY|NEEDS CHANGES"). Good template for our report-reviewer's categorized-output style and for any per-visual-type validators.
- Key content: deneb-reviewer (10-item: schema, data-binding array/object, field-name escaping, responsive signals, config, pbiColor, encode blocks, tooltips, no external data). svg-reviewer (10-item: prefix, xmlns, viewBox, hex-#-only, single quotes, DAX `""` escaping, HASONEVALUE guard, dataCategory ImageUrl, VAR structure, Y-inversion; design: <32K chars, rounded coords, CONCATENATEX, muted colors). python-reviewer + r-reviewer = NON-NODE reference-only (validate plt.show()/print(p), no-dataset-creation, supported-libs allowlist, no networking, empty-data guard).
- Source: `agents/{deneb,svg,python,r}-reviewer.agent.md`
- Quality: 5 (deneb/svg), 3 (python/r — non-Node)
- Recommendation: adapt (deneb/svg checklists → our report-reviewer or dedicated validators; python/r reference-only)

### Conditional-formatting model + PBIR encoding → maps to report-builder / our pbi_visual_bind + theme-cascade
- What it is: the CF data model and the exact PBIR JSON encoding, useful for our MCP CF/bind tooling.
- Key content:
  - 5 CF types: Gradient (`FillRule` linearGradient2/3), Rules (`Conditional` Cases), Measure-driven (`Measure` + dataViewWildcard — PREFERRED), Data bars (`dataBars`), Icons. CF lives in `visual.objects` (NOT visualContainerObjects); identified by dataViewWildcard selectors / FillRule|Conditional / dataBars.
  - **Measure-driven CF preferred:** create DAX measure returning sentiment token, ensure theme sentiment colors exist, bind to `container.prop`. Color props (fill/color/fontColor/strokeColor) auto-wrapped in `{"solid":{"color":...}}`.
  - Common CF container.property targets table: `dataPoint.fill`/`strokeColor`, `labels.color`/`fontColor`, `values.fontColor`/`backColor`, `columnFormatting.fontColor`/`backColor`, `accentBar.color`, `value.color` (card), `referenceLabel.color` (kpi). Rule operators: gt/lt/gte/lte/eq/neq. Icon names: circle_red/yellow/green, arrow_up/right/down, flag_*, check, x, exclamation.
  - Generic CF measure example (dataset-agnostic): `IF([Revenue]>=[Target], "good", IF([Revenue]>=[Target]*0.8, "neutral", "bad"))`.
- Source: `pbir-cli/references/conditional-formatting.md`
- Quality: 5 — the container/property targets + measure-driven preference are directly useful.
- Recommendation: adapt (CLI commands are pbir-specific; the data model + container targets + encoding are reusable)

### PBIR visual.json / textbox / property catalogue → maps to our PBIR read/write/validate MCP tools
- What it is: the actual PBIR JSON shapes our TS tools read/write, plus a full property catalogue.
- Key content:
  - visual.json shape: top `name`, `visual.visualType`, `visual.objects` (chart props + CF), `visual.visualContainerObjects` (chrome: title/subTitle/background/border/dropShadow/divider/visualHeader — each `[{ "properties": { "<prop>": {"expr":{"Literal":{"Value":"..."}}} } }]`), `position` {x,y,width,height,z,tabOrder}, `$schema` (visualContainer/2.7.0). Literal value encoding examples: booleans `"false"`, numbers with `D` suffix (`"0D"`, `"25D"`), strings single-quoted inside (`"'imageData'"`).
  - Image-visual SVG binding (verbatim): `objects.image[0].properties` = sourceType `'imageData'` + transparency `0D` + sourceField (Measure SourceRef Schema extension) + effects `false`; needs NO query block.
  - Textbox paragraph structure: `general.paragraphs` literal holds a JSON-string of `[{"textRuns":[{"value":"...","textStyle":{"fontSize":"24pt","fontWeight":"bold","fontColor":"#333333"}}]}]`; supports multiple textRuns (mixed formatting) and multiple paragraphs.
  - **Property catalogue (very high value for our schema/validator):** 49 visual types, 15 universal containers (background, border, divider, dropShadow, general, lockAspect, padding, spacing, stylePreset, subTitle, title, visualHeader, visualHeaderTooltip, visualLink, visualTooltip) with property/type/constraint tables; per-type container index (e.g., kpi: goals/indicator/lastDate/status/trendline; cardVisual 394 props; lineChart 430 props; pivotTable: columnHeaders/columnFormatting/grid/values/sparklines/subTotals; tableEx: columnHeaders/columnWidth/grid/values/sparklines). 12,627 total property slots.
  - Entity (non-visual) objects: page (background/outspace/outspacePane/pageSize/filterCard/pageInformation), report (settings/section), theme (colors/textClasses).
- Source: `pbir-cli/examples/visuals/formatted/image-svg-measure.json`, `pbi-report-design/references/page-titles.md`, `pbir-cli/references/property-catalogue.md`
- Quality: 5
- Recommendation: adapt (the JSON shapes + property catalogue inform our PBIR types/validator; CLI discovery commands are pbir-specific)

### Vague-prompt handling + propose-before-building → maps to data-analyst / report-builder / audience-styles
- What it is: workflow for underspecified report requests. Maps to our data-analyst (plan) subagent.
- Key content: route here when prompt lacks 2+ of {specific measures, audience/decision context, structural prefs, formatting direction}. Ask 3 minimum questions: (1) what decisions does this support? (reveals audience+KPIs+detail level), (2) which 2-3 measures matter? (explore model if unknown), (3) style/brand prefs? (default to a professional theme). Sensible-defaults table (theme, executive-dashboard layout, 1280x720, model-driven KPI selection, monthly granularity, CF on variance only). **Always propose concretely via AskUserQuestion before building** — revising a plan is cheap, rebuilding visuals is expensive. Don't refuse/lecture; don't 10-question interview; don't ship generic-and-done.
- Source: `create-pbi-report/references/vague-prompts.md`, `create-pbi-report/SKILL.md`
- Quality: 5
- Recommendation: adopt-as-is (drop pbir-specific commands)

## Cross-source overlap flags
- **PBIR JSON format / visual.json / property catalogue / CF encoding** will overlap heavily with the pbip/pbir-format plugin (data-goblin) and any other report repo. Our pbir-format reference and MCP PBIR types should be the single source of truth — dedupe there. This repo's `references/fields-and-bindings.md`, `format-visuals.md`, `bookmarks.md`, `filters.md`, `visual-calculations.md`, `thin-report-measures.md` (not deep-read) likely overlap with pbip plugin content.
- **3-30-300 / spacing / KPI / table / color rules** appear in 3+ files WITHIN this repo (SKILL.md, references, review best-practices) — consolidate to one canonical layout-patterns + kpi-design-rules + table-design-rules each.
- **Theme cascade + sentiment tokens (good/bad/neutral)** overlaps with model-side CF guidance and with dax-patterns (CF measures). Coordinate the token vocabulary across theme-cascade, kpi-design-rules, table-design-rules, dax-patterns.
- **DAX target/time-intelligence templates** (1YP, rolling avg, DATEADD/DATESINPERIOD) overlap with our time-intelligence + dax-patterns skills — keep the canonical DAX there, reference from kpi-design-rules.
- **Reviewer-agent output format** (PASS/FAIL + max-3-suggestions + verdict; severity Critical/High/Medium/Low + [Category] tags) overlaps with model-reviewer/report-reviewer from the agentic-development repo — standardize one categorized-findings format across all our reviewer agents.

## Discarded / not relevant
- **python-visuals + r-visuals skills, scripts, and reviewer agents** — non-Node runtime (matplotlib/seaborn PNG, ggplot2 PNG). Per HARD RULES, runtime is out of scope. Kept only as reference-only notes (visualType `pythonVisual`/`scriptVisual` chrome is themeable; the reviewer-agent OUTPUT pattern is reusable). Discarded all .py/.R scripts and chart-patterns/ggplot2-patterns/community-examples for these.
- **review-report Python scripts** (get_report_usage.py, get_report_detail.py, get_report_distribution.py, performance_audit.py) and references (usage-metrics.md, distribution.md, performance.md, report-metadata.md, export-to-excel.md) — these hit Power BI/Fabric REST + DataHub/Graph APIs for live usage telemetry. Out of scope for an authoring plugin (we don't ship Python or call tenant APIs). The "usage is the ultimate success signal" framing is noted in report-reviewer but the implementation is discarded.
- **pbir-cli command surface** (cli-reference.md, create-new-report.md, converting-reports.md, exploration.md, serialize-build.md, audit-report.md, bpa.md, visual-groups.md, visual-presets.md, error-bars.md, reference-lines.md, add-image.md, add-new-visual.md, apply-theme.md) — these are usage docs for the Python `pbir` CLI, not our TS tooling. Discarded the command syntax; kept the underlying PBIR concepts/JSON where load-bearing (layout.md, conditional-formatting.md, property-catalogue.md extracted above).
- **Full theme color arrays** (DataGoblins2021.json ~600 hex entries, Fluent2-CY26SU03.json, CY24SU10.json, SqlbiDataGoblinTheme.json) — large palettes; we don't vendor specific themes (would be quasi-hardcoding). Kept only the dataColors design RULES (6-12, first=primary, muted, colorblind-safe) and the theme-key STRUCTURE. The "start from a valid base theme, never empty {}" guidance is noted.
- **K201-MonthSlicer example report** (bookmarks, pages, visual.json files, ~9k lines) — sampled the format (image-svg-measure.json) for structure; did not dump the example PBIR. Bookmark JSON files discarded (bookmarks are out of our core focus and flagged by this repo's own best-practices as fragile/use-minimally).
- **49 per-visual-type theme example .md files** (actionButton.md … waterfallChart.md) and **3 pbir-cli visualTypes .md** — captured the container-name gotchas and the visual-type-override INDEX (above); the per-type files are lookup detail better regenerated from `pbir schema` / the property catalogue than vendored. Discarded as bulk.
- **deneb examples/visual/*.json + spec/* + vega-patterns.md full + capabilities.md + pbir-structure.md + community-examples.md (170+ links)** — captured the Vega-Lite pattern library + identity + escaping + theme integration (above). The full Vega (non-Lite) patterns and 170+ external community links are reference-only; per provider policy we prefer Vega-Lite, so deep Vega is lower priority.
