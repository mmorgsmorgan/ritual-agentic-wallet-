/**
 * Ritkey MCP server — thin shell over @ritkey/sdk.
 *
 * Every wallet/webhook/alert tool here is a 1:1 wrapper around an SDK
 * method that talks to the @ritkey/service HTTP API. The MCP process holds
 * no signing material — the agentShard is supplied per-call by the caller
 * (the LLM/agent operating the wallet).
 *
 * Configuration via env:
 *   RITKEY_API_URL  — base URL of the service. Default: http://localhost:3000
 *   RITKEY_API_KEY  — Bearer token if the service requires auth.
 *
 * Skill docs (read_ritual_skill, read_ritual_rules, etc.) remain local to
 * this package — they are bundled markdown.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RitkeyClient } from '@ritkey/sdk';
import type { EventType, AlertSeverity } from '@ritkey/sdk';
import {
  listRitualSkills,
  getRitualSkill,
  getRitualRules,
  loadRitualSkills,
} from '../skills.js';

const RITKEY_API_URL = process.env.RITKEY_API_URL ?? 'http://localhost:3000';
const RITKEY_API_KEY = process.env.RITKEY_API_KEY;

// Single SDK client shared across tool invocations. Constructed at startup
// so each call doesn't re-allocate HttpTransport.
const client = new RitkeyClient({
  baseUrl: RITKEY_API_URL,
  apiKey: RITKEY_API_KEY,
});

/** Marshal any thrown error into an MCP error response. */
function errorContent(label: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status;
  const body = (err as any)?.body;
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { error: label, message, status, details: body },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

function okContent(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'ritual-agent-wallet',
    version: '0.1.0',
  });

  // ══════════════════════════════════════════════════════════
  //  WALLET TOOLS
  // ══════════════════════════════════════════════════════════

  server.tool(
    'create_wallet',
    'Create a new MPC wallet (Shamir 2-of-3 threshold). Returns walletId, address, agentShard, and backupShard. SAVE the shards — they are shown only once. The agentShard is required for every signing call.',
    { label: z.string().optional().describe('Optional human label for the wallet') },
    async ({ label }) => {
      try {
        const w = await client.wallets.create({ label });
        return okContent({
          walletId: w.walletId,
          address: w.address,
          publicKey: w.publicKey,
          agentShard: w.agentShard,
          backupShard: w.backupShard,
          walletType: w.walletType,
          threshold: w.threshold,
          totalShares: w.totalShares,
          notice:
            'SAVE the agentShard (you supply it on every sign call) AND the backupShard (cold storage). They are shown only once.',
        });
      } catch (err) {
        return errorContent('create_wallet_failed', err);
      }
    }
  );

  server.tool(
    'import_wallet',
    'Import an existing private key (e.g. from MetaMask/Rabby) into Ritkey. The key is split into 2-of-3 Shamir shares; you receive the agent shard and backup shard once.',
    {
      privateKey: z.string().describe('Hex private key, with or without 0x prefix'),
      label: z.string().optional().describe('Optional label'),
    },
    async ({ privateKey, label }) => {
      try {
        const w = await client.wallets.import_({ privateKey, label });
        return okContent({
          walletId: w.walletId,
          address: w.address,
          publicKey: w.publicKey,
          agentShard: w.agentShard,
          backupShard: w.backupShard,
          notice: 'SAVE both shards — they are shown only once.',
        });
      } catch (err) {
        return errorContent('import_wallet_failed', err);
      }
    }
  );

  server.tool(
    'list_wallets',
    'List wallets visible to the current API key.',
    {},
    async () => {
      try {
        const r = await client.wallets.list();
        return okContent({ wallets: r.wallets, count: r.count });
      } catch (err) {
        return errorContent('list_wallets_failed', err);
      }
    }
  );

  server.tool(
    'get_wallet_info',
    'Get wallet metadata (address, label, status, createdAt) by walletId.',
    { walletId: z.string().describe('Wallet UUID') },
    async ({ walletId }) => {
      try {
        return okContent(await client.wallets.get(walletId));
      } catch (err) {
        return errorContent('get_wallet_info_failed', err);
      }
    }
  );

  server.tool(
    'get_balance',
    'Get native RITUAL balance and RitualWallet escrow balance for a wallet.',
    { walletId: z.string().describe('Wallet UUID') },
    async ({ walletId }) => {
      try {
        const b = await client.wallets.balance(walletId);
        return okContent({
          address: b.address,
          nativeBalance: `${b.native.formatted} RITUAL`,
          ritualWalletBalance: `${b.ritualWallet.formatted} RITUAL`,
          ritualWalletLocked: b.ritualWallet.isLocked,
          lockUntilBlock: b.ritualWallet.lockUntil,
          currentBlock: b.currentBlock,
        });
      } catch (err) {
        return errorContent('get_balance_failed', err);
      }
    }
  );

  server.tool(
    'send_transaction',
    'Sign and broadcast a transaction on Ritual Chain. Requires the wallet\'s agentShard.',
    {
      walletId: z.string().describe('Wallet UUID'),
      agentShard: z.string().describe('Your agent key shard (hex)'),
      to: z.string().describe('Destination address (0x...)'),
      value: z.string().describe('Amount in RITUAL (decimal string, e.g. "0.5")'),
      data: z.string().optional().describe('Calldata hex (default 0x)'),
    },
    async ({ walletId, agentShard, to, value, data }) => {
      try {
        const tx = await client.wallets.send({
          walletId,
          agentShard,
          to,
          value,
          data,
        });
        return okContent({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value,
          explorer: tx.explorer,
        });
      } catch (err) {
        return errorContent('send_transaction_failed', err);
      }
    }
  );

  server.tool(
    'sign_message',
    'Sign a message (EIP-191 personal_sign) using the wallet.',
    {
      walletId: z.string().describe('Wallet UUID'),
      agentShard: z.string().describe('Your agent key shard'),
      message: z.string().describe('Message to sign'),
    },
    async ({ walletId, agentShard, message }) => {
      try {
        const r = await client.wallets.sign({ walletId, agentShard, message });
        return okContent({ signature: r.signature, address: r.address });
      } catch (err) {
        return errorContent('sign_message_failed', err);
      }
    }
  );

  server.tool(
    'fund_wallet',
    'Claim the one-time faucet drip for this wallet. Each wallet can only claim once.',
    { walletId: z.string().describe('Wallet UUID') },
    async ({ walletId }) => {
      try {
        return okContent(await client.wallets.fund(walletId));
      } catch (err) {
        return errorContent('fund_wallet_failed', err);
      }
    }
  );

  server.tool(
    'export_key',
    'Export the wallet\'s private key (e.g. to use in MetaMask). After successful export the wallet is ARCHIVED and unusable through Ritkey. Sweep funds out first if you want to keep them in this wallet.',
    {
      walletId: z.string().describe('Wallet UUID'),
      agentShard: z.string().describe('Your agent key shard'),
      backupShard: z.string().optional().describe('Optional: pass your backup shard to reconstruct fully offline'),
    },
    async ({ walletId, agentShard, backupShard }) => {
      try {
        const r = await client.wallets.exportKey({ walletId, agentShard, backupShard });
        return okContent({
          walletId: r.walletId,
          address: r.address,
          privateKey: r.privateKey,
          status: r.status,
          notice: 'Wallet is now ARCHIVED. Move the privateKey to a secure wallet immediately.',
        });
      } catch (err) {
        return errorContent('export_key_failed', err);
      }
    }
  );

  server.tool(
    'sweep_and_archive',
    'Send all native RITUAL to a target address (minus gas) then archive the wallet. Use this before key rotation or to retire an agent.',
    {
      walletId: z.string().describe('Wallet UUID'),
      agentShard: z.string().describe('Your agent key shard'),
      sweepTo: z.string().describe('Destination address for the sweep'),
    },
    async ({ walletId, agentShard, sweepTo }) => {
      try {
        return okContent(
          await client.wallets.sweepAndArchive({ walletId, agentShard, sweepTo })
        );
      } catch (err) {
        return errorContent('sweep_and_archive_failed', err);
      }
    }
  );

  // ══════════════════════════════════════════════════════════
  //  WEBHOOK TOOLS
  // ══════════════════════════════════════════════════════════

  server.tool(
    'create_webhook',
    'Register a webhook subscription. Returns the signing secret ONCE — store it to verify incoming deliveries.',
    {
      url: z.string().describe('HTTPS URL that will receive POST deliveries'),
      events: z.array(z.string()).optional().describe('Event types to subscribe to (default: ["*"])'),
      label: z.string().optional().describe('Optional human label'),
    },
    async ({ url, events, label }) => {
      try {
        const w = await client.webhooks.create({
          url,
          events: events as (EventType | '*')[] | undefined,
          label,
        });
        return okContent({
          id: w.id,
          url: w.url,
          eventsFilter: w.eventsFilter,
          status: w.status,
          secret: w.secret,
          notice: 'SAVE the secret — used to verify HMAC signatures on incoming deliveries. Shown only once.',
        });
      } catch (err) {
        return errorContent('create_webhook_failed', err);
      }
    }
  );

  server.tool(
    'list_webhooks',
    'List webhook subscriptions owned by the current API key.',
    {},
    async () => {
      try {
        return okContent(await client.webhooks.list());
      } catch (err) {
        return errorContent('list_webhooks_failed', err);
      }
    }
  );

  server.tool(
    'update_webhook',
    'Update a webhook subscription (url, events, label, status).',
    {
      webhookId: z.string().describe('Webhook subscription id'),
      url: z.string().optional(),
      events: z.array(z.string()).optional(),
      label: z.string().optional(),
      status: z.enum(['active', 'paused']).optional(),
    },
    async ({ webhookId, url, events, label, status }) => {
      try {
        return okContent(
          await client.webhooks.update(webhookId, {
            url,
            events: events as (EventType | '*')[] | undefined,
            label,
            status,
          })
        );
      } catch (err) {
        return errorContent('update_webhook_failed', err);
      }
    }
  );

  server.tool(
    'delete_webhook',
    'Delete a webhook subscription.',
    { webhookId: z.string() },
    async ({ webhookId }) => {
      try {
        await client.webhooks.delete(webhookId);
        return okContent({ deleted: webhookId });
      } catch (err) {
        return errorContent('delete_webhook_failed', err);
      }
    }
  );

  server.tool(
    'test_webhook',
    'Send a test event (webhook.test) to a subscription to verify delivery + signature.',
    { webhookId: z.string() },
    async ({ webhookId }) => {
      try {
        return okContent(await client.webhooks.test(webhookId));
      } catch (err) {
        return errorContent('test_webhook_failed', err);
      }
    }
  );

  // ══════════════════════════════════════════════════════════
  //  ALERT TOOLS
  // ══════════════════════════════════════════════════════════

  server.tool(
    'create_alert_rule',
    'Create an alert rule on a wallet. Kinds: spend_threshold (config: {thresholdRitual}), unusual_recipient (config: {whitelist: address[]}), key_export_warning (config: {}), balance_low (config: {floorRitual}).',
    {
      walletId: z.string().describe('Wallet UUID'),
      kind: z.enum(['spend_threshold', 'unusual_recipient', 'key_export_warning', 'balance_low']),
      config: z.record(z.any()).describe('Kind-specific config blob'),
      severity: z.enum(['info', 'warn', 'critical']).optional(),
      label: z.string().optional(),
    },
    async ({ walletId, kind, config, severity, label }) => {
      try {
        return okContent(
          await client.alerts.create({
            walletId,
            kind,
            config: config as any,
            severity: severity as AlertSeverity | undefined,
            label,
          })
        );
      } catch (err) {
        return errorContent('create_alert_rule_failed', err);
      }
    }
  );

  server.tool(
    'list_alert_rules',
    'List alert rules. Pass walletId to scope to one wallet, otherwise lists all rules for this owner.',
    { walletId: z.string().optional() },
    async ({ walletId }) => {
      try {
        if (walletId) {
          return okContent(await client.alerts.listForWallet(walletId));
        }
        return okContent(await client.alerts.list());
      } catch (err) {
        return errorContent('list_alert_rules_failed', err);
      }
    }
  );

  server.tool(
    'update_alert_rule',
    'Update an alert rule (enabled, severity, label, config).',
    {
      ruleId: z.string(),
      enabled: z.boolean().optional(),
      severity: z.enum(['info', 'warn', 'critical']).optional(),
      label: z.string().optional(),
      config: z.record(z.any()).optional(),
    },
    async ({ ruleId, enabled, severity, label, config }) => {
      try {
        return okContent(
          await client.alerts.update(ruleId, {
            enabled,
            severity: severity as AlertSeverity | undefined,
            label,
            config: config as any,
          })
        );
      } catch (err) {
        return errorContent('update_alert_rule_failed', err);
      }
    }
  );

  server.tool(
    'delete_alert_rule',
    'Delete an alert rule.',
    { ruleId: z.string() },
    async ({ ruleId }) => {
      try {
        await client.alerts.delete(ruleId);
        return okContent({ deleted: ruleId });
      } catch (err) {
        return errorContent('delete_alert_rule_failed', err);
      }
    }
  );

  // ══════════════════════════════════════════════════════════
  //  EVENT TOOLS
  // ══════════════════════════════════════════════════════════

  server.tool(
    'list_events',
    'Fetch recent events (newest first). Useful for polling-style consumers.',
    {
      walletId: z.string().optional().describe('Restrict to a specific wallet'),
      type: z.string().optional().describe('Restrict to one event type'),
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ walletId, type, limit }) => {
      try {
        const events = await client.events.list({
          walletId,
          type: type as EventType | undefined,
          limit,
        });
        return okContent({ events, count: events.length });
      } catch (err) {
        return errorContent('list_events_failed', err);
      }
    }
  );

  // ══════════════════════════════════════════════════════════
  //  SKILL DOCS (local, no HTTP roundtrip)
  // ══════════════════════════════════════════════════════════

  server.tool(
    'list_ritual_skills',
    'List bundled Ritual Chain skill docs. Each entry has id/name/description; call read_ritual_skill(id) for the body.',
    {},
    async () => okContent(listRitualSkills())
  );

  server.tool(
    'read_ritual_skill',
    'Read a bundled Ritual Chain skill document by id.',
    { id: z.string() },
    async ({ id }) => {
      const skill = getRitualSkill(id);
      if (!skill) {
        return {
          content: [{ type: 'text' as const, text: `Unknown skill id: ${id}` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text' as const, text: skill.body }] };
    }
  );

  server.tool(
    'read_ritual_rules',
    'Read the curated Ritual Chain hard-rules document.',
    {},
    async () => ({
      content: [{ type: 'text' as const, text: getRitualRules() }],
    })
  );

  // ══════════════════════════════════════════════════════════
  //  RESOURCES (skill docs as MCP resources)
  // ══════════════════════════════════════════════════════════

  const allSkills = loadRitualSkills();
  for (const skill of allSkills.values()) {
    server.resource(
      skill.id,
      `ritual-skill://${skill.id}`,
      { description: skill.description, mimeType: 'text/markdown' },
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

  // ══════════════════════════════════════════════════════════
  //  BOOTSTRAP PROMPT
  // ══════════════════════════════════════════════════════════

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

You have a self-custodied MPC wallet. The MCP server delegates all wallet ops to the Ritkey service over HTTP. You hold the agent shard; the service holds the server shard; both are required to sign.

## What you can do

**Wallet ops**
- \`create_wallet\`, \`import_wallet\`, \`list_wallets\`, \`get_wallet_info\`, \`get_balance\`
- \`send_transaction\`, \`sign_message\`, \`fund_wallet\`
- \`export_key\` (⚠️ archives the wallet), \`sweep_and_archive\`

**Webhooks** — receive events at your own HTTP endpoint
- \`create_webhook\`, \`list_webhooks\`, \`update_webhook\`, \`delete_webhook\`, \`test_webhook\`
- Signing scheme: \`Ritkey-Signature: t=<timestamp>,v1=<hex>\` (HMAC-SHA256 of \`<t>.<rawBody>\`)

**Alerts** — derived events on top of raw activity
- \`create_alert_rule\`, \`list_alert_rules\`, \`update_alert_rule\`, \`delete_alert_rule\`
- Kinds: \`spend_threshold\`, \`unusual_recipient\`, \`key_export_warning\`, \`balance_low\`
- Each rule fires \`alert.<kind>\` events that route through your webhooks.

**Events** — polling fallback
- \`list_events\` (filter by walletId, type, limit)

**Docs** — \`list_ritual_skills\`, \`read_ritual_skill(id)\`, \`read_ritual_rules\`
**Resources** — \`ritual-skill://<id>\`, \`ritual-rules://hard-constraints\`

## Bundled Ritual Chain skills
${skillList}

## Before doing anything non-trivial
1. \`read_ritual_rules\` once. Hard constraints that silently revert if broken.
2. For your first HTTP/LLM/agent precompile call, read the relevant skill doc (\`ritual-dapp-overview\`, \`ritual-dapp-http\`, etc).
3. Deposit RITUAL into RitualWallet before any async precompile call.

## Operating principles
- Your agentShard is the equivalent of a private key. If you lose it, the wallet is unrecoverable (unless you also kept the backupShard offline).
- The server enforces 1 wallet per API key (Sybil defense).
- Use \`create_alert_rule\` to set up spending caps, unusual-recipient flags, or balance floors — they will fire \`alert.*\` events to any webhook you've registered.

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

  // ══════════════════════════════════════════════════════════
  //  HEALTH / META
  // ══════════════════════════════════════════════════════════

  server.tool(
    'get_chain_info',
    'Get Ritual Chain configuration (chain id, RPC, explorer, etc).',
    {},
    async () =>
      okContent({
        chainId: 1979,
        name: 'Ritual Chain',
        currency: 'RITUAL',
        rpc: 'https://rpc.ritualfoundation.org',
        explorer: 'https://explorer.ritualfoundation.org',
        ritkeyService: RITKEY_API_URL,
      })
  );

  return server;
}
