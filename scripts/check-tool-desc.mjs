import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('https://zooming-gentleness-production-0d17.up.railway.app/mcp'),
  { requestInit: { headers: { Authorization: 'Bearer cae1457844e3b1a53c0f1a08131e8abe35981aa885d8541168e167522057028f' } } }
);
const client = new Client({ name: 'desc-check', version: '1.0' }, { capabilities: {} });
await client.connect(transport);
const { tools } = await client.listTools();
const cw = tools.find((t) => t.name === 'create_wallet');
console.log('create_wallet description:');
console.log(cw?.description);
await client.close();
