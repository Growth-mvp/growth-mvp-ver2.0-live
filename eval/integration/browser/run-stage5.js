/* STAGE5 KR実績（実コンポーネント）と、KRのID欠落時のOKR画面の挙動を検証する（評価専用）。
 * DB・認証・通信はstubsで遮断。ネットワークは file:// 以外すべて遮断する。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const results = [];
const errors = [];
const external = [];

const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, status: 'PASS', detail: detail ?? '' });
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: String(e.message || e).split('\n')[0] });
  }
};

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 120));
    return route.abort();
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 240));
  });
  return page;
}

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch();

  /* ---------- STAGE5：KR実績セクション ---------- */
  const s5 = await newPage(browser);
  await s5.goto(pathToFileURL(path.join(outDir, 'stage5.html')).href);
  await s5.waitForSelector('[aria-label="KR実績"]');
  const rows = s5.locator('[data-testid="kr-actual-row"]');

  await check('S5 KR実績：目標と「未確認」を並べて表示する（実績未登録）', async () => {
    const r0 = await rows.nth(0).innerText();
    if (!r0.includes('目標：95 %')) throw new Error('目標が表示されていない');
    if (!r0.includes('実績：未確認')) throw new Error('未確認が表示されていない');
    return '保守契約の継続率：目標 95 %、実績 未確認';
  });

  await check('S5 KR実績：作業進捗・チェックインとは別のセクションであることを明示する', async () => {
    const t = await s5.locator('[aria-label="KR実績"]').innerText();
    if (!t.includes('作業の進み具合やチェックインとは別に')) throw new Error('説明文がない');
    if (!t.includes('財務効果の見込みや業績の試算には使いません')) throw new Error('財務との切り分けの説明がない');
    return '説明文を表示';
  });

  await check('S5 KR実績の記録：実績92・基準日2026-10 → 差 −3ポイント（例の通り）', async () => {
    await rows.nth(0).getByRole('button', { name: '実績を記録' }).click();
    await rows.nth(0).getByLabel(/実績値/).fill('92');
    await rows.nth(0).getByLabel(/基準日/).fill('2026-10');
    await rows.nth(0).getByLabel(/補足/).fill('月次集計');
    await rows.nth(0).getByRole('button', { name: '保存', exact: true }).click();
    await s5.waitForTimeout(150);
    const t = await rows.nth(0).innerText();
    if (!t.includes('実績：92 %（基準日 2026-10）')) throw new Error('実績が表示されていない: ' + t.slice(0, 120));
    if (!t.includes('差：−3ポイント')) throw new Error('差が違う: ' + t.slice(0, 160));
    if (!t.includes('補足：月次集計')) throw new Error('補足が表示されていない');
    await rows.nth(0).screenshot({ path: path.join(outDir, 'shots', 's5-recorded.png') });
    return '実績 92 %、差 −3ポイント、基準日・補足を表示';
  });

  await check('S5 KR実績の記録は、他のKRの実績を変えない（未確認のまま）', async () => {
    const t = await rows.nth(1).innerText();
    if (!t.includes('実績：未確認')) throw new Error('別のKRの実績が変わった: ' + t.slice(0, 120));
    if (!t.includes('目標：120 件')) throw new Error('別のKRの目標が変わった');
    return '新規商談数は未確認・目標 120 件のまま';
  });

  await check('S5 KR実績の更新：上書き時は直前の実績を履歴に残す（件数で表示）', async () => {
    await rows.nth(0).getByRole('button', { name: '実績を更新' }).click();
    await rows.nth(0).getByLabel(/実績値/).fill('90');
    await rows.nth(0).getByLabel(/基準日/).fill('2026-11');
    await rows.nth(0).getByRole('button', { name: '保存', exact: true }).click();
    await s5.waitForTimeout(150);
    const t = await rows.nth(0).innerText();
    if (!t.includes('実績：90 %（基準日 2026-11）')) throw new Error('更新されていない');
    if (!t.includes('差：−5ポイント')) throw new Error('差が違う');
    if (!t.includes('過去の実績 1件を履歴に保存')) throw new Error('履歴の件数が出ていない');
    return '実績 90 %（上書き）、履歴 1件';
  });

  await check('S5 KR実績の入力検査：実績値が空・基準日が不正なら保存せず理由を表示', async () => {
    await rows.nth(1).getByRole('button', { name: '実績を記録' }).click();
    await rows.nth(1).getByRole('button', { name: '保存', exact: true }).click();
    const e1 = await rows.nth(1).locator('[role=alert]').innerText();
    if (!e1.includes('実績値を入力してください')) throw new Error('空の検査がない: ' + e1);
    await rows.nth(1).getByLabel(/実績値/).fill('125');
    await rows.nth(1).getByLabel(/基準日/).fill('2026/11');
    await rows.nth(1).getByRole('button', { name: '保存', exact: true }).click();
    const e2 = await rows.nth(1).locator('[role=alert]').innerText();
    if (!e2.includes('基準日は YYYY-MM')) throw new Error('基準日の検査がない: ' + e2);
    const t = await rows.nth(1).innerText();
    if (!t.includes('実績：未確認')) throw new Error('不正な入力で記録された');
    return '空・不正な基準日は保存されず理由を表示';
  });

  await check('S5 件数の単位：実績125件の差は +5件', async () => {
    await rows.nth(1).getByLabel(/基準日/).fill('2026-11');
    await rows.nth(1).getByRole('button', { name: '保存', exact: true }).click();
    await s5.waitForTimeout(150);
    const t = await rows.nth(1).innerText();
    if (!t.includes('差：+5件')) throw new Error('差が違う: ' + t.slice(0, 140));
    return '差 +5件';
  });

  await check('S5 IDのないKR：記録ボタンを出さず、STAGE4で保存し直す旨を表示する（ID補完の対象）', async () => {
    const t = await rows.nth(2).innerText();
    if (!t.includes('識別子（ID）がないため')) throw new Error('説明がない');
    const btns = await rows.nth(2).getByRole('button', { name: /実績を記録|実績を更新/ }).count();
    if (btns !== 0) throw new Error('記録ボタンが出ている');
    return '記録不可の理由を表示・記録ボタンなし';
  });

  await check('S5 記録の結果は、目標（STAGE4）を変えない', async () => {
    const t = await s5.locator('[aria-label="KR実績"]').innerText();
    if (!t.includes('目標：95 %') || !t.includes('目標：120 件')) throw new Error('目標が変わった');
    return '目標 95 %・120 件は不変';
  });

  await check('S5 ブラウザ実行中に例外・コンソールエラー・外部通信がない（STAGE5）', async () => {
    if (errors.length) throw new Error(errors.slice(0, 2).join(' | '));
    if (external.length) throw new Error('外部通信: ' + external.length);
    return 'エラー0件・外部通信0件';
  });
  await s5.close();

  /* ---------- OKR画面：IDのないKRの編集は黙って成功扱いしない ---------- */
  const okr = await newPage(browser);
  const dialogs = [];
  okr.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.accept();
  });
  await okr.goto(pathToFileURL(path.join(outDir, 'okr.html')).href + '?noKrId=1');
  await okr.waitForTimeout(1200);
  await okr.getByText('既存顧客の保守契約更新').first().click();
  await okr.waitForTimeout(300);

  await check('OKR（ID欠落）：IDのないKRの編集は開始せず、理由を表示する', async () => {
    await okr.getByRole('button', { name: '売上を伸ばす' }).first().click();
    await okr.waitForTimeout(300);
    await okr.getByRole('button', { name: '編集' }).first().click();
    await okr.waitForTimeout(300);
    const visible95 = await okr.evaluate(() =>
      Array.from(document.querySelectorAll('input')).filter((x) => x.offsetParent !== null && x.value === '95').length,
    );
    if (visible95 !== 0) throw new Error('IDのないKRの編集フォームが開いた');
    if (!dialogs.some((m) => m.includes('識別子（ID）がない'))) throw new Error('理由の表示がない: ' + dialogs.join(' | '));
    return '編集フォームは開かず、「識別子（ID）がないため編集できません」を表示';
  });

  await check('OKR（ID欠落）：編集を開始できないため、他のKRに保存されることもない', async () => {
    const t = await okr.locator('#root').innerText();
    if (!t.includes('保守契約の継続率')) throw new Error('KRが消えた');
    if (!t.includes('目標: 95 %')) throw new Error('目標が変わった');
    return 'KR は 95 % のまま残る（データ不変）';
  });

  await check('ブラウザ実行中に例外・コンソールエラー・外部通信がない（OKR・ID欠落）', async () => {
    const real = errors.filter((e) => !e.includes('fetchCandidates'));
    if (real.length) throw new Error(real.slice(0, 2).join(' | '));
    if (external.length) throw new Error('外部通信: ' + external.length);
    return 'エラー0件（既知の fetchCandidates を除く）・外部通信0件';
  });

  await browser.close();
  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  };
  fs.writeFileSync(path.join(outDir, 'browser-results-stage5.json'), JSON.stringify({ summary, results, errors, external }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.name}  -- ${r.detail}`);
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
