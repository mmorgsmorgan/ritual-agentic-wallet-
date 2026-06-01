/**
 * Tiny dev server for the landing page. No deps.
 *   node packages/landing/serve.mjs [port]
 *
 * Routes:
 *   /                → index.html
 *   /mcp             → mcp.html (interactive MCP installer)
 *   /assets/<file>   → static files under ./assets (video, images, etc.)
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);

const MIME = {
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
};

const [indexHtml, mcpHtml] = await Promise.all([
  readFile(path.join(__dirname, 'index.html')),
  readFile(path.join(__dirname, 'mcp.html')),
]);

async function serveAsset(req, res) {
  const rel = req.url.replace(/^\/assets\//, '').split('?')[0];
  const assetsDir = path.join(__dirname, 'assets');
  const filePath = path.resolve(assetsDir, rel);
  // Containment check — refuse anything that resolves outside assets/.
  if (!filePath.startsWith(assetsDir + path.sep) && filePath !== assetsDir) {
    res.writeHead(403).end();
    return;
  }
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error('not a file');
    const ext = path.extname(filePath).toLowerCase();
    const buf = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=3600',
      'Accept-Ranges': 'bytes',
    });
    res.end(buf);
  } catch {
    res.writeHead(404).end();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  if (req.url.startsWith('/assets/')) {
    return serveAsset(req, res);
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
