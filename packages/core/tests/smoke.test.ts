import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

describe('pbi-core smoke', () => {
  it('exports VERSION', () => {
    const packageJson = readPackageJson('../package.json');

    expect(VERSION).toBe(packageJson.version);
  });

  it('keeps workspace package versions in sync', () => {
    const versions = workspacePackageJsonPaths().map((packageJsonPath) => {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
      return packageJson.version;
    });

    expect(new Set(versions)).toEqual(new Set([VERSION]));
  });
});

function readPackageJson(relativePath: string): { version: string } {
  const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), relativePath);
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
}

function workspacePackageJsonPaths(): string[] {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    workspaces?: string[];
  };
  const patterns = rootPackage.workspaces ?? [];
  const packageJsonPaths = [resolve(repoRoot, 'package.json')];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      // glob form, e.g. "packages/*"
      const directory = resolve(repoRoot, pattern.slice(0, -2));
      if (!existsSync(directory)) continue;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const packageJsonPath = resolve(directory, entry.name, 'package.json');
        if (existsSync(packageJsonPath)) packageJsonPaths.push(packageJsonPath);
      }
    } else {
      // explicit directory form, e.g. "packages/core"
      const packageJsonPath = resolve(repoRoot, pattern, 'package.json');
      if (existsSync(packageJsonPath)) packageJsonPaths.push(packageJsonPath);
    }
  }
  return packageJsonPaths;
}
