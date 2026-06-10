import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { modelDoctor, modelDoctorFromFolder } from '../../src/modeling/doctor.js';

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

  it('reports security and governance metadata as not captured instead of silently clean', () => {
    const r = modelDoctor({
      modelPath: '(live)',
      tables: [],
      relationships: [],
    });

    expect(r.metadataCoverage.roles.status).toBe('not-captured');
    expect(r.metadataCoverage.ols.status).toBe('not-captured');
    expect(r.metadataCoverage.sensitivity.status).toBe('not-captured');
    expect(r.metadataCoverage.governance.status).toBe('not-captured');
  });

  it('reports roles as captured when role metadata is present', () => {
    const r = modelDoctor({
      modelPath: '(live)',
      tables: [],
      relationships: [],
      roles: [{ name: 'Secured', tablePermissions: [] }],
    });

    expect(r.metadataCoverage.roles.status).toBe('captured');
    expect(r.metadataCoverage.roles.count).toBe(1);
  });

  it('reports zero roles as captured when role enumeration succeeded', () => {
    const r = modelDoctor({
      modelPath: '(live)',
      tables: [],
      relationships: [],
      rolesCaptured: true,
    });

    expect(r.metadataCoverage.roles.status).toBe('captured');
    expect(r.metadataCoverage.roles.count).toBe(0);
  });

  it('reports zero roles as captured for inspected TMDL folders with no roles', () => {
    const r = modelDoctorFromFolder(STAR_GOOD);

    expect(r.metadataCoverage.roles.status).toBe('captured');
    expect(r.metadataCoverage.roles.count).toBe(0);
  });

  it('blocks regulated readiness when required policy evidence is missing', () => {
    const r = modelDoctor(
      {
        modelPath: '(live)',
        tables: [],
        relationships: [],
      },
      { regulatedEnterprise: true },
    );

    expect(r.regulatedEnterprise?.status).toBe('blocked');
    expect(r.regulatedEnterprise?.missingEvidence).toEqual(
      expect.arrayContaining([
        'rlsTestResults',
        'sensitivityClassification',
        'lineage',
        'metricOwnerSignoff',
        'serviceGovernance',
      ]),
    );
    expect(r.regulatedEnterprise?.aiExposure.status).toBe('not-applicable');
  });

  it('passes regulated readiness with required metadata capture and policy evidence when AI exposure is out of scope', () => {
    const r = modelDoctor(
      {
        modelPath: '(live)',
        tables: [],
        relationships: [],
        rolesCaptured: true,
        dataSourcesCaptured: true,
        sensitivityCaptured: true,
        lineageCaptured: true,
        governanceCaptured: true,
      },
      {
        regulatedEnterprise: true,
        policyEvidence: {
          rlsTestResults: 'tested',
          sensitivityClassification: 'classified',
          lineage: 'reviewed',
          refreshEvidence: 'refresh logged',
          metricOwnerSignoff: 'owner signed',
          openExceptions: [],
          serviceGovernance: 'workspace governed',
        },
      },
    );

    expect(r.regulatedEnterprise?.status).toBe('passed');
    expect(r.regulatedEnterprise?.missingEvidence).toEqual([]);
    expect(r.regulatedEnterprise?.aiExposure.status).toBe('not-applicable');
  });

  it('does not treat empty positive-evidence arrays as supplied', () => {
    const r = modelDoctor(
      {
        modelPath: '(live)',
        tables: [],
        relationships: [],
        rolesCaptured: true,
        dataSourcesCaptured: true,
        sensitivityCaptured: true,
        lineageCaptured: true,
        governanceCaptured: true,
      },
      {
        regulatedEnterprise: true,
        policyEvidence: {
          rlsTestResults: [],
          sensitivityClassification: [],
          lineage: [],
          refreshEvidence: [],
          metricOwnerSignoff: [],
          openExceptions: [],
          serviceGovernance: [],
        },
      },
    );

    expect(r.regulatedEnterprise?.status).toBe('blocked');
    expect(r.regulatedEnterprise?.missingEvidence).toEqual(
      expect.arrayContaining([
        'rlsTestResults',
        'sensitivityClassification',
        'lineage',
        'refreshEvidence',
        'metricOwnerSignoff',
        'serviceGovernance',
      ]),
    );
    expect(r.regulatedEnterprise?.missingEvidence).not.toContain('openExceptions');
  });

  it('blocks regulated readiness when policy evidence is supplied but required metadata was not captured', () => {
    const r = modelDoctor(
      {
        modelPath: '(live)',
        tables: [],
        relationships: [],
      },
      {
        regulatedEnterprise: true,
        policyEvidence: {
          rlsTestResults: 'tested',
          sensitivityClassification: 'classified',
          lineage: 'reviewed',
          refreshEvidence: 'refresh logged',
          metricOwnerSignoff: 'owner signed',
          openExceptions: [],
          serviceGovernance: 'workspace governed',
        },
      },
    );

    expect(r.regulatedEnterprise?.status).toBe('blocked');
    expect(r.regulatedEnterprise?.missingEvidence).toEqual(
      expect.arrayContaining([
        'capturedRoles',
        'capturedDataSources',
        'capturedSensitivity',
        'capturedLineage',
        'capturedGovernance',
      ]),
    );
  });

  it('requires AI evidence only when Copilot or data-agent exposure is in scope', () => {
    const r = modelDoctor(
      {
        modelPath: '(live)',
        tables: [],
        relationships: [],
        rolesCaptured: true,
        dataSourcesCaptured: true,
        sensitivityCaptured: true,
        lineageCaptured: true,
        governanceCaptured: true,
      },
      {
        regulatedEnterprise: true,
        policyEvidence: {
          rlsTestResults: 'tested',
          sensitivityClassification: 'classified',
          lineage: 'reviewed',
          refreshEvidence: 'refresh logged',
          metricOwnerSignoff: 'owner signed',
          openExceptions: [],
          serviceGovernance: 'workspace governed',
          copilotExposure: 'in-scope',
        },
      },
    );

    expect(r.regulatedEnterprise?.status).toBe('blocked');
    expect(r.regulatedEnterprise?.aiExposure.status).toBe('blocked');
    expect(r.regulatedEnterprise?.aiExposure.missingEvidence).toEqual(
      expect.arrayContaining(['aiSchemaScope', 'rlsLeakageTests']),
    );
  });

  it('honors explicit out-of-scope AI exposure even when a copilot object is present', () => {
    const r = modelDoctor(
      {
        modelPath: '(live)',
        tables: [],
        relationships: [],
        rolesCaptured: true,
        dataSourcesCaptured: true,
        sensitivityCaptured: true,
        lineageCaptured: true,
        governanceCaptured: true,
      },
      {
        regulatedEnterprise: true,
        policyEvidence: {
          rlsTestResults: 'tested',
          sensitivityClassification: 'classified',
          lineage: 'reviewed',
          refreshEvidence: 'refresh logged',
          metricOwnerSignoff: 'owner signed',
          openExceptions: [],
          serviceGovernance: 'workspace governed',
          copilotExposure: 'out-of-scope',
          copilot: {},
        },
      },
    );

    expect(r.regulatedEnterprise?.status).toBe('passed');
    expect(r.regulatedEnterprise?.aiExposure.status).toBe('not-applicable');
  });
});
