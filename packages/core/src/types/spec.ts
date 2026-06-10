// Agent-boundary contracts for the model side (v6).
//
// DashboardSpec is what pbi-data-analyst produces and pbi-model-builder
// consumes. Validated via pbi_spec_validate (the builder's required gate).
//
// Top-level shape follows the v6 design doc (2026-05-18) lines 218–263.
// The sub-types (PageSpec, QuestionSpec, ClarifyingQuestion, UserDecision,
// Blocker) were marked "unchanged from v5" in that doc, but v5 was not
// preserved on disk — these are hand-defined from the v6 build-pipeline trace
// and PENDING USER REVIEW before the agents rely on them.

import { z } from 'zod';

const NonEmptyString = z.string().trim().min(1);

export const FieldRefSchema = z
  .object({
    table: NonEmptyString,
    column: NonEmptyString,
    kind: z.enum(['measure', 'column']),
    aggregation: z.enum(['sum', 'avg', 'count', 'min', 'max']).optional(),
    isHidden: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'measure' && v.aggregation !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'aggregation is invalid on a measure FieldRef (measure-vs-column confusion)',
      });
    }
  });

const MeasureFieldRef = FieldRefSchema.refine((fr) => fr.kind === 'measure', {
  message: "page-question measures must be measure FieldRefs (kind:'measure')",
});

const ColumnFieldRef = FieldRefSchema.refine((fr) => fr.kind === 'column', {
  message: "time-intelligence dateRefs must be column FieldRefs (kind:'column')",
});

export const MeasureSpecSchema = z
  .object({
    table: z.string(),
    name: z.string(),
    expression: z.string(),
    formatString: z.string(),
    description: z.string().optional(),
    // Bridge metadata — written as TMDL annotations on the measure.
    bridgeFrom: z.string().optional(),
    bridgeTo: z.string().optional(),
    bridgeVia: z.enum(['TREATAS', 'USERELATIONSHIP']).optional(),
    bridgeCovers: z.array(FieldRefSchema).optional(),
  })
  .superRefine((v, ctx) => {
    const anySet = [v.bridgeFrom, v.bridgeTo, v.bridgeVia, v.bridgeCovers].some(
      (f) => f !== undefined,
    );
    const allSet =
      v.bridgeFrom !== undefined &&
      v.bridgeTo !== undefined &&
      v.bridgeVia !== undefined &&
      v.bridgeCovers !== undefined &&
      v.bridgeCovers.length > 0;
    if (anySet && !allSet) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'bridge metadata is all-or-none: bridgeFrom, bridgeTo, bridgeVia, and a non-empty bridgeCovers must all be present',
      });
    }
    if (v.bridgeCovers?.some((fr) => fr.kind !== 'column')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bridgeCovers entries must be columns (kind:'column'), not measures",
      });
    }
  });

export const DimSpecSchema = z.object({
  name: z.string(),
  keyColumn: z.string(),
  sourceColumns: z.array(FieldRefSchema),
  attributeColumns: z.array(FieldRefSchema).optional(),
});

export const BusinessTermSchema = z.object({
  name: NonEmptyString,
  status: z.enum(['draft', 'confirmed', 'deprecated']),
  definition: NonEmptyString,
  aliases: z.array(NonEmptyString).optional(),
  owner: NonEmptyString.optional(),
  sourceRefs: z.array(FieldRefSchema).optional(),
  caveats: z.array(NonEmptyString).optional(),
});

export const MeasureTimeIntelligenceSchema = z.object({
  dateRefs: z.array(ColumnFieldRef).optional(),
  dateTable: NonEmptyString.optional(),
  dateColumn: NonEmptyString.optional(),
  period: NonEmptyString.optional(),
  comparison: NonEmptyString.optional(),
  grain: NonEmptyString.optional(),
  calendarPolicy: NonEmptyString.optional(),
  incompletePeriodBehavior: NonEmptyString.optional(),
});

export const MeasureIntentSchema = z.object({
  measureName: NonEmptyString,
  status: z.enum(['draft', 'confirmed']),
  owner: NonEmptyString,
  definition: NonEmptyString,
  sourceRefs: z.array(FieldRefSchema).nonempty(),
  grain: NonEmptyString,
  additivity: NonEmptyString,
  filters: z.array(NonEmptyString),
  format: NonEmptyString,
  unit: NonEmptyString,
  caveats: z.array(NonEmptyString),
  businessTermRefs: z.array(NonEmptyString).optional(),
  timeIntelligence: MeasureTimeIntelligenceSchema.optional(),
});

const TIME_INTELLIGENCE_FUNCTIONS = [
  'TOTALYTD',
  'TOTALQTD',
  'TOTALMTD',
  'DATESYTD',
  'DATESQTD',
  'DATESMTD',
  'DATESINPERIOD',
  'DATESBETWEEN',
  'DATEADD',
  'SAMEPERIODLASTYEAR',
  'PARALLELPERIOD',
  'FIRSTDATE',
  'LASTDATE',
  'STARTOFYEAR',
  'STARTOFQUARTER',
  'STARTOFMONTH',
  'ENDOFYEAR',
  'ENDOFQUARTER',
  'ENDOFMONTH',
  'PREVIOUSYEAR',
  'PREVIOUSQUARTER',
  'PREVIOUSMONTH',
  'PREVIOUSDAY',
  'NEXTYEAR',
  'NEXTQUARTER',
  'NEXTMONTH',
  'NEXTDAY',
  'OPENINGBALANCEYEAR',
  'OPENINGBALANCEQUARTER',
  'OPENINGBALANCEMONTH',
  'CLOSINGBALANCEYEAR',
  'CLOSINGBALANCEQUARTER',
  'CLOSINGBALANCEMONTH',
] as const;

const TIME_INTELLIGENCE_PATTERN = new RegExp(
  `\\b(?:${TIME_INTELLIGENCE_FUNCTIONS.join('|')})\\s*\\(`,
  'i',
);

export function expressionUsesTimeIntelligence(expression: string): boolean {
  return TIME_INTELLIGENCE_PATTERN.test(expression);
}

// --- sub-types (hand-defined from v6 build trace; pending review) ----------

export const QuestionSpecSchema = z.object({
  q: z.string(),
  visualType: z.string(),
  axis: FieldRefSchema.optional(),
  measures: z.array(MeasureFieldRef).optional(),
});

export const PageSpecSchema = z.object({
  pageName: z.string(),
  layoutShape: z.enum(['overview', 'drill', 'kpi-grid']),
  questions: z.array(QuestionSpecSchema),
});

export const ClarifyingQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
});

export const UserDecisionSchema = z.object({
  questionId: z.string(),
  answer: z.string(),
});

export const BlockerSchema = z.object({
  kind: z.enum([
    'missing-field',
    'missing-relationship',
    'grain-mismatch',
    'ambiguous-dim',
    'other',
  ]),
  message: z.string(),
  refs: z.array(FieldRefSchema).optional(),
});

export const DashboardSpecSchema = z
  .object({
    status: z.enum(['ready', 'needs-user-input', 'blocked']),
    intent: z.string(),
    audience: z.enum(['exec', 'analyst', 'ops', 'unspecified']),
    dateRange: z.string(),
    modelPath: z.string(),
    reportPath: z.string(),
    pages: z.array(PageSpecSchema),
    missingMeasures: z.array(MeasureSpecSchema).default([]),
    missingDims: z.array(DimSpecSchema),
    businessTerms: z.array(BusinessTermSchema).optional(),
    measureIntents: z.array(MeasureIntentSchema).optional(),
    userDecisions: z.array(UserDecisionSchema),
    clarifyingQuestions: z.array(ClarifyingQuestionSchema).optional(),
    blockers: z.array(BlockerSchema).optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.status === 'needs-user-input' &&
      !(v.clarifyingQuestions && v.clarifyingQuestions.length > 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status 'needs-user-input' requires at least one clarifyingQuestion",
      });
    }
    if (v.status === 'blocked' && !(v.blockers && v.blockers.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status 'blocked' requires at least one blocker",
      });
    }
    if (v.status !== 'ready') return;

    v.measureIntents?.forEach((intent, index) => {
      if (intent.status === 'draft') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measureIntents', index, 'status'],
          message: `status 'ready' rejects draft measure intent '${intent.measureName}'`,
        });
      }
    });

    const businessTermsByName = new Map(v.businessTerms?.map((term) => [term.name, term]) ?? []);
    v.measureIntents?.forEach((intent, intentIndex) => {
      intent.businessTermRefs?.forEach((termRef, termIndex) => {
        const term = businessTermsByName.get(termRef);
        if (!term) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['measureIntents', intentIndex, 'businessTermRefs', termIndex],
            message: `status 'ready' rejects unknown business term '${termRef}' referenced by measure intent '${intent.measureName}'`,
          });
        } else if (term.status === 'draft') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['measureIntents', intentIndex, 'businessTermRefs', termIndex],
            message: `status 'ready' rejects draft business term '${termRef}' referenced by measure intent '${intent.measureName}'`,
          });
        } else if (term.status === 'deprecated') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['measureIntents', intentIndex, 'businessTermRefs', termIndex],
            message: `status 'ready' rejects deprecated business term '${termRef}' referenced by measure intent '${intent.measureName}'`,
          });
        }
      });
    });

    const confirmedMeasureIntents = new Map(
      v.measureIntents
        ?.filter((intent) => intent.status === 'confirmed')
        .map((intent) => [intent.measureName, intent]) ?? [],
    );
    v.missingMeasures.forEach((measure, index) => {
      const intent = confirmedMeasureIntents.get(measure.name);
      if (!intent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['missingMeasures', index, 'name'],
          message: `status 'ready' requires a confirmed measure intent matching missing measure '${measure.name}'`,
        });
      } else if (
        expressionUsesTimeIntelligence(measure.expression) &&
        !hasConfirmedTimeIntelligenceEvidence(intent)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measureIntents', v.measureIntents?.indexOf(intent) ?? 0, 'timeIntelligence'],
          message: `status 'ready' requires confirmed time-intelligence evidence for measure '${measure.name}'`,
        });
      }
    });
  });

function hasConfirmedTimeIntelligenceEvidence(
  intent: z.infer<typeof MeasureIntentSchema>,
): boolean {
  const time = intent.timeIntelligence;
  return (
    time !== undefined &&
    (time.dateRefs?.length ?? 0) > 0 &&
    time.dateTable !== undefined &&
    time.dateColumn !== undefined &&
    time.grain !== undefined &&
    time.calendarPolicy !== undefined &&
    time.incompletePeriodBehavior !== undefined
  );
}

export type FieldRef = z.infer<typeof FieldRefSchema>;
export type MeasureSpec = z.infer<typeof MeasureSpecSchema>;
export type DimSpec = z.infer<typeof DimSpecSchema>;
export type BusinessTerm = z.infer<typeof BusinessTermSchema>;
export type MeasureTimeIntelligence = z.infer<typeof MeasureTimeIntelligenceSchema>;
export type MeasureIntent = z.infer<typeof MeasureIntentSchema>;
export type QuestionSpec = z.infer<typeof QuestionSpecSchema>;
export type PageSpec = z.infer<typeof PageSpecSchema>;
export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestionSchema>;
export type UserDecision = z.infer<typeof UserDecisionSchema>;
export type Blocker = z.infer<typeof BlockerSchema>;
export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

export interface SpecValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<{ readonly path: string; readonly message: string }>;
}

export function validateDashboardSpec(spec: unknown): SpecValidationResult {
  const result = DashboardSpecSchema.safeParse(spec);
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  };
}
