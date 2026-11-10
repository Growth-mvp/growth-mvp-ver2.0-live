/* AI案（実行計画のたたき台）の非同期応答と、会社・プロジェクトの切替が重なったときに、別の対象へ書かないことを検証する（評価専用）。
 * A 会社で生成開始→B 会社へ切替→応答 / 同じ会社で別プロジェクトへ切替→応答 / 切替なしの生成と反映 / 既存KPIの保全
 * 応答は init script で遅らせる（ネットワークは使わない）。保存は localStorage（stubs/flowStore.ts）。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const OKR_URL = pathToFileURL(path.join(outDir, 'flow-okr.html')).href;

const CO = 'FICTIONAL-CO';
const OTHER = 'FICTIONAL-OTHER';
const KEY = (c) => `flow:${c}`;
const RETENTION = '既存顧客の保守契約更新';
const STANDARD = '点検工程の標準化';
const RET_KR = '保守契約の継続率';
const AI_KR = '保守契約の新規更新件数';
const OTHER_PROJECT = '他社の施策（架空）';
const OTHER_KR = '他社のKR';

const DRAFT = {
  objective: '既存顧客の保守契約を更新し続け、新規の更新件数を増やす',
  role: 'REVENUE',
  kpis: [
    { label: RET_KR, target: 95, unit: '%', due: '2027-06', owner: '鈴木一郎', milestones: [] },
    { label: AI_KR, target: 40, unit: '件', due: '2027-06', owner: '鈴木一郎', milestones: [{ title: '更新対象リストを作る', dueYm: '2026-12' }] },
  ],
  steps: [{ title: '更新対象リストを作る', dueYm: '2026-12' }],
};

/* 応答の遅延は window.__draftDelayMs で指定する（テストごとに変える） */
const DRAFT_INIT = (draft) => {
  const real = window.fetch.bind(window);
  window.__draftDelayMs = 0;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/stage4/generate-execution-draft') >= 0) {
      const delay = window.__draftDelayMs || 0;
      await new Promise((r) => setTimeout(r, delay));
      return new Response(JSON.stringify({ draft }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return real(input, init);
  };
};

const results = [];
const dialogs = [];
const pageErrors = [];
const consoleErrors = [];
const external = [];
const evidence = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = () => dialogs.length;
const since = (m) => dialogs.slice(m).map((d) => d.message);

async function newContext(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(DRAFT_INIT, DRAFT);
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 140));
    return route.abort();
  });
  ctx.on('page', (p) => {
    p.on('dialog', async (d) => {
      dialogs.push({ label, message: d.message() });
      await d.accept();
    });
    p.on('pageerror', (e) => pageErrors.push(`[${label}] ${e.message.slice(0, 300)}`));
    p.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`[${label}] ${m.text().slice(0, 240)}`);
    });
  });
  return ctx;
}

const readStore = (page) =>
  page.evaluate(() =>
    window.__getStrategyState().departments.map((d) => ({
      dept: d.name,
      projects: (d.projects || []).map((p) => ({
        title: p.title,
        okrsV2: (p.okrsV2 || []).map((k) => ({ id: k.id ?? null, label: k.label, target: k.target ?? null })),
      })),
    })),
  );
const krsOf = (depts, title) => {
  for (const d of depts) for (const p of d.projects) if (p.title === title) return p.okrsV2;
  return null;
};
const countLabel = (depts, title, label) => (krsOf(depts, title) || []).filter((k) => k.label === label).length;
const readLs = (page, companyId) =>
  page.evaluate((k) => {
    const s = localStorage.getItem(k);
    return s ? JSON.parse(s) : null;
  }, KEY(companyId));
const lsKr = (ls, title, label) => {
  if (!ls) return null;
  for (const d of ls.departments || []) for (const p of d.projects || []) if (p.title === title) return (p.okrsV2 || []).find((k) => k.label === label) ?? null;
  return null;
};

async function openOkr(page) {
  await page.goto(OKR_URL);
  await page.getByText('プロジェクト一覧').first().waitFor({ timeout: 10000 });
  await sleep(400);
}
async function openProject(page, title) {
  await page.getByText(title, { exact: true }).first().click();
  await sleep(300);
}
const generateButton = (page) => page.getByRole('button', { name: /AIで実行計画のたたき台を作る/ });
const applyButton = (page) => page.getByRole('button', { name: 'このAI案を反映する' });
const draftVisible = (page) => applyButton(page).count().then((n) => n > 0);

const check = async (id, name, fn) => {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail ?? '' });
  } catch (e) {
    results.push({ id, name, status: 'FAIL', detail: String(e.message || e).split('\n')[0] });
  }
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  /* ============ A：会社の切替（応答前に B 社へ）============ */
  const ctxA = await newContext(browser, 'A');
  const a = await ctxA.newPage();
  await openOkr(a);
  await openProject(a, RETENTION);
  const beforeA = await readStore(a);
  evidence.beforeTargetRetention = krsOf(beforeA, RETENTION)?.find((k) => k.label === RET_KR)?.target ?? null;

  await check('A1', '会社A で生成を開始し、応答前に会社Bへ切り替えると、Bの KPI は変わらない', async () => {
    await a.evaluate(() => { window.__draftDelayMs = 1500; });
    await generateButton(a).click();
    await sleep(200);
    await a.evaluate(() => window.__flow.switchCompany('FICTIONAL-OTHER'));
    await sleep(2500);
    const depts = await readStore(a);
    const otherKrs = krsOf(depts, OTHER_PROJECT) || [];
    evidence.a1_other = otherKrs;
    if (otherKrs.length !== 1 || otherKrs[0].label !== OTHER_KR || otherKrs[0].target !== 10) {
      throw new Error('B社のKPIが変わった: ' + JSON.stringify(otherKrs));
    }
    if (countLabel(depts, OTHER_PROJECT, AI_KR) !== 0) throw new Error('B社にAI案のKRが入った');
    if (await draftVisible(a)) throw new Error('B社の画面にA社のAI案が出ている');
    const lsA = await readLs(a, CO);
    if (lsKr(lsA, RETENTION, AI_KR)) throw new Error('A社の保存先にも、破棄されるべきAI案のKRが書かれた');
    return `B社のKR「${OTHER_KR}」は target=10 のまま。AI案のKRは入らず、AI案は表示されない`;
  });
  await ctxA.close();

  /* ============ B：同じ会社でプロジェクトを切り替える（応答前に別の施策へ）============ */
  const ctxB = await newContext(browser, 'B');
  const b = await ctxB.newPage();
  await openOkr(b);
  await openProject(b, RETENTION);
  const beforeB = await readStore(b);
  const retBefore = krsOf(beforeB, RETENTION);
  evidence.b_retentionBefore = retBefore;

  await check('B1', '生成の応答前に別のプロジェクトへ切り替えると、AI案は表示されず、別のプロジェクトのKPIも変わらない', async () => {
    await b.evaluate(() => { window.__draftDelayMs = 1500; });
    await generateButton(b).click();
    await sleep(200);
    await openProject(b, STANDARD);
    await sleep(2500);
    if (await draftVisible(b)) throw new Error('切替先のプロジェクトにAI案が表示された（別の施策の案が混ざった）');
    const depts = await readStore(b);
    if (countLabel(depts, STANDARD, AI_KR) !== 0) throw new Error('切替先のプロジェクトにAI案のKRが入った');
    return '切替先にAI案は表示されず、KRも増えていない';
  });

  await check('B2', '元のプロジェクトに戻っても、破棄されたAI案は表示されず、反映もできない', async () => {
    await openProject(b, RETENTION);
    await sleep(300);
    if (await draftVisible(b)) throw new Error('戻った後にAI案が表示された');
    const depts = await readStore(b);
    if (countLabel(depts, RETENTION, AI_KR) !== 0) throw new Error('元のプロジェクトにAI案のKRが入った');
    return '戻った後も AI案は表示されず、KRは増えていない';
  });

  /* ============ C：切替なしの通常の生成と反映（既存KPIの保全） ============ */
  await check('C1', '通常の生成と反映は妨げられない（AI案が表示され、反映できる）', async () => {
    await b.evaluate(() => { window.__draftDelayMs = 0; });
    await generateButton(b).click();
    await applyButton(b).waitFor({ timeout: 5000 });
    if (!(await draftVisible(b))) throw new Error('AI案が表示されない');
    const m = mark();
    await applyButton(b).click();
    await sleep(800);
    const msgs = since(m);
    if (!msgs.some((x) => x.startsWith('AI案を反映しました') || x.includes('反映が完了しました'))) {
      throw new Error('反映の通知がない: ' + msgs.join(' | '));
    }
    return `反映の通知「${msgs[0]}」`;
  });

  await check('C2', 'STAGE3 KPIの既存の目標値は、AI案の値で上書きされない', async () => {
    const depts = await readStore(b);
    const now = krsOf(depts, RETENTION)?.find((k) => k.label === RET_KR)?.target ?? null;
    evidence.c2 = { before: evidence.beforeTargetRetention, now };
    if (now !== evidence.beforeTargetRetention) throw new Error(`既存KPIの目標値が変わった（${evidence.beforeTargetRetention} → ${now}）`);
    return `既存KPI「${RET_KR}」の目標値 ${now} は変わらない`;
  });

  await check('C3', 'AI案のKRは同じプロジェクトに一度だけ入る（重複しない）', async () => {
    const depts = await readStore(b);
    const n = countLabel(depts, RETENTION, AI_KR);
    if (n !== 1) throw new Error(`AI案のKRが ${n} 件ある`);
    return 'AI案のKRは1件';
  });
  await ctxB.close();

  /* ============ D：他社データへの書き込みと、保存先の分離（対照として、切替なしの保存は元の会社に書かれる） ============ */
  const ctxD = await newContext(browser, 'D');
  const d = await ctxD.newPage();
  await openOkr(d);
  await openProject(d, RETENTION);
  await check('D1', '対照：切替なしで反映したAI案は、元の会社の保存先に書かれる（A1 の否定が空振りでないこと）', async () => {
    await d.evaluate(() => { window.__draftDelayMs = 0; });
    await generateButton(d).click();
    await applyButton(d).waitFor({ timeout: 5000 });
    await applyButton(d).click();
    await sleep(1200);
    const ls = await readLs(d, CO);
    const lsOther = await readLs(d, OTHER);
    if (!lsKr(ls, RETENTION, AI_KR)) throw new Error('元の会社の保存先にAI案のKRがない');
    if (lsKr(lsOther, OTHER_PROJECT, AI_KR) || JSON.stringify(lsOther ?? {}).includes(RETENTION)) {
      throw new Error('他社の保存先に元の会社のデータが書かれた');
    }
    return `元の会社の保存先に AI案のKRあり。${OTHER} の保存先に元の会社のデータなし`;
  });
  await ctxD.close();

  /* ============ 全体：例外・外部通信 ============ */
  await check('E1', 'ブラウザ実行中に未処理の例外（pageerror）がない', async () => {
    if (pageErrors.length) throw new Error(pageErrors.slice(0, 2).join(' | '));
    return '未処理の例外 0件';
  });
  await check('E2', '外部への通信はすべて遮断（file:// 以外は abort）', async () => {
    if (external.length) throw new Error('遮断した外部通信: ' + external.length + '件（例: ' + external[0] + '）');
    return '外部への通信 0件（遮断）';
  });

  await browser.close();

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  };
  const out = { summary, results, evidence, dialogs, pageErrors, consoleErrorCount: consoleErrors.length, external: external.slice(0, 20), externalCount: external.length };
  fs.writeFileSync(path.join(outDir, 'browser-results-draft-guard.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.id}  ${r.name}  -- ${r.detail}`);
  if (pageErrors.length) console.log('pageerrors:', pageErrors.slice(0, 4));
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
