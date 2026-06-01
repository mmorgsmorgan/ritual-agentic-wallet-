/**
 * Auth / config commands.
 *
 *   ritkey login --url URL --key KEY        write ~/.ritkey/config.json
 *   ritkey logout                            remove ~/.ritkey/config.json
 *   ritkey whoami                            print effective config
 */
import { promises as fs } from 'node:fs';
import type { Command } from 'commander';
import {
  configFilePath,
  readConfigFile,
  resolveConfig,
  writeConfigFile,
} from '../config.js';
import { c, ok, error } from '../output.js';

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Save Ritkey service URL + API key to ~/.ritkey/config.json')
    .option('-u, --url <url>', 'Service base URL', 'http://localhost:3000')
    .requiredOption('-k, --key <apiKey>', 'API key')
    .action(async (opts: { url: string; key: string }) => {
      await writeConfigFile({ baseUrl: opts.url, apiKey: opts.key });
      ok(`Saved config to ${configFilePath()}`);
      console.log(`  baseUrl: ${opts.url}`);
    });

  program
    .command('logout')
    .description('Remove ~/.ritkey/config.json')
    .action(async () => {
      try {
        await fs.unlink(configFilePath());
        ok('Logged out.');
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          console.log(c.dim('Already logged out.'));
        } else {
          error(`logout: ${err.message}`);
          process.exit(1);
        }
      }
    });

  program
    .command('whoami')
    .description('Show resolved config (env → flags → config file)')
    .action(async function (this: Command) {
      const cfg = await resolveConfig(this.optsWithGlobals());
      console.log(`baseUrl:  ${cfg.baseUrl}`);
      console.log(`apiKey:   ${cfg.apiKey ? c.green('set') : c.dim('not set')}`);
      console.log(`source:   ${cfg.source}`);
      if (cfg.source === 'file') {
        console.log(c.dim(`           ${configFilePath()}`));
      }
    });
}
