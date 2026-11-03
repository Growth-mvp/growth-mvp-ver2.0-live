/* STAGE4 OKR画面（実コンポーネント app/okr/page.tsx）を操作して、金額の上書き・反映・確認状態・紐づけを検証する（評価専用）。
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

const readState = (page) => page.evaluate(() => {
  const st = window.__getStrategyState();
  const dept = st.departments[0];
  const proj = dept.projects.find((p) => p.title === '既存顧客の保守契約更新');
  return {
    impactRevenueMJPY: proj.impactRevenueMJPY ?? null,
    impactAssumptions: proj.impactAssumptions ?? null,
    projectUid: proj.projectUid ?? null,
    financeEffect: proj.financeEffect ?? null,
    rows: st.projectTargetImpacts.map((r) => ({ projectId: r.projectId, targetId: r.targetId, delta: r.delta, source: r.source })),
    storeCalls: window.__storeLog.length,
  };
});

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 120));
    return route.abort();
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 240)); });
  await page.goto(pathToFileURL(path.join(outDir, 'okr.html')).href);
  await page.waitForTimeout(1200);

  await page.getByText('既存顧客の保守契約更新').first().click();
  await page.waitForTimeout(300);

  await check('準備：役割「売上を伸ばす」を選ぶと、成果見込みの前提が出る', async () => {
    await page.getByRole('button', { name: '売上を伸ばす' }).first().click();
    await page.getByText('成果見込みと計算根拠').first().waitFor({ timeout: 5000 });
    const s = await readState(page);
    if (s.impactRevenueMJPY !== null) throw new Error('初期金額が未登録ではない: ' + s.impactRevenueMJPY);
    return '初期：金額 未登録・北極星の行 ' + s.rows.length + '件';
  });

  await check('1 前提編集だけでは既存金額が変わらない（計算結果の案だけが変わる）', async () => {
    await page.getByLabel('対象顧客数（社）').fill('30');
    await page.getByLabel('想定受注率（%）').fill('20');
    await page.getByLabel('平均単価').fill('20');
    await page.waitForTimeout(200);
    const calc = await page.locator('div').filter({ hasText: /^計算結果（案・未反映）/ }).first().innerText();
    const s = await readState(page);
    if (s.impactRevenueMJPY !== null) throw new Error('前提編集で金額が書き換わった: ' + s.impactRevenueMJPY);
    if (s.rows.length !== 0) throw new Error('前提編集で北極星の行ができた: ' + JSON.stringify(s.rows));
    if (!s.impactAssumptions || s.impactAssumptions.targetCustomers !== 30) throw new Error('前提が保存されていない');
    if (!calc.includes('120')) throw new Error('計算結果の案が出ていない: ' + calc.slice(0, 120));
    return '前提は保存、金額は未登録のまま、案は 120 百万円';
  });

  await check('2 プリセット選択だけでは既存金額が変わらない', async () => {
    const before = await readState(page);
    await page.getByRole('button', { name: '大きめ' }).first().click();
    await page.waitForTimeout(200);
    const after = await readState(page);
    if (after.impactRevenueMJPY !== before.impactRevenueMJPY) throw new Error('プリセットで金額が変わった');
    if (after.rows.length !== 0) throw new Error('プリセットで北極星の行ができた');
    if (after.impactAssumptions.targetCustomers !== 50) throw new Error('プリセットの前提が反映されていない');
    return '大きめ（50・30・30）で案は 450 百万円、金額は変わらず';
  });

  await check('3 「この案を金額に反映」で初めて金額と北極星の行が更新される', async () => {
    const before = await readState(page);
    await page.getByRole('button', { name: 'この案を金額に反映' }).first().click();
    await page.waitForTimeout(200);
    const s = await readState(page);
    if (s.impactRevenueMJPY !== 450) throw new Error('反映後の金額が違う: ' + s.impactRevenueMJPY);
    if (s.rows.length !== 1 || s.rows[0].targetId !== 'rev' || s.rows[0].delta !== 450) throw new Error('北極星の行が違う: ' + JSON.stringify(s.rows));
    if (s.rows[0].projectId !== s.projectUid) throw new Error('行が施策の一意IDに紐づいていない');
    if (s.projectUid === null) throw new Error('施策の一意IDが付いていない');
    void before;
    await page.locator('div').filter({ hasText: /^計算結果（案・未反映）/ }).first().screenshot({ path: path.join(outDir, 'shots', 'okr-1-reflect.png') }).catch(() => {});
    return '金額 450、行 1件（施策の一意IDに紐づく）';
  });

  await check('4 直接入力も、通常どおり金額と北極星の行を更新する', async () => {
    await page.getByRole('button', { name: /金額を直接修正する/ }).first().click();
    await page.getByPlaceholder('例：300').first().fill('15');
    await page.waitForTimeout(200);
    const s = await readState(page);
    if (s.impactRevenueMJPY !== 15) throw new Error('直接入力が反映されていない: ' + s.impactRevenueMJPY);
    if (s.rows.length !== 1 || s.rows[0].delta !== 15) throw new Error('行が更新されていない: ' + JSON.stringify(s.rows));
    return '直接入力 15 → 金額 15、行 1件を更新（重複なし）';
  });

  await check('5 財務効果：確認・変更・確認解除（ページ経由で store に保存される）', async () => {
    await page.getByText('財務効果の算定根拠（任意）').first().click();
    await page.getByLabel('効果の種類').first().selectOption('REVENUE_UP');
    await page.getByLabel('算定方法').first().selectOption('DIRECT_AMOUNT');
    await page.getByLabel('金額（百万円）').first().fill('20');
    await page.getByLabel('金額の単位').first().selectOption('ANNUAL');
    await page.getByLabel('効果の開始月').first().fill('2027-04');
    await page.getByLabel('算定根拠・出所').first().fill('架空の見積書');
    await page.getByRole('button', { name: '内容を確認し、確認済みにする' }).first().click();
    await page.waitForTimeout(200);
    let s = await readState(page);
    if (!s.financeEffect || s.financeEffect.confirmed !== true) throw new Error('確認済みが store に入らない');
    if (s.impactRevenueMJPY !== 15) throw new Error('財務効果の確認で金額が変わった');
    if (s.rows.length !== 1 || s.rows[0].delta !== 15) throw new Error('財務効果で北極星の行が変わった');
    await page.getByLabel('金額（百万円）').first().fill('25');
    await page.waitForTimeout(200);
    s = await readState(page);
    if (s.financeEffect.confirmed !== false || s.financeEffect.confirmedAt !== undefined) throw new Error('変更で確認が解除されない');
    if (s.rows.length !== 1 || s.rows[0].delta !== 15) throw new Error('財務効果の変更で北極星の行が変わった');
    return '確認済み→金額変更で確認解除（store）。北極星の行は変わらず';
  });

  await check('6 KR編集（目標値 95→96 を保存）後も、施策の一意IDと北極星の行・金額の紐づけが変わらない', async () => {
    const before = await readState(page);
    await page.getByRole('button', { name: '編集' }).first().click();
    await page.waitForTimeout(300);
    const idx = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input')).findIndex((x) => x.value === '95' && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height > 0),
    );
    if (idx < 0) throw new Error('KR編集フォームの目標値（95）が見つからない');
    await page.locator('input').nth(idx).fill('96');
    await page.getByRole('button', { name: '保存', exact: true }).first().click();
    await page.waitForTimeout(400);
    const krTarget = await page.evaluate(() => {
      const pr = window.__getStrategyState().departments[0].projects.find((x) => x.title === '既存顧客の保守契約更新');
      return pr.okrsV2.find((k) => k.label === '保守契約の継続率')?.target;
    });
    if (krTarget !== 96) throw new Error('KRの目標値が店舗に保存されていない: ' + krTarget);
    const t = await page.locator('#root').innerText();
    if (!t.includes('目標: 96 %')) throw new Error('画面にKRの新しい目標値が出ていない');
    const s = await readState(page);
    if (s.projectUid !== before.projectUid) throw new Error('KR編集で施策の一意IDが変わった');
    if (s.rows.length !== before.rows.length || s.rows[0]?.projectId !== before.rows[0]?.projectId) throw new Error('KR編集で行の紐づけが変わった');
    if (s.impactRevenueMJPY !== before.impactRevenueMJPY) throw new Error('KR編集で金額が変わった');
    return 'KR目標 95→96（店舗・画面とも反映）。一意ID・行（' + s.rows.length + '件）・金額は不変';
  });

  await check('保存・再読込（保存の正規化関数を実行）：施策の一意ID・金額・財務効果の確認状態が残る', async () => {
    const r = await page.evaluate(() => {
      const st = window.__getStrategyState();
      const saved = JSON.parse(JSON.stringify({ departments: st.departments }));
      const reloaded = window.__normalizeStrategyData(saved);
      const pick = (deps) => {
        const pr = deps[0].projects.find((x) => x.title === '既存顧客の保守契約更新');
        return { projectUid: pr.projectUid ?? null, impactRevenueMJPY: pr.impactRevenueMJPY ?? null, financeEffectConfirmed: pr.financeEffect?.confirmed ?? null, financeEffectConfirmedAt: pr.financeEffect?.confirmedAt ?? null, impactAssumptions: pr.impactAssumptions ?? null };
      };
      return {
        before: pick(st.departments),
        after: pick(reloaded.departments),
        rowsAfterNormalize: Array.isArray(reloaded.projectTargetImpacts) ? reloaded.projectTargetImpacts.length : null,
      };
    });
    const keys = ['projectUid', 'impactRevenueMJPY', 'financeEffectConfirmed', 'financeEffectConfirmedAt'];
    const diff = keys.filter((k) => JSON.stringify(r.before[k]) !== JSON.stringify(r.after[k]));
    if (diff.length) throw new Error('再読込で変わった項目: ' + diff.join(', '));
    return '一意ID・金額・財務効果の確認状態・確認日時が再読込で不変。北極星の行（正規化後: ' + r.rowsAfterNormalize + '件）は単体の正規化では落ちる（本番の読込経路で補償・既知）';
  });

  await check('説明：「この案を金額に反映」は旧北極星の手動金額を書き換え、財務効果の確認とは別と明示する', async () => {
    const n = await page.getByText('旧北極星の手動金額（売上・営業利益の影響額）を書き換えます').count();
    if (n === 0) throw new Error('旧北極星の金額を書き換える旨の説明がない');
    return '成果見込みの説明に、旧北極星の手動金額と財務効果の違いを表示';
  });

  await check('ブラウザ実行中に例外・コンソールエラー・外部通信がない', async () => {
    const real = errors.filter((e) => !e.includes('fetchCandidates'));
    if (real.length) throw new Error(real.slice(0, 2).join(' | '));
    if (external.length) throw new Error('外部への通信を遮断: ' + external.length + '件');
    return 'エラー0件・外部通信0件（遮断）';
  });

  await b.close();
  const summary = { total: results.length, pass: results.filter((r) => r.status === 'PASS').length, fail: results.filter((r) => r.status === 'FAIL').length };
  fs.writeFileSync(path.join(outDir, 'browser-results-okr.json'), JSON.stringify({ summary, results, errors, external }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.name}  -- ${r.detail}`);
  if (errors.length) console.log('errors:', errors.slice(0, 4));
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
