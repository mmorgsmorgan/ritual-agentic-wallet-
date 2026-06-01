import express, { type Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import {
  createUser,
  listUsers,
  getUserPermissions,
  revokeApiKey,
  type Permission,
  type UserType,
} from '../db/users.js';
import { generateApiKeyPair } from '@ritkey/core';
import { requireAdmin } from './auth-middleware.js';

const router: Router = express.Router();

// ============================================================
// Schemas
// ============================================================

const CreateUserSchema = z.object({
  userName: z.string().min(1).max(100),
  userType: z.enum(['human', 'agent']),
  apiKeys: z.array(z.object({
    keyName: z.string().min(1).max(100),
  })).min(1).max(5),
  permissions: z.array(z.enum([
    'wallet:create',
    'wallet:read',
    'wallet:send',
    'wallet:sign',
    'wallet:fund',
    'wallet:freeze',
    'wallet:archive',
    'admin:users',
    'admin:policies',
  ])),
});

const RevokeApiKeySchema = z.object({
  apiKeyId: z.string().uuid(),
});

// ============================================================
// Routes
// ============================================================

/**
 * POST /users
 * Create a new user (human or agent) with API keys
 */
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = CreateUserSchema.parse(req.body);

    // Generate API keypairs
    const apiKeysWithKeys = body.apiKeys.map(key => {
      const keyPair = generateApiKeyPair();
      return {
        keyName: key.keyName,
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey, // Return to caller, never stored
      };
    });

    // Create user in DB (only stores public keys)
    const user = createUser(
      getDb(),
      body.userName,
      body.userType,
      apiKeysWithKeys.map(k => ({
        keyName: k.keyName,
        publicKey: k.publicKey,
      })),
      body.permissions
    );

    res.status(201).json({
      user: {
        id: user.id,
        userName: user.userName,
        userType: user.userType,
        status: user.status,
        createdAt: user.createdAt,
      },
      apiKeys: apiKeysWithKeys.map(k => ({
        keyName: k.keyName,
        publicKey: k.publicKey,
        privateKey: k.privateKey, // IMPORTANT: Save this, it's never shown again
      })),
      permissions: body.permissions,
      warning: 'Save the private keys securely. They will not be shown again.',
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Invalid request', details: err.errors });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /users
 * List all users
 */
router.get('/', requireAdmin, (req, res) => {
  try {
    const users = listUsers(getDb());
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /users/:id/permissions
 * Get user permissions
 */
router.get('/:id/permissions', requireAdmin, (req, res) => {
  try {
    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const permissions = getUserPermissions(getDb(), userId);
    res.json({ userId, permissions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /users/api-keys/revoke
 * Revoke an API key
 */
router.post('/api-keys/revoke', requireAdmin, (req, res) => {
  try {
    const body = RevokeApiKeySchema.parse(req.body);
    revokeApiKey(getDb(), body.apiKeyId);
    res.json({ success: true, apiKeyId: body.apiKeyId });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ error: 'Invalid request', details: err.errors });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /users/me
 * Get current authenticated user info
 */
router.get('/me', (req, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const permissions = getUserPermissions(getDb(), user.id);
  res.json({
    user: {
      id: user.id,
      userName: user.userName,
      userType: user.userType,
      status: user.status,
    },
    permissions,
  });
});

export default router;
