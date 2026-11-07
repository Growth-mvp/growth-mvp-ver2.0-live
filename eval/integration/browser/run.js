/* ローカルのブラウザ（Chromium）でハーネスを操作し、表示と動作を確認する（評価専用。DB・外部APIには接続しない） */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const outDir = path.join(__dirname, '..', 'results-browser');
const url = 'file:///' + path.join(outDir, 'index.html').replace(/\\/g, '/');
const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, status: 'PASS', detail: detail ?? '' });
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: String(e.message || e).split('\n')[0] });
  }
};

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForSelector('#fin-empty');

  /* ---------- STAGE4：財務効果の入力・未算定・確認・確認解除 ---------- */
  const fin = page.locator('#fin-empty');
  await check('S4 未設定の施策は「未設定（任意）」', async () => {
    await fin.locator('summary').first().click();
    await page.getByText('未設定（任意）').first().waitFor();
    return '未設定（任意）を表示';
  });
  await check('S4 種類だけ選ぶと「未算定（入力不足）」と不足項目が出る', async () => {
    await fin.getByLabel('効果の種類').selectOption('REVENUE_UP');
    await page.getByText('未算定（入力不足）').first().waitFor();
    const missing = await fin.locator('summary').first().textContent();
    const hint = await fin.locator('p').filter({ hasText: '不足：' }).first().textContent();
    if (!hint.includes('算定方法')) throw new Error('不足表示に算定方法がない: ' + hint);
    return hint;
  });
  await check('S4 算定方法・金額・単位・開始月・根拠を入れると「未確定（確認待ち）」になり計算式が出る', async () => {
    await fin.getByLabel('算定方法').selectOption('DIRECT_AMOUNT');
    await fin.getByLabel('金額（百万円）').fill('20');
    await fin.getByLabel('金額の単位').selectOption('ANNUAL');
    await fin.getByLabel('効果の開始月').fill('2027-04');
    await fin.getByLabel('算定根拠・出所').fill('架空の見積書');
    await page.getByText('未確定（確認待ち）').first().waitFor();
    const formula = await fin.locator('div').filter({ hasText: '年額の売上増加' }).first().textContent();
    if (!formula.includes('20')) throw new Error('計算式の金額が違う: ' + formula);
    await fin.locator('div.rounded-md').first().screenshot({ path: path.join(outDir, 'shots', 's4-formula.png') }).catch(() => {});
    return formula.trim();
  });
  await check('S4 確認ボタンで「利用者が確認済み」になり、確認日時が保存される', async () => {
    await fin.getByRole('button', { name: '内容を確認し、確認済みにする' }).click();
    await page.getByText('利用者が確認済み').first().waitFor();
    const last = await page.evaluate(() => window.__calls[window.__calls.length - 1].next);
    if (last.confirmed !== true || typeof last.confirmedAt !== 'string') throw new Error(JSON.stringify(last));
    return 'confirmedAt=' + last.confirmedAt;
  });
  await check('S4 金額を変えると確認が解除される（確認日時も消える）', async () => {
    await fin.getByLabel('金額（百万円）').fill('25');
    await page.getByText('未確定（確認待ち）').first().waitFor();
    const last = await page.evaluate(() => window.__calls[window.__calls.length - 1].next);
    if (last.confirmed !== false || last.confirmedAt !== undefined) throw new Error(JSON.stringify(last));
    return 'confirmed=false, confirmedAt=なし, 金額=' + last.directAmountYen;
  });
  await check('S4 表示だけの注記（重複の説明）の変更は確認を外さない', async () => {
    await fin.getByRole('button', { name: '内容を確認し、確認済みにする' }).click();
    await page.getByText('利用者が確認済み').first().waitFor();
    await fin.getByLabel('既存実績・他施策との重複について').fill('他施策と切り分け済み');
    await page.waitForTimeout(100);
    const last = await page.evaluate(() => window.__calls[window.__calls.length - 1].next);
    if (last.confirmed !== true) throw new Error('注記変更で確認が外れた: ' + JSON.stringify(last));
    return '注記変更後も確認済み';
  });

  /* ---------- STAGE4：旧金額と新しい財務効果の違い ---------- */
  await check('S4 旧金額（10）と財務効果の年額売上（20）が違うと注意が出る', async () => {
    const sec = page.locator('#fin-legacy-diff');
    await sec.locator('summary').first().click();
    const txt = await sec.textContent();
    if (!txt.includes('従来の売上見込み（旧値・検証済みではありません）')) throw new Error('旧値の注記がない');
    if (!txt.includes('10百万円') || !txt.includes('20百万円')) throw new Error('金額が表示されていない');
    if (!txt.includes('異なります')) throw new Error('食い違いの注意がない');
    if (!txt.includes('STAGE6の「条件付きPL試算（統一PL）」に反映されます')) throw new Error('STAGE6への反映の説明がない');
    await sec.screenshot({ path: path.join(outDir, 'shots', 's4-legacy-diff.png') });
    return '旧値の注記・食い違い注意・未接続の説明を表示';
  });
  await check('S4 財務換算しない施策に旧金額があると矛盾を注記する', async () => {
    const sec = page.locator('#fin-notfin');
    await sec.locator('summary').first().click();
    await sec.getByText('財務換算しない施策ですが').waitFor();
    return '矛盾の注記を表示';
  });

  /* ---------- STAGE6：北極星の要約（除外した手動行の警告） ---------- */
  const north = page.locator('#s-north-star');
  await check('S6 北極星：集計から外した手動行を件数・金額・理由つきで表示する', async () => {
    const t = await north.textContent();
    if (!t.includes('北極星の集計から外した金額（2件）')) throw new Error('除外の見出しがない');
    if (!t.includes('営業部::新規開拓::1')) throw new Error('行の施策キーがない');
    if (!t.includes('同名の施策が複数あり')) throw new Error('理由がない');
    if (!t.includes('登録額: 7 百万円') && !t.includes('登録額: 7百万円')) throw new Error('金額がない');
    if (!t.includes('金額は削除していません')) throw new Error('削除していない旨がない');
    await north.screenshot({ path: path.join(outDir, 'shots', 's6-north-star.png') });
    return '件数2・理由・金額・「削除していない」旨を表示';
  });
  await check('S6 旧北極星の参考計算は、参考情報として「旧北極星の参考計算」と表示する', async () => {
    const t = await north.textContent();
    if (!t.includes('旧北極星の参考計算：現状＋手動の施策寄与 900 百万円')) throw new Error('要約の文言がない: ' + t.slice(0, 200));
    if (!t.includes('参考達成率 90%')) throw new Error('達成率が違う');
    return '旧北極星の参考計算：現状＋手動の施策寄与 900 百万円 ／ 目標 1,000 百万円（参考達成率 90%・重複の可能性あり）';
  });

  /* ---------- STAGE6：財務換算対象外KRの理由 ---------- */
  await check('S6 旧北極星の参考計算は折りたたみの中にあり、開くと旧データを参照できる', async () => {
    const summary = north.locator('summary', { hasText: '旧北極星の手動金額による参考計算' });
    if ((await summary.count()) === 0) throw new Error('折りたたみの見出しがない');
    const folded = north.locator('details').first();
    if (await folded.evaluate((d) => d.open)) throw new Error('折りたたみが初期状態で開いている');
    await summary.click();
    if (!(await north.getByText('旧北極星の参考計算：現状＋手動の施策寄与').first().isVisible())) throw new Error('開いても旧データが見えない');
    return '初期は閉じており、開くと旧北極星の参考計算（手動金額）を参照できる';
  });

  await check('S6 5.参考判定：施策による達成可能性を判定していないことを明示し、旧名称の「計画は成り立つか」を出さない', async () => {
    const fp = page.locator('#s-finance-plan');
    await fp.getByRole('tab', { name: /5\. 参考判定/ }).click();
    await page.waitForTimeout(150);
    const t = await fp.innerText();
    if (!t.includes('施策による業績達成可能性を判定したものではありません')) throw new Error('達成可能性を判定していない旨の注記がない');
    if (!t.includes('条件付きPL・CFの結果は')) throw new Error('条件付き結果の参照案内がない');
    if (t.includes('計画は成り立つか')) throw new Error('旧名称が残っている');
    return '5. 参考判定：達成可能性は判定していない旨と条件付き結果への案内を表示';
  });

  await check('S6 財務換算対象外KRの理由と「0円ではなく未算定」の説明を表示する', async () => {
    const sec = page.locator('#s-exclusion');
    await sec.locator('summary').first().click();
    const t = await sec.textContent();
    if (!t.includes('財務換算の根拠が未設定のKRがあるため、業績試算には含めていません（2件）')) throw new Error('見出しがない');
    if (!t.includes('商談数・件数・率を売上増加へ換算する根拠が未設定')) throw new Error('ACQ の理由がない');
    if (!t.includes('財務効果が0円という意味ではなく、未算定です')) throw new Error('未算定の説明がない');
    return '2件の理由・未算定の説明';
  });

  /* ---------- STAGE6：プロジェクト別寄与の「未算定」 ---------- */
  await check('S6 プロジェクト別寄与：財務換算できないKRだけの施策は「未算定」、算定済みは数値', async () => {
    const sec = page.locator('#s-tab-impact');
    const rowA = sec.locator('div').filter({ hasText: '未算定の施策' }).last();
    const rowB = sec.locator('div').filter({ hasText: '算定済みの施策' }).last();
    const ta = await sec.textContent();
    const aIdx = ta.indexOf('未算定の施策');
    const bIdx = ta.indexOf('算定済みの施策');
    const aPart = ta.slice(aIdx);
    const bPart = ta.slice(bIdx, aIdx);
    if (!aPart.includes('未算定')) throw new Error('施策Aに未算定がない: ' + aPart);
    if (aPart.includes('120')) throw new Error('施策Aに数値が出ている');
    if (!bPart.includes('120 百万円')) throw new Error('施策Bの寄与が出ていない: ' + bPart.slice(0, 160));
    await sec.screenshot({ path: path.join(outDir, 'shots', 's6-tab-impact.png') });
    void rowA; void rowB;
    return 'A: 未算定（寄与の数値なし）／ B: 120 百万円';
  });

  /* ---------- STAGE6：資金計画の補間ラベル（北極星とは別の意味） ---------- */
  await check('S6 資金計画：利用者指定の目標への補間は「目標への補間」、推計は「推計」と表示する', async () => {
    const t = await page.locator('#s-cashflow').textContent();
    if (!t.includes('目標への補間')) throw new Error('補間ラベルがない');
    if (!t.includes('推計')) throw new Error('推計ラベルがない');
    return '目標への補間／推計';
  });

  await check('S6 資金計画（実コンポーネント）：条件付き試算と目標を分け、補間は通過点で独立した予測ではないと明示する', async () => {
    const fp = page.locator('#s-finance-plan');
    const top = await fp.locator('[aria-label="経営計画のサマリー"]').innerText();
    if (!top.includes('① 目標達成の状況') || !top.includes('売上高') || !top.includes('営業利益')) throw new Error('上段に目標達成の状況がない');
    if (!top.includes('目標年度が未設定です')) throw new Error('目標年度未設定の理由が出ていない');
    if (top.includes('北極星の参考計算と売上目標の差') || top.includes('条件付きPL試算と売上目標の差')) throw new Error('上段に旧KPIカードが残っている');
    if (!top.includes('② 資金の状況') || !top.includes('借入・返済の見通し')) throw new Error('上段に資金の状況がない');
    const sumBox = fp.locator('[aria-label="経営計画のサマリー"]');
    const overflow = await sumBox.evaluate((el) => el.scrollWidth - el.clientWidth);
    if (overflow > 0) throw new Error('上段が横にはみ出している: ' + overflow + 'px');
    const tabs = fp.locator('[role=tab]');
    await tabs.nth(2).click();
    await page.waitForTimeout(150);
    const t3 = await fp.innerText();
    if (!t3.includes('目標の扱い（補間の前提）')) throw new Error('補間の前提の見出しがない');
    if (!t3.includes('補間値は目標への通過点であり、独立した予測ではありません')) throw new Error('補間の注意がない');
    if (!t3.includes('横ばいの推計')) throw new Error('推計の表示がない');
    if (!t3.includes('2025年（実績）')) throw new Error('実績の表示がない');
    await fp.screenshot({ path: path.join(outDir, 'shots', 's7-finance-plan.png') });
    return '上段は目標達成と資金の2項目（年度未設定の理由つき・はみ出しなし）／補間＝通過点・独立予測ではない／推計と実績を別表示';
  });

  await check('ブラウザ実行中に例外・コンソールエラーが出ていない', async () => {
    if (errors.length > 0) throw new Error(errors.slice(0, 3).join(' | '));
    return '0件';
  });

  await browser.close();
  const summary = { total: results.length, pass: results.filter((r) => r.status === 'PASS').length, fail: results.filter((r) => r.status === 'FAIL').length };
  fs.writeFileSync(path.join(outDir, 'browser-results.json'), JSON.stringify({ url, summary, results, errors }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.name}  -- ${r.detail}`);
  if (errors.length) console.log('errors:', errors.slice(0, 5));
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
