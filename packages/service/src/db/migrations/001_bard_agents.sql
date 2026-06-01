-- BARD Agent Wallet Integration Schema
-- Adds Ritkey wallet fields to agents table

-- Add Ritkey wallet columns to agents table
ALTER TABLE agents ADD COLUMN ritkey_wallet_id TEXT;
ALTER TABLE agents ADD COLUMN ritkey_address TEXT;
ALTER TABLE agents ADD COLUMN ritkey_agent_shard TEXT;
ALTER TABLE agents ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

-- Create index for wallet lookups
CREATE INDEX IF NOT EXISTS idx_agents_ritkey_wallet ON agents(ritkey_wallet_id);
CREATE INDEX IF NOT EXISTS idx_agents_ritkey_address ON agents(ritkey_address);

-- If agents table doesn't exist, create it
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ritkey_wallet_id TEXT,
  ritkey_address TEXT,
  ritkey_agent_shard TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
