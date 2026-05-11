import { VERSION } from 'pbi-core';
import { describe, expect, it } from 'vitest';

describe('pbi-cli smoke', () => {
  it('can import pbi-core', () => {
    expect(VERSION).toBeDefined();
  });
});
