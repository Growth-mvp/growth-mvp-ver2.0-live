/* STAGE5 実行画面（実際の app/execution/page.tsx）で、KR実績の記録と既存の進捗機能の保全を検証する（評価専用）。
 * store・認証・通信は stubs/ で差し替え。ネットワークは file:// 以外すべて遮断する。 */
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

const krOfStore = (page, title, label) =>
  page.evaluate(
    ({ title, label }) => {
      const st = window.__getStrategyState();
      const pr = st.departments.flatMap((d) => d.projects).find((x) => x.title === title);
      const kr = (pr?.okrsV2 ?? []).find((k) => k.label === label);
      return { target: kr?.target ?? null, actual: kr?.actual ?? null, dirty: st.dirty, projectActuals: (pr?.okrsV2 ?? []).map((k) => k.actual ?? null) };
    },
    { title, label },
  );

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch();

  /* ---------- 通常データ（ID あり） ---------- */
  const page = await newPage(browser);
  await page.goto(pathToFileURL(path.join(outDir, 'exec.html')).href);
  await page.waitForTimeout(1800);
  await page.getByText('既存顧客の保守契約更新', { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(500);

  const row = () => page.locator('[data-testid="kr-actual-row"]').first();

  await check('STAGE5 実行画面：選択した施策のKRに、目標と「実績：未確認」を表示する', async () => {
    const t = await row().innerText();
    if (!t.includes('保守契約の継続率')) throw new Error('KRが表示されていない: ' + t.slice(0, 80));
    if (!t.includes('目標：95 %')) throw new Error('目標が表示されていない');
    if (!t.includes('実績：未確認')) throw new Error('未確認が表示されていない');
    return '保守契約の継続率：目標 95 %、実績 未確認';
  });

  await check('STAGE5 実行画面：KR実績を記録（92%・2026-10）→ 差 −3ポイント、店舗に保存、目標は不変', async () => {
    await row().getByRole('button', { name: '実績を記録' }).click();
    await row().getByLabel(/実績値/).fill('92');
    await row().getByLabel(/基準日/).fill('2026-10');
    await row().getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForTimeout(200);
    const t = await row().innerText();
    if (!t.includes('実績：92 %（基準日 2026-10）')) throw new Error('実績が表示されていない: ' + t.slice(0, 120));
    if (!t.includes('差：−3ポイント')) throw new Error('差が違う');
    const s = await krOfStore(page, '既存顧客の保守契約更新', '保守契約の継続率');
    if (!s.actual || s.actual.value !== 92 || s.actual.asOf !== '2026-10') throw new Error('店舗に実績が入っていない: ' + JSON.stringify(s.actual));
    if (s.target !== 95) throw new Error('STAGE4の目標が変わった: ' + s.target);
    if (s.dirty !== false) throw new Error('未保存の変更が残っている（部分更新で保存済みのはず）');
    await page.locator('[aria-label="KR実績"]').screenshot({ path: path.join(outDir, 'shots', 'exec-kr-actual.png') });
    return '部分更新で 92 / 2026-10 を保存（未保存の変更なし）。目標 95 は不変';
  });

  await check('STAGE5 実行画面：別の施策（新規顧客開拓）のKRは変わらない', async () => {
    const other = await krOfStore(page, '新規顧客開拓', '新規商談数');
    if (other.actual !== null) throw new Error('別の施策に実績が入った');
    return '新規商談数の実績は未確認のまま';
  });

  await check('STAGE5 既存の進捗・チェックインの機能が残っている', async () => {
    const t = await page.locator('#root').innerText();
    if (!t.includes('進み具合を保存')) throw new Error('進み具合の保存が見当たらない');
    if (!t.includes('チェックイン') && !t.includes('フィードバック')) throw new Error('タブが見当たらない');
    if (!t.includes('KR実績（目標指標の達成状況）')) throw new Error('KR実績が見当たらない');
    if (!t.includes('作業の進み具合やチェックインとは別に')) throw new Error('区別の説明がない');
    return '進捗入力・タブ・KR実績を同じ画面で表示';
  });

  await check('STAGE5 実行画面：上書き時は直前の実績を履歴に残す', async () => {
    await row().getByRole('button', { name: '実績を更新' }).click();
    await row().getByLabel(/実績値/).fill('90');
    await row().getByLabel(/基準日/).fill('2026-11');
    await row().getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForTimeout(200);
    const t = await row().innerText();
    if (!t.includes('実績：90 %（基準日 2026-11）')) throw new Error('更新されていない');
    if (!t.includes('差：−5ポイント')) throw new Error('差が違う');
    if (!t.includes('過去の実績 1件を履歴に保存')) throw new Error('履歴の表示がない');
    const s = await page.evaluate(() => {
      const st = window.__getStrategyState();
      const pr = st.departments.flatMap((d) => d.projects).find((x) => x.title === '既存顧客の保守契約更新');
      return pr.okrsV2[0].actualHistory ?? null;
    });
    if (!s || s.length !== 1 || s[0].value !== 92) throw new Error('履歴に直前の実績が残っていない: ' + JSON.stringify(s));
    return '実績 90（上書き）、直前の 92 は履歴に保存';
  });

  await check('STAGE5 実行画面の入力検査：空の実績値は保存されず理由を表示する', async () => {
    await row().getByRole('button', { name: '実績を更新' }).click();
    await row().getByLabel(/実績値/).fill('');
    await row().getByRole('button', { name: '保存', exact: true }).click();
    const e = await row().locator('[role=alert]').innerText();
    if (!e.includes('実績値を入力してください')) throw new Error('理由がない');
    const s = await krOfStore(page, '既存顧客の保守契約更新', '保守契約の継続率');
    if (s.actual.value !== 90) throw new Error('不正な入力で店舗が変わった');
    return '空の入力は保存されず、店舗の実績は 90 のまま';
  });

  await check('STAGE5 実行画面：ブラウザ実行中に例外・コンソールエラー・外部通信がない', async () => {
    const real = errors.filter((e) => !e.includes('STAGE5-load-db-okrs'));
    if (real.length) throw new Error(real.slice(0, 2).join(' | '));
    if (external.length) throw new Error('外部通信: ' + external.length);
    return 'エラー0件（DB読込の既知の警告を除く）・外部通信0件';
  });
  await page.close();

  /* ---------- ID欠落（旧データ） ---------- */
  const noId = await newPage(browser);
  await noId.goto(pathToFileURL(path.join(outDir, 'exec.html')).href + '?noKrId=1');
  await noId.waitForTimeout(1800);
  await noId.getByText('既存顧客の保守契約更新', { exact: true }).filter({ visible: true }).first().click();
  await noId.waitForTimeout(500);

  await check('STAGE5 実行画面（ID欠落）：記録ボタンを出さず、理由を表示する（黙って保存しない）', async () => {
    const r = noId.locator('[data-testid="kr-actual-row"]').first();
    const t = await r.innerText();
    if (!t.includes('識別子（ID）がないため')) throw new Error('理由の表示がない');
    if ((await r.getByRole('button', { name: /実績を記録|実績を更新/ }).count()) !== 0) throw new Error('記録ボタンが出ている');
    const s = await krOfStore(noId, '既存顧客の保守契約更新', '保守契約の継続率');
    if (s.actual !== null) throw new Error('ID欠落のKRに実績が入った');
    return '理由を表示・記録ボタンなし・店舗は変わらない';
  });
  await noId.close();

  await browser.close();
  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  };
  fs.writeFileSync(path.join(outDir, 'browser-results-exec.json'), JSON.stringify({ summary, results, errors, external }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.name}  -- ${r.detail}`);
  if (errors.length) console.log('errors:', errors.slice(0, 4));
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
