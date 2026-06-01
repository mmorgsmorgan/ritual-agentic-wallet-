/**
 * Wallet commands.
 *
 *   ritkey wallets                 list
 *   ritkey wallet <id>             show details
 *   ritkey wallet new [--label]    create
 *   ritkey wallet import <pk>      import
 *   ritkey wallet balance <id>     quick balance
 *   ritkey wallet send <id> --to ADDR --value 0.5 --agent-shard ...
 *   ritkey wallet export-key <id> --agent-shard ...
 *   ritkey wallet sweep <id> --to ADDR --agent-shard ...
 */
import type { Command } from 'commander';
import { makeClient } from '../client.js';
import { c, table, short, ok, error, errorFromSdk } from '../output.js';

interface GlobalOpts {
  apiUrl?: string;
  apiKey?: string;
}

function gopts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts;
}

export function registerWalletCommands(program: Command): void {
  // ── ritkey wallets ───────────────────────────────────────
  program
    .command('wallets')
    .description('List wallets owned by this API key')
    .action(async function (this: Command) {
      const client = await makeClient(gopts(this));
      try {
        const r = await client.wallets.list();
        if (r.count === 0) {
          console.log(c.dim('No wallets. Create one with: ritkey wallet new'));
          return;
        }
        console.log(
          table(
            r.wallets.map((w) => [
              short(w.id),
              w.address,
              w.label || c.dim('—'),
              w.status === 'active' ? c.green(w.status) : c.dim(w.status),
              w.createdAt.split('T')[0],
            ]),
            { headers: ['ID', 'Address', 'Label', 'Status', 'Created'] }
          )
        );
      } catch (err) {
        error(`list wallets: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  // ── ritkey wallet ──────────────────────────────────────────
  const wallet = program.command('wallet').description('Per-wallet commands');

  wallet
    .command('show <walletId>')
    .description('Show wallet details')
    .action(async function (this: Command, walletId: string) {
      const client = await makeClient(gopts(this));
      try {
        const [w, bal] = await Promise.all([
          client.wallets.get(walletId),
          client.wallets.balance(walletId).catch(() => null),
        ]);
        console.log(c.bold(`Wallet ${w.id}`));
        console.log(`  address: ${w.address}`);
        console.log(`  label:   ${w.label || c.dim('—')}`);
        console.log(`  status:  ${w.status}`);
        console.log(`  created: ${w.createdAt}`);
        if (bal) {
          console.log(`  native:  ${bal.native.formatted} ${bal.native.symbol}`);
          console.log(
            `  escrow:  ${bal.ritualWallet.formatted} RITUAL ${
              bal.ritualWallet.isLocked ? c.yellow('(locked)') : ''
            }`
          );
        } else {
          console.log(c.dim('  balance: (rpc unavailable)'));
        }
      } catch (err) {
        error(`show wallet: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  wallet
    .command('new')
    .description('Create a new threshold (Shamir 2-of-3) wallet')
    .option('-l, --label <label>', 'Human label')
    .action(async function (
      this: Command,
      opts: { label?: string }
    ) {
      const client = await makeClient(gopts(this));
      try {
        const w = await client.wallets.create({ label: opts.label });
        ok(`Wallet created: ${w.address}`);
        console.log();
        console.log(c.bold('SAVE THESE — they are shown only once:'));
        console.log(`  ${c.cyan('walletId    ')} ${w.walletId}`);
        console.log(`  ${c.cyan('address     ')} ${w.address}`);
        console.log(`  ${c.yellow('agentShard  ')} ${w.agentShard}`);
        console.log(`  ${c.yellow('backupShard ')} ${w.backupShard}`);
        console.log();
        console.log(
          c.dim(
            'You will need agentShard for every signing call. Store backupShard offline (cold storage).'
          )
        );
      } catch (err) {
        error(`create wallet: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  wallet
    .command('import <privateKey>')
    .description('Import an existing private key into Ritkey')
    .option('-l, --label <label>', 'Human label')
    .action(async function (
      this: Command,
      privateKey: string,
      opts: { label?: string }
    ) {
      const client = await makeClient(gopts(this));
      try {
        const w = await client.wallets.import_({ privateKey, label: opts.label });
        ok(`Wallet imported: ${w.address}`);
        console.log();
        console.log(c.bold('SAVE THESE — they are shown only once:'));
        console.log(`  ${c.cyan('walletId    ')} ${w.walletId}`);
        console.log(`  ${c.yellow('agentShard  ')} ${w.agentShard}`);
        console.log(`  ${c.yellow('backupShard ')} ${w.backupShard}`);
      } catch (err) {
        error(`import wallet: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  wallet
    .command('balance <walletId>')
    .description('Quick on-chain balance check')
    .action(async function (this: Command, walletId: string) {
      const client = await makeClient(gopts(this));
      try {
        const b = await client.wallets.balance(walletId);
        console.log(`${c.bold(b.address)}`);
        console.log(`  native: ${b.native.formatted} ${b.native.symbol}`);
        console.log(
          `  escrow: ${b.ritualWallet.formatted} RITUAL ${
            b.ritualWallet.isLocked ? c.yellow('(locked)') : ''
          }`
        );
      } catch (err) {
        error(`balance: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  wallet
    .command('send <walletId>')
    .description('Sign and broadcast a transaction')
    .requiredOption('--to <address>', 'Destination address')
    .requiredOption('--value <ritual>', 'Amount in RITUAL (decimal)')
    .requiredOption('--agent-shard <hex>', 'Your agent key shard')
    .option('--data <hex>', 'Calldata (default 0x)')
    .action(async function (
      this: Command,
      walletId: string,
      opts: { to: string; value: string; agentShard: string; data?: string }
    ) {
      const client = await makeClient(gopts(this));
      try {
        const tx = await client.wallets.send({
          walletId,
          agentShard: opts.agentShard,
          to: opts.to,
          value: opts.value,
          data: opts.data,
        });
        ok(`Sent ${opts.value} RITUAL`);
        console.log(`  hash:     ${tx.hash}`);
        console.log(`  explorer: ${tx.explorer}`);
      } catch (err) {
        error(`send: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  wallet
    .command('fund <walletId>')
    .description('Claim one-time faucet drip (1 per wallet, lifetime)')
    .action(async function (this: Command, walletId: string) {
      const client = await makeClient(gopts(this));
      try {
        const r = await client.wallets.fund(walletId);
        ok(`Funded ${r.amount} RITUAL`);
        console.log(`  hash: ${r.hash}`);
      } catch (err) {
        error(`fund: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  wallet
    .command('export-key <walletId>')
    .description(
      'Export the private key. WARNING: archives the wallet after export.'
    )
    .requiredOption('--agent-shard <hex>', 'Your agent key shard')
    .option('--backup-shard <hex>', 'Optional backup shard for full offline reconstruction')
    .action(async function (
      this: Command,
      walletId: string,
      opts: { agentShard: string; backupShard?: string }
    ) {
      const client = await makeClient(gopts(this));
      try {
        const r = await client.wallets.exportKey({
          walletId,
          agentShard: opts.agentShard,
          backupShard: opts.backupShard,
        });
        ok(`Exported — wallet is now ARCHIVED.`);
        console.log(`  address:    ${r.address}`);
        console.log(`  privateKey: ${c.yellow(r.privateKey)}`);
        console.log(
          c.dim(
            'Import this into MetaMask/Rabby. Sweep funds out first if you want to keep using this address.'
          )
        );
      } catch (err) {
        error(`export-key: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });

  wallet
    .command('sweep <walletId>')
    .description('Sweep all native RITUAL to an address, then archive the wallet')
    .requiredOption('--to <address>', 'Destination address for the sweep')
    .requiredOption('--agent-shard <hex>', 'Your agent key shard')
    .action(async function (
      this: Command,
      walletId: string,
      opts: { to: string; agentShard: string }
    ) {
      const client = await makeClient(gopts(this));
      try {
        const r = await client.wallets.sweepAndArchive({
          walletId,
          agentShard: opts.agentShard,
          sweepTo: opts.to,
        });
        ok(`Wallet archived ${r.swept ? `(swept to ${r.sweepTo})` : '(nothing to sweep)'}`);
        if (r.sweepTxHash) console.log(`  hash: ${r.sweepTxHash}`);
      } catch (err) {
        error(`sweep: ${errorFromSdk(err)}`);
        process.exit(1);
      }
    });
}
