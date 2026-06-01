/**
 * Tiny dev server for the landing page. No deps.
 *   node packages/landing/serve.mjs [port]
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);

const indexHtml = await readFile(path.join(__dirname, 'index.html'));

const server = http.createServer((req, res) => {
  // Single-page: serve index.html for everything except favicon.
  if (req.url === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(indexHtml);
});

server.listen(port, () => {
  console.log(`Landing page → http://localhost:${port}`);
});
