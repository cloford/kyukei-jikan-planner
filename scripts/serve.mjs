import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../dist/',import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.png':'image/png', '.json':'application/json', '.webmanifest':'application/manifest+json' };
http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const filename = path.resolve(root,'.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root)) throw new Error('Outside static root');
    const bytes = await readFile(filename);
    response.writeHead(200,{ 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(8765,'127.0.0.1',()=>console.log('http://127.0.0.1:8765/'));
