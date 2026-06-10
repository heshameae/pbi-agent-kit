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

  it('accepts a ready spec when missingMeasures is omitted', () => {
    const { missingMeasures, ...specWithoutMissingMeasures } = validSpec;
    void missingMeasures;

    expect(validateDashboardSpec(specWithoutMissingMeasures)).toEqual({
      valid: true,
      errors: [],
    });
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

  it('rejects draft measure intents in a ready spec', () => {
    const res = validateDashboardSpec({
      ...validSpec,
      measureIntents: [measureIntent({ status: 'draft' })],
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /draft measure intent/i.test(e.message))).toBe(true);
  });

  it('accepts draft measure intents for needs-user-input only when clarifying questions exist', () => {
    const withoutQuestion = validateDashboardSpec({
      ...validSpec,
      status: 'needs-user-input',
      measureIntents: [measureIntent({ status: 'draft' })],
    });
    expect(withoutQuestion.valid).toBe(false);
    expect(withoutQuestion.errors.some((e) => /clarifyingQuestion/.test(e.message))).toBe(true);

    const withQuestion = validateDashboardSpec({
      ...validSpec,
      status: 'needs-user-input',
      clarifyingQuestions: [{ id: 'q1', prompt: 'confirm definition?' }],
      measureIntents: [measureIntent({ status: 'draft' })],
    });
    expect(withQuestion.valid).toBe(true);
  });

  it('accepts confirmed measure intents in a ready spec', () => {
    const res = validateDashboardSpec({
      ...validSpec,
      measureIntents: [measureIntent({ status: 'confirmed' })],
    });

    expect(res.valid).toBe(true);
  });

  it('requires every ready missing measure to have a confirmed matching measure intent by name', () => {
    const missingMeasures = [measureSpec({ name: 'Planned Metric' })];

    const withoutMatchingIntent = validateDashboardSpec({
      ...validSpec,
      missingMeasures,
      measureIntents: [measureIntent({ measureName: 'Different Metric', status: 'confirmed' })],
    });
    expect(withoutMatchingIntent.valid).toBe(false);
    expect(
      withoutMatchingIntent.errors.some((e) =>
        /confirmed measure intent.*Planned Metric/i.test(e.message),
      ),
    ).toBe(true);

    const withMatchingIntent = validateDashboardSpec({
      ...validSpec,
      missingMeasures,
      measureIntents: [measureIntent({ measureName: 'Planned Metric', status: 'confirmed' })],
    });
    expect(withMatchingIntent.valid).toBe(true);
  });

  it('rejects ready measure intents that reference draft business terms', () => {
    const res = validateDashboardSpec({
      ...validSpec,
      businessTerms: [
        {
          name: 'Shared Term',
          status: 'draft',
          definition: 'A business definition awaiting confirmation.',
        },
      ],
      measureIntents: [
        measureIntent({
          status: 'confirmed',
          businessTermRefs: ['Shared Term'],
        }),
      ],
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /draft business term.*Shared Term/i.test(e.message))).toBe(true);
  });

  it('rejects ready measure intents with empty confirmed evidence', () => {
    const res = validateDashboardSpec({
      ...validSpec,
      measureIntents: [
        measureIntent({
          owner: '',
          definition: '',
          sourceRefs: [],
          grain: '',
          additivity: '',
          format: '',
          unit: '',
        }),
      ],
    });

    expect(res.valid).toBe(false);
    expect(res.errors.map((error) => error.path)).toEqual(
      expect.arrayContaining([
        'measureIntents.0.owner',
        'measureIntents.0.definition',
        'measureIntents.0.sourceRefs',
        'measureIntents.0.grain',
        'measureIntents.0.additivity',
        'measureIntents.0.format',
        'measureIntents.0.unit',
      ]),
    );
  });

  it('rejects ready measure intents that reference unknown or deprecated business terms', () => {
    const res = validateDashboardSpec({
      ...validSpec,
      businessTerms: [
        {
          name: 'Deprecated Term',
          status: 'deprecated',
          definition: 'Old definition.',
        },
      ],
      measureIntents: [
        measureIntent({
          status: 'confirmed',
          businessTermRefs: ['Missing Term', 'Deprecated Term'],
        }),
      ],
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /unknown business term.*Missing Term/i.test(e.message))).toBe(
      true,
    );
    expect(
      res.errors.some((e) => /deprecated business term.*Deprecated Term/i.test(e.message)),
    ).toBe(true);
  });

  it('requires confirmed time-intelligence evidence for ready time-intelligence measures', () => {
    const withoutTimeEvidence = validateDashboardSpec({
      ...validSpec,
      missingMeasures: [
        measureSpec({
          name: 'Planned Metric YTD',
          expression: "TOTALYTD([Planned Metric], 'Date'[Date])",
        }),
      ],
      measureIntents: [
        measureIntent({
          measureName: 'Planned Metric YTD',
          status: 'confirmed',
        }),
      ],
    });
    expect(withoutTimeEvidence.valid).toBe(false);
    expect(
      withoutTimeEvidence.errors.some((e) => /time-intelligence evidence/i.test(e.message)),
    ).toBe(true);

    const withTimeEvidence = validateDashboardSpec({
      ...validSpec,
      missingMeasures: [
        measureSpec({
          name: 'Planned Metric YTD',
          expression: "TOTALYTD([Planned Metric], 'Date'[Date])",
        }),
      ],
      measureIntents: [
        measureIntent({
          measureName: 'Planned Metric YTD',
          status: 'confirmed',
          timeIntelligence: timeIntelligenceEvidence(),
        }),
      ],
    });
    expect(withTimeEvidence.valid).toBe(true);
  });
});

const measureSpec = (overrides: Partial<{ expression: string; name: string }> = {}) => ({
  table: 'Measures',
  name: overrides.name ?? 'Planned Metric',
  expression: overrides.expression ?? '1',
  formatString: '0',
});

const measureIntent = (
  overrides: Partial<{
    measureName: string;
    status: 'draft' | 'confirmed';
    businessTermRefs: string[];
    owner: string;
    definition: string;
    sourceRefs: [];
    grain: string;
    additivity: string;
    format: string;
    unit: string;
    timeIntelligence: {
      dateRefs: Array<{
        table: string;
        column: string;
        kind: 'column';
        isHidden: boolean;
      }>;
      dateTable: string;
      dateColumn: string;
      grain: string;
      calendarPolicy: string;
      incompletePeriodBehavior: string;
    };
  }> = {},
) => ({
  measureName: overrides.measureName ?? 'Planned Metric',
  status: overrides.status ?? 'confirmed',
  owner: overrides.owner ?? 'data-analyst',
  definition: overrides.definition ?? 'Confirmed metric definition.',
  sourceRefs: overrides.sourceRefs ?? [
    { table: 'FactPrimary', column: 'ValueMetric', kind: 'column', isHidden: false },
  ],
  grain: overrides.grain ?? 'One row per declared analytical grain.',
  additivity: overrides.additivity ?? 'additive',
  filters: [],
  format: overrides.format ?? '0',
  unit: overrides.unit ?? 'units',
  caveats: [],
  businessTermRefs: overrides.businessTermRefs,
  timeIntelligence: overrides.timeIntelligence,
});

const timeIntelligenceEvidence = () => ({
  dateRefs: [{ table: 'Date', column: 'Date', kind: 'column' as const, isHidden: false }],
  dateTable: 'Date',
  dateColumn: 'Date',
  grain: 'day',
  calendarPolicy: 'calendar year',
  incompletePeriodBehavior: 'exclude incomplete periods',
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
