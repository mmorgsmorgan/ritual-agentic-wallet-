import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-32 text-center">
      <h1 className="font-display text-6xl gold-shimmer mb-4">404</h1>
      <p className="text-cream-200 text-lg mb-8">This page wasn&apos;t forged.</p>
      <Link
        href="/"
        className="inline-block rounded-md border border-gold-700/40 bg-ink-200/60 px-5 py-2.5 text-sm font-mono text-cream-100 backdrop-blur-sm hover:border-gold-400 hover:text-cream-50 transition-colors"
      >
        ← Return home
      </Link>
    </main>
  );
}
