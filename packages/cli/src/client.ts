/**
 * SDK client factory — wraps RitkeyClient with global config resolution.
 *
 * Every command receives the apiUrl/apiKey via commander's `program.opts()`,
 * which are merged with env + config file by resolveConfig.
 */
import { RitkeyClient } from '@ritkey/sdk';
import { resolveConfig } from './config.js';

export async function makeClient(opts: {
  apiUrl?: string;
  apiKey?: string;
}): Promise<RitkeyClient> {
  const cfg = await resolveConfig(opts);
  return new RitkeyClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
}
