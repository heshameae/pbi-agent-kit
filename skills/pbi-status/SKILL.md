---
description: Show a quick summary of the current Power BI report (pages, theme, total visuals). Run from inside a .pbip project folder.
disable-model-invocation: true
allowed-tools: mcp__pbi-report__pbi_report_info mcp__pbi-report__pbi_page_list
---

# /pbi-status

Print a one-screen status of the current PBIR report.

## Instructions

1. Call `mcp__pbi-report__pbi_report_info` (auto-detects path).
2. Format the result as:
   ```
   Report: <name>
   Theme:  <theme>
   Pages:  <count>
     <page1.displayName> (<page1.name>) — <visualCount> visuals
     <page2.displayName> (<page2.name>) — <visualCount> visuals
     ...
   Total visuals: <totalVisuals>
   Path:   <path>
   ```
3. If `pbi_report_info` fails because the cwd isn't inside a .pbip project, say so and tell the user to `cd` into one or pass `--path` if invoking from the CLI directly.
