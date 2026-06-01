#!/usr/bin/env node
/**
 * MCP Server entry point — runs via stdio transport.
 *
 * Connects to a running @ritkey/service over HTTP via the @ritkey/sdk.
 * No local DB, no encryption key — those concerns belong to the service.
 *
 * Configure in Claude/Cursor MCP settings:
 *   {
 *     "mcpServers": {
 *       "ritual-agent-wallet": {
 *         "command": "node",
 *         "args": ["/path/to/ritkey/packages/mcp/dist/mcp/index.js"],
 *         "env": {
 *           "RITKEY_API_URL": "https://ritkey.example.com",
 *           "RITKEY_API_KEY": "your-api-key"
 *         }
 *       }
 *     }
 *   }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-server.js';

const apiUrl = process.env.RITKEY_API_URL ?? 'http://localhost:3000';

const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`[ritual-agent-wallet] MCP server running on stdio → ${apiUrl}`);
