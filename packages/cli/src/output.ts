/**
 * Output helpers.
 *
 * No `chalk` dependency — raw ANSI escape codes are tiny and tree-shakeable.
 * Colors are disabled when stdout isn't a TTY (e.g. piped to a file) or when
 * NO_COLOR=1 is set.
 */

const isColorOn =
  process.stdout.isTTY === true && process.env.NO_COLOR !== '1';

function paint(code: string, s: string): string {
  return isColorOn ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const c = {
  dim: (s: string) => paint('2', s),
  bold: (s: string) => paint('1', s),
  red: (s: string) => paint('31', s),
  green: (s: string) => paint('32', s),
  yellow: (s: string) => paint('33', s),
  blue: (s: string) => paint('34', s),
  cyan: (s: string) => paint('36', s),
  magenta: (s: string) => paint('35', s),
};

/** Tiny table formatter — pads each column to the longest cell. */
export function table(
  rows: Array<Array<string | number | null | undefined>>,
  opts?: { headers?: string[] }
): string {
  const headers = opts?.headers ?? [];
  const data = headers.length ? [headers, ...rows] : rows;
  const stringified = data.map((r) => r.map((v) => (v == null ? '' : String(v))));

  const widths: number[] = [];
  for (const row of stringified) {
    for (let i = 0; i < row.length; i++) {
      const cell = row[i] ?? '';
      if (!widths[i] || cell.length > widths[i]!) widths[i] = cell.length;
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < stringified.length; r++) {
    const row = stringified[r]!;
    const padded = row.map((cell, i) => (cell ?? '').padEnd(widths[i] ?? 0));
    const line = padded.join('  ');
    if (headers.length && r === 0) {
      lines.push(c.bold(line));
      lines.push(c.dim(widths.map((w) => '-'.repeat(w)).join('  ')));
    } else {
      lines.push(line);
    }
  }
  return lines.join('\n');
}

/** Short prefix of a hex / uuid string for display. */
export function short(s: string | null | undefined, head = 8, tail = 6): string {
  if (!s) return c.dim('—');
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function ok(msg: string): void {
  console.log(`${c.green('✓')} ${msg}`);
}
export function info(msg: string): void {
  console.log(`${c.cyan('›')} ${msg}`);
}
export function warn(msg: string): void {
  console.warn(`${c.yellow('!')} ${msg}`);
}
export function error(msg: string): void {
  console.error(`${c.red('✗')} ${msg}`);
}

/** Render an SDK error as a one-line message + optional details. */
export function errorFromSdk(err: unknown): string {
  const e = err as { status?: number; message?: string; body?: any };
  const status = e.status ? c.dim(`[${e.status}] `) : '';
  const msg = e.message ?? String(err);
  return `${status}${msg}`;
}
