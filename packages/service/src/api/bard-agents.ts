/**
 * BARD API Endpoint: Agent Wallet Creation
 *
 * POST /api/agents/:agentId/wallet
 *
 * Provisions a Ritkey MPC wallet for an agent.
 */

import express, { type Router } from 'express';
import { getOrCreateAgentWallet, getAgentWalletBalance, sendAgentTransaction } from '../integrations/bard-ritkey.js';
import { getDb } from '../db/database.js';

const router: Router = express.Router();

/**
 * POST /api/agents/:agentId/wallet
 * Create or retrieve agent's Ritkey wallet
 */
router.post('/:agentId/wallet', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { agentName } = req.body;

    if (!agentName) {
      res.status(400).json({ error: 'agentName is required' });
      return;
    }

    const db = getDb();

    // Ensure agent exists in database
    let agent = db.prepare('SELECT id, name FROM agents WHERE id = ?').get(agentId);

    if (!agent) {
      // Create agent record
      db.prepare(`
        INSERT INTO agents (id, name, created_at)
        VALUES (?, ?, datetime('now'))
      `).run(agentId, agentName);
    }

    // Get or create wallet
    const wallet = await getOrCreateAgentWallet(db, agentId, agentName);

    res.json({
      success: true,
      walletAddress: wallet.address,
      walletId: wallet.walletId,
      ritkeyEnabled: true,
      funded: wallet.funded,
      message: `Ritkey wallet provisioned: ${wallet.address}`,
      agentShard: wallet.agentShard, // Agent needs this to sign transactions
    });
  } catch (err: any) {
    console.error('Failed to create agent wallet:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      ritkeyEnabled: false,
    });
  }
});

/**
 * GET /api/agents/:agentId/wallet/balance
 * Get agent wallet balance
 */
router.get('/:agentId/wallet/balance', async (req, res) => {
  try {
    const { agentId } = req.params;
    const db = getDb();

    const balance = await getAgentWalletBalance(agentId, db);

    if (!balance) {
      res.status(404).json({ error: 'Agent does not have a wallet' });
      return;
    }

    res.json({
      success: true,
      balance: {
        native: balance.native,
        escrow: balance.escrow,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/agents/:agentId/wallet/send
 * Send transaction from agent wallet
 */
router.post('/:agentId/wallet/send', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { to, value, data } = req.body;

    if (!to || !value) {
      res.status(400).json({ error: 'to and value are required' });
      return;
    }

    const db = getDb();
    const result = await sendAgentTransaction(agentId, db, { to, value, data });

    res.json({
      success: true,
      hash: result.hash,
      explorer: result.explorer,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
