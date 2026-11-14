/* STAGE4 で財務効果を入力して保存し、STAGE6 の試算に正しく反映されることを、実際の画面操作で検証する（評価専用）。
 * 使う画面：e2e-stage4.html（新STAGE4の文書画面）と e2e-stage6.html（FinancePlanSection）。
 * 保存先は localStorage（stubs/e2eFlowStore.ts）。計画書の読込だけ架空の計画（stubs/stage4PlanStores.ts）。
 * 通信・認証には接続しない。事前に node eval/integration/browser/build-e2e.js で results-browser/ にバンドルを作る。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const STAGE4_URL = pathToFileURL(path.join(outDir, 'e2e-stage4.html')).href;
const STAGE6_URL = pathToFileURL(path.join(outDir, 'e2e-stage6.html')).href;
const KEY = 'flow:fict-co-a';
const PROJECT = '既存顧客の保守契約更新';
const REVENUE = '売上増加（参考試算の売上）';
const COST = '追加費用';

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
const expectText = (text, needle) => {
  if (!text.includes(needle)) throw new Error(`表示にない: ${needle}`);
};
const expectNoText = (text, needle) => {
  if (text.includes(needle)) throw new Error(`表示されてはいけない: ${needle}`);
};

async function newContext(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 140));
    return route.abort();
  });
  return ctx;
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const projectOf = (data) => data.departments[0].projects[0];

/* STAGE4：案件を開き、財務効果の欄を展開する */
async function openStage4(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 300)));
  await page.goto(STAGE4_URL);
  await page.getByText(PROJECT, { exact: true }).first().waitFor({ timeout: 15000 });
  await page.getByText(PROJECT, { exact: true }).first().click();
  await sleep(600);
  await page.locator('summary', { hasText: '財務効果を設定する' }).click();
  await sleep(300);
  return page;
}

/* STAGE6：財務計画の画面を開く */
async function openStage6(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 300)));
  await page.goto(STAGE6_URL);
  await page.getByText('経営計画の実現見通し').first().waitFor({ timeout: 15000 });
  await sleep(500);
  return page;
}

/* 入力欄は、ページ内の別のスクロール領域の中にあり、自動スクロールで画面内に入らない。値は同じ入力操作で入れる（force） */
const fillIn = async (locator, value) => {
  await locator.fill(value, { force: true });
};

/* 選択欄も同じ理由で画面外にあるため、値を設定して変更イベントを送る（利用者の選択と同じ操作） */
const selectIn = async (locator, value) => {
  await locator.evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
};

const card = (page, label) => page.locator(`[aria-label="${label}の財務効果"]`);
const save = async (page) => {
  await page.getByRole('button', { name: '計画を保存' }).click();
  await sleep(1200);
};

/* STAGE6 の値を読む：①既存事業、②施策効果反映（2030年度）、③経営目標、施策効果の年度行 */
async function readStage6(page) {
  const t = await bodyText(page);
  const i = t.indexOf('プロジェクト別の財務効果');
  const effectSection = i >= 0 ? t.slice(i, i + 900) : '';
  const row = (year) => (effectSection.match(new RegExp(`${year}年度\\s+([+−\\-]?[\\d.]+)\\s+([+−\\-]?[\\d.]+)`)) || []).slice(1);
  return {
    text: t,
    revenueHeadline: (t.match(/達成率 ([\d.]+)%（2030年度）/) || [])[1],
    headlines: [...t.matchAll(/達成率 ([\d.]+)%（2030年度）/g)].map((m) => m[1]),
    effect2027: row(2027),
    effect2030: row(2030),
  };
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await newContext(browser);

  /* 0. 基準：財務効果を入れる前の STAGE6 */
  const s6 = await openStage6(ctx);
  const base = await readStage6(s6);
  await check('0', '基準：財務効果がないとき、STAGE6は既存事業の横ばい（売上930・営業利益52）で、施策効果は0', async () => {
    if (base.effect2027.length && base.effect2027.join() !== '0.0,0.0') throw new Error(`基準に施策効果がある: ${base.effect2027.join(' / ')}`);
    expectText(base.text, '経営目標 1,200.0 百万円（2030年度）');
    if (base.revenueHeadline !== '77.5') throw new Error(`基準の達成率（売上）が ${base.revenueHeadline}（期待 77.5 = 930÷1,200）`);
    return '基準：施策効果なし。達成率（売上）77.5%（930÷1,200）';
  });

  /* 1. STAGE4：草案を保存（未確認）。STAGE6にはまだ入らない */
  const s4 = await openStage4(ctx);
  await check('1', 'STAGE4：売上増加と追加費用を入力し、確認に足りない状態で保存すると、草案として保存され、STAGE6には入らない', async () => {
    const r = card(s4, REVENUE);
    await r.locator('select').first().selectOption('ANNUAL');
    await r.locator('input[type="month"]').nth(0).fill('2026-04');
    await r.locator('input[type="month"]').nth(1).fill('2030-03');
    await r.locator('input[type="number"]').fill('12');
    await card(s4, COST).locator('select').first().selectOption('ANNUAL');
    await card(s4, COST).locator('input[type="month"]').nth(0).fill('2026-04');
    await sleep(200);
    await save(s4);
    const data = await stored(s4);
    const p = projectOf(data);
    if (!p.financeEffect || p.financeEffect.confirmed !== false) throw new Error('売上の草案が未確認で保存されていない');
    const s6b = await openStage6(ctx);
    const mid = await readStage6(s6b);
    if (mid.effect2027?.join() !== '0.0,0.0') throw new Error(`草案がSTAGE6に入っている: ${mid.effect2027}`);
    return `草案：売上（確認済みでない）。STAGE6の施策効果は 2027年度 ${mid.effect2027.join(' / ')}`;
  });

  /* 2. STAGE4：必須項目を入れて保存すると、確認済みとして保存され、STAGE6に反映される */
  await check('2', 'STAGE4：必須項目をそろえて保存すると確認済みになり、STAGE6の施策効果に反映される（売上+60・営業利益+12−6）', async () => {
    const r = card(s4, REVENUE);
    await fillIn(r.locator('input[type="month"]').nth(1), '2030-03');
    await selectIn(s4.locator('[aria-label="' + REVENUE + 'の売上の区分"]'), 'PAID_DEVELOPMENT');
    const c = card(s4, COST);
    await fillIn(c.locator('input[type="month"]').nth(1), '2030-03');
    await sleep(200);
    await selectIn(s4.locator('[aria-label="' + REVENUE + 'の営業利益増分と追加費用"]'), 'no');
    await sleep(200);
    await save(s4);
    const data = await stored(s4);
    const p = projectOf(data);
    if (p.financeEffect?.confirmed !== true) throw new Error('売上が確認済みで保存されていない');
    if (p.financeEffects?.[0]?.confirmed !== true) throw new Error('追加費用が確認済みで保存されていない');
    const s6c = await openStage6(ctx);
    const after = await readStage6(s6c);
    if (after.headlines.join() !== '82.5,72.5') throw new Error(`2030年度の達成率が ${after.headlines.join(' / ')}（期待 売上82.5 = 990÷1,200、営業利益72.5 = 58÷80）`);
    if (after.effect2027?.join() !== '+60.0,+6.0') throw new Error(`STAGE6の2027年度の施策効果が ${after.effect2027?.join(' / ')}（期待 +60.0 / +6.0 = 営業利益 12 − 6）`);
    return `確認済み：STAGE6 2027年度の施策効果 売上+60.0、営業利益+6.0（12−6）`;
  });

  /* 3. 保存・再読込後も同じ結果 */
  const s4r = await openStage4(ctx);
  await check('3', 'STAGE4を再読込すると、確認済みの内容が残る（再保存しても二重に加算されない）', async () => {
    await save(s4r);
    const data = await stored(s4r);
    const p = projectOf(data);
    if (p.financeEffect?.confirmed !== true || p.financeEffects?.[0]?.confirmed !== true) throw new Error('再読込後に確認状態が残っていない');
    const s6d = await openStage6(ctx);
    const again = await readStage6(s6d);
    if (again.headlines.join() !== '82.5,72.5') throw new Error(`再保存後の2030年度の達成率が変わった: ${again.headlines.join(' / ')}`);
    if (again.effect2027?.join() !== '+60.0,+6.0') throw new Error(`再保存後にSTAGE6が変わった: ${again.effect2027?.join(' / ')}`);
    return '再読込・再保存後も STAGE6 の施策効果は 2027年度 +60.0 / +6.0（二重加算なし）';
  });

  /* 4. 既存事業と経営目標は、施策効果の入力で変わらない */
  await check('4', '既存事業の見通し（売上930・営業利益52）と経営目標（売上1,200・営業利益80）は、施策効果の入力で変わらない', async () => {
    const s6e = await openStage6(ctx);
    const t = await readStage6(s6e);
    if (!/2030年度\s+930\s+52/.test(t.text)) throw new Error('既存事業の2030年度が変わった');
    expectText(t.text, '経営目標 1,200.0 百万円（2030年度）');
    expectText(t.text, '経営目標 80.0 百万円（2030年度）');
    return '既存事業 2030年度 930 / 52、経営目標 1,200.0 / 80.0 は不変';
  });

  /* 5. 未確認に戻す・金額を変える：新STAGE4の画面では確認済みの欄が固定され、操作できない（確認） */
  await check('5', '確認済みの効果は、金額を変えられない（欄が固定される）', async () => {
    const s4x = await openStage4(ctx);
    const disabled = await card(s4x, REVENUE).locator('input[type="number"]').isDisabled();
    if (!disabled) throw new Error('確認済みの金額欄が編集できてしまう');
    return '確認済みの金額欄は編集不可（未確認に戻す操作は新STAGE4の画面にはない＝未確認）';
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
  fs.writeFileSync(path.join(outDir, 'browser-results-stage4-stage6-e2e.json'), JSON.stringify({ summary, results, pageErrors, externalCount: external.length }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.id}  ${r.name}  -- ${r.detail}`);
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
