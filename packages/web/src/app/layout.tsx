import type { Metadata } from 'next';
import { Cinzel, Inter, JetBrains_Mono } from 'next/font/google';
import { VideoBackground } from '@/components/VideoBackground';
import './globals.css';

/**
 * Typography pairs an ornate display serif (Cinzel — echoes the key's
 * intricate bow) with neutral body (Inter) and code (JetBrains Mono).
 */
const display = Cinzel({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ritual Agent Wallet — MPC wallets for AI agents',
  description:
    'Threshold-signed wallets on Ritual Chain that your agent can drive over HTTP or MCP. One-click install for Claude, Cursor, Cline, Windsurf, and VS Code.',
  metadataBase: new URL('https://ritkey.dev'),
  openGraph: {
    title: 'Ritual Agent Wallet',
    description: 'MPC wallets built for AI agents on Ritual Chain.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Ritual Agent Wallet' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ritual Agent Wallet',
    description: 'MPC wallets built for AI agents on Ritual Chain.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <VideoBackground />
        {children}
      </body>
    </html>
  );
}
