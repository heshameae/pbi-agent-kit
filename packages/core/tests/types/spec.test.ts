import { describe, expect, it } from 'vitest';
import {
  type DashboardSpec,
  DashboardSpecSchema,
  FieldRefSchema,
  MeasureSpecSchema,
  QuestionSpecSchema,
  validateDashboardSpec,
} from '../../src/types/spec.js';

const validSpec: DashboardSpec = {
  status: 'ready',
  intent: 'overview of ValueMetric',
  audience: 'exec',
  dateRange: 'L12M',
  modelPath: '/x/Model.SemanticModel',
  reportPath: '/x/Report',
  pages: [],
  missingMeasures: [],
  missingDims: [],
  userDecisions: [],
};

describe('DashboardSpec', () => {
  it('accepts a valid spec', () => {
    expect(validateDashboardSpec(validSpec)).toEqual({ valid: true, errors: [] });
  });

  it('rejects a missing required field', () => {
    const { intent, ...rest } = validSpec;
    void intent;
    const res = validateDashboardSpec(rest);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.path === 'intent')).toBe(true);
  });

  it('requires clarifyingQuestions when status is needs-user-input', () => {
    const res = validateDashboardSpec({ ...validSpec, status: 'needs-user-input' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /clarifyingQuestion/.test(e.message))).toBe(true);
  });

  it('requires blockers when status is blocked', () => {
    const res = validateDashboardSpec({ ...validSpec, status: 'blocked' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /blocker/.test(e.message))).toBe(true);
  });

  it('passes needs-user-input with a clarifying question', () => {
    const res = validateDashboardSpec({
      ...validSpec,
      status: 'needs-user-input',
      clarifyingQuestions: [{ id: 'q1', prompt: 'exec or analyst?' }],
    });
    expect(res.valid).toBe(true);
  });
});

describe('FieldRefSchema', () => {
  it('rejects aggregation on a measure FieldRef', () => {
    const res = FieldRefSchema.safeParse({
      table: 'FactPrimary',
      column: 'Total Value',
      kind: 'measure',
      aggregation: 'sum',
      isHidden: false,
    });
    expect(res.success).toBe(false);
  });

  it('accepts aggregation on a column FieldRef', () => {
    const res = FieldRefSchema.safeParse({
      table: 'FactPrimary',
      column: 'ValueMetric',
      kind: 'column',
      aggregation: 'sum',
      isHidden: false,
    });
    expect(res.success).toBe(true);
  });
});

describe('MeasureSpec bridge metadata', () => {
  const base = {
    table: 'FactPrimary',
    name: 'Plan Value',
    expression: '...',
    formatString: '0',
  };

  it('accepts a measure with no bridge metadata', () => {
    expect(MeasureSpecSchema.safeParse(base).success).toBe(true);
  });

  it('rejects partial bridge metadata (only bridgeFrom)', () => {
    expect(MeasureSpecSchema.safeParse({ ...base, bridgeFrom: 'FactSecondary' }).success).toBe(
      false,
    );
  });

  it('accepts a complete bridge', () => {
    const res = MeasureSpecSchema.safeParse({
      ...base,
      bridgeFrom: 'FactSecondary',
      bridgeTo: 'FactPrimary',
      bridgeVia: 'TREATAS',
      bridgeCovers: [
        { table: 'FactSecondary', column: 'SharedAxis', kind: 'column', isHidden: false },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('rejects a bridgeCovers entry that is a measure', () => {
    const res = MeasureSpecSchema.safeParse({
      ...base,
      bridgeFrom: 'FactSecondary',
      bridgeTo: 'FactPrimary',
      bridgeVia: 'TREATAS',
      bridgeCovers: [
        { table: 'FactSecondary', column: 'Some Measure', kind: 'measure', isHidden: false },
      ],
    });
    expect(res.success).toBe(false);
  });
});

describe('QuestionSpec', () => {
  it('rejects a column-kind ref in measures', () => {
    const res = QuestionSpecSchema.safeParse({
      q: 'trend',
      visualType: 'line',
      measures: [{ table: 'FactPrimary', column: 'ValueMetric', kind: 'column', isHidden: false }],
    });
    expect(res.success).toBe(false);
  });

  it('accepts a measure-kind ref in measures and a column axis', () => {
    const res = QuestionSpecSchema.safeParse({
      q: 'trend',
      visualType: 'line',
      axis: { table: 'DimShared', column: 'SharedAxis', kind: 'column', isHidden: false },
      measures: [{ table: 'FactPrimary', column: 'Total Value', kind: 'measure', isHidden: false }],
    });
    expect(res.success).toBe(true);
  });
});

describe('DashboardSpecSchema export', () => {
  it('is a usable zod schema', () => {
    expect(DashboardSpecSchema.safeParse(validSpec).success).toBe(true);
  });
});
