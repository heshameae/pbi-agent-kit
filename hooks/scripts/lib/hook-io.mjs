//
// Shared stdin + allow/deny exit helpers for every hook script.
// Exit 0 lets the tool through; exit 2 + stderr JSON tells Claude Code
// to refuse the call and surface the reason to the agent.
// Why: every hook does the same parse-stdin + allow-or-deny dance —
// keeping it in one place keeps the hook scripts small and consistent.
//
export async function readStdinJson() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`hook stdin is not valid JSON: ${err.message}`);
  }
}

export function normalizeRequest(input) {
  const toolInput = input?.tool_input ?? {};
  const request = toolInput.request ?? toolInput;
  return typeof request === 'object' && request !== null ? request : {};
}

export function extractDefinitions(request) {
  if (Array.isArray(request?.definitions)) return request.definitions;
  if (Array.isArray(request?.definition)) return request.definition;
  if (request?.definition && typeof request.definition === 'object') return [request.definition];
  return [];
}

export function extractToolResponse(input) {
  return input?.tool_response ?? null;
}

export function allow() {
  process.exit(0);
}

export function deny(payload) {
  const message =
    typeof payload === 'string' ? payload : JSON.stringify(payload ?? { reason: 'denied' }, null, 2);
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

export function failOpenWithLog(error) {
  process.stderr.write(
    `[pbi-mcp-ts hook] non-fatal hook error: ${error?.message ?? String(error)}\n`,
  );
  process.exit(0);
}
