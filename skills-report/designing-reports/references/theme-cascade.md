# Theme Cascade Reference

How Power BI applies visual formatting through a four-level cascade, what belongs in a theme JSON, the sentiment-color system, the compliance audit, and the per-visual-type container-name gotchas. Examples use generic placeholders (Sales, Region); the property names are real Power BI keys.

**Source:** Mined from the `modifying-theme-json` skill (`SKILL.md`, `theme-authoring.md`, `visual-type-overrides.md`, `theme-compliance.md`, `promoting-formatting.md`, `serialize-build.md`, and the `examples/visualTypes/*.md` container files for kpi/card/cardVisual/tableEx/pivotTable/slicer/multiRowCard) plus the `pbi-report-design` `visual-colors.md`.

## The 4-Level Formatting Cascade

Each level overrides the level above it:

```
Level 1  Power BI built-in defaults
         |
Level 2  Theme wildcard     visualStyles["*"]["*"]           applies to ALL visuals
         |
Level 3  Theme visual-type  visualStyles["lineChart"]["*"]   overrides wildcard for that type
         |
Level 4  Visual instance    visual.json objects +            overrides everything
                            visualContainerObjects
```

### Core principle

Push as much formatting as possible into levels 2 and 3. A well-designed theme keeps visual.json lean (field bindings, position, and conditional formatting only), makes global style changes a one-file edit, and gives new visuals correct defaults automatically. Level-4 overrides should exist only for true one-offs: content-specific formatting, a deliberate exception to the type default, or a conditional-formatting expression.

### Diagnosing why a visual looks the way it does

Walk *up* the cascade — level 4 always wins:

1. Check `visual.json` → `objects` and `visualContainerObjects`
2. Check theme `visualStyles["<type>"]["*"]` for that visual type
3. Check theme `visualStyles["*"]["*"]` wildcard
4. If absent everywhere, Power BI is applying a built-in default

## Reading and Editing Theme Files

**Never read a full theme JSON.** These files run 75KB+ and 2000+ lines. Two safe approaches:

- **Serialize/build (preferred).** Split the theme into small focused files, edit those, rebuild. Serialize to a folder *outside* `.Report/` (e.g. `/tmp/`) — PBIR validation hooks monitor `.Report/` and will flag the serialized fragments as invalid. The split produces `_config.json` (colors, text classes, named colors), `_wildcards.json` (wildcard styles), and one file per visual-type override. These fragments are small and safe to read directly.
- **Targeted `jq`.** When serialize/build is unavailable, extract only specific keys (`jq 'keys'`, `jq '.textClasses | keys'`, `jq '.dataColors'`, `jq '.visualStyles["*"]["*"] | keys'`). Never `cat`/`head`/Read the file.

For single-property changes (one color, one font size), edit directly rather than serializing.

## Top-Level Theme Keys

Design the color system in this order; color decisions cascade everywhere.

### 1. `dataColors`

The primary series palette, ordered most-used first. 6-12 colors recommended; fewer is more cohesive. Favor blue/orange/teal over red/green combinations so series stay distinguishable for color-blind users. Muted, desaturated tones beat saturated "screaming" colors.

```json
"dataColors": ["#1971c2", "#f08c00", "#2f9e44", "#ae3ec9", "#e03131", "#0c8599"]
```

### 2. Semantic (sentiment) colors — flat hex strings at the ROOT

These are individual keys at the **root** of the theme JSON — NOT nested under a `sentimentColors` object. Conditional-formatting measures that return the string `"good"`, `"bad"`, or `"neutral"` resolve to whatever hex is set here, centralizing CF color control in one place.

```json
"good": "#2f9e44",
"bad": "#e03131",
"neutral": "#868e96",
"maximum": "#1971c2",
"center": "#f8f9fa",
"minimum": "#e03131"
```

### 3. Background / foreground variants

Extended palette for container surfaces, canvas backgrounds, and foreground text; these feed `visualContainerObjects` backgrounds and the filter pane.

```json
"foreground": "#343a40", "foregroundLight": "#868e96", "foregroundDark": "#212529",
"background": "#ffffff", "backgroundLight": "#f8f9fa", "backgroundNeutral": "#e9ecef"
```

### 4. Accent colors

```json
"tableAccent": "#1971c2", "hyperlink": "#1971c2", "shapeStroke": "#dee2e6", "accent": "#1971c2"
```

### Gradient tokens

For continuous scales in conditional formatting, use the gradient tokens rather than hex: `minColor` → bad end, `midColor` → neutral midpoint, `maxColor` → good end.

## Typography (`textClasses`)

Text classes define font properties by semantic role; each overrides Power BI's default for that role everywhere.

| Role | Typical use | Recommended size |
|---|---|---|
| `title` | Visual titles, page titles | 14-16pt |
| `header` | Section / column headers | 12-14pt |
| `label` | Axis labels, data labels | 11-12pt |
| `callout` | KPI values, prominent numbers | 28-36pt |
| `dataTitle` | KPI subtitles / labels | 12pt |
| `boldLabel` | Emphasized labels | 12pt |
| `largeTitle` | Large section titles | 20-24pt |
| `largeLabel` | Larger variant of label | 13-14pt |

Use the short font name only (`"Segoe UI"`, `"Segoe UI Semibold"`) — never the long CSS font-stack form (`"'Segoe UI Semibold', wf_segoe-ui_semibold, ..."`), which is reserved for `outspacePane`/`filterCard`. Power BI renders only its built-in fonts; supported options include Arial, Calibri, Candara, Consolas, Courier New, DIN, DIN Light, Georgia, Segoe UI, Segoe UI Light, Segoe UI Semibold, Segoe UI Bold, Tahoma, Times New Roman, Trebuchet MS, Verdana. Custom fonts will not render on consumers' machines.

> **Gotcha — textClasses use a PLAIN hex string.** In `textClasses`, color is `"color": "#343a40"`. The nested `{"solid":{"color":"..."}}` wrapper — correct everywhere in `visualStyles` — is **wrong** in `textClasses` and causes the color to be silently ignored.

## Schema Validation (`$schema`)

Add a `$schema` property as the first key so VS Code (or any JSON-Schema-aware editor) gives autocomplete and inline validation. Power BI Desktop also validates the theme against this schema on import — a theme that fails validation is rejected.

```json
{ "$schema": "https://raw.githubusercontent.com/microsoft/powerbi-desktop-samples/main/Report%20Theme%20JSON%20Schema/reportThemeSchema-2.152.json" }
```

The schema is versioned monthly alongside Desktop releases (pattern `reportThemeSchema-2.{version}.json`; `2.152` = March 2026 / exploration v5.71 — check the repo for newer). Target the version matching the Desktop release your report consumers run.

## Filter Pane (`outspacePane` / `filterCard`)

Filter-pane styling is **report-level theme styling**, not `visualStyles`: set `outspacePane` (the pane itself) and `filterCard` (the Available and Applied filter-card states) in the wildcard. This is the one place the long CSS font-stack form is required (see Typography above). Detailed property shapes live in the `pbir-format` filter-pane/theme references.

## Wildcard Container Defaults (`visualStyles["*"]["*"]`)

The most important part of the theme — the baseline for every visual before type-specific overrides.

```json
"visualStyles": { "*": { "*": {
  "title":      [{ "show": true, "fontSize": 14, "fontFamily": "Segoe UI Semibold",
                   "fontColor": {"solid": {"color": "#343a40"}} }],
  "background": [{ "show": false }],
  "border":     [{ "show": false }],
  "dropShadow": [{ "show": false }],
  "padding":    [{ "top": 8, "bottom": 8, "left": 8, "right": 8 }]
}}}
```

Recommended defaults: `dropShadow.show: false` globally (shadows are visual noise and cause vestibular issues for some users), `background.show: false` and `border.show: false` (use spacing instead of clutter), title enabled by default so visuals have useful labels.

## Visual-Type Overrides and Container-Name Gotchas

After the wildcard, add type-specific sections only for types that need different defaults. At minimum override `textbox`, `image`, `shape`, and `actionButton` to suppress container chrome. Container and property names are inconsistent across visual types — these are the high-frequency traps:

| Visual type | Gotcha |
|---|---|
| `kpi` | Trend container is `trendline` (lowercase L), not `trendLine` — wrong casing is silently ignored. `status.direction` (`"Positive"`/`"Negative"`) drives color logic; `goals.direction` only labels the distance metric. |
| `card` (legacy) | Value/category color is `labels.color` / `categoryLabels.color` — `color`, **not** `fontColor`. `labels.labelDisplayUnits` is an integer (`0`=Auto, `1`=None, `1000`=Thousands, `1000000`=Millions). |
| `cardVisual` (New Card) | Containers are `value` / `label`; color is `fontColor` (the opposite of legacy `card`). `label.position` is `"belowValue"`/`"aboveValue"`. |
| `multiRowCard` | `cardTitle.color` / `dataLabels.color` use `color`, not `fontColor`. Hide the accent bar with `card.barShow: false` — there is no separate `bar` container. |
| `tableEx` | Header/total background is `backColor`, **not** `backgroundColor`. Row banding uses `values.backColorPrimary` / `backColorSecondary`. `outlineStyle` is an integer (`0` none, `1` bottom-only, `2` all sides). |
| `pivotTable` | The matrix visual's type name is `pivotTable`, not `matrix`. |
| `slicer` | Both `items` and `header` use `textSize`, **not** `fontSize` — `fontSize` is silently ignored. `fontColor` is an object `{"solid":{"color":"#hex"}}`, not a plain string. |

Both `objects` and `visualContainerObjects` in visual.json map to the **same** `visualStyles[type][state]` section in the theme — the scope split exists only in visual.json. The array wrapper `[{...}]` is required in both places.

## Sentiment Colors and Conditional Formatting

1. **Theme tokens over hex.** Conditional formatting should return `"good"`/`"bad"`/`"neutral"`/`"minColor"`/`"maxColor"`, not hardcoded hex — changing the theme then cascades to all CF across all reports.
2. **Measure-driven preferred.** An extension measure returning a token keeps the logic in one place; it propagates when the measure or theme changes.
3. **Applied sparingly.** CF highlights exceptions, not decoration — apply it to variance/gap columns, not raw values. Formatting everything means formatting nothing.
4. **Accessible.** Prefer blue/orange over red/green for colorblind safety, and always pair color with a secondary cue (icon, arrow, text).
5. **Theme-first.** Confirm sentiment colors exist before applying CF; create `good`/`bad`/`neutral` if missing.

> `midColor` is a valid gradient token in the theme, but it is **not valid inside external (extension) measures** — measures may return `good`/`bad`/`neutral`/`minColor`/`maxColor` only.

Extension-measure pattern (returns token strings, never hex):

```dax
Color Measure =
IF([Value] >= [Target], "good",
IF([Value] >= [Target] * 0.9, "neutral", "bad"))
```

WCAG contrast minimums: normal text 4.5:1, large text (18pt+) 3:1, UI components 3:1.

## Compliance Audit

A report is theme-compliant when visuals inherit from the theme rather than carrying redundant or conflicting bespoke overrides. Classify every override:

| Category | Description | Action |
|---|---|---|
| **Stale** | Duplicates what the theme already sets, same value | Remove — it's noise and blocks future theme changes |
| **Conflicting** | Overrides the theme with a different value, no documented reason | Investigate — promote to theme if broad, else document the exception |
| **Intentional exception** | Legitimately differs for a specific reason | Keep (annotate if possible) |
| **Conditional formatting** | Expression-based formatting in `objects` | Keep — never clear CF expressions |

### Promote-or-remove decision tree

```
Override exists in visual.json
│
├── Is it a CF expression?        → Keep unconditionally
├── Does it match the theme value exactly?
│   └── YES → Stale. Remove it.
└── Does it differ from the theme?
    ├── Only this visual needs it? → Intentional exception. Keep (document if complex).
    └── 3+ visuals of the type need it?
        → Promote to theme as a visual-type override, then remove from the visuals.
```

After any batch clear, do a visual-render check — a batch op can remove an intentional exception. Field-bound selectors and CF expressions can never be promoted; they are per-visual by nature.
