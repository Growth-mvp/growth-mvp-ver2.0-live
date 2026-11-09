/* 公開前の保護（STAGE4_PLAN_API_ENABLED が無効）の確認（評価専用）。
 * 検証用DBの計画APIを「無効」で動かし、既存利用者の画面（STAGE5の実行画面・STAGE1・STAGE6）が、
 * エラーを出さず、計画の要求を繰り返さないことを確かめる。通信は検証の中の入口だけに限る。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const MOCK_COMPANY_ID = '00000000-0000-4000-8000-00000000c0de';
const STRATEGY_A = '00000000-0000-4000-8000-0000000057a1';
const API_BASE = 'http://plan.test';
const ALICE = '00000000-0000-4000-8000-00000000a11c';

const results = [];
const errors = [];
const external = [];
const apiLog = [];
let env = null;

const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, status: 'PASS', detail: detail ?? '' });
    console.log('PASS ' + name + (detail ? '  -- ' + detail : ''));
  } catch (e) {
    const detail = String(e.message || e).split('\n')[0];
    results.push({ name, status: 'FAIL', detail });
    console.log('FAIL ' + name + ' -- ' + detail);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function apiRoute(route) {
  const req = route.request();
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
  const pathname = new URL(req.url()).pathname;
  apiLog.push({ method: req.method(), pathname });
  const init = { method: req.method(), headers: req.headers() };
  if (req.method() !== 'GET' && req.method() !== 'HEAD') init.body = req.postData() ?? undefined;
  const res = await env.handle(new Request(req.url(), init));
  return route.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/json' }, body: await res.text() });
}

async function openContext(browser, w, h) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  await context.addInitScript(
    ({ token, base }) => {
      window.__stage4Token = token;
      window.__stage4ApiBase = base;
    },
    { token: `test:${ALICE}`, base: API_BASE }
  );
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(API_BASE)) return apiRoute(route);
    if (url.startsWith('file:')) return route.continue();
    external.push(url.slice(0, 100));
    return route.abort();
  });
  return context;
}

function watch(page, label) {
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('ERR_FILE_NOT_FOUND') || m.text().includes('Failed to load resource')) return;
    errors.push(`${label} console ${m.text()}`);
  });
}

async function loadStrategyFromDb(page) {
  const row = await env.strategyRow(STRATEGY_A);
  await page.evaluate((d) => window.__setStrategyState({ departments: d }), row.departments);
  await page.waitForTimeout(200);
}

/* STAGE5 の実行画面。planStore=remote（計画の保存先をAPIにした場合）と、既定（ブラウザ内）の両方を見る */
async function openExec(context, label, query) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  watch(page, label);
  await page.goto(pathToFileURL(path.join(outDir, 'exec.html')).href + query);
  await page.waitForTimeout(1200);
  await page.evaluate((id) => window.__seedStage3(id), MOCK_COMPANY_ID);
  await loadStrategyFromDb(page);
  return page;
}

const planCalls = () => apiLog.filter((c) => c.pathname.startsWith('/api/stage4/')).length;

(async () => {
  const { createTestEnv } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'db', '.build', 'testEnv.mjs')).href);
  env = await createTestEnv({ apiEnabled: false });
  const browser = await chromium.launch();
  const ctx = await openContext(browser, 1440, 900);

  await check('API無効（既定の保存先）：実行画面はAPIを呼ばずに、カードが表示される', async () => {
    const before = planCalls();
    const p = await openExec(ctx, '実行画面（既定）', '');
    try {
      await p.getByRole('button', { name: /既存顧客の保守契約更新/ }).first().waitFor({ timeout: 10000 });
      assert(!(await p.locator('section[aria-label="実行計画"]').count()), '無効なのに計画の欄が出ている');
      assert(planCalls() === before, `計画のAPIが呼ばれた（${planCalls() - before}件）`);
      return '計画のAPI 0件・カード表示';
    } finally {
      await p.close();
    }
  });

  await check('API無効（保存先 remote）：実行画面は、エラーを出さず、計画の要求は1回で止まる', async () => {
    const before = planCalls();
    const p = await openExec(ctx, '実行画面（remote）', '?planStore=remote');
    try {
      await p.getByRole('button', { name: /既存顧客の保守契約更新/ }).first().waitFor({ timeout: 10000 });
      await p.waitForTimeout(800);
      const body = await p.locator('body').innerText();
      assert(!body.includes('読み込めませんでした'), '読み込みのエラーが出ている');
      assert(!body.includes('一部の計画'), '計画の警告が出ている');
      assert((await p.locator('[role="alert"]').count()) === 0, 'alert が出ている');
      assert(!(await p.locator('section[aria-label="実行計画"]').count()), '無効なのに計画の欄が出ている');
      const calls = planCalls() - before;
      assert(calls <= 1, `計画の要求が繰り返されている（${calls}件）`);
      return `計画の要求 ${calls}件（上限1）・エラー表示なし`;
    } finally {
      await p.close();
    }
  });

  await check('API無効（保存先 remote）：新STAGE4の開発用の表示も、読み込みのエラーを出さず、要求は選択ごとに1回', async () => {
    const before = planCalls();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    watch(page, 'STAGE4 開発用');
    await page.goto(pathToFileURL(path.join(outDir, 'okr-shell.html')).href + '?planStore=remote');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /開発用：新しい実行計画書を表示/ }).click();
    await page.getByRole('button', { name: 'STAGE3の実プロジェクト（読み取り専用）' }).click();
    await page.evaluate((id) => window.__seedStage3(id), MOCK_COMPANY_ID);
    await loadStrategyFromDb(page);
    const nav = page.locator('nav[aria-label="STAGE3のプロジェクト一覧"]');
    await nav.waitFor({ timeout: 8000 });
    await nav.locator('button', { hasText: '既存顧客の保守契約更新' }).first().click();
    await page.waitForTimeout(800);
    const body = await page.locator('body').innerText();
    assert(!body.includes('読み込めませんでした'), '読み込みのエラーが出ている');
    assert((await page.locator('[role="alert"]').count()) === 0, 'alert が出ている');
    const calls = planCalls() - before;
    assert(calls <= 2, `要求が繰り返されている（${calls}件）`);
    await page.close();
    return `要求 ${calls}件・エラー表示なし`;
  });

  await check('API無効：既存のSTAGE1・STAGE6の画面は、エラーなく表示される（計画APIに依存しない）', async () => {
    const errBefore = errors.length;
    for (const file of ['shell-stage1.html', 'shell-stage6-mock-target.html']) {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 1440, height: 900 });
      watch(page, file);
      await page.goto(pathToFileURL(path.join(outDir, file)).href);
      await page.waitForTimeout(1500);
      assert((await page.locator('body').innerText()).length > 20, `${file} が空に近い`);
      await page.close();
    }
    assert(errors.length === errBefore, `エラーが出た（${errors.length - errBefore}件）：${errors.slice(errBefore, errBefore + 2).join(' / ')}`);
    return 'STAGE1・STAGE6 エラー0件';
  });

  await check('API無効：通信は検証の入口に限られ、外部への通信はない', async () => {
    assert(external.length === 0, `外部への通信（${external.length}件）`);
    return '外部通信 0件';
  });

  await browser.close();
  await env.close();
  const failed = results.filter((r) => r.status === 'FAIL');
  fs.writeFileSync(path.join(outDir, 'stage5-public-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ total: results.length, pass: results.length - failed.length }));
  if (failed.length > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
