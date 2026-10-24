/* ============================================================
   One Step Ahead — server.js
   Minimal static server + Anthropic Messages API proxy.
   Node 18+ (uses built-in fetch). Zero dependencies.
   Env: ANTHROPIC_API_KEY (live mode), MODEL (default below), PORT.
   The API key is only ever read from the environment — it is never
   committed, never sent to the browser.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Tiny optional .env loader (real environment variables always win).
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* no .env — fine, demo mode or real env vars */ }

const { ANTHROPIC_API_KEY, MODEL = 'claude-sonnet-4-5', PORT = 3000 } = process.env;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };

http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/step') {
    let body = '', tooBig = false;
    for await (const chunk of req) { body += chunk; if (body.length > 100000) { tooBig = true; break; } }
    if (tooBig) { res.writeHead(413, { 'content-type': 'application/json' }); return res.end('{"error":"payload too large"}'); }
    try {
      const { system, messages, max_tokens = 400 } = JSON.parse(body);
      if (!system || !Array.isArray(messages) || !messages.length || messages.length > 30) throw new Error('bad request');
      if (!ANTHROPIC_API_KEY) throw new Error('No API key configured on the server (set ANTHROPIC_API_KEY).');
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens, temperature: 0.4, system, messages })
      });
      const data = await upstream.json(); // low temperature (0.4) for consistency
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.normalize(path.join(__dirname, rel));
  if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`One Step Ahead -> http://localhost:${PORT}  ${ANTHROPIC_API_KEY ? 'live mode' : '(no key - the app will run in demo mode)'}`));
