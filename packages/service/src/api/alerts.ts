/**
 * Alert rules REST endpoints.
 *
 *   POST   /wallets/:id/alerts        Create a rule scoped to this wallet
 *   GET    /wallets/:id/alerts        List rules for this wallet
 *   GET    /alerts                    List all rules owned by caller
 *   GET    /alerts/:id                Get one rule
 *   PATCH  /alerts/:id                Update enabled/severity/label/config
 *   DELETE /alerts/:id                Delete a rule
 *
 * Owner-scoped (M4): caller's apiKeyHash must own the rule (and, for
 * wallet-scoped reads, the wallet via api_key_grants).
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, validate } from './middleware.js';
import { getApiKeyGrant } from '../db/database.js';
import {
  createRule,
  listRulesForOwner,
  getRule,
  updateRule,
  deleteRule,
  type AlertKind,
} from '../events/alert-rules.js';

const CreateRuleSchema = z.object({
  kind: z.enum(['spend_threshold', 'unusual_recipient', 'key_export_warning', 'balance_low']),
  config: z.record(z.string(), z.any()),
  severity: z.enum(['info', 'warn', 'critical']).optional(),
  label: z.string().optional(),
});

const UpdateRuleSchema = z.object({
  enabled: z.boolean().optional(),
  severity: z.enum(['info', 'warn', 'critical']).optional(),
  label: z.string().optional(),
  config: z.record(z.string(), z.any()).optional(),
});

function param(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] || '';
  return val || '';
}

function requireAuthMode(req: any, res: any): boolean {
  if (req.apiKeyHash == null) {
    res.status(400).json({
      error: 'Alert operations require authenticated mode (set API_KEY)',
      code: 'alerts_require_auth',
    });
    return false;
  }
  return true;
}

function ownerKey(req: any): string {
  return req.apiKeyHash as string;
}

function assertOwnsWalletForAlerts(req: any, res: any, walletId: string): boolean {
  // Same logic as server.ts:assertOwnsWallet but local to avoid circular import.
  const grant = getApiKeyGrant(req.apiKeyHash!);
  if (!grant || grant.walletId !== walletId) {
    res.status(403).json({
      error: 'API key does not own this wallet',
      code: 'wallet_not_owned',
    });
    return false;
  }
  return true;
}

export function registerAlertRoutes(app: Router): void {
  /**
   * POST /wallets/:id/alerts — create a wallet-scoped rule
   */
  app.post('/wallets/:id/alerts', authMiddleware, validate(CreateRuleSchema), (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const walletId = param(req.params.id);
    if (!assertOwnsWalletForAlerts(req, res, walletId)) return;
    try {
      const rule = createRule({
        apiKeyHash: ownerKey(req),
        walletId,
        kind: req.body.kind as AlertKind,
        config: req.body.config,
        severity: req.body.severity,
        label: req.body.label,
      });
      res.status(201).json(rule);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * GET /wallets/:id/alerts — list this wallet's rules (owner only)
   */
  app.get('/wallets/:id/alerts', authMiddleware, (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const walletId = param(req.params.id);
    if (!assertOwnsWalletForAlerts(req, res, walletId)) return;
    const all = listRulesForOwner(ownerKey(req));
    const rules = all.filter((r) => r.walletId === walletId || r.walletId === null);
    res.json({ rules, count: rules.length });
  });

  /**
   * GET /alerts — list all rules owned by caller (any wallet)
   */
  app.get('/alerts', authMiddleware, (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const rules = listRulesForOwner(ownerKey(req));
    res.json({ rules, count: rules.length });
  });

  /**
   * GET /alerts/:id
   */
  app.get('/alerts/:id', authMiddleware, (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const rule = getRule(param(req.params.id));
    if (!rule || rule.apiKeyHash !== ownerKey(req)) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    res.json(rule);
  });

  /**
   * PATCH /alerts/:id
   */
  app.patch('/alerts/:id', authMiddleware, validate(UpdateRuleSchema), (req, res) => {
    if (!requireAuthMode(req, res)) return;
    try {
      const updated = updateRule(param(req.params.id), ownerKey(req), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Rule not found' });
        return;
      }
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * DELETE /alerts/:id
   */
  app.delete('/alerts/:id', authMiddleware, (req, res) => {
    if (!requireAuthMode(req, res)) return;
    const ok = deleteRule(param(req.params.id), ownerKey(req));
    if (!ok) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    res.status(204).end();
  });
}
