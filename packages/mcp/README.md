# @ritkey/mcp

MCP server for Ritkey - AI agent tools for wallet operations + bundled Ritual Chain skills and documentation.

## Features

- **16 MCP Tools** - Wallet operations, transactions, Ritual Chain interactions
- **11 Resources** - Bundled Ritual skill documentation
- **1 Bootstrap Prompt** - Cold-start guide for agents
- **Auto-discovery** - Agents can explore capabilities via MCP protocol

## Installation

```bash
npm install @ritkey/mcp
```

## Usage

Configure in Claude Desktop / Cursor:

```jsonc
{
  "mcpServers": {
    "ritkey": {
      "command": "npx",
      "args": ["@ritkey/mcp"],
      "env": {
        "ENCRYPTION_KEY": "your-32-byte-hex-key",
        "API_KEY": "your-secret",
        "DATABASE_PATH": "/path/to/wallets.db"
      }
    }
  }
}
```

## Tools

- `create_wallet` - Create a new MPC wallet
- `get_balance` - Check native + RitualWallet balance
- `send_transaction` - Sign and broadcast transactions
- `call_http_precompile` - Invoke HTTP precompile (0x0801)
- `call_llm_precompile` - Invoke LLM precompile (0x0802)
- `fund_wallet` - Claim one-time faucet drip
- And 10 more...

## Resources

Bundled Ritual Chain documentation:
- `ritual-skill://ritual-dapp-overview`
- `ritual-skill://ritual-wallet`
- `ritual-skill://ritual-http`
- `ritual-skill://ritual-llm`
- And 7 more...

## License

MIT
