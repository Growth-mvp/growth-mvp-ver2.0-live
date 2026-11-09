/* 実行計画書の保存を、APIと検証用DB（PGlite）につないで、複数の社員で確かめる（評価専用）。
 * 画面は実レイアウトの /okr。保存先はURLの ?planStore=remote でAPIに切り替える。
 * APIへの通信はブラウザの外（この検証の中）で、検証用DBの上の本番と同じ入口（planApi）に渡す。
 * 本番DB・本番の接続設定・実OpenAI・マイグレーションには触れない。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const shotsDir = path.join(outDir, 'stage3-remote-shots');
const MOCK_COMPANY_ID = '00000000-0000-4000-8000-00000000c0de';
const STRATEGY_A = '00000000-0000-4000-8000-0000000057a1';
const PROJECT_RENEWAL = 'fict-proj-renewal';
const API_BASE = 'http://plan.test';
const USERS = {
  alice: '00000000-0000-4000-8000-00000000a11c',
  bob: '00000000-0000-4000-8000-00000000b0b0',
  carol: '00000000-0000-4000-8000-00000000ca01',
};
const NAV = 'nav[aria-label="STAGE3のプロジェクト一覧"]';
const GEN = 'article[aria-label="実行計画書"]';
const results = [];
const external = [];
const errors = [];
const apiLog = [];

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

/* 検証用DBの入口。実際のHTTPの形で受けて、同じ入口（planApi）に渡す */
let env = null;
let failNextWrite = false;

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
  if (failNextWrite && (req.method() === 'PUT' || req.method() === 'POST') && pathname.endsWith('/plan-documents')) {
    failNextWrite = false;
    return route.fulfill({ status: 500, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'FAILED', message: '保存できませんでした（検証用の失敗）' }) });
  }
  const init = { method: req.method(), headers: req.headers() };
  if (req.method() !== 'GET' && req.method() !== 'HEAD') init.body = req.postData() ?? undefined;
  const res = await env.handle(new Request(req.url(), init));
  return route.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/json' }, body: await res.text() });
}

async function openContext(browser, userId, w, h) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  await context.addInitScript(
    ({ token, base }) => {
      window.__stage4Token = token;
      window.__stage4ApiBase = base;
    },
    { token: `test:${userId}`, base: API_BASE }
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

/* 画面を開く。STAGE3の情報は検証用DBから読み込んだ状態にする（再読み込みの確認のため） */
async function openPage(context, label, w = 1440, h = 900) {
  const page = await context.newPage();
  await page.setViewportSize({ width: w, height: h });
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('ERR_FILE_NOT_FOUND') || m.text().includes('Failed to load resource')) return;
    errors.push(`${label} console ${m.text()}`);
  });
  await page.goto(pathToFileURL(path.join(outDir, 'okr-shell.html')).href + '?planStore=remote');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /開発用：新しい実行計画書を表示/ }).click();
  const source = page.getByRole('button', { name: 'STAGE3の実プロジェクト（読み取り専用）' });
  await source.waitFor({ timeout: 8000 });
  await source.click();
  await page.evaluate((id) => window.__seedStage3(id), MOCK_COMPANY_ID);
  await loadStrategyFromDb(page);
  await page.locator(NAV).waitFor({ timeout: 8000 });
  return page;
}

/* 戦略の内容を検証用DBから読み込む（再読み込みと同じ：保存されている番号も含めて読む） */
async function loadStrategyFromDb(page) {
  const row = await env.strategyRow(STRATEGY_A);
  await page.evaluate((d) => window.__setStrategyState({ departments: d }), row.departments);
  await page.waitForTimeout(200);
}

const pick = async (page, title, deptName) => {
  const nav = page.locator(NAV);
  if (deptName) {
    const dept = nav.locator('div.rounded-lg', { has: page.locator('div.font-semibold', { hasText: deptName }) }).first();
    await dept.locator('button', { hasText: title }).click();
  } else {
    await nav.locator('button', { hasText: title }).first().click();
  }
  await page.waitForTimeout(300);
};
const createPlan = async (page) => {
  await page.getByRole('button', { name: /AIで実行計画書を作る（モック）/ }).click();
  await page.locator(GEN).waitFor({ timeout: 8000 });
};
const editField = async (page, label, text) => {
  await page.getByRole('toolbar', { name: '計画書の操作' }).getByRole('button', { name: '計画書を修正する' }).click();
  const opener = page.locator(GEN).getByRole('button', { name: `${label}を修正する` });
  if ((await opener.count()) > 0) await opener.first().click();
  await page.locator(GEN).getByLabel(label, { exact: true }).fill(text);
  await page.getByRole('toolbar', { name: '計画書の操作' }).getByRole('button', { name: '修正を反映する' }).click();
  await page.waitForTimeout(150);
};
const save = async (page, expectText) => {
  await page.getByRole('button', { name: '草案として保存' }).click();
  await page.waitForFunction((t) => document.body.innerText.includes(t), expectText, { timeout: 10000 });
};
const planRow = async () => (await env.planRows()).find((r) => r.project_id === PROJECT_RENEWAL);

(async () => {
  fs.mkdirSync(shotsDir, { recursive: true });
  const { createTestEnv } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'db', '.build', 'testEnv.mjs')).href);
  env = await createTestEnv();
  const browser = await chromium.launch();

  const aliceCtx = await openContext(browser, USERS.alice, 1440, 900);
  const bobCtx = await openContext(browser, USERS.bob, 1440, 900);
  const carolCtx = await openContext(browser, USERS.carol, 1440, 900);
  const okrsBefore = JSON.stringify((await env.strategyRow(STRATEGY_A)).departments.map((d) => d.projects.map((p) => p.okrsV2 ?? null)));

  /* ---- 1. 作成・編集・保存（社員A） ---- */
  let alice = await openPage(aliceCtx, '社員A');
  await check('作成→一部編集→草案として保存（APIを通じて、検証用DBに版1で保存される）', async () => {
    await pick(alice, '既存顧客の保守契約更新');
    await createPlan(alice);
    await editField(alice, '実施事項1', 'Aの修正：現状の数字を集める');
    await save(alice, '保存済み（版 1）');
    const row = await planRow();
    assert(row && row.version === 1, `DBの版が1でない（${row && row.version}）`);
    assert(row.user_edits && row.user_edits['action:1:title'] === 'Aの修正：現状の数字を集める', 'DBに修正が無い');
    return 'DBに版1・修正が保存';
  });

  await check('AI草案と利用者の編集を区別して保存している（草案は変わらず、修正だけが増える）', async () => {
    const row = await planRow();
    assert(row.ai_draft && row.ai_draft.mock === true, 'AI草案が保存されていない');
    assert(JSON.stringify(row.ai_draft).includes('現状の数字と原因'), 'AI草案の内容が無い');
    return 'ai_draft（草案）と user_edits（修正）が別';
  });

  /* ---- 2. 画面を再読み込み → 保存済みの計画を表示（AI再生成はしない） ---- */
  await alice.close();
  alice = await openPage(aliceCtx, '社員A（再読み込み）');
  await check('再読み込み後：保存済みの計画を選ぶと、修正が復元され、AIの作成は出ない（勝手に再生成しない）', async () => {
    await pick(alice, '既存顧客の保守契約更新');
    await alice.locator(GEN).waitFor({ timeout: 8000 });
    assert((await alice.locator(GEN).innerText()).includes('Aの修正：現状の数字を集める'), '修正が復元されていない');
    assert((await alice.getByRole('button', { name: /AIで実行計画書を作る/ }).count()) === 0, '保存済みなのに作成のボタンが出ている');
    assert((await alice.getByText('保存済み（版 1）').count()) >= 1, '版1の表示が戻らない');
    return '版1・修正・AI作成の操作なし';
  });

  /* ---- 3. 別の社員（B）が閲覧・編集 ---- */
  const bob = await openPage(bobCtx, '社員B');
  await check('別の社員：同じ会社の別の社員が、保存された計画を閲覧できる', async () => {
    await pick(bob, '既存顧客の保守契約更新');
    await bob.locator(GEN).waitFor({ timeout: 8000 });
    assert((await bob.locator(GEN).innerText()).includes('Aの修正：現状の数字を集める'), '社員Bから修正が見えない');
    return '社員Bに社員Aの修正が見える';
  });
  await check('別の社員：社員Bが編集して保存すると、版2になる（社員Aの修正は残る）', async () => {
    await editField(bob, '実施事項1', 'Bの修正：集め方を決める');
    await save(bob, '保存済み（版 2）');
    const row = await planRow();
    assert(row.version === 2 && row.user_edits['action:1:title'] === 'Bの修正：集め方を決める', 'DBの内容が違う');
    return 'DBは版2';
  });

  /* ---- 4. 競合：社員Aは版1のまま、同じ項目を編集して保存 ---- */
  await check('競合：古い版から同じ項目を変えて保存すると、競合として検出し、内容を失わない', async () => {
    await editField(alice, '実施事項1', 'Aの修正：競合する案');
    await save(alice, '他の人が先に保存しています');
    const panel = alice.getByRole('region', { name: '保存の競合' });
    assert((await panel.count()) === 1, '競合の表示がない');
    const text = await panel.innerText();
    assert(text.includes('Aの修正：競合する案') && text.includes('Bの修正：集め方を決める'), '両方の修正が表示されていない');
    assert((await alice.getByRole('button', { name: '選んだ内容で保存し直す' }).isDisabled()) === true, '選ぶ前に保存し直せる');
    return '両方の修正を表示';
  });
  await check('競合の解決：項目ごとに選んで保存し直すと、版3になり、選んだ内容が残る', async () => {
    await alice.getByRole('region', { name: '保存の競合' }).getByRole('button', { name: 'あなたの修正を残す' }).first().click();
    await alice.getByRole('button', { name: '選んだ内容で保存し直す' }).click();
    await alice.waitForFunction(() => /保存済み（版 3）/.test(document.body.innerText), null, { timeout: 10000 });
    const row = await planRow();
    assert(row.version === 3 && row.user_edits['action:1:title'] === 'Aの修正：競合する案', 'DBの解決内容が違う');
    return 'DBは版3・Aの案';
  });

  /* ---- 5. 他社の社員は読めない ---- */
  const carol = await openPage(carolCtx, '他社の社員');
  await check('他社の社員：同じ画面を開いても、この計画は読めない（権限なし）', async () => {
    await pick(carol, '既存顧客の保守契約更新');
    await carol.getByText('この計画を見る権限がありません。').waitFor({ timeout: 8000 });
    assert((await carol.locator(GEN).count()) === 0, '他社の社員に計画が見えている');
    const body = await carol.locator('body').innerText();
    assert(!body.includes('Aの修正：競合する案'), '他社の社員に修正内容が見えている');
    return '権限なしと表示';
  });
  await check('認証なしの通信は拒否される（401）', async () => {
    const status = await alice.evaluate(async (base) => {
      const r = await fetch(`${base}/api/stage4/plan-documents?companyId=x&strategyId=y&projectId=z`);
      return r.status;
    }, API_BASE);
    assert(status === 401, `401 ではない（${status}）`);
    return '401';
  });

  /* ---- 6. 保存の失敗：編集内容を失わない ---- */
  await check('保存の失敗：失敗と表示し、編集内容は画面に残る。再保存で成功する', async () => {
    failNextWrite = true;
    await editField(alice, '実施事項2', '失敗しても残る修正');
    await alice.getByRole('button', { name: '草案として保存' }).click();
    await alice.waitForFunction(() => document.body.innerText.includes('保存できませんでした'), null, { timeout: 10000 });
    assert((await alice.locator(GEN).innerText()).includes('失敗しても残る修正'), '失敗で編集が消えた');
    await save(alice, '保存済み（版 4）');
    return '失敗を表示、再保存で版4';
  });

  /* ---- 7. IDのないプロジェクト：保存のときに番号を付け、その後も同じ番号を使う ---- */
  const departments = (await env.strategyRow(STRATEGY_A)).departments;
  const stripped = JSON.parse(JSON.stringify(departments));
  delete stripped[1].projects[0].id;
  await env.setStrategyA(stripped);
  const revBefore = (await env.strategyRow(STRATEGY_A)).revision;
  apiLog.length = 0;
  await loadStrategyFromDb(alice);
  await check('IDのないプロジェクト：作成しただけでは、検証用DBは書き換わらない', async () => {
    await pick(alice, '点検工程の標準化');
    await createPlan(alice);
    const r = await env.strategyRow(STRATEGY_A);
    assert(r.revision === revBefore, '作成だけで戦略が書き換わった');
    return '作成のみ：変更なし';
  });
  await check('IDのないプロジェクト：未保存のSTAGE3の変更を書き込まず、番号を付けてから計画を保存する', async () => {
    await alice.evaluate(() => {
      const s = window.__getStrategyState();
      const d = JSON.parse(JSON.stringify(s.departments));
      d[0].mission = '未保存のSTAGE3の変更（書き込まれてはいけない）';
      window.__setStrategyState({ departments: d });
    });
    apiLog.length = 0;
    await save(alice, '保存済み（版 1）');
    const order = apiLog.map((x) => `${x.method} ${x.pathname.replace('/api/stage4/', '')}`);
    const idIndex = order.findIndex((x) => x.includes('project-identity'));
    const planIndex = order.findIndex((x) => x.includes('plan-documents'));
    assert(idIndex >= 0 && planIndex > idIndex, `順序が違う（${order.join(' → ')}）`);
    const r = await env.strategyRow(STRATEGY_A);
    assert(r.departments[0].mission !== '未保存のSTAGE3の変更（書き込まれてはいけない）', '未保存の変更が書き込まれた');
    const pointKey = r.departments[1].projects[0].id;
    assert(typeof pointKey === 'string' && pointKey.length > 0, '番号が付いていない');
    assert(r.revision === revBefore + 1, `版番号が1だけ進んでいない（${revBefore} → ${r.revision}）`);
    return `番号を付与（${order.join(' → ')}）`;
  });
  await check('IDを付けた後：画面を再読み込みしても、同じ番号で同じ計画を開ける', async () => {
    const savedId = (await env.strategyRow(STRATEGY_A)).departments[1].projects[0].id;
    const again = await openPage(aliceCtx, '社員A（番号の後）');
    await pick(again, '点検工程の標準化');
    await again.locator(GEN).waitFor({ timeout: 8000 });
    const rows = await env.planRows();
    assert(rows.some((r) => r.project_id === savedId), '番号と計画が対応していない');
    assert((await again.getByText('保存済み（版 1）').count()) >= 1, '版の表示が戻らない');
    await again.close();
    return `番号 ${savedId.slice(0, 8)}… で復元`;
  });

  /* ---- 8. 同時変更：古い版番号での番号付与は拒否される ---- */
  await check('同時変更：古い版番号での番号付与は拒否され、既に付いた番号は重複しない', async () => {
    const prior = (await env.strategyRow(STRATEGY_A)).revision;
    const stripped2 = JSON.parse(JSON.stringify((await env.strategyRow(STRATEGY_A)).departments));
    delete stripped2[0].projects[1].id;
    await env.setStrategyA(stripped2);
    const current = (await env.strategyRow(STRATEGY_A)).revision;
    assert(current === prior + 1, 'テストの前提が崩れた');
    const bobPage = await openPage(bobCtx, '社員B（番号付与）');
    const res = await bobPage.evaluate(async ({ base, strategyId, companyId, staleRevision, newId }) => {
      const r = await fetch(`${base}/api/stage4/project-identity`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${window.__stage4Token}` },
        body: JSON.stringify({ companyId, strategyId, departmentIndex: 0, projectIndex: 1, expectedTitle: '新規顧客開拓', expectedRevision: staleRevision, newId }),
      });
      return { status: r.status, body: await r.json() };
    }, { base: API_BASE, strategyId: STRATEGY_A, companyId: MOCK_COMPANY_ID, staleRevision: prior, newId: '00000000-0000-4000-8000-0000000002b2' });
    assert(res.status === 409 && res.body.status === 'REVISION_CHANGED', `拒否されていない（${res.status} ${res.body.status}）`);
    const after = (await env.strategyRow(STRATEGY_A)).departments[0].projects[1];
    assert(!after.id, '古い版番号で番号が付いてしまった');
    await bobPage.close();
    return '409 REVISION_CHANGED';
  });

  /* ---- 9. 表示：1024px・768px（保存後の計画） ---- */
  for (const [w, h, shot] of [
    [1024, 768, '02-tablet-1024'],
    [768, 1024, '03-tablet-768'],
  ]) {
    const tctx = await openContext(browser, USERS.alice, w, h);
    const tp = await openPage(tctx, `タブレット${w}`, w, h);
    await check(`${w}px：保存済みの計画が横にはみ出さず読める`, async () => {
      await pick(tp, '既存顧客の保守契約更新');
      await tp.locator(GEN).waitFor({ timeout: 8000 });
      const overflow = await tp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, `横にはみ出す（${overflow}px）`);
      await tp.locator(GEN).screenshot({ path: path.join(shotsDir, `${shot}-saved.png`) });
      return '横のはみ出しなし';
    });
    await tp.close();
    await tctx.close();
  }

  /* ---- 10. 部門データ（KPI）と通信 ---- */
  await check('STAGE3のKPI（okrsV2）は、この一連の操作で変わらない', async () => {
    const okrsAfter = JSON.stringify((await env.strategyRow(STRATEGY_A)).departments.map((d) => d.projects.map((p) => p.okrsV2 ?? null)));
    assert(okrsAfter === okrsBefore, 'okrsV2が変わった');
    return 'okrsV2 不変';
  });
  await check('通信：ブラウザの外への通信がない（保存先は検証用のDBだけ）', async () => {
    assert(external.length === 0, `外部への通信 ${external.length} 件`);
    return '外部通信 0件';
  });
  await check('ブラウザ実行中に例外・コンソールエラーがない', async () => {
    assert(errors.length === 0, errors.slice(0, 3).join(' | '));
    return 'エラー 0件';
  });

  await browser.close();
  await env.close();
  const pass = results.filter((r) => r.status === 'PASS').length;
  console.log(JSON.stringify({ total: results.length, pass }));
  if (pass !== results.length) process.exitCode = 1;
})();
