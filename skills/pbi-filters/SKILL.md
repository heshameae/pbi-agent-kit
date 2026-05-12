---
description: Add, list, remove, and clear filters on Power BI pages and visuals. Supports categorical (IN-list), TopN, and relative-date filters. Use when the user mentions a filter, TopN, top 10, bottom 5, "last 30 days", relative date, categorical filter, "filter the page to", "filter the chart to", or wants to remove/clear filters.
allowed-tools: mcp__pbi-report__pbi_filter_list mcp__pbi-report__pbi_filter_add_categorical mcp__pbi-report__pbi_filter_add_topn mcp__pbi-report__pbi_filter_add_relative_date mcp__pbi-report__pbi_filter_remove mcp__pbi-report__pbi_filter_clear
---

# Power BI Filters Skill

## Scope: page vs visual

Every filter tool takes a `page` and an optional `visual`:
- **Page-level** — omit `visual` (or set null). Applied to all visuals on the page. Gets `howCreated: "User"` in the JSON.
- **Visual-level** — set `visual: <visualId>`. Applied to that one visual only.

## Categorical (IN-list)

"Filter to West and East regions":
```
pbi_filter_add_categorical(page, table: "Geography", column: "Region",
  values: ["West", "East"])
```

Values are encoded by type:
- `"2024"` → `2024L` (int64)
- `"3.14"` → `3.14D` (double)
- `"West"` → `'West'` (quoted string)

The tool detects the type automatically; pass values as strings.

## TopN

"Top 10 customers by revenue":
```
pbi_filter_add_topn(page,
  table: "Customer", column: "Name",       // what to filter (group by)
  orderByTable: "Sales", orderByColumn: "Revenue",  // what to rank by
  n: 10,
  direction: "Top"                          // or "Bottom" for lowest N
)
```

## Relative date

"Last 30 days":
```
pbi_filter_add_relative_date(page,
  table: "Calendar", column: "Date",
  amount: 30,
  timeUnit: "days"   // "days" | "weeks" | "months" | "years"
)
```

Inclusive of the current period boundary (so "last 30 days" includes today).

## Remove / clear

- `pbi_filter_remove(page, name)` — remove ONE filter by name. Names are returned when the filter is added.
- `pbi_filter_clear(page)` — remove ALL filters on a page (or visual if `visual` is set). Returns the count.

## Names

Filter names are auto-generated 20-char hex ids unless `name:` is passed. Names are stable — saving them when you create a filter makes later remove/update easier.

## List filters before modifying

`pbi_filter_list(page)` returns the raw filter JSON for inspection. Useful before `pbi_filter_remove` so you can identify the right one.
