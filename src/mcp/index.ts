#!/usr/bin/env node

/**
 * MCP Server entry point — runs via stdio transport.
 * 
 * Usage:
 *   npx tsx src/mcp/index.ts
 * 
 * Or configure in Claude/Cursor MCP settings:
 *   {
 *     "mcpServers": {
 *       "ritual-agent-wallet": {
 *         "command": "npx",
 *         "args": ["tsx", "/path/to/ritual-agent-wallet/src/mcp/index.ts"],
 *         "env": {
 *           "ENCRYPTION_KEY": "your-32-byte-hex-key",
 *           "DATABASE_PATH": "/path/to/data/wallets.db"
 *         }
 *       }
 *     }
 *   }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-server.js';
import { initDatabase } from '../db/database.js';
import { loadConfig } from '../core/config.js';
import path from 'path';
import fs from 'fs';

// Validate config (fail-fast on missing/zero ENCRYPTION_KEY etc.)
const config = loadConfig();

// Initialize database
const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
initDatabase(config.databasePath);

// Create and connect MCP server
const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[ritual-agent-wallet] MCP server running on stdio');
