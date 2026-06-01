/**
 * Event commands.
 *
 *   ritkey events                  list recent
 *   ritkey events --wallet <id>    filter by wallet
 *   ritkey events --type tx.sent   filter by type
 *   ritkey events watch            live tail
 */
import type { Command } from 'commander';
import type { EventType } from '@ritkey/sdk';
import { makeClient } from '../client.js';
import { c, table, short, error, errorFromSdk } from '../output.js';

interface GlobalOpts {
  apiUrl?: string;
  apiKey?: string;
}
function gopts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts;
}

function colorType(t: string): string {
  if (t.startsWith('alert.')) return c.red(t);
  if (t.startsWith('wallet.')) return c.cyan(t);
  if (t.startsWith('tx.')) return c.yellow(t);
  if (t.startsWith('key.')) return c.magenta(t);
  return t;
}

export function registerEventCommands(program: Command): void {
  const events = program.command('events').description('Wallet event stream');

  events
    .command('list', { isDefault: true })
    .description('List recent events (newest first)')
    .option('-w, --wallet <id>', 'Filter by wallet')
    .option('-t, --type <type>', 'Filter by event type')
    .option('-n, --limit <n>', 'Max results', '50')
    .action(async function (
      this: Command,
      opts: { wallet?: string; type?: string; limit: string }
    ) {
      const client = await makeClient(gopts(this));
      try {
        const r = await client.events.list({
          walletId: opts.wallet,
          type: opts.type as EventType | undefined,
          limit: Number(opts.limit),
        });
        if (r.length === 0) {
          console.log(c.dim('No events.'));
          return;
        }
        console.log(
          table(
            r.map((e) => [
              e.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z'),
              colorType(e.type),
              short(e.id, 8, 0),
              e.walletId ? short(e.walletId, 8, 0) : c.dim('—'),
            ]),
            { headers: ['Time', 'Type', 'Event', 'Wallet'] }
          )
        );
      } catch (err) {
        error(`list events: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  events
    .command('watch')
    .description('Live tail of new events (Ctrl-C to stop)')
    .option('-w, --wallet <id>', 'Filter by wallet')
    .option('-t, --types <types>', 'Comma-separated event types')
    .option('-i, --interval <ms>', 'Poll interval ms', '3000')
    .action(async function (
      this: Command,
      opts: { wallet?: string; types?: string; interval: string }
    ) {
      const client = await makeClient(gopts(this));
      const types = opts.types
        ? (opts.types.split(',').map((t) => t.trim()) as EventType[])
        : undefined;

      console.log(c.dim('Watching events… (Ctrl-C to stop)'));

      const stop = client.events.subscribe({
        types,
        walletId: opts.wallet,
        intervalMs: Number(opts.interval),
        onEvent: (e) => {
          const t = e.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
          console.log(`${c.dim(t)}  ${colorType(e.type)}  ${short(e.id, 8, 0)}`);
        },
        onError: (err) => error(`poll: ${errorFromSdk(err)}`),
      });

      process.on('SIGINT', () => {
        stop();
        console.log();
        console.log(c.dim('stopped.'));
        process.exit(0);
      });
    });
}
