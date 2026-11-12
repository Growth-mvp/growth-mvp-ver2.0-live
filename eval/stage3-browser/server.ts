/* 新STAGE3のブラウザ検証用サーバー。実際のAPIルート（戦略書・分析・再生成・確定）を、ローカルDB（PGlite）の上で動かす。
 * 外部への接続はしない（本番DB・実OpenAI・本番の認証は使わない）。AIは決まった応答、DBは架空データ。 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { GET as getBook, PUT as putBook } from '@/app/api/stage3/strategy-book/route';
import { POST as confirmPost } from '@/app/api/stage3/strategy-book/confirm/route';
import { POST as analyzePost } from '@/app/api/stage3/adjustment/analyze/route';
import { POST as regeneratePost } from '@/app/api/stage3/adjustment/regenerate/route';
import { buildDeptProposals } from '@/lib/cascade/stage3Candidates';

const root = process.cwd();
const PGLITE_HOME = process.env.PGLITE_HOME ?? 'C:/dev/growth-mvp-tools/pglite';

export const IDS = {
  company: '00000000-0000-4000-8000-00000000c0de',
  strategy: '00000000-0000-4000-8000-0000000057a1',
  user: '00000000-0000-4000-8000-00000000ad01',
};

type Pg = { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; exec: (s: string) => Promise<unknown>; close: () => Promise<void> };

const FINAL_STORY = [
  { title: '顧客の課題', body: '既存顧客は、再発注のたびに同じ書類を手で作り直している。' },
  { title: '自社が選ばれる理由', body: '書類の作成を一度で済ませられる点で、競合より手間が少ない。' },
  { title: '勝ち筋と勝算の確かめ方', body: '再発注の処理時間が半分になれば、既存顧客の継続率が上がると見込む。' },
];

const SEED_DEPARTMENTS = [
  {
    id: 'd-sales',
    name: '営業部',
    mission: '既存顧客の深耕',
    intraDeptCollab: ['既存の連携'],
    projects: [
      {
        id: 'p-1',
        title: '既存顧客の再受注施策',
        planStatus: 'approved',
        approvedAt: '2026-11-01T00:00:00.000Z',
        okrs: [{ id: 'o-1', objective: '再受注', keyResults: ['再受注率 40%'] }],
      },
    ],
  },
  {
    id: 'd-mkt',
    name: 'マーケティング部',
    mission: '見込み客の獲得',
    projects: [{ title: '既存顧客向けセミナー' }],
  },
];

async function seed(pg: Pg) {
  await pg.exec(`
    delete from stage3_strategy_books;
    delete from strategy_data;
    delete from company_members;
    delete from companies;
    insert into companies (id, name) values ('${IDS.company}', '架空精密計測株式会社（検証用）');
    insert into company_members (company_id, user_id, role) values ('${IDS.company}', '${IDS.user}', 'admin');
  `);
  await pg.query(
    `insert into strategy_data (id, company_id, departments, stage2_final_document_edits, final_story_final)
     values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
    [
      IDS.strategy,
      IDS.company,
      JSON.stringify(SEED_DEPARTMENTS),
      JSON.stringify({
        confirmed: {
          conclusion: '既存顧客の深耕を優先し、再発注の手間を減らして継続率を上げる',
          assumptions: { external: ['市場は横ばい'], internal: ['書類作成の手順が部門ごとに違う'], implications: ['継続率の改善が売上の柱になる'] },
          confirmedAt: '2026-11-01T00:00:00.000Z',
        },
      }),
      JSON.stringify(FINAL_STORY),
    ],
  );
}

async function openDb(): Promise<Pg> {
  const entry = path.join(PGLITE_HOME, 'node_modules/@electric-sql/pglite/dist/index.js');
  const { PGlite } = (await import(pathToFileURL(entry).href)) as { PGlite: { create: () => Promise<Pg> } };
  const pg = await PGlite.create();
  await pg.exec(fs.readFileSync(path.join(root, 'eval/db/standin.sql'), 'utf8'));
  await pg.exec(`create role service_role nologin; grant usage on schema public to service_role;`);
  await pg.exec(`alter table strategy_data add column stage2_final_document_edits jsonb, add column final_story_final jsonb, add column final_story_edited jsonb;`);
  await pg.exec(fs.readFileSync(path.join(root, 'supabase/pending/20261112_stage3_strategy_books.sql'), 'utf8'));
  return pg;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>事業・部門戦略書（検証）</title><link rel="stylesheet" href="/app.css"></head>
<body class="bg-white p-6"><div id="root"></div>
<script>globalThis.__USER = '${IDS.user}';</script>
<script src="/client.js"></script></body></html>`;

/** 出力したPDFを、PDF.js（既存の依存）で1ページずつ描画する。目視の確認に使う。 */
const PDF_VIEW = (src: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#888">
<script type="module">
import * as pdfjs from '/pdfjs/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
const doc = await pdfjs.getDocument(${JSON.stringify(src)}).promise;
window.__pages = doc.numPages;
for (let i = 1; i <= doc.numPages; i += 1) {
  const page = await doc.getPage(i);
  const vp = page.getViewport({ scale: 1.4 });
  const c = document.createElement('canvas');
  c.id = 'page-' + i; c.width = vp.width; c.height = vp.height; c.style.display = 'block'; c.style.margin = '12px auto'; c.style.background = '#fff';
  document.body.appendChild(c);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let k = 0; k < px.length; k += 4) if (px[k] < 240 || px[k + 1] < 240 || px[k + 2] < 240) ink += 1;
  (window.__ink ??= []).push(ink / (c.width * c.height));
}
window.__done = true;
</script></body></html>`;

/** 検証用の補助API（画面の読み込み用の状態、6問の保存、生成の入口、PDFに渡す内容）。判定はしない。 */
async function harness(pg: Pg, req: Request, pathname: string): Promise<Response> {
  if (pathname === '/harness/state' && req.method === 'GET') {
    const r = await pg.query('select departments, revision, final_story_final from strategy_data where id = $1', [IDS.strategy]);
    const row = r.rows[0];
    return json({
      companyId: IDS.company,
      strategyId: IDS.strategy,
      companyName: '架空精密計測株式会社（検証用）',
      revision: Number(row.revision),
      departments: row.departments,
      finalStoryFinal: row.final_story_final,
    });
  }
  if (pathname === '/harness/answers' && req.method === 'POST') {
    const body = (await req.json()) as { index: number; steps: unknown[] };
    const r = await pg.query('select departments from strategy_data where id = $1', [IDS.strategy]);
    const departments = r.rows[0].departments as Array<Record<string, unknown>>;
    departments[body.index] = { ...departments[body.index], answers2: [{ chapterIndex: body.index, steps: body.steps }] };
    await pg.query('update strategy_data set departments = $2::jsonb where id = $1', [IDS.strategy, JSON.stringify(departments)]);
    return json({ ok: true });
  }
  if (pathname === '/harness/department' && req.method === 'POST') {
    const body = (await req.json()) as { op: 'add' | 'rename' | 'delete'; index?: number; name?: string; mission?: string };
    const r = await pg.query('select departments from strategy_data where id = $1', [IDS.strategy]);
    let departments = r.rows[0].departments as Array<Record<string, unknown>>;
    if (body.op === 'add') {
      departments = [...departments, { id: `dept_${Date.now()}`, name: body.name, mission: body.mission || `${body.name}のミッション`, projects: [], answers2: [] }];
    } else if (body.op === 'rename') {
      departments = departments.map((d, i) => (i === body.index ? { ...d, name: body.name, segmentName: body.name } : d));
    } else if (body.op === 'delete') {
      const target = departments[body.index ?? -1];
      const blocked = ((target?.projects as Array<Record<string, unknown>> | undefined) ?? []).some((p) => p.planStatus === 'approved');
      if (blocked) return json({ error: 'blocked' }, 409);
      departments = departments.filter((_, i) => i !== body.index);
    }
    await pg.query('update strategy_data set departments = $2::jsonb where id = $1', [IDS.strategy, JSON.stringify(departments)]);
    return json({ ok: true });
  }
  if (pathname === '/harness/generate' && req.method === 'POST') {
    const body = (await req.json()) as { index: number; mode: 'draft' | 'regen' };
    const r = await pg.query('select departments from strategy_data where id = $1', [IDS.strategy]);
    const dept = (r.rows[0].departments as Array<Record<string, unknown>>)[body.index];
    const label = body.mode === 'draft' ? '初回案' : '6問反映案';
    const projects = [
      {
        id: `cand-${body.mode}-${String(dept.id ?? dept.name)}`,
        title: `${label}：${String(dept.name)}の新しい施策`,
        reason: `${label}として、既存顧客の再発注の手間を減らす施策（検証用の案）`,
        description: '検証用の生成結果',
      },
    ];
    const proposals = buildDeptProposals(dept, {
      intraDeptCollab: [],
      interDeptCollab: [`${String(dept.name)}と協働する案（${label}）`],
      needsCollab: [`${String(dept.name)}と協働する案（${label}）`],
    });
    return json({ projects, proposals });
  }
  if (pathname === '/harness/pdf' && req.method === 'POST') {
    const body = (await req.json()) as { departmentName: string };
    const r = await pg.query('select departments from strategy_data where id = $1', [IDS.strategy]);
    const dept = (r.rows[0].departments as Array<Record<string, unknown>>).find((d) => d.name === body.departmentName);
    if (!dept) return json({ error: 'department_not_found' }, 404);
    return json({ departmentName: body.departmentName, department: dept });
  }
  if (pathname === '/harness/audit' && req.method === 'GET') {
    const g = globalThis as unknown as { __audit?: unknown[] };
    return json({ audit: g.__audit ?? [] });
  }
  if (pathname === '/harness/reset' && req.method === 'POST') {
    await seed(pg);
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  'GET /api/stage3/strategy-book': getBook,
  'PUT /api/stage3/strategy-book': putBook,
  'POST /api/stage3/strategy-book/confirm': confirmPost,
  'POST /api/stage3/adjustment/analyze': analyzePost,
  'POST /api/stage3/adjustment/regenerate': regeneratePost,
  /* 6問のテーマ（検証用の固定の問い。実際のAI生成は行わない） */
  'POST /api/generate-department-question': async (req) => {
    const body = (await req.json()) as { afterStepIndex?: number };
    const n = (body.afterStepIndex ?? -1) + 2;
    return Response.json({ step: { label: `テーマ${n}`, question: `検証用のテーマ${n}：この部門の強みは何か`, reason: '検証用の狙い', hint: '' } });
  },
};

export async function start(port: number, clientJs: string) {
  const pg = await openDb();
  (globalThis as unknown as { __pg: Pg }).__pg = pg;
  await seed(pg);

  const server = http.createServer(async (nodeReq, nodeRes) => {
    try {
      const url = new URL(nodeReq.url ?? '/', `http://localhost:${port}`);
      if (nodeReq.method === 'GET' && url.pathname === '/') {
        nodeRes.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
        return;
      }
      if (nodeReq.method === 'GET' && url.pathname === '/app.css') {
        const css = path.join(root, 'eval/stage3-browser/out/app.css');
        nodeRes.writeHead(200, { 'content-type': 'text/css; charset=utf-8' }).end(fs.existsSync(css) ? fs.readFileSync(css) : '');
        return;
      }
      if (nodeReq.method === 'GET' && url.pathname === '/client.js') {
        nodeRes.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(clientJs);
        return;
      }
      if (nodeReq.method === 'GET' && (url.pathname.startsWith('/pdfjs/') || url.pathname.startsWith('/pdf/'))) {
        const isLib = url.pathname.startsWith('/pdfjs/');
        const base = isLib ? path.join(root, 'node_modules/pdfjs-dist/build') : path.join(root, 'eval/stage3-browser/out/pdf');
        const file = path.join(base, path.normalize(url.pathname.replace(isLib ? '/pdfjs/' : '/pdf/', '')));
        if (!file.startsWith(base) || !fs.existsSync(file)) {
          nodeRes.writeHead(404).end('not found');
          return;
        }
        nodeRes.writeHead(200, { 'content-type': file.endsWith('.pdf') ? 'application/pdf' : 'text/javascript; charset=utf-8' }).end(fs.readFileSync(file));
        return;
      }
      if (nodeReq.method === 'GET' && url.pathname === '/pdfview') {
        const src = url.searchParams.get('src') ?? '/pdf/sales.pdf';
        nodeRes.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PDF_VIEW(src));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const c of nodeReq) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const req = new Request(url, {
        method: nodeReq.method,
        headers: nodeReq.headers as Record<string, string>,
        body: body && nodeReq.method !== 'GET' ? body : undefined,
      });
      let res: Response;
      if (url.pathname.startsWith('/harness/')) {
        res = await harness(pg, req, url.pathname);
      } else {
        const handler = ROUTES[`${nodeReq.method} ${url.pathname}`];
        res = handler ? await handler(req) : json({ error: 'not_found' }, 404);
      }
      nodeRes.writeHead(res.status, { 'content-type': res.headers.get('content-type') ?? 'application/json' });
      nodeRes.end(Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      nodeRes.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'harness_error', message: String(e) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    reseed: () => seed(pg),
  };
}
