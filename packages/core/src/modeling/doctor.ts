import { runBPA } from './bpa.js';
import { buildGrainReport, validateBridge } from './grain.js';
import { checkRelationships } from './relationship-check.js';
import { parseTMDLFolder } from './tmdl-parser.js';
import type {
  BridgeIntent,
  ModelDoctorReport,
  ModelMetadataCapture,
  ModelMetadataCoverage,
  RegulatedEnterprisePolicyEvidence,
  RegulatedEnterpriseReadiness,
  Severity,
  TMDLModel,
} from './types.js';

export interface ModelDoctorOptions {
  readonly bridgeIntent?: BridgeIntent;
  readonly regulatedEnterprise?: boolean;
  readonly policyEvidence?: RegulatedEnterprisePolicyEvidence;
}

export function modelDoctorFromFolder(
  definitionPath: string,
  options: ModelDoctorOptions = {},
): ModelDoctorReport {
  const model = parseTMDLFolder(definitionPath);
  return modelDoctor(model, options);
}

export function modelDoctor(model: TMDLModel, options: ModelDoctorOptions = {}): ModelDoctorReport {
  const bpa = runBPA(model);
  const relationships = checkRelationships(model);
  const grain = buildGrainReport(model);

  let bridge = grain.bridge;
  if (options.bridgeIntent) {
    bridge = validateBridge(
      model,
      options.bridgeIntent.fromTable,
      options.bridgeIntent.toTable,
      options.bridgeIntent.axes,
    );
  }

  const grainWithBridge = bridge ? { ...grain, bridge } : grain;

  const tally = (sev: Severity) => {
    let n = 0;
    for (const v of bpa) if (v.severity === sev) n++;
    for (const r of relationships) if (r.level === sev) n++;
    return n;
  };

  const summary = {
    errors: tally('error'),
    warnings: tally('warning'),
    info: tally('info'),
  };

  const metadataCoverage = buildMetadataCoverage(model);
  return {
    modelPath: model.modelPath,
    passed: summary.errors === 0,
    summary,
    grain: grainWithBridge,
    bpa,
    relationships,
    metadataCoverage,
    ...(options.regulatedEnterprise
      ? {
          regulatedEnterprise: regulatedReadiness(metadataCoverage, options.policyEvidence ?? {}),
        }
      : {}),
  };
}

function captured(count: number | undefined, message: string): ModelMetadataCapture {
  return { status: 'captured', ...(count !== undefined ? { count } : {}), message };
}

function notCaptured(message: string): ModelMetadataCapture {
  return { status: 'not-captured', message };
}

function booleanCapture(capturedFlag: boolean | undefined, label: string): ModelMetadataCapture {
  return capturedFlag === true
    ? captured(undefined, `${label} metadata was captured by the wrapper.`)
    : notCaptured(`${label} metadata was not captured by the wrapper.`);
}

function buildMetadataCoverage(model: TMDLModel): ModelMetadataCoverage {
  const roleCount = model.rolesCaptured === true ? (model.roles?.length ?? 0) : model.roles?.length;
  return {
    roles:
      roleCount !== undefined
        ? captured(roleCount, 'RLS role metadata was captured.')
        : notCaptured('RLS role metadata was not captured; do not treat security review as clean.'),
    ols: booleanCapture(model.objectLevelSecurityCaptured, 'Object-level security'),
    calculationGroups: booleanCapture(model.calculationGroupsCaptured, 'Calculation group'),
    perspectives: booleanCapture(model.perspectivesCaptured, 'Perspective'),
    dataSources: booleanCapture(model.dataSourcesCaptured, 'Data source'),
    sensitivity: booleanCapture(model.sensitivityCaptured, 'Sensitivity/PII classification'),
    lineage: booleanCapture(model.lineageCaptured, 'Lineage'),
    governance: booleanCapture(model.governanceCaptured, 'Service governance'),
  };
}

const REQUIRED_REGULATED_EVIDENCE = [
  'rlsTestResults',
  'sensitivityClassification',
  'lineage',
  'refreshEvidence',
  'metricOwnerSignoff',
  'openExceptions',
  'serviceGovernance',
] as const;

const REQUIRED_AI_EVIDENCE = [
  'aiSchemaScope',
  'rlsLeakageTests',
  'tenantSettings',
  'approvedInstructions',
] as const;

const EMPTY_ARRAY_ALLOWED_EVIDENCE = new Set<keyof RegulatedEnterprisePolicyEvidence>([
  'openExceptions',
]);

const REQUIRED_REGULATED_METADATA = [
  ['roles', 'capturedRoles'],
  ['dataSources', 'capturedDataSources'],
  ['sensitivity', 'capturedSensitivity'],
  ['lineage', 'capturedLineage'],
  ['governance', 'capturedGovernance'],
] as const satisfies ReadonlyArray<readonly [keyof ModelMetadataCoverage, string]>;

function hasEvidence(
  value: unknown,
  options: { readonly allowEmptyArray?: boolean } = {},
): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return options.allowEmptyArray === true || value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function regulatedReadiness(
  metadataCoverage: ModelMetadataCoverage,
  evidence: RegulatedEnterprisePolicyEvidence,
): RegulatedEnterpriseReadiness {
  const missingEvidence: string[] = [];
  for (const key of REQUIRED_REGULATED_EVIDENCE) {
    if (
      !hasEvidence(evidence[key], {
        allowEmptyArray: EMPTY_ARRAY_ALLOWED_EVIDENCE.has(key),
      })
    ) {
      missingEvidence.push(key);
    }
  }
  for (const [coverageKey, missingKey] of REQUIRED_REGULATED_METADATA) {
    if (metadataCoverage[coverageKey].status !== 'captured') missingEvidence.push(missingKey);
  }
  if (metadataCoverage.ols.status !== 'captured' && hasEvidence(evidence.olsRequirements)) {
    missingEvidence.push('capturedOlsMetadata');
  }

  const aiExposureInScope =
    evidence.copilotExposure === 'in-scope' ||
    (evidence.copilotExposure !== 'out-of-scope' && evidence.copilot !== undefined);
  const missingAiEvidence = aiExposureInScope
    ? REQUIRED_AI_EVIDENCE.filter((key) => !hasEvidence(evidence.copilot?.[key]))
    : [];
  const aiExposure = aiExposureInScope
    ? {
        status: missingAiEvidence.length === 0 ? ('passed' as const) : ('blocked' as const),
        missingEvidence: missingAiEvidence,
        message:
          missingAiEvidence.length === 0
            ? 'Copilot/data-agent exposure evidence was supplied.'
            : 'Copilot/data-agent exposure is blocked until AI schema scope, RLS leakage tests, tenant settings, and approved instructions are evidenced.',
      }
    : {
        status: 'not-applicable' as const,
        missingEvidence: [],
        message: 'Copilot/data-agent exposure was not marked in scope.',
      };

  return {
    status: missingEvidence.length === 0 && aiExposure.status !== 'blocked' ? 'passed' : 'blocked',
    missingEvidence: [...new Set(missingEvidence)],
    metadataCoverage,
    aiExposure,
  };
}
