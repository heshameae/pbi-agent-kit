#!/usr/bin/env node

const REFUSAL =
  'Report authoring is not available in the modeling beta. I can help prepare the semantic model for that report: inventory the live model, define KPI and measure intent, validate fields, relationships, and date grain, create governed measures, Date tables, and relationships, run model checks, refresh the model, or produce a modeling-only prep spec.';
const SCOPE_NOTICE =
  'Modeling beta scope: report/dashboard/page/visual/PBIR authoring in the user request is unavailable. Do not design, create, edit, bind, format, publish, export, or validate report artifacts. Continue only explicit semantic-model work such as model inventory, KPI or measure intent, DAX, Date tables, relationships, star-schema planning, refresh, model checks, or modeling-only prep specs.';

// Matches report/dashboard skill or agent NAMES (keyword match in a prompt or
// tool input). Must list every non-modeling skill/agent that lives in the repo
// (now under skills-report/ and agents-report/) so a stale slash-expansion or
// Skill/Task call by name is still refused even though those are no longer
// auto-scanned into the modeling-beta plugin surface.
const REPORT_SKILL_OR_AGENT_PATTERN =
  /\b(?:planning-dashboards|designing-reports|pbi-report|pbi-pages|pbi-visuals|pbi-layout|pbi-themes|pbi-filters|pbi-bookmarks|pbi-status|pbi-validate|reviewing-reports|lineage-analysis|report-builder|report-reviewer)\b/i;
const REPORT_MCP_TOOL_PATTERN =
  /^mcp__.*__pbi_(?:report|page|visual|theme|filter|bookmark|format|layout)_/i;
const REPORT_OBJECT_PATTERN =
  /\b(?:dashboard|dashboards|report|reports|reporting page|report page|pages|visual|visuals|visualization|visualizations|chart|charts|graph|graphs|card|cards|kpi card|kpi cards|matrix|matrices|table visual|table visuals|map|maps|gauge|gauges|slicer|slicers|bookmark|bookmarks|drillthrough|tooltip|tooltips|navigation|theme|themes|layout|layouts|canvas|pdf|ppt|pptx|pbir|\.report|visual\.json|report\.json)\b|(?:page|visual)\s+filters?\b|filter\s+pane\b/i;
const MODELING_INTENT_PATTERN =
  /\b(?:semantic model|data model|modeling|model prep|model preparation|model readiness|prepare (?:the )?(?:semantic )?model|prep (?:the )?(?:semantic )?model|ready (?:the )?(?:semantic )?model|model check|model checks|model inventory|measure|measures|measure intent|kpi definition|dax|relationship|relationships|star schema|date table|date grain|grain|table|tables|column|columns|power query|partition|refresh|rls|ols|lineage|sensitivity|regulated|copilot readiness)\b/i;
const AUTHORING_VERB_PATTERN =
  /\b(?:build|create|make|design|generate|draft|produce|add|edit|update|format|lay\s*out|layout|publish|deploy|bind|place|resize|style|arrange|show|visualize|plot|display|draw|render|scaffold)\b/i;
const AUTHORING_NOUN_PATTERN = /\b(?:wireframe|mockup|layout|visual design|visualization)\b/i;
const MODELING_TARGET_PATTERN =
  /\b(?:measure|measures|model|semantic model|data model|dax|relationship|relationships|date table|date grain|table|tables|column|columns|power query|kpi definition|measure intent)\b/i;

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const raw = Buffer.concat(chunks).toString('utf8').trim();
if (!raw) {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

// Internal/dogfood-only override: setting PBI_MCP_ALLOW_REPORT_AUTHORING=1
// disables ALL modeling-beta scope blocking (report prompts, report skill/agent
// expansion, report tool calls). It exists for the full report/PBIR dogfood
// profile and must NOT be set in a public modeling-beta install.
if (process.env.PBI_MCP_ALLOW_REPORT_AUTHORING === '1') {
  process.exit(0);
}

const hookEventName = String(payload.hook_event_name ?? payload.hookEventName ?? '');
const toolName = String(payload.tool_name ?? payload.toolName ?? '');
const toolInput = payload.tool_input ?? payload.toolInput ?? {};

function asText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function promptText(input) {
  const candidates = [
    input.prompt,
    input.user_prompt,
    input.userPrompt,
    input.message,
    input.command,
    input.expanded_prompt,
    input.expandedPrompt,
    input.text,
    input.input,
  ];
  const direct = candidates.map(asText).filter(Boolean).join('\n');
  return direct || asText(input);
}

function toolText() {
  return `${toolName}\n${asText(toolInput)}`;
}

function hasDirectAuthoringPhrase(text) {
  const normalized = text.replace(/\s+/g, ' ');
  const actionObjectPattern =
    /\b(build|create|make|design|generate|draft|produce|add|edit|update|format|lay\s*out|layout|publish|deploy|bind|place|resize|style|arrange|show|visualize|plot|display|draw|render|scaffold)\b([\s\S]{0,90}?)\b(dashboard|dashboards|report|reports|report page|reporting page|page|pages|visual|visuals|chart|charts|graph|graphs|slicer|slicers|bookmark|bookmarks|theme|themes|layout|layouts|canvas|pbir|\.report|report\.json)\b/gi;

  for (const match of normalized.matchAll(actionObjectPattern)) {
    const prefix = normalized.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
    if (/\b(?:do not|don't|dont|never|not|without)\s+$/i.test(prefix)) continue;
    const between = String(match[2] ?? '');
    if (!MODELING_TARGET_PATTERN.test(between)) return true;
  }

  const objectActionPattern =
    /\b(dashboard|dashboards|report|reports|report page|reporting page|page|pages|visual|visuals|chart|charts|graph|graphs|slicer|slicers|bookmark|bookmarks|theme|themes|layout|layouts|canvas|pbir|\.report|report\.json)\b([\s\S]{0,90}?)\b(build|create|make|design|generate|draft|produce|add|edit|update|format|lay\s*out|layout|publish|deploy|bind|place|resize|style|arrange|show|visualize|plot|display|draw|render|scaffold)\b/gi;

  for (const match of normalized.matchAll(objectActionPattern)) {
    const prefix = normalized.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
    if (/\b(?:do not|don't|dont|never|not|without)\s+$/i.test(prefix)) continue;
    const between = String(match[2] ?? '');
    if (/\b(?:do not|don't|dont|never|not|without)\s*$/i.test(between)) continue;
    if (!MODELING_TARGET_PATTERN.test(between)) return true;
  }

  return false;
}

function classifyPrompt(text) {
  if (!text) return 'allow';
  if (REPORT_SKILL_OR_AGENT_PATTERN.test(text)) return 'block';
  if (!REPORT_OBJECT_PATTERN.test(text)) return 'allow';

  const hasModelingIntent = MODELING_INTENT_PATTERN.test(text);
  if (hasDirectAuthoringPhrase(text)) return hasModelingIntent ? 'notice' : 'block';
  if (hasModelingIntent) return 'allow';

  return AUTHORING_VERB_PATTERN.test(text) || AUTHORING_NOUN_PATTERN.test(text) ? 'block' : 'allow';
}

function shouldBlockTool() {
  if (REPORT_MCP_TOOL_PATTERN.test(toolName)) return true;
  const text = toolText();
  return REPORT_SKILL_OR_AGENT_PATTERN.test(text);
}

function blockPrompt(eventName) {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: REFUSAL,
      hookSpecificOutput: {
        hookEventName: eventName || 'UserPromptSubmit',
      },
    }),
  );
  process.exit(0);
}

function addScopeNotice(eventName) {
  process.stdout.write(
    JSON.stringify({
      additionalContext: SCOPE_NOTICE,
      hookSpecificOutput: {
        hookEventName: eventName || 'UserPromptSubmit',
        additionalContext: SCOPE_NOTICE,
      },
    }),
  );
  process.exit(0);
}

function blockTool() {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: REFUSAL,
      },
    }),
  );
  process.exit(0);
}

if (hookEventName === 'UserPromptSubmit' || hookEventName === 'UserPromptExpansion') {
  const classification = classifyPrompt(promptText(payload));
  if (classification === 'block') {
    blockPrompt(hookEventName);
  }
  if (classification === 'notice') {
    addScopeNotice(hookEventName);
  }
  process.exit(0);
}

if (hookEventName === 'PreToolUse' || toolName) {
  if (shouldBlockTool()) {
    blockTool();
  }
}

process.exit(0);
