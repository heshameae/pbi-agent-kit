---
marp: true
theme: default
paginate: true
size: 16:9
style: |
  section {
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
    font-size: 22px;
    padding: 56px 72px;
    background: #ffffff;
    color: #0f172a;
    line-height: 1.5;
  }

  h1 {
    font-size: 40px;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 6px 0;
    letter-spacing: -0.02em;
  }
  h1::after {
    content: "";
    display: block;
    width: 44px;
    height: 4px;
    background: #2563eb;
    margin-top: 12px;
    border-radius: 2px;
  }

  h2 {
    font-size: 24px;
    font-weight: 600;
    color: #1e293b;
    margin: 18px 0 10px 0;
  }

  h3 {
    font-size: 14px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 18px 0 8px 0;
  }

  p { color: #334155; margin: 4px 0; }
  strong { color: #0f172a; font-weight: 600; }

  code {
    background: #f1f5f9;
    color: #0f172a;
    padding: 2px 7px;
    border-radius: 4px;
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.85em;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    font-size: 18px;
  }
  th {
    text-align: left;
    background: #f8fafc;
    color: #0f172a;
    padding: 10px 14px;
    border-bottom: 2px solid #cbd5e1;
    font-weight: 600;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  td {
    padding: 10px 14px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
    color: #334155;
  }

  ul, ol { margin: 6px 0; padding-left: 22px; }
  li { margin-bottom: 4px; color: #334155; }

  section.title {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 100px;
    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  }
  section.title h1 {
    font-size: 64px;
    margin-bottom: 12px;
    border: none;
  }
  section.title h1::after { display: none; }
  section.title .lead {
    font-size: 24px;
    color: #64748b;
    font-weight: 400;
  }
  section.title .meta {
    margin-top: 56px;
    font-size: 13px;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
    margin-top: 18px;
  }

  .card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 24px;
  }
  .card h2 {
    margin-top: 0;
    margin-bottom: 14px;
    color: #2563eb;
    font-size: 22px;
  }
  .card .stat {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 0;
    font-size: 17px;
    color: #475569;
  }
  .card .stat:last-of-type { border-bottom: none; }
  .card .stat strong { color: #0f172a; font-size: 18px; }
  .card .desc {
    margin-top: 14px;
    font-size: 15px;
    color: #64748b;
    font-style: italic;
  }

  .progress-row {
    display: grid;
    grid-template-columns: 200px 1fr 60px;
    gap: 16px;
    align-items: center;
    margin-bottom: 10px;
    font-size: 18px;
  }
  .agent-name {
    font-weight: 500;
    color: #1e293b;
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 16px;
  }
  .progress {
    background: #e2e8f0;
    height: 10px;
    border-radius: 5px;
    overflow: hidden;
  }
  .bar { height: 100%; border-radius: 5px; }
  .pct {
    font-weight: 600;
    color: #475569;
    text-align: right;
    font-size: 16px;
  }
  .b-done { background: #16a34a; }
  .b-mid  { background: #ca8a04; }
  .b-low  { background: #ea580c; }
  .b-zero { background: #94a3b8; }

  .badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .badge-done   { background: #dcfce7; color: #15803d; }
  .badge-flight { background: #fef3c7; color: #b45309; }
  .badge-todo   { background: #f1f5f9; color: #475569; }
  .badge-warn   { background: #fee2e2; color: #b91c1c; }

  .callout {
    background: #fef2f2;
    border-left: 4px solid #dc2626;
    padding: 12px 16px;
    border-radius: 4px;
    margin: 14px 0;
    font-size: 17px;
    color: #991b1b;
    font-weight: 500;
  }

  .footnote {
    position: absolute;
    bottom: 24px;
    left: 72px;
    font-size: 13px;
    color: #94a3b8;
    font-style: italic;
  }

  section::after {
    color: #cbd5e1;
    font-size: 13px;
  }

  .bet h2 {
    color: #2563eb;
    font-size: 22px;
    margin-bottom: 4px;
    margin-top: 24px;
  }
  .bet p {
    font-size: 18px;
    color: #475569;
    margin-top: 0;
  }
---

<!-- _class: title -->

# pbi-mcp-ts

<p class="lead">State of the plugin · Roadmap to production</p>

<p class="meta">May 2026</p>

---

# The two layers

<div class="two-col">

<div class="card">

## Report layer

<div class="stat"><span>Agents</span><strong>5</strong></div>
<div class="stat"><span>Skills</span><strong>13</strong></div>
<div class="stat"><span>Hooks</span><strong>1</strong></div>
<div class="stat"><span>MCP tools</span><strong>46</strong></div>

<p class="desc">PBIR JSON · pages, visuals, bindings, themes</p>

</div>

<div class="card">

## Modeling layer

<div class="stat"><span>Agents</span><strong>2</strong></div>
<div class="stat"><span>Skills</span><strong>2</strong></div>
<div class="stat"><span>Our MCP tools</span><strong>1</strong></div>
<div class="stat"><span>External MCP</span><strong>Microsoft</strong></div>

<p class="desc">TMDL · tables, columns, measures, relationships</p>

</div>

</div>

<div class="footnote">47 MCP tools · 16 skills · 7 agents · 1 hook · 500 tests</div>

---

# Report layer — status

<h3>Agent progress</h3>

<div class="progress-row">
<span class="agent-name">bulk-operator</span>
<div class="progress"><div class="bar b-done" style="width: 100%"></div></div>
<span class="pct">100%</span>
</div>

<div class="progress-row">
<span class="agent-name">bind-doctor</span>
<div class="progress"><div class="bar b-mid" style="width: 60%"></div></div>
<span class="pct">60%</span>
</div>

<div class="progress-row">
<span class="agent-name">designer</span>
<div class="progress"><div class="bar b-low" style="width: 20%"></div></div>
<span class="pct">20%</span>
</div>

<div class="progress-row">
<span class="agent-name">report-reviewer</span>
<div class="progress"><div class="bar b-zero" style="width: 2%"></div></div>
<span class="pct">0%</span>
</div>

<div class="progress-row">
<span class="agent-name">report-validator</span>
<div class="progress"><div class="bar b-zero" style="width: 2%"></div></div>
<span class="pct">0%</span>
</div>

<h3>Done</h3>

PBIR CRUD · 3 dashboard scaffolds · layout primitives · validator hook · bulk-operator agent

---

# Report layer — to do

<table>
<tr><th>Item</th><th style="width: 130px">Status</th></tr>
<tr><td>Finish <strong>designer</strong> — real alignment / sizing / spacing fixes</td><td><span class="badge badge-flight">in flight</span></td></tr>
<tr><td>Finish <strong>bind-doctor</strong> — deterministic <code>pbi_visual_bind_check</code></td><td><span class="badge badge-flight">in flight</span></td></tr>
<tr><td>Reconcile <strong>reviewer vs validator</strong> — merge or split clearly</td><td><span class="badge badge-todo">to do</span></td></tr>
<tr><td>Integrate your <strong>design system + themes</strong></td><td><span class="badge badge-todo">to do</span></td></tr>
<tr><td>Skills to flesh out: themes · format · filters · bookmarks · scaffold-kpi-grid</td><td><span class="badge badge-todo">to do</span></td></tr>
<tr><td>TopN filter shape bug (Task #32)</td><td><span class="badge badge-warn">known bug</span></td></tr>
<tr><td>Phase 9: Desktop auto-sync (Windows)</td><td><span class="badge badge-todo">later</span></td></tr>
</table>

---

# Modeling layer — status

<h3>Agent progress</h3>

<div class="progress-row">
<span class="agent-name">data-architect</span>
<div class="progress"><div class="bar b-low" style="width: 25%"></div></div>
<span class="pct">25%</span>
</div>

<div class="progress-row">
<span class="agent-name">model-doctor</span>
<div class="progress"><div class="bar b-low" style="width: 20%"></div></div>
<span class="pct">20%</span>
</div>

<h3>Skill progress</h3>

<div class="progress-row">
<span class="agent-name">measure-architect</span>
<div class="progress"><div class="bar b-done" style="width: 95%"></div></div>
<span class="pct">95%</span>
</div>

<div class="progress-row">
<span class="agent-name">time-intelligence</span>
<div class="progress"><div class="bar b-mid" style="width: 70%"></div></div>
<span class="pct">70%</span>
</div>

<h3>Done</h3>

measure-architect (DAX synthesis) · TMDL parser · BPA rules skeleton · prompt-level fixes (untrustworthy)

---

# Modeling layer — to do

<div class="callout">⚠ Layer is mostly aspirational right now</div>

<table>
<tr><th>Item</th><th style="width: 130px">Status</th></tr>
<tr><td><strong>Relationships</strong> — architect proposes but doesn't reliably create</td><td><span class="badge badge-warn">not there</span></td></tr>
<tr><td><strong>Validations</strong> — model-doctor exists but doesn't catch real bugs</td><td><span class="badge badge-warn">not there</span></td></tr>
<tr><td><code>pbi_measure_create_safe</code> — code-enforced reference check + magic-number ban</td><td><span class="badge badge-flight">in flight</span></td></tr>
<tr><td>Architect <strong>certification token</strong> (code-enforced handoff)</td><td><span class="badge badge-flight">in flight</span></td></tr>
<tr><td>Bridge-blocked-axis check baked into bind tool</td><td><span class="badge badge-flight">in flight</span></td></tr>
<tr><td>Phase 8.8b: live DAX / cardinality probe (Windows)</td><td><span class="badge badge-todo">later</span></td></tr>
</table>

---

# Project roadmap

<p style="color: #64748b; margin-bottom: 14px; font-size: 17px;">Sprint = 2 weeks · Total ~8 sprints (~16 weeks · ~4 months)</p>

<table>
<tr><th style="width: 90px">Sprint</th><th style="width: 270px">Focus</th><th>Outcome</th></tr>
<tr><td><strong>1–2</strong></td><td>Deterministic orchestration</td><td>Code-gated tools replace markdown rules. No more bypassing the architect, no more fabricated measures.</td></tr>
<tr><td><strong>3–4</strong></td><td>Modeling layer reliability</td><td>Architect actually creates relationships. model-doctor actually catches bugs. Live DAX probe if Windows tester available.</td></tr>
<tr><td><strong>5</strong></td><td>Report agents to 100%</td><td>Designer finished. bind-doctor stops breaking. Reviewer / validator reconciled.</td></tr>
<tr><td><strong>6</strong></td><td>Design system + skill polish</td><td>Your themes integrated. format / filter / bookmark / kpi-grid skills filled out.</td></tr>
<tr><td><strong>7</strong></td><td>Phase 9 — Desktop auto-sync</td><td>Windows close-save-reopen automated. Zero manual reload.</td></tr>
<tr><td><strong>8</strong></td><td>Phase 10 — Release polish</td><td>README, marketplace submission. Usable beyond you.</td></tr>
</table>

---

# What we're betting on next

<div class="bet">

<h2>1 · Deterministic orchestration</h2>
<p>Markdown rules drift. Code-enforced gates don't.</p>

<h2>2 · Modeling reliability</h2>
<p>Architect must be impossible to bypass. Fabrication firewall must be impossible to defeat.</p>

<h2>3 · Production readiness</h2>
<p>Phase 9 + 10 ship the plugin beyond the internal team.</p>

</div>

<div class="footnote">From pbi-cli (Python, no agents) to pbi-mcp-ts (TS, 7 agents, 16 skills, 47 MCP tools) in ~9 months. Next 16 weeks tighten the bolts.</div>
