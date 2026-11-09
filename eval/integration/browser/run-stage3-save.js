/* 既存の /okr 画面（実レイアウト）で、実行計画書の草案を保存し、後日その続きから編集できることを確かめる（評価専用）。
 * 保存先はこのブラウザの保存領域（開発用の仮の保存先）。DB・OpenAI・本番には接続しない。
 * 保存・再表示・再編集、切替での混在、並び替え・名称変更、競合、保存失敗、他社の拒否、
 * IDのないプロジェクトへの番号の付与、okrsV2の不変、1440・1024・768px の表示を確かめる。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const shotsDir = path.join(outDir, 'stage3-save-shots');
const MOCK_COMPANY_ID = '00000000-0000-4000-8000-00000000c0de';
const RENEWAL = { companyId: MOCK_COMPANY_ID, strategyId: '00000000-0000-4000-8000-0000000057a1', projectId: 'fict-proj-renewal' };
const results = [];
const external = [];
const errors = [];

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

const NAV = 'nav[aria-label="STAGE3のプロジェクト一覧"]';
const GEN = 'article[aria-label="実行計画書"]';
const ARTICLE = 'article[aria-label="STAGE3の情報（読み取り専用）"]';
const SAVE_BTN = { name: '草案として保存' };

async function open(context, w, h, label, { stripTitle = null } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width: w, height: h });
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('ERR_FILE_NOT_FOUND')) return;
    errors.push(`${label} console ${m.text()}`);
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:')) return route.continue();
    external.push(url.slice(0, 100));
    return route.abort();
  });
  await page.goto(pathToFileURL(path.join(outDir, 'okr-shell.html')).href);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /開発用：新しい実行計画書を表示/ }).click();
  const source = page.getByRole('button', { name: 'STAGE3の実プロジェクト（読み取り専用）' });
  await source.waitFor({ timeout: 8000 });
  await source.click();
  await page.evaluate((id) => window.__seedStage3(id), MOCK_COMPANY_ID);
  if (stripTitle) {
    await page.evaluate((title) => {
      const s = window.__getStrategyState();
      const departments = JSON.parse(JSON.stringify(s.departments));
      for (const d of departments) for (const p of d.projects ?? []) if (p.title === title) delete p.id;
      window.__setStrategyState({ departments });
    }, stripTitle);
  }
  await page.locator(NAV).waitFor({ timeout: 8000 });
  return page;
}

const pick = async (page, title, deptName) => {
  const nav = page.locator(NAV);
  if (deptName) {
    const dept = nav.locator('div.rounded-lg', { has: page.locator('div.font-semibold', { hasText: deptName }) }).first();
    await dept.locator('button', { hasText: title }).click();
  } else {
    await nav.locator('button', { hasText: title }).first().click();
  }
  await page.waitForTimeout(250);
};
const statusCount = (page, text) => page.locator('p.plan-note', { hasText: text }).count();
const createPlan = async (page) => {
  await page.getByRole('button', { name: /AIで実行計画書を作る（モック）/ }).click();
  await page.locator(GEN).waitFor({ timeout: 8000 });
};
const editField = async (page, label, text) => {
  await page.getByRole('toolbar', { name: '計画書の操作' }).getByRole('button', { name: '計画書を修正する' }).click();
  const opener = page.locator(GEN).getByRole('button', { name: `${label}を修正する` });
  if ((await opener.count()) > 0) await opener.first().click();
  const field = page.locator(GEN).getByLabel(label, { exact: true });
  await field.fill(text);
  await page.getByRole('toolbar', { name: '計画書の操作' }).getByRole('button', { name: '修正を反映する' }).click();
  await page.waitForTimeout(150);
};
const saveCalls = (page) =>
  page.evaluate(() => (window.__storeLog || []).filter((e) => /save/i.test(e.action)).length);
const stateSnapshot = (page) => page.evaluate(() => JSON.stringify(window.__getStrategyState().departments));
const kpiSnapshot = (page) =>
  page.evaluate(() =>
    JSON.stringify(
      window.__getStrategyState().departments.flatMap((d) => d.projects.map((p) => ({ id: p.id ?? null, okrsV2: p.okrsV2 ?? null })))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    )
  );

(async () => {
  fs.mkdirSync(shotsDir, { recursive: true });
  const browser = await chromium.launch();

  /* ---------- 1. 保存 → 画面を離れる → 再び開く → 再編集（同じ保存領域） ---------- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await open(ctx, 1440, 900, 'デスクトップ');
  const before = await kpiSnapshot(page);
  const savesAtStart = await saveCalls(page);
  let again = null;

  await check('作成→修正→保存：草案が保存され、版1と表示される', async () => {
    await pick(page, '既存顧客の保守契約更新');
    await createPlan(page);
    await editField(page, '実施事項1', '検証用の修正：現状の数字を集める');
    await page.getByRole('button', SAVE_BTN).click();
    await page.waitForFunction(() => document.body.innerText.includes('保存済み（版 1）'), null, { timeout: 8000 });
    assert((await statusCount(page, '保存済み（版 1）')) === 1, '保存済みの表示がない');
    return '版 1 で保存';
  });

  await check('画面を離れる→戻る：保存された修正が復元される（同じ版）', async () => {
    await pick(page, '点検工程の標準化');
    assert((await page.locator(GEN).count()) === 0, '別のプロジェクトに文書が出ている');
    await pick(page, '既存顧客の保守契約更新');
    await page.locator(GEN).waitFor({ timeout: 8000 });
    assert((await page.locator(GEN).innerText()).includes('検証用の修正：現状の数字を集める'), '保存した修正が復元されていない');
    assert((await statusCount(page, '保存済み（版 1）')) === 1, '版の表示が戻らない');
    return '修正を復元';
  });

  await check('作り直しの防止：保存済みの草案がある間は、AIで作る操作を出さない', async () => {
    assert((await page.getByRole('button', { name: /AIで実行計画書を作る/ }).count()) === 0, '保存済みなのに作成のボタンが出ている');
    return '作成のボタンなし';
  });

  await check('並び替え・名称変更の後も、同じ計画に対応する', async () => {
    await page.evaluate(() => {
      const s = window.__getStrategyState();
      const departments = JSON.parse(JSON.stringify(s.departments));
      const sales = departments[0];
      sales.projects = [...sales.projects].reverse();
      const renewal = sales.projects.find((p) => p.id === 'fict-proj-renewal');
      renewal.title = '既存顧客の保守契約更新（改題）';
      window.__setStrategyState({ departments });
    });
    await page.waitForTimeout(200);
    await pick(page, '既存顧客の保守契約更新（改題）');
    await page.locator(GEN).waitFor({ timeout: 8000 });
    assert((await page.locator(GEN).innerText()).includes('検証用の修正：現状の数字を集める'), '並び替え・改題の後に計画が見つからない');
    return '改題・並び替え後も復元';
  });

  await check('再編集：復元した草案をさらに修正して保存すると、版2になる', async () => {
    await editField(page, '実施事項1', '検証用の再修正：集め方を決める');
    await page.getByRole('button', SAVE_BTN).click();
    await page.waitForFunction(() => document.body.innerText.includes('保存済み（版 2）'), null, { timeout: 8000 });
    return '版 2 で保存';
  });

  await check('採用：採用の状態も、保存されて戻る', async () => {
    await page.getByRole('button', { name: 'この計画案を採用する' }).click();
    await page.getByRole('button', SAVE_BTN).click();
    await page.waitForFunction(() => document.body.innerText.includes('保存済み（版 3）'), null, { timeout: 8000 });
    await page.close();
    again = await open(ctx, 1440, 900, '再表示');
    await pick(again, '既存顧客の保守契約更新');
    await again.locator(GEN).waitFor({ timeout: 8000 });
    const t = await again.locator(GEN).innerText();
    assert(t.includes('検証用の再修正：集め方を決める'), '再編集の内容が戻っていない');
    const adoption = await again.locator('section[aria-label="計画案の採用"]').innerText();
    assert(adoption.includes('採用済み'), '採用の状態が戻っていない');
    assert((await statusCount(again, '保存済み（版 3）')) === 1, '版3の表示が戻らない');
    return '別の表示（再読み込み）でも、版3・採用・修正が戻る';
  });

  await check('他社の拒否：別の会社の利用者は、この計画を読めない', async () => {
    const out = await again.evaluate(async (key) => {
      const r = await window.__planStore.load({ userId: 'eve', memberships: [{ companyId: 'other-co', role: 'admin' }] }, key);
      return r.status;
    }, RENEWAL);
    assert(out === 'DENIED', `拒否されていない（${out}）`);
    return 'DENIED';
  });

  await check('okrsV2・保存の呼び出し：草案の保存の前後で、部門データは変わらない（AI提案KPIを入れない）', async () => {
    const after = await kpiSnapshot(again);
    assert(after === before, 'okrsV2（部門データ）が変わった');
    assert((await saveCalls(again)) === savesAtStart, 'STAGE3の戦略保存が呼ばれた');
    return '部門データ不変・戦略保存 0件';
  });

  /* ---------- 2. 同時編集：競合の検出と、項目ごとの選択 ---------- */
  await check('競合（重ならない修正）：自動で統合して保存される', async () => {
    await again.evaluate(async (key) => {
      await window.__planStore.simulateRemoteSave(key, { 'action:2:title': '他の人の修正：打ち手を決める' }, 'bob');
    }, RENEWAL);
    await editField(again, '実施事項1', '検証用：行動1を変更');
    await again.getByRole('button', SAVE_BTN).click();
    await again.waitForFunction(() => document.body.innerText.includes('他の人の修正を取り込みました'), null, { timeout: 8000 }).catch(async (e) => {
      const notes = await again.locator('p.plan-note').allInnerTexts();
      throw new Error('merge status not shown; notes=' + JSON.stringify(notes.slice(-4)));
    });
    const t = await again.locator(GEN).innerText();
    assert(t.includes('他の人の修正：打ち手を決める') && t.includes('検証用：行動1を変更'), '片方の修正が消えた');
    return '両方の修正が残る';
  });

  await check('競合（同じ項目）：検出して、項目ごとに選んでから保存し直せる。どちらも失わない', async () => {
    await again.evaluate(async (key) => {
      await window.__planStore.simulateRemoteSave(key, { 'action:1:title': '他の人の案（行動1）' }, 'bob');
    }, RENEWAL);
    await editField(again, '実施事項1', 'あなたの案（行動1）');
    await again.getByRole('button', SAVE_BTN).click();
    await again.waitForFunction(() => document.body.innerText.includes('他の人が先に保存しています'), null, { timeout: 8000 });
    const panel = again.getByRole('region', { name: '保存の競合' });
    assert((await panel.count()) === 1, '競合の表示がない');
    assert((await again.getByRole('button', { name: '選んだ内容で保存し直す' }).isDisabled()) === true, '選ぶ前に保存し直せる');
    await panel.getByRole('button', { name: 'あなたの修正を残す' }).first().click();
    await again.getByRole('button', { name: '選んだ内容で保存し直す' }).click();
    await again.waitForFunction(() => /保存済み（版 \d+）/.test(document.body.innerText), null, { timeout: 8000 });
    const t = await again.locator(GEN).innerText();
    assert(t.includes('あなたの案（行動1）'), '選んだ修正が残っていない');
    return '選んだ内容で保存し直した';
  });

  /* ---------- 3. 保存の失敗：編集内容を失わない ---------- */
  await check('保存の失敗：失敗と表示し、編集内容は画面に残る（成功とは見せない）', async () => {
    await again.evaluate(() => window.__planStore.failNext('write'));
    await editField(again, '実施事項1', '失敗しても残る修正');
    await again.getByRole('button', SAVE_BTN).click();
    await again.waitForFunction(() => document.body.innerText.includes('保存できませんでした'), null, { timeout: 8000 });
    assert((await statusCount(again, '保存済み')) <= 1, '失敗なのに保存済みと出ている');
    assert((await again.locator(GEN).innerText()).includes('失敗しても残る修正'), '失敗で編集内容が消えた');
    await again.getByRole('button', SAVE_BTN).click();
    await again.waitForFunction(() => /保存済み（版 \d+）/.test(document.body.innerText), null, { timeout: 8000 });
    return '失敗を表示し、再保存で成功';
  });

  /* ---------- 4. IDのないプロジェクト：保存のときに番号を一度だけ付ける ---------- */
  const noId = await open(ctx, 1440, 900, 'IDなし', { stripTitle: '点検工程の標準化' });
  const noIdBefore = await stateSnapshot(noId);
  const noIdSaves = await saveCalls(noId);
  await check('IDのないプロジェクト：作成しただけでは、データを書き換えない', async () => {
    await pick(noId, '点検工程の標準化');
    await createPlan(noId);
    assert((await stateSnapshot(noId)) === noIdBefore, '作成だけでデータが変わった');
    return '作成のみ：変更なし';
  });
  await check('IDのないプロジェクト：保存で番号を一度だけ付け、戦略全体の保存は呼ばない', async () => {
    await noId.getByRole('button', SAVE_BTN).click();
    await noId.waitForFunction(() => document.body.innerText.includes('保存済み（版 1）'), null, { timeout: 8000 });
    const dept = await noId.evaluate(() => {
      const s = window.__getStrategyState();
      const p = s.departments[1].projects.find((x) => x.title === '点検工程の標準化');
      return { id: p.id ?? null, others: s.departments.flatMap((d) => d.projects.map((x) => x.id ?? null)) };
    });
    assert(typeof dept.id === 'string' && dept.id.length > 0, '番号が付いていない');
    assert((await saveCalls(noId)) === noIdSaves, `戦略全体の保存が ${(await saveCalls(noId)) - noIdSaves} 回呼ばれた`);
    return `番号を付与（戦略全体の保存 0 回）`;
  });
  await check('IDのないプロジェクト：番号を付けた後も、同じ計画を再び開ける', async () => {
    await pick(noId, '点検工程の標準化');
    await noId.locator(GEN).waitFor({ timeout: 8000 });
    assert((await statusCount(noId, '保存済み（版 1）')) === 1, '番号付与の後に版が見えない');
    return '番号の後も対応';
  });

  /* ---------- 5. 表示：1024px・768px ---------- */
  for (const [w, h, shot] of [
    [1024, 768, '02-tablet-1024'],
    [768, 1024, '03-tablet-768'],
  ]) {
    const tctx = await browser.newContext({ viewport: { width: w, height: h } });
    const tp = await open(tctx, w, h, `タブレット${w}`);
    await pick(tp, '既存顧客の保守契約更新');
    await createPlan(tp);
    await check(`${w}px：保存のボタンと草案が横にはみ出さず、読める`, async () => {
      const overflow = await tp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, `横にはみ出す（${overflow}px）`);
      const box = await tp.locator(GEN).boundingBox();
      assert(box && box.width >= 480, `草案が狭い（${box && Math.round(box.width)}px）`);
      await tp.locator(GEN).screenshot({ path: path.join(shotsDir, `${shot}-draft.png`) });
      return `草案 ${Math.round(box.width)}px`;
    });
    await tp.close();
    await tctx.close();
  }

  await check('通信：file:// 以外への通信がない（保存先はブラウザ内）', async () => {
    assert(external.length === 0, `外部への通信 ${external.length} 件`);
    return '外部通信 0件';
  });
  await check('ブラウザ実行中に例外・コンソールエラーがない', async () => {
    assert(errors.length === 0, errors.slice(0, 3).join(' | '));
    return 'エラー 0件';
  });

  await browser.close();
  const pass = results.filter((r) => r.status === 'PASS').length;
  console.log(JSON.stringify({ total: results.length, pass }));
  if (pass !== results.length) process.exitCode = 1;

})();
