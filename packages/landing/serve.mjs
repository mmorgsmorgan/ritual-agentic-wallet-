/**
 * Tiny dev server for the landing page. No deps.
 *   node packages/landing/serve.mjs [port]
 *
 * Routes:
 *   /       → index.html
 *   /mcp    → mcp.html  (interactive MCP installer)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);

const [indexHtml, mcpHtml] = await Promise.all([
  readFile(path.join(__dirname, 'index.html')),
  readFile(path.join(__dirname, 'mcp.html')),
]);

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  const url = (req.url || '/').split('?')[0].replace(/\/$/, '') || '/';
  let body = indexHtml;
  if (url === '/mcp' || url === '/mcp.html') body = mcpHtml;

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
});

server.listen(port, () => {
  console.log(`Landing page → http://localhost:${port}`);
  console.log(`MCP installer → http://localhost:${port}/mcp`);
});
