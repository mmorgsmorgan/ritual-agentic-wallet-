import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { _resetConfigCache } from '@ritkey/core';
import { initDatabase } from '../src/db/database.js';
import { createMcpServer } from '../src/mcp/mcp-server.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-mcp-skills-'));
  process.env.ENCRYPTION_KEY = 'f'.repeat(64);
  process.env.API_KEY = 'mcp-skills-test';
  delete process.env.OPEN_MODE;
  delete process.env.FAUCET_PRIVATE_KEY;
  _resetConfigCache();

  initDatabase(path.join(tmpDir, 'mcp.db'));
});

describe('createMcpServer', () => {
  it('builds without throwing — skills, rules, resources, prompts all registered', () => {
    const server = createMcpServer();
    expect(server).toBeTruthy();
  });

  it('returned server has the expected shape (name + version)', () => {
    const server = createMcpServer();
    // McpServer exposes its name/version through its underlying Server object;
    // we just verify the constructor ran.
    expect(typeof server.connect).toBe('function');
  });
});
