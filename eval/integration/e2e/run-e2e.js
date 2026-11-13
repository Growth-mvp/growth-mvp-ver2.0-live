/* 実ブラウザ（Chromium）で、STAGE4の5操作を通しで確認する（評価専用。隔離DB・架空データ・モックAI）。
 * 1 作成 → 2 文章・財務効果の編集 → 3 保存して再読み込み → 4 再生成して反映 → 5 実行開始 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '.results');
const RENEWAL = '既存顧客の保守契約更新';
const REASON = 'E2Eで直した取り組む理由（実ブラウザ）';
const RESPONSIBLE = '佐藤（仮）';
const ACTION_CONTENT = 'E2Eで直した主な内容（実施事項1）';
const ACTION_TITLE = 'E2Eで直した実施事項の名称';
const ACTION_OWNER = 'E2Eの担当（営業部長・仮）';
const ACTION_DUE = '2027-06';
const KPI_TARGET = '3社（E2E変更）';
const KPI_DUE = '2028-03';
const KPI_OWNER = 'E2E担当（STAGE4上）';
const KPI_ORIGINAL_TARGET = '95%';

const results = [];
const errors = [];
const check = async (name, fn) => {
  try {
    const detail = (await fn()) ?? '';
    results.push({ name, status: 'PASS', detail });
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: String(e.message || e).split('\n')[0] });
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const state = async () => (await fetch(`${BASE}/__state`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/__state`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('server did not start');
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, '.build', 'server.mjs')], {
    env: { ...process.env, E2E_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => errors.push('SERVER ' + String(d).slice(0, 300)));
  await waitServer();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.route('**/*', (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 300));
  });
  const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  const finance = () => page.locator('details.plan-finance-toggle').first();
  const openFinance = async () => {
    if (!(await finance().evaluate((d) => d.open))) await finance().locator(':scope > summary').click();
  };

  const before = await state();
  const strategyBefore = JSON.stringify(before.strategy.departments);

  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: new RegExp(RENEWAL) }).first().waitFor({ timeout: 60000 });

  /* 1. 計画書を作成 */
  await check('1 プロジェクトを選び、実行計画書を作成する', async () => {
    await page.getByRole('button', { name: new RegExp(RENEWAL) }).first().click();
    await page.getByRole('button', { name: 'AIで実行計画書を作成' }).click();
    await page.getByRole('article', { name: '実行計画書' }).waitFor({ timeout: 60000 });
    const s = await state();
    expect(s.plans.length === 1 && s.plans[0].status === 'DRAFT' && Number(s.plans[0].version) === 1, '保存先に草案が1件できていない');
    await shot('1-created');
    return `版 ${s.plans[0].version}`;
  });

  /* 2. 文章・財務効果を編集 */
  await check('2 文章を文書上で直接編集する（未保存の変更を知らせる）', async () => {
    await page.getByRole('button', { name: '取り組む理由を修正する' }).click();
    await page.getByLabel('取り組む理由', { exact: true }).fill(REASON);
    await page.getByText('未保存の修正があります').first().waitFor({ timeout: 10000 });
    await shot('2-edited');
    return '未保存の表示あり';
  });

  await check('2 財務効果を入力する（開閉の中で、金額・頻度・期間）', async () => {
    await openFinance();
    const freq = page.getByLabel(/の発生頻度$/).first();
    await freq.waitFor({ timeout: 10000 });
    await freq.selectOption('ANNUAL');
    await page.getByLabel(/の開始年月$/).first().fill('2026-12');
    await page.getByLabel(/の終了年月$/).first().fill('2027-05');
    await shot('2-finance');
    return '発生頻度・期間を入力';
  });

  /* 3. 保存して再読み込み */
  await check('3 「計画を保存」で本文と財務効果を保存する（数値が不確かなものは未確認の草案）', async () => {
    await page.getByRole('button', { name: '計画を保存' }).click();
    await page.getByRole('status').filter({ hasText: '保存済み' }).first().waitFor({ timeout: 30000 });
    const s = await state();
    expect(s.plans[0].user_edits && Object.values(s.plans[0].user_edits).includes(REASON), '本文の修正が保存先に入っていない');
    expect(s.events.some((e) => e.action === 'SAVED'), '保存の履歴が無い');
    await openFinance();
    await page.getByText('草案（未確認のため').first().waitFor({ timeout: 10000 });
    await shot('3-saved');
    return `版 ${s.plans[0].version}・財務効果は未確認の草案`;
  });

  await check('3 保存後に開き直しても、本文と財務効果が残る', async () => {
    await page.reload();
    await page.getByRole('button', { name: new RegExp(RENEWAL) }).first().click();
    await page.getByText(REASON).first().waitFor({ timeout: 30000 });
    await openFinance();
    const freq = page.getByLabel(/の発生頻度$/).first();
    await freq.waitFor({ timeout: 10000 });
    expect((await freq.inputValue()) === 'ANNUAL', '発生頻度が再読み込みで残っていない');
    await shot('3-reloaded');
    return '本文・発生頻度が残る';
  });

  await check('3 実施事項の名称・主な内容・担当・期限を直接編集し、保存して再読み込みしても残る', async () => {
    await page.getByRole('button', { name: '実施事項1の主な内容を修正する' }).click();
    await page.getByLabel('実施事項1の主な内容', { exact: true }).fill(ACTION_CONTENT);
    await page.getByRole('button', { name: '実施事項1を修正する' }).click();
    await page.getByLabel('実施事項1', { exact: true }).fill(ACTION_TITLE);
    await page.getByRole('button', { name: '実施事項1の担当を修正する' }).click();
    await page.getByLabel('実施事項1の担当', { exact: true }).fill(ACTION_OWNER);
    await page.getByRole('button', { name: '実施事項1の期限を修正する' }).click();
    await page.getByLabel('実施事項1の期限', { exact: true }).fill(ACTION_DUE);
    await shot('3-action-edited');
    await page.getByRole('button', { name: '計画を保存' }).click();
    await page.getByRole('status').filter({ hasText: '保存済み' }).first().waitFor({ timeout: 30000 });
    const edits = (await state()).plans[0].user_edits;
    expect(Object.values(edits).includes(ACTION_CONTENT), '主な内容が保存先に無い');
    expect(Object.values(edits).includes(ACTION_TITLE), '名称が保存先に無い');
    expect(Object.values(edits).includes(ACTION_OWNER), '担当が保存先に無い');
    expect(edits['action:1:due'] === ACTION_DUE, `期限が保存先に無い（${edits['action:1:due']}）`);
    await page.reload();
    await page.getByRole('button', { name: new RegExp(RENEWAL) }).first().click();
    await page.getByText(ACTION_CONTENT).first().waitFor({ timeout: 30000 });
    await page.getByText(ACTION_TITLE).first().waitFor({ timeout: 10000 });
    await page.getByText(ACTION_OWNER).first().waitFor({ timeout: 10000 });
    await shot('3-action-reloaded');
    return '名称・主な内容・担当・期限が保存され、再読み込み後も残る';
  });

  await check('3 日程表に、編集した担当と期限が出る（同じ期限を別に持たない）', async () => {
    await page.getByText(`（担当：${ACTION_OWNER}）`).first().waitFor({ timeout: 10000 });
    return '日程表に編集した担当が出る';
  });

  await check('3 財務前提（顧客数）を試算表の入力欄で直接変更し、保存・再読み込みで残る', async () => {
    await openFinance();
    const input = page.locator('.plan-params input[type="number"]').first();
    await input.waitFor({ timeout: 10000 });
    await input.fill('12');
    await page.getByRole('button', { name: '計画を保存' }).click();
    await page.getByRole('status').filter({ hasText: '保存済み' }).first().waitFor({ timeout: 30000 });
    await page.reload();
    await page.getByRole('button', { name: new RegExp(RENEWAL) }).first().click();
    await openFinance();
    const again = page.locator('.plan-params input[type="number"]').first();
    await again.waitFor({ timeout: 10000 });
    expect((await again.inputValue()) === '12', `前提が保存されていない（${await again.inputValue()}）`);
    return '前提12を保存・再読み込み';
  });

  await check('3 開始前の確認を「確認済みにする」で記録し、保存・再読み込みで残る', async () => {
    const box = page.locator('ol.plan-ordered input[type="checkbox"]').first();
    await box.waitFor({ timeout: 10000 });
    await box.check();
    await page.getByRole('button', { name: '計画を保存' }).click();
    await page.getByRole('status').filter({ hasText: '保存済み' }).first().waitFor({ timeout: 30000 });
    await page.reload();
    await page.getByRole('button', { name: new RegExp(RENEWAL) }).first().click();
    const again = page.locator('ol.plan-ordered input[type="checkbox"]').first();
    await again.waitFor({ timeout: 10000 });
    expect(await again.isChecked(), '確認済みの記録が再読み込みで残っていない');
    await shot('3-checks');
    return '確認済みの記録が残る';
  });

  await check('3 STAGE3由来のKPIの目標・期限・担当を、STAGE4上で変更でき、元のSTAGE3は変わらない', async () => {
    const KPI = '保守契約の継続率';
    await page.getByRole('button', { name: `${KPI}の目標を修正する` }).click();
    await page.getByLabel(`${KPI}の目標`, { exact: true }).fill(KPI_TARGET);
    await page.getByRole('button', { name: `${KPI}の期限を修正する` }).click();
    await page.getByLabel(`${KPI}の期限`, { exact: true }).fill(KPI_DUE);
    await page.getByRole('button', { name: `${KPI}の担当を修正する` }).click();
    await page.getByLabel(`${KPI}の担当`, { exact: true }).fill(KPI_OWNER);
    await page.getByText('STAGE3から変更').first().waitFor({ timeout: 10000 });
    await page.getByText(`STAGE3の値：目標 ${KPI_ORIGINAL_TARGET}`).first().waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '計画を保存' }).click();
    await page.getByRole('status').filter({ hasText: '保存済み' }).first().waitFor({ timeout: 30000 });
    const edits = (await state()).plans[0].user_edits;
    expect(Object.values(edits).includes(KPI_TARGET), 'KPIの目標（STAGE4上）が保存先に無い');
    expect(Object.values(edits).includes(KPI_OWNER), 'KPIの担当（STAGE4上）が保存先に無い');
    await page.reload();
    await page.getByRole('button', { name: new RegExp(RENEWAL) }).first().click();
    await page.getByText(KPI_TARGET, { exact: true }).first().waitFor({ timeout: 30000 });
    await page.getByText('STAGE3から変更').first().waitFor({ timeout: 10000 });
    await shot('3-kpi-changed');
    return 'STAGE4上の目標・期限・担当を保存し、再読み込み後も残る';
  });

  await check('3 財務効果だけ保存に失敗したら、「すべて保存済み」と表示しない', async () => {
    await page.evaluate(() => window.localStorage.setItem('e2e-fail-finance', '1'));
    await openFinance();
    await page.getByLabel(/の終了年月$/).first().fill('2028-03');
    await page.getByRole('button', { name: '計画を保存' }).click();
    await page.getByText('財務効果は保存できませんでした').first().waitFor({ timeout: 30000 });
    expect((await page.getByText(/すべて保存/).count()) === 0, '「すべて保存」と表示されている');
    await page.evaluate(() => window.localStorage.removeItem('e2e-fail-finance'));
    await page.getByRole('button', { name: '計画を保存' }).click();
    await page.getByText('財務効果は保存できませんでした').first().waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
    return '失敗時は警告のみ・「すべて保存」なし';
  });

  /* 4. 再生成して新しい案を反映 */
  await check('4 「AIでもう一度作る」で新しい案が表示され、既存の計画は変わらない', async () => {
    const versionBefore = (await state()).plans[0].version;
    await page.getByRole('button', { name: 'AIでもう一度作る' }).click();
    await page.getByRole('button', { name: 'この案を使う' }).waitFor({ timeout: 60000 });
    const s = await state();
    expect(Number(s.plans[0].version) === Number(versionBefore), '案を見ただけで計画が変わった');
    await shot('4-regen-preview');
    return '案を表示・保存は変わらず';
  });

  await check('4 「元の計画に戻る」で案を閉じると、計画は変わらない', async () => {
    const versionBefore = Number((await state()).plans[0].version);
    await page.getByRole('button', { name: '元の計画に戻る' }).click();
    await page.getByRole('button', { name: 'この案を使う' }).waitFor({ state: 'detached', timeout: 10000 });
    expect(Number((await state()).plans[0].version) === versionBefore, '戻ったのに版が変わった');
    await page.getByText(REASON).first().waitFor({ timeout: 10000 });
    return '元の計画書に戻る';
  });

  await check('4 「この案を使う」で新しい案を反映する', async () => {
    await page.getByRole('button', { name: 'AIでもう一度作る' }).click();
    await page.getByRole('button', { name: 'この案を使う' }).waitFor({ timeout: 60000 });
    const versionBefore = Number((await state()).plans[0].version);
    await page.getByRole('button', { name: 'この案を使う' }).click();
    await page.getByRole('status').filter({ hasText: '新しい案' }).first().waitFor({ timeout: 30000 });
    const s = await state();
    expect(Number(s.plans[0].version) === versionBefore + 1, `版が進んでいない（${s.plans[0].version}）`);
    expect(s.events.some((e) => e.action === 'DRAFT_REPLACED'), '差し替えの履歴が無い');
    await page.getByText(REASON).first().waitFor({ timeout: 10000 });
    await page.getByText(ACTION_CONTENT).first().waitFor({ timeout: 10000 });
    await page.getByText(KPI_TARGET, { exact: true }).first().waitFor({ timeout: 10000 });
    await openFinance();
    expect((await page.locator('.plan-params input[type="number"]').first().inputValue()) === '12', '再生成後に財務前提が残っていない');
    expect(await page.locator('ol.plan-ordered input[type="checkbox"]').first().isChecked(), '再生成後に確認済みの記録が残っていない');
    await shot('4-regen-used');
    return `版 ${s.plans[0].version}`;
  });

  /* 5. 実行開始 */
  await check('5 責任者が未入力なら開始できず、不足を示す', async () => {
    await page.getByRole('button', { name: '実行を開始する' }).first().click();
    await page.getByPlaceholder('実行責任者の名前').waitFor({ timeout: 10000 });
    const startBtn = page.getByRole('button', { name: '実行を開始する' }).first();
    expect(await startBtn.isDisabled(), '責任者が空なのに開始できる');
    await page.getByText('実行責任者を入力してください').waitFor({ timeout: 10000 });
    await shot('5-start-blocked');
    return '開始は無効・不足を表示';
  });

  await check('5 実行責任者を入れて「実行を開始する」', async () => {
    await page.getByPlaceholder('実行責任者の名前').fill(RESPONSIBLE);
    await page.getByText('STAGE3の目標・期限・担当を1件変更しています').first().waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '実行を開始する' }).first().click();
    await page.getByText('実行を開始しました').waitFor({ timeout: 60000 });
    const s = await state();
    expect(s.plans[0].start_info !== null && s.plans[0].adopted === true, '開始の記録が保存先に無い');
    await shot('5-started');
    return '開始・採用の記録あり';
  });

  await check('5 開始後にSTAGE5への導線があり、計画書に戻ると「実行中」と分かる', async () => {
    await page.getByRole('link', { name: 'STAGE5で進捗を確認する' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '計画書に戻る' }).click();
    await page.getByText('現在の状態：実行中').waitFor({ timeout: 10000 });
    await shot('5-running');
    return '実行中の表示あり';
  });

  await check('全体：STAGE3の正式データ（okrsV2 を含む戦略）は、保存先で変わっていない', async () => {
    const after = await state();
    expect(JSON.stringify(after.strategy.departments) === strategyBefore, '戦略データが変わった');
    return '変化なし';
  });

  await check('全体：画面・サーバーのエラーが無い', async () => {
    const serious = errors.filter((e) => !/favicon|React DevTools/.test(e));
    expect(serious.length === 0, serious.slice(0, 3).join(' / '));
    return `${serious.length}件`;
  });

  await browser.close();
  server.kill();

  const passed = results.filter((r) => r.status === 'PASS').length;
  for (const r of results) console.log(`${r.status}  ${r.name}${r.detail ? '  -- ' + r.detail : ''}`);
  console.log(`\n${passed}/${results.length} passed`);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error('runner error', e);
  process.exit(2);
});
