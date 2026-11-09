/* 既存の /okr 画面（実レイアウト）で、STAGE3の保存構造（架空）を読み取り専用に表示する検証（評価専用）。
 * 読み取り元はストア（ハーネスのスタブに注入）。保存・AI生成・okrsV2の変更が起きないこと、
 * 別企業や同名のプロジェクトが混ざらないこと、切替や読み込み中に古い情報が残らないこと、
 * 1440・1024・768px で文書が読めて、AI経営コンサルタントの表示方法が正しいことを確かめる。file:// 以外の通信は遮断する。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const shotsDir = path.join(outDir, 'stage3-read-shots');
const MOCK_COMPANY_ID = '00000000-0000-4000-8000-00000000c0de';
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
const NAV = 'nav[aria-label="STAGE3のプロジェクト一覧"]';
const COMPANY_B_TEXT = ['架空食品加工株式会社', '他社だけの案件', '他社の秘密のKPI', '他社の新規KPI'];
const STAGE3_NAMES = ['既存顧客の保守契約更新', '点検工程の標準化', '医療機関向け計測ソリューションの試験導入'];

async function open(browser, w, h, label) {
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
  return page;
}

const seed = (page) => page.evaluate((id) => window.__seedStage3(id), MOCK_COMPANY_ID);
const setStore = (page, partial) => page.evaluate((p) => window.__setStrategyState(p), partial);
const stateSnapshot = (page) => page.evaluate(() => JSON.stringify(window.__getStrategyState().departments));
const saveCalls = (page) =>
  page.evaluate(
    () =>
      (window.__storeLog || []).filter((e) => /save/i.test(e.action)).length +
      (window.__dbWriteCalls || []).length +
      (window.__okrCalls || []).length
  );
const sectionText = (page) => page.locator(SECTION).innerText();
const articleText = (page) => page.locator(ARTICLE).innerText();
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
const drawerOf = (page) => page.locator('div[aria-hidden].fixed.inset-0').filter({ has: page.getByPlaceholder('質問を入力してください') });

(async () => {
  fs.mkdirSync(shotsDir, { recursive: true });
  const browser = await chromium.launch();

  /* ---------- デスクトップ 1440px ---------- */
  const page = await open(browser, 1440, 900, 'デスクトップ');

  await check('既定の状態：所属企業と違う企業の情報は、一覧にも表示にも出さない', async () => {
    const t = await page.locator(SECTION).count();
    assert(t === 0 || !(await sectionText(page)).includes('既存顧客の保守契約更新'), '所属外の企業の情報が出ている');
    const msg = await page.getByRole('status').innerText();
    assert(msg.includes('一致しません'), `不一致の表示がない（${msg}）`);
    return '不一致として何も出さない';
  });

  await seed(page);
  const before = await stateSnapshot(page);
  const savesBefore = await saveCalls(page);

  await check('一覧：所属企業の部門とプロジェクトが、部門名と区別して並ぶ', async () => {
    const text = await sectionText(page);
    assert(text.includes('架空精密計測株式会社（評価用）'), '企業名がない');
    for (const d of ['営業部', '設計部', '新規事業開発部']) assert(text.includes(d), `部門「${d}」がない`);
    for (const t of STAGE3_NAMES) assert(text.includes(t), `プロジェクト「${t}」がない`);
    assert((await page.locator(NAV).getByText('部門', { exact: true }).count()) === 3, '部門の見出しが3件でない');
    return '部門3件・プロジェクト5件';
  });

  await check('一覧：別の企業の部門・プロジェクト・KPIは出ない', async () => {
    const text = await sectionText(page);
    for (const t of COMPANY_B_TEXT) assert(!text.includes(t), `別の企業の表示が出ている：${t}`);
    return '別企業の文言 0件';
  });

  await check('一覧：プロジェクトのボタンは選びやすい大きさ（高さ36px以上）', async () => {
    const boxes = await page.locator(NAV).locator('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    assert(boxes.length === 5 && boxes.every((h) => h >= 36), `高さ ${boxes.map(Math.round).join(',')}`);
    return `ボタン ${boxes.length}件、最小 ${Math.round(Math.min(...boxes))}px`;
  });

  await check('表示：既存顧客の保守契約更新の目的・仮説・部門の戦略・役割が読める', async () => {
    await pick(page, '既存顧客の保守契約更新');
    const t = await articleText(page);
    for (const s of ['保守契約の更新率を高める', '更新案内を早めると、解約が減る', '既存顧客の保守契約を守りながら', '既存顧客との関係を深め']) {
      assert(t.includes(s), `表示に「${s}」がない`);
    }
    assert(t.includes('売上を伸ばす'), '役割の表示がない');
    return '目的・仮説・部門の戦略・役割';
  });

  await check('表示：KPIは確定・入力済み（確定の印なし）・AI仮提案に分かれ、目標0は0%と出る', async () => {
    const rows = await page.locator(ARTICLE).locator('tr', { hasText: /保守契約の継続率|更新案内の到達率|更新時の値引き率/ }).allInnerTexts();
    const joined = rows.join('\n');
    assert(/保守契約の継続率[\s\S]*95%[\s\S]*確定/.test(joined), '確定KPIの表示が違う');
    assert(/更新案内の到達率[\s\S]*0%[\s\S]*入力済み（確定の印なし）/.test(joined), '目標0・未確認の表示が違う');
    assert(/更新時の値引き率[\s\S]*3%[\s\S]*AIの仮の目標（確定ではない）/.test(joined), 'AI仮提案の表示が違う');
    return '3件の状態が正しい';
  });

  await check('表示：読み取り専用で、修正・採用の操作が出ない', async () => {
    const t = await articleText(page);
    assert(t.includes('STAGE3で変更します'), '確定KPIの注意がない');
    assert((await page.getByRole('button', { name: '計画書を修正する' }).count()) === 0, '修正の操作が出ている');
    assert((await page.getByRole('button', { name: 'この計画案を採用する' }).count()) === 0, '採用の操作が出ている');
    return '操作なし';
  });

  await check('計画なし：「実行計画書はまだ作成されていません。」と出し、計画書は出さない', async () => {
    const t = await articleText(page);
    assert(t.includes('実行計画書はまだ作成されていません。'), '計画なしの文言がない');
    assert((await page.locator('.plan-kicker', { hasText: '実行計画書' }).count()) === 0, '計画書が勝手に出ている');
    return '計画なしの文言のみ';
  });

  await check('切替：同じ名前の「新規顧客開拓」は、部門ごとに別の内容になる', async () => {
    await pick(page, '新規顧客開拓', '営業部');
    let t = await articleText(page);
    assert(t.includes('紹介件数') && t.includes('営業部'), '営業部の内容がない');
    assert(!t.includes('設計提案の件数'), '設計部の内容が混ざった');
    await pick(page, '新規顧客開拓', '設計部');
    t = await articleText(page);
    assert(t.includes('設計提案の件数') && t.includes('設計部'), '設計部の内容が出ない');
    assert(!t.includes('紹介件数'), '営業部の内容が混ざった');
    return '営業部と設計部で別の内容';
  });

  await check('切替：目的がないプロジェクトは「未入力」と出し、目的を作らない', async () => {
    await pick(page, '新規顧客開拓', '営業部');
    assert((await articleText(page)).includes('未入力（STAGE3で目的が入力されていません）'), '未入力の表示がない');
    return '未入力';
  });

  await check('切替：別のプロジェクトに移ると、前の表示は残らない', async () => {
    await pick(page, '既存顧客の保守契約更新');
    const t = await articleText(page);
    assert(!t.includes('紹介件数') && t.includes('保守契約の継続率'), '前のプロジェクトの内容が残っている');
    return '表示は切替先だけ';
  });

  await check('読み込み中：選択中の表示を、前の企業の情報ごと消す', async () => {
    await setStore(page, { pendingCompanyId: 'other-company' });
    await page.waitForTimeout(250);
    const msg = await page.getByRole('status').innerText();
    assert(msg.includes('読み込んでいます'), `読み込み中の表示がない（${msg}）`);
    const text = (await page.locator(SECTION).count()) ? await sectionText(page) : '';
    assert(!text.includes('既存顧客の保守契約更新') && (await page.locator(ARTICLE).count()) === 0, '読み込み中に前の情報が残っている');
    await setStore(page, { pendingCompanyId: null });
    await page.waitForTimeout(250);
    assert((await page.locator(ARTICLE).count()) === 0, '読み込み直後に前の選択が残っている');
    assert((await page.locator(SECTION).innerText()).includes('既存顧客の保守契約更新'), '読み込み後に一覧が戻らない');
    return '読み込み中は非表示、完了後は選択を持ち越さない';
  });

  await check('会社の不一致：ストアの企業が所属企業と違えば、名前も内容も出さない', async () => {
    await setStore(page, { companyId: 'other-company' });
    await page.waitForTimeout(250);
    const msg = await page.getByRole('status').innerText();
    assert(msg.includes('一致しません'), `不一致の表示がない（${msg}）`);
    assert((await page.locator(SECTION).count()) === 0, '一覧が出ている');
    const body = await page.locator('body').innerText();
    for (const t of [...STAGE3_NAMES, ...COMPANY_B_TEXT]) assert(!body.includes(t), `不一致の状態で「${t}」が出ている`);
    await setStore(page, { companyId: MOCK_COMPANY_ID });
    await page.waitForTimeout(250);
    assert((await page.locator(SECTION).count()) === 1, '所属企業に戻っても一覧が出ない');
    return '不一致は何も出さず、戻れば再表示';
  });

  await check('保存・AI・okrsV2：読み取りの前後で、保存の呼び出しも部門データの変更もない', async () => {
    assert((await stateSnapshot(page)) === before, 'okrsV2（部門データ）が変わった');
    assert((await saveCalls(page)) === savesBefore, '保存の呼び出しが増えた');
    return '保存の呼び出し 0件・部門データ不変';
  });

  await check('デスクトップ：AI経営コンサルタントが右に常時表示される', async () => {
    const ai = page.locator('aside').filter({ has: page.getByPlaceholder('質問を入力してください') }).getByText('AI経営コンサルタント', { exact: true }).first();
    const box = await ai.boundingBox();
    assert(box && box.x > 1100, `AI経営コンサルタントが右側にない（x=${box && box.x}）`);
    return `右側（x=${Math.round(box.x)}）`;
  });

  await check('デスクトップ 1440px：文書が読める幅で、横にはみ出さない', async () => {
    await pick(page, '既存顧客の保守契約更新');
    const p = await page.locator(ARTICLE).boundingBox();
    assert(p && p.width >= 700, `文書が狭い（${p && Math.round(p.width)}px）`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(overflow <= 1, `横にはみ出す（${overflow}px）`);
    await page.screenshot({ path: path.join(shotsDir, '01-desktop-1440.png') });
    return `文書 ${Math.round(p.width)}px`;
  });
  await page.close();

  /* ---------- タブレット 1024px / 768px ---------- */
  for (const [w, h, shot] of [
    [1024, 768, '02-tablet-1024'],
    [768, 1024, '03-tablet-768'],
  ]) {
    const label = `タブレット ${w}px`;
    const tp = await open(browser, w, h, label);
    await seed(tp);
    const appScroll = tp.locator('#app-scroll');
    const headerBtn = appScroll.getByRole('button', { name: 'AI経営コンサルタント', exact: true });
    const drawer = drawerOf(tp);
    const drawerOpen = async () => (await drawer.getAttribute('aria-hidden')) === 'false';
    const drawerClose = () => drawer.getByRole('button', { name: '閉じる', exact: true });

    await check(`${label}：一覧とプロジェクトの選択が、1列で読める`, async () => {
      await pick(tp, '既存顧客の保守契約更新');
      const nav = await tp.locator(NAV).boundingBox();
      const art = await tp.locator(ARTICLE).boundingBox();
      assert(nav && art, '一覧か文書が見つからない');
      assert(art.y >= nav.y + nav.height - 1, '文書が一覧の横に並んでいる（上下になっていない）');
      assert(art.width >= 480, `文書が狭い（${Math.round(art.width)}px）`);
      const overflow = await tp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, `横にはみ出す（${overflow}px）`);
      const tables = await tp.evaluate(() =>
        Array.from(document.querySelectorAll('article[aria-label="STAGE3の情報（読み取り専用）"] table')).filter(
          (t) => t.scrollWidth > t.parentElement.clientWidth + 1
        ).length
      );
      assert(tables === 0, `表がはみ出す（${tables}個）`);
      return `文書 ${Math.round(art.width)}px、横のはみ出し 0`;
    });

    await check(`${label}：AI経営コンサルタントは初期で閉じ、ボタンで開き、「閉じる」で閉じる`, async () => {
      assert((await drawerOpen()) === false, '初期状態で開いている');
      await headerBtn.click();
      await tp.waitForTimeout(400);
      assert((await drawerOpen()) === true, 'ボタンで開かない');
      assert((await drawerClose().count()) === 1, '閉じるボタンがない');
      await tp.screenshot({ path: path.join(shotsDir, `${shot}-ai-open.png`) });
      await drawerClose().click();
      await tp.waitForTimeout(300);
      assert((await drawerOpen()) === false, '閉じるボタンで閉じない');
      return '開閉できる';
    });

    await check(`${label}：開閉しても、選んでいたプロジェクトと表示が残る`, async () => {
      const t = await articleText(tp);
      assert(t.includes('既存顧客の保守契約更新') && t.includes('保守契約の継続率'), '開閉後に表示が消えた');
      return '表示を保持';
    });

    await check(`${label}：文書の全体を画面に出した状態を保存する`, async () => {
      await tp.locator(ARTICLE).screenshot({ path: path.join(shotsDir, `${shot}-document.png`) });
      await tp.screenshot({ path: path.join(shotsDir, `${shot}-page.png`) });
      return '画像を保存';
    });
    await tp.close();
  }

  await check('通信：file:// 以外への通信がない', async () => {
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
