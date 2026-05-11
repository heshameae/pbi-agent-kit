// Post-build: copy src/visual/templates/*.json → dist/visual/templates/.
// Templates contain placeholders that aren't valid JSON, so we ship them as
// raw text alongside the compiled output and load them via fs at runtime.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '..', 'src', 'visual', 'templates');
const dest = path.join(__dirname, '..', 'dist', 'visual', 'templates');

if (!existsSync(src)) {
  console.error(`Templates source not found: ${src}`);
  process.exit(1);
}

mkdirSync(path.dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('Copied templates: src/visual/templates/ → dist/visual/templates/');
