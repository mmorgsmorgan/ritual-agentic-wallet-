#!/usr/bin/env node
/**
 * Copy non-TS assets (skill markdown, dashboard html/css/js) into dist/ so
 * the compiled package is self-contained when published to npm.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function copyDir(src, dst) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-assets] source missing: ${src}`);
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const targets = [
  ['src/skills', 'dist/skills'],
  ['src/dashboard', 'dist/dashboard'],
];

for (const [src, dst] of targets) {
  const fullSrc = path.join(root, src);
  const fullDst = path.join(root, dst);
  copyDir(fullSrc, fullDst);
  console.log(`[copy-assets] ${src} → ${dst}`);
}
