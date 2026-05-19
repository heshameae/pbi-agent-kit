import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateId, readJson, writeJson } from '../../src/index.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'pbi-io-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('io: readJson / writeJson round-trip', () => {
  it('round-trips a simple object', () => {
    const file = path.join(tmp, 'a.json');
    const data = { hello: 'world', n: 42, arr: [1, 2, 3] };
    writeJson(file, data);
    expect(readJson(file)).toEqual(data);
  });

  it('preserves UTF-8 (non-ASCII characters not escaped)', () => {
    const file = path.join(tmp, 'utf8.json');
    writeJson(file, { name: 'Café — Résumé', arrow: '→' });
    const raw = readFileSync(file, 'utf-8');
    expect(raw).toContain('Café — Résumé');
    expect(raw).toContain('→');
    expect(raw).not.toContain('\\u');
  });

  it('matches pbi-cli formatting (2-space indent, trailing newline)', () => {
    const file = path.join(tmp, 'fmt.json');
    writeJson(file, { a: 1, b: { c: 2 } });
    const raw = readFileSync(file, 'utf-8');
    expect(raw).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}\n');
  });

  it('preserves object key insertion order on round-trip', () => {
    const file = path.join(tmp, 'order.json');
    const obj = { z: 1, a: 2, m: 3 };
    writeJson(file, obj);
    const raw = readFileSync(file, 'utf-8');
    expect(raw.indexOf('"z"')).toBeLessThan(raw.indexOf('"a"'));
    expect(raw.indexOf('"a"')).toBeLessThan(raw.indexOf('"m"'));
  });

  it('creates parent directories on write', () => {
    const file = path.join(tmp, 'nested', 'dirs', 'a.json');
    writeJson(file, { ok: true });
    expect(readJson(file)).toEqual({ ok: true });
  });

  it('does not write a BOM', () => {
    const file = path.join(tmp, 'bom.json');
    writeJson(file, { a: 1 });
    const buf = readFileSync(file);
    expect(buf[0]).not.toBe(0xef);
  });
});

describe('io: generateId', () => {
  it('returns 20 lowercase hex characters', () => {
    const id = generateId();
    expect(id).toHaveLength(20);
    expect(id).toMatch(/^[0-9a-f]{20}$/);
  });

  it('produces unique values across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(generateId());
    expect(ids.size).toBe(1000);
  });

  it('matches the Python secrets.token_hex(10) format', () => {
    // 10 bytes → 20 hex chars, lowercase only
    for (let i = 0; i < 50; i++) {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{20}$/);
      expect(id.toLowerCase()).toBe(id);
    }
  });
});
