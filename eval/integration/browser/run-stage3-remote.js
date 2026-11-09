/* 実行計画書の一連の流れ（作成→修正→保存→採用→実行開始→別の社員での確認）を、APIと検証用DB（PGlite）につないで確かめる（評価専用）。
 * 画面は実レイアウトの /okr。保存先はURLの ?planStore=remote でAPIに切り替える。
 * APIへの通信はブラウザの外（この検証の中）で、検証用DBの上の本番と同じ入口（planApi）に渡す。
 * AIの呼び出しは検証用のモデル（モック）。本番DB・本番の接続設定・実OpenAI・マイグレーションには触れない。 */
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
const RECORDS = 'section[aria-label="採用・実行開始の記録"]';
const TODAY = '2026-11-09';
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
  if (failNextWrite && req.method() === 'PUT' && pathname.endsWith('/plan-documents')) {
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

/* STAGE5 の実行画面を開く（同じ戦略の内容を、検証用DBから読み込んだ状態で表示する） */
async function openExecPage(context, label, w = 1440, h = 900) {
  const page = await context.newPage();
  await page.setViewportSize({ width: w, height: h });
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('ERR_FILE_NOT_FOUND') || m.text().includes('Failed to load resource')) return;
    errors.push(`${label} console ${m.text()}`);
  });
  await page.goto(pathToFileURL(path.join(outDir, 'exec.html')).href + '?planStore=remote');
  await page.waitForTimeout(1200);
  await page.evaluate((id) => window.__seedStage3(id), MOCK_COMPANY_ID);
  await loadStrategyFromDb(page);
  return page;
}

/* 戦略の内容を検証用DBから読み込む（再読み込みと同じ：保存されている番号も含めて読む） */
async function loadStrategyFromDb(page) {
  const row = await env.strategyRow(STRATEGY_A);
  await page.evaluate((d) => window.__setStrategyState({ departments: d }), row.departments);
  await page.waitForTimeout(200);
}

const pick = async (page, title) => {
  await page.locator(NAV).locator('button', { hasText: title }).first().click();
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
const planRow = async () => (await env.planRows()).find((r) => r.project_id === PROJECT_RENEWAL);

/* 草案として保存し、保存された版を返す（保存前の版から求めるので、古い表示に騙されない） */
const saveDraft = async (page) => {
  const before = (await planRow()).version;
  await page.getByRole('button', { name: '草案として保存' }).click();
  await page.waitForFunction((t) => document.body.innerText.includes(t), `保存済み（版 ${before + 1}）`, { timeout: 10000 });
  return before + 1;
};

const diag = async (page) => {
  const notice = await page.locator('p[role="status"]').allInnerTexts();
  const adoption = await page.getByRole('region', { name: '計画案の採用' }).innerText().catch(() => '');
  return `通知=${JSON.stringify(notice)} 採用欄=${JSON.stringify(adoption.slice(0, 160))}`;
};

const confirmResponsible = async (page) => {
  const btn = page.getByRole('button', { name: /を実行責任者として確定する$/ });
  if ((await btn.count()) === 0) return false;
  await btn.first().click();
  await page.waitForTimeout(150);
  return true;
};
const confirmKeyConditions = async (page) => {
  const section = page.locator('section', { has: page.getByText('③ 主要な実行条件') });
  const boxes = section.locator('input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i += 1) {
    if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
  }
  return n;
};
const recordRegulatory = async (page) => {
  await page.getByRole('radio', { name: '適用なし', exact: true }).check();
  await page.getByLabel('判断内容', { exact: true }).fill('現行の業務範囲に、規制・安全の対象となる作業がないと判断');
  await page.getByLabel('判断根拠（何を根拠に判断したか）').fill('業務範囲の確認表と既存の手続き一覧に該当なし');
  await page.getByLabel('確認者', { exact: true }).fill('安全担当 山田');
  await page.getByLabel('確認日', { exact: true }).fill(TODAY);
  await page.getByRole('button', { name: '規制・安全の判断を記録する' }).click();
};

(async () => {
  fs.mkdirSync(shotsDir, { recursive: true });
  const { createTestEnv } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'db', '.build', 'testEnv.mjs')).href);
  env = await createTestEnv();
  const browser = await chromium.launch();

  const aliceCtx = await openContext(browser, USERS.alice, 1440, 900);
  const bobCtx = await openContext(browser, USERS.bob, 1440, 900);
  const carolCtx = await openContext(browser, USERS.carol, 1440, 900);
  const okrsBefore = JSON.stringify((await env.strategyRow(STRATEGY_A)).departments.map((d) => d.projects.map((p) => p.okrsV2 ?? null)));

  /* ---- 1. 作成（AI・モック）→ 一部編集 → 草案として保存 ---- */
  let alice = await openPage(aliceCtx, '社員A');
  let aiDraftAtCreate = '';
  await check('AIで作成（モック）：版1の草案がサーバーで作られ、検証用DBに入る', async () => {
    await pick(alice, '既存顧客の保守契約更新');
    await createPlan(alice);
    await alice.waitForFunction(() => /保存済み（版 1）/.test(document.body.innerText), null, { timeout: 10000 });
    const row = await planRow();
    assert(row && row.version === 1 && row.status === 'DRAFT', `作成直後の版・状態が違う（${row && row.version} ${row && row.status}）`);
    assert(row.ai_draft && row.ai_draft.generatedBy === 'SERVER', 'サーバーが作った草案ではない');
    assert(JSON.stringify(row.ai_draft).includes('現状の数字と原因'), 'AI草案の内容が無い');
    aiDraftAtCreate = JSON.stringify(row.ai_draft);
    return 'DBに版1・草案はサーバー作成';
  });

  await check('一部編集→草案として保存：版2になり、修正だけが増える（草案は変わらない）', async () => {
    await editField(alice, '実施事項1', 'Aの修正：現状の数字を集める');
    const v = await saveDraft(alice);
    const row = await planRow();
    assert(row.version === v && row.user_edits['action:1:title'] === 'Aの修正：現状の数字を集める', 'DBに修正が無い');
    assert(JSON.stringify(row.ai_draft) === aiDraftAtCreate, 'AI草案が変わった');
    return `DBは版${v}・草案は不変`;
  });

  /* ---- 2. 画面を再読み込み → 保存済みの計画を復元（AIの作成は出ない） ---- */
  await alice.close();
  alice = await openPage(aliceCtx, '社員A（再読み込み）');
  await check('再読み込み後：保存済みの修正が復元され、AIの作成ボタンは出ない（勝手に再生成しない）', async () => {
    await pick(alice, '既存顧客の保守契約更新');
    await alice.locator(GEN).waitFor({ timeout: 8000 });
    assert((await alice.locator(GEN).innerText()).includes('Aの修正：現状の数字を集める'), '修正が復元されていない');
    assert((await alice.getByRole('button', { name: /AIで実行計画書を作る/ }).count()) === 0, '保存済みなのに作成のボタンが出ている');
    return '修正の復元・作成の操作なし';
  });

  /* ---- 3. 別の社員（B）が同じ計画を開き、編集・保存 ---- */
  const bob = await openPage(bobCtx, '社員B');
  await check('別の社員：同じ会社の社員Bが計画を開き、社員Aの修正が見える', async () => {
    await pick(bob, '既存顧客の保守契約更新');
    await bob.locator(GEN).waitFor({ timeout: 8000 });
    assert((await bob.locator(GEN).innerText()).includes('Aの修正：現状の数字を集める'), '社員Bから修正が見えない');
    return '社員Bに社員Aの修正が見える';
  });
  await check('別の社員：社員Bが編集して保存すると版が進み、社員Aの他の修正は残る', async () => {
    await editField(bob, '実施事項1', 'Bの修正：集め方を決める');
    const v = await saveDraft(bob);
    const row = await planRow();
    assert(row.version === v && row.user_edits['action:1:title'] === 'Bの修正：集め方を決める', 'DBの内容が違う');
    return `DBは版${v}`;
  });

  /* ---- 4. 競合：社員Aは古い版のまま、同じ項目を変えて保存 ---- */
  await check('競合：古い版から同じ項目を変えて保存すると、競合として検出し、両方の修正を表示する', async () => {
    await editField(alice, '実施事項1', 'Aの修正：競合する案');
    await alice.getByRole('button', { name: '草案として保存' }).click();
    const panel = alice.getByRole('region', { name: '保存の競合' });
    await panel.waitFor({ timeout: 10000 });
    const text = await panel.innerText();
    assert(text.includes('Aの修正：競合する案') && text.includes('Bの修正：集め方を決める'), '両方の修正が表示されていない');
    assert((await alice.getByRole('button', { name: '選んだ内容で保存し直す' }).isDisabled()) === true, '選ぶ前に保存し直せる');
    return '両方の修正を表示';
  });
  await check('競合の解決：項目ごとに選んで保存し直すと、選んだ内容が残り、版が進む', async () => {
    await alice.getByRole('region', { name: '保存の競合' }).getByRole('button', { name: 'あなたの修正を残す' }).first().click();
    await alice.getByRole('button', { name: '選んだ内容で保存し直す' }).click();
    await alice.waitForFunction(() => /保存済み（版 \d+）/.test(document.body.innerText), null, { timeout: 10000 });
    const row = await planRow();
    assert(row.user_edits['action:1:title'] === 'Aの修正：競合する案', 'DBの解決内容が違う');
    return `DBは版${row.version}・Aの案`;
  });

  /* ---- 5. 保存の失敗：編集内容は画面に残り、再保存で成功する ---- */
  await check('保存の失敗：失敗と表示し、編集内容は画面に残る。再保存で成功する', async () => {
    failNextWrite = true;
    await editField(alice, '実施事項2', '失敗しても残る修正');
    await alice.getByRole('button', { name: '草案として保存' }).click();
    await alice.waitForFunction(() => document.body.innerText.includes('保存できませんでした'), null, { timeout: 10000 });
    assert((await alice.locator(GEN).innerText()).includes('失敗しても残る修正'), '失敗で編集が消えた');
    const v = await saveDraft(alice);
    return `失敗を表示、再保存で版${v}`;
  });

  /* ---- 6. 実行責任者の確定と主要な実行条件の確認（採用より前に保存する） ---- */
  let confirmedCount = 0;
  await check('実行責任者と主要な実行条件を確認し、保存する（採用より前。採用後の修正は採用を解除するため）', async () => {
    await alice.getByRole('button', { name: '実行開始の確認へ進む' }).click();
    const responsible = await confirmResponsible(alice);
    confirmedCount = await confirmKeyConditions(alice);
    await alice.getByRole('button', { name: '計画書に戻る' }).click();
    const v = await saveDraft(alice);
    const row = await planRow();
    if (responsible) assert(row.user_edits.responsible, '実行責任者が保存されていない');
    assert(row.adopted === false, '保存しただけで採用されている');
    return `責任者${responsible ? '確定' : 'なし'}・条件${confirmedCount}件・版${v}`;
  });

  /* ---- 7. 採用 ---- */
  await check('採用：保存済みの草案を採用し、採用者・採用日時・対象の版が記録される', async () => {
    await alice.getByRole('button', { name: 'この計画案を採用する' }).click();
    try {
      await alice.locator(RECORDS).getByText(/採用：版 \d+（採用者/).waitFor({ timeout: 10000 });
    } catch (e) {
      throw new Error(`${String(e.message).split('\n')[0]} / ${await diag(alice)}`);
    }
    const row = await planRow();
    assert(row.adopted === true && row.adoption, 'DBに採用が無い');
    return `採用：版${row.version}`;
  });

  /* ---- 8. 実行開始（採用とは別の操作）：規制・安全は判断と確認者・確認日を記録してから ---- */
  await check('規制・安全：判断を書かずに記録しようとしても、開始の記録は増えない', async () => {
    const before = await planRow();
    await alice.getByRole('button', { name: '実行開始の確認へ進む' }).click();
    await alice.getByRole('button', { name: '規制・安全の判断を記録する' }).click();
    await alice.waitForTimeout(400);
    const after = await planRow();
    assert(after.version === before.version && !after.regulatory?.decision, '判断が無いまま記録された');
    return '記録されない';
  });
  await check('規制・安全：判断内容・確認者・確認日・判断根拠を記録する（ボタンだけでは完了しない）', async () => {
    await recordRegulatory(alice);
    try {
      await alice.locator(RECORDS).getByText('規制・安全：適用なし').waitFor({ timeout: 10000 });
    } catch (e) {
      throw new Error(`${String(e.message).split('\n')[0]} / ${await diag(alice)} / 記録=${(await alice.locator(RECORDS).innerText()).slice(0, 200)}`);
    }
    const row = await planRow();
    assert(row.regulatory && row.regulatory.decision === 'NOT_APPLICABLE', 'DBに規制・安全の判断が無い');
    return `DBに判断・版${row.version}`;
  });
  await check('実行開始：採用済み・責任者・条件・規制の記録がそろうと、開始者・開始日時・版が記録される', async () => {
    await alice.getByRole('button', { name: '実行を開始する' }).click();
    await alice.locator(RECORDS).getByText(/実行開始：版 \d+（開始者/).waitFor({ timeout: 10000 });
    const row = await planRow();
    assert(row.started === true && row.start_info, 'DBに開始が無い');
    return `実行開始：版${row.version}`;
  });

  /* ---- 9. 別の社員が同じ計画を開き、採用・開始・規制の記録と操作の履歴を見る ---- */
  await check('別の社員が同じ計画を開くと、採用・実行開始・規制の記録と操作の履歴が見える', async () => {
    const bob2 = await openPage(bobCtx, '社員B（記録の確認）');
    await pick(bob2, '既存顧客の保守契約更新');
    await bob2.locator(GEN).waitFor({ timeout: 8000 });
    const text = await bob2.locator(RECORDS).innerText();
    assert(/採用：版 \d+/.test(text), '採用の記録が見えない');
    assert(/実行開始：版 \d+/.test(text), '実行開始の記録が見えない');
    assert(text.includes('規制・安全：適用なし'), '規制の記録が見えない');
    assert(text.includes('計画書を採用') && text.includes('実行を開始'), '操作の履歴が見えない');
    await bob2.close();
    return '採用・開始・規制・履歴';
  });

  /* ---- 9b. STAGE5：実行開始済みの計画を、実行画面で読み取り専用に確認（デスクトップ・タブレット） ---- */
  const s5ApiBefore = apiLog.length;
  const s5OkrBefore = JSON.stringify((await env.strategyRow(STRATEGY_A)).departments.map((d) => d.projects.map((p) => p.okrsV2 ?? null)));
  for (const w of [1440, 1024, 768]) {
    await check(`STAGE5へ移動（${w}px）：実行開始済みの計画が、目的・担当・実施事項・KPIつきで表示される`, async () => {
      const p = await openExecPage(aliceCtx, `STAGE5 ${w}px`, w, 900);
      try {
        const panel = p.locator('section[aria-label="実行計画"]');
        await panel.waitFor({ timeout: 10000 });
        await panel.getByText('既存顧客の保守契約更新').first().waitFor({ timeout: 10000 });
        const text = await panel.innerText();
        assert(text.includes('実行計画（STAGE4・実行開始済み）'), '見出しが無い');
        assert(text.includes('取り組む理由'), '目的が無い');
        assert(text.includes('実施事項'), '実施事項が無い');
        assert(text.includes('担当：'), '担当が無い');
        assert((await panel.locator('tbody tr').count()) > 0, 'KPIが無い');
        assert((await p.getByRole('button', { name: /既存顧客の保守契約更新/ }).count()) > 0, '既存の実行画面のカードが消えた');
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 1, `横にはみ出している（${overflow}px）`);
        await panel.screenshot({ path: path.join(shotsDir, `stage5-plan-${w}.png`) });
        return '目的・担当・実施事項・KPIあり、既存のカードあり、はみ出しなし';
      } finally {
        await p.close();
      }
    });
  }
  await check('STAGE5は読み取り専用：実行画面の表示で、計画の保存・採用・開始の要求は出ない', async () => {
    const writes = apiLog.slice(s5ApiBefore).filter((c) => c.method !== 'GET');
    assert(writes.length === 0, `書き込みの要求が出た（${writes.length}件）`);
    return `要求 ${apiLog.length - s5ApiBefore}件（すべて読み取り）`;
  });
  await check('STAGE5の既存データ（KPI・実績・okrsV2）は、表示の前後で変わらない', async () => {
    const after = JSON.stringify((await env.strategyRow(STRATEGY_A)).departments.map((d) => d.projects.map((p) => p.okrsV2 ?? null)));
    assert(after === s5OkrBefore, 'okrsV2 が変わった');
    return 'okrsV2 不変';
  });

  /* ---- 10.対象の変更：別のプロジェクトを開いても、この計画の記録は混ざらない ---- */
  await check('対象の変更：別のプロジェクトでは記録が出ず、戻すと同じ記録に戻る', async () => {
    await pick(alice, '点検工程の標準化');
    await alice.waitForTimeout(300);
    assert((await alice.locator(RECORDS).count()) === 0 || !(await alice.locator(RECORDS).innerText()).includes('採用：版'), '別の計画に記録が混ざった');
    await pick(alice, '既存顧客の保守契約更新');
    await alice.locator(RECORDS).getByText(/採用：版 \d+/).waitFor({ timeout: 8000 });
    return '混ざらない・戻すと復元';
  });

  /* ---- 11. 他社の社員は読めない ---- */
  const carol = await openPage(carolCtx, '他社の社員');
  await check('他社の社員：同じ画面を開いても、この計画は読めない（権限なし）', async () => {
    await pick(carol, '既存顧客の保守契約更新');
    await carol.getByText('この計画を見る権限がありません。').waitFor({ timeout: 8000 });
    assert((await carol.locator(GEN).count()) === 0, '他社の社員に計画が見えている');
    const body = await carol.locator('body').innerText();
    assert(!body.includes('Aの修正：競合する案') && !body.includes('採用：版'), '他社の社員に内容が見えている');
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

  /* ---- 12. IDのないプロジェクト：番号を付けてから作る。未保存のSTAGE3の変更は書き込まない ---- */
  const stripped = JSON.parse(JSON.stringify((await env.strategyRow(STRATEGY_A)).departments));
  delete stripped[1].projects[0].id;
  await env.setStrategyA(stripped);
  const revBefore = (await env.strategyRow(STRATEGY_A)).revision;
  await loadStrategyFromDb(alice);
  apiLog.length = 0;
  await check('IDのないプロジェクト：未保存のSTAGE3の変更を書き込まず、番号を付けてから計画を作る', async () => {
    await pick(alice, '点検工程の標準化');
    await alice.evaluate(() => {
      const s = window.__getStrategyState();
      const d = JSON.parse(JSON.stringify(s.departments));
      d[0].mission = '未保存のSTAGE3の変更（書き込まれてはいけない）';
      window.__setStrategyState({ departments: d });
    });
    await createPlan(alice);
    const order = apiLog.map((x) => `${x.method} ${x.pathname.replace('/api/stage4/', '')}`);
    const idIndex = order.findIndex((x) => x.includes('project-identity'));
    const genIndex = order.findIndex((x) => x.includes('plan-documents/generate'));
    assert(idIndex >= 0 && genIndex > idIndex, `順序が違う（${order.join(' → ')}）`);
    const r = await env.strategyRow(STRATEGY_A);
    assert(r.departments[0].mission !== '未保存のSTAGE3の変更（書き込まれてはいけない）', '未保存の変更が書き込まれた');
    const newId = r.departments[1].projects[0].id;
    assert(typeof newId === 'string' && newId.length > 0, '番号が付いていない');
    assert(r.revision === revBefore + 1, `版番号が1だけ進んでいない（${revBefore} → ${r.revision}）`);
    const rows = await env.planRows();
    assert(rows.some((x) => x.project_id === newId), '番号と計画が対応していない');
    return `番号を付与（${order.join(' → ')}）`;
  });
  await check('IDを付けた後：別の画面で開き直しても、同じ番号で同じ計画を開ける', async () => {
    const again = await openPage(aliceCtx, '社員A（番号の後）');
    await pick(again, '点検工程の標準化');
    await again.locator(GEN).waitFor({ timeout: 8000 });
    assert((await again.getByRole('button', { name: /AIで実行計画書を作る/ }).count()) === 0, '作成済みなのに作成のボタンが出ている');
    await again.close();
    return '開き直し・再生成なし';
  });

  /* ---- 13. 同時変更：古い版番号での番号付与は拒否され、既に付いた番号は重複しない ---- */
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

  /* ---- 14. 表示：1024px・768px（採用・開始の記録まで読める） ---- */
  for (const [w, h, shot] of [
    [1024, 768, '02-tablet-1024'],
    [768, 1024, '03-tablet-768'],
  ]) {
    const tctx = await openContext(browser, USERS.alice, w, h);
    const tp = await openPage(tctx, `タブレット${w}`, w, h);
    await check(`${w}px：保存済みの計画と記録が横にはみ出さず読める`, async () => {
      await pick(tp, '既存顧客の保守契約更新');
      await tp.locator(GEN).waitFor({ timeout: 8000 });
      const overflow = await tp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, `横にはみ出す（${overflow}px）`);
      await tp.locator(RECORDS).screenshot({ path: path.join(shotsDir, `${shot}-records.png`) });
      return '横のはみ出しなし';
    });
    await tp.close();
    await tctx.close();
  }

  /* ---- 15. STAGE3のKPI・通信・エラー ---- */
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
