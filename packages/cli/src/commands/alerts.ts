/**
 * Alert rule commands.
 *
 *   ritkey alerts                                     list
 *   ritkey alert new --wallet ID --kind spend_threshold --threshold 0.5
 *   ritkey alert new --wallet ID --kind unusual_recipient --whitelist 0xaaa,0xbbb
 *   ritkey alert new --wallet ID --kind key_export_warning
 *   ritkey alert new --wallet ID --kind balance_low --floor 0.1
 *   ritkey alert toggle <ruleId>
 *   ritkey alert rm <ruleId>
 */
import type { Command } from 'commander';
import type { AlertKind, AlertConfig } from '@ritkey/sdk';
import { makeClient } from '../client.js';
import { c, table, short, ok, error, errorFromSdk } from '../output.js';

interface GlobalOpts {
  apiUrl?: string;
  apiKey?: string;
}
function gopts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts;
}

function colorSeverity(s: string): string {
  if (s === 'critical') return c.red(s);
  if (s === 'warn') return c.yellow(s);
  return c.dim(s);
}

export function registerAlertCommands(program: Command): void {
  program
    .command('alerts')
    .description('List alert rules owned by this API key')
    .option('-w, --wallet <id>', 'Scope to a single wallet')
    .action(async function (this: Command, opts: { wallet?: string }) {
      const client = await makeClient(gopts(this));
      try {
        const r = opts.wallet
          ? await client.alerts.listForWallet(opts.wallet)
          : await client.alerts.list();
        if (r.count === 0) {
          console.log(c.dim('No alert rules. Create one with: ritkey alert new'));
          return;
        }
        console.log(
          table(
            r.rules.map((rule) => [
              short(rule.id, 8, 0),
              rule.kind,
              rule.walletId ? short(rule.walletId, 8, 0) : c.dim('all'),
              colorSeverity(rule.severity),
              rule.enabled ? c.green('on') : c.dim('off'),
              rule.label || c.dim('—'),
            ]),
            {
              headers: ['Rule', 'Kind', 'Wallet', 'Severity', 'State', 'Label'],
            }
          )
        );
      } catch (err) {
        error(`list alerts: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  const alert = program.command('alert').description('Per-rule commands');

  alert
    .command('new')
    .description('Create an alert rule')
    .requiredOption('-w, --wallet <id>', 'Wallet ID')
    .requiredOption(
      '-k, --kind <kind>',
      'Rule kind: spend_threshold | unusual_recipient | key_export_warning | balance_low'
    )
    .option('--threshold <ritual>', 'For spend_threshold: trigger above this amount')
    .option('--floor <ritual>', 'For balance_low: trigger below this amount')
    .option('--whitelist <addrs>', 'For unusual_recipient: comma-separated addresses')
    .option('-s, --severity <level>', 'info | warn | critical', 'warn')
    .option('-l, --label <text>', 'Human label')
    .action(async function (
      this: Command,
      opts: {
        wallet: string;
        kind: string;
        threshold?: string;
        floor?: string;
        whitelist?: string;
        severity: string;
        label?: string;
      }
    ) {
      const client = await makeClient(gopts(this));
      let config: AlertConfig;
      switch (opts.kind as AlertKind) {
        case 'spend_threshold':
          if (!opts.threshold) {
            error('--threshold required for spend_threshold');
            process.exit(1);
          }
          config = { thresholdRitual: opts.threshold };
          break;
        case 'balance_low':
          if (!opts.floor) {
            error('--floor required for balance_low');
            process.exit(1);
          }
          config = { floorRitual: opts.floor };
          break;
        case 'unusual_recipient':
          if (!opts.whitelist) {
            error('--whitelist required for unusual_recipient');
            process.exit(1);
          }
          config = {
            whitelist: opts.whitelist.split(',').map((s) => s.trim()),
          };
          break;
        case 'key_export_warning':
          config = {};
          break;
        default:
          error(`unknown kind: ${opts.kind}`);
          process.exit(1);
      }
      try {
        const rule = await client.alerts.create({
          walletId: opts.wallet,
          kind: opts.kind as AlertKind,
          config: config!,
          severity: opts.severity as 'info' | 'warn' | 'critical',
          label: opts.label,
        });
        ok(`Created alert rule ${rule.id} (${rule.kind})`);
      } catch (err) {
        error(`create alert: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  alert
    .command('toggle <ruleId>')
    .description('Flip a rule between enabled and disabled')
    .action(async function (this: Command, ruleId: string) {
      const client = await makeClient(gopts(this));
      try {
        const current = await client.alerts.get(ruleId);
        const updated = await client.alerts.update(ruleId, {
          enabled: !current.enabled,
        });
        ok(`Rule ${ruleId} is now ${updated.enabled ? 'enabled' : 'disabled'}`);
      } catch (err) {
        error(`toggle: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  alert
    .command('rm <ruleId>')
    .description('Delete an alert rule')
    .action(async function (this: Command, ruleId: string) {
      const client = await makeClient(gopts(this));
      try {
        await client.alerts.delete(ruleId);
        ok(`Deleted rule ${ruleId}`);
      } catch (err) {
        error(`delete: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });
}
