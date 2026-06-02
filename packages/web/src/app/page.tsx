import Image from 'next/image';
import { Installer } from '@/components/Installer';
import { SectionReveal } from '@/components/SectionReveal';
import { CopyButton } from '@/components/CopyButton';

const CREATE_PROMPT = `Create a Ritkey wallet for me. Walk me through any keys
I need to save and explain what each one is for.`;

const DAILY_PROMPTS: { title: string; text: string }[] = [
  { title: 'Check balance',
    text: `What's my Ritkey wallet balance?` },
  { title: 'Get testnet tokens',
    text: `Fund my Ritkey wallet from the faucet.` },
  { title: 'Send tokens',
    text: `Send 0.01 RIT from my Ritkey wallet to 0xABC...
(Your agent will ask for your saved signing key.)` },
  { title: 'Sign a message',
    text: `Sign the message "hello world" with my Ritkey wallet.
(Your agent will ask for your saved signing key.)` },
  { title: 'Set a low-balance alert',
    text: `Alert me when my Ritkey wallet balance drops below 0.1 RIT.
Use this notification URL: https://your-webhook.example.com/ritkey` },
];

const TOOL_GROUPS: { title: string; tools: string[] }[] = [
  {
    title: 'Wallet Management',
    tools: ['create_wallet', 'import_wallet', 'list_wallets', 'get_wallet_info', 'get_balance', 'send_transaction', 'sign_message', 'fund_wallet', 'export_key', 'sweep_and_archive'],
  },
  { title: 'Webhooks',    tools: ['create_webhook', 'list_webhooks', 'update_webhook', 'delete_webhook', 'test_webhook'] },
  { title: 'Alert Rules', tools: ['create_alert_rule', 'list_alert_rules', 'update_alert_rule', 'delete_alert_rule'] },
  { title: 'Events',      tools: ['list_events'] },
  { title: 'Ritual Skills',       tools: ['list_ritual_skills', 'read_ritual_skill', 'read_ritual_rules'] },
  { title: 'Network Information', tools: ['get_chain_info'] },
];

export default function Home() {
  return (
    <main className="relative mx-auto max-w-4xl px-6 py-16 sm:py-24 sm:px-8">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between mb-20 animate-fade-in">
        <a href="/" className="flex items-center gap-3 group">
          <Image
            src="/logo.png"
            alt="Ritual Agent Wallet"
            width={40}
            height={40}
            priority
            className="drop-shadow-[0_0_20px_rgba(212,162,76,0.4)] group-hover:drop-shadow-[0_0_28px_rgba(212,162,76,0.7)] transition-all"
          />
          <span className="font-display text-lg tracking-wider text-cream-100 group-hover:text-cream-50 transition-colors">
            Ritkey
          </span>
        </a>
        <nav className="flex items-center gap-6 text-sm text-cream-300">
          <a className="hover:text-cream-100 transition-colors" href="https://github.com/mmorgsmorgan/ritual-agentic-wallet-">GitHub</a>
          <a className="hover:text-cream-100 transition-colors" href="https://www.npmjs.com/package/@ritkey/mcp">npm</a>
        </nav>
      </header>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="mb-24 animate-fade-up">
        <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl leading-[1.05] tracking-tight mb-6">
          <span className="block text-cream-50">Ritual</span>
          <span className="gold-shimmer block">Agent Wallet</span>
        </h1>
        <p className="text-lg text-cream-200 max-w-2xl leading-relaxed mb-3">
          MPC wallets built for AI agents on Ritual Chain.
        </p>
        <p className="text-cream-300 max-w-2xl leading-relaxed mb-8">
          Give your AI agents secure, threshold-signed wallets they can control through HTTP APIs or
          MCP. No browser extensions. No exposed seed phrases. Full webhook and alert support for every
          critical wallet event.
        </p>
        <div className="flex flex-wrap gap-2">
          {['Shamir 2-of-3 MPC', 'HMAC-secured webhooks', 'Real-time alert rules', 'MCP compatible', 'MIT Licensed'].map((b) => (
            <span key={b} className="inline-flex items-center gap-2 rounded-full border border-gold-700/30 bg-ink-200/60 px-3 py-1 text-[12px] font-mono text-cream-200 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-gold-300 animate-glow-pulse" />
              {b}
            </span>
          ))}
        </div>
      </section>

      {/* ── Compatible clients ─────────────────────────────────── */}
      <SectionReveal>
        <section className="mb-24">
          <h2 className="font-display text-3xl text-cream-50 mb-3">Connect Your Agent in Minutes</h2>
          <p className="text-cream-300 mb-6">
            Install with a single configuration and start managing wallets immediately.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {['Claude Desktop', 'Cursor', 'Cline', 'Windsurf', 'VS Code'].map((c) => (
              <div key={c} className="frost rounded-lg px-4 py-3.5 text-center text-sm text-cream-100 hover:border-gold-400/50 transition-colors">
                {c}
              </div>
            ))}
          </div>
        </section>
      </SectionReveal>

      {/* ── Interactive installer ──────────────────────────────── */}
      <SectionReveal>
        <Installer />
      </SectionReveal>

      {/* ── Create your first wallet ───────────────────────────── */}
      <SectionReveal>
        <section className="mt-24">
          <h2 className="font-display text-3xl text-cream-50 mb-3">Create Your First Wallet</h2>
          <p className="text-cream-300 mb-6">
            Open a fresh chat in your AI app. Paste this. Your agent will create a wallet, then walk you
            through what to save and where to put it.
          </p>

          <div className="frost rounded-xl overflow-hidden mb-8 animate-glow-pulse">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gold-700/20 bg-ink-300/60">
              <span className="text-cream-400 uppercase tracking-wider text-[11px] font-mono">paste into your AI</span>
              <CopyButton text={CREATE_PROMPT} />
            </div>
            <pre className="px-5 py-5 text-[14px] font-mono text-cream-100 leading-relaxed whitespace-pre-wrap">{CREATE_PROMPT}</pre>
          </div>

          {/* Reassurance: the agent does the heavy lifting */}
          <div className="rounded-xl border border-gold-400/40 bg-gradient-to-br from-ink-200/80 to-ink-300/80 backdrop-blur-md p-6">
            <div className="font-mono text-gold-300 text-sm uppercase tracking-[0.18em] mb-3">
              What your agent will do
            </div>
            <ol className="space-y-3 text-cream-200">
              <li className="flex gap-3">
                <span className="font-mono text-gold-300 text-sm pt-0.5">1</span>
                <span>Create a fresh wallet on Ritual Chain and show you its address — the 0x… string people can send funds to.</span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-gold-300 text-sm pt-0.5">2</span>
                <span>Hand you <strong className="text-cream-50">two recovery keys</strong>. The agent will name them and explain what each is for.</span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-gold-300 text-sm pt-0.5">3</span>
                <span>Tell you to <strong className="text-cream-50">save them right then</strong> — they&apos;re only shown once. The agent will suggest where: a password manager for one, somewhere offline for the other.</span>
              </li>
            </ol>
            <p className="mt-5 pt-5 border-t border-gold-700/15 text-sm text-cream-300">
              <strong className="text-cream-100">You don&apos;t need to know what the keys are.</strong> Just save what the agent tells you to save, where it tells you to save it. If you lose them, the wallet can&apos;t recover funds — but as long as you copy what your agent shows you into a safe place, you&apos;re set.
            </p>
          </div>

          <div className="mt-6 rounded-lg border border-gold-700/30 bg-ink-200/50 p-4 text-sm text-cream-400">
            <strong className="text-cream-200">Heads up — shared demo:</strong>{' '}
            The default config uses a shared demo wallet. Everyone who copies it points at the same on-chain
            address. Great for trying things out, not for holding real funds.
          </div>
        </section>
      </SectionReveal>

      {/* ── Get your own wallet (self-host) ───────────────────── */}
      <SectionReveal>
        <section className="mt-24">
          <h2 className="font-display text-3xl text-cream-50 mb-3">Get Your Own Wallet</h2>
          <p className="text-cream-300 mb-8 max-w-2xl">
            Five minutes, ~$5/month. Deploy the wallet service to your own Railway account. Result: a
            wallet that nobody else can touch — only your AI agent (with your saved keys) can sign for it.
          </p>

          <div className="frost rounded-xl p-6 mb-6">
            <div className="grid sm:grid-cols-3 gap-6">
              <Step n={1} title="Fork &amp; deploy">
                Fork the repo on GitHub, then on Railway: <em>New Project → Deploy from GitHub repo</em>.
              </Step>
              <Step n={2} title="Add a 1 GB volume">
                <em>Settings → Volumes → New Volume</em> at <code className="font-mono text-gold-200">/data</code>.
                This is where your wallet lives.
              </Step>
              <Step n={3} title="Set two env vars">
                <code className="font-mono text-gold-200">ENCRYPTION_KEY</code> and{' '}
                <code className="font-mono text-gold-200">API_KEY</code> — generate each with one command (see runbook).
              </Step>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <a
              href="https://github.com/mmorgsmorgan/ritual-agentic-wallet-/blob/main/RAILWAY-DEPLOY.md"
              className="inline-flex items-center gap-2 rounded-md bg-gold-300 text-ink-400 px-5 py-2.5 text-sm font-semibold hover:bg-gold-200 transition-colors"
            >
              Open the deploy runbook →
            </a>
            <a
              href="https://railway.com/new"
              className="inline-flex items-center gap-2 rounded-md border border-gold-700/40 bg-ink-200/60 px-5 py-2.5 text-sm font-mono text-cream-100 backdrop-blur-sm hover:border-gold-400 transition-colors"
            >
              Open Railway
            </a>
          </div>

          <p className="mt-6 text-sm text-cream-400">
            After it&apos;s up, expand <strong className="text-cream-200">Advanced</strong> in the installer
            above, switch to <em>Local (self-hosted)</em>, and paste your service URL + key.
          </p>
        </section>
      </SectionReveal>

      {/* ── Day-to-day use ─────────────────────────────────────── */}
      <SectionReveal>
        <section className="mt-24">
          <h2 className="font-display text-3xl text-cream-50 mb-3">Day-to-Day Use</h2>
          <p className="text-cream-300 mb-6">
            After your wallet exists, these prompts cover the common operations.
          </p>
          <div className="space-y-3">
            {DAILY_PROMPTS.map((p) => (
              <div key={p.title} className="frost rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gold-700/20 bg-ink-300/60">
                  <span className="text-cream-400 uppercase tracking-wider text-[11px] font-mono">{p.title}</span>
                  <CopyButton text={p.text} />
                </div>
                <pre className="px-5 py-4 text-[13px] font-mono text-cream-100 leading-relaxed whitespace-pre-wrap">{p.text}</pre>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-cream-300">
            For anything that sends or signs, the agent will ask you for the signing key you saved
            when you created the wallet. Paste it from your password manager. Agents don&apos;t hold
            onto secrets between sessions, by design.
          </p>
        </section>
      </SectionReveal>

      {/* ── Tool catalog ───────────────────────────────────────── */}
      <SectionReveal>
        <section className="mt-24">
          <h2 className="font-display text-3xl text-cream-50 mb-3">Available Tools</h2>
          <p className="text-cream-300 mb-8">
            25 built-in tools designed specifically for agentic applications.
          </p>
          <div className="space-y-8">
            {TOOL_GROUPS.map((g) => (
              <div key={g.title}>
                <h3 className="font-mono uppercase tracking-[0.18em] text-[12px] text-gold-300 mb-3">
                  {g.title}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {g.tools.map((t) => (
                    <div key={t} className="frost rounded-md px-3 py-2 font-mono text-[13px] text-cream-100">
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </SectionReveal>

      {/* ── Security ───────────────────────────────────────────── */}
      <SectionReveal>
        <section className="mt-24">
          <h2 className="font-display text-3xl text-cream-50 mb-8">Security First</h2>
          <div className="grid sm:grid-cols-2 gap-5">
            <Card title="Threshold Signing">
              <p>Powered by Shamir 2-of-3 secret sharing.</p>
              <ul className="mt-2 space-y-1 text-cream-300 text-sm list-disc list-inside marker:text-gold-400">
                <li>Server holds one key share</li>
                <li>Agent holds one key share</li>
                <li>Cold storage holds one key share</li>
              </ul>
              <p className="mt-3 text-sm text-cream-300">No single participant can authorize transactions alone.</p>
            </Card>
            <Card title="Secure Webhooks">
              <ul className="space-y-1 text-cream-300 text-sm list-disc list-inside marker:text-gold-400">
                <li>HMAC signature verification</li>
                <li>SSRF protection</li>
                <li>DNS rebinding protection</li>
                <li>Exponential retry delivery</li>
              </ul>
            </Card>
            <Card title="Intelligent Alerts">
              <p>Receive notifications for:</p>
              <ul className="mt-2 space-y-1 text-cream-300 text-sm list-disc list-inside marker:text-gold-400">
                <li>Spend threshold violations</li>
                <li>Unusual recipients</li>
                <li>Key export warnings</li>
                <li>Low balance conditions</li>
              </ul>
            </Card>
            <Card title="Import &amp; Export">
              <p className="text-cream-300 text-sm">
                Bring your own private key or export wallets to MetaMask, Rabby, or other compatible
                wallets. Exported wallets are automatically archived for additional safety.
              </p>
            </Card>
            <Card title="Sybil Protection" full>
              <p className="text-cream-300 text-sm">
                One wallet per API key by default to prevent abuse and simplify wallet management.
              </p>
            </Card>
          </div>
        </section>
      </SectionReveal>

      {/* ── Troubleshooting ────────────────────────────────────── */}
      <SectionReveal>
        <section className="mt-24">
          <h2 className="font-display text-3xl text-cream-50 mb-8">Troubleshooting</h2>
          <div className="space-y-4">
            <Card title="Tools Not Appearing">
              <p className="text-cream-300 text-sm">
                Completely restart your MCP client after installation. MCP servers launch during application startup.
              </p>
            </Card>
            <Card title='"npx" Not Found'>
              <p className="text-cream-300 text-sm">
                Install Node.js 18 or newer from{' '}
                <a className="text-gold-300 hover:underline" href="https://nodejs.org">nodejs.org</a>.
              </p>
            </Card>
            <Card title="Authentication Errors">
              <ul className="space-y-1 text-cream-300 text-sm list-disc list-inside marker:text-gold-400">
                <li><strong className="text-cream-100">Hosted Mode:</strong> verify your bearer token.</li>
                <li><strong className="text-cream-100">Local Mode:</strong> verify that your <code className="font-mono text-gold-200">RITKEY_API_KEY</code> matches the key generated by your service.</li>
              </ul>
            </Card>
          </div>
        </section>
      </SectionReveal>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <SectionReveal>
        <section className="mt-24 mb-8">
          <h2 className="font-display text-3xl text-cream-50 mb-3">Open Source</h2>
          <p className="text-cream-300 max-w-2xl">
            Ritual Agent Wallet is released under the MIT License. Built for autonomous agents, AI applications, and Ritual-native dApps.
          </p>
        </section>
      </SectionReveal>

      <footer className="pt-8 border-t border-gold-700/20 flex flex-wrap items-center justify-between gap-3 text-sm text-cream-400">
        <div>
          MIT —{' '}
          <a className="text-gold-300 hover:underline" href="https://github.com/mmorgsmorgan/ritual-agentic-wallet-">
            github.com/mmorgsmorgan/ritual-agentic-wallet-
          </a>
        </div>
        <div className="font-mono text-[12px]">Chain 1979 · Ritual</div>
      </footer>
    </main>
  );
}

function Card({ title, children, full = false }: { title: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`frost rounded-xl p-5 ${full ? 'sm:col-span-2' : ''}`}>
      <h3 className="font-mono uppercase tracking-[0.18em] text-[12px] text-gold-300 mb-3">
        {title}
      </h3>
      <div className="text-cream-200">{children}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-display text-2xl text-gold-300 leading-none">{n}</span>
        <span className="font-mono uppercase tracking-[0.14em] text-[11px] text-cream-300">
          {title}
        </span>
      </div>
      <p className="text-sm text-cream-300 leading-relaxed">{children}</p>
    </div>
  );
}

