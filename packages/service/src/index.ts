#!/usr/bin/env node
import { createApp } from './api/server.js';
import { initDatabase } from './db/database.js';
import { loadConfig } from '@ritkey/core';
import path from 'path';
import fs from 'fs';

// ============================================================
// Startup
// ============================================================

async function main() {
  const config = loadConfig();

  console.log(`
  ┌─────────────────────────────────────────────────┐
  │                                                 │
  │   ⬡  Ritual Agent Wallet                       │
  │   MPC Wallet Service for AI Agents              │
  │                                                 │
  │   Chain:  Ritual (ID 1979)                      │
  │   Auth:   ${(config.openMode ? 'OPEN MODE (no auth)' : 'API key required').padEnd(35)}│
  │                                                 │
  └─────────────────────────────────────────────────┘
  `);

  // Ensure data directory exists
  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`📁 Created data directory: ${dbDir}`);
  }

  // Initialize database
  initDatabase(config.databasePath);
  console.log(`🗄️  Database initialized: ${config.databasePath}`);

  // Create and start Express app
  const app = createApp();

  app.listen(config.port, () => {
    console.log(`
  🚀 Server running:
     API:        http://localhost:${config.port}
     Dashboard:  http://localhost:${config.port}/dashboard
     Health:     http://localhost:${config.port}/health

  📡 MCP Server:
     Run separately: npm run mcp
    `);
  });
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});
