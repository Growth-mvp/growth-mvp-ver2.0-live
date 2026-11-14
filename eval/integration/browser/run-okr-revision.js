/* 旧 /okr 画面（実コンポーネント app/okr/page.tsx）で、確認済みの財務効果を修正する経路を検証する（評価専用）。
 * 保存先は localStorage（stubs/flowStore.ts）。通信・認証には接続しない（外部はすべて遮断して数える）。
 * 事前に node eval/integration/browser/build.js で results-browser/ にバンドルを作る。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const PAGE_URL = pathToFileURL(path.join(outDir, 'flow-okr.html')).href;
const PROJECT = '既存顧客の保守契約更新';

const results = [];
const external = [];
const pageErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const check = async (id, name, fn) => {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail ?? '' });
  } catch (e) {
    results.push({ id, name, status: 'FAIL', detail: String(e.message || e).replace(/\s+/g, ' ').slice(0, 400) });
  }
};

/* 保存された財務効果（store の状態）を読む */
const savedEffect = (page) =>
  page.evaluate((title) => {
    const st = window.__getStrategyState();
    const p = st.departments[0].projects.find((x) => x.title === title);
    const e = p?.financeEffect ?? null;
    return e && { amount: e.directAmountYen, confirmed: e.confirmed === true };
  }, PROJECT);

/* 修正中の入力欄（金額）。財務効果の詳細にある最初の数値欄（直接金額）。
 * Playwright の fill は、この数値欄の変更を React に伝えないため、ネイティブの入力イベントで値を入れる（利用者の入力と同じ変更） */
const amountInput = (page) => page.locator('input[type="number"]').first();
const typeAmount = (page, value) =>
  amountInput(page).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, String(value));
const reopenDetails = async (page) => {
  const toggleVisible = await page.getByRole('button', { name: /内容を確認し、確認済みにする|確認を取り消す/ }).first().isVisible().catch(() => false);
  if (!toggleVisible) await page.locator('summary', { hasText: '詳細設定（算定方法・根拠・重複・効果の種類）' }).first().click();
  await sleep(300);
};
const bodyText = (page) => page.evaluate(() => document.body.innerText);

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

  const open = async () => {
    await page.goto(PAGE_URL);
    await sleep(1200);
    await page.getByText(PROJECT).first().click();
    await sleep(400);
  };

  /* 初期：確認済みの効果（売上60百万円、年額）を保存しておく */
  await open();
  await page.evaluate((title) => {
    const st = window.__getStrategyState();
    const p = st.departments[0].projects.find((x) => x.title === title);
    p.financeEffect = {
      kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60_000_000, amountBasis: 'ANNUAL',
      startYm: '2026-04', endYm: '2030-03', source: 'USER_INPUT', confirmed: true,
      confirmedAt: '2026-11-01T00:00:00.000Z', sourceNote: '見積書（架空）',
    };
    st.saveStrategyData({ reason: 'manual', force: true });
  }, PROJECT);
  await sleep(300);
  await page.reload();
  await sleep(1000);
  await page.getByText(PROJECT).first().click();
  await sleep(400);
  await page.getByRole('button', { name: '売上を伸ばす' }).first().click();
  await sleep(800);

  await check('L1', '確認済みの効果は、「修正する」を押すまで金額を編集できない', async () => {
    const t = await bodyText(page);
    if (!t.includes('修正する') || !t.includes('確認を解除する')) throw new Error('修正・確認解除の操作が出ていない');
    const amount = await amountInput(page).evaluate((el) => el.disabled);
    if (amount !== true) throw new Error('確認済みなのに金額が編集できる');
    const s = await savedEffect(page);
    if (!s || s.amount !== 60_000_000 || !s.confirmed) throw new Error('初期の確認済みの効果が保存されていない: ' + JSON.stringify(s));
    return '確認済み：修正する・確認を解除する が出る。金額は編集不可（60百万円・確認済み）';
  });

  await check('L2', '修正をやめると、確認済みの金額と確認状態は変わらない（入力の途中の値は保存されない）', async () => {
    await page.getByRole('button', { name: '修正する' }).first().click({ force: true });
    await sleep(300);
    if (!(await bodyText(page)).includes('修正中です')) throw new Error('修正中の表示が出ない');
    await typeAmount(page, 100);
    await sleep(200);
    const mid = await savedEffect(page);
    if (!mid || mid.amount !== 60_000_000 || !mid.confirmed) throw new Error('修正中に保存された値が変わった: ' + JSON.stringify(mid));
    await page.getByRole('button', { name: '修正をやめる' }).first().click({ force: true });
    await sleep(400);
    const after = await savedEffect(page);
    if (!after || after.amount !== 60_000_000 || !after.confirmed) throw new Error('修正をやめたのに確認済みの値が変わった: ' + JSON.stringify(after));
    const v = await amountInput(page).evaluate((el) => el.value);
    if (Number(v) !== 60) throw new Error(`修正をやめた後の入力欄が ${v}（期待 60）`);
    return '修正をやめた：保存された値は 60百万円・確認済みのまま。入力欄も 60 に戻る';
  });

  await check('L3', '修正内容を保存すると、金額が変わり、内容が変わったため未確認になる（二重に足さない）', async () => {
    await page.getByRole('button', { name: '修正する' }).first().click({ force: true });
    await sleep(300);
    await typeAmount(page, 100);
    await sleep(200);
    await page.getByRole('button', { name: '修正内容を保存' }).first().click({ force: true });
    await sleep(600);
    const s = await savedEffect(page);
    if (!s || s.amount !== 100_000_000) throw new Error('保存された金額が100百万円になっていない: ' + JSON.stringify(s));
    if (s.confirmed) throw new Error('内容が変わったのに確認済みのまま');
    if ((await bodyText(page)).includes('修正中です')) throw new Error('保存後も修正中の表示が残る');
    return '保存：金額 100百万円（60は残らない）。内容が変わったので未確認（STAGE6には入らない）';
  });

  await check('L4', '再確認すると、修正後の金額で確認済みになる', async () => {
    // 旧画面の確認は、質問への回答（妥当・発生時期・売上の意味）がそろってから押せる
    for (const label of ['妥当', '新しく追加される売上', 'この内容で回答']) {
      const b = page.getByRole('button', { name: label }).first();
      if (await b.isVisible().catch(() => false)) {
        await b.click({ force: true });
        await sleep(300);
      }
    }
    const confirmLabel = ['営業利益は未算定のまま、内容を確認する', '内容を確認し、確認済みにする'];
    for (const label of confirmLabel) {
      const c = page.getByRole('button', { name: label }).first();
      if (await c.isVisible().catch(() => false)) {
        await c.click({ force: true });
        break;
      }
    }
    await sleep(600);
    const s = await savedEffect(page);
    if (!s || s.amount !== 100_000_000 || !s.confirmed) throw new Error('再確認で確認済みにならない: ' + JSON.stringify(s));
    return '再確認：質問への回答をそろえ、100百万円で確認済み（修正後の金額だけ）';
  });

  await check('L5', '確認を解除すると、未確認になる（金額は保持）', async () => {
    await reopenDetails(page);
    await page.getByRole('button', { name: '確認を解除する' }).first().click({ force: true });
    await sleep(600);
    const s = await savedEffect(page);
    if (!s || s.amount !== 100_000_000 || s.confirmed) throw new Error('確認解除の結果が違う: ' + JSON.stringify(s));
    return '確認解除：未確認（STAGE6から外れる）。金額 100百万円は保持';
  });

  await check('L6', '画面を再読込しても、修正後の状態（未確認・100百万円）が残る', async () => {
    await sleep(2500); // 旧画面の保存は自動保存（遅延つき）。保存が終わってから再読込する
    await page.reload();
    await sleep(1000);
    await page.getByText(PROJECT).first().click();
    await sleep(400);
    await page.getByRole('button', { name: '売上を伸ばす' }).first().click();
    await sleep(800);
    const s = await savedEffect(page);
    if (!s || s.amount !== 100_000_000 || s.confirmed) throw new Error('再読込後の状態が違う: ' + JSON.stringify(s));
    return '再読込後：100百万円・未確認が保持される';
  });

  await check('E1', '未処理の例外（pageerror）がない', async () => {
    if (pageErrors.length) throw new Error(pageErrors.slice(0, 2).join(' | '));
    return '未処理の例外 0件';
  });
  await check('E2', '外部への通信はすべて遮断', async () => {
    if (external.length) throw new Error('遮断した外部通信: ' + external.length + '件（例: ' + external[0] + '）');
    return '外部への通信 0件（遮断）';
  });

  await ctx.close();
  await browser.close();

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  };
  fs.writeFileSync(path.join(outDir, 'browser-results-okr-revision.json'), JSON.stringify({ summary, results, pageErrors, externalCount: external.length }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.id}  ${r.name}  -- ${r.detail}`);
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
