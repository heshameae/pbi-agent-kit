import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_VISUAL_TYPES,
  type VisualType,
  fillTemplate,
  loadTemplateRaw,
} from '../../src/index.js';

describe('templates: all 32 are present and loadable', () => {
  it.each(SUPPORTED_VISUAL_TYPES)('%s template loads as text', (type: VisualType) => {
    const raw = loadTemplateRaw(type);
    expect(raw.length).toBeGreaterThan(0);
    expect(raw).toContain('__VISUAL_NAME__');
  });
});

describe('templates: fillTemplate produces valid JSON for every visual type', () => {
  it.each(SUPPORTED_VISUAL_TYPES)('%s fills cleanly', (type: VisualType) => {
    const filled = fillTemplate(type, {
      visualName: 'abcdef0123456789abcd',
      x: 100,
      y: 200,
      width: 400,
      height: 300,
    }) as Record<string, unknown>;

    expect(filled).toHaveProperty('$schema');
    expect(filled).toHaveProperty('name', 'abcdef0123456789abcd');
    expect(filled).toHaveProperty('position');
    expect(filled).toHaveProperty('visual');
  });
});

describe('templates: barChart specifics', () => {
  it('floors position to integers', () => {
    const filled = fillTemplate('barChart', {
      visualName: 'v',
      x: 100.7,
      y: 200.3,
      width: 400.9,
      height: 300.1,
    }) as { position: Record<string, number> };

    expect(filled.position.x).toBe(100);
    expect(filled.position.y).toBe(200);
    expect(filled.position.width).toBe(400);
    expect(filled.position.height).toBe(300);
    expect(filled.position.z).toBe(0);
    expect(filled.position.tabOrder).toBe(0);
  });

  it('defaults z and tabOrder to 0', () => {
    const filled = fillTemplate('barChart', {
      visualName: 'v',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }) as { position: Record<string, number> };
    expect(filled.position.z).toBe(0);
    expect(filled.position.tabOrder).toBe(0);
  });

  it('respects explicit z and tabOrder', () => {
    const filled = fillTemplate('barChart', {
      visualName: 'v',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      z: 5,
      tabOrder: 7,
    }) as { position: Record<string, number> };
    expect(filled.position.z).toBe(5);
    expect(filled.position.tabOrder).toBe(7);
  });

  it('embeds the visualContainer 2.7.0 schema URL', () => {
    const filled = fillTemplate('barChart', {
      visualName: 'v',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }) as { $schema: string };
    expect(filled.$schema).toMatch(/visualContainer\/2\.7\.0\/schema\.json$/);
  });

  it('renders visualType correctly inside visual block', () => {
    const filled = fillTemplate('barChart', {
      visualName: 'v',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }) as { visual: { visualType: string } };
    expect(filled.visual.visualType).toBe('barChart');
  });
});
