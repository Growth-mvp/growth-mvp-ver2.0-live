/* 既存の /okr 画面（実レイアウト）で、STAGE3のプロジェクトから実行計画書をモックで作り、画面の中で修正できることを確かめる（評価専用）。
 * AIは呼ばず、保存はしない。作成の結果は okrsV2 や保存の呼び出しに影響しないこと、別のプロジェクト・企業に混ざらないこと、
 * 安定IDのないプロジェクトでも動くこと、失敗時に理由を出すこと、1440・1024・768px で崩れないことを確かめる。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const shotsDir = path.join(outDir, 'stage3-generate-shots');
const MOCK_COMPANY_ID = '00000000-0000-4000-8000-00000000c0de';
const MARK = '検証用の修正文（画面の中だけ）';
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

const SECTION = 'section[aria-label="表示するプロジェクトの選択"]';
const ARTICLE = 'article[aria-label="STAGE3の情報（読み取り専用）"]';
const GEN = 'article[aria-label="実行計画書"]';
const NAV = 'nav[aria-label="STAGE3のプロジェクト一覧"]';
const MAKE_BTN = /AIで実行計画書を作る（モック）|もう一度作る（モック）/;

async function open(browser, w, h, label, { stripRenewalId = false } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
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
  if (stripRenewalId) {
    await page.evaluate(() => {
      const s = window.__getStrategyState();
      const departments = JSON.parse(JSON.stringify(s.departments));
      for (const d of departments) for (const p of d.projects ?? []) if (p.title === '既存顧客の保守契約更新') delete p.id;
      window.__setStrategyState({ departments });
    });
  }
  await page.locator(NAV).waitFor({ timeout: 8000 });
  return page;
};

const stateSnapshot = (page) => page.evaluate(() => JSON.stringify(window.__getStrategyState().departments));
const saveCalls = (page) =>
  page.evaluate(
    () =>
      (window.__storeLog || []).filter((e) => /save/i.test(e.action)).length +
      (window.__dbWriteCalls || []).length +
      (window.__okrCalls || []).length
  );
const pick = async (page, title, deptName) => {
  const nav = page.locator(NAV);
  if (deptName) {
    const dept = nav.locator('div.rounded-lg', { has: page.locator('div.font-semibold', { hasText: deptName }) }).first();
    await dept.locator('button', { hasText: title }).click();
  } else {
    await nav.locator('button', { hasText: title }).first().click();
  }
  await page.waitForTimeout(200);
};
const drawerOf = (page) => page.locator('div[aria-hidden].fixed.inset-0').filter({ has: page.getByPlaceholder('質問を入力してください') });

async function createPlan(page) {
  await page.getByRole('button', { name: MAKE_BTN }).click();
  await page.locator(GEN).waitFor({ timeout: 8000 });
}

(async () => {
  fs.mkdirSync(shotsDir, { recursive: true });
  const browser = await chromium.launch();

  /* ---------- デスクトップ 1440px ---------- */
  const page = await open(browser, 1440, 900, 'デスクトップ');
  const before = await stateSnapshot(page);
  const savesBefore = await saveCalls(page);

  await check('作成前：文書は「まだ作成されていません」と出し、作成のボタンを出す（保存済みの計画は無い）', async () => {
    await pick(page, '既存顧客の保守契約更新');
    const t = await page.locator(ARTICLE).innerText();
    assert(t.includes('実行計画書はまだ作成されていません。'), '未作成の文言がない');
    assert((await page.getByRole('button', { name: 'AIで実行計画書を作る（モック）' }).count()) === 1, '作成ボタンがない');
    assert((await page.locator(GEN).count()) === 0, '作成前に文書が出ている');
    return '作成ボタンあり';
  });

  await check('作成：モックで作られた文書が出て、「モック・画面の中だけ」と明示される', async () => {
    await createPlan(page);
    const doc = page.locator(GEN);
    const t = await doc.innerText();
    assert((await page.getByText('AIの草案（モック）です。実際のAIは接続していません。').count()) === 1, 'モックの表示がない');
    assert(t.includes('実行の前に、現状の数値（行動1で集める数字）を確認する'), '草案の確認事項がない');
    return '草案を表示';
  });

  await check('作成：草案の確定KPIは入力のまま（AIが作り直していない）、確定KPIの変更はない', async () => {
    const doc = page.locator(GEN);
    const t = await doc.innerText();
    assert(t.includes('保守契約の継続率') && t.includes('更新案内の到達率'), '確定KPIが草案に入っていない');
    return '確定KPIを入力のまま組み込んだ';
  });

  await check('作成：規制・安全の制約（SWOTの脅威）が、草案の障害に反映されている', async () => {
    const t = await page.locator(GEN).innerText();
    assert(t.includes('規制・安全に関する要因の確認'), '規制の制約が反映されていない');
    return '規制の制約を反映';
  });

  await check('作成：既存の採用・実行開始の操作を保持する（保存は草案として別に行う）', async () => {
    assert((await page.getByRole('button', { name: 'この計画案を採用する' }).count()) === 1, '採用の操作がない');
    assert((await page.getByRole('button', { name: '実行開始の確認へ進む' }).count()) === 1, '開始の操作がない');
    return '採用・開始の操作あり';
  });

  await check('修正：画面の中で文書を修正でき、反映すると文書に出る（保存はされない）', async () => {
    const doc = page.locator(GEN);
    await page.getByRole('toolbar', { name: '計画書の操作' }).getByRole('button', { name: '計画書を修正する' }).click();
    const editBtn = doc.locator('button[aria-label$="を修正する"]').first();
    if ((await editBtn.count()) > 0) await editBtn.click();
    const field = doc.locator('textarea, input[type="text"]').first();
    await field.fill(MARK);
    await page.getByRole('toolbar', { name: '計画書の操作' }).getByRole('button', { name: '修正を反映する' }).click();
    await page.waitForTimeout(200);
    assert((await page.locator(GEN).innerText()).includes(MARK), '修正が文書に出ていない');
    assert((await saveCalls(page)) === savesBefore, '修正で保存の呼び出しが起きた');
    return '修正を反映';
  });

  await check('別のプロジェクト：作成した文書は、別のプロジェクトに混ざらない', async () => {
    await pick(page, '点検工程の標準化');
    assert((await page.locator(GEN).count()) === 0, '別のプロジェクトに前の文書が出ている');
    assert((await page.getByRole('button', { name: 'AIで実行計画書を作る（モック）' }).count()) === 1, '別のプロジェクトで作成ボタンがない');
    return '別のプロジェクトは未作成';
  });

  await check('別のプロジェクト：元に戻ると、作成した文書と修正（画面の中）が残っている', async () => {
    await pick(page, '既存顧客の保守契約更新');
    assert((await page.locator(GEN).innerText()).includes(MARK), '修正が残っていない');
    return '修正を保持';
  });

  await check('失敗：SWOTが未入力なら、理由を出し、作り直せる（文書は出さない）', async () => {
    await page.evaluate(() => window.__setStrategyState({ strength: '' }));
    await page.waitForTimeout(150);
    await pick(page, '点検工程の標準化');
    await page.getByRole('button', { name: 'AIで実行計画書を作る（モック）' }).click();
    await page.waitForTimeout(300);
    const t = await page.locator(ARTICLE).innerText();
    assert(t.includes('STAGE2のSWOT（強み）が未入力のため、計画書を作れません'), '未入力の理由が出ていない');
    assert((await page.getByRole('button', { name: 'もう一度作る（モック）' }).count()) === 1, '作り直しのボタンがない');
    assert((await page.locator(GEN).count()) === 0, '失敗時に文書が出ている');
    await page.evaluate(() => window.__setStrategyState({ strength: '工場向けの計測器で、高い精度と長い稼働実績を持つ' }));
    await page.waitForTimeout(150);
    return 'SWOT未入力の理由を表示';
  });

  await check('会社の切替：作成した文書は、前の企業の情報として残らない', async () => {
    await pick(page, '医療機関向け計測ソリューションの試験導入');
    await createPlan(page);
    await page.evaluate(() => window.__setStrategyState({ companyId: 'other-company' }));
    await page.waitForTimeout(200);
    const body = await page.locator('body').innerText();
    assert(!body.includes('実行の前に、現状の数値（行動1で集める数字）を確認する'), '前の企業の文書が残っている');
    await page.evaluate((id) => window.__setStrategyState({ companyId: id }), MOCK_COMPANY_ID);
    await page.waitForTimeout(200);
    assert((await page.locator(GEN).count()) === 0, '戻った後に前の文書が残っている');
    return '前の企業の文書は残らない';
  });

  await check('okrsV2・保存：作成と修正の前後で、部門データの変更も保存の呼び出しもない', async () => {
    assert((await stateSnapshot(page)) === before, 'okrsV2（部門データ）が変わった');
    assert((await saveCalls(page)) === savesBefore, '保存の呼び出しが増えた');
    return '部門データ不変・保存 0件';
  });

  await check('デスクトップ：AI経営コンサルタントが右に常時表示される', async () => {
    const ai = page.locator('aside').filter({ has: page.getByPlaceholder('質問を入力してください') }).getByText('AI経営コンサルタント', { exact: true }).first();
    const box = await ai.boundingBox();
    assert(box && box.x > 1100, `AI経営コンサルタントが右側にない（x=${box && box.x}）`);
    return `右側（x=${Math.round(box.x)}）`;
  });

  await pick(page, '既存顧客の保守契約更新');
  await createPlan(page);
  await check('デスクトップ 1440px：文書が読める幅で、横にはみ出さない', async () => {
    const doc = await page.locator(GEN).boundingBox();
    assert(doc && doc.width >= 700, `文書が狭い（${doc && Math.round(doc.width)}px）`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 1, `横にはみ出す（${overflow}px）`);
    await page.locator(GEN).screenshot({ path: path.join(shotsDir, '01-desktop-1440-generated.png') });
    return `文書 ${Math.round(doc.width)}px`;
  });
  await page.close();

  /* ---------- 安定IDのないプロジェクト ---------- */
  const noId = await open(browser, 1440, 900, 'IDなし', { stripRenewalId: true });
  const noIdBefore = await stateSnapshot(noId);
  await check('安定IDなし：プロジェクトは選べて、作成できる。保存できない旨を出す', async () => {
    await pick(noId, '既存顧客の保守契約更新');
    await createPlan(noId);
    const t = await noId.locator(GEN).innerText();
    assert(t.includes('実行の前に、現状の数値（行動1で集める数字）を確認する'), '草案が出ていない');
    assert((await noId.getByText('このプロジェクトにはまだ番号（安定ID）がありません', { exact: false }).count()) === 1, '番号（安定ID）がない旨の表示がない');
    return '作成でき、保存できない旨を表示';
  });
  await check('安定IDなし：作成してもデータ（IDを含む）は書き換えない', async () => {
    assert((await stateSnapshot(noId)) === noIdBefore, 'データが変わった');
    return 'データ不変';
  });
  await noId.close();

  /* ---------- タブレット 1024px / 768px ---------- */
  for (const [w, h, shot] of [
    [1024, 768, '02-tablet-1024'],
    [768, 1024, '03-tablet-768'],
  ]) {
    const label = `タブレット ${w}px`;
    const tp = await open(browser, w, h, label);
    await pick(tp, '既存顧客の保守契約更新');
    await createPlan(tp);
    const appScroll = tp.locator('#app-scroll');
    const headerBtn = appScroll.getByRole('button', { name: 'AI経営コンサルタント', exact: true });
    const drawer = drawerOf(tp);
    const drawerOpen = async () => (await drawer.getAttribute('aria-hidden')) === 'false';
    const drawerClose = () => drawer.getByRole('button', { name: '閉じる', exact: true });

    await check(`${label}：作成した文書が横にはみ出さず、読める`, async () => {
      const doc = await tp.locator(GEN).boundingBox();
      assert(doc && doc.width >= 480, `文書が狭い（${doc && Math.round(doc.width)}px）`);
      const overflow = await tp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, `横にはみ出す（${overflow}px）`);
      const tables = await tp.evaluate(() =>
        Array.from(document.querySelectorAll('article[aria-label="実行計画書"] table')).filter((t) => t.scrollWidth > t.parentElement.clientWidth + 1).length
      );
      assert(tables === 0, `表がはみ出す（${tables}個）`);
      await tp.locator(GEN).screenshot({ path: path.join(shotsDir, `${shot}-generated.png`) });
      return `文書 ${Math.round(doc.width)}px、横のはみ出し 0`;
    });

    await check(`${label}：AI経営コンサルタントは閉じた状態から開閉でき、作成した文書は残る`, async () => {
      assert((await drawerOpen()) === false, '初期状態で開いている');
      await headerBtn.click();
      await tp.waitForTimeout(400);
      assert((await drawerOpen()) === true, 'ボタンで開かない');
      await drawerClose().click();
      await tp.waitForTimeout(300);
      assert((await drawerOpen()) === false, '閉じるボタンで閉じない');
      assert((await tp.locator(GEN).count()) === 1, '開閉で文書が消えた');
      return '開閉できて、文書は残る';
    });
    await tp.close();
  }

  await check('通信：file:// 以外への通信がない（AIの呼び出しを含む）', async () => {
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
