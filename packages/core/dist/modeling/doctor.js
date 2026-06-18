import { runBPA } from './bpa.js';
import { buildGrainReport, validateBridge } from './grain.js';
import { checkRelationships } from './relationship-check.js';
import { parseTMDLFolder } from './tmdl-parser.js';
export function modelDoctorFromFolder(definitionPath, options = {}) {
    const model = parseTMDLFolder(definitionPath);
    return modelDoctor(model, options);
}
export function modelDoctor(model, options = {}) {
    const bpa = runBPA(model);
    const relationships = checkRelationships(model);
    const grain = buildGrainReport(model);
    let bridge = grain.bridge;
    if (options.bridgeIntent) {
        bridge = validateBridge(model, options.bridgeIntent.fromTable, options.bridgeIntent.toTable, options.bridgeIntent.axes);
    }
    const grainWithBridge = bridge ? { ...grain, bridge } : grain;
    const tally = (sev) => {
        let n = 0;
        for (const v of bpa)
            if (v.severity === sev)
                n++;
        for (const r of relationships)
            if (r.level === sev)
                n++;
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
function captured(count, message) {
    return { status: 'captured', ...(count !== undefined ? { count } : {}), message };
}
function notCaptured(message) {
    return { status: 'not-captured', message };
}
// Honest capture for a metadata class that the modeling-only beta does NOT enumerate
// from the model: report `captured` only if an assembler actually set the flag
// (future-proof), otherwise state plainly that it is not enumerable on this beta and
// must be attested via regulated policy evidence — rather than the old
// "not captured by the wrapper" message that read like a fixable model gap. These
// classes are deliberately NOT part of the hard metadata requirement below (see
// REQUIRED_REGULATED_METADATA); the governance bar for them comes from policyEvidence.
function enumerableCapture(capturedFlag, label) {
    return capturedFlag === true
        ? captured(undefined, `${label} metadata was captured.`)
        : notCaptured(`${label} metadata is not enumerable on the modeling-only beta; attest it via regulated policy evidence rather than treating it as a captured model gate.`);
}
function buildMetadataCoverage(model) {
    const roleCount = model.rolesCaptured === true ? (model.roles?.length ?? 0) : model.roles?.length;
    return {
        roles: roleCount !== undefined
            ? captured(roleCount, 'RLS role metadata was captured.')
            : notCaptured('RLS role metadata was not captured; do not treat security review as clean.'),
        ols: enumerableCapture(model.objectLevelSecurityCaptured, 'Object-level security'),
        calculationGroups: enumerableCapture(model.calculationGroupsCaptured, 'Calculation group'),
        perspectives: enumerableCapture(model.perspectivesCaptured, 'Perspective'),
        dataSources: enumerableCapture(model.dataSourcesCaptured, 'Data source'),
        sensitivity: enumerableCapture(model.sensitivityCaptured, 'Sensitivity/PII classification'),
        lineage: enumerableCapture(model.lineageCaptured, 'Lineage'),
        governance: enumerableCapture(model.governanceCaptured, 'Service governance'),
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
];
const REQUIRED_AI_EVIDENCE = [
    'aiSchemaScope',
    'rlsLeakageTests',
    'tenantSettings',
    'approvedInstructions',
];
const EMPTY_ARRAY_ALLOWED_EVIDENCE = new Set([
    'openExceptions',
]);
// The HARD metadata-capture gate requires only what the model assemblers actually
// produce today: RLS role enumeration (tmdl-parser sets rolesCaptured; the live driver
// sets it when the roles List succeeds). dataSources/sensitivity/lineage/governance are
// NOT enumerable on the modeling-only beta, so requiring their capture flags here made
// `passed` permanently UNREACHABLE for any real model (the flags were read but never
// set). Their governance bar is enforced via REQUIRED_REGULATED_EVIDENCE
// (sensitivityClassification / lineage / serviceGovernance attestations) instead, so the
// regulated check now conveys a real, satisfiable signal rather than a fake permanent block.
const REQUIRED_REGULATED_METADATA = [['roles', 'capturedRoles']];
function hasEvidence(value, options = {}) {
    if (value === undefined || value === null)
        return false;
    if (typeof value === 'string')
        return value.trim().length > 0;
    if (Array.isArray(value))
        return options.allowEmptyArray === true || value.length > 0;
    if (typeof value === 'object')
        return Object.keys(value).length > 0;
    return true;
}
function regulatedReadiness(metadataCoverage, evidence) {
    const missingEvidence = [];
    for (const key of REQUIRED_REGULATED_EVIDENCE) {
        if (!hasEvidence(evidence[key], {
            allowEmptyArray: EMPTY_ARRAY_ALLOWED_EVIDENCE.has(key),
        })) {
            missingEvidence.push(key);
        }
    }
    for (const [coverageKey, missingKey] of REQUIRED_REGULATED_METADATA) {
        if (metadataCoverage[coverageKey].status !== 'captured')
            missingEvidence.push(missingKey);
    }
    if (metadataCoverage.ols.status !== 'captured' && hasEvidence(evidence.olsRequirements)) {
        missingEvidence.push('capturedOlsMetadata');
    }
    const aiExposureInScope = evidence.copilotExposure === 'in-scope' ||
        (evidence.copilotExposure !== 'out-of-scope' && evidence.copilot !== undefined);
    const missingAiEvidence = aiExposureInScope
        ? REQUIRED_AI_EVIDENCE.filter((key) => !hasEvidence(evidence.copilot?.[key]))
        : [];
    const aiExposure = aiExposureInScope
        ? {
            status: missingAiEvidence.length === 0 ? 'passed' : 'blocked',
            missingEvidence: missingAiEvidence,
            message: missingAiEvidence.length === 0
                ? 'Copilot/data-agent exposure evidence was supplied.'
                : 'Copilot/data-agent exposure is blocked until AI schema scope, RLS leakage tests, tenant settings, and approved instructions are evidenced.',
        }
        : {
            status: 'not-applicable',
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
//# sourceMappingURL=doctor.js.map