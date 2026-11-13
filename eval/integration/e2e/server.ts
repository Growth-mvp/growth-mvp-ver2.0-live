/* 評価用の実行サーバー：画面（バンドル）と、本番と同じ計画書のAPIを、ローカルのPGlite（隔離DB）につないで配信する。
 * 本番DB・本番の認証・実AIには接続しない。 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { createTestEnv, IDS } from '../../db/testEnv';

const PORT = Number(process.env.E2E_PORT ?? 4174);
const here = path.dirname(fileURLToPath(import.meta.url));
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' };

async function main() {
  const env = await createTestEnv({ apiEnabled: true });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
      if (url.pathname.startsWith('/api/')) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
        const request = new Request(url.toString(), {
          method: req.method,
          headers,
          body: hasBody ? Buffer.concat(chunks) : undefined,
        });
        const out = await env.handle(request);
        const buf = Buffer.from(await out.arrayBuffer());
        res.writeHead(out.status, { 'content-type': out.headers.get('content-type') ?? 'application/json' });
        res.end(buf);
        return;
      }
      if (url.pathname === '/__state') {
        const strategy = await env.strategyRow(IDS.strategyA);
        const body = JSON.stringify({ plans: await env.planRows(), events: await env.eventRows(), strategy });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body);
        return;
      }
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.join(here, name);
      if (!file.startsWith(here) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e instanceof Error ? e.message : e));
    }
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`listening ${PORT}`));
}

main().catch((e) => {
  console.error('server error', e);
  process.exit(2);
});
