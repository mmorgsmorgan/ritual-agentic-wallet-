'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildConfig, highlight, type Mode, type Client, CLIENTS, PATHS } from '@/lib/configs';
import { CopyButton } from './CopyButton';

const DEFAULT_MCP_URL = 'https://zooming-gentleness-production-0d17.up.railway.app/mcp';
// Demo token baked into the page so consumers can copy-paste with zero blanks.
// This is a SHARED demo identity — all anonymous users hit the same underlying
// wallet on the service. For per-user wallets, future work issues a unique
// token to each visitor.
const DEMO_BEARER = 'cae1457844e3b1a53c0f1a08131e8abe35981aa885d8541168e167522057028f';
const STORAGE_KEY = 'ritkey-web-installer';

const CARD_LABELS: Record<string, string> = {
  'claude':       'claude_desktop_config.json',
  'claude-code':  'shell command',
  'cursor':       'mcp.json',
  'cline':        'cline_mcp_settings.json',
  'windsurf':     'mcp_config.json',
  'vscode':       '.vscode/mcp.json',
  'antigravity':  'mcp_config.json',
  'opencode':     'opencode config.json',
};

const RESTART_HINTS: Record<string, string> = {
  'claude':       'Fully quit Claude Desktop (Cmd+Q on Mac, tray-right-click → Quit on Windows) and reopen. Click the 🔨 in the input — ritual-agent-wallet should appear.',
  'claude-code':  'Run `claude mcp list` to verify it connected. The 24 tools are available in any session immediately.',
  'cursor':       'In Cursor: Settings → MCP. Toggle the server on if it isn\'t auto-loaded.',
  'cline':        'Open the Cline panel in VS Code → MCP Servers → Edit MCP Settings → paste, then save.',
  'windsurf':     'Open the Cascade panel → MCP → Refresh. Tools show up under ritual-agent-wallet.',
  'vscode':       'Open Copilot Chat → Agent mode → tools picker. You\'ll be prompted for the bearer/API key on first use — it\'s stored in VS Code secret storage.',
  'antigravity':  'Restart Antigravity. The agent loads MCP servers at startup.',
  'opencode':     'Restart your opencode session. Run `opencode mcp` to verify the connection.',
};

interface SavedState {
  mode: Mode;
  mcpUrl: string;
  bearer: string;
  apiUrl: string;
  apiKey: string;
  client: Client;
  advanced: boolean;
}

const DEFAULT_STATE: SavedState = {
  mode: 'hosted',
  mcpUrl: DEFAULT_MCP_URL,
  bearer: DEMO_BEARER,
  apiUrl: '',
  apiKey: '',
  client: 'claude',
  advanced: false,
};

export function Installer() {
  const [state, setState] = useState<SavedState>(DEFAULT_STATE);

  // Hydrate from localStorage on mount only — never on the server.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SavedState>;
      setState((s) => ({ ...s, ...parsed }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  const update = <K extends keyof SavedState>(key: K, value: SavedState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const config = useMemo(
    () => buildConfig(state.client, state),
    [state]
  );
  const configHtml = useMemo(() => highlight(config), [config]);
  const clientKind = CLIENTS.find((c) => c.id === state.client)?.kind ?? 'json';
  const cardLabel = CARD_LABELS[state.client] ?? 'mcp config';

  return (
    <div className="space-y-12">
      <section>
        <h2 className="font-display text-3xl text-cream-50 mb-2">Add It To Your AI</h2>
        <p className="text-cream-300 mb-6">
          Pick the AI app you use. Copy the config. Paste it into the file shown. Restart the app.
          That&apos;s it — your agent will have wallet superpowers.
        </p>

        <Note>
          <strong className="text-cream-100">Already have other MCP servers?</strong> If your config file isn&apos;t empty,
          add the <code className="font-mono text-gold-200">ritual-agent-wallet</code> entry alongside what&apos;s already
          there. Don&apos;t replace the whole file.
        </Note>

        <div className="flex flex-wrap gap-1 border-b border-gold-700/30 mb-5">
          {CLIENTS.map((c) => (
            <button
              key={c.id}
              onClick={() => update('client', c.id)}
              className={`px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
                state.client === c.id
                  ? 'text-cream-50 border-gold-300'
                  : 'text-cream-400 border-transparent hover:text-cream-100'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="frost rounded-xl overflow-hidden animate-fade-in" key={state.client}>
          {/* CLI clients show "Paste in terminal" hint; JSON clients show file path(s) */}
          {clientKind === 'cli' ? (
            <div className="px-4 py-2.5 border-b border-gold-700/20 bg-ink-300/40">
              <div className="font-mono text-[12px] leading-tight">
                <div className="text-cream-400 uppercase tracking-wider text-[10px]">Terminal</div>
                <div className="text-cream-100 mt-0.5">Paste this command into your shell — no file edit needed.</div>
              </div>
            </div>
          ) : (
            PATHS[state.client].map(({ os, path }) => (
              <div key={path} className="flex items-start justify-between gap-3 px-4 py-2.5 border-b border-gold-700/20 bg-ink-300/40">
                <div className="font-mono text-[12px] leading-tight">
                  <div className="text-cream-400 uppercase tracking-wider text-[10px]">{os}</div>
                  <div className="text-cream-100 mt-0.5">{path}</div>
                </div>
                <CopyButton text={path} label="Copy path" />
              </div>
            ))
          )}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gold-700/20 bg-ink-300/60">
            <span className="text-cream-400 uppercase tracking-wider text-[11px] font-mono">
              {cardLabel}
            </span>
            <CopyButton text={config} label={clientKind === 'cli' ? 'Copy command' : 'Copy config'} />
          </div>
          <pre className="overflow-x-auto p-4 text-[13px] font-mono leading-relaxed whitespace-pre">
            <code dangerouslySetInnerHTML={{ __html: configHtml }} />
          </pre>
        </div>

        {/* Per-client restart hint */}
        <p className="mt-4 text-sm text-cream-300">{RESTART_HINTS[state.client]}</p>

        {/* Advanced toggle — hides the wallet-service plumbing from consumers */}
        <div className="mt-8 pt-6 border-t border-gold-700/15">
          <button
            type="button"
            onClick={() => update('advanced', !state.advanced)}
            className="text-sm text-cream-400 hover:text-cream-100 transition-colors flex items-center gap-2"
          >
            <span className="font-mono text-[11px] uppercase tracking-wider">
              {state.advanced ? '▾ Hide advanced' : '▸ Advanced — run your own service or change endpoints'}
            </span>
          </button>

          {state.advanced && (
            <div className="mt-5 space-y-5 animate-fade-in">
              <div className="inline-flex gap-1 rounded-lg border border-gold-700/30 bg-ink-200/60 p-1">
                <ModeBtn active={state.mode === 'hosted'} onClick={() => update('mode', 'hosted')}>
                  Hosted (shared demo)
                </ModeBtn>
                <ModeBtn active={state.mode === 'local'} onClick={() => update('mode', 'local')}>
                  Local (self-hosted)
                </ModeBtn>
              </div>

              {state.mode === 'hosted' ? (
                <>
                  <p className="text-sm text-cream-300">
                    The shared hosted endpoint. Anyone using this token shares one underlying wallet.
                    Fine for trying it out. Replace with your own values once you run your own service.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Server URL" value={state.mcpUrl} placeholder={DEFAULT_MCP_URL} onChange={(v) => update('mcpUrl', v)} />
                    <Field label="Auth Token" value={state.bearer} placeholder="hex…" onChange={(v) => update('bearer', v)} />
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-cream-300">
                    Point the MCP at your own wallet service. Run <code className="font-mono text-gold-200">npm run dev:service</code>{' '}
                    from the <a className="text-gold-300 hover:underline" href="https://github.com/mmorgsmorgan/ritual-agentic-wallet-">monorepo</a> first.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Service URL" value={state.apiUrl} placeholder="https://your-ritkey-service" onChange={(v) => update('apiUrl', v)} />
                    <Field label="Service Key" value={state.apiKey} placeholder="rk_…" onChange={(v) => update('apiKey', v)} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-md text-sm transition-colors ${
        active ? 'bg-ink-300 text-cream-50' : 'text-cream-400 hover:text-cream-100'
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-cream-400 font-mono">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-gold-700/40 bg-ink-200/80 px-3 py-2.5 text-sm font-mono text-cream-100 placeholder:text-cream-500 focus:border-gold-300 focus:outline-none focus:ring-1 focus:ring-gold-300/40 transition-colors backdrop-blur-sm"
      />
    </label>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-gold-400 bg-ink-200/60 px-4 py-3 text-sm text-cream-300 rounded-r">
      {children}
    </div>
  );
}
