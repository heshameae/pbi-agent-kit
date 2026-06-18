#!/usr/bin/env node

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

const toolName = String(payload.tool_name ?? payload.toolName ?? '');
const toolInput = payload.tool_input ?? payload.toolInput ?? {};

function normalizePathForCheck(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  const cwd =
    typeof payload.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : process.cwd();
  return value.startsWith('/') ? value : `${cwd}/${value}`;
}

function isWithinRoot(filePath, rootPath) {
  if (!filePath || !rootPath) return false;
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

function isPowerBiArtifactPath(filePath) {
  return /(?:\.SemanticModel|\.Report)(?:\/|$)|\.(?:tmdl|pbip|pbix|pbit|pbir|csv)$/i.test(
    filePath.replace(/\\/g, '/'),
  );
}

function isAllowedPowerBiArtifactEdit(filePath) {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? '';
  if (!isWithinRoot(filePath, pluginRoot)) return false;
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedRoot = pluginRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const relative = normalizedFile.slice(normalizedRoot.length).replace(/^\/+/, '');
  return /(?:^|\/)(?:fixtures|templates)(?:\/|$)/.test(relative);
}

function rawPowerBiArtifactSurgery(command) {
  const normalized = command.replace(/\\/g, '/');
  if (!isPowerBiArtifactPath(normalized)) return false;
  const redirectsToArtifact =
    /(?:^|[^<>])>{1,2}\s*(?:"[^"]*(?:\.SemanticModel|\.Report|\.tmdl|\.pbip|\.pbix|\.pbit|\.pbir|\.csv)[^"]*"|'[^']*(?:\.SemanticModel|\.Report|\.tmdl|\.pbip|\.pbix|\.pbit|\.pbir|\.csv)[^']*'|[^\s;&|<>]*(?:\.SemanticModel|\.Report|\.tmdl|\.pbip|\.pbix|\.pbit|\.pbir|\.csv)[^\s;&|<>]*)/i.test(
      normalized,
    ) ||
    /<<-?\s*(?:"[^"]*(?:\.SemanticModel|\.Report|\.tmdl|\.pbip|\.pbix|\.pbit|\.pbir|\.csv)[^"]*"|'[^']*(?:\.SemanticModel|\.Report|\.tmdl|\.pbip|\.pbix|\.pbit|\.pbir|\.csv)[^']*'|[^\s;&|<>]*(?:\.SemanticModel|\.Report|\.tmdl|\.pbip|\.pbix|\.pbit|\.pbir|\.csv)[^\s;&|<>]*)/i.test(
      normalized,
    );
  const invokesNodeWrite =
    /(^|[\s;&|({])node(?:\s|$)/i.test(command) &&
    /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|write(?:Sync)?|createWriteStream|open(?:Sync)?|cp(?:Sync)?|rm(?:Sync)?|unlink(?:Sync)?|rename(?:Sync)?|copyFile(?:Sync)?|truncate(?:Sync)?|mkdir(?:Sync)?)\b/.test(
      command,
    );
  const invokesSedInPlace = /(^|[\s;&|({])sed\s+(?:(?![\s;&|]).)*-i\b/i.test(command);
  const invokesJqWrite = /(^|[\s;&|({])jq(?:\s|$)/i.test(command) && />/.test(command);
  const invokesPerlInPlace =
    /(^|[\s;&|({])perl\s+/i.test(command) && /(?:^|\s)-[A-Za-z]*i[A-Za-z]*(?:\s|$)/.test(command);
  const invokesShellWrite =
    /(^|[\s;&|({])(?:tee|truncate|dd|mv|cp|rm)(?:\s|$)/i.test(command) &&
    /(?:>|\.SemanticModel|\.Report|\.tmdl|\.pbip|\.pbix|\.pbit|\.pbir|\.csv)/i.test(normalized);
  return (
    redirectsToArtifact ||
    invokesNodeWrite ||
    invokesSedInPlace ||
    invokesJqWrite ||
    invokesPerlInPlace ||
    invokesShellWrite
  );
}

function directMicrosoftModelingWrite(toolName, toolInput) {
  if (!/^mcp__/.test(toolName)) return false;
  const rawToolName = toolName.split('__').at(-1) ?? '';
  const microsoftModelingTools = new Set([
    'calculation_group_operations',
    'calendar_operations',
    'column_operations',
    'connection_operations',
    'culture_operations',
    'database_operations',
    'dax_query_operations',
    'function_operations',
    'measure_operations',
    'model_operations',
    'named_expression_operations',
    'object_translation_operations',
    'partition_operations',
    'perspective_operations',
    'query_group_operations',
    'relationship_operations',
    'security_role_operations',
    'table_operations',
    'trace_operations',
    'transaction_operations',
    'user_hierarchy_operations',
  ]);
  if (!microsoftModelingTools.has(rawToolName)) return false;
  const request =
    toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput)
      ? (toolInput.request ?? toolInput)
      : {};
  const operation =
    request && typeof request === 'object' && !Array.isArray(request)
      ? String(request.operation ?? '')
      : '';
  const readOperations = new Set([
    'Help',
    'Get',
    'List',
    'Find',
    'Validate',
    'ExportTMDL',
    'ExportTMSL',
    'GetConnection',
    'ListConnections',
    'ListLocalInstances',
    'GetLastUsed',
    'GetStats',
    'GetSchema',
    'GetValidNames',
    'GetValidDetails',
    'GetDetailsByName',
    'GetDetailsByLCID',
    'GetGroup',
    'ListGroups',
    'GetItems',
    'ListItems',
    'GetPermissions',
    'ListPermissions',
    'GetEffectivePermissions',
    'GetTables',
    'ListTables',
    'GetColumns',
    'ListColumns',
    'GetMeasures',
    'ListMeasures',
    'GetHierarchies',
    'ListHierarchies',
  ]);
  return operation.length > 0 && !readOperations.has(operation);
}

if (directMicrosoftModelingWrite(toolName, toolInput)) {
  console.error(
    [
      'Blocked: Direct Microsoft Power BI modeling MCP writes bypass pbi-agent-kit wrapper gates.',
      'Use the supported pbi_* tools so deterministic relationship, Date, DAX, and governance checks run before any model mutation.',
    ].join('\n'),
  );
  process.exit(2);
}

const directEditTools = new Set(['Edit', 'Write', 'MultiEdit', 'Update']);
if (directEditTools.has(toolName)) {
  const filePath = normalizePathForCheck(
    toolInput.file_path ?? toolInput.filePath ?? toolInput.path,
  );
  if (isPowerBiArtifactPath(filePath) && !isAllowedPowerBiArtifactEdit(filePath)) {
    console.error(
      [
        'Blocked: raw Power BI artifact edits are not allowed for live modeling/reporting work.',
        'Use the supported pbi_* MCP tools and deterministic planners. If the MCP tool surface cannot perform the operation, stop and report it as unsupported instead of editing .SemanticModel/.Report/TMDL/PBIP/CSV files.',
      ].join('\n'),
    );
    process.exit(2);
  }
  process.exit(0);
}

if (toolName && toolName !== 'Bash') {
  process.exit(0);
}

const command = String(toolInput.command ?? '');
if (!command) {
  process.exit(0);
}

const invokesPython =
  /(^|[\s;&|({])(?:python(?:\d+(?:\.\d+)?)?|pip\d?)(?=$|[\s;&|)])/i.test(command) ||
  /(^|[\s;&|({])(?:[~./A-Za-z0-9_-]+\/)+(?:python(?:\d+(?:\.\d+)?)?|pip\d?)(?=$|[\s;&|)])/i.test(
    command,
  ) ||
  /(^|[\s;&|({])(?:"[^"]*\/(?:python(?:\d+(?:\.\d+)?)?|pip\d?)"|'[^']*\/(?:python(?:\d+(?:\.\d+)?)?|pip\d?)')(?=$|[\s;&|)])/i.test(
    command,
  ) ||
  /(^|[\s;&|({])(?:uv|poetry)\s+run\s+python(?:\d+(?:\.\d+)?)?(?=$|[\s;&|)])/i.test(command);

if (invokesPython) {
  console.error(
    [
      'Blocked: Python must not be used for pbi-agent-kit operations.',
      'Use the TypeScript pbi_* MCP tools, deterministic planners, or repo-native Node/TypeScript tooling instead. If the MCP tool surface cannot perform a Power BI operation, stop and report it as unsupported; do not inspect or patch data/model/report files with Python.',
    ].join('\n'),
  );
  process.exit(2);
}

if (rawPowerBiArtifactSurgery(command)) {
  console.error(
    [
      'Blocked: raw Power BI artifact file surgery is not allowed.',
      'Use the supported pbi_* MCP tools and deterministic planners. If the tool surface cannot perform the operation, stop and report it as unsupported instead of mutating .SemanticModel/.Report/TMDL/PBIP/CSV artifacts with shell scripts.',
    ].join('\n'),
  );
  process.exit(2);
}

process.exit(0);
