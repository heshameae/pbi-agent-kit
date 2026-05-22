# Intake Protocol

Discipline for turning vague dashboard requests into a validated plan before building anything.

## When to Route Here

Route here when the user's prompt lacks **two or more** of:
- Specific measures or KPIs to show
- A target audience or decision context ("for the CFO", "for weekly ops review")
- Structural preferences (page count, visual types, layout)
- Formatting direction (colors, style, brand)

Prompts like "create a sales dashboard", "build me a report with some KPIs", or "make a fancy executive dashboard" all qualify.

---

## Step 1 — Acknowledge and Reframe

Do not lecture or refuse to work. Explain briefly that a few specifics will dramatically improve the result, then ask targeted questions. Frame it as collaboration, not gatekeeping.

> "I can build this; a few details will make it much better. What decisions should this report help someone make? And which 2–3 numbers matter most?"

---

## Step 2 — Ask the Minimum Viable Questions

**Three questions are enough to start.** Do not interview the user with 10 questions.

1. **What decisions does this report support?** This reveals audience, KPIs, and appropriate level of detail.
2. **Which 2–3 measures matter most?** If the user can't name them, explore the model and propose candidates.
3. **Any style or brand preferences?** Colors, fonts, existing reports to match. If none, apply the professional default.

If the user still deflects ("just make it look good"), proceed with sensible defaults — but flag the result as a starting point to iterate on, not a finished product.

---

## Step 3 — Apply Sensible Defaults

| Decision | Default | Rationale |
|---|---|---|
| Theme | Check if a theme is applied; if not, apply the standard professional theme | Typography and colors |
| Layout | Executive dashboard pattern (KPI row → trend chart → breakdown → detail table) | Most broadly useful; follows 3-30-300 |
| Page size | 1280×720 | Standard 16:9 |
| KPI selection | Top measures by business importance from the model | Explore and propose before building |
| Time granularity | Monthly if yearly filter context; weekly/daily if monthly | Match grain to decision cadence |
| Conditional formatting | Gap/variance columns only; theme sentiment colors | Formatting everything means formatting nothing |

---

## Step 4 — Propose Before Building

Always present a concrete proposal before executing. Include:
- Which KPI cards and what measures they display
- What chart types and what dimensions they break down by
- What detail table or matrix columns to include
- How filters scope the data
- The theme and color approach

**Revising a plan is cheap; rebuilding visuals is expensive.**

---

## Audience Archetypes

| Audience | Primary questions | Visual preference | Detail level |
|---|---|---|---|
| Executive | "Are we on track?" "What needs my attention?" | KPI cards, RAG status, 1–2 trend lines | Summary only |
| Analytical | "Why is this happening?" "What's the breakdown?" | Tables, small multiples, drill-through | Full detail |
| Operational | "What do I act on today?" "Who needs follow-up?" | Real-time lists, status indicators, mobile-friendly | Action-oriented |

---

## What Not to Do

- Do not refuse to work because the prompt is vague
- Do not generate a 10-question interview; three targeted questions are enough
- Do not build a generic report and call it done; iterate toward specifics
- Do not assume the user's reluctance means they don't care; they likely can't yet articulate it in report-design terms
