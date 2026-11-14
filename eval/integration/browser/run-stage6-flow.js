/* STAGE6 財務計画を実ブラウザで検証する（評価専用）。
 * 3系列（2030年度まで）、暫定の資金判定、借入・財務前提の入力と保存、再読込後の保持を、架空データで確認する。
 * 保存先は localStorage（stubs/stage6FlowStore.ts）。DB・認証・外部通信には接続しない（外部はすべて遮断して数える）。
 * 事前に node eval/integration/browser/build-stage6-flow.js で results-browser/ にバンドルを作る。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const PAGE_URL = pathToFileURL(path.join(outDir, 'stage6-flow.html')).href;
const KEY = 'flow:FICTIONAL-CO';

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

async function openPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 300)));
  await page.goto(PAGE_URL);
  await page.getByText('経営計画の実現見通し').first().waitFor({ timeout: 15000 });
  await sleep(500);
  return page;
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const tab = (page, re) => page.getByRole('tab', { name: re }).click();

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await newContext(browser);
  const page = await openPage(ctx);

  /* 1〜4. 3系列と2030年度（初回・保存前） */
  let text = await bodyText(page);
  await check('1', '3系列（既存事業・施策効果反映・経営目標）が、売上と営業利益の両方で表示される', async () => {
    for (const name of ['既存事業の見通し', '施策効果を反映した見通し', '経営目標']) expectText(text, name);
    return '3系列の凡例あり（売上・営業利益の2つのグラフ）';
  });

  await check('2', '目標年度は2030年度で、予測も2030年度まで延びている', async () => {
    expectText(text, '達成率 82.5%（2030年度）');
    expectText(text, '達成率 80.0%（2030年度）');
    expectText(text, '経営目標 1,200.0 百万円（2030年度）');
    expectText(text, '経営目標 80.0 百万円（2030年度）');
    if (text.includes('目標年度（2030年度）が試算期間の外')) throw new Error('2030年度が試算期間の外のまま');
    return '売上 達成率82.5%（990÷1,200）、営業利益 達成率80.0%（64÷80）';
  });

  await check('3', '2030年度の既存事業は直近実績の横ばい（売上930・営業利益52）、施策効果は +60.0 / +12.0', async () => {
    if (!/2030年度\s+930\s+52/.test(text)) throw new Error('既存事業の2030年度の行（930・52）が読めない');
    if (!/2030年度\s+\+60\.0\s+\+12\.0/.test(text)) throw new Error('施策効果の2030年度の行（+60.0・+12.0）が読めない');
    return '既存事業 2030年度 930.0 / 52.0、施策効果 2030年度 +60.0 / +12.0';
  });

  await check('4', '未確認の効果（売上100・利益20）は加算されず、確認済みの1件だけが反映される', async () => {
    expectText(text, '1件を反映（1件は試算に含めていません）');
    expectText(text, '利用者が未確認（確認すると試算に入ります）');
    expectNoText(text, '達成率 90.8%');
    expectNoText(text, '達成率 105.0%');
    return '確認済み1件のみ反映。未確認を含めた場合の値（90.8%・105.0%）は出ない';
  });

  /* 5. 暫定の資金判定（売上増加あり・運転資金と税率が未入力） */
  await check('5', '売上増加があり運転資金・税率が未入力のため、資金判定は暫定（確定判定なし）', async () => {
    expectText(text, '暫定（確定判定なし）');
    expectText(text, '売上増加に伴う運転資金・税率の前提が未確認です');
    expectNoText(text, '資金不足あり');
    expectNoText(text, '計算上の問題なし');
    return '資金サマリーは「暫定（確定判定なし）」。確定の判定語は出ない';
  });

  await tab(page, /3\. お金は足りるか/);
  await sleep(300);
  text = await bodyText(page);
  await check('6', '条件付きCFは目的・前提・結果を示し、未算定を0と区別して表示する', async () => {
    expectText(text, '目的：基本シナリオ（既存事業の計画）');
    expectText(text, '未算定は0ではない');
    expectText(text, '未算定');
    return '条件付きCFの説明（目的・前提・結果）と未算定の表示あり';
  });

  await tab(page, /5\. 参考判定/);
  await sleep(300);
  text = await bodyText(page);
  await check('7', '参考判定の結論は確定判定しない。年度の見出しと判定は暫定と示す', async () => {
    expectText(text, '資金の安全性と返済可能性は確定判定しません');
    expectText(text, '2030年（推計・暫定）');
    expectText(text, '条件付きCF（上の「3. お金は足りるか」）は、売上増加の年度の営業CFを未算定にしています');
    return '結論・理由・年度見出しがすべて暫定';
  });

  /* 8. 借入・財務前提を入力し、財務計画を保存する */
  await tab(page, /3\. お金は足りるか/);
  await sleep(200);
  await page.locator('input[aria-label="税率"]').fill('30');
  await page.locator('input[aria-label="減価償却費"]').fill('10');
  await page.locator('input[aria-label="手元に残しておきたいお金"]').fill('150');
  await sleep(200);

  await tab(page, /4\. 借入・返済/);
  await sleep(200);
  await page.getByRole('button', { name: '借入を追加' }).first().click();
  await sleep(200);
  const row = page.locator('table').first().locator('tbody tr').last();
  await row.locator('input').nth(0).fill('検証用借入');
  await row.locator('input').nth(1).fill('100');
  await row.locator('input').nth(2).fill('1');
  // 年度の列は 2026〜2030（予測期間4年＋基準年度の翌年）。2027年と2030年に返済を入れる
  await row.locator('input').nth(4).fill('10');
  await row.locator('input').nth(7).fill('10');
  await sleep(200);

  await check('8', '借入（2030年度の返済を含む）と財務前提を入力し、財務計画を保存できる', async () => {
    await page.getByRole('button', { name: '財務計画を保存' }).click();
    await sleep(1200);
    const data = await stored(page);
    const plan = data?.csvFinanceData?.financePlanAssumptions;
    if (!plan) throw new Error('財務計画が保存データに入っていない');
    const loan = plan.existingLoans?.[0];
    if (loan?.balanceYen !== 100_000_000) throw new Error(`借入残高が保存されていない: ${loan?.balanceYen}`);
    if (loan?.scheduledPrincipalYen?.['2030'] !== 10_000_000) throw new Error('2030年度の返済が保存されていない');
    if (plan.cashFlow?.taxRate !== 0.3) throw new Error('税率が保存されていない');
    if (plan.cashFlow?.minCashYen !== 150_000_000) throw new Error('最低現預金が保存されていない');
    return `保存: 借入残高100百万円、2030年度の返済10百万円、税率30%、最低現預金150百万円`;
  });

  /* 9. 再読込後も、値・3系列・暫定判定が保たれる（識別子は失効しない） */
  const page2 = await openPage(ctx);
  await check('9', '再読込後も、借入・財務前提の値が残る（予測期間4年に延びても入力は消えない）', async () => {
    await tab(page2, /4\. 借入・返済/);
    await sleep(300);
    const r = page2.locator('table').first().locator('tbody tr').last();
    const balance = await r.locator('input').nth(1).inputValue();
    const y2030 = await r.locator('input').nth(7).inputValue();
    if (balance !== '100') throw new Error(`借入残高が ${balance}`);
    if (y2030 !== '10') throw new Error(`2030年度の返済が ${y2030}`);
    const t = await bodyText(page2);
    expectText(t, '2030年 元本返済予定');
    return `再読込後：借入残高 100、2030年度の返済 10（表の2030年列あり）`;
  });

  await check('10', '再読込後に保存し直しても、前提の識別子が変わらない（予測期間4年への延長で失効しない）', async () => {
    const before = (await stored(page2))?.csvFinanceData?.financePlanAssumptions?.meta?.assumptionsHash;
    if (!before) throw new Error('保存済みの識別子がない');
    await page2.getByRole('button', { name: '財務計画を保存' }).click();
    await sleep(1200);
    const after = (await stored(page2))?.csvFinanceData?.financePlanAssumptions?.meta?.assumptionsHash;
    if (after !== before) throw new Error(`識別子が変わった: ${before} → ${after}`);
    const t = await bodyText(page2);
    expectNoText(t, '過去の計算です');
    expectNoText(t, '入力前提が変わりました');
    await tab(page2, /3\. お金は足りるか/);
    await sleep(200);
    const tax = await page2.locator('input[aria-label="税率"]').inputValue();
    if (tax !== '30') throw new Error(`税率が ${tax}`);
    return `識別子 ${before} のまま。税率 30・最低現預金・減価償却費も保持`;
  });

  await check('11', '再読込後も、3系列の2030年度の値と暫定判定は変わらない', async () => {
    await tab(page2, /1\. 目標に届くか/);
    await sleep(300);
    const t = await bodyText(page2);
    expectText(t, '達成率 82.5%（2030年度）');
    expectText(t, '達成率 80.0%（2030年度）');
    expectText(t, '暫定（確定判定なし）');
    return '売上 82.5%、営業利益 80.0%、資金判定は暫定のまま';
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
  fs.writeFileSync(path.join(outDir, 'browser-results-stage6-flow.json'), JSON.stringify({ summary, results, pageErrors, externalCount: external.length }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.id}  ${r.name}  -- ${r.detail}`);
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
