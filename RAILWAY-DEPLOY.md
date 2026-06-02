# Deploy Your Own Ritkey on Railway

This deploys the Ritkey wallet service to your own Railway account. Result:
**a wallet that belongs only to you**, no sharing with anyone else.

Takes about 5 minutes. Costs roughly $5/month on Railway's free tier (idle most
of the time).

## What you get

- A wallet service running at `https://<your-domain>.up.railway.app`
- Your own `API_KEY` — the only thing that can talk to your service
- A persistent SQLite database on a 1 GB volume
- Sole control over your wallet on Ritual Chain

## Steps

### 1. Click Deploy

> **One-click template:** _link goes here once the template is created in the
> Railway dashboard._
>
> For now, the manual fork-and-deploy below works.

### 2. Manual deploy (until the template exists)

1. **Fork** [`mmorgsmorgan/ritual-agentic-wallet-`](https://github.com/mmorgsmorgan/ritual-agentic-wallet-) on GitHub.
2. **Sign in** to [Railway](https://railway.com/) with GitHub.
3. **New Project → Deploy from GitHub repo** → pick your fork.
4. Railway auto-detects `railway.json` and uses the included `Dockerfile`.

### 3. Add a persistent volume

In your service: **Settings → Volumes → New Volume**

- **Mount path:** `/data`
- **Size:** 1 GB

Without this, every redeploy wipes your wallet. The volume must be in place
**before you create any wallets you care about**.

### 4. Set environment variables

**Settings → Variables**, add:

| Key | How to generate |
|---|---|
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `API_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NODE_ENV` | `production` |
| `DATABASE_PATH` | `/data/wallets.db` |
| `PORT` | `3000` |
| `RITUAL_RPC_URL` | `https://rpc.ritualfoundation.org` |

> **Save `ENCRYPTION_KEY` somewhere safe.** Lose it and every encrypted share
> on your service becomes unreadable. Lose them all and every wallet on your
> service is unrecoverable. Treat it like the master key it is.

### 5. Get your public URL

**Settings → Networking → Generate Domain** → port `3000`.

You'll get something like `your-ritkey.up.railway.app`. That's your
`RITKEY_API_URL`.

### 6. Verify

```bash
curl https://your-ritkey.up.railway.app/health
# {"status":"ok","chain":"Ritual (1979)","timestamp":"..."}
```

### 7. Plug it into your AI

On the [Ritkey landing page](https://ritkey.dev) (or wherever you're reading
the install snippet), expand **Advanced** and switch the mode to
**Local (self-hosted)**. Fill in:

- **Service URL:** the Railway URL from step 5
- **Service Key:** your `API_KEY` from step 4

Copy the generated config into your AI client's MCP settings. Restart the
client. You now have your own wallet that nobody else can touch.

## How much it costs

Railway's free tier covers light usage. Expect roughly **$3–7/month**
depending on traffic. The wallet service idles most of the time so cost
is mostly the persistent volume + minimum-allocation compute.

## Recovery

Two failure modes to plan for:

1. **Railway loses your service** — you can redeploy from the same fork and
   reattach the volume. As long as the volume + `ENCRYPTION_KEY` survive,
   all wallets and shares recover.

2. **You lose `ENCRYPTION_KEY`** — every encrypted share on the service is now
   gibberish. The only recovery path is for users to reconstruct each wallet
   using its `agentShard` + `backupShard` and re-import on a fresh service.
   This is why both shards matter: even total server loss is recoverable if
   users kept their cold-storage shard.
