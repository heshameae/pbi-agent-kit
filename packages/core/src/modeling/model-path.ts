import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export type SemanticModelResolutionStatus = 'found' | 'not-found' | 'ambiguous';

export interface SemanticModelResolution {
  readonly status: SemanticModelResolutionStatus;
  readonly definitionPath?: string;
  readonly candidates: readonly string[];
  readonly reason?: string;
}

/**
 * Resolve a Power BI .SemanticModel/definition folder.
 *
 * This is intentionally conservative: if more than one candidate is visible,
 * callers must pass modelPath explicitly rather than letting the tool guess.
 */
export function resolveSemanticModelDefinition(input?: string): SemanticModelResolution {
  const start = input ? path.resolve(input) : process.cwd();
  const candidates = uniqueExistingDefinitionDirs(collectCandidates(start));

  if (candidates.length === 1) {
    return { status: 'found', definitionPath: candidates[0], candidates };
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      candidates,
      reason: 'Multiple .SemanticModel/definition folders found. Pass modelPath explicitly.',
    };
  }

  return {
    status: 'not-found',
    candidates: [],
    reason: `Could not locate a .SemanticModel/definition folder from "${input ?? process.cwd()}".`,
  };
}

/**
 * Resolve the semantic model adjacent to a .Report/definition folder.
 */
export function resolveSiblingSemanticModelDefinition(
  reportDefinitionPath: string,
): SemanticModelResolution {
  const reportDefinition = path.resolve(reportDefinitionPath);
  const reportFolder =
    path.basename(reportDefinition) === 'definition'
      ? path.dirname(reportDefinition)
      : reportDefinition;
  const projectFolder = path.dirname(reportFolder);
  const candidates = uniqueExistingDefinitionDirs(collectCandidates(projectFolder));

  if (candidates.length === 1) {
    return { status: 'found', definitionPath: candidates[0], candidates };
  }

  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      candidates,
      reason: `Multiple sibling .SemanticModel/definition folders found near "${reportDefinitionPath}". Pass modelPath explicitly.`,
    };
  }

  return {
    status: 'not-found',
    candidates: [],
    reason: `No sibling .SemanticModel/definition folder found near "${reportDefinitionPath}".`,
  };
}

function collectCandidates(start: string): string[] {
  const candidates: string[] = [];

  if (!existsSync(start)) return candidates;

  if (isDirectory(start)) {
    if (path.basename(start) === 'definition') candidates.push(start);

    if (start.endsWith('.SemanticModel')) {
      candidates.push(path.join(start, 'definition'));
    }

    candidates.push(path.join(start, 'definition'));

    for (const entry of safeReadDir(start)) {
      if (entry.endsWith('.SemanticModel')) {
        candidates.push(path.join(start, entry, 'definition'));
      }
      if (entry.endsWith('.pbip')) {
        const stem = entry.slice(0, -'.pbip'.length);
        candidates.push(path.join(start, `${stem}.SemanticModel`, 'definition'));
      }
    }

    const parent = path.dirname(start);
    if (parent !== start && existsSync(parent)) {
      for (const entry of safeReadDir(parent)) {
        if (entry.endsWith('.SemanticModel')) {
          candidates.push(path.join(parent, entry, 'definition'));
        }
      }
    }
  } else if (start.endsWith('.pbip')) {
    const dir = path.dirname(start);
    const stem = path.basename(start, '.pbip');
    candidates.push(path.join(dir, `${stem}.SemanticModel`, 'definition'));
    for (const entry of safeReadDir(dir)) {
      if (entry.endsWith('.SemanticModel')) {
        candidates.push(path.join(dir, entry, 'definition'));
      }
    }
  }

  return candidates;
}

function uniqueExistingDefinitionDirs(candidates: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!isDirectory(resolved)) continue;
    if (!looksLikeDefinitionFolder(resolved)) continue;
    out.push(resolved);
  }

  return out;
}

function looksLikeDefinitionFolder(definitionPath: string): boolean {
  return (
    existsSync(path.join(definitionPath, 'database.tmdl')) ||
    existsSync(path.join(definitionPath, 'model.tmdl')) ||
    isDirectory(path.join(definitionPath, 'tables'))
  );
}

function safeReadDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
