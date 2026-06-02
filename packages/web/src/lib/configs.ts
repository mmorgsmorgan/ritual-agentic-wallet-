/**
 * Generates the MCP client config snippets shown on the page.
 *
 * Two transport modes:
 *   - "hosted" → users point at the Railway-hosted MCP via the `mcp-remote`
 *     stdio bridge (or native HTTP for clients that support it), with a Bearer token.
 *   - "local"  → users run `npx @ritkey/mcp` directly with their own service
 *     URL + API key.
 *
 * Eight client targets, two presentation styles:
 *   - JSON-config clients: Claude Desktop, Cursor, Cline, Windsurf, VS Code, Antigravity, opencode
 *   - CLI client:          Claude Code (paste a shell command, not JSON)
 */
export type Mode = 'hosted' | 'local';
export type Client = 'claude' | 'claude-code' | 'cursor' | 'cline' | 'windsurf' | 'vscode' | 'antigravity' | 'opencode';

export const CLIENTS: { id: Client; label: string; kind: 'json' | 'cli' }[] = [
  { id: 'claude',       label: 'Claude Desktop',  kind: 'json' },
  { id: 'claude-code',  label: 'Claude Code',     kind: 'cli'  },
  { id: 'cursor',       label: 'Cursor',          kind: 'json' },
  { id: 'cline',        label: 'Cline',           kind: 'json' },
  { id: 'windsurf',     label: 'Windsurf',        kind: 'json' },
  { id: 'vscode',       label: 'VS Code',         kind: 'json' },
  { id: 'antigravity',  label: 'Antigravity',     kind: 'json' },
  { id: 'opencode',     label: 'opencode',        kind: 'json' },
];

export const PATHS: Record<Client, { os: string; path: string }[]> = {
  claude: [
    { os: 'macOS',   path: '~/Library/Application Support/Claude/claude_desktop_config.json' },
    { os: 'Windows', path: '%APPDATA%\\Claude\\claude_desktop_config.json' },
  ],
  'claude-code': [
    { os: 'CLI', path: 'Paste this into your terminal — no file edit needed' },
  ],
  cursor: [
    { os: 'Global',      path: '~/.cursor/mcp.json' },
    { os: 'Per-project', path: '.cursor/mcp.json' },
  ],
  cline: [
    { os: 'VS Code extension', path: 'cline_mcp_settings.json' },
  ],
  windsurf: [
    { os: 'Global', path: '~/.codeium/windsurf/mcp_config.json' },
  ],
  vscode: [
    { os: 'Per-project (recommended)', path: '.vscode/mcp.json' },
  ],
  antigravity: [
    { os: 'macOS / Linux', path: '~/.antigravity/mcp_config.json' },
    { os: 'Windows',       path: '%APPDATA%\\Antigravity\\mcp_config.json' },
  ],
  opencode: [
    { os: 'Global',      path: '~/.config/opencode/config.json' },
    { os: 'Per-project', path: 'opencode.json' },
  ],
};

export interface BuildArgs {
  mode: Mode;
  mcpUrl: string;
  bearer: string;
  apiUrl: string;
  apiKey: string;
}

export function buildConfig(client: Client, args: BuildArgs): string {
  // Claude Code is a CLI command, not a JSON paste.
  if (client === 'claude-code') {
    if (args.mode === 'hosted') {
      const url = args.mcpUrl || 'https://your-mcp.up.railway.app/mcp';
      const bearer = args.bearer || 'YOUR_BEARER_TOKEN';
      return [
        `claude mcp add --transport http ritual-agent-wallet \\`,
        `  ${url} \\`,
        `  --header "Authorization: Bearer ${bearer}"`,
      ].join('\n');
    }
    // local mode for Claude Code — wraps the npm package
    const url = args.apiUrl || 'https://your-ritkey-service';
    const key = args.apiKey || 'YOUR_KEY';
    return [
      `RITKEY_API_URL=${url} \\`,
      `RITKEY_API_KEY=${key} \\`,
      `claude mcp add ritual-agent-wallet npx -y @ritkey/mcp`,
    ].join('\n');
  }

  if (args.mode === 'hosted') {
    return buildHosted(client, args.mcpUrl || 'https://your-mcp.up.railway.app/mcp', args.bearer || 'YOUR_BEARER_TOKEN');
  }
  return buildLocal(client, args.apiUrl || 'https://your-ritkey-service', args.apiKey || 'YOUR_KEY');
}

function buildHosted(client: Client, url: string, bearer: string): string {
  const authHeader = `Authorization: Bearer ${bearer}`;

  // VS Code: secret stored in VS Code secret storage
  if (client === 'vscode') {
    return JSON.stringify({
      inputs: [
        { id: 'ritkey-bearer', type: 'promptString', description: 'Ritkey MCP bearer token', password: true },
      ],
      servers: {
        'ritual-agent-wallet': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization: Bearer ${input:ritkey-bearer}'],
        },
      },
    }, null, 2);
  }

  // opencode: native remote MCP — speaks HTTP directly, no Node bridge
  if (client === 'opencode') {
    return JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        'ritual-agent-wallet': {
          type: 'remote',
          url,
          headers: { Authorization: `Bearer ${bearer}` },
          enabled: true,
        },
      },
    }, null, 2);
  }

  // Everyone else (Claude Desktop, Cursor, Cline, Windsurf, Antigravity) → mcp-remote bridge
  return JSON.stringify({
    mcpServers: {
      'ritual-agent-wallet': {
        command: 'npx',
        args: ['-y', 'mcp-remote', url, '--header', authHeader],
      },
    },
  }, null, 2);
}

function buildLocal(client: Client, apiUrl: string, apiKey: string): string {
  if (client === 'vscode') {
    return JSON.stringify({
      inputs: [
        { id: 'ritkey-api-key', type: 'promptString', description: 'Ritkey API key', password: true },
      ],
      servers: {
        'ritual-agent-wallet': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@ritkey/mcp'],
          env: { RITKEY_API_URL: apiUrl, RITKEY_API_KEY: '${input:ritkey-api-key}' },
        },
      },
    }, null, 2);
  }

  if (client === 'opencode') {
    return JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        'ritual-agent-wallet': {
          type: 'local',
          command: ['npx', '-y', '@ritkey/mcp'],
          environment: { RITKEY_API_URL: apiUrl, RITKEY_API_KEY: apiKey },
          enabled: true,
        },
      },
    }, null, 2);
  }

  return JSON.stringify({
    mcpServers: {
      'ritual-agent-wallet': {
        command: 'npx',
        args: ['-y', '@ritkey/mcp'],
        env: { RITKEY_API_URL: apiUrl, RITKEY_API_KEY: apiKey },
      },
    },
  }, null, 2);
}

/** Tiny JSON syntax highlighter — emits class-tagged HTML. Pass-through for non-JSON (CLI). */
export function highlight(json: string): string {
  const esc = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // If it doesn't look like JSON, return escaped only (preserves CLI command formatting)
  if (!/^\s*[\{\[]/.test(json)) return esc;
  return esc
    .replace(/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)/g, '<span class="tok-key">$1</span>$2')
    .replace(/(:\s*)("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")/g, '$1<span class="tok-str">$2</span>')
    .replace(/(\[\s*|,\s*)("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")/g, '$1<span class="tok-str">$2</span>')
    .replace(/(:\s*)(true|false|null|-?\d+(?:\.\d+)?)/g, '$1<span class="tok-num">$2</span>');
}
