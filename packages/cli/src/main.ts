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
  visualAdd,
  visualBind,
  visualCalcAdd,
  visualCalcDelete,
  visualCalcList,
  visualDelete,
  visualGet,
  visualList,
  visualSetContainer,
  visualUpdate,
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

// -- visual ----------------------------------------------------------------

const visual = program.command('visual').description('Visual CRUD');

visual
  .command('list')
  .description('List all visuals on a page')
  .requiredOption('--page <name>', 'Page name (e.g. overview)')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .action((opts: { page: string; path?: string }) => {
    out(visualList(resolveReportPath(opts.path), opts.page));
  });

visual
  .command('add')
  .description('Add a new visual to a page')
  .requiredOption('--page <name>', 'Page name')
  .requiredOption(
    '--type <type>',
    'Visual type alias or canonical name (e.g. bar, card, pivotTable)',
  )
  .option('-p, --path <path>', 'Path to the .Report folder')
  .option('-n, --name <name>', 'Explicit visual id (auto-generated if omitted)')
  .option('--x <px>', 'X position')
  .option('--y <px>', 'Y position')
  .option('--width <px>', 'Width in pixels')
  .option('--height <px>', 'Height in pixels')
  .action(
    (opts: {
      page: string;
      type: string;
      path?: string;
      name?: string;
      x?: string;
      y?: string;
      width?: string;
      height?: string;
    }) => {
      out(
        visualAdd(resolveReportPath(opts.path), opts.page, {
          visualType: opts.type,
          name: opts.name,
          x: opts.x !== undefined ? Number.parseFloat(opts.x) : undefined,
          y: opts.y !== undefined ? Number.parseFloat(opts.y) : undefined,
          width: opts.width !== undefined ? Number.parseFloat(opts.width) : undefined,
          height: opts.height !== undefined ? Number.parseFloat(opts.height) : undefined,
        }),
      );
    },
  );

visual
  .command('get <name>')
  .description('Show details for a visual')
  .requiredOption('--page <name>', 'Page name')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .action((name: string, opts: { page: string; path?: string }) => {
    out(visualGet(resolveReportPath(opts.path), opts.page, name));
  });

visual
  .command('update <name>')
  .description('Update a visual position / size / visibility')
  .requiredOption('--page <name>', 'Page name')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .option('--x <px>', 'New X position')
  .option('--y <px>', 'New Y position')
  .option('--width <px>', 'New width')
  .option('--height <px>', 'New height')
  .option('--hidden', 'Hide the visual')
  .option('--visible', 'Show the visual')
  .action(
    (
      name: string,
      opts: {
        page: string;
        path?: string;
        x?: string;
        y?: string;
        width?: string;
        height?: string;
        hidden?: boolean;
        visible?: boolean;
      },
    ) => {
      if (opts.hidden && opts.visible) {
        process.stderr.write('Error: cannot specify both --hidden and --visible\n');
        process.exit(2);
      }
      const hidden = opts.hidden ? true : opts.visible ? false : undefined;
      out(
        visualUpdate(resolveReportPath(opts.path), opts.page, name, {
          x: opts.x !== undefined ? Number.parseFloat(opts.x) : undefined,
          y: opts.y !== undefined ? Number.parseFloat(opts.y) : undefined,
          width: opts.width !== undefined ? Number.parseFloat(opts.width) : undefined,
          height: opts.height !== undefined ? Number.parseFloat(opts.height) : undefined,
          hidden,
        }),
      );
    },
  );

visual
  .command('delete <name>')
  .description('Delete a visual')
  .requiredOption('--page <name>', 'Page name')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .action((name: string, opts: { page: string; path?: string }) => {
    out(visualDelete(resolveReportPath(opts.path), opts.page, name));
  });

visual
  .command('set-container <name>')
  .description('Set visual container chrome (border, background, title)')
  .requiredOption('--page <name>', 'Page name')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .option('--title <text>', 'Visual title')
  .option('--border', 'Show border')
  .option('--no-border', 'Hide border')
  .option('--background', 'Show background')
  .option('--no-background', 'Hide background')
  .action(
    (
      name: string,
      opts: {
        page: string;
        path?: string;
        title?: string;
        border?: boolean;
        background?: boolean;
      },
    ) => {
      out(
        visualSetContainer(resolveReportPath(opts.path), opts.page, name, {
          title: opts.title,
          borderShow: opts.border,
          backgroundShow: opts.background,
        }),
      );
    },
  );

visual
  .command('bind <name>')
  .description('Bind data fields to visual roles. Repeat --role/--field pairs in matching order.')
  .requiredOption('--page <name>', 'Page name')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .option('--role <role...>', 'Role name (can repeat). Aliases like "category", "value" supported.')
  .option('--field <ref...>', 'Field reference in Table[Column] notation (can repeat).')
  .option('--measure', 'Force-treat all bindings as Measures', false)
  .action(
    (
      name: string,
      opts: {
        page: string;
        path?: string;
        role?: string[];
        field?: string[];
        measure: boolean;
      },
    ) => {
      const roles = opts.role ?? [];
      const fields = opts.field ?? [];
      if (roles.length === 0 || roles.length !== fields.length) {
        process.stderr.write(
          'Error: pass --role and --field in matching pairs (e.g. --role Y --field "Sales[Revenue]")\n',
        );
        process.exit(2);
      }
      const bindings = roles.map((role, i) => ({
        role,
        field: fields[i] as string,
        measure: opts.measure || undefined,
      }));
      out(visualBind(resolveReportPath(opts.path), opts.page, name, bindings));
    },
  );

visual
  .command('calc-add <visual> <calcName> <expression>')
  .description('Add (or replace) a visual calculation')
  .requiredOption('--page <name>', 'Page name')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .option('--role <role>', 'Role to attach the calc to', 'Y')
  .action(
    (
      visual: string,
      calcName: string,
      expression: string,
      opts: { page: string; path?: string; role: string },
    ) => {
      out(
        visualCalcAdd(
          resolveReportPath(opts.path),
          opts.page,
          visual,
          calcName,
          expression,
          opts.role,
        ),
      );
    },
  );

visual
  .command('calc-list <visual>')
  .description('List all visual calculations')
  .requiredOption('--page <name>', 'Page name')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .action((visual: string, opts: { page: string; path?: string }) => {
    out(visualCalcList(resolveReportPath(opts.path), opts.page, visual));
  });

visual
  .command('calc-delete <visual> <calcName>')
  .description('Delete a visual calculation by name')
  .requiredOption('--page <name>', 'Page name')
  .option('-p, --path <path>', 'Path to the .Report folder')
  .action((visual: string, calcName: string, opts: { page: string; path?: string }) => {
    out(visualCalcDelete(resolveReportPath(opts.path), opts.page, visual, calcName));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
});
