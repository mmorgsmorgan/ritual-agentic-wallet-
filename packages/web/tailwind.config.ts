import type { Config } from 'tailwindcss';

/**
 * Palette is derived from the golden-key background video:
 *   - `gold` family from the brass body of the key + warm highlights
 *   - `ink` family from the warm dark space the key sits against
 *   - `cream` for body text — warm off-white that reads against gold without glare
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          50:  '#fbf3df',
          100: '#f4e4bc',
          200: '#e8cd8a',
          300: '#d4a24c',
          400: '#c08a30',
          500: '#a37419',
          600: '#84600f',
          700: '#604507',
          800: '#3f2d04',
          900: '#231904',
        },
        ink: {
          50:  '#2d251c',
          100: '#241d16',
          200: '#1a1410',
          300: '#120e0a',
          400: '#0a0908',
          500: '#070605',
        },
        cream: {
          50:  '#f7efdc',
          100: '#e8dcc4',
          200: '#cdbf9c',
          300: '#a89a76',
          400: '#94887a',
          500: '#74695c',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        sans:    ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      animation: {
        'fade-up':    'fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in':    'fadeIn 1.2s ease-out both',
        'shimmer':    'shimmer 3s ease-in-out infinite',
        'glow-pulse': 'glowPulse 4s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        shimmer: {
          '0%,100%': { backgroundPosition: '200% center' },
          '50%':     { backgroundPosition: '-200% center' },
        },
        glowPulse: {
          '0%,100%': { boxShadow: '0 0 24px -8px rgba(212, 162, 76, 0.35)' },
          '50%':     { boxShadow: '0 0 48px -8px rgba(212, 162, 76, 0.6)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};

export default config;
