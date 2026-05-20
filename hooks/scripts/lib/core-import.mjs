//
// Dynamic loader for the built pbi-core engine.
// Why: hooks are plain .mjs and can't `import` TypeScript source, so
// they pull pbi-core in at runtime from packages/core/dist/index.js.
// Requires `pnpm -F pbi-core build` to have run at least once.
//
export async function importCore() {
  return import(new URL('../../../packages/core/dist/index.js', import.meta.url));
}
