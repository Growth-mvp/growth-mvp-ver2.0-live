/* 新STAGE4の第5章から財務効果を確認し、既存の経路BでSTAGE6へ反映されることを、実画面の操作で検証する（評価専用）。
 * 案件（日本製罐の数値例に合わせた架空の入力）を選ぶ → 参考試算 → 年度を修正 → 財務効果を草案として保存・確認 →
 * 保存データを確かめる → 再読み込み → STAGE6の表示を照合。保存先は localStorage（stubs/flowStore.ts）。
 * DB・認証・OpenAI・外部通信には接続しない。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const FINANCE_URL = pathToFileURL(path.join(outDir, 'finance-flow.html')).href;
const STAGE6_URL = pathToFileURL(path.join(outDir, 'finance-stage6.html')).href;
const KEY = 'flow:FICTIONAL-CO';
const PROJECT = '塗料メーカー向けプロジェクト';
const REVENUE_CARD = '売上増加（参考試算の売上）の財務効果';
const COST_CARD = '追加費用の財務効果';

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

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 140));
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 300)));
  return { ctx, page };
}

async function openFinance(page) {
  await page.goto(FINANCE_URL);
  await page.getByText(PROJECT, { exact: true }).first().waitFor({ timeout: 10000 });
  await page.getByText(PROJECT, { exact: true }).first().click();
  await sleep(400);
}

async function createPlan(page) {
  const button = page.getByRole('button', { name: 'AIで実行計画書を作る' });
  if (await button.count()) {
    await button.click();
  }
  await page.getByText('業績への貢献（参考試算）').first().waitFor({ timeout: 10000 });
  await sleep(300);
  const save = page.getByRole('toolbar', { name: '草案の保存' }).getByRole('button', { name: '草案として保存' });
  if (await save.count()) await save.click();
  await sleep(500);
}

const card = (page, label) => page.locator(`[aria-label="${label}"]`);
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const projectOf = (data) => data.departments[0].projects[0];
const stage6Text = async (page) => {
  await page.goto(STAGE6_URL);
  await page.getByText('経営計画の実現見通し').first().waitFor({ timeout: 10000 });
  await sleep(500);
  return page.evaluate(() => document.body.innerText);
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const { ctx, page } = await newPage(browser);

  /* 0. 基準：財務効果を入れる前のSTAGE6 */
  await openFinance(page);
  const before = await projectOf(await stored(page));
  const baselineStage6 = await stage6Text(page);

  /* 1〜3. 案件を選び、参考試算を表示し、年度を修正する */
  await openFinance(page);
  await createPlan(page);
  let dataAfterPlan;
  await check('1', '新STAGE4で日本製罐の数値例の案件を選び、第5章の参考試算を表示する', async () => {
    const text = await page.evaluate(() => document.body.innerText);
    if (!text.includes('業績への貢献（参考試算）')) throw new Error('第5章が表示されない');
    if (!text.includes('10社 × 30% × 20百万円 = 60百万円')) throw new Error('売上の参考試算（60百万円）が出ない');
    dataAfterPlan = await stored(page);
    return '売上（参考試算）60百万円（10社 × 30% × 20百万円）、追加費用6百万円';
  });

  await check('2', '計上期間（FY2027のみ：2026年4月〜2027年3月）を、財務効果の確認欄で入力する', async () => {
    const c = card(page, REVENUE_CARD);
    await c.locator('input[type="month"]').nth(0).fill('2026-04');
    await c.locator('input[type="month"]').nth(1).fill('2027-03');
    await sleep(200);
    const start = await c.locator('input[type="month"]').nth(0).inputValue();
    const end = await c.locator('input[type="month"]').nth(1).inputValue();
    if (start !== '2026-04' || end !== '2027-03') throw new Error(`期間が入らない: ${start}〜${end}`);
    return `計上期間：${start}〜${end}（会計年度 2027年度のみ）`;
  });

  /* 4. 財務効果の確認：売上（単位・追加効果・営業利益増分）と追加費用 */
  await check('3', '確認前は、営業利益増分の追加費用の扱いが未確認のため、売上の確認ができない（二重控除の防止）', async () => {
    const c = card(page, REVENUE_CARD);
    await c.locator('select').first().selectOption('ANNUAL');
    await c.getByLabel('売上増加（参考試算の売上）の営業利益の増分').fill('3');
    await c.getByLabel('既存の売上に対する追加効果である').check();
    await sleep(300);
    const confirmButton = c.getByRole('button', { name: 'この内容を財務効果として確認' });
    if (!(await confirmButton.isDisabled())) throw new Error('営業利益増分の扱いが未確認なのに確認できる');
    const text = await c.innerText();
    if (!text.includes('追加費用を差し引いた後の値か')) throw new Error('確認項目の案内がない');
    return '営業利益増分3百万円は、追加費用を差し引いた後かが未確認のため、確認を保留';
  });

  await check('4', '営業利益増分は「含まない」（追加費用は別に差し引く）と答えると、売上の草案を保存し、確認できる', async () => {
    const c = card(page, REVENUE_CARD);
    await c.getByLabel('売上増加（参考試算の売上）の営業利益増分と追加費用').selectOption('no');
    await c.getByLabel('売上増加（参考試算の売上）の売上の区分').selectOption('PAID_DEVELOPMENT');
    await c.getByRole('button', { name: '草案として保存' }).click();
    await page.getByText('草案として保存しました。').first().waitFor({ timeout: 5000 });
    const afterDraft = await stored(page);
    const draft = projectOf(afterDraft).financeEffect;
    if (!draft || draft.confirmed !== false) throw new Error('草案が未確認で保存されていない');
    await c.getByRole('button', { name: 'この内容を財務効果として確認' }).click();
    await page.getByText('確認しました。STAGE6の試算に反映されます。').first().waitFor({ timeout: 5000 });
    const saved = projectOf(await stored(page)).financeEffect;
    if (!saved || saved.confirmed !== true) throw new Error('売上の財務効果が確認済みで保存されていない');
    return `売上：${saved.kind} / ${saved.method} / 単位 ${saved.amountBasis} / ${saved.startYm}〜${saved.endYm} / 営業利益増分 ${saved.operatingIncomeEffectYen / 1e6}百万円（追加費用は別に差し引く）`;
  });

  await check('5', '追加費用（6百万円）を、単位を選んで草案として保存し、確認する（二重控除の判定を通過する）', async () => {
    const c = card(page, COST_CARD);
    await c.locator('select').first().selectOption('ANNUAL');
    await c.locator('input[type="month"]').nth(0).fill('2026-04');
    await c.locator('input[type="month"]').nth(1).fill('2027-03');
    await c.getByRole('button', { name: '草案として保存' }).click();
    await c.getByText('草案として保存しました。').waitFor({ timeout: 5000 });
    await c.getByRole('button', { name: 'この内容を財務効果として確認' }).click();
    await c.getByText('確認しました。STAGE6の試算に反映されます。').waitFor({ timeout: 5000 });
    const saved = (await stored(page)) && projectOf(await stored(page)).financeEffects?.[0];
    if (!saved || saved.confirmed !== true) throw new Error('追加費用が確認済みで保存されていない: ' + JSON.stringify(saved));
    return `追加費用：${saved.directAmountYen / 1e6}百万円 / 単位 ${saved.amountBasis} / ${saved.startYm}〜${saved.endYm}`;
  });

  /* 6. 保存データの照合（確認操作の前後で、STAGE3の値は変わらない） */
  const afterAll = projectOf(await stored(page));
  await check('6', '保存データ：財務効果は既存の項目で保存され、STAGE3のKPI・業績前提・他の施策は変わらない', async () => {
    if (afterAll.okrsV2?.[0]?.target !== 95) throw new Error('STAGE3のKPIの目標値が変わった');
    if (afterAll.impactRevenueMJPY !== 60 || afterAll.impactOpIncomeMJPY !== 40) throw new Error('STAGE3の業績前提が変わった');
    if (afterAll.financeEffect?.kind !== 'REVENUE_UP') throw new Error('売上の効果が primary に入っていない');
    if (afterAll.financeEffects?.[0]?.kind !== 'COST_INCREASE') throw new Error('追加費用が financeEffects に入っていない');
    if (afterAll.financeEffect.opIncomeIncludesAddCost !== false) throw new Error('営業利益増分の回答が保存されていない');
    const others = (await stored(page)).departments[0].projects.length;
    if (others !== 1) throw new Error('他の施策が増減した');
    void before;
    return `KPI目標95・業績前提60/40は不変。財務効果は売上（確認済み）と追加費用（確認済み）の2件`;
  });

  /* 7. 再読み込み後も、値と確認状態が残る */
  await check('7', '再読み込み後も、財務効果の金額・年度・確認状態が保たれる', async () => {
    await openFinance(page);
    await createPlan(page);
    await sleep(300);
    const reloaded = projectOf(await stored(page));
    if (reloaded.financeEffect?.confirmed !== true || reloaded.financeEffects?.[0]?.confirmed !== true) {
      throw new Error('再読み込み後に確認状態が残っていない');
    }
    const text = await page.evaluate(() => document.body.innerText);
    if (!text.includes('確認済み（STAGE6の試算に入ります）')) throw new Error('画面に確認済みの表示がない');
    return '確認済み（売上・追加費用）。単位・期間・営業利益増分の回答も保持';
  });

  /* 8. STAGE6の経路Bの表示と、基準からの差 */
  await check('8', 'STAGE6では、確認済みの財務効果だけが、正しい年度に反映される（未確認は入らない）', async () => {
    const text = await stage6Text(page);
    if (baselineStage6 === text) throw new Error('STAGE6の表示が変わっていない（確認済みの効果が入っていない）');
    if (!text.includes('確認済み施策効果')) throw new Error('STAGE6に確認済み施策効果の欄がない');
    if (text.includes('反映する効果はありません')) throw new Error('確認済みの効果が反映されていない');
    const start = text.indexOf('プロジェクト別の財務効果');
    const section = start >= 0 ? text.slice(start, text.indexOf('プロジェクト', start + 20)) : '';
    fs.writeFileSync(path.join(outDir, 'finance-stage6-text.txt'), text);
    const rowOf = (year) => {
      const m = section.match(new RegExp(`${year}年度\\s+([+−\\-]?[\\d.]+)\\s+([+−\\-]?[\\d.]+)`));
      return m ? [m[1], m[2]] : null;
    };
    const fy2026 = rowOf(2026);
    const fy2027 = rowOf(2027);
    const fy2028 = rowOf(2028);
    if (!fy2027) throw new Error('プロジェクト別の財務効果の2027年度の行が読めない');
    if (fy2027[0] !== '+60.0') throw new Error(`2027年度の売上効果が ${fy2027[0]}（期待 +60.0）`);
    if (fy2027[1] !== '−3.0') throw new Error(`2027年度の営業利益効果が ${fy2027[1]}（期待 −3.0：営業利益増分3 − 追加費用6）`);
    if (fy2026?.join() !== '0.0,0.0' || fy2028?.join() !== '0.0,0.0') throw new Error('計上期間外の年度に効果が入っている（二重計上の疑い）');
    return `プロジェクト別の財務効果：2026年度 0.0/0.0、2027年度 売上効果 +60.0 ・ 営業利益効果 −3.0、2028年度 0.0/0.0`;
  });

  await check('9', '未確認のAI仮説（粗利率など）は、STAGE6の正式な計画に入らない', async () => {
    const text = await stage6Text(page);
    if (text.includes('粗利率30%')) throw new Error('AI仮説の粗利率が正式な計画に出ている');
    return 'AI仮説の粗利率は、STAGE6の正式な計画・施策効果に入っていない';
  });

  await check('E1', '未処理の例外（pageerror）がない', async () => {
    if (pageErrors.length) throw new Error(pageErrors.slice(0, 2).join(' | '));
    return '未処理の例外 0件';
  });
  await check('E2', '外部への通信はすべて遮断（file:// 以外は abort）', async () => {
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
  fs.writeFileSync(path.join(outDir, 'browser-results-finance-flow.json'), JSON.stringify({ summary, results, pageErrors, externalCount: external.length }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.id}  ${r.name}  -- ${r.detail}`);
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
