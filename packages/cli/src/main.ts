#!/usr/bin/env node
// pbi-ts CLI — thin commander wrapper around pbi-core.
//
// Mirrors the verb structure of pbi-cli (Python) but talks to the TS engine.
// --json prints raw JSON for agent/script consumption; default human prints
// indented JSON to stdout (no tables yet — that's Phase 5+).

import { Command } from 'commander';
import {
  VERSION,
  pageAdd,
  pageDelete,
  pageGet,
  pageList,
  pageSetBackground,
  pageSetVisibility,
  reportCreate,
  reportInfo,
  resolveReportPath,
  validateReportFull,
} from 'pbi-core';

const program = new Command();

program
  .name('pbi-ts')
  .description('Power BI PBIR report authoring (TypeScript port of pbi-cli)')
  .version(VERSION)
  .option('--json', 'Output raw JSON for agent/script consumption', false);

function out(result: unknown): void {
  // Always indented JSON to stdout. The --json flag is reserved for future
  // table-vs-json behaviour and is currently a no-op.
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

// -- report ----------------------------------------------------------------

const report = program.command('report').description('Report-level operations');

report
  .command('create <name>')
  .description('Scaffold a new PBIR report project')
  .option('-t, --target <path>', 'Target directory for the new .pbip', process.cwd())
  .option('--dataset-path <path>', 'Path to an existing .SemanticModel (relative or absolute)')
  .action((name: string, opts: { target: string; datasetPath?: string }) => {
    const result = reportCreate({
      targetPath: opts.target,
      name,
      datasetPath: opts.datasetPath,
    });
    out(result);
  });

report
  .command('info')
  .description('Print report metadata summary')
  .option('-p, --path <path>', 'Path to the .Report folder (auto-detected if omitted)')
  .action((opts: { path?: string }) => {
    const defn = resolveReportPath(opts.path);
    out(reportInfo(defn));
  });

report
  .command('validate')
  .description('Run full PBIR validation (structural + schema + cross-file)')
  .option('-p, --path <path>', 'Path to the .Report folder (auto-detected if omitted)')
  .action((opts: { path?: string }) => {
    const defn = resolveReportPath(opts.path);
    const r = validateReportFull(defn);
    out(r);
    if (!r.valid) process.exitCode = 1;
  });

// -- page ------------------------------------------------------------------

const page = program.command('page').description('Page CRUD');

page
  .command('list')
  .description('List all pages in the report')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .action((opts: { path?: string }) => {
    out(pageList(resolveReportPath(opts.path)));
  });

page
  .command('add <displayName>')
  .description('Add a new page')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .option('-n, --name <name>', 'Explicit page id (auto-generated if omitted)')
  .option('--width <px>', 'Page width in pixels', '1280')
  .option('--height <px>', 'Page height in pixels', '720')
  .option(
    '--display-option <opt>',
    'FitToPage|FitToWidth|ActualSize|ActualSizeTopLeft',
    'FitToPage',
  )
  .action(
    (
      displayName: string,
      opts: {
        path?: string;
        name?: string;
        width: string;
        height: string;
        displayOption: string;
      },
    ) => {
      out(
        pageAdd(resolveReportPath(opts.path), {
          displayName,
          name: opts.name,
          width: Number.parseInt(opts.width, 10),
          height: Number.parseInt(opts.height, 10),
          displayOption: opts.displayOption,
        }),
      );
    },
  );

page
  .command('get <name>')
  .description('Show details for a page')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .action((name: string, opts: { path?: string }) => {
    out(pageGet(resolveReportPath(opts.path), name));
  });

page
  .command('delete <name>')
  .description('Delete a page (and its visuals)')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .action((name: string, opts: { path?: string }) => {
    out(pageDelete(resolveReportPath(opts.path), name));
  });

page
  .command('set-background <name> <color>')
  .description('Set page background colour (hex)')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .option('--transparency <n>', '0=opaque, 100=transparent', '0')
  .action((name: string, color: string, opts: { path?: string; transparency: string }) => {
    out(
      pageSetBackground(
        resolveReportPath(opts.path),
        name,
        color,
        Number.parseInt(opts.transparency, 10),
      ),
    );
  });

page
  .command('set-visibility <name>')
  .description('Show or hide a page')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .option('--hidden', 'Hide the page', false)
  .option('--visible', 'Show the page', false)
  .action((name: string, opts: { path?: string; hidden: boolean; visible: boolean }) => {
    if (opts.hidden === opts.visible) {
      process.stderr.write('Error: specify exactly one of --hidden or --visible\n');
      process.exit(2);
    }
    out(pageSetVisibility(resolveReportPath(opts.path), name, opts.hidden));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
});
