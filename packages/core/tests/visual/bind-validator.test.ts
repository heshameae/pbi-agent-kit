import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VisualBindValidationError,
  pageAdd,
  reportCreate,
  validateVisualBindingPlan,
  visualAdd,
  visualBind,
} from '../../src/index.js';

let tmp: string;
let defn: string;
let modelDefn: string;
const PAGE = 'p1';

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pbi-bind-validator-')));
  const r = reportCreate({ targetPath: tmp, name: 'MyReport' });
  defn = r.definitionPath;
  pageAdd(defn, { displayName: 'P', name: PAGE });
  modelDefn = path.join(tmp, 'MyModel.SemanticModel', 'definition');
  writeModel(modelDefn);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('validateVisualBindingPlan', () => {
  it('accepts a real measure on a value role and a related column axis', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'MyDim[MyCategory]', measure: false },
        { role: 'Y', field: 'MyFact[MyAmount]', measure: true },
      ],
      { modelPath: modelDefn },
    );
    expect(report.status).toBe('valid');
    expect(report.blockedWrite).toBe(false);
  });

  it('blocks missing fields before writing visual.json', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'v1' });
    const before = visualJson('v1');

    expect(() =>
      visualBind(
        defn,
        PAGE,
        'v1',
        [{ role: 'Values', field: 'MyFact[MissingMeasure]', measure: true }],
        { modelPath: modelDefn },
      ),
    ).toThrow(VisualBindValidationError);

    expect(visualJson('v1')).toBe(before);
  });

  it('blocks Measure shape when the field is a column', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [{ role: 'Values', field: 'MyFact[MyValue]', measure: true }],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('KIND_MISMATCH_MEASURE_FLAG');
  });

  it('blocks summarizable columns in value roles without aggregation', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [{ role: 'Values', field: 'MyFact[MyValue]', measure: false }],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('MISSING_AGGREGATION');
  });

  it('allows summarizable columns in value roles with aggregation', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [{ role: 'Values', field: 'MyFact[MyValue]', measure: false, aggregation: 'sum' }],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('valid');
  });

  it('blocks a bridged measure on an uncovered finer-grain axis', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'MyActuals[MySubcategory]', measure: false },
        { role: 'Y', field: 'MyActuals[MyTarget]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('BRIDGE_BLOCKED_AXIS');
  });

  it('blocks a measure derived from a bridged measure on an uncovered finer-grain axis', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'MyActuals[MySubcategory]', measure: false },
        { role: 'Y', field: 'MyActuals[MyVariance]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('BRIDGE_BLOCKED_AXIS');
  });

  it('allows a bridged measure on a covered axis that filters the bridge source', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'MyActuals[MyCategory]', measure: false },
        { role: 'Y', field: 'MyActuals[MyTarget]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('valid');
  });

  it('blocks a bridged measure on an unrelated same-name axis', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'MyOtherDim[MyCategory]', measure: false },
        { role: 'Y', field: 'MyActuals[MyTarget]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('BRIDGE_BLOCKED_AXIS');
  });

  it('allows an actuals-only measure on the same finer-grain axis', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'MyActuals[MySubcategory]', measure: false },
        { role: 'Y', field: 'MyActuals[MyActual]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('valid');
  });

  it('blocks reverse single-direction fact-to-dimension filtering', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'MyFact[MyDimKey]', measure: false },
        { role: 'Y', field: 'MyDim[MyDimMetric]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('NO_FILTER_PATH');
  });

  it('blocks an unapproved proxy target measure', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [{ role: 'Values', field: 'MyFact[MyProxyTarget]', measure: true }],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('UNAPPROVED_PROXY_MEASURE');
  });

  it('allows a user-approved proxy target measure', () => {
    visualAdd(defn, PAGE, { visualType: 'card', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [{ role: 'Values', field: 'MyFact[MyApprovedTarget]', measure: true }],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('valid');
  });

  it('blocks a bridge-annotated measure on a duplicate fact-side FK axis', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'FactBridgeFrom[SharedAxis]', measure: false },
        { role: 'Y', field: 'FactBridgeFrom[BridgeMetric]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('MODEL_MOD005');
  });

  it('blocks a bridge-annotated measure on an uncovered axis on the bridge_from table', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'FactBridgeFrom[DetailAxis]', measure: false },
        { role: 'Y', field: 'FactBridgeFrom[BridgeMetric]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('BRIDGE_BLOCKED_AXIS');
  });

  it('blocks a bridge-annotated measure on an unrelated same-name axis', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'DimOther[SharedAxis]', measure: false },
        { role: 'Y', field: 'FactBridgeFrom[BridgeMetric]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('BRIDGE_BLOCKED_AXIS');
  });

  it('passes a bridge-annotated measure on a related dimension axis when an active relationship path exists', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'DimShared[SharedAxis]', measure: false },
        { role: 'Y', field: 'FactBridgeFrom[BridgeMetric]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('valid');
  });

  it('blocks via bridge annotations even when the expression has no TREATAS', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'FactBridgeFrom[DetailAxis]', measure: false },
        { role: 'Y', field: 'FactBridgeFrom[BridgeMetricSimple]', measure: true },
      ],
      { modelPath: modelDefn },
    );

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('BRIDGE_BLOCKED_AXIS');
  });

  it('blocks via bridge annotations even when annotation values are double-quoted', () => {
    visualAdd(defn, PAGE, { visualType: 'barChart', name: 'v1' });
    const report = validateVisualBindingPlan(
      defn,
      PAGE,
      'v1',
      [
        { role: 'Category', field: 'FactBridgeFrom[DetailAxis]', measure: false },
        { role: 'Y', field: 'FactBridgeFrom[BridgeMetricQuoted]', measure: true },
      ],
      { modelPath: modelDefn },
    );
    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('BRIDGE_BLOCKED_AXIS');
  });

  it('fails closed when auto-resolution sees multiple sibling semantic models', () => {
    mkdirSync(path.join(tmp, 'OtherModel.SemanticModel', 'definition', 'tables'), {
      recursive: true,
    });
    writeFileSync(
      path.join(tmp, 'OtherModel.SemanticModel', 'definition', 'database.tmdl'),
      'database\n',
      'utf8',
    );
    visualAdd(defn, PAGE, { visualType: 'card', name: 'v1' });

    const report = validateVisualBindingPlan(defn, PAGE, 'v1', [
      { role: 'Values', field: 'MyFact[MyAmount]', measure: true },
    ]);

    expect(report.status).toBe('blocked');
    expect(report.findings.map((f) => f.code)).toContain('MODEL_AMBIGUOUS');
  });
});

function visualJson(name: string): string {
  return readFileSync(path.join(defn, 'pages', PAGE, 'visuals', name, 'visual.json'), 'utf8');
}

function writeModel(definitionPath: string): void {
  const tablesDir = path.join(definitionPath, 'tables');
  mkdirSync(tablesDir, { recursive: true });
  writeFileSync(path.join(definitionPath, 'database.tmdl'), 'database\n', 'utf8');
  writeFileSync(path.join(definitionPath, 'model.tmdl'), 'model Model\n', 'utf8');
  writeFileSync(
    path.join(tablesDir, 'MyFact.tmdl'),
    [
      'table MyFact',
      '\tcolumn MyDimKey',
      '\t\tdataType: int64',
      '\t\tsummarizeBy: none',
      '',
      '\tcolumn MyValue',
      '\t\tdataType: decimal',
      '\t\tsummarizeBy: sum',
      '',
      '\tmeasure MyAmount = SUM(MyFact[MyValue])',
      '\t\tformatString: #,##0',
      '',
      '\tmeasure MyProxyTarget = [MyAmount] * 0.15',
      '\t\tformatString: #,##0',
      '',
      '\t/// Proxy: user-approved. Source: user supplied formula. Replace when real source data is available.',
      '\tmeasure MyApprovedTarget = [MyAmount] * 0.15',
      '\t\tformatString: #,##0',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    path.join(tablesDir, 'MyDim.tmdl'),
    [
      'table MyDim',
      '\tcolumn MyDimKey',
      '\t\tdataType: int64',
      '\t\tsummarizeBy: none',
      '',
      '\tcolumn MyCategory',
      '\t\tdataType: string',
      '\t\tsummarizeBy: none',
      '',
      '\tmeasure MyDimMetric = COUNT(MyDim[MyDimKey])',
      '\t\tformatString: #,##0',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    path.join(tablesDir, 'MyActuals.tmdl'),
    [
      'table MyActuals',
      '\tcolumn MyCategory',
      '\t\tdataType: string',
      '\t\tsummarizeBy: none',
      '',
      '\tcolumn MySubcategory',
      '\t\tdataType: string',
      '\t\tsummarizeBy: none',
      '',
      '\tcolumn MyActualValue',
      '\t\tdataType: decimal',
      '\t\tsummarizeBy: sum',
      '',
      '\tmeasure MyActual = SUM(MyActuals[MyActualValue])',
      '\t\tformatString: #,##0',
      '',
      '\tmeasure MyTarget =',
      '\t\tCALCULATE(',
      '\t\t\tSUM(MyTargets[MyTargetValue]),',
      '\t\t\tTREATAS(VALUES(MyActuals[MyCategory]), MyTargets[MyCategory])',
      '\t\t)',
      '\t\tformatString: #,##0',
      '',
      '\tmeasure MyVariance = [MyActual] - [MyTarget]',
      '\t\tformatString: #,##0',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    path.join(tablesDir, 'MyTargets.tmdl'),
    [
      'table MyTargets',
      '\tcolumn MyCategory',
      '\t\tdataType: string',
      '\t\tsummarizeBy: none',
      '',
      '\tcolumn MyTargetValue',
      '\t\tdataType: decimal',
      '\t\tsummarizeBy: sum',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    path.join(tablesDir, 'MyOtherDim.tmdl'),
    [
      'table MyOtherDim',
      '\tcolumn MyCategory',
      '\t\tdataType: string',
      '\t\tsummarizeBy: none',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    path.join(tablesDir, 'FactBridgeFrom.tmdl'),
    [
      'table FactBridgeFrom',
      '\tcolumn SharedAxis',
      '\t\tdataType: string',
      '\t\tsummarizeBy: none',
      '',
      '\tcolumn DetailAxis',
      '\t\tdataType: string',
      '\t\tsummarizeBy: none',
      '',
      '\tcolumn ValueMetric',
      '\t\tdataType: decimal',
      '\t\tsummarizeBy: sum',
      '',
      '\tmeasure BridgeMetric =',
      '\t\tCALCULATE(',
      '\t\t\tSUM(FactBridgeTo[PlanMetric]),',
      '\t\t\tTREATAS(VALUES(FactBridgeFrom[SharedAxis]), FactBridgeTo[SharedAxis])',
      '\t\t)',
      '\t\tformatString: #,##0',
      '\t\tannotation pbi_bridge_from = FactBridgeFrom',
      '\t\tannotation pbi_bridge_to = FactBridgeTo',
      '\t\tannotation pbi_bridge_via = TREATAS',
      '\t\tannotation pbi_bridge_covers = "[\\"FactBridgeFrom[SharedAxis]\\"]"',
      '',
      '\tmeasure BridgeMetricSimple = SUM(FactBridgeFrom[ValueMetric])',
      '\t\tformatString: #,##0',
      '\t\tannotation pbi_bridge_from = FactBridgeFrom',
      '\t\tannotation pbi_bridge_to = FactBridgeTo',
      '\t\tannotation pbi_bridge_via = TREATAS',
      '\t\tannotation pbi_bridge_covers = "[\\"FactBridgeFrom[SharedAxis]\\"]"',
      '',
      '\tmeasure BridgeMetricQuoted = SUM(FactBridgeFrom[ValueMetric])',
      '\t\tformatString: #,##0',
      '\t\tannotation pbi_bridge_from = "FactBridgeFrom"',
      '\t\tannotation pbi_bridge_to = "FactBridgeTo"',
      '\t\tannotation pbi_bridge_via = "TREATAS"',
      '\t\tannotation pbi_bridge_covers = "[\\"FactBridgeFrom[SharedAxis]\\"]"',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    path.join(tablesDir, 'FactBridgeTo.tmdl'),
    [
      'table FactBridgeTo',
      '\tcolumn SharedAxis',
      '\t\tdataType: string',
      '\t\tsummarizeBy: none',
      '',
      '\tcolumn PlanMetric',
      '\t\tdataType: decimal',
      '\t\tsummarizeBy: sum',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    path.join(tablesDir, 'DimShared.tmdl'),
    [
      'table DimShared',
      '\tcolumn SharedAxis',
      '\t\tdataType: string',
      '\t\tsummarizeBy: none',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    path.join(tablesDir, 'DimOther.tmdl'),
    [
      'table DimOther',
      '\tcolumn SharedAxis',
      '\t\tdataType: string',
      '\t\tsummarizeBy: none',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    path.join(definitionPath, 'relationships.tmdl'),
    [
      'relationship rel_fact_dim',
      '\tfromColumn: MyFact.MyDimKey',
      '\ttoColumn: MyDim.MyDimKey',
      '',
      'relationship rel_bridge_dim_shared',
      '\tfromColumn: FactBridgeFrom.SharedAxis',
      '\ttoColumn: DimShared.SharedAxis',
      '',
    ].join('\n'),
    'utf8',
  );
}
