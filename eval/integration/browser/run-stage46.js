/* STAGE4 で財務効果を確認 → STAGE6 の条件付き試算に反映されるかを、実コンポーネントで検証する（評価専用）。
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

const MILLION = 1_000_000;

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

/* 統一PLの表を読む：年度ごとに [年度, 売上(B), 売上増加, 売上(条件付き), 営業費用(B), 費用削減, 追加費用, 営業費用(条件付き), 営業利益(B), 営業利益(条件付き)] */
const readTrialRows = (page) =>
  page.evaluate(() => {
    const panel = document.querySelector('[aria-label="条件付きPL試算（統一PL）"]');
    if (!panel) return null;
    return [...panel.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
  });

const readTrialText = (page) =>
  page.evaluate(() => document.querySelector('[aria-label="条件付きPL試算（統一PL）"]')?.textContent ?? '');

const num = (s) => {
  const v = Number(String(s).replace(/,/g, '').replace('+', ''));
  return Number.isFinite(v) ? v : NaN;
};

const storeProject = (page) =>
  page.evaluate(() => {
    const st = window.__getStrategyState();
    const pr = st.departments.flatMap((d) => d.projects).find((x) => x.title === '新規顧客開拓');
    return { effect: pr?.financeEffect ?? null, legacy: pr?.impactRevenueMJPY ?? null, uid: pr?.projectUid ?? null };
  });

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  const page = await newPage(browser);
  await page.goto(pathToFileURL(path.join(outDir, 'stage46.html')).href);
  await page.waitForTimeout(1800);

  const s4 = page.locator('#s-stage4');
  await s4.locator('details').first().evaluate((d) => (d.open = true));
  await page.waitForTimeout(200);

  const selectByLabel = async (label, value) => {
    await s4.locator('label').filter({ hasText: label }).locator('select').selectOption(value);
    await page.waitForTimeout(150);
  };
  const fillByLabel = async (label, value) => {
    await s4.locator('label').filter({ hasText: label }).locator('input').first().fill(value);
    await page.waitForTimeout(150);
  };

  await check('STAGE6 の初期表示：財務効果が未設定の施策は試算に入らない（旧来の金額も加算しない）', async () => {
    const txt = await readTrialText(page);
    if (!txt.includes('条件付きPL試算（統一PL）')) throw new Error('試算の見出しがない');
    const rows = await readTrialRows(page);
    const sums = (rows ?? []).map((r) => num(r[2]) || 0);
    if (sums.some((v) => v !== 0)) throw new Error('未設定なのに効果が入っている');
    const p = await storeProject(page);
    if (p.legacy !== 50) throw new Error('旧来の金額が店舗に残っていない: ' + p.legacy);
    return `財務効果未設定：試算の効果は0。旧来の金額 50百万円は店舗に保持（加算なし）`;
  });

  await check('STAGE4：費用削減（年額120万円・2026-04開始）を入力し、確認済みにする', async () => {
    await selectByLabel('効果の種類', 'COST_REDUCTION');
    await selectByLabel('算定方法', 'DIRECT_AMOUNT');
    await fillByLabel('金額（百万円）', '1.2');
    await selectByLabel('金額の単位', 'ANNUAL');
    await fillByLabel('効果の開始月', '2026-04');
    await s4.locator('label').filter({ hasText: '算定根拠・出所' }).locator('textarea').fill('見積書（架空）');
    await s4.getByRole('button', { name: '内容を確認し、確認済みにする' }).click();
    await page.waitForTimeout(200);
    const p = await storeProject(page);
    if (!p.effect || p.effect.confirmed !== true) throw new Error('店舗が確認済みになっていない');
    return '店舗：confirmed=true、金額 1,200,000円（年額）';
  });

  await check('STAGE6：確認済みの費用削減は営業費用を減らし、営業利益を増やす（費用 −1.2、利益 +1.2）', async () => {
    const rows = await readTrialRows(page);
    if (!rows || rows.length === 0) throw new Error('年度の行がない');
    const withEffect = rows.filter((r) => r[5] !== '0.0');
    if (withEffect.length === 0) throw new Error('費用削減が反映されていない');
    for (const r of withEffect) {
      if (r[5] !== '−1.2') throw new Error('費用削減の符号・金額が違う: ' + r[5]);
      if (Math.abs(num(r[7]) - (num(r[4]) - 1.2)) > 0.06) throw new Error(`営業費用が減っていない: ${r[4]} → ${r[7]}`);
      if (Math.abs(num(r[9]) - (num(r[8]) + 1.2)) > 0.06) throw new Error(`営業利益が増えていない: ${r[8]} → ${r[9]}`);
    }
    return `${withEffect.length}年度：営業費用 −1.2、営業利益 +1.2（ベースライン比）`;
  });

  await check('STAGE6：売上増加の年度は、営業利益の影響を未算定と表示する（0扱いしない）', async () => {
    await selectByLabel('効果の種類', 'REVENUE_UP');
    const afterKind = await storeProject(page);
    if (afterKind.effect.confirmed !== false) throw new Error('効果の種類の変更で確認が解除されていない');
    await fillByLabel('金額（百万円）', '6');
    await s4.getByRole('button', { name: '内容を確認し、確認済みにする' }).click();
    await page.waitForTimeout(200);
    const cur = await storeProject(page);
    if (cur.effect.confirmed !== true || cur.effect.kind !== 'REVENUE_UP') throw new Error('売上増加を確認済みにできていない');
    const rows = await readTrialRows(page);
    const revRow = rows.find((r) => r[2] !== '0.0');
    if (!revRow) throw new Error('売上増加が反映されていない');
    if (revRow[2] !== '+6.0') throw new Error('売上効果が違う: ' + revRow[2]);
    if (Math.abs(num(revRow[3]) - (num(revRow[1]) + 6)) > 0.06) throw new Error('条件付き売上が違う: ' + revRow[1] + ' → ' + revRow[3]);
    if (revRow[7] !== '未算定' || revRow[9] !== '未算定') throw new Error('営業費用・営業利益の試算が未算定になっていない: ' + revRow[7] + ' / ' + revRow[9]);
    return `売上効果 +6.0、営業費用・営業利益の条件付き試算は未算定（0扱いしない）`;
  });

  await check('STAGE6：追加費用は利益を減らす符号（−）で反映され、営業利益の試算は既存計画−3になる', async () => {
    await selectByLabel('効果の種類', 'COST_INCREASE');
    await fillByLabel('金額（百万円）', '3');
    await s4.getByRole('button', { name: '内容を確認し、確認済みにする' }).click();
    await page.waitForTimeout(200);
    const cur = await storeProject(page);
    if (cur.effect.confirmed !== true || cur.effect.kind !== 'COST_INCREASE') throw new Error('追加費用を確認済みにできていない');
    const rows = await readTrialRows(page);
    const costRows = rows.filter((r) => r[6] !== '0.0');
    if (costRows.length === 0) throw new Error('追加費用が反映されていない');
    for (const r of costRows) {
      if (r[6] !== '+3.0') throw new Error('追加費用の符号・金額が違う: ' + r[6]);
      if (r[2] !== '0.0' || r[5] !== '0.0') throw new Error('他の効果が混ざっている: ' + r.join('|'));
      if (Math.abs(num(r[7]) - (num(r[4]) + 3)) > 0.06) throw new Error(`営業費用が増えていない: ${r[4]} → ${r[7]}`);
      if (Math.abs(num(r[9]) - (num(r[8]) - 3)) > 0.06) throw new Error(`営業利益が減っていない: ${r[8]} → ${r[9]}`);
    }
    return `${costRows.length}年度：営業費用 +3.0、営業利益 −3.0（売上には混ざらない）`;
  });

  await check('STAGE4：財務効果を変更すると確認が解除され、試算の対象外になる', async () => {
    await fillByLabel('金額（百万円）', '7');
    await page.waitForTimeout(200);
    const p = await storeProject(page);
    if (p.effect.confirmed !== false) throw new Error('確認が解除されていない');
    const txt = await readTrialText(page);
    if (!txt.includes('利用者が未確認')) throw new Error('試算の除外理由に未確認が出ていない');
    const rows = await readTrialRows(page);
    if (rows.some((r) => r[2] !== '0.0' || r[5] !== '0.0' || r[6] !== '0.0')) throw new Error('未確認の効果が試算に残っている');
    return '金額変更で confirmed=false、試算から除外（理由：利用者が未確認）';
  });

  await check('北極星の旧金額と条件付き試算は区別される（旧金額は試算に加算されない）', async () => {
    const p = await storeProject(page);
    if (p.legacy !== 50) throw new Error('旧来の金額が変わった: ' + p.legacy);
    const stage4 = await s4.innerText();
    if (!stage4.includes('北極星')) throw new Error('STAGE4 に北極星との関係の説明がない');
    const txt = await readTrialText(page);
    if (!txt.includes('実績ではなく')) throw new Error('仮説であることの説明がない');
    return '旧来の金額 50 は保持、試算には加算せず（別表示）';
  });

  await check('経営目標を入れても、試算の基準は現状延長のまま（目標への補間に施策効果を重ねない）', async () => {
    await page.getByRole('tab', { name: /3\. お金は足りるか/ }).click();
    await page.waitForTimeout(150);
    await page.getByLabel('目標売上', { exact: true }).fill('2000');
    await page.getByLabel('目標年度', { exact: true }).fill('2028');
    await page.waitForTimeout(200);
    const targetInput = await page.getByLabel('目標売上', { exact: true }).inputValue();
    if (targetInput !== '2000') throw new Error('目標売上が入力されていない: ' + targetInput);
    await page.getByRole('tab', { name: /1\. 目標に届くか/ }).click();
    await page.waitForTimeout(150);
    await s4.getByRole('button', { name: '内容を確認し、確認済みにする' }).click();
    await page.waitForTimeout(200);
    const p = await storeProject(page);
    if (p.effect.confirmed !== true) throw new Error('費用の効果を確認済みにできていない');
    const rows = await readTrialRows(page);
    if (!rows || rows.length < 2) throw new Error('年度の行が足りない');
    const revs = new Set(rows.map((r) => r[1]));
    if (revs.size !== 1) throw new Error('ベースラインの売上が年度で変わっている（目標経路が混ざっている）: ' + [...revs].join(','));
    for (const r of rows) {
      const hasCost = r[6] !== '0.0';
      if (hasCost && r[6] !== '+7.0') throw new Error('追加費用の符号・金額が違う: ' + r[6]);
      const opexExpected = hasCost ? num(r[4]) + 7 : num(r[4]);
      const oiExpected = hasCost ? num(r[8]) - 7 : num(r[8]);
      if (Math.abs(num(r[7]) - opexExpected) > 0.06) throw new Error('営業費用の試算が違う: ' + r.join('|'));
      if (Math.abs(num(r[9]) - oiExpected) > 0.06) throw new Error('営業利益の試算が違う: ' + r.join('|'));
    }
    // 経営目標（STAGE2：売上 1,000・営業利益 70、期限 2028年度）との差額 = 目標 − 条件付きPL試算
    const fy = rows.find((r) => r[0] === '2028年度');
    const oy = rows.find((r) => r[0] === '2026年度');
    if (!fy || !oy) throw new Error('2028年度または2026年度の行がない');
    const gapRev = 1000 - num(fy[3]);
    const gapOi = 70 - num(oy[9]);
    const txt = await readTrialText(page);
    if (!txt.includes('経営目標（STAGE2・予測に加算しない）')) throw new Error('経営目標の区別の表示がない');
    if (!txt.includes(`売上（2028年度）：不足 ${gapRev.toFixed(1)} 百万円`)) throw new Error(`売上の差額が違う（期待 2028年度 ${gapRev.toFixed(1)}）`);
    if (!txt.includes(`営業利益（2026年度）：不足 ${gapOi.toFixed(1)} 百万円`)) throw new Error(`利益の差額が違う（期待 2026年度 ${gapOi.toFixed(1)}）`);
    return `CFの目標入力は試算に入らず、ベースライン売上は全年度 ${[...revs][0]}。売上（2028年度）${gapRev.toFixed(1)}、営業利益（2026年度）${gapOi.toFixed(1)}（百万円・不足）`;
  });

  await check('STAGE6 CF：条件付きCF試算は確認済みの追加費用を税引後で反映し、既存CFの前提は変えない', async () => {
    await page.getByRole('tab', { name: /3\. お金は足りるか/ }).click();
    await page.waitForTimeout(150);
    await page.getByLabel('税率', { exact: true }).fill('30');
    await page.waitForTimeout(250);
    const cfRows = await page.evaluate(() => {
      const panel = document.querySelector('[aria-label="条件付きCF試算"]');
      if (!panel) return null;
      return [...panel.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));
    });
    if (!cfRows || cfRows.length < 2) throw new Error('条件付きCF試算の表がない');
    // 手計算：追加費用 7 百万円（年額）→ 税引前 −7 → 税引後 −7 × (1 − 30%) = −4.9。FY2026 は効果なし（2026年4月開始）
    let cumulative = 0;
    const details = [];
    for (const r of cfRows) {
      const base = num(r[2]);
      const cond = num(r[3]);
      const hasEffect = r[0] !== '2026年度';
      const delta = hasEffect ? -4.9 : 0;
      if (!Number.isFinite(base) || !Number.isFinite(cond)) {
        const reasons = await page.locator('[aria-label="条件付きCF試算"] li').allInnerTexts();
        throw new Error('営業CFが未算定: ' + r.join('|') + ' || 理由: ' + reasons.join(' / ') + ' || ' + dbgTxt.length);
      }
      if (Math.abs(cond - base - delta) > 0.06) throw new Error(`営業CFの差が −4.9 にならない（${r[0]}）: 基準${r[2]} 条件付き${r[3]}`);
      cumulative += delta;
      const closeCond = num(r[7]);
      const closeBase = num(r[8]);
      if (!Number.isFinite(closeCond) || Math.abs(closeCond - closeBase - cumulative) > 0.06) {
        throw new Error(`期末現預金の差が累積と一致しない（${r[0]}）: ${r[7]} − ${r[8]} ≠ ${cumulative.toFixed(1)}`);
      }
      details.push(`${r[0]} 営業CF差 ${delta.toFixed(1)}`);
    }
    const txt = await page.locator('[aria-label="条件付きCF試算"]').innerText();
    if (!txt.includes('従来の北極星の金額は加算していません')) throw new Error('北極星の金額を加えていない旨の説明がない');
    if (!txt.includes('借入未反映・暫定')) throw new Error('借入計画が未入力なのに期末の表示が借入反映後になっている');
    if (!txt.includes('目標補間CF：経営目標へ到達する仮想的な経路で、業績予測ではありません')) throw new Error('目標補間CFの区別の説明がない');
    return `${details.join('、')}。期末現預金の差は累積 ${cumulative.toFixed(1)}（既存CFは変更なし）`;
  });

  await check('STAGE6 表示の優先順位：条件付きCFが先、目標補間は後の参考情報、上段は統一PLと目標の差', async () => {
    const card = await page.locator('text=条件付きPL試算と売上目標の差').count();
    if (card === 0) throw new Error('上段に統一PLと売上目標の差のカードがない');
    const cardNote = await page.locator('body').innerText();
    if (!cardNote.includes('2028年度：経営目標')) throw new Error('差額カードの年度・目標・試算の表示がない');
    await page.getByRole('tab', { name: /3. お金は足りるか/ }).click();
    await page.waitForTimeout(150);
    const order = await page.evaluate(() => {
      const panel = document.querySelector('[aria-label="条件付きCF試算"]');
      const ref = document.querySelector('[aria-label="目標補間の経路と前提入力（参考情報）"]');
      if (!panel || !ref) return null;
      return panel.compareDocumentPosition(ref) & Node.DOCUMENT_POSITION_FOLLOWING ? 'panel-first' : 'ref-first';
    });
    if (order !== 'panel-first') throw new Error('条件付きCFが目標補間より前に出ていない: ' + order);
    const refText = await page.locator('[aria-label="目標補間の経路と前提入力（参考情報）"]').innerText();
    if (!refText.includes('条件付きCFが未算定でも、この表の値で代用しません')) throw new Error('目標補間で代用しない旨の説明がない');
    await page.getByRole('tab', { name: /1\. 目標に届くか/ }).click();
    await page.waitForTimeout(150);
    await page.locator('#s-stage6').screenshot({ path: path.join(outDir, 'shots', 'stage6-target-tab.png') });
    return '上段：統一PLと2028年度の差額カード／タブ3：条件付きCF→目標補間（参考）の順／未算定でも代用しない旨を表示';
  });

  await check('上段カード：売上と営業利益はそれぞれの目標年度で比較する（売上2028年度・営業利益2026年度）', async () => {
    const cardText = (label) =>
      page.evaluate((l) => {
        const el = [...document.querySelectorAll('div,span,p,h3,dt,strong,dd')].find((e) => e.childElementCount === 0 && e.textContent.trim() === l);
        let c = el;
        for (let i = 0; i < 5 && c; i++) {
          if (c.innerText && c.innerText.length > l.length + 12) return c.innerText;
          c = c.parentElement;
        }
        return null;
      }, label);
    const rev = await cardText('条件付きPL試算と売上目標の差');
    const op = await cardText('条件付きPL試算と営業利益目標の差');
    if (!rev || !op) throw new Error('上段の差額カードが見つからない');
    // 手計算：売上 2028年度 経営目標 1,000 − 条件付きPL 930 = 70。営業利益 2026年度 経営目標 70 − 条件付きPL 52 = 18
    if (!rev.includes('2028年度') || !rev.includes('不足 70 百万円')) throw new Error('売上カードが2028年度・70.0で比較されていない: ' + rev.split('\n').join(' / ').slice(0, 200));
    if (!op.includes('2026年度') || !op.includes('不足 18 百万円')) throw new Error('営業利益カードが2026年度・18.0で比較されていない: ' + op.split('\n').join(' / ').slice(0, 200));
    return '売上：2028年度 不足70.0（1,000−930）／営業利益：2026年度 不足18.0（70−52）';
  });

  await check('STAGE4 財務効果：注記は確認済みだけがSTAGE6に反映されると示し、詳細設定は閉じて始まる', async () => {
    const adv = s4.locator('summary', { hasText: '詳細設定（任意・必要なときだけ）' }).locator('xpath=..');
    if ((await adv.count()) === 0) throw new Error('詳細設定の折りたたみがない');
    if (await adv.evaluate((d) => d.open)) throw new Error('詳細設定が初期状態で開いている');
    const t = await s4.innerText();
    if (!t.includes('利用者が確認済みにした算定根拠だけが、STAGE6の条件付きPL・CF試算に反映されます')) throw new Error('注記の文言が更新されていない');
    return '詳細設定は閉じて始まる。注記は確認済みだけがSTAGE6に反映される旨を示す';
  });

  await check('ブラウザ実行中に例外・コンソールエラー・外部通信がない', async () => {
    if (errors.length) throw new Error(errors.slice(0, 2).join(' | '));
    if (external.length) throw new Error('外部通信: ' + external.length);
    return 'エラー0件・外部通信0件';
  });

  await page.locator('#s-stage6').screenshot({ path: path.join(outDir, 'shots', 'stage46-trial.png') });
  await browser.close();

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
  };
  fs.writeFileSync(path.join(outDir, 'browser-results-stage46.json'), JSON.stringify({ summary, results, errors, external }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.name}  -- ${r.detail}`);
  if (errors.length) console.log('errors:', errors.slice(0, 4));
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
