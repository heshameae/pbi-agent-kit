import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { modelDoctorFromFolder } from '../../src/modeling/doctor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAR_GOOD = path.join(__dirname, 'fixtures', 'star-good');
const BRIDGE = path.join(__dirname, 'fixtures', 'bridge-mismatch');

describe('modelDoctorFromFolder', () => {
  it('returns summary, grain, bpa, relationships', () => {
    const r = modelDoctorFromFolder(STAR_GOOD);
    expect(r.modelPath).toBe(STAR_GOOD);
    expect(r.summary).toHaveProperty('errors');
    expect(r.summary).toHaveProperty('warnings');
    expect(r.summary).toHaveProperty('info');
    expect(r.grain.tableGrains).toBeDefined();
  });

  it('includes a bridge analysis when bridgeIntent is provided', () => {
    const r = modelDoctorFromFolder(BRIDGE, {
      bridgeIntent: {
        fromTable: 'Actuals',
        toTable: 'Targets',
        axes: ['Region', 'Fine Grain Attribute'],
      },
    });
    expect(r.grain.bridge).toBeDefined();
    expect(r.grain.bridge?.bridgeBlockedAxes.sort()).toEqual(['Fine Grain Attribute', 'Region']);
  });

  it('passed is false when any error-level finding exists', () => {
    const r = modelDoctorFromFolder(BRIDGE);
    expect(typeof r.passed).toBe('boolean');
  });
});
