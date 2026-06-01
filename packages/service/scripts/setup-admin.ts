#!/usr/bin/env node
/**
 * Setup script: Create the first admin user
 *
 * Usage: npm run setup-admin
 */

import { generateApiKeyPair } from '@ritkey/core';
import { initDatabase } from '../src/db/database.js';
import { initUserTables, createUser } from '../src/db/users.js';
import { loadConfig } from '@ritkey/core';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  console.log('🔧 Ritkey Admin Setup\n');

  // Load config
  const config = loadConfig();

  // Ensure data directory exists
  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Initialize database
  const db = initDatabase(config.databasePath);
  initUserTables(db);

  console.log('✓ Database initialized\n');

  // Get admin details
  const userName = await question('Admin username: ');
  const keyName = await question('API key name (e.g., "primary-key"): ');

  console.log('\n🔑 Generating API keypair...');
  const keyPair = generateApiKeyPair();

  // Create admin user
  const user = createUser(
    db,
    userName,
    'human',
    [{ keyName, publicKey: keyPair.publicKey }],
    [
      'wallet:create',
      'wallet:read',
      'wallet:send',
      'wallet:sign',
      'wallet:fund',
      'wallet:freeze',
      'wallet:archive',
      'admin:users',
      'admin:policies',
    ]
  );

  console.log('\n✅ Admin user created!\n');
  console.log('User ID:', user.id);
  console.log('Username:', user.userName);
  console.log('Type:', user.userType);
  console.log('\n📝 API Credentials (save these securely):');
  console.log('─────────────────────────────────────────');
  console.log('Public Key:', keyPair.publicKey);
  console.log('Private Key:', keyPair.privateKey);
  console.log('─────────────────────────────────────────');
  console.log('\n⚠️  IMPORTANT: Save the private key securely.');
  console.log('   It will NOT be shown again.\n');
  console.log('💡 Add to your .env:');
  console.log(`   ADMIN_PUBLIC_KEY=${keyPair.publicKey}`);
  console.log(`   ADMIN_PRIVATE_KEY='${keyPair.privateKey}'`);

  rl.close();
}

main().catch(err => {
  console.error('❌ Setup failed:', err.message);
  process.exit(1);
});
