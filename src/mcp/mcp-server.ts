import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  generateWalletKeypair,
  splitKey,
  encryptShard,
  decryptShard,
  reconstructKey,
} from '../core/keys.js';
import { policyEngine } from '../core/policy.js';
import { loadConfig } from '../core/config.js';
import { fundWalletFromFaucet, FaucetError } from '../core/faucet.js';
import {
  listRitualSkills,
  getRitualSkill,
  getRitualRules,
  loadRitualSkills,
} from '../core/skills.js';
import { signAndSendTransaction, signMessage } from '../core/signer.js';
import {
  getNativeBalance,
  getRitualWalletBalance,
  depositToRitualWallet,
  getCurrentBlock,
  callHttpPrecompile,
  callLlmPrecompile,
  estimateGas,
  SYSTEM_CONTRACTS,
  PRECOMPILES,
} from '../core/ritual.js';
import {
  createWallet as dbCreateWallet,
  getWallet,
  listWallets,
  getPolicy,
  recordTransaction,
  getRecentTransactions,
  getTransactions,
} from '../db/database.js';
import { type Address, type Hex, parseEther } from 'viem';

// ============================================================
// MCP Server Definition
// ============================================================

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'ritual-agent-wallet',
    version: '1.0.0',
  });

  // ── create_wallet ─────────────────────────────────────────
  server.tool(
    'create_wallet',
    'Create a new agent wallet on Ritual Chain. Returns address and agent shard (save it!)',
    { label: z.string().optional().describe('Optional label for the wallet') },
    async ({ label }) => {
      const keypair = generateWalletKeypair();
      const split = splitKey(keypair.privateKey);

      const encryptionKey =
        loadConfig().encryptionKey;
      const encryptedServerShard = encryptShard(split.serverShard, encryptionKey);

      const wallet = dbCreateWallet(
        split.address,
        split.publicKey,
        encryptedServerShard,
        label || ''
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                walletId: wallet.id,
                address: wallet.address,
                agentShard: split.agentShard,
                publicKey: wallet.publicKey,
                notice:
                  'SAVE YOUR AGENT SHARD! It is required for all signing operations and is shown only once.',
                next: {
                  message:
                    'Before your first on-chain action, load the Ritual bootstrap context.',
                  steps: [
                    {
                      action: 'prompts/get',
                      name: 'ritual-bootstrap',
                      why: 'One-shot bootstrap message that explains what tools and skills you have available.',
                    },
                    {
                      action: 'tools/call',
                      name: 'read_ritual_rules',
                      why: 'Hard constraints — break these and your transactions revert.',
                    },
                    {
                      action: 'tools/call',
                      name: 'list_ritual_skills',
                      why: 'Discover the bundled Ritual Chain skill docs you can read on demand.',
                    },
                    {
                      action: 'tools/call',
                      name: 'fund_wallet',
                      args: { walletId: wallet.id },
                      why: 'Claim the one-time faucet drip so you can pay for transactions.',
                    },
                  ],
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── get_wallet_info ───────────────────────────────────────
  server.tool(
    'get_wallet_info',
    'Get wallet details by ID',
    { walletId: z.string().describe('Wallet ID (UUID)') },
    async ({ walletId }) => {
      const wallet = getWallet(walletId);
      if (!wallet) {
        return {
          content: [{ type: 'text' as const, text: 'Wallet not found' }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: wallet.id,
                address: wallet.address,
                label: wallet.label,
                status: wallet.status,
                createdAt: wallet.createdAt,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── get_balance ───────────────────────────────────────────
  server.tool(
    'get_balance',
    'Get native RITUAL balance and RitualWallet escrow balance',
    { walletId: z.string().describe('Wallet ID (UUID)') },
    async ({ walletId }) => {
      const wallet = getWallet(walletId);
      if (!wallet) {
        return {
          content: [{ type: 'text' as const, text: 'Wallet not found' }],
          isError: true,
        };
      }

      const [native, ritual, block] = await Promise.all([
        getNativeBalance(wallet.address as Address),
        getRitualWalletBalance(wallet.address as Address),
        getCurrentBlock(),
      ]);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                address: wallet.address,
                nativeBalance: `${native.formatted} RITUAL`,
                ritualWalletBalance: `${ritual.formatted} RITUAL`,
                ritualWalletLocked: ritual.isLocked,
                lockUntilBlock: ritual.lockUntil.toString(),
                currentBlock: block.toString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── send_transaction ──────────────────────────────────────
  server.tool(
    'send_transaction',
    'Sign and broadcast a transaction on Ritual Chain',
    {
      walletId: z.string().describe('Wallet ID'),
      agentShard: z.string().describe('Your agent key shard (hex)'),
      to: z.string().describe('Destination address (0x...)'),
      value: z.string().optional().describe('Amount in RITUAL (e.g. "0.5")'),
      data: z.string().optional().describe('Calldata hex (0x...)'),
    },
    async ({ walletId, agentShard, to, value, data }) => {
      const wallet = getWallet(walletId);
      if (!wallet) {
        return {
          content: [{ type: 'text' as const, text: 'Wallet not found' }],
          isError: true,
        };
      }
      if (wallet.status !== 'active') {
        return {
          content: [
            { type: 'text' as const, text: `Wallet is ${wallet.status}` },
          ],
          isError: true,
        };
      }

      // Policy check
      const policy = getPolicy(wallet.id);
      const recentTxs = getRecentTransactions(wallet.id);
      const check = policyEngine.evaluate(
        policy,
        to as Address,
        value || '0',
        recentTxs
      );
      if (!check.allowed) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Policy violation: ${check.reason}`,
            },
          ],
          isError: true,
        };
      }

      const encryptionKey =
        loadConfig().encryptionKey;
      const serverShard = decryptShard(wallet.serverShard, encryptionKey);

      const result = await signAndSendTransaction(serverShard, agentShard, {
        to: to as Address,
        value: value || '0',
        data: (data || '0x') as Hex,
      });

      recordTransaction(
        wallet.id,
        result.hash,
        to,
        parseEther(value || '0').toString(),
        data || '0x',
        'confirmed'
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                hash: result.hash,
                from: result.from,
                to: result.to,
                value: value || '0',
                explorer: `https://explorer.ritualfoundation.org/tx/${result.hash}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── deposit_to_ritual_wallet ──────────────────────────────
  server.tool(
    'deposit_to_ritual_wallet',
    'Deposit RITUAL to the RitualWallet escrow for fee payment. Required before using async precompiles.',
    {
      walletId: z.string().describe('Wallet ID'),
      agentShard: z.string().describe('Your agent key shard'),
      amount: z.string().describe('Amount in RITUAL (e.g. "0.5")'),
      lockDuration: z
        .number()
        .optional()
        .describe('Lock duration in blocks (default 10000 ≈ 58 min)'),
    },
    async ({ walletId, agentShard, amount, lockDuration }) => {
      const wallet = getWallet(walletId);
      if (!wallet) {
        return {
          content: [{ type: 'text' as const, text: 'Wallet not found' }],
          isError: true,
        };
      }

      const encryptionKey =
        loadConfig().encryptionKey;
      const serverShard = decryptShard(wallet.serverShard, encryptionKey);
      const privateKey = reconstructKey(serverShard, agentShard);

      const result = await depositToRitualWallet(
        privateKey,
        amount,
        BigInt(lockDuration || 10000)
      );

      recordTransaction(
        wallet.id,
        result.hash,
        SYSTEM_CONTRACTS.RitualWallet,
        parseEther(amount).toString(),
        '0x',
        'confirmed'
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                hash: result.hash,
                amount,
                lockDuration: lockDuration || 10000,
                ritualWallet: SYSTEM_CONTRACTS.RitualWallet,
                explorer: `https://explorer.ritualfoundation.org/tx/${result.hash}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── sign_message ──────────────────────────────────────────
  server.tool(
    'sign_message',
    'Sign a message (EIP-191 personal_sign) with your wallet',
    {
      walletId: z.string().describe('Wallet ID'),
      agentShard: z.string().describe('Your agent key shard'),
      message: z.string().describe('Message to sign'),
    },
    async ({ walletId, agentShard, message }) => {
      const wallet = getWallet(walletId);
      if (!wallet) {
        return {
          content: [{ type: 'text' as const, text: 'Wallet not found' }],
          isError: true,
        };
      }

      const encryptionKey =
        loadConfig().encryptionKey;
      const serverShard = decryptShard(wallet.serverShard, encryptionKey);

      const result = await signMessage(serverShard, agentShard, message);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { signature: result.signature, address: result.address },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── list_wallets ──────────────────────────────────────────
  server.tool(
    'list_wallets',
    'List all wallets managed by this server',
    {},
    async () => {
      const wallets = listWallets().map((w) => ({
        id: w.id,
        address: w.address,
        label: w.label,
        status: w.status,
        createdAt: w.createdAt,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ wallets, count: wallets.length }, null, 2),
          },
        ],
      };
    }
  );

  // ── get_transaction_history ───────────────────────────────
  server.tool(
    'get_transaction_history',
    'Get transaction history for a wallet',
    {
      walletId: z.string().describe('Wallet ID'),
      limit: z.number().optional().describe('Max results (default 20)'),
    },
    async ({ walletId, limit }) => {
      const txs = getTransactions(walletId, limit || 20);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { transactions: txs, count: txs.length },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── call_http_precompile ──────────────────────────────────
  server.tool(
    'call_http_precompile',
    'Make an HTTP request via the Ritual HTTP precompile (0x0801). Requires RitualWallet deposit. TEE executor is auto-selected.',
    {
      walletId: z.string().describe('Wallet ID'),
      agentShard: z.string().describe('Your agent key shard'),
      url: z.string().describe('Target URL (https://...)'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])
        .default('GET'),
      headers: z.record(z.string()).optional().describe('Request headers'),
      body: z.string().optional().describe('Request body as a string'),
      ttl: z.number().optional().describe('Blocks until expiry (1-500, default 100)'),
    },
    async ({ walletId, agentShard, url, method, headers, body, ttl }) => {
      const wallet = getWallet(walletId);
      if (!wallet) {
        return {
          content: [{ type: 'text' as const, text: 'Wallet not found' }],
          isError: true,
        };
      }

      const encryptionKey = loadConfig().encryptionKey;
      const serverShard = decryptShard(wallet.serverShard, encryptionKey);
      const privateKey = reconstructKey(serverShard, agentShard);

      const result = await callHttpPrecompile(privateKey, {
        url,
        method,
        headers,
        body,
        ttl: ttl ? BigInt(ttl) : undefined,
      });

      recordTransaction(
        wallet.id,
        result.hash,
        PRECOMPILES.HTTP,
        '0',
        '0x',
        'confirmed'
      );

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  // ── call_llm_precompile ───────────────────────────────────
  server.tool(
    'call_llm_precompile',
    'Run LLM inference via the Ritual LLM precompile (0x0802). Requires RitualWallet deposit and conversation history DA ref.',
    {
      walletId: z.string().describe('Wallet ID'),
      agentShard: z.string().describe('Your agent key shard'),
      messages: z
        .array(
          z.object({
            role: z.enum(['system', 'user', 'assistant', 'tool']),
            content: z.string(),
          })
        )
        .describe('Chat messages'),
      model: z.string().optional().describe('Model id (default zai-org/GLM-4.7-FP8)'),
      maxCompletionTokens: z
        .number()
        .optional()
        .describe('Max completion tokens (default 4096)'),
      temperatureMilli: z
        .number()
        .optional()
        .describe('Temperature × 1000 (default 700 = 0.7)'),
      ttl: z.number().optional().describe('Blocks until expiry (default 300)'),
      convoHistoryProvider: z
        .string()
        .optional()
        .describe('DA provider for conversation history (gcs, hf, pinata)'),
      convoHistoryPath: z
        .string()
        .optional()
        .describe('DA path for conversation history'),
      convoHistoryKeyRef: z
        .string()
        .optional()
        .describe('Secret name for DA credentials in encryptedSecrets'),
    },
    async ({
      walletId,
      agentShard,
      messages,
      model,
      maxCompletionTokens,
      temperatureMilli,
      ttl,
      convoHistoryProvider,
      convoHistoryPath,
      convoHistoryKeyRef,
    }) => {
      const wallet = getWallet(walletId);
      if (!wallet) {
        return {
          content: [{ type: 'text' as const, text: 'Wallet not found' }],
          isError: true,
        };
      }

      const encryptionKey = loadConfig().encryptionKey;
      const serverShard = decryptShard(wallet.serverShard, encryptionKey);
      const privateKey = reconstructKey(serverShard, agentShard);

      const convoHistory: [string, string, string] | undefined =
        convoHistoryProvider && convoHistoryPath && convoHistoryKeyRef
          ? [convoHistoryProvider, convoHistoryPath, convoHistoryKeyRef]
          : undefined;

      const result = await callLlmPrecompile(privateKey, {
        messages,
        model,
        maxCompletionTokens: maxCompletionTokens
          ? BigInt(maxCompletionTokens)
          : undefined,
        temperatureMilli: temperatureMilli ? BigInt(temperatureMilli) : undefined,
        ttl: ttl ? BigInt(ttl) : undefined,
        convoHistory,
      });

      recordTransaction(
        wallet.id,
        result.hash,
        PRECOMPILES.LLM,
        '0',
        '0x',
        'confirmed'
      );

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  // ── estimate_gas ──────────────────────────────────────────
  server.tool(
    'estimate_gas',
    'Estimate gas for a transaction from this wallet',
    {
      walletId: z.string().describe('Wallet ID'),
      to: z.string().describe('Destination address'),
      value: z.string().optional().describe('Value in RITUAL (default "0")'),
      data: z.string().optional().describe('Calldata hex'),
    },
    async ({ walletId, to, value, data }) => {
      const wallet = getWallet(walletId);
      if (!wallet) {
        return {
          content: [{ type: 'text' as const, text: 'Wallet not found' }],
          isError: true,
        };
      }
      const gas = await estimateGas(
        wallet.address as Address,
        to as Address,
        value ? parseEther(value) : 0n,
        (data || '0x') as Hex
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ gas: gas.toString() }, null, 2),
          },
        ],
      };
    }
  );

  // ── fund_wallet ───────────────────────────────────────────
  server.tool(
    'fund_wallet',
    'Claim a one-time faucet drip for the given wallet. Each wallet can only claim once.',
    { walletId: z.string().describe('Wallet ID (UUID)') },
    async ({ walletId }) => {
      try {
        const result = await fundWalletFromFaucet(walletId);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        if (err instanceof FaucetError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Faucet error (${err.code}): ${err.message}`,
              },
            ],
            isError: true,
          };
        }
        throw err;
      }
    }
  );

  // ── list_ritual_skills ────────────────────────────────────
  server.tool(
    'list_ritual_skills',
    'List bundled Ritual Chain skill docs. Each entry has an id, name, and short description; call read_ritual_skill(id) to load the full document.',
    {},
    async () => {
      const skills = listRitualSkills();
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(skills, null, 2) },
        ],
      };
    }
  );

  // ── read_ritual_skill ─────────────────────────────────────
  server.tool(
    'read_ritual_skill',
    'Read a bundled Ritual Chain skill document by id (see list_ritual_skills).',
    { id: z.string().describe('Skill id, e.g. "ritual-dapp-http"') },
    async ({ id }) => {
      const skill = getRitualSkill(id);
      if (!skill) {
        return {
          content: [
            { type: 'text' as const, text: `Unknown skill id: ${id}` },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: skill.body }],
      };
    }
  );

  // ── read_ritual_rules ─────────────────────────────────────
  server.tool(
    'read_ritual_rules',
    'Read the curated Ritual Chain hard-rules document. These are constraints that, if violated, cause transactions to revert.',
    {},
    async () => {
      return {
        content: [{ type: 'text' as const, text: getRitualRules() }],
      };
    }
  );

  // ── Ritual skill resources (one per skill + the rules doc) ─
  // Pre-load so the cache is warm before the first read request
  const allSkills = loadRitualSkills();
  for (const skill of allSkills.values()) {
    server.resource(
      skill.id,
      `ritual-skill://${skill.id}`,
      {
        description: skill.description,
        mimeType: 'text/markdown',
      },
      async () => ({
        contents: [
          {
            uri: `ritual-skill://${skill.id}`,
            mimeType: 'text/markdown',
            text: skill.body,
          },
        ],
      })
    );
  }
  server.resource(
    'ritual-rules',
    'ritual-rules://hard-constraints',
    {
      description:
        'Hard rules for any agent operating on Ritual Chain. Break these and your transactions revert.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [
        {
          uri: 'ritual-rules://hard-constraints',
          mimeType: 'text/markdown',
          text: getRitualRules(),
        },
      ],
    })
  );

  // ── ritual-bootstrap prompt ───────────────────────────────
  server.prompt(
    'ritual-bootstrap',
    'One-shot bootstrap message that turns the calling agent into a Ritual-aware wallet operator. Read this once at session start.',
    {},
    async () => {
      const skills = listRitualSkills();
      const skillList = skills
        .map((s) => `- \`${s.id}\` — ${s.description}`)
        .join('\n');

      const text = `# You are now operating an agent wallet on Ritual Chain (chain ID 1979)

You have a self-custodied MPC wallet. The MCP server holds an encrypted server shard; you hold the agent shard. Both are required to sign — neither party can act unilaterally.

## What you can do
- **Wallet ops:** create_wallet, get_wallet_info, get_balance, send_transaction, sign_message, list_wallets, get_transaction_history, fund_wallet, estimate_gas.
- **Ritual escrow:** deposit_to_ritual_wallet — required before any async precompile call.
- **Ritual compute:** call_http_precompile (HTTP requests via TEE), call_llm_precompile (on-chain LLM inference).
- **Docs:** list_ritual_skills, read_ritual_skill(id), read_ritual_rules.
- **Resources:** \`ritual-skill://<id>\` and \`ritual-rules://hard-constraints\`.

## Bundled Ritual Chain skills
${skillList}

## Before doing anything non-trivial
1. Call \`read_ritual_rules\` once. The rules are short and there are gotchas (EIP-1559 only, 13-field HTTP ABI, 30-field LLM ABI, monotonic locks, etc.) that will silently revert your tx if violated.
2. For your first call into HTTP/LLM/agent precompiles, also read \`ritual-dapp-overview\` and the relevant skill (\`ritual-dapp-http\`, \`ritual-dapp-llm\`, \`ritual-dapp-agents\`).
3. To use any async precompile: deposit RITUAL into RitualWallet first via \`deposit_to_ritual_wallet\`. ~0.01 RITUAL covers many short-running calls; budget ~1 RITUAL per sovereign agent run.

## Operating principles
- Treat your agent shard like a private key. If you lose it, the wallet is unrecoverable.
- Spending caps and rate limits are enforced server-side (PolicyEngine). 403 with \`reason\` means the policy engine, not the chain, blocked you.
- Funding via \`fund_wallet\` is one drip per wallet, lifetime. Don't try to mint multiple wallets to drain the faucet — the server enforces 1 wallet per API key.

You are ready. Call \`list_ritual_skills\` and \`read_ritual_rules\` before your first on-chain action.`;

      return {
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text },
          },
        ],
      };
    }
  );

  // ── get_chain_info ────────────────────────────────────────
  server.tool(
    'get_chain_info',
    'Get Ritual Chain configuration, system contracts, and precompile addresses',
    {},
    async () => {
      const block = await getCurrentBlock();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                chainId: 1979,
                name: 'Ritual Chain',
                currency: 'RITUAL',
                currentBlock: block.toString(),
                rpc: 'https://rpc.ritualfoundation.org',
                explorer: 'https://explorer.ritualfoundation.org',
                systemContracts: SYSTEM_CONTRACTS,
                precompiles: PRECOMPILES,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}
