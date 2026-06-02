'use client';

import { useState } from 'react';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — silent */
    }
  };
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-[11px] font-mono transition-colors ${
        copied
          ? 'border-gold-300 text-gold-200'
          : 'border-gold-700/40 text-cream-300 hover:border-gold-400 hover:text-cream-100'
      }`}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
