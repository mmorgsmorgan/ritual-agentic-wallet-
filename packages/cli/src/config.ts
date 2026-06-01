/**
 * CLI config loading.
 *
 * Resolution order (first hit wins):
 *   1. CLI flags  (--api-url, --api-key)        — handled by commander
 *   2. Env vars   (RITKEY_API_URL, RITKEY_API_KEY)
 *   3. Config file ~/.ritkey/config.json
 *
 * `ritkey login` writes the config file.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ResolvedConfig {
  baseUrl: string;
  apiKey?: string;
  source: 'flags' | 'env' | 'file' | 'default';
}

interface FileConfig {
  baseUrl?: string;
  apiKey?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:3000';

export function configFilePath(): string {
  return path.join(os.homedir(), '.ritkey', 'config.json');
}

export async function readConfigFile(): Promise<FileConfig | null> {
  try {
    const raw = await fs.readFile(configFilePath(), 'utf8');
    return JSON.parse(raw) as FileConfig;
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeConfigFile(cfg: FileConfig): Promise<void> {
  const p = configFilePath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

export async function resolveConfig(opts: {
  apiUrl?: string;
  apiKey?: string;
}): Promise<ResolvedConfig> {
  if (opts.apiUrl || opts.apiKey) {
    return {
      baseUrl: opts.apiUrl ?? process.env.RITKEY_API_URL ?? DEFAULT_BASE_URL,
      apiKey: opts.apiKey ?? process.env.RITKEY_API_KEY,
      source: 'flags',
    };
  }
  if (process.env.RITKEY_API_URL || process.env.RITKEY_API_KEY) {
    return {
      baseUrl: process.env.RITKEY_API_URL ?? DEFAULT_BASE_URL,
      apiKey: process.env.RITKEY_API_KEY,
      source: 'env',
    };
  }
  const file = await readConfigFile();
  if (file?.baseUrl || file?.apiKey) {
    return {
      baseUrl: file.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: file.apiKey,
      source: 'file',
    };
  }
  return {
    baseUrl: DEFAULT_BASE_URL,
    source: 'default',
  };
}
