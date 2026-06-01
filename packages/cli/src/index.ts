/**
 * @ritkey/cli — operator tool for Ritkey.
 *
 *   ritkey login --url ... --key ...
 *   ritkey wallets
 *   ritkey wallet new
 *   ritkey events watch
 *   ritkey alerts
 *   ritkey webhooks
 */
import { Command } from 'commander';
import { registerAuthCommands } from './commands/login.js';
import { registerWalletCommands } from './commands/wallets.js';
import { registerEventCommands } from './commands/events.js';
import { registerAlertCommands } from './commands/alerts.js';
import { registerWebhookCommands } from './commands/webhooks.js';

const program = new Command();

program
  .name('ritkey')
  .description('Ritkey CLI — wallets, events, alerts, webhooks')
  .version('0.1.0')
  .option(
    '--api-url <url>',
    'Override service base URL (env: RITKEY_API_URL)'
  )
  .option('--api-key <key>', 'Override API key (env: RITKEY_API_KEY)');

registerAuthCommands(program);
registerWalletCommands(program);
registerEventCommands(program);
registerAlertCommands(program);
registerWebhookCommands(program);

await program.parseAsync(process.argv);
