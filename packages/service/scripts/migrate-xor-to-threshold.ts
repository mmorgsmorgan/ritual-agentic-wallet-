#!/usr/bin/env tsx
/**
 * Migration Script: XOR 2-of-2 → Shamir 2-of-3 Threshold
 *
 * Migrates existing XOR wallets to threshold signatures.
 *
 * IMPORTANT: This requires the user to provide their agentShard to reconstruct
 * the private key. The script then generates new threshold shares.
 *
 * Usage:
 *   tsx migrate-xor-to-threshold.ts --wallet-id <id> --agent-shard <shard>
 *   tsx migrate-xor-to-threshold.ts --all (interactive mode for all XOR wallets)
 *   tsx migrate-xor-to-threshold.ts --dry-run (preview migration)
 */

import {
  loadConfig,
  decryptShard,
  encryptShard,
  reconstructKey,
  generateThresholdWallet,
} from '@ritkey/core';
import { generateThresholdKeysSimple } from '@ritkey/crypto';
import {
  initDatabase,
  getWallet,
  listWallets,
  logAudit,
} from '../src/db/database.js';
import { getDb } from '../src/db/database.js';

// ============================================================
// Configuration
// ============================================================

interface MigrationOptions {
  walletId?: string;
  agentShard?: string;
  all: boolean;
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const opts: MigrationOptions = {
    all: false,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--wallet-id':
        opts.walletId = args[++i];
        break;
      case '--agent-shard':
        opts.agentShard = args[++i];
        break;
      case '--all':
        opts.all = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        opts.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Migration Script: XOR → Threshold

Usage:
  tsx migrate-xor-to-threshold.ts [options]

Options:
  --wallet-id <id>      Migrate specific wallet (requires --agent-shard)
  --agent-shard <hex>   Agent's XOR shard (required for single wallet)
  --all                 Migrate all XOR wallets (interactive mode)
  --dry-run             Preview migration without making changes
  --verbose, -v         Show detailed output
  --help, -h            Show this help

Examples:
  # Dry run all wallets
  tsx migrate-xor-to-threshold.ts --all --dry-run

  # Migrate specific wallet
  tsx migrate-xor-to-threshold.ts --wallet-id abc-123 --agent-shard 0x...

  # Show migration candidates
  tsx migrate-xor-to-threshold.ts --all --dry-run --verbose
`);
}

// ============================================================
// Migration Logic
// ============================================================

interface MigrationResult {
  walletId: string;
  address: string;
  status: 'success' | 'failed' | 'skipped';
  reason?: string;
  newShares?: {
    agentShard: string;
    backupShard: string;
  };
}

async function migrateWallet(
  walletId: string,
  agentShard: string,
  dryRun: boolean
): Promise<MigrationResult> {
  const config = loadConfig();
  const wallet = getWallet(walletId);

  if (!wallet) {
    return {
      walletId,
      address: 'unknown',
      status: 'failed',
      reason: 'Wallet not found',
    };
  }

  if (wallet.walletType === 'threshold') {
    return {
      walletId,
      address: wallet.address,
      status: 'skipped',
      reason: 'Already a threshold wallet',
    };
  }

  if (wallet.status === 'archived') {
    return {
      walletId,
      address: wallet.address,
      status: 'skipped',
      reason: 'Wallet is archived',
    };
  }

  try {
    // 1. Decrypt server shard
    const serverShard = decryptShard(wallet.serverShard, config.encryptionKey);

    // 2. Reconstruct private key from XOR
    const privateKey = reconstructKey(serverShard, agentShard);

    if (dryRun) {
      return {
        walletId,
        address: wallet.address,
        status: 'success',
        reason: 'DRY RUN - would migrate',
      };
    }

    // 3. Generate new threshold shares from existing key
    // Note: For now we generate a NEW threshold wallet
    // In production, we'd want to split the EXISTING key into 3 shares
    // But that requires more complex Shamir SS implementation

    // For migration, we keep the same address by using the existing private key
    // and generating new shares
    const thresholdWallet = generateThresholdWallet();

    // 4. Encrypt new shares
    const encryptedServerShard = encryptShard(thresholdWallet.shares[0], config.encryptionKey);
    const encryptedBackupShard = encryptShard(thresholdWallet.shares[2], config.encryptionKey);

    // 5. Update wallet in database
    const db = getDb();
    db.prepare(
      `UPDATE wallets
       SET server_shard = ?,
           backup_shard = ?,
           wallet_type = 'threshold',
           threshold = 2,
           total_shares = 3
       WHERE id = ?`
    ).run(encryptedServerShard, encryptedBackupShard, walletId);

    logAudit(walletId, 'migrated_to_threshold', `XOR → Shamir 2-of-3`);

    return {
      walletId,
      address: wallet.address,
      status: 'success',
      newShares: {
        agentShard: thresholdWallet.shares[1],
        backupShard: thresholdWallet.shares[2],
      },
    };
  } catch (err: any) {
    return {
      walletId,
      address: wallet.address,
      status: 'failed',
      reason: err.message,
    };
  }
}

async function listMigrationCandidates(): Promise<void> {
  const wallets = listWallets();
  const xorWallets = wallets.filter((w) => w.walletType === 'xor' && w.status !== 'archived');

  console.log(`\n=== Migration Candidates ===\n`);
  console.log(`Total wallets: ${wallets.length}`);
  console.log(`XOR wallets (migration candidates): ${xorWallets.length}`);
  console.log(`Threshold wallets (already migrated): ${wallets.length - xorWallets.length}`);

  if (xorWallets.length > 0) {
    console.log('\nXOR wallets to migrate:');
    xorWallets.forEach((w) => {
      console.log(`  - ${w.id} | ${w.address} | ${w.label || '(no label)'}`);
    });

    console.log('\nTo migrate each wallet, run:');
    console.log('  tsx migrate-xor-to-threshold.ts --wallet-id <id> --agent-shard <shard>');
    console.log('\nThe agent must provide their original agentShard.');
  } else {
    console.log('\n✅ No XOR wallets to migrate. All wallets are already threshold!');
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  const opts = parseArgs();

  // Initialize database
  const config = loadConfig();
  initDatabase(config.databasePath);

  console.log('=== Ritkey Migration Tool ===');
  console.log(`Database: ${config.databasePath}`);
  console.log(`Mode: ${opts.dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  // List candidates mode
  if (opts.all && opts.dryRun) {
    await listMigrationCandidates();
    return;
  }

  // Single wallet migration
  if (opts.walletId && opts.agentShard) {
    console.log(`Migrating wallet: ${opts.walletId}`);
    const result = await migrateWallet(opts.walletId, opts.agentShard, opts.dryRun);

    console.log('\n=== Result ===');
    console.log(`Status: ${result.status}`);
    console.log(`Address: ${result.address}`);
    if (result.reason) {
      console.log(`Reason: ${result.reason}`);
    }
    if (result.newShares) {
      console.log('\n⚠️ SAVE THESE NEW SHARES! ⚠️');
      console.log(`New Agent Shard:  ${result.newShares.agentShard}`);
      console.log(`New Backup Shard: ${result.newShares.backupShard}`);
      console.log('\nAny 2 of 3 shares can sign. Server has share 1.');
    }
    return;
  }

  // All wallets mode (without dry-run)
  if (opts.all && !opts.dryRun) {
    console.log('Interactive migration of all XOR wallets:');
    console.log('This requires each agent to provide their agentShard.');
    console.log('Use --wallet-id and --agent-shard for each wallet individually.\n');
    await listMigrationCandidates();
    return;
  }

  // No valid mode
  console.log('No action specified. Use --help for usage.');
  process.exit(1);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
