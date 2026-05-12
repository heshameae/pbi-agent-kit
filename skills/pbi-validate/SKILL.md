---
description: Run full PBIR validation on the current report (structural + schema + cross-file). Prints errors, warnings, and info.
disable-model-invocation: true
allowed-tools: mcp__pbi-report__pbi_report_validate
---

# /pbi-validate

Run `mcp__pbi-report__pbi_report_validate` on the current report and format the result.

## Instructions

1. Call the tool (auto-detects path; pass an explicit path if the user provided one in `$ARGUMENTS`).
2. If `result.valid === true`, print:
   ```
   ✓ Valid. (errors: 0, warnings: <n>, info: <n>)
   ```
   then list any warnings/info if non-zero — one per line in `<file>: <message>` format.
3. If `result.valid === false`, print:
   ```
   ✗ Invalid — <n> errors:
     <file>: <message>
     ...
   ```
   then warnings/info if non-zero.
4. Exit silently after printing — don't add commentary unless the user asked for fixes.
