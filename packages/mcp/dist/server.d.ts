#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ModelDriver } from './model-bridge/model-driver.js';
export interface BuildServerOptions {
    readonly surface?: 'modeling';
}
export declare function setModelDriverForTests(driver: ModelDriver | null): void;
export declare function buildServer(options?: BuildServerOptions): McpServer;
export declare function buildModelingServer(): McpServer;
