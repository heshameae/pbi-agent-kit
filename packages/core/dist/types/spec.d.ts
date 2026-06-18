import { z } from 'zod';
export declare const FieldRefSchema: z.ZodEffects<z.ZodObject<{
    table: z.ZodString;
    column: z.ZodString;
    kind: z.ZodEnum<["measure", "column"]>;
    aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
    isHidden: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    kind: "column" | "measure";
    isHidden: boolean;
    table: string;
    column: string;
    aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
}, {
    kind: "column" | "measure";
    isHidden: boolean;
    table: string;
    column: string;
    aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
}>, {
    kind: "column" | "measure";
    isHidden: boolean;
    table: string;
    column: string;
    aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
}, {
    kind: "column" | "measure";
    isHidden: boolean;
    table: string;
    column: string;
    aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
}>;
export declare const MeasureSpecSchema: z.ZodEffects<z.ZodObject<{
    table: z.ZodString;
    name: z.ZodString;
    expression: z.ZodString;
    formatString: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    bridgeFrom: z.ZodOptional<z.ZodString>;
    bridgeTo: z.ZodOptional<z.ZodString>;
    bridgeVia: z.ZodOptional<z.ZodEnum<["TREATAS", "USERELATIONSHIP"]>>;
    bridgeCovers: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
        table: z.ZodString;
        column: z.ZodString;
        kind: z.ZodEnum<["measure", "column"]>;
        aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
        isHidden: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    expression: string;
    table: string;
    formatString: string;
    description?: string | undefined;
    bridgeFrom?: string | undefined;
    bridgeTo?: string | undefined;
    bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
    bridgeCovers?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
}, {
    name: string;
    expression: string;
    table: string;
    formatString: string;
    description?: string | undefined;
    bridgeFrom?: string | undefined;
    bridgeTo?: string | undefined;
    bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
    bridgeCovers?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
}>, {
    name: string;
    expression: string;
    table: string;
    formatString: string;
    description?: string | undefined;
    bridgeFrom?: string | undefined;
    bridgeTo?: string | undefined;
    bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
    bridgeCovers?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
}, {
    name: string;
    expression: string;
    table: string;
    formatString: string;
    description?: string | undefined;
    bridgeFrom?: string | undefined;
    bridgeTo?: string | undefined;
    bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
    bridgeCovers?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
}>;
export declare const DimSpecSchema: z.ZodObject<{
    name: z.ZodString;
    keyColumn: z.ZodString;
    sourceColumns: z.ZodArray<z.ZodEffects<z.ZodObject<{
        table: z.ZodString;
        column: z.ZodString;
        kind: z.ZodEnum<["measure", "column"]>;
        aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
        isHidden: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, "many">;
    attributeColumns: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
        table: z.ZodString;
        column: z.ZodString;
        kind: z.ZodEnum<["measure", "column"]>;
        aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
        isHidden: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    keyColumn: string;
    sourceColumns: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[];
    attributeColumns?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
}, {
    name: string;
    keyColumn: string;
    sourceColumns: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[];
    attributeColumns?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
}>;
export declare const BusinessTermSchema: z.ZodObject<{
    name: z.ZodString;
    status: z.ZodEnum<["draft", "confirmed", "deprecated"]>;
    definition: z.ZodString;
    aliases: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    owner: z.ZodOptional<z.ZodString>;
    sourceRefs: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
        table: z.ZodString;
        column: z.ZodString;
        kind: z.ZodEnum<["measure", "column"]>;
        aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
        isHidden: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, "many">>;
    caveats: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    definition: string;
    status: "draft" | "confirmed" | "deprecated";
    aliases?: string[] | undefined;
    owner?: string | undefined;
    sourceRefs?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
    caveats?: string[] | undefined;
}, {
    name: string;
    definition: string;
    status: "draft" | "confirmed" | "deprecated";
    aliases?: string[] | undefined;
    owner?: string | undefined;
    sourceRefs?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
    caveats?: string[] | undefined;
}>;
export declare const MeasureTimeIntelligenceSchema: z.ZodObject<{
    dateRefs: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
        table: z.ZodString;
        column: z.ZodString;
        kind: z.ZodEnum<["measure", "column"]>;
        aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
        isHidden: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, "many">>;
    dateTable: z.ZodOptional<z.ZodString>;
    dateColumn: z.ZodOptional<z.ZodString>;
    period: z.ZodOptional<z.ZodString>;
    comparison: z.ZodOptional<z.ZodString>;
    grain: z.ZodOptional<z.ZodString>;
    calendarPolicy: z.ZodOptional<z.ZodString>;
    incompletePeriodBehavior: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    dateTable?: string | undefined;
    dateColumn?: string | undefined;
    period?: string | undefined;
    dateRefs?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
    comparison?: string | undefined;
    grain?: string | undefined;
    calendarPolicy?: string | undefined;
    incompletePeriodBehavior?: string | undefined;
}, {
    dateTable?: string | undefined;
    dateColumn?: string | undefined;
    period?: string | undefined;
    dateRefs?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
    comparison?: string | undefined;
    grain?: string | undefined;
    calendarPolicy?: string | undefined;
    incompletePeriodBehavior?: string | undefined;
}>;
export declare const MeasureIntentSchema: z.ZodObject<{
    measureName: z.ZodString;
    status: z.ZodEnum<["draft", "confirmed"]>;
    owner: z.ZodString;
    definition: z.ZodString;
    sourceRefs: z.ZodArray<z.ZodEffects<z.ZodObject<{
        table: z.ZodString;
        column: z.ZodString;
        kind: z.ZodEnum<["measure", "column"]>;
        aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
        isHidden: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, "atleastone">;
    grain: z.ZodString;
    additivity: z.ZodString;
    filters: z.ZodArray<z.ZodString, "many">;
    format: z.ZodString;
    unit: z.ZodString;
    caveats: z.ZodArray<z.ZodString, "many">;
    businessTermRefs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    timeIntelligence: z.ZodOptional<z.ZodObject<{
        dateRefs: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
            table: z.ZodString;
            column: z.ZodString;
            kind: z.ZodEnum<["measure", "column"]>;
            aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
            isHidden: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, "many">>;
        dateTable: z.ZodOptional<z.ZodString>;
        dateColumn: z.ZodOptional<z.ZodString>;
        period: z.ZodOptional<z.ZodString>;
        comparison: z.ZodOptional<z.ZodString>;
        grain: z.ZodOptional<z.ZodString>;
        calendarPolicy: z.ZodOptional<z.ZodString>;
        incompletePeriodBehavior: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        dateTable?: string | undefined;
        dateColumn?: string | undefined;
        period?: string | undefined;
        dateRefs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        comparison?: string | undefined;
        grain?: string | undefined;
        calendarPolicy?: string | undefined;
        incompletePeriodBehavior?: string | undefined;
    }, {
        dateTable?: string | undefined;
        dateColumn?: string | undefined;
        period?: string | undefined;
        dateRefs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        comparison?: string | undefined;
        grain?: string | undefined;
        calendarPolicy?: string | undefined;
        incompletePeriodBehavior?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    definition: string;
    status: "draft" | "confirmed";
    owner: string;
    sourceRefs: [{
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, ...{
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[]];
    caveats: string[];
    grain: string;
    measureName: string;
    additivity: string;
    filters: string[];
    format: string;
    unit: string;
    businessTermRefs?: string[] | undefined;
    timeIntelligence?: {
        dateTable?: string | undefined;
        dateColumn?: string | undefined;
        period?: string | undefined;
        dateRefs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        comparison?: string | undefined;
        grain?: string | undefined;
        calendarPolicy?: string | undefined;
        incompletePeriodBehavior?: string | undefined;
    } | undefined;
}, {
    definition: string;
    status: "draft" | "confirmed";
    owner: string;
    sourceRefs: [{
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, ...{
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[]];
    caveats: string[];
    grain: string;
    measureName: string;
    additivity: string;
    filters: string[];
    format: string;
    unit: string;
    businessTermRefs?: string[] | undefined;
    timeIntelligence?: {
        dateTable?: string | undefined;
        dateColumn?: string | undefined;
        period?: string | undefined;
        dateRefs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        comparison?: string | undefined;
        grain?: string | undefined;
        calendarPolicy?: string | undefined;
        incompletePeriodBehavior?: string | undefined;
    } | undefined;
}>;
export declare function expressionUsesTimeIntelligence(expression: string): boolean;
export declare const QuestionSpecSchema: z.ZodObject<{
    q: z.ZodString;
    visualType: z.ZodString;
    axis: z.ZodOptional<z.ZodEffects<z.ZodObject<{
        table: z.ZodString;
        column: z.ZodString;
        kind: z.ZodEnum<["measure", "column"]>;
        aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
        isHidden: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>>;
    measures: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
        table: z.ZodString;
        column: z.ZodString;
        kind: z.ZodEnum<["measure", "column"]>;
        aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
        isHidden: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    q: string;
    visualType: string;
    measures?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
    axis?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    } | undefined;
}, {
    q: string;
    visualType: string;
    measures?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
    axis?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    } | undefined;
}>;
export declare const PageSpecSchema: z.ZodObject<{
    pageName: z.ZodString;
    layoutShape: z.ZodEnum<["overview", "drill", "kpi-grid"]>;
    questions: z.ZodArray<z.ZodObject<{
        q: z.ZodString;
        visualType: z.ZodString;
        axis: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            table: z.ZodString;
            column: z.ZodString;
            kind: z.ZodEnum<["measure", "column"]>;
            aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
            isHidden: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>>;
        measures: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
            table: z.ZodString;
            column: z.ZodString;
            kind: z.ZodEnum<["measure", "column"]>;
            aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
            isHidden: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        q: string;
        visualType: string;
        measures?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        axis?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        } | undefined;
    }, {
        q: string;
        visualType: string;
        measures?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        axis?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        } | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    pageName: string;
    layoutShape: "overview" | "drill" | "kpi-grid";
    questions: {
        q: string;
        visualType: string;
        measures?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        axis?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        } | undefined;
    }[];
}, {
    pageName: string;
    layoutShape: "overview" | "drill" | "kpi-grid";
    questions: {
        q: string;
        visualType: string;
        measures?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        axis?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        } | undefined;
    }[];
}>;
export declare const ClarifyingQuestionSchema: z.ZodObject<{
    id: z.ZodString;
    prompt: z.ZodString;
    options: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    id: string;
    prompt: string;
    options?: string[] | undefined;
}, {
    id: string;
    prompt: string;
    options?: string[] | undefined;
}>;
export declare const UserDecisionSchema: z.ZodObject<{
    questionId: z.ZodString;
    answer: z.ZodString;
}, "strip", z.ZodTypeAny, {
    questionId: string;
    answer: string;
}, {
    questionId: string;
    answer: string;
}>;
export declare const BlockerSchema: z.ZodObject<{
    kind: z.ZodEnum<["missing-field", "missing-relationship", "grain-mismatch", "ambiguous-dim", "other"]>;
    message: z.ZodString;
    refs: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
        table: z.ZodString;
        column: z.ZodString;
        kind: z.ZodEnum<["measure", "column"]>;
        aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
        isHidden: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }, {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    kind: "missing-field" | "missing-relationship" | "grain-mismatch" | "ambiguous-dim" | "other";
    message: string;
    refs?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
}, {
    kind: "missing-field" | "missing-relationship" | "grain-mismatch" | "ambiguous-dim" | "other";
    message: string;
    refs?: {
        kind: "column" | "measure";
        isHidden: boolean;
        table: string;
        column: string;
        aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
    }[] | undefined;
}>;
export declare const DashboardSpecSchema: z.ZodEffects<z.ZodObject<{
    status: z.ZodEnum<["ready", "needs-user-input", "blocked"]>;
    intent: z.ZodString;
    audience: z.ZodEnum<["exec", "analyst", "ops", "unspecified"]>;
    dateRange: z.ZodString;
    modelPath: z.ZodString;
    reportPath: z.ZodString;
    pages: z.ZodArray<z.ZodObject<{
        pageName: z.ZodString;
        layoutShape: z.ZodEnum<["overview", "drill", "kpi-grid"]>;
        questions: z.ZodArray<z.ZodObject<{
            q: z.ZodString;
            visualType: z.ZodString;
            axis: z.ZodOptional<z.ZodEffects<z.ZodObject<{
                table: z.ZodString;
                column: z.ZodString;
                kind: z.ZodEnum<["measure", "column"]>;
                aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
                isHidden: z.ZodBoolean;
            }, "strip", z.ZodTypeAny, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }>, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }>>;
            measures: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                table: z.ZodString;
                column: z.ZodString;
                kind: z.ZodEnum<["measure", "column"]>;
                aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
                isHidden: z.ZodBoolean;
            }, "strip", z.ZodTypeAny, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }>, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }>, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            q: string;
            visualType: string;
            measures?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            axis?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            } | undefined;
        }, {
            q: string;
            visualType: string;
            measures?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            axis?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            } | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        pageName: string;
        layoutShape: "overview" | "drill" | "kpi-grid";
        questions: {
            q: string;
            visualType: string;
            measures?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            axis?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            } | undefined;
        }[];
    }, {
        pageName: string;
        layoutShape: "overview" | "drill" | "kpi-grid";
        questions: {
            q: string;
            visualType: string;
            measures?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            axis?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            } | undefined;
        }[];
    }>, "many">;
    missingMeasures: z.ZodDefault<z.ZodArray<z.ZodEffects<z.ZodObject<{
        table: z.ZodString;
        name: z.ZodString;
        expression: z.ZodString;
        formatString: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        bridgeFrom: z.ZodOptional<z.ZodString>;
        bridgeTo: z.ZodOptional<z.ZodString>;
        bridgeVia: z.ZodOptional<z.ZodEnum<["TREATAS", "USERELATIONSHIP"]>>;
        bridgeCovers: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
            table: z.ZodString;
            column: z.ZodString;
            kind: z.ZodEnum<["measure", "column"]>;
            aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
            isHidden: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        expression: string;
        table: string;
        formatString: string;
        description?: string | undefined;
        bridgeFrom?: string | undefined;
        bridgeTo?: string | undefined;
        bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
        bridgeCovers?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }, {
        name: string;
        expression: string;
        table: string;
        formatString: string;
        description?: string | undefined;
        bridgeFrom?: string | undefined;
        bridgeTo?: string | undefined;
        bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
        bridgeCovers?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }>, {
        name: string;
        expression: string;
        table: string;
        formatString: string;
        description?: string | undefined;
        bridgeFrom?: string | undefined;
        bridgeTo?: string | undefined;
        bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
        bridgeCovers?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }, {
        name: string;
        expression: string;
        table: string;
        formatString: string;
        description?: string | undefined;
        bridgeFrom?: string | undefined;
        bridgeTo?: string | undefined;
        bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
        bridgeCovers?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }>, "many">>;
    missingDims: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        keyColumn: z.ZodString;
        sourceColumns: z.ZodArray<z.ZodEffects<z.ZodObject<{
            table: z.ZodString;
            column: z.ZodString;
            kind: z.ZodEnum<["measure", "column"]>;
            aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
            isHidden: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, "many">;
        attributeColumns: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
            table: z.ZodString;
            column: z.ZodString;
            kind: z.ZodEnum<["measure", "column"]>;
            aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
            isHidden: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        keyColumn: string;
        sourceColumns: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[];
        attributeColumns?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }, {
        name: string;
        keyColumn: string;
        sourceColumns: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[];
        attributeColumns?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }>, "many">;
    businessTerms: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        status: z.ZodEnum<["draft", "confirmed", "deprecated"]>;
        definition: z.ZodString;
        aliases: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        owner: z.ZodOptional<z.ZodString>;
        sourceRefs: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
            table: z.ZodString;
            column: z.ZodString;
            kind: z.ZodEnum<["measure", "column"]>;
            aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
            isHidden: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, "many">>;
        caveats: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        definition: string;
        status: "draft" | "confirmed" | "deprecated";
        aliases?: string[] | undefined;
        owner?: string | undefined;
        sourceRefs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        caveats?: string[] | undefined;
    }, {
        name: string;
        definition: string;
        status: "draft" | "confirmed" | "deprecated";
        aliases?: string[] | undefined;
        owner?: string | undefined;
        sourceRefs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        caveats?: string[] | undefined;
    }>, "many">>;
    measureIntents: z.ZodOptional<z.ZodArray<z.ZodObject<{
        measureName: z.ZodString;
        status: z.ZodEnum<["draft", "confirmed"]>;
        owner: z.ZodString;
        definition: z.ZodString;
        sourceRefs: z.ZodArray<z.ZodEffects<z.ZodObject<{
            table: z.ZodString;
            column: z.ZodString;
            kind: z.ZodEnum<["measure", "column"]>;
            aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
            isHidden: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, "atleastone">;
        grain: z.ZodString;
        additivity: z.ZodString;
        filters: z.ZodArray<z.ZodString, "many">;
        format: z.ZodString;
        unit: z.ZodString;
        caveats: z.ZodArray<z.ZodString, "many">;
        businessTermRefs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        timeIntelligence: z.ZodOptional<z.ZodObject<{
            dateRefs: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodObject<{
                table: z.ZodString;
                column: z.ZodString;
                kind: z.ZodEnum<["measure", "column"]>;
                aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
                isHidden: z.ZodBoolean;
            }, "strip", z.ZodTypeAny, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }>, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }>, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }, {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }>, "many">>;
            dateTable: z.ZodOptional<z.ZodString>;
            dateColumn: z.ZodOptional<z.ZodString>;
            period: z.ZodOptional<z.ZodString>;
            comparison: z.ZodOptional<z.ZodString>;
            grain: z.ZodOptional<z.ZodString>;
            calendarPolicy: z.ZodOptional<z.ZodString>;
            incompletePeriodBehavior: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            dateTable?: string | undefined;
            dateColumn?: string | undefined;
            period?: string | undefined;
            dateRefs?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            comparison?: string | undefined;
            grain?: string | undefined;
            calendarPolicy?: string | undefined;
            incompletePeriodBehavior?: string | undefined;
        }, {
            dateTable?: string | undefined;
            dateColumn?: string | undefined;
            period?: string | undefined;
            dateRefs?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            comparison?: string | undefined;
            grain?: string | undefined;
            calendarPolicy?: string | undefined;
            incompletePeriodBehavior?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        definition: string;
        status: "draft" | "confirmed";
        owner: string;
        sourceRefs: [{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, ...{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[]];
        caveats: string[];
        grain: string;
        measureName: string;
        additivity: string;
        filters: string[];
        format: string;
        unit: string;
        businessTermRefs?: string[] | undefined;
        timeIntelligence?: {
            dateTable?: string | undefined;
            dateColumn?: string | undefined;
            period?: string | undefined;
            dateRefs?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            comparison?: string | undefined;
            grain?: string | undefined;
            calendarPolicy?: string | undefined;
            incompletePeriodBehavior?: string | undefined;
        } | undefined;
    }, {
        definition: string;
        status: "draft" | "confirmed";
        owner: string;
        sourceRefs: [{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, ...{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[]];
        caveats: string[];
        grain: string;
        measureName: string;
        additivity: string;
        filters: string[];
        format: string;
        unit: string;
        businessTermRefs?: string[] | undefined;
        timeIntelligence?: {
            dateTable?: string | undefined;
            dateColumn?: string | undefined;
            period?: string | undefined;
            dateRefs?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            comparison?: string | undefined;
            grain?: string | undefined;
            calendarPolicy?: string | undefined;
            incompletePeriodBehavior?: string | undefined;
        } | undefined;
    }>, "many">>;
    userDecisions: z.ZodArray<z.ZodObject<{
        questionId: z.ZodString;
        answer: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        questionId: string;
        answer: string;
    }, {
        questionId: string;
        answer: string;
    }>, "many">;
    clarifyingQuestions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        prompt: z.ZodString;
        options: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        prompt: string;
        options?: string[] | undefined;
    }, {
        id: string;
        prompt: string;
        options?: string[] | undefined;
    }>, "many">>;
    blockers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<["missing-field", "missing-relationship", "grain-mismatch", "ambiguous-dim", "other"]>;
        message: z.ZodString;
        refs: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodObject<{
            table: z.ZodString;
            column: z.ZodString;
            kind: z.ZodEnum<["measure", "column"]>;
            aggregation: z.ZodOptional<z.ZodEnum<["sum", "avg", "count", "min", "max"]>>;
            isHidden: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        kind: "missing-field" | "missing-relationship" | "grain-mismatch" | "ambiguous-dim" | "other";
        message: string;
        refs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }, {
        kind: "missing-field" | "missing-relationship" | "grain-mismatch" | "ambiguous-dim" | "other";
        message: string;
        refs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    modelPath: string;
    status: "blocked" | "ready" | "needs-user-input";
    intent: string;
    audience: "exec" | "analyst" | "ops" | "unspecified";
    dateRange: string;
    reportPath: string;
    pages: {
        pageName: string;
        layoutShape: "overview" | "drill" | "kpi-grid";
        questions: {
            q: string;
            visualType: string;
            measures?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            axis?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            } | undefined;
        }[];
    }[];
    missingMeasures: {
        name: string;
        expression: string;
        table: string;
        formatString: string;
        description?: string | undefined;
        bridgeFrom?: string | undefined;
        bridgeTo?: string | undefined;
        bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
        bridgeCovers?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[];
    missingDims: {
        name: string;
        keyColumn: string;
        sourceColumns: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[];
        attributeColumns?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[];
    userDecisions: {
        questionId: string;
        answer: string;
    }[];
    businessTerms?: {
        name: string;
        definition: string;
        status: "draft" | "confirmed" | "deprecated";
        aliases?: string[] | undefined;
        owner?: string | undefined;
        sourceRefs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        caveats?: string[] | undefined;
    }[] | undefined;
    measureIntents?: {
        definition: string;
        status: "draft" | "confirmed";
        owner: string;
        sourceRefs: [{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, ...{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[]];
        caveats: string[];
        grain: string;
        measureName: string;
        additivity: string;
        filters: string[];
        format: string;
        unit: string;
        businessTermRefs?: string[] | undefined;
        timeIntelligence?: {
            dateTable?: string | undefined;
            dateColumn?: string | undefined;
            period?: string | undefined;
            dateRefs?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            comparison?: string | undefined;
            grain?: string | undefined;
            calendarPolicy?: string | undefined;
            incompletePeriodBehavior?: string | undefined;
        } | undefined;
    }[] | undefined;
    clarifyingQuestions?: {
        id: string;
        prompt: string;
        options?: string[] | undefined;
    }[] | undefined;
    blockers?: {
        kind: "missing-field" | "missing-relationship" | "grain-mismatch" | "ambiguous-dim" | "other";
        message: string;
        refs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[] | undefined;
}, {
    modelPath: string;
    status: "blocked" | "ready" | "needs-user-input";
    intent: string;
    audience: "exec" | "analyst" | "ops" | "unspecified";
    dateRange: string;
    reportPath: string;
    pages: {
        pageName: string;
        layoutShape: "overview" | "drill" | "kpi-grid";
        questions: {
            q: string;
            visualType: string;
            measures?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            axis?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            } | undefined;
        }[];
    }[];
    missingDims: {
        name: string;
        keyColumn: string;
        sourceColumns: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[];
        attributeColumns?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[];
    userDecisions: {
        questionId: string;
        answer: string;
    }[];
    missingMeasures?: {
        name: string;
        expression: string;
        table: string;
        formatString: string;
        description?: string | undefined;
        bridgeFrom?: string | undefined;
        bridgeTo?: string | undefined;
        bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
        bridgeCovers?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[] | undefined;
    businessTerms?: {
        name: string;
        definition: string;
        status: "draft" | "confirmed" | "deprecated";
        aliases?: string[] | undefined;
        owner?: string | undefined;
        sourceRefs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        caveats?: string[] | undefined;
    }[] | undefined;
    measureIntents?: {
        definition: string;
        status: "draft" | "confirmed";
        owner: string;
        sourceRefs: [{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, ...{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[]];
        caveats: string[];
        grain: string;
        measureName: string;
        additivity: string;
        filters: string[];
        format: string;
        unit: string;
        businessTermRefs?: string[] | undefined;
        timeIntelligence?: {
            dateTable?: string | undefined;
            dateColumn?: string | undefined;
            period?: string | undefined;
            dateRefs?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            comparison?: string | undefined;
            grain?: string | undefined;
            calendarPolicy?: string | undefined;
            incompletePeriodBehavior?: string | undefined;
        } | undefined;
    }[] | undefined;
    clarifyingQuestions?: {
        id: string;
        prompt: string;
        options?: string[] | undefined;
    }[] | undefined;
    blockers?: {
        kind: "missing-field" | "missing-relationship" | "grain-mismatch" | "ambiguous-dim" | "other";
        message: string;
        refs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[] | undefined;
}>, {
    modelPath: string;
    status: "blocked" | "ready" | "needs-user-input";
    intent: string;
    audience: "exec" | "analyst" | "ops" | "unspecified";
    dateRange: string;
    reportPath: string;
    pages: {
        pageName: string;
        layoutShape: "overview" | "drill" | "kpi-grid";
        questions: {
            q: string;
            visualType: string;
            measures?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            axis?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            } | undefined;
        }[];
    }[];
    missingMeasures: {
        name: string;
        expression: string;
        table: string;
        formatString: string;
        description?: string | undefined;
        bridgeFrom?: string | undefined;
        bridgeTo?: string | undefined;
        bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
        bridgeCovers?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[];
    missingDims: {
        name: string;
        keyColumn: string;
        sourceColumns: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[];
        attributeColumns?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[];
    userDecisions: {
        questionId: string;
        answer: string;
    }[];
    businessTerms?: {
        name: string;
        definition: string;
        status: "draft" | "confirmed" | "deprecated";
        aliases?: string[] | undefined;
        owner?: string | undefined;
        sourceRefs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        caveats?: string[] | undefined;
    }[] | undefined;
    measureIntents?: {
        definition: string;
        status: "draft" | "confirmed";
        owner: string;
        sourceRefs: [{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, ...{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[]];
        caveats: string[];
        grain: string;
        measureName: string;
        additivity: string;
        filters: string[];
        format: string;
        unit: string;
        businessTermRefs?: string[] | undefined;
        timeIntelligence?: {
            dateTable?: string | undefined;
            dateColumn?: string | undefined;
            period?: string | undefined;
            dateRefs?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            comparison?: string | undefined;
            grain?: string | undefined;
            calendarPolicy?: string | undefined;
            incompletePeriodBehavior?: string | undefined;
        } | undefined;
    }[] | undefined;
    clarifyingQuestions?: {
        id: string;
        prompt: string;
        options?: string[] | undefined;
    }[] | undefined;
    blockers?: {
        kind: "missing-field" | "missing-relationship" | "grain-mismatch" | "ambiguous-dim" | "other";
        message: string;
        refs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[] | undefined;
}, {
    modelPath: string;
    status: "blocked" | "ready" | "needs-user-input";
    intent: string;
    audience: "exec" | "analyst" | "ops" | "unspecified";
    dateRange: string;
    reportPath: string;
    pages: {
        pageName: string;
        layoutShape: "overview" | "drill" | "kpi-grid";
        questions: {
            q: string;
            visualType: string;
            measures?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            axis?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            } | undefined;
        }[];
    }[];
    missingDims: {
        name: string;
        keyColumn: string;
        sourceColumns: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[];
        attributeColumns?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[];
    userDecisions: {
        questionId: string;
        answer: string;
    }[];
    missingMeasures?: {
        name: string;
        expression: string;
        table: string;
        formatString: string;
        description?: string | undefined;
        bridgeFrom?: string | undefined;
        bridgeTo?: string | undefined;
        bridgeVia?: "USERELATIONSHIP" | "TREATAS" | undefined;
        bridgeCovers?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[] | undefined;
    businessTerms?: {
        name: string;
        definition: string;
        status: "draft" | "confirmed" | "deprecated";
        aliases?: string[] | undefined;
        owner?: string | undefined;
        sourceRefs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
        caveats?: string[] | undefined;
    }[] | undefined;
    measureIntents?: {
        definition: string;
        status: "draft" | "confirmed";
        owner: string;
        sourceRefs: [{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }, ...{
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[]];
        caveats: string[];
        grain: string;
        measureName: string;
        additivity: string;
        filters: string[];
        format: string;
        unit: string;
        businessTermRefs?: string[] | undefined;
        timeIntelligence?: {
            dateTable?: string | undefined;
            dateColumn?: string | undefined;
            period?: string | undefined;
            dateRefs?: {
                kind: "column" | "measure";
                isHidden: boolean;
                table: string;
                column: string;
                aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
            }[] | undefined;
            comparison?: string | undefined;
            grain?: string | undefined;
            calendarPolicy?: string | undefined;
            incompletePeriodBehavior?: string | undefined;
        } | undefined;
    }[] | undefined;
    clarifyingQuestions?: {
        id: string;
        prompt: string;
        options?: string[] | undefined;
    }[] | undefined;
    blockers?: {
        kind: "missing-field" | "missing-relationship" | "grain-mismatch" | "ambiguous-dim" | "other";
        message: string;
        refs?: {
            kind: "column" | "measure";
            isHidden: boolean;
            table: string;
            column: string;
            aggregation?: "sum" | "avg" | "count" | "min" | "max" | undefined;
        }[] | undefined;
    }[] | undefined;
}>;
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
    readonly errors: ReadonlyArray<{
        readonly path: string;
        readonly message: string;
    }>;
}
export declare function validateDashboardSpec(spec: unknown): SpecValidationResult;
