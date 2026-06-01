import { type Address, parseEther } from 'viem';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { loadConfig } from '@ritkey/core';

// ============================================================
// Express Request augmentation — apiKeyHash attached by authMiddleware
// ============================================================

declare module 'express-serve-static-core' {
  interface Request {
    /** sha256 of the bearer token; null when running in OPEN_MODE */
    apiKeyHash?: string | null;
  }
}

// ============================================================
// Request Validation Schemas
// ============================================================

export const CreateWalletSchema = z.object({
  label: z.string().optional().default(''),
});

export const SendTransactionSchema = z.object({
  agentShard: z.string().min(1, 'Agent shard is required'),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  value: z.string().optional().default('0'),
  data: z.string().optional().default('0x'),
});

export const SignMessageSchema = z.object({
  agentShard: z.string().min(1, 'Agent shard is required'),
  message: z.string().min(1, 'Message is required'),
});

export const DepositRitualSchema = z.object({
  agentShard: z.string().min(1, 'Agent shard is required'),
  amount: z.string().min(1, 'Amount is required'),
  lockDuration: z.number().int().min(0).default(10000),
});

export const UpdatePolicySchema = z.object({
  maxPerTransaction: z.string().optional(),
  maxDailySpend: z.string().optional(),
  allowedAddresses: z.array(z.string()).optional(),
  maxTxPerMinute: z.number().int().min(1).optional(),
  frozen: z.boolean().optional(),
});

export const SweepAndArchiveSchema = z.object({
  agentShard: z.string().min(1, 'Agent shard is required'),
  sweepTo: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
});

export const ExportKeySchema = z.object({
  agentShard: z.string().min(1, 'Agent shard is required'),
  backupShard: z.string().optional(), // Optional - server can use its own shard with agent
  confirm: z.literal(true, {
    errorMap: () => ({ message: 'Must confirm export with confirm: true' }),
  }),
});

export const ImportKeySchema = z.object({
  privateKey: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, 'Invalid private key: must be 32 bytes hex'),
  label: z.string().optional().default(''),
});

// ============================================================
// Middleware Types
// ============================================================

import type { Request, Response, NextFunction } from 'express';

/**
 * API Key authentication middleware.
 * Reads auth config from loadConfig(): OPEN_MODE bypasses auth entirely,
 * otherwise a Bearer token matching API_KEY is required. On success, sets
 * `req.apiKeyHash` to sha256(token) so downstream handlers can bind grants
 * without ever holding the raw token.
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const config = loadConfig();

  if (config.openMode) {
    req.apiKeyHash = null;
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== config.apiKey) {
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  req.apiKeyHash = createHash('sha256').update(token).digest('hex');
  next();
}

/**
 * Simple in-memory rate limiter per IP address.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimitMiddleware(
  maxRequests: number = 60,
  windowMs: number = 60_000
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = rateLimitMap.get(ip);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      rateLimitMap.set(ip, entry);
    }

    entry.count++;

    if (entry.count > maxRequests) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
      return;
    }

    next();
  };
}

/**
 * Fields that must NEVER be logged or echoed in errors.
 *
 * If any of these appear in a request body — even with validation failing —
 * they must be redacted before the body is stringified to logs.
 */
const SENSITIVE_FIELDS = new Set([
  'privateKey',
  'private_key',
  'agentShard',
  'agent_shard',
  'backupShard',
  'backup_shard',
  'serverShard',
  'server_shard',
  'secret',
  'apiKey',
  'api_key',
  'encryptionKey',
  'encryption_key',
  'password',
  'token',
]);

/**
 * Return a shallow copy of an object with sensitive fields replaced by '[REDACTED]'.
 * Non-object inputs are returned as a string placeholder.
 */
function redactSensitive(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(redactSensitive);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = SENSITIVE_FIELDS.has(k) ? '[REDACTED]' : redactSensitive(v);
  }
  return out;
}

/**
 * Zod validation middleware factory.
 *
 * On failure, logs ONLY the field names that failed and a redacted body —
 * never the raw payload (which may contain private keys, shards, etc.).
 */
export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body ?? {};
    const result = schema.safeParse(body);
    if (!result.success) {
      const failedFields = Object.keys(result.error.flatten().fieldErrors);
      console.error(
        '[VALIDATION] failed fields:',
        JSON.stringify(failedFields),
        'redacted body:',
        JSON.stringify(redactSensitive(req.body))
      );
      res.status(400).json({
        error: 'Validation error',
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Global error handler.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
