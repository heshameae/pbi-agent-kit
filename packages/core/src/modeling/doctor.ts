import { runBPA } from './bpa.js';
import { buildGrainReport, validateBridge } from './grain.js';
import { checkRelationships } from './relationship-check.js';
import { parseTMDLFolder } from './tmdl-parser.js';
import type { BridgeIntent, ModelDoctorReport, Severity, TMDLModel } from './types.js';

export interface ModelDoctorOptions {
  readonly bridgeIntent?: BridgeIntent;
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

  return {
    modelPath: model.modelPath,
    passed: summary.errors === 0,
    summary,
    grain: grainWithBridge,
    bpa,
    relationships,
  };
}
