// Post-build: copy template files (raw text/JSON assets) into dist/ so the
// runtime loaders resolve them via import.meta.url regardless of whether
// tests run against src/ or shipped code runs against dist/.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pairs = [
  ['src/visual/templates', 'dist/visual/templates'],
  ['src/report/templates', 'dist/report/templates'],
];

for (const [relSrc, relDest] of pairs) {
  const src = path.join(__dirname, '..', relSrc);
  const dest = path.join(__dirname, '..', relDest);
  if (!existsSync(src)) {
    console.error(`Templates source not found: ${src}`);
    process.exit(1);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Copied templates: ${relSrc}/ → ${relDest}/`);
}
