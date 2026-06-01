/**
 * Webhook subscription commands.
 *
 *   ritkey webhooks                          list
 *   ritkey webhook new --url URL [--events tx.sent,alert.*]
 *   ritkey webhook test <id>
 *   ritkey webhook rm <id>
 */
import type { Command } from 'commander';
import type { EventType } from '@ritkey/sdk';
import { makeClient } from '../client.js';
import { c, table, short, ok, error, errorFromSdk } from '../output.js';

interface GlobalOpts {
  apiUrl?: string;
  apiKey?: string;
}
function gopts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts;
}

export function registerWebhookCommands(program: Command): void {
  program
    .command('webhooks')
    .description('List webhook subscriptions')
    .action(async function (this: Command) {
      const client = await makeClient(gopts(this));
      try {
        const r = await client.webhooks.list();
        if (r.count === 0) {
          console.log(c.dim('No webhooks. Create one with: ritkey webhook new --url ...'));
          return;
        }
        console.log(
          table(
            r.subscriptions.map((s) => [
              short(s.id, 8, 0),
              s.url,
              s.eventsFilter.join(','),
              s.status === 'active' ? c.green(s.status) : c.dim(s.status),
              s.lastDeliveryAt ?? c.dim('—'),
            ]),
            { headers: ['ID', 'URL', 'Filter', 'Status', 'Last delivery'] }
          )
        );
      } catch (err) {
        error(`list webhooks: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  const webhook = program.command('webhook').description('Per-subscription commands');

  webhook
    .command('new')
    .description('Register a webhook subscription')
    .requiredOption('-u, --url <url>', 'HTTPS endpoint that will receive POST deliveries')
    .option('-e, --events <types>', 'Comma-separated event types (default: *)')
    .option('-l, --label <label>', 'Human label')
    .action(async function (
      this: Command,
      opts: { url: string; events?: string; label?: string }
    ) {
      const client = await makeClient(gopts(this));
      const events = opts.events
        ? (opts.events.split(',').map((s) => s.trim()) as (EventType | '*')[])
        : undefined;
      try {
        const w = await client.webhooks.create({
          url: opts.url,
          events,
          label: opts.label,
        });
        ok(`Webhook created: ${w.id}`);
        console.log();
        console.log(c.bold('SAVE THIS — shown only once:'));
        console.log(`  ${c.yellow('secret      ')} ${w.secret}`);
        console.log();
        console.log(
          c.dim(
            'Use it to verify HMAC signatures: SDK provides verifyWebhook(rawBody, headers["ritkey-signature"], secret).'
          )
        );
      } catch (err) {
        error(`create webhook: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  webhook
    .command('test <webhookId>')
    .description('Send a webhook.test event to the subscription URL')
    .action(async function (this: Command, webhookId: string) {
      const client = await makeClient(gopts(this));
      try {
        await client.webhooks.test(webhookId);
        ok(`Test event enqueued for ${webhookId}`);
      } catch (err) {
        error(`test webhook: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  webhook
    .command('rm <webhookId>')
    .description('Delete a webhook subscription')
    .action(async function (this: Command, webhookId: string) {
      const client = await makeClient(gopts(this));
      try {
        await client.webhooks.delete(webhookId);
        ok(`Deleted ${webhookId}`);
      } catch (err) {
        error(`delete webhook: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });
}
