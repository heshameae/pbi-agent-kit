// Convert a bare `.Report` folder into a complete .pbip project.
//
// Ported from pbi-cli's core/report_backend.py:669-731 (`report_convert`).
// Does NOT convert .pbix → .pbip (that requires Power BI Desktop's
// "Save as .pbip" UI). What it does: takes an existing `.Report/` folder
// (perhaps cloned from another repo, exported from Fabric, etc.) and adds
// the `.pbip` top-level file + `.gitignore` so it's a complete Power BI
// project.

import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PbiCoreError } from '../errors.js';
import { writeJson } from '../pbir/io.js';

export interface ReportConvertOptions {
  /** Path to a .Report folder OR a directory containing one. */
  readonly sourcePath: string;
  /** Where to write the .pbip + .gitignore. Defaults to sourcePath's parent. */
  readonly outputPath?: string;
  /** Overwrite an existing `<name>.pbip` if one is already there. */
  readonly force?: boolean;
}

export interface ReportConvertResult {
  readonly status: 'converted';
  readonly name: string;
  readonly pbipPath: string;
  readonly reportFolder: string;
  readonly hasDefinitionPbir: boolean;
  readonly gitignoreCreated: boolean;
}

/**
 * Wrap a `.Report` folder into a `.pbip` project.
 *
 * Resolution:
 *   - If `sourcePath` IS a `.Report` folder, use it directly.
 *   - Otherwise, look for a `*.Report` child inside `sourcePath`.
 *
 * Writes:
 *   - `<output>/<name>.pbip`
 *   - `<output>/.gitignore` (only if missing)
 */
export function reportConvert(opts: ReportConvertOptions): ReportConvertResult {
  const sourcePath = path.resolve(opts.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new PbiCoreError(`Source path does not exist: ${sourcePath}`);
  }

  let reportFolder: string | null = null;
  if (sourcePath.endsWith('.Report') && isDirectory(sourcePath)) {
    reportFolder = sourcePath;
  } else if (isDirectory(sourcePath)) {
    for (const child of readdirSync(sourcePath)) {
      const childPath = path.join(sourcePath, child);
      if (child.endsWith('.Report') && isDirectory(childPath)) {
        reportFolder = childPath;
        break;
      }
    }
  }

  if (reportFolder === null) {
    throw new PbiCoreError(
      `No .Report folder found in '${sourcePath}'. Expected a folder ending in .Report.`,
    );
  }

  const name = path.basename(reportFolder).slice(0, -'.Report'.length);
  const target = opts.outputPath ? path.resolve(opts.outputPath) : path.dirname(reportFolder);

  // Write .pbip
  const pbipPath = path.join(target, `${name}.pbip`);
  if (existsSync(pbipPath) && !opts.force) {
    throw new PbiCoreError(
      `.pbip file already exists at '${pbipPath}'. Pass force: true to overwrite.`,
    );
  }
  writeJson(pbipPath, {
    version: '1.0',
    artifacts: [{ report: { path: `${name}.Report` } }],
    settings: { enableAutoRecovery: true },
  });

  // Write .gitignore (only if missing)
  const gitignorePath = path.join(target, '.gitignore');
  let gitignoreCreated = false;
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '# Power BI local settings\n.pbi/\n*.pbix\n*.bak\n', 'utf-8');
    gitignoreCreated = true;
  }

  return {
    status: 'converted',
    name,
    pbipPath,
    reportFolder,
    hasDefinitionPbir: existsSync(path.join(reportFolder, 'definition.pbir')),
    gitignoreCreated,
  };
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
