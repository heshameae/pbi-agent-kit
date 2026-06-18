import type { TMDLModel, TMDLRelationship, TMDLRole, TMDLTable } from './types.js';
export declare function parseTMDLFolder(definitionPath: string): TMDLModel;
export declare function parseTableFile(content: string): TMDLTable | null;
export declare function parseRelationshipsFile(content: string): TMDLRelationship[];
export declare function parseRoleFile(content: string): TMDLRole | null;
