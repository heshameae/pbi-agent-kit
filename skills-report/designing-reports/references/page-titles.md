# Page Titles Reference

Guidance for implementing page titles in Power BI report pages: textbox `paragraphs`/`textRuns` JSON structure, multi-run and multi-paragraph formatting, dynamic titles driven by DAX, the full-width title-bar spec, and standard title positioning and sizing. Every page needs a title; these patterns make titles consistent, accessible, and dataset-agnostic.

**Source:** `plugins/reports/skills/pbi-report-design/references/page-titles.md`.

## Why Page Titles Matter

A page title provides context for report consumers, improves navigation and orientation, supports accessibility (screen readers), and lends a professional appearance.

## Implementation Options

| Option | Use when |
|---|---|
| Textbox visual (recommended) | Standard static or styled title text |
| Shape with text | Styled background behind the title text (e.g. a rectangle shape with text overlay) |
| Card visual | Dynamic titles that include a measure value |

### Option 1: Textbox Visual (Recommended)

```json
{
  "name": "title-guid",
  "position": {
    "x": 24,
    "y": 24,
    "z": 1000,
    "width": 500,
    "height": 48
  },
  "visual": {
    "visualType": "textbox",
    "objects": {
      "general": [{
        "properties": {
          "paragraphs": {
            "expr": {
              "Literal": {
                "Value": "[{\"textRuns\":[{\"value\":\"<Page Title>\",\"textStyle\":{\"fontSize\":\"24pt\",\"fontWeight\":\"bold\"}}]}]"
              }
            }
          }
        }
      }]
    },
    "visualContainerObjects": {
      "background": [{"properties": {"show": {"expr": {"Literal": {"Value": "false"}}}}}],
      "border": [{"properties": {"show": {"expr": {"Literal": {"Value": "false"}}}}}],
      "title": [{"properties": {"show": {"expr": {"Literal": {"Value": "false"}}}}}]
    }
  }
}
```

## Title Specifications

### Standard Title

```
Position:  x: 24, y: 24
Size:      width: 400-600px, height: 48-64px
Font:      24pt, bold
Color:     Dark gray (#333) or theme foreground
Alignment: Left
```

### With Subtitle

```
Title:    x: 24, y: 24, height: 40px, font: 24pt bold
Subtitle: x: 24, y: 64, height: 32px, font: 14pt regular
```

### Full-Width Title Bar

```
Position:  x: 0, y: 0
Size:      width: 1920px, height: 72px
Background: Theme color or gradient
```

## Dynamic Titles

Dynamic titles react to filter context or report state. Author the title text as a DAX measure and bind it to a card visual (Option 3).

### Include Current Filter Context

`SELECTEDVALUE` returns the single selected value (or a fallback when more than one is in context), so the title reflects what the reader has filtered to:

```dax
<Title Measure> =
"<Metric or page label> - " &
SELECTEDVALUE('<VerifiedDimension>'[<VerifiedAttribute>], "<All Label>")
```

### Include Last Refresh

```dax
<Title Measure> =
"<Report Label> - Updated: " &
FORMAT(MAX('<VerifiedRefreshTable>'[<VerifiedTimestamp>]), "MMM DD, YYYY")
```

## Textbox Paragraph Structure

Textbox content uses a specific JSON structure. The `paragraphs` value is a JSON-encoded string holding an array of paragraph objects, each with a `textRuns` array:

```json
{
  "paragraphs": {
    "expr": {
      "Literal": {
        "Value": "[{\"textRuns\":[{\"value\":\"Title Text\",\"textStyle\":{\"fontSize\":\"24pt\",\"fontWeight\":\"bold\",\"fontColor\":\"#333333\"}}]}]"
      }
    }
  }
}
```

### Multiple Runs (Mixed Formatting)

Use multiple `textRuns` within one paragraph to vary formatting across a single line (e.g. a regular word followed by an emphasized word):

```json
[{
  "textRuns": [
    {"value": "<Title prefix> ", "textStyle": {"fontSize": "24pt"}},
    {"value": "<Title emphasis>", "textStyle": {"fontSize": "24pt", "fontWeight": "bold"}}
  ]
}]
```

### Multiple Paragraphs

Use multiple paragraph objects to stack lines, such as a title above a subtitle:

```json
[
  {"textRuns": [{"value": "Main Title", "textStyle": {"fontSize": "24pt"}}]},
  {"textRuns": [{"value": "Subtitle here", "textStyle": {"fontSize": "14pt"}}]}
]
```

## Creating Title Textboxes

Create/update title textboxes only through supported report MCP tools. If textbox content is unsupported by the tool surface, stop and report the unsupported operation; do not hand-edit PBIR `visual.json` files.

## Theme Considerations

### Disable Container Properties

For titles, typically disable: background, border, title (the visual's own title chrome), and drop shadow.

### In Theme Wildcards

Apply the disabling globally via a `textbox` wildcard in the theme so every title textbox inherits it:

```json
"visualStyles": {
  "textbox": {
    "*": {
      "title": [{"show": false}],
      "background": [{"show": false}],
      "border": [{"show": false}],
      "dropShadow": [{"show": false}]
    }
  }
}
```

## Best Practices

1. **Consistent positioning** — same `x`, `y` across all pages.
2. **Consistent sizing** — same width, height, and font size.
3. **Descriptive text** — clearly describe the page's purpose.
4. **Avoid redundancy** — don't repeat the report name if it's already obvious.
5. **Consider mobile** — ensure the title is readable on smaller screens.
