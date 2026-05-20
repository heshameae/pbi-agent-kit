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

export const FieldRefSchema = z
  .object({
    table: z.string(),
    column: z.string(),
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
    missingMeasures: z.array(MeasureSpecSchema),
    missingDims: z.array(DimSpecSchema),
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
  });

export type FieldRef = z.infer<typeof FieldRefSchema>;
export type MeasureSpec = z.infer<typeof MeasureSpecSchema>;
export type DimSpec = z.infer<typeof DimSpecSchema>;
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
