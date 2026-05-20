# Mining findings: data-goblin tabular-editor/fabric/desktop/hooks/root
Source: dg4-te-fabric-desktop-root.xml

## Relevance summary
Extremely high-value source. It contains (1) two complete, reusable BPA rule sets — a ~30-rule "comprehensive" set and the canonical ~50-rule Microsoft Analysis Services set — plus full Dynamic-LINQ/TOM expression syntax, the rule JSON schema, and TMDL-annotation embedding format; these directly expand our BPA engine. It also ships (2) production-quality Claude Code safety hooks (block-destructive-commands, block-npm/pip, block-secrets-exposure) as `hook.json` + `settings.json.example` we can adopt nearly verbatim, plus a sophisticated multi-hook PreToolUse/PostToolUse plugin (pbi-desktop) whose `validate-measure` / `validate-dax` logic is a near-exact blueprint for our gate-measure-create hook. Finally it gives (3) a clean plugin.json/marketplace.json multi-plugin manifest shape, (4) two agent designs (bpa-expression-helper, query-listener), and (5) dataset-agnostic calc-group and RLS pattern libraries.

## High-value extractions

### 1. Comprehensive BPA rule set (~30 rules) → maps to our BPA rules engine + calc-group/rls knowledge
- What it is: A self-authored, clean, dataset-agnostic rule collection covering DAX, Metadata, Performance, Model Layout, Naming, Formatting, Governance. Every rule uses generalized TOM expressions (no hardcoded names). This is the single best drop-in seed for our BPA engine.
- Key content (paste reusable rule definitions — Expression is the load-bearing logic):
  - `DAX_COLUMNS_FULLY_QUALIFIED` (Sev2, Scope `Measure, CalculatedColumn, CalculatedTable, KPI`): `DependsOn.Any(Key.ObjectType = "Column" and Value.Any(not FullyQualified))`
  - `DAX_MEASURES_UNQUALIFIED` (Sev2): `DependsOn.Any(Key.ObjectType = "Measure" and Value.Any(FullyQualified))`
  - `DAX_DIVISION_COLUMNS` (Sev3, use DIVIDE): `Tokenize().Any(Type = DIV and Next.Type <> INTEGER_LITERAL and Next.Type <> REAL_LITERAL)`
  - `DAX_AVOID_IFERROR` (Sev2): `Expression.IndexOf("IFERROR", StringComparison.OrdinalIgnoreCase) >= 0`
  - `DAX_TODO` (Sev1): `Expression.IndexOf("TODO", StringComparison.OrdinalIgnoreCase) >= 0`
  - `DAX_AVOID_FILTER_ALL` (Sev2): `RegEx.IsMatch(Expression, "FILTER\s*\(\s*ALL\s*\(")`
  - `META_MEASURE_NO_DESCRIPTION` (Sev2, Measure): `string.IsNullOrWhitespace(Description)`
  - `META_COLUMN_NO_DESCRIPTION` (Sev1): `IsVisible and string.IsNullOrWhitespace(Description)`
  - `META_AVOID_FLOAT` (Sev3, Fix `DataType = DataType.Decimal`): `DataType = "Double"`
  - `META_SUMMARIZE_NONE` (Sev1, Fix `SummarizeBy = AggregateFunction.None`): `IsVisible and SummarizeBy <> "None" and (DataType = "Double" or DataType = "Decimal" or DataType = "Int64")`
  - `META_DISABLE_ATTRIBUTE_HIERARCHIES` (Sev2, CL1400, Fix `IsAvailableInMDX = false`): `not IsVisible and IsAvailableInMDX and not UsedInHierarchies.Any() and not UsedInVariations.Any() and not UsedInSortBy.Any()`
  - `META_TABLE_NO_DESCRIPTION` (Sev1, Table): `IsVisible and string.IsNullOrWhitespace(Description)`
  - `PERF_UNUSED_COLUMNS` (Sev2, Fix `Delete()`): `not IsVisible and ReferencedBy.Count = 0 and (not UsedInRelationships.Any()) and (not UsedInSortBy.Any()) and (not UsedInHierarchies.Any()) and (not UsedInVariations.Any())`
  - `PERF_UNUSED_MEASURES` (Sev1, Fix `Delete()`): `not IsVisible and ReferencedBy.Count = 0`
  - `PERF_AVOID_BIDIR_RELATIONSHIPS` (Sev2, Relationship): `CrossFilteringBehavior = CrossFilteringBehavior.BothDirections`
  - `PERF_TOO_MANY_COLUMNS` (Sev2, Table): `Columns.Count > 100`
  - `PERF_TOO_MANY_CALC_COLUMNS` (Sev2, Table): `Columns.Count(ObjectType = "CalculatedColumn") > 10`
  - `LAYOUT_HIDE_FK_COLUMNS` (Sev1, Fix `IsHidden = true`): `IsVisible and Model.Relationships.Any(FromColumn = outerIt)`
  - `LAYOUT_MEASURES_IN_DISPLAY_FOLDERS` (Sev1, Table): `Measures.Count(IsVisible and string.IsNullOrEmpty(DisplayFolder)) > 10`
  - `LAYOUT_VISIBLE_MEASURE_NO_FOLDER` (Sev1, Measure): `IsVisible and string.IsNullOrEmpty(DisplayFolder)`
  - `NAME_UPPERCASE_FIRST_LETTER` (Sev2): `IsVisible and char.IsLower(Name[0])`
  - `NAME_NO_SPECIAL_CHARS` (Sev2): `RegEx.IsMatch(Name, "[^a-zA-Z0-9 _\-()%]")`
  - `NAME_RELATIONSHIP_COLUMNS_MATCH` (Sev2, Relationship): `(Model.Relationships.Count(FromTable = OuterIt.FromTable and ToTable = OuterIt.ToTable) = 1 and FromColumn.Name <> ToColumn.Name)`
  - `NAME_AVOID_RESERVED_WORDS` (Sev2): `RegEx.IsMatch(Name, "^(DATE|TIME|YEAR|MONTH|DAY|HOUR|MINUTE|SECOND|NOW|TODAY|TRUE|FALSE|BLANK)$")`
  - `FORMAT_NUMERIC_COLUMNS` / `FORMAT_NUMERIC_MEASURES` (Sev2): `IsVisible and string.IsNullOrWhitespace(FormatString) and (DataType = "Int64" or DataType = "Double" or DataType = "Decimal")`
  - `FORMAT_PERCENTAGE_MEASURES` (Sev1): `(Name.EndsWith("%") or Name.EndsWith("Percent") or Name.EndsWith("Percentage") or Name.EndsWith("Rate")) and not FormatString.Contains("%")`
  - `GOV_NO_HARDCODED_VALUES` (Sev1, Remarks: 4+ digit literals): `RegEx.IsMatch(Expression, "[^\d]\d{4,}[^\d]")`
  - `GOV_ROLE_HAS_MEMBERS` (Sev1, ModelRole): `Model.Roles.Any() and TablePermissions.Count = 0`
  - `GOV_MODEL_HAS_DATA_SOURCE` (Sev3, Model): `DataSources.Count = 0 and Tables.Any(Partitions.Any(SourceType = "M"))`
- Source path: `plugins/tabular-editor/skills/bpa-rules/examples/comprehensive-rules.json`
- Quality: 5 — clean, generalized, immediately portable to a TS rules engine.
- Recommendation: adapt (port each `Expression` to a TS predicate over our TMDL model object graph; keep ID/Name/Category/Severity/Scope/FixExpression metadata as-is).

### 2. Microsoft Analysis Services BPA rule set (~50 rules) → maps to our BPA rules engine (authoritative ruleset)
- What it is: The industry-standard TabularEditor/Microsoft BPARules set (categories: Performance, DAX Expressions, Error Prevention, Maintenance, Naming Conventions, Formatting). Authoritative; many overlap with set #1 but it adds error-prevention and relationship/RLS-aware rules. Names are prefixed `[Category]`.
- Key content (high-signal rules NOT already in set #1 — paste Expressions):
  - `RELATIONSHIP_COLUMNS_SAME_DATA_TYPE` (Error Prevention, Sev3, Relationship): `FromColumn.DataType != ToColumn.DataType`
  - `DATA_COLUMNS_MUST_HAVE_A_SOURCE_COLUMN` (Sev3, DataColumn): `string.IsNullOrWhitespace(SourceColumn)`
  - `EXPRESSION_RELIANT_OBJECTS_MUST_HAVE_AN_EXPRESSION` (Sev3, `Measure, CalculatedColumn, CalculationItem`): `string.IsNullOrWhiteSpace(Expression)`
  - `AVOID_INVALID_NAME_CHARACTERS` (Sev3, broad scope; has Fix): `Name.ToCharArray().Any(char.IsControl(it) and !char.IsWhiteSpace(it))` → Fix replaces control chars with space.
  - `SET_ISAVAILABLEINMDX_TO_TRUE_ON_NECESSARY_COLUMNS` (Sev3, Fix `IsAvailableInMDX = true`): `IsAvailableInMDX = false and (UsedInSortBy.Any() or UsedInHierarchies.Any() or UsedInVariations.Any() or SortByColumn != null)`
  - `AVOID_DUPLICATE_MEASURES` (DAX, Sev2): `Model.AllMeasures.Any(Expression.Replace(" ","")... = outerIt.Expression.Replace(" ","")... and it <> outerIt)` (whitespace-normalized dedupe)
  - `MEASURES_SHOULD_NOT_BE_DIRECT_REFERENCES_OF_OTHER_MEASURES` (Sev2): `Model.AllMeasures.Any(DaxObjectName == current.Expression)`
  - `USE_THE_TREATAS_FUNCTION_INSTEAD_OF_INTERSECT` (Sev2, CL1400): `RegEx.IsMatch(Expression,"(?i)INTERSECT\s*\(")`
  - `USE_THE_DIVIDE_FUNCTION_FOR_DIVISION` (Sev2): `RegEx.IsMatch(Expression,"\]\s*\/(?!\/)(?!\*)") or RegEx.IsMatch(Expression,"\)\s*\/(?!\/)(?!\*)")`
  - `FILTER_COLUMN_VALUES` / `FILTER_MEASURE_VALUES_BY_COLUMNS` (Sev2): regex detecting `CALCULATE(...,FILTER('Table','Table'[Col]=...))` anti-patterns (prefer KEEPFILTERS / column predicates).
  - `INACTIVE_RELATIONSHIPS_THAT_ARE_NEVER_ACTIVATED` (Sev2, Relationship): checks `IsActive == false` AND no measure/calc-item references it via `USERELATIONSHIP(...)` (builds the regex dynamically from `current.FromTable.Name` etc. — a good model for our reference-graph check).
  - `EVALUATEANDLOG_SHOULD_NOT_BE_USED_IN_PRODUCTION_MODELS` (Sev1): `RegEx.IsMatch(Expression,"(?i)EVALUATEANDLOG\s*\(")`
  - `AVOID_USING_'1-(X/Y)'_SYNTAX` (Sev2): regex flagging `1 - SUM(...)/...` percentage anti-pattern.
  - RLS/perf-specific: `LIMIT_ROW_LEVEL_SECURITY_(RLS)_LOGIC` (flags RIGHT/LEFT/UPPER/LOWER/FIND inside `RowLevelSecurity`), `AVOID_USING_MANY-TO-MANY_RELATIONSHIPS_ON_TABLES_USED_FOR_DYNAMIC_ROW_LEVEL_SECURITY` (Sev3), `CHECK_IF_DYNAMIC_ROW_LEVEL_SECURITY_(RLS)_IS_NECESSARY` (Scope `TablePermission`: `RegEx.IsMatch(Expression,"(?i)USERNAME\(") or ...USERPRINCIPALNAME\(`), `AVOID_THE_USERELATIONSHIP_FUNCTION_AND_RLS_AGAINST_THE_SAME_TABLE` (Sev3).
  - Model-shape: `MODEL_SHOULD_HAVE_A_DATE_TABLE`, `SNOWFLAKE_SCHEMA_ARCHITECTURE`, `REMOVE_AUTO-DATE_TABLE` (`Name.StartsWith("DateTableTemplate_") or "LocalDateTable_"`), `MANY-TO-MANY_RELATIONSHIPS_SHOULD_BE_SINGLE-DIRECTION`, `ENSURE_TABLES_HAVE_RELATIONSHIPS` (`UsedInRelationships.Count() == 0`).
  - Maintenance/Formatting w/ Fix: `REMOVE_ROLES_WITH_NO_MEMBERS` (`Members.Count() == 0` → Delete), `CALCULATION_GROUPS_WITH_NO_CALCULATION_ITEMS` (`CalculationItems.Count == 0`), `HIDE_FOREIGN_KEYS` (Fix `IsHidden = true`), `MARK_PRIMARY_KEYS` (Fix `IsKey = true`), `NUMERIC_COLUMN_SUMMARIZE_BY` (Fix `SummarizeBy = AggregateFunction.None`), `RELATIONSHIP_COLUMNS_SHOULD_BE_OF_INTEGER_DATA_TYPE`, `TRIM_OBJECT_NAMES` (`Name.StartsWith(" ") or Name.EndsWith(" ")`).
  - NOTE: several Performance rules (`AVOID_BI-DIRECTIONAL...HIGH-CARDINALITY`, `LARGE_TABLES_SHOULD_BE_PARTITIONED`, `SPLIT_DATE_AND_TIME`, `FIX_REFERENTIAL_INTEGRITY_VIOLATIONS`) read VertiPaq stats via `GetAnnotation("Vertipaq_*")` — these require an external VertiPaq-analyzer pre-step; mark dependency-on-external-stats.
- Source path: `plugins/tabular-editor/skills/bpa-rules/examples/microsoft-analysis-services-rules.json`
- Quality: 5 — authoritative and generalized. A few `Vertipaq_*`-annotation rules are inert without stats; the `1=1` rule (`REDUCE_USAGE_OF_CALCULATED_TABLES`) always fires (intentional advisory).
- Recommendation: adopt as the canonical baseline ruleset; port Expressions to TS. Skip/defer VertiPaq-annotation rules until we have a stats source.

### 3. Power Query operations rules (10) → maps to BPA engine (M/partition-scope rules)
- What it is: Partition-scope rules flagging expensive/data-quality-risky M operations via `Expression.Contains(...)`. Trivially portable (string-contains over partition M).
- Key content: `PQ_AVOID_TABLE_DISTINCT`, `PQ_AVOID_REMOVE_DUPLICATES`, `PQ_AVOID_TABLE_NESTEDJOIN`/`PQ_AVOID_TABLE_JOIN` (Sev3), `PQ_AVOID_FUZZY_JOINS` (`Table.FuzzyJoin`/`Table.FuzzyNestedJoin`), `PQ_MERGE_OPERATIONS_COMPREHENSIVE`, `PQ_TABLE_COMBINE_WITH_DISTINCT`, `PQ_BUFFER_BEFORE_JOINS`, `PQ_EXPAND_AFTER_NESTEDJOIN`. Plus the canonical MS rule `MINIMIZE_POWER_QUERY_TRANSFORMATIONS` (Partition, lists Table.Combine/Join/AddColumn/Group/Sort/Pivot/Unpivot/Distinct, native-query markers).
- Source path: `plugins/tabular-editor/skills/bpa-rules/examples/power-query-operations-rules.json`
- Quality: 4 — string-contains is naive (no comment stripping) but effective; we can keep semantics.
- Recommendation: adapt.

### 4. BPA Dynamic-LINQ / TOM expression syntax + Tokenize/DependsOn/ReferencedBy → maps to BPA engine design + bpa-expression-helper agent
- What it is: The complete grammar the rule Expressions are written in — the spec our TS engine must emulate (or our rule-authoring docs must teach). Defines string/boolean/numeric/collection ops, per-object-type TOM property lists (Model/Table/Column/Measure/Hierarchy/Relationship/Partition/CalculationItem), `Tokenize()` token types + properties, `DependsOn` (with `Key.ObjectType` + `Value.FullyQualified`), `ReferencedBy` sub-collections (`AllMeasures`/`AllColumns`/`AllTables`/`Roles`), and `outerIt`/`current` nested-LINQ references. Includes FixExpression syntax + enum values (DataType, AggregateFunction, CrossFilteringBehavior).
- Key content (load-bearing concepts our engine must support): violation = expression returns `true`; `not` prefix for booleans; `=`/`==` both used for equality; collection predicates `.Any(pred)`, `.All(pred)`, `.Count(pred)`, `.Where(pred).Count()`; nested ref via `outerIt`/`current`; `Tokenize()` for precise DAX analysis (preferred over string match); `DependsOn`/`ReferencedBy` for the reference graph (preferred over regex).
- Source paths: `plugins/tabular-editor/skills/bpa-rules/references/expression-syntax.md`, `.../references/quick-reference.md`
- Quality: 5.
- Recommendation: reference-only for the C#/LINQ surface, but adopt the *capability list* as the spec for our TS rule predicates (we need a model graph exposing IsHidden/ReferencedBy/DependsOn/UsedInRelationships/UsedInSortBy/UsedInHierarchies/Tokenize-equivalent).

### 5. BPA rule JSON schema + scope/severity/compat tables → maps to BPA engine rule model + validation
- What it is: The exact rule object contract and all valid enum values. Defines our rule type.
- Key content:
  - Fields: `ID`(req), `Name`(req), `Category`(req), `Description`(opt), `Severity`(req int 1-3), `Scope`(req, comma-separated), `Expression`(req), `FixExpression`(opt/null), `CompatibilityLevel`(opt, default 1200), `Source`(opt), `Remarks`(opt). TE parser is strict — NO extra fields (no `_comment`, no runtime `ObjectCount`/`ErrorMessage`).
  - Severity: 1 Info, 2 Warning, 3 Error. (Note: course-3 example illegally uses 4/5 — invalid.)
  - Valid Scopes (full enum): `Model, Table, CalculatedTable, Measure, DataColumn, CalculatedColumn, CalculatedTableColumn, Hierarchy, Level, Relationship, Partition, Perspective, Culture, KPI, CalculationGroup, CalculationItem, ProviderDataSource, StructuredDataSource, NamedExpression, ModelRole, ModelRoleMember, TablePermission, Variation, Calendar, UserDefinedFunction`. Backwards aliases: `Column` → `DataColumn,CalculatedColumn,CalculatedTableColumn`; `DataSource` → `ProviderDataSource`. Scope-name gotchas: use `ModelRole` (not `Role`), `ModelRoleMember` (not `Member`), `NamedExpression` (not `Expression`).
  - CompatibilityLevel ladder: 1200 (2016/base TOM), 1400 (2017: detail rows, OLS), 1500 (2019: calc groups), 1560+ (Power BI), 1702 (current PBI/Fabric: dynamic format strings, field params, DAX UDFs).
  - ID prefix convention: `DAX_`, `META_`, `PERF_`, `NAME_`, `LAYOUT_`, `FORMAT_`, `ERR_`, `GOV_`, `MAINT_`.
  - TE compat (mark external-tool, reference-only): files need CRLF line endings; regex has NO `@` verbatim prefix and NO `RegexOptions` param (use inline `(?i)`).
- Source paths: `plugins/tabular-editor/skills/bpa-rules/references/rule-schema.md`, `.../quick-reference.md`, `.../references/te-compatibility.md`, `.../schema/bparules-schema.json` (Draft-07 JSON Schema exists)
- Quality: 5.
- Recommendation: adopt the field contract + scope/severity enums as our TS rule type. CRLF/regex-flag constraints are TE-specific (reference-only) but matter if we ever emit `.json` for TE consumption.

### 6. TMDL BPA annotations (embed / ignore / external) → maps to BPA engine I/O (reading rules from a model)
- What it is: How rules + ignore-lists + external-file URLs are embedded in `model.tmdl`. Our engine should read these.
- Key content (three model-level annotations):
  - `annotation BestPracticeAnalyzer = [ {…rule objects…} ]` (inline rules, JSON array, same schema)
  - `annotation BestPracticeAnalyzer_IgnoreRules = {"RuleIDs":["RULE1","RULE2"]}` (model-level skip)
  - `annotation BestPracticeAnalyzer_ExternalRuleFiles = ["https://…BPARules-standard.json"]`
  - Object-level: `annotation BestPracticeAnalyzer_Ignore = {"RuleIDs":[...]}` on a specific measure/table exempts just that object.
  - Priority: local model rules override remote/built-in when IDs collide. Built-in standard URLs: `BPARules-standard.json` (strict), `BPARules-standard-lax.json` (relaxed).
- Source path: `plugins/tabular-editor/skills/bpa-rules/references/tmdl-annotations.md`
- Quality: 5.
- Recommendation: adopt — implement parse/merge of these annotations + per-object ignore in our engine.

### 7. useful-stuff hooks: block-destructive-commands → maps to our block-destructive-commands safety hook
- What it is: PreToolUse `Bash` matcher hooks that deny catastrophic commands via a JSON deny decision, deliberately narrow (project-relative `rm -rf` still allowed). Two shapes shipped: a richer `hook.json` (reads stdin, greps `.tool_input.command`, anchored regex) and a simpler `settings.json.example` (glob `if` + unconditional deny).
- Key content (settings.json.example shape — directly adoptable):
```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
  { "type": "command", "command": "cat > /dev/null; jq -n '{hookSpecificOutput:{hookEventName:\"PreToolUse\",permissionDecision:\"deny\",permissionDecisionReason:\"BLOCKED: rm -rf targeting home directory. Use a more specific path.\"}}'", "if": "Bash(*rm *-rf ~*)" },
  { "...": "also blocks", "if": "Bash(*rm *-rf $HOME*)" },
  { "...": "root fs", "if": "Bash(*rm *-rf /*)" },
  { "...": "force push", "if": "Bash(*git push*--force*main*)" },
  { "if": "Bash(*git push*--force*master*)" },
  { "if": "Bash(*git reset --hard*)" },
  { "if": "Bash(*chmod*777*)" }
] } ] } }
```
  The `hook.json` variant guards each with an anchored regex, e.g. `grep -qE '(^|[;&|]\s*)rm\s+.*-rf\s+~/'` and `git\s+push\s.*--force\s.*main`, then emits the same deny JSON; both `exit 0` on no-match.
- Blocked set (table from README): `rm -rf ~//$HOME//`, `git push --force` to main/master, `git reset --hard`, `chmod 777`. NOT blocked: project-relative `rm -rf`, normal file delete, force-push to feature branches, `git reset --soft/--mixed`.
- Source path: `useful-stuff/hooks/block-destructive-commands/{hook.json,settings.json.example,README.md}`
- Quality: 5. Note: glob `if` is broad (`Bash(*rm *-rf /*)` also matches `rm -rf /tmp/...`); the regex `hook.json` variant (`/[^a-zA-Z]`) is the more precise one — prefer it.
- Recommendation: adopt-as-is (use the regex `hook.json` patterns; they're more precise and exactly our block-destructive-commands hook).

### 8. useful-stuff hooks: block-npm / block-pip → maps to our block-pnpm-discipline hook
- What it is: One-liner PreToolUse deny hooks redirecting `npm`→`bun` and `pip`→`uv`. Our project wants the same shape but enforcing pnpm.
- Key content (hook.json logic; adapt the manager name):
  - npm: `if "Bash(*npm *)"` → `... grep -qE '(^|;|&&|\|\|)[[:space:]]*npm[[:space:]]' ... deny "Use bun instead of npm."`
  - pip: `if "Bash(*pip*)"` → `... grep -qE '(^|;|&&|\|\|)[[:space:]]*pip3?[[:space:]]' ... deny "Use uv instead of pip."`
  - settings.json.example uses glob `if` (`Bash(npm *)`, `Bash(pip *)`, `Bash(pip3 *)`) + unconditional deny.
- Rationale (README, reusable in our docs): npm/pip run arbitrary post-install scripts → supply-chain risk for auto-approving agents; bun/uv are safe-by-default + faster + lockfile-reproducible.
- Source path: `useful-stuff/hooks/block-npm/`, `useful-stuff/hooks/block-pip/`
- Quality: 5.
- Recommendation: adapt — clone the npm hook, swap matcher/regex to block `npm`+`yarn` and the deny message to "Use pnpm instead." (We are pnpm-discipline, not bun.) The anchored-regex form prevents false positives on substrings.

### 9. useful-stuff hooks: block-secrets-exposure → maps to our block-secrets-exposure safety hook
- What it is: PreToolUse hooks denying reads of `.env*` and a curated list of credential/token-dump commands. NOTE this `hook.json` uses a non-standard nested shape (`{"PreToolUse":{"read-hooks":[...],"bash-hooks":[...]}}`) — the canonical, harness-correct shape is in settings.json.example.
- Key content (settings.json.example — adoptable shape):
  - Read matcher: `if "Read(*.env)"` and `if "Read(*.env.*)"` → deny ".env files contain secrets." (caveat: also blocks `.env.example`/`.env.template`; add a filename check to allow templates).
  - Bash matcher denies: `security find-generic-password` / `find-internet-password` / `dump-keychain` (macOS Keychain), `az account get-access-token`, `aws sts get-session-token`, `gcloud auth print-access-token` / `print-identity-token`, `printenv` (dumps all env incl. secrets), `keyring get`, `secret-tool lookup` (Linux). Each `cat > /dev/null; jq -n '{... permissionDecision:"deny", permissionDecisionReason:"BLOCKED: ..."}}'`.
- Rationale (README): tokens land in conversation context → use SDK-level auth (DefaultAzureCredential / IAM roles); `printenv` leaks `*_API_KEY`/`DATABASE_URL`/etc.
- Source path: `useful-stuff/hooks/block-secrets-exposure/{hook.json,settings.json.example,README.md}`
- Quality: 4 — `hook.json` shape is wrong/non-standard (custom keys, not a flat array); use the settings.json.example structure. Logic is excellent.
- Recommendation: adopt-as-is (logic) but use the settings.json.example structure; add a template-file allowance for `.env.example`.

### 10. pbi-desktop multi-hook plugin (validate-dax / validate-measure / refresh-cache / check-ri / check-compat) → maps DIRECTLY to our gate-measure-create + gate-data-analyst-readonly + a TS rules-driven validator hook
- What it is: A full, production hook subsystem: `hooks.json` registers PreToolUse + PostToolUse `Bash` hooks that dispatch to subcommands of one `pbi-hooks.sh`; `config.yaml` provides per-check toggles + a master kill-switch. This is the strongest blueprint for our own gate hooks. (The PowerShell `.ps1` callees are external-tool, reference-only, but the bash hook orchestration + measure/DAX validation logic is Node-portable.)
- Key content:
  - `hooks.json` registration pattern (adopt the `if`-gated dispatch):
    - PreToolUse: `validate-dax` on `Bash(*tom_nuget*)` and `Bash(* -File *.ps1*)` (timeout 10); `validate-measure` on `Bash(*Measures.Add*)` and `Bash(* -File *.ps1*)`.
    - PostToolUse: `refresh-cache` + `check-compat` on `Bash(* -File *.ps1*)`; `check-ri` on `Bash(*SaveChanges*)` (timeout 60).
    - Each entry: `{ "type":"command", "command":"bash \"${CLAUDE_PLUGIN_ROOT}/hooks/pbi-hooks.sh\" <subcmd>", "timeout":N, "if":"Bash(...)" }`.
  - **gate-measure-create blueprint** (`cmd_validate_measure`): fires only when command contains `.Measures.Add`; greps for `\.DisplayFolder\s*=`, `\.Description\s*=`, `\.FormatString\s*=` (or `FormatStringDefinition`); if any missing → `echo "Measure is missing required metadata: <list>. Set these before .Measures.Add()." >&2; exit 2` (exit 2 = blocking, stderr shown to Claude). This is exactly our gate-measure-create contract.
  - **DAX-reference validation blueprint** (`cmd_validate_dax`): loads cached model metadata JSON, extracts `'Table'[Column]` and unqualified `[Ref]` references from the command, validates each against tables/columns/measures, and on miss emits a "Did you mean …?" suggestion (3-pass fuzzy: case-insensitive exact → substring → first-word). Excludes `DEFINE MEASURE` targets and string-literal aliases. Strong model for a TS DAX-reference checker.
  - `config.yaml` pattern (adopt): per-check booleans (`dax_validation`, `measure_metadata`, `metadata_refresh`, `referential_integrity`, `compatibility_check`, `compatibility_auto_upgrade:false`) + `all_hooks_enabled` master kill-switch; "changes take effect immediately."
  - Defensive design (adopt for cross-platform safety): read stdin once (`cat 2>/dev/null || printf '{}'`); `exit 0` on any environmental failure (missing jq, missing metadata, empty stdin) so hooks are non-fatal; `set -o pipefail` but intentionally NOT `set -u` (unset Windows env vars cause spurious failures). README documents 5 open Windows Claude Code hook bugs (#49229 `if` ignored, #38800 `${CLAUDE_PLUGIN_ROOT}` + spaces, #47070 execvpe, #50243 settings.local-only, #34457 hangs) → rationale for the kill-switch + exit-0-on-error discipline.
- Source paths: `plugins/pbi-desktop/hooks/{hooks.json,config.yaml,pbi-hooks.sh,README.md,snapshot-model.ps1,check-referential-integrity.ps1}`
- Quality: 5 — the most directly reusable hook design in the source.
- Recommendation: adapt — reimplement `validate-measure` + `validate-dax` as Node scripts wired through `hooks.json` exactly like this; adopt the `config.yaml` toggle + kill-switch + exit-code (0 ok / 2 block) + defensive-degradation conventions wholesale. PowerShell snapshot/RI scripts are reference-only (we'll snapshot via our TMDL parser instead).

### 11. plugin.json + marketplace.json multi-plugin manifest → maps to our .claude-plugin/plugin.json + marketplace
- What it is: A clean 7-plugin marketplace and per-plugin manifest shape.
- Key content:
  - `plugin.json`: `{ "name", "version", "description", "author": {"name","url"}, "homepage", "repository", "license", "keywords":[...] }` (tabular-editor example: version "26.20", GPL-3.0, keywords power-bi/tabular-editor/bpa/semantic-model/csharp/tmdl).
  - `marketplace.json`: `{ "name":"power-bi-agentic-development", "owner":{"name"}, "metadata":{"description","version"}, "plugins":[ {"name","description","source":"./plugins/<name>"} ] }` — note inter-plugin dependency expressed in prose ("fabric-admin … Requires the fabric-cli plugin").
  - Hooks are shipped per-plugin via a `hooks/hooks.json` referenced through `${CLAUDE_PLUGIN_ROOT}`; agents via `agents/*.agent.md`; commands via `commands/*.md`; skills via `skills/<name>/SKILL.md`. A repo-level `scripts/validate-plugins.sh` validates all plugins.
- Source paths: `.claude-plugin/marketplace.json`, `plugins/tabular-editor/.claude-plugin/plugin.json` (+ fabric-admin/fabric-cli/pbi-desktop plugin.json)
- Quality: 5.
- Recommendation: adopt the field shapes; model our marketplace + per-plugin manifests on this (we likely ship a single plugin, but the structure scales).

### 12. bpa-expression-helper agent → maps to our model-reviewer / a BPA-authoring subagent
- What it is: A read-only debugging/authoring agent for BPA Expressions. Frontmatter + a tight "common mistakes" rubric.
- Key content (frontmatter): `name: bpa-expression-helper`, `description:` (trigger phrases "fix my BPA expression", "why isn't my rule working", "help with Dynamic LINQ"), `model: inherit`, `tools: ["Read","Grep","Glob"]`, `color: cyan`. Body: loads `expression-syntax.md`; checks parentheses/quotes/operators, property-exists-for-scope, LINQ method usage, then a "Common Issues" table (scope mismatch, `=` vs `==`, boolean `not`, `Columns.Any(...)` vs `Columns.IsHidden`, missing `outerIt`); output format = Issue / Corrected expression / Explanation / Test suggestion. Includes worked example (the classic "expression evaluates per-object in Scope; don't navigate `Table.Measures`" fix). Uses `<example>` blocks in frontmatter for dispatch hints.
- Source path: `plugins/tabular-editor/agents/bpa-expression-helper.agent.md` (paired command: `plugins/tabular-editor/commands/suggest-rule.md`, frontmatter `argument-hint: [description or model path]`, `model: sonnet`, body `$ARGUMENTS`).
- Quality: 5.
- Recommendation: adapt — fold this rubric into our model-reviewer/BPA-rule-authoring guidance (read-only tools, Issue→Fix→Explain→Test output, the common-mistakes table). The `<example>` dispatch-hint pattern is reusable for all our subagents.

### 13. query-listener agent → maps to a (future) report/perf-debug subagent; partially reference-only
- What it is: A live DAX-capture agent polling local Analysis Services `DISCOVER_SESSIONS` to grab visual queries + timings. PowerShell/ADOMD specifics are external-tool, reference-only, but the agent *design* is reusable.
- Key content (frontmatter): `tools: ["Bash","Read","Write"]`, `model: inherit`, `color: cyan`, rich `description` trigger list. Design worth keeping: announce "listener running, click visuals"; poll every 500ms up to 60s; dedupe by `SESSION_LAST_COMMAND_START_TIME`; capture only commands starting `DEFINE`/`EVALUATE`/`VAR` (ignore XMLA `<`, `MDSCHEMA_`/`TMSCHEMA_`, `SELECT * FROM $SYSTEM`); report elapsed/CPU ms; persist to a temp file so results survive agent exit; summarize slowest + perf patterns.
- Source path: `plugins/pbi-desktop/agents/query-listener.agent.md`
- Quality: 4 (design 5, but Windows/ADOMD-bound).
- Recommendation: reference-only for implementation; adopt the agent-design patterns (dedupe key, command-type filtering, persist-to-temp, summarize-slowest) if/when we add a perf-capture capability.

### 14. Calculation-group knowledge → maps to calc-group-patterns shared-knowledge skill
- What it is: Concepts + dataset-agnostic DAX patterns + precedence guidance for calc groups. (The C# `Model.AddCalculationGroup(...)` CRUD is external-tool, reference-only, but the DAX item bodies + precedence rules are pure, portable knowledge.)
- Key content (reusable, generalized):
  - Concepts: calc group = special table of calculation items; each item is a DAX expr using `SELECTEDMEASURE()`; Precedence orders evaluation when multiple groups apply (lower = earlier).
  - Time-intelligence item bodies (note `'Date'[Date]` is a placeholder, not hardcoding):
    - Current (passthrough): `SELECTEDMEASURE()`
    - YTD: `CALCULATE(SELECTEDMEASURE(), DATESYTD('Date'[Date]))`; QTD/MTD via `DATESQTD`/`DATESMTD`.
    - Prior Year: `CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date]))`
    - YoY %: `VAR CurrentValue = SELECTEDMEASURE() VAR PriorValue = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR('Date'[Date])) RETURN DIVIDE(CurrentValue - PriorValue, PriorValue)` with `FormatStringExpression = "\"0.00%\""`.
  - Currency-conversion item: `SELECTEDMEASURE() * SELECTEDVALUE(ExchangeRates[Rate], 1)`.
  - Precedence guideline table: 1-10 core time-intel, 11-20 currency, 21-30 comparison, 31+ presentation.
  - Best practices: hide the calc group; always include a Current/passthrough item; set `Ordinal` for slicer order; document with Description; use `FormatStringExpression` for dynamic formats.
- Source path: `plugins/tabular-editor/skills/c-sharp-scripting/object-types/calculation-groups.md` (+ examples dir `.../examples/calculation-groups/{time_intelligence.csx,currency_conversion.csx}` — .csx is reference-only)
- Quality: 5 (knowledge), C# CRUD reference-only.
- Recommendation: adapt — populate calc-group-patterns with the concepts, the DAX item library, precedence table, and best-practices. Flag `'Date'[Date]`/`ExchangeRates[Rate]` as placeholders to parameterize, not hardcode.

### 15. RLS / OLS knowledge + filter pattern library → maps to rls-patterns shared-knowledge skill
- What it is: Role/RLS/OLS concepts + a clean, dataset-agnostic library of RLS FilterExpression patterns. (C# `Model.AddRole(...)` CRUD is reference-only; the filter DAX is pure portable knowledge.)
- Key content (reusable RLS FilterExpression patterns — placeholders, not hardcoding):
  - Static: `'Region'[Region] = "West"`
  - Dynamic (user identity): `'Employee'[Email] = USERNAME()` ; `'Employee'[UPN] = USERPRINCIPALNAME()`
  - Multiple values: `'Region'[Region] IN { "West", "Central" }`
  - Complex: `'Region'[Region] IN { "West", "Central" } && 'Product'[Category] <> "Confidential"`
  - Security-table (data-driven, the recommended scalable pattern): `'Sales'[RegionID] IN CALCULATETABLE(VALUES('UserRegions'[RegionID]), 'UserRegions'[Email] = USERNAME())`
  - Manager hierarchy: `PATHCONTAINS('Employee'[ManagerPath], USERNAME())`
  - OLS: hide a table from a role via `MetadataPermission = None` (default visible = `Default`).
  - ModelPermission enum: None / Read / ReadRefresh / Refresh / Administrator.
  - Best practices: prefer dynamic security (USERNAME/UPN) for scalability; use security tables for maintainable data-driven RLS; test with test users; document filter logic; complex filters cost query perf; combine with perspectives for full access control.
  - Cross-link to BPA: rules `LIMIT_ROW_LEVEL_SECURITY_(RLS)_LOGIC`, `CHECK_IF_DYNAMIC_ROW_LEVEL_SECURITY_(RLS)_IS_NECESSARY`, `AVOID_USING_MANY-TO-MANY...DYNAMIC_RLS`, `AVOID_THE_USERELATIONSHIP_FUNCTION_AND_RLS_AGAINST_THE_SAME_TABLE` (set #2) enforce these patterns.
- Source path: `plugins/tabular-editor/skills/c-sharp-scripting/object-types/roles.md` (+ `.../examples/roles/README.md`, `configure-rls.csx`/`configure-ols.csx` reference-only)
- Quality: 5 (knowledge).
- Recommendation: adapt — populate rls-patterns with the filter-pattern library + best practices, and reference the RLS-aware BPA rules. Flag all `'Table'[Col]` literals as placeholders.

## Cross-source overlap flags
- **Safety hooks (#7-#9) vs other repos:** These useful-stuff hooks are generic Claude Code hooks (not PBI-specific) and almost certainly appear/overlap with other "awesome-claude-code"/dotfiles-style sources being mined. Treat data-goblin's versions as a strong reference, but the consolidation pass should dedupe against other hook sources and pick the most precise regex form (data-goblin's anchored `hook.json` regex variant is good). Our project's own planned `block-pnpm-discipline` differs (pnpm vs bun) — adapt, don't copy the message.
- **BPA rules duplication within this source:** comprehensive-rules.json (#1) and microsoft-analysis-services-rules.json (#2) share many rules (IFERROR, DIVIDE, float, unused columns/measures, bidir, fully-qualified columns). When seeding our engine, merge by intent and keep the MS set as the authoritative baseline; the comprehensive set adds cleaner Governance/Layout rules.
- **PBI BPA knowledge vs other PBI repos:** expression-syntax/TOM-property lists, calc-group DAX, and RLS patterns will likely overlap with other Tabular-Editor / sqlbi-derived sources in the mining set — cross-check the calc-group/RLS DAX bodies for a canonical version.
- **gate-measure-create:** our existing/planned hook is essentially `cmd_validate_measure` (#10); confirm we're not double-implementing if another source also provides a measure-metadata gate.

## Discarded / not relevant
- **course-3-business-case-bpa-rules.json** — DISCARD as a ruleset (kept only as an anti-pattern example): hardcodes specific table names (`Name != "Brands" and Name != "Customers" ...`), violating our no-hardcoding rule, and uses invalid Severity values (4, 5). Useful only to illustrate what NOT to do (and to teach "parameterize allowed-name lists").
- **fabric-cli plugin** (skills/fabric-cli/* — admin/connections/dataflows/lakehouses/notebooks/warehouses references, `fab` vs `az` CLI, python scripts) — out of scope; external CLI + Python runtime, not our TS engine. (One narrow exception kept under #1's model-investigation note: the `fab get ... -q "definition.parts[...]"` TMDL-reading recipe is a reference for remote model inspection, but the CLI itself is reference-only.)
- **fabric-admin plugin** (audit-tenant-settings: tenant-settings-metadata.yaml, delegated-overrides, security-groups, python audit + PDF scripts) — governance/tenant administration, unrelated to model/report authoring or our BPA/hooks.
- **All c-sharp-scripting `.csx` examples + object-type CRUD method tables** (bulk-operations, columns, measures, partitions, svg-measures, format-dax, etc.) — C# / Tabular Editor scripting = external-tool, reference-only by our hard rules. Extracted only the DAX/knowledge bodies from calc-group/roles docs (#14/#15); discarded the C# API surface.
- **te-docs + te2-cli + te3-preferences/layouts/uipreferences schemas** — Tabular Editor app config/CLI docs; external-tool, reference-only. (Only the BPA built-in rule-ID list and file-location/CRLF facts from te-compatibility.md were kept under #5.)
- **pbi-desktop connect-pbid skill internals** (TOM/ADOMD PowerShell scripts, daxlib-tom .csproj/Program.cs, parallels-macos, vertipaq-stats, refresh/refresh-model, evaluateandlog-debugging, tom-object-types) — PowerShell/.NET runtime + macOS-VM specifics; external-tool, reference-only. The query-listener *agent design* (#13) was kept; its ADOMD implementation discarded.
- **release-notes/** (90+ TE version changelogs) — irrelevant historical product notes.
- **useful-stuff/status-lines, agent-scripts, agent-settings, package-cooldowns** — shell statusline cosmetics, Windows long-paths script, generic settings.json sample, npm/pnpm cooldown setup — low relevance to our components (the agent-settings/package-cooldowns could be a minor reference for our own settings hygiene, but nothing load-bearing). Discarded.
- **ATTRIBUTIONS.md / CONTRIBUTING.md / root README.md** — repo meta, not technical content.
- **PowerShell hooks `snapshot-model.ps1` / `check-referential-integrity.ps1`** — external-tool implementations; their *purpose* (snapshot model metadata to JSON; run `EXCEPT(VALUES(from),VALUES(to))` per relationship to find orphaned FKs) is noted under #10 as a TS reimplementation target, but the .ps1 code itself is reference-only.
