/* STAGE3の実プロジェクト（架空のモック）を、実際の /okr 画面の開発用の文書UIで読み取り専用に表示する検証（評価専用）。
 * 保存・AI生成・okrsV2の変更が起きないこと、別企業や同名のプロジェクトが混ざらないこと、
 * 文書型の表示（デスクトップ・タブレット）が崩れないことを確かめる。file:// 以外の通信は遮断する。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const shotsDir = path.join(outDir, 'stage3-read-shots');
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

const COMPANY_B_TEXT = ['架空食品加工株式会社', '他社だけの案件', '他社の秘密のKPI', '他社の新規KPI'];

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
  const stage3 = page.getByRole('button', { name: 'STAGE3の実プロジェクト（読み取り専用）' });
  await stage3.waitFor({ timeout: 8000 });
  await stage3.click();
  await page.locator('nav[aria-label="STAGE3のプロジェクト一覧"]').waitFor({ timeout: 8000 });
  return page;
}

const stateSnapshot = (page) => page.evaluate(() => JSON.stringify(window.__getStrategyState().departments));
const storeWrites = (page) =>
  page.evaluate(() => (window.__storeLog || []).filter((e) => /save|set|update|apply|upsert|delete/.test(e.action)).length);
const okrCalls = (page) => page.evaluate(() => (window.__okrCalls || []).length);
const dbWrites = (page) => page.evaluate(() => (window.__dbWriteCalls || []).length);

const pick = async (page, title, deptName) => {
  const btn = page.locator('nav[aria-label="STAGE3のプロジェクト一覧"] button', { hasText: title });
  if (deptName) {
    const dept = page.locator('nav[aria-label="STAGE3のプロジェクト一覧"] div.space-y-1', { hasText: deptName }).first();
    await dept.locator('button', { hasText: title }).click();
  } else {
    await btn.first().click();
  }
  await page.waitForTimeout(250);
};
const articleText = (page) => page.locator('article[aria-label="STAGE3の情報（読み取り専用）"]').innerText();

(async () => {
  fs.mkdirSync(shotsDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await open(browser, 1440, 900, 'デスクトップ');
  const before = await stateSnapshot(page);
  const writesBefore = (await storeWrites(page)) + (await dbWrites(page));
  const okrBefore = await okrCalls(page);

  await check('デスクトップ：STAGE3の一覧に、所属している企業の部門とプロジェクトが並ぶ', async () => {
    const nav = page.locator('nav[aria-label="STAGE3のプロジェクト一覧"]');
    const text = await nav.innerText();
    for (const t of ['営業部', '設計部', '新規事業開発部', '既存顧客の保守契約更新', '点検工程の標準化', '医療機関向け計測ソリューションの試験導入']) {
      assert(text.includes(t), `一覧に「${t}」がない`);
    }
    return '部門3・プロジェクト4件の所属企業分';
  });

  await check('デスクトップ：別の企業（所属していない）の部門・プロジェクト・KPIは一覧にも表示にも出ない', async () => {
    const text = await page.locator('nav[aria-label="STAGE3のプロジェクト一覧"]').innerText();
    for (const t of COMPANY_B_TEXT) assert(!text.includes(t), `別の企業の表示が出ている：${t}`);
    return '別企業の文言 0件';
  });

  await check('表示：既存顧客の保守契約更新（営業部）の目的・仮説・部門の戦略が読める', async () => {
    await pick(page, '既存顧客の保守契約更新');
    const t = await articleText(page);
    for (const s of ['保守契約の更新率を高める', '更新案内を早めると、解約が減る', '既存顧客の保守契約を守りながら', '既存顧客との関係を深め']) {
      assert(t.includes(s), `表示に「${s}」がない`);
    }
    assert(t.includes('売上を伸ばす'), '役割の表示がない');
    return '目的・仮説・部門の戦略・役割を確認';
  });

  await check('表示：KPIは確定・入力済み（確定の印なし）・AI仮提案に分かれ、目標0は0%と出る', async () => {
    const rows = page.locator('article[aria-label="STAGE3の情報（読み取り専用）"] tr', { hasText: /保守契約の継続率|更新案内の到達率|更新時の値引き率/ });
    const t = await rows.allInnerTexts();
    const joined = t.join('\n');
    assert(/保守契約の継続率[\s\S]*95%[\s\S]*確定/.test(joined), '確定KPIの表示が違う');
    assert(/更新案内の到達率[\s\S]*0%[\s\S]*入力済み（確定の印なし）/.test(joined), '目標0・未確認の表示が違う');
    assert(/更新時の値引き率[\s\S]*3%[\s\S]*AIの仮の目標（確定ではない）/.test(joined), 'AI仮提案の表示が違う');
    return '3件の状態が正しい';
  });

  await check('表示：読み取り専用なので、修正・採用・保存の操作が出ない', async () => {
    const t = await articleText(page);
    assert(t.includes('STAGE3で変更します'), '確定KPIの注意がない');
    assert((await page.getByRole('button', { name: '計画書を修正する' }).count()) === 0, '修正の操作が出ている');
    assert((await page.getByRole('button', { name: 'この計画案を採用する' }).count()) === 0, '採用の操作が出ている');
    return '操作なし';
  });

  await check('表示：計画がない場合は、その旨だけを出す（空の計画を作らない）', async () => {
    const t = await articleText(page);
    assert(t.includes('実行計画はまだありません') || (await page.getByText('このプロジェクトの実行計画はまだありません').count()) > 0, '計画なしの表示がない');
    assert((await page.locator('.plan-kicker', { hasText: '実行計画書' }).count()) === 0, '計画書が勝手に出ている');
    return '計画なしを表示';
  });

  await check('切替：同じ名前の「新規顧客開拓」は、部門ごとに別の内容になる（混ざらない）', async () => {
    await pick(page, '新規顧客開拓', '営業部');
    let t = await articleText(page);
    assert(t.includes('紹介件数'), '営業部の旧形式KPIがない');
    assert(!t.includes('設計提案の件数'), '設計部の内容が混ざった');
    assert(!t.includes('保守契約の継続率'), '別プロジェクトの内容が混ざった');
    await pick(page, '新規顧客開拓', '設計部');
    t = await articleText(page);
    assert(t.includes('設計提案の件数') && t.includes('設計部'), '設計部の内容が出ない');
    assert(!t.includes('紹介件数'), '営業部の内容が混ざった');
    return '営業部と設計部で別の内容';
  });

  await check('切替：目的がないプロジェクトは「未入力」と出し、既存の目的を作らない', async () => {
    await pick(page, '新規顧客開拓', '営業部');
    const t = await articleText(page);
    assert(t.includes('未入力（STAGE3で目的が入力されていません）'), '目的の未入力表示がない');
    return '目的は未入力のまま';
  });

  await check('保存済みの計画：同じプロジェクトの計画を、読み取り専用で表示する', async () => {
    await pick(page, '医療機関向け計測ソリューションの試験導入');
    assert((await page.locator('.plan-kicker', { hasText: '実行計画書' }).count()) >= 1, '保存済みの計画が出ていない');
    assert((await page.getByRole('button', { name: '計画書を修正する' }).count()) === 0, '保存済みの計画に修正の操作が出ている');
    assert((await page.getByRole('button', { name: 'この計画案を採用する' }).count()) === 0, '保存済みの計画に採用の操作が出ている');
    const t = await articleText(page);
    assert(t.includes('試験導入に合意した医療機関数'), 'KPIがない');
    assert(!t.includes('保存後に、KPIの目標が変わっています'), 'KPIが変わったと誤って出ている');
    return '保存済みの計画を読み取り専用で表示';
  });

  await check('切替：計画のあるプロジェクトから離れると、その計画は表示されない', async () => {
    await pick(page, '既存顧客の保守契約更新');
    assert((await page.locator('.plan-kicker', { hasText: '実行計画書' }).count()) === 0, '前のプロジェクトの計画が残っている');
    return '計画は残らない';
  });

  await check('保存・AI・okrsV2：読み取りの前後で、保存もAI呼び出しもokrsV2の変更もない', async () => {
    const after = await stateSnapshot(page);
    assert(after === before, 'okrsV2（部門データ）が変わった');
    assert((await storeWrites(page)) + (await dbWrites(page)) === writesBefore, '保存の呼び出しが増えた');
    assert((await okrCalls(page)) === okrBefore, 'DB保存の呼び出しが増えた');
    return '保存の呼び出し 0件・部門データ不変';
  });

  await page.screenshot({ path: path.join(shotsDir, '01-desktop-stage3-read.png') });
  await page.close();

  for (const [w, h, name] of [
    [1024, 768, '02-tablet-1024'],
    [768, 1024, '03-tablet-768'],
  ]) {
    const tp = await open(browser, w, h, `タブレット${w}`);
    await pick(tp, '既存顧客の保守契約更新');
    await check(`${w}px：STAGE3の文書が横にはみ出さず、読める`, async () => {
      const box = await tp.locator('article[aria-label="STAGE3の情報（読み取り専用）"]').boundingBox();
      assert(box && box.width >= 480, `文書が狭すぎる（${box && Math.round(box.width)}px）`);
      const over = await tp.evaluate(() => {
        const els = Array.from(document.querySelectorAll('article[aria-label="STAGE3の情報（読み取り専用）"] table'));
        return els.filter((t) => t.scrollWidth > t.parentElement.clientWidth + 1).length;
      });
      assert(over === 0, `表がはみ出す（${over}個）`);
      await tp.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: false });
      return `文書 ${Math.round(box.width)}px`;
    });
    await tp.close();
  }

  await check('通信：file:// 以外への通信がない（保存・AIの呼び出しを含む）', async () => {
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
