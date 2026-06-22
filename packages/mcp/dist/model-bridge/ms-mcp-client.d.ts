export interface MsMcpSpawnConfig {
    readonly command: string;
    readonly args: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly deferredError?: string;
}
export interface McpContentItem {
    readonly type: string;
    readonly text?: string;
    readonly resource?: {
        readonly uri?: string;
        readonly mimeType?: string;
        readonly text?: string;
    };
}
export interface McpToolResult {
    readonly content?: ReadonlyArray<McpContentItem>;
    readonly structuredContent?: unknown;
    readonly isError?: boolean;
}
export interface McpClientLike {
    callTool(params: {
        name: string;
        arguments?: Record<string, unknown>;
    }, resultSchema?: unknown, options?: {
        timeout?: number;
    }): Promise<McpToolResult>;
    close(): Promise<void>;
}
export declare const MS_MCP_CALL_TIMEOUT_MS = 30000;
export type ClientFactory = (config: MsMcpSpawnConfig, onClose: () => void) => Promise<McpClientLike>;
export declare const DEFAULT_MS_MCP_EXE_ARGS: readonly string[];
export declare function defaultVendoredExe(pluginRoot: string): string | undefined;
export declare function resolveSpawnConfig(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, findVendoredExe?: (pluginRoot: string) => string | undefined): MsMcpSpawnConfig;
export declare const defaultClientFactory: ClientFactory;
export declare class MsMcpClient {
    #private;
    constructor(factory: ClientFactory, config: MsMcpSpawnConfig);
    onReset(cb: () => void): void;
    get(): Promise<McpClientLike>;
    callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
    reset(): void;
}
export declare function getMsMcpClient(): MsMcpClient;
export declare function resetMsMcpClientSingleton(): void;
