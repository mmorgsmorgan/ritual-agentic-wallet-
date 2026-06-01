import { type Request, type Response, type NextFunction } from 'express';
import { getDb } from '../db/database.js';
import { getUserByApiKey, hasPermission, updateApiKeyLastUsed, type Permission } from '../db/users.js';
import { verifyRequestSignature, createRequestPayload } from '@ritkey/core';

/**
 * P-256 API Key Authentication Middleware
 *
 * Expects headers:
 * - X-API-Public-Key: Compressed P-256 public key
 * - X-Signature: Request signature
 * - X-Timestamp: Request timestamp (ms)
 */
export function apiKeyAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const publicKey = req.headers['x-api-public-key'] as string;
  const signature = req.headers['x-signature'] as string;
  const timestamp = req.headers['x-timestamp'] as string;

  if (!publicKey || !signature || !timestamp) {
    res.status(401).json({
      error: 'Missing authentication headers',
      required: ['X-API-Public-Key', 'X-Signature', 'X-Timestamp'],
    });
    return;
  }

  // Check timestamp (prevent replay attacks - 5 minute window)
  const now = Date.now();
  const reqTime = parseInt(timestamp, 10);
  if (Math.abs(now - reqTime) > 5 * 60 * 1000) {
    res.status(401).json({ error: 'Request timestamp expired' });
    return;
  }

  // Create payload for verification
  const body = req.body ? JSON.stringify(req.body) : undefined;
  const payload = createRequestPayload(
    req.method,
    req.path,
    reqTime,
    body
  );

  // Verify signature
  const valid = verifyRequestSignature(payload, signature, publicKey);
  if (!valid) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Look up user by public key
  const user = getUserByApiKey(getDb(), publicKey);
  if (!user) {
    res.status(401).json({ error: 'API key not found or inactive' });
    return;
  }

  // Attach user to request
  (req as any).user = user;

  // Update last used timestamp
  updateApiKeyLastUsed(getDb(), user.apiKeyId);

  next();
}

/**
 * Permission check middleware factory
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!hasPermission(getDb(), user.id, permission)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: permission,
      });
      return;
    }

    next();
  };
}

/**
 * Require admin permission
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  if (user.userType !== 'human') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  if (!hasPermission(getDb(), user.id, 'admin:users') &&
      !hasPermission(getDb(), user.id, 'admin:policies')) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}

// Augment Express Request type
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      userName: string;
      userType: 'human' | 'agent';
      status: string;
      apiKeyId: string;
    };
  }
}
