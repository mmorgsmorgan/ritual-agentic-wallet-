/**
 * End-to-end smoke test of the hosted MCP server.
 * Acts as a real client — same code path as mcp-remote.
 *
 *   node scripts/test-mcp-create-wallet.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = 'https://zooming-gentleness-production-0d17.up.railway.app/mcp';
const TOKEN = 'cae1457844e3b1a53c0f1a08131e8abe35981aa885d8541168e167522057028f';
const LABEL = `smoke-${Date.now()}`;

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
  requestInit: {
    headers: { Authorization: `Bearer ${TOKEN}` },
  },
});

const client = new Client(
  { name: 'mcp-smoke-test', version: '1.0' },
  { capabilities: {} }
);

console.log(`[connect] ${MCP_URL}`);
await client.connect(transport);
console.log(`[server]  ${JSON.stringify(client.getServerVersion())}`);

console.log(`[tools/list]`);
const { tools } = await client.listTools();
console.log(`  → ${tools.length} tools available`);
const walletTools = tools.filter((t) => t.name.includes('wallet'));
console.log(`  → wallet tools: ${walletTools.map((t) => t.name).join(', ')}`);

console.log(`[tools/call create_wallet { label: "${LABEL}" }]`);
const result = await client.callTool({
  name: 'create_wallet',
  arguments: { label: LABEL },
});

console.log(`  → isError: ${result.isError ?? false}`);
for (const c of result.content ?? []) {
  if (c.type === 'text') {
    console.log(`  → text:`);
    try {
      const parsed = JSON.parse(c.text);
      console.log(JSON.stringify(parsed, null, 2).split('\n').map((l) => '      ' + l).join('\n'));
    } catch {
      console.log('      ' + c.text);
    }
  } else {
    console.log(`  → ${c.type}`);
  }
}

console.log(`[tools/call list_wallets]`);
const listResult = await client.callTool({ name: 'list_wallets', arguments: {} });
for (const c of listResult.content ?? []) {
  if (c.type === 'text') {
    try {
      const parsed = JSON.parse(c.text);
      const count = Array.isArray(parsed) ? parsed.length : parsed.wallets?.length ?? '?';
      console.log(`  → ${count} wallet(s) on the service`);
      console.log(JSON.stringify(parsed, null, 2).split('\n').slice(0, 25).map((l) => '      ' + l).join('\n'));
    } catch {
      console.log('      ' + c.text);
    }
  }
}

await client.close();
console.log('[done]');
