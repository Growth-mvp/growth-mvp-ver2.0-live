/* 旧 /okr 画面の財務効果入力（FinanceEffectSection）を実ブラウザで検証する（評価専用）。
 * 「一回限り」に終了月が入った矛盾した入力は確認できず、単位を直せば確認できることを確かめる。通信はしない。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const PAGE_URL = pathToFileURL(path.join(outDir, 'finance-effect.html')).href;
const CONFIRM = '内容を確認し、確認済みにする';

const results = [];
const external = [];
const pageErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 140));
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 300)));
  await page.goto(PAGE_URL);
  await page.locator('details > summary').first().waitFor({ timeout: 15000 });
  await page.locator('details > summary').first().click();
  await page.getByText('詳細設定（任意・必要なときだけ）').first().click();
  await page.getByText('財務試算への反映状態').first().waitFor({ timeout: 15000 });
  await sleep(300);

  const unit = page.getByLabel(/金額の単位/);
  const confirmButton = page.getByRole('button', { name: CONFIRM });
  const text = () => page.evaluate(() => document.body.innerText);

  /* 初期状態：一回限り（TOTAL）に終了月 2027-06 が入っている（矛盾した既存入力） */
  await check('F1', '「一回限り」に終了月が入っていると、終了月の入力欄が出ず、確認できない', async () => {
    const t = await text();
    if (t.includes('終了月（空欄＝継続）')) throw new Error('一回限りなのに終了月の入力欄が出ている');
    if (!t.includes('一回限りは開始月に全額計上するため、入力しません')) throw new Error('一回限りの案内が出ていない');
    if (!t.includes('一回限りの効果に終了月が入っています')) throw new Error('矛盾の案内が出ていない');
    if (!(await confirmButton.isDisabled())) throw new Error('矛盾した入力のまま確認できる');
    return '終了月の欄なし、案内あり、確認ボタンは無効';
  });

  await check('F2', '単位を「月額」に変えると終了月の欄が戻り、入力の値は残る', async () => {
    await unit.selectOption('MONTHLY');
    await sleep(200);
    const t = await text();
    if (!t.includes('終了月（空欄＝継続）')) throw new Error('月額なのに終了月の欄が出ない');
    const endValue = await page.locator('input[type="month"]').nth(1).inputValue();
    if (endValue !== '2027-06') throw new Error(`終了月の値が ${endValue}`);
    return `月額：終了月 ${endValue} が残り、欄が出る`;
  });

  await check('F3', '単位を「一回限り」に戻すと終了月が消え、確認できる（矛盾が解消される）', async () => {
    await unit.selectOption('TOTAL');
    await sleep(200);
    const t = await text();
    if (t.includes('一回限りの効果に終了月が入っています')) throw new Error('矛盾の案内が消えていない');
    if (await confirmButton.isDisabled()) throw new Error('矛盾が解消されたのに確認できない');
    const inputs = await page.locator('input[type="month"]').count();
    if (inputs !== 1) throw new Error(`月の入力欄が ${inputs} 件（開始月のみのはず）`);
    return '終了月は消え、開始月（2027-01）だけが残る。確認ボタンは有効';
  });

  await check('F4', '解消後は確認でき、確認済みとして保存される', async () => {
    await confirmButton.click();
    await sleep(200);
    const t = await text();
    if (!t.includes('利用者が確認済み')) throw new Error('確認済みの表示がない');
    return '状態：利用者が確認済み';
  });

  await check('E1', '未処理の例外（pageerror）がない', async () => {
    if (pageErrors.length) throw new Error(pageErrors.slice(0, 2).join(' | '));
    return '未処理の例外 0件';
  });
  await check('E2', '外部への通信はすべて遮断', async () => {
    if (external.length) throw new Error('遮断した外部通信: ' + external.length + '件');
    return '外部への通信 0件（遮断）';
  });

  await ctx.close();
  await browser.close();

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  };
  fs.writeFileSync(path.join(outDir, 'browser-results-finance-effect-okr.json'), JSON.stringify({ summary, results, pageErrors, externalCount: external.length }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.id}  ${r.name}  -- ${r.detail}`);
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
