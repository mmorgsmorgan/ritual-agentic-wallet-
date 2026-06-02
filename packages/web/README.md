# Ritkey Web — Next.js landing page

Public landing page for Ritual Agent Wallet. Pure marketing + interactive MCP installer.

## Develop

```bash
npm install
npm run dev -w @ritkey/web
# → http://localhost:4321
```

## Deploy on Vercel

Connect the repo and set:

| Setting              | Value                          |
| -------------------- | ------------------------------ |
| Root Directory       | `packages/web`                 |
| Framework Preset     | Next.js (auto-detected)        |
| Build Command        | `next build` (auto)            |
| Output Directory     | `.next` (auto)                 |
| Install Command      | `npm install`                  |

The video and logo live in `public/` and Vercel serves them with edge caching.
