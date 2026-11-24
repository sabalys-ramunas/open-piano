// Tiny static server for the spike (localhost only).
//   node serve.mjs [port] [--coi]
// --coi adds COOP/COEP so the page is cross-origin isolated
// (SharedArrayBuffer, so onnxruntime-web can use WASM threads).
// POST /upload/<dir>/<stem>.f32 saves separated stems under results/audio/ so
// bench.mjs can score them; nothing leaves this machine.
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname);
const port = Number(process.argv[2] ?? 5191);
const coi = process.argv.includes('--coi');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.json': 'application/json', '.css': 'text/css' };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (coi) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST' && url.pathname.startsWith('/upload/')) {
    const rel = normalize(url.pathname.slice('/upload/'.length));
    if (rel.includes('..') || !/^[\w./-]+\.(f32|json)$/.test(rel)) { res.writeHead(400).end(); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const file = join(root, 'results', 'audio', rel);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, Buffer.concat(chunks));
      res.writeHead(204).end();
    });
    return;
  }

  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  let st;
  try { st = statSync(file); } catch { res.writeHead(404).end('not found'); return; }
  if (!st.isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': st.size });
  createReadStream(file).pipe(res);
});
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/ ${coi ? '(cross-origin isolated)' : '(not isolated)'}`));
