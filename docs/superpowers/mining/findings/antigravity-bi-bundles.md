# Mining findings: antigravity-awesome-skills — BI/data bundles
Source: antigravity-awesome-skills.xml

## Relevance summary
Moderate relevance. This is a broad, community-aggregated SKILL.md library (1,462 skills, mostly auto-generated boilerplate). For our BI plugin the genuinely transferable assets are narrow but real: the `kpi-dashboard-design` skill (dashboard hierarchy, KPI level framework, layout patterns, do/don't rules — runtime/tool-agnostic) and the `data-storytelling` skill (narrative frameworks + headline/transition formulas) are the two standout extractions. The `dbt-transformation-patterns` playbook gives a clean staging→intermediate→marts dimensional-modeling methodology that maps conceptually to our M-query/TMDL layering. The two domain bundles also demonstrate a reusable dual-host (Claude + Codex) plugin-packaging shape. Most agent "persona" skills (business-analyst, data-scientist, data-engineer, analytics-product) are sprawling capability catalogs that are Python/cloud-centric and low-signal — reference-only at best. Many skills are stubs that just point to a `resources/implementation-playbook.md`. NO Power BI / DAX / TMDL-specific content anywhere; everything is methodology that must be adapted, not adopted.

## High-value extractions

### KPI Dashboard Design skill → maps to kpi-design-rules + layout-patterns
- **What it is / why valuable:** A compact, tool-agnostic methodology for choosing KPIs and laying out dashboards. This is the single most directly reusable file for our `kpi-design-rules` and `layout-patterns` skills. Note: the file exists TWICE, byte-identical, at both `plugins/.../skills/kpi-dashboard-design/SKILL.md` and `skills/kpi-dashboard-design/SKILL.md`.
- **Key content (reusable):**
  - **KPI level framework** (drives audience-appropriate metric selection — pairs with our audience-styles):
    | Level | Focus | Update Frequency | Audience |
    |---|---|---|---|
    | Strategic | Long-term goals | Monthly/Quarterly | Executives |
    | Tactical | Department goals | Weekly/Monthly | Managers |
    | Operational | Day-to-day | Real-time/Daily | Teams |
  - **SMART KPI test:** Specific / Measurable / Achievable / Relevant / Time-bound — use as a validator gate when our data-analyst proposes a measure.
  - **Dashboard hierarchy:** Executive Summary (1 page, 4-6 headline KPIs + trend indicators + key alerts) → Department Views → Detailed Drilldowns (individual metrics + root-cause). Maps cleanly to report page-tiering in layout-patterns.
  - **Department KPI taxonomy** (Sales/Marketing/Product/Finance lists — MRR/ARR/ARPU, CAC/CPA/MQL, DAU/MAU/stickiness/NPS, gross margin/current ratio/DSO). Useful as a *menu* for our data-analyst to suggest measures BY DOMAIN — but must stay a suggestion library, NOT hardcoded into any dataset logic.
  - **Layout patterns** (3 ASCII wireframes: Executive Summary, SaaS Metrics, Real-time Ops) — KPI-cards-row-on-top + trend-left/breakdown-right + alerts-strip-bottom. Good seed wireframes for layout-patterns.
  - **Best-practice rules (adopt as lint/validator rules):** limit to 5-7 KPIs; always show context (comparison/trend/target); consistent semantic colors (red=bad/green=good); enable drilldown; match refresh to metric cadence. Don'ts: no vanity metrics, no overcrowding, **no 3D charts** (distort perception), don't hide methodology, don't ignore mobile/responsive.
- **Source path within repo:** `skills/kpi-dashboard-design/SKILL.md` (and duplicate under `plugins/antigravity-bundle-business-analyst/skills/kpi-dashboard-design/SKILL.md`)
- **Quality:** 4/5 — concise, opinionated, cites Few/Tufte. The SQL/Streamlit code blocks are Python and reference-only.
- **Recommendation:** adapt (lift the framework table, hierarchy, layout wireframes, and do/don't rules into kpi-design-rules + layout-patterns; convert do/don'ts into validator checks).

### Data Storytelling skill → maps to audience-styles + bi-pattern-library + report-builder narrative
- **What it is / why valuable:** Narrative frameworks for turning analysis into decisions — directly feeds the "narrative" dimension of audience-styles and any report-builder summary/annotation generation.
- **Key content (reusable frameworks):**
  - **Story structure:** Setup (context/baseline) → Conflict (problem/opportunity) → Resolution (insight/recommendation).
  - **Narrative arc (6 beats):** Hook → Context → Rising Action → Climax (key insight) → Resolution → Call to Action.
  - **Three pillars:** Data (evidence) · Narrative (meaning) · Visuals (clarity).
  - **Three reusable story templates:** Problem-Solution, Trend (where-we-started → what-changed → transformation table → insight → going-forward), Comparison (weighted scoring matrix). These are excellent skeletons for an auto-generated report narrative/exec-summary.
  - **Headline formula (high value):** `[Specific Number] + [Business Impact] + [Actionable Context]` — e.g. "Q4 Sales Beat Target by 23% — Here's Why" instead of "Q4 Sales Analysis". Use to title report pages / KPI cards.
  - **Transition + uncertainty phrasebanks:** ready-made connective phrases ("The data reveals…", "This leads us to ask…") and hedging patterns ("With 95% confidence…", present ranges "$400K–$600K"). Useful templated language for narrative generation.
  - **Visualization techniques:** Progressive Reveal (layer one insight per slide), Contrast/Compare (before-after), Annotation/Highlight (callouts + threshold lines + shaded regions) — maps to bi-pattern-library annotation patterns.
  - **Do/don't:** lead with the "so what"; rule of three; show don't tell; end with action. Don't data-dump, don't bury the insight, don't use jargon, don't lead with methodology.
- **Source path within repo:** `skills/data-storytelling/SKILL.md`
- **Quality:** 4/5 — genuinely useful frameworks, audience-aware, cites Nussbaumer/Minto/Duarte. Python matplotlib snippet is reference-only.
- **Recommendation:** adapt (port the arc, the three templates, the headline formula, and the phrasebanks into audience-styles + report-builder narrative generation).

### dbt Transformation Patterns playbook → maps to m-query-patterns + bi-pattern-library (modeling)
- **What it is / why valuable:** A clean, production-shaped data-transformation methodology. Although it's dbt/SQL (reference-only as code), the *layering discipline* and *dimensional-modeling shape* transfer directly to how we structure M-query transformations and TMDL star schemas. The SKILL.md itself is a stub; the value is entirely in `resources/implementation-playbook.md`.
- **Key content (transferable methodology):**
  - **Medallion / layered model:** sources → staging (1:1 with source, light cleaning, rename) → intermediate (business logic, joins, aggregations) → marts (final analytics tables). This staging-vs-marts separation is exactly the discipline to encode in m-query-patterns (raw query folding layer vs business layer).
  - **Naming conventions:** `stg_<source>__<entity>`, `int_<...>`, `dim_*` / `fct_*`. A naming-convention rule we can mirror for staged queries / model tables.
  - **Source freshness contract:** `loaded_at_field` + `warn_after`/`error_after` thresholds — concept maps to refresh-staleness validation.
  - **Dimensional mart shape (the load-bearing pattern):** `dim_customers` builds a **surrogate key** (`generate_surrogate_key`) + retains a **natural key**, rolls up metrics, and derives a **calculated tier** via CASE (`lifetime_value >= 1000 → 'high'`…). `fct_orders` uses incremental **merge** strategy keyed on `order_id` with `where updated_at > max(updated_at)`. This is the canonical star-schema fact/dimension construction — directly informs how our modeling layer should describe dims, facts, surrogate keys, and incremental refresh.
  - **Testing as data contracts:** column-level `unique`, `not_null`, `relationships` (FK), `accepted_values` (enum). These are exactly the kinds of model-validation rules a BPA-style checker should assert on a semantic model.
  - **Incremental strategies:** `merge` vs `delete+insert`, `on_schema_change='append_new_columns'`, watermark predicate via `is_incremental()` — conceptually maps to Power BI incremental refresh policy.
- **Source path within repo:** `plugins/antigravity-bundle-data-engineering/skills/dbt-transformation-patterns/resources/implementation-playbook.md` (SKILL.md at sibling path is a stub)
- **Quality:** 4/5 for methodology; code is reference-only (dbt/Jinja/SQL, not Node/TS).
- **Recommendation:** reference-only for code; adapt the *methodology* (layering, naming, dim/fct surrogate-key shape, test-as-contract list, incremental-merge concept) into m-query-patterns + a model-validation checklist.

### Data Pipeline Architecture skill → maps to m-query-patterns / bi-pattern-library (source prep)
- **What it is / why valuable:** A condensed checklist of transformation-layer practices that overlaps the data-prep concerns our m-query-patterns needs.
- **Key content (transferable bits):** incremental loading with **watermark columns**; metadata tracking (`_extracted_at`, `_source`); schema validation + dead-letter handling for invalid records; staging-layer dedup + late-arriving-data handling; marts = dimensional models + aggregations; freshness checks. Plus partitioning guidance (avoid over-partitioning, keep partitions >1GB) which is conceptually relevant to large-model refresh tuning.
- **Source path within repo:** `skills/data-engineering-data-pipeline/SKILL.md`
- **Quality:** 3/5 — useful as a checklist; most of the surface (Kafka/Flink/Delta/Iceberg/CloudWatch) is out-of-scope cloud infra.
- **Recommendation:** reference-only (cherry-pick the watermark/incremental, dedup, late-arriving, and metadata-tracking concepts for m-query-patterns).

### Analytics-Product skill → partial input to data-analyst + kpi-design-rules
- **What it is / why valuable:** Product-analytics methodology. Mostly Portuguese, code is Python (PostHog) — reference-only — but two methodology pieces are worth lifting.
- **Key content (reusable):**
  - **Event taxonomy naming convention:** `[object]_[past_verb]` (correct: `user_signed_up`, `upgrade_completed`; wrong: `signup`, `click`). A clean naming rule if we ever advise on event/measure naming.
  - **Funnel-optimization loop:** for each drop-off > benchmark → Identify (where) → Understand (why) → Hypothesis → Test (A/B, statistically significant) → Measure (≥2 weeks, p<0.05) → Learn.
  - **North Star definition framework:** (1) what creates real user value, (2) what predicts long-term growth, (3) how to measure → single composite metric. Useful prompt for our data-analyst when defining a dashboard's primary metric.
  - Retention-benchmark table shape (W1/W4/W8 tiers) — pattern is reusable, the numbers are domain-specific (voice assistants) so do NOT hardcode.
- **Source path within repo:** `skills/analytics-product/SKILL.md`
- **Quality:** 3/5 — good ideas buried in stub boilerplate + non-English + Python.
- **Recommendation:** reference-only (lift event-naming convention, funnel loop, and North Star framework as data-analyst guidance).

### Dual-host bundle packaging shape → maps to our plugin/skill-bundle packaging
- **What it is / why valuable:** Each domain bundle ships TWO manifests so one skill folder serves both Claude Code and Codex. This is a clean pattern if we ever want multi-host distribution, and confirms the "bundle = curated group of skills under one plugin" shape.
- **Key content (packaging shape):**
  - Folder: `plugins/<bundle>/{.claude-plugin/plugin.json, .codex-plugin/plugin.json, skills/<skill>/SKILL.md}`.
  - `.claude-plugin/plugin.json`: `name, version, description, author{name,url}, homepage, repository, license, keywords[]`.
  - `.codex-plugin/plugin.json`: adds `"skills": "./skills/"` and an `interface{ displayName, shortDescription ("Data & Analytics · 5 curated skills"), longDescription, developerName, category, capabilities[Interactive,Write], websiteURL, brandColor }` block for marketplace display.
  - **Discovery manifest:** repo-level `skills_index.json` (canonical array manifest) governed by `schemas/skills-index.v1.schema.json`, so hosts lazy-load only `SKILL.md` for a requested `@skill-id` — a good lazy-activation pattern (echoes progressive-disclosure).
  - **SKILL.md frontmatter convention:** `name, description, risk, source, date_added` (+ optional `author, tags[], tools[]`); body sections "Use this skill when" / "Do not use this skill when" / "Instructions" / "Limitations"; heavy detail deferred to `resources/implementation-playbook.md` (progressive disclosure).
- **Source path within repo:** `plugins/antigravity-bundle-business-analyst/.claude-plugin/plugin.json`, `.../.codex-plugin/plugin.json`; `plugins/antigravity-bundle-data-engineering/.{claude,codex}-plugin/plugin.json`; `schemas/skills-index.v1.schema.json`; `README.md`
- **Quality:** 3/5 — useful structural reference; sibling agent owns the catalog/index deep-dive.
- **Recommendation:** reference-only (mirror the SKILL.md frontmatter + "use when / do not use when" + progressive-disclosure-to-playbook convention; consider the dual-manifest shape only if multi-host distribution becomes a goal).

## Cross-source overlap flags
- **KPI/dashboard methodology** here strongly overlaps the KPI/dashboard material expected from **data-goblin** and **claude-skills** mining, and likely **awesome-copilot**. This source's version is generic but well-structured (level framework + SMART + hierarchy + do/don'ts). Reviewer should DEDUPE: prefer whichever source has Power BI-specific KPI guidance for the *content*, but this source's clean framework table + lint-style do/don't rules are a good canonical scaffold.
- **Dimensional modeling (star schema / dim / fct / surrogate keys / SCD)** appears both here (dbt playbook + data-engineer skill) and almost certainly in the data-goblin **semantic-models** mining (dg3). The dbt version is SQL-flavored; the data-goblin version will be TMDL-native and should win for our actual modeling rules — keep this only as conceptual reinforcement.
- **Incremental loading / watermark / refresh policy** overlaps data-engineering content across sources (this + dg pipeline material) — converge on one set of m-query-patterns rules.
- **Data-storytelling / narrative** may overlap audience/report-narrative material in claude-skills or awesome-copilot; this source's headline formula + arc templates are distinctive and worth keeping even if deduped.
- **SKILL.md frontmatter + bundle packaging** overlaps the claude-plugin-marketplace and powerbi-agentic-plugins structure mining — defer the authoritative packaging spec to those; this is corroboration.

## Discarded / not relevant
- **business-analyst SKILL.md** — sprawling 180-line capability catalog (Tableau/Looker/Snowflake/ML/NLP/computer-vision). Generic persona prose, no actionable methodology beyond the 8-step "Response Approach"; nothing TS or Power BI specific. The KPI-framework value it gestures at is better captured in kpi-dashboard-design.
- **data-scientist SKILL.md** — huge ML/stats persona catalog (XGBoost, PyMC3, SHAP, deep learning). Out of scope for a report/model authoring plugin; reference-only at most for the "Response Approach" workflow.
- **data-engineer SKILL.md** (bundle) — exhaustive cloud-data-stack catalog (Spark/Kafka/Flink/Snowflake/AWS/Azure/GCP). Transferable concepts (dimensional modeling, SCD, watermark incremental, data contracts) are already captured via the dbt playbook + pipeline skill; the rest is non-TS infra.
- **market-sizing-analysis** (SKILL + saas example + data-sources) — TAM/SAM/SOM startup methodology. BA-flavored but finance/fundraising-oriented, not dashboard/KPI/model authoring. Not relevant.
- **startup-financial-modeling**, **startup-metrics-framework** — startup finance/fundraising; the latter is a stub pointing to a playbook. Out of scope (seed→Series-A modeling, not BI authoring).
- **airflow-dag-patterns**, **embedding-strategies**, **vector-database-engineer** (data-engineering bundle) — orchestration + RAG/vector-DB. Not relevant to Power BI report/model authoring (a sibling/other agent covers RAG).
- **grafana-dashboards**, **sql-optimization-patterns**, **sql-pro**, **data-quality-frameworks** (standalone skills/) — Grafana is a different BI tool (some dashboard-layout overlap but lower quality than kpi-dashboard-design); SQL skills are query-tuning, reference-only; data-quality-frameworks is a stub-to-playbook (its column-test concepts are already captured via the dbt test-as-contract notes).
- **All Python/SQL/dbt/Jinja code blocks** throughout — reference-only per our Node/TS-only rule. Extracted the *methodology*, not the code.
- **CATALOG.md / walkthrough.md / web-app / installer CLI** — catalog/index + distribution machinery; owned by the sibling agent taking catalog/index structure.
- **No hardcoding concerns to flag in our output** — the only risk is the department-KPI menus and retention benchmarks, which I've explicitly marked must remain suggestion libraries, never dataset-coupled logic.
