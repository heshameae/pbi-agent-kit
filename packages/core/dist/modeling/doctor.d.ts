import type { BridgeIntent, ModelDoctorReport, RegulatedEnterprisePolicyEvidence, TMDLModel } from './types.js';
export interface ModelDoctorOptions {
    readonly bridgeIntent?: BridgeIntent;
    readonly regulatedEnterprise?: boolean;
    readonly policyEvidence?: RegulatedEnterprisePolicyEvidence;
}
export declare function modelDoctorFromFolder(definitionPath: string, options?: ModelDoctorOptions): ModelDoctorReport;
export declare function modelDoctor(model: TMDLModel, options?: ModelDoctorOptions): ModelDoctorReport;
