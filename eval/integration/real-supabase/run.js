/* 実際のローカルSupabase（分離されたテストDB。127.0.0.1のみ）に対して、新STAGE4→STAGE6の財務効果の一連の操作を検証する。
 * 前提：`npm run dev:stage4-local`（http://localhost:3001）が起動していること。本番DBには接続しない。
 * 操作：STAGE4で計画書を作る → 財務前提（粗利率）を修正 → 財務効果を草案として保存・確認 → 保存データを読む →
 *       再読み込み → STAGE6の表示を読む。各段階で、DBの値（psqlの読み取り）と画面の値を並べて記録する。 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..', '..', '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env.stage4-local'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const DB_CONTAINER = 'supabase_db_growth-stage4-localdb';
const APP = 'http://localhost:3002';
const COMPANY = '日本製罐株式会社';
const PROJECT_TEXT = '塗料メーカーの設計段階に入り込み';
const TARGET_ID = 'proj-o7650b-r-mvakt080-58aqgc';
const outDir = path.join(root, 'eval', 'integration', 'results-real-supabase');
const EMAIL = 'jp-member@local.test';
const PASSWORD = 'local-e2e-only-Passw0rd!';

const results = [];
const record = (id, name, status, detail) => results.push({ id, name, status, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dbRead() {
  const sql = `select json_build_object('revision', s.revision, 'departments', s.departments, 'project_target_impacts', s.project_target_impacts, 'company_targets', s.company_targets, 'finance_pl', s.finance_pl, 'fiscal_year_end', s.fiscal_year_end) from public.strategy_data s join public.companies c on c.id = s.company_id where c.name = '${COMPANY}'`;
  const out = execFileSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' });
  return JSON.parse(out.trim());
}

function resetLocalFinance() {
  const sql = "UPDATE public.strategy_data s SET departments = (SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(d->'projects','[]'::jsonb)) p WHERE p->>'id'='" + TARGET_ID + "') THEN jsonb_set(d, '{projects}', (SELECT jsonb_agg(CASE WHEN p->>'id'='" + TARGET_ID + "' THEN (p - 'financeEffect' - 'financeEffects') ELSE p END ORDER BY ord) FROM jsonb_array_elements(d->'projects') WITH ORDINALITY AS t(p, ord))) ELSE d END ORDER BY dord) FROM jsonb_array_elements(s.departments) WITH ORDINALITY AS u(d, dord)) FROM public.companies c WHERE c.id = s.company_id AND c.name = '" + COMPANY + "'";
  execFileSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' });
}

function planEdits() {
  const sql = "select user_edits::text from public.stage4_plan_documents where project_id = 'proj-o7650b-r-mvakt080-58aqgc' order by updated_at desc limit 1";
  const out = execFileSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' });
  return JSON.parse(out.trim() || '{}');
}
async function ensureTestPassword() {
  const uid = execFileSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', "select u.id from auth.users u where u.email = '" + EMAIL + "'"], { encoding: 'utf8' }).trim();
  if (!uid) throw new Error('ローカルテストユーザーがありません: ' + EMAIL);
  const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/users/' + uid, {
    method: 'PUT',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (r.status !== 200) throw new Error('ローカルテストユーザーのパスワードを設定できません: ' + r.status);
}

async function login() {
  await ensureTestPassword();
  const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (r.status !== 200) throw new Error('local login failed: ' + r.status);
  return r.json();
}

const projectOf = (snapshot) => {
  for (const d of snapshot.departments) for (const p of d.projects || []) if ((p.title || '').includes(PROJECT_TEXT)) return { dept: d, project: p };
  throw new Error('対象の案件がDBにない');
};

/* 他の案件・STAGE3の値の変化（対象の案件の財務効果を除く） */
function stage3Diff(before, after) {
  const pick = (s) => {
    const out = {};
    for (const d of s.departments) {
      for (const p of d.projects || []) {
        const { financeEffect, financeEffects, ...rest } = p;
        out[p.id] = JSON.stringify(rest);
      }
    }
    return out;
  };
  const a = pick(before);
  const b = pick(after);
  const changed = Object.keys(a).filter((k) => a[k] !== b[k]);
  return { changed, targetImpacts: JSON.stringify(before.project_target_impacts) === JSON.stringify(after.project_target_impacts) };
}

async function fillCard(c, { unit, start, end }) {
  await c.locator('select').first().selectOption(unit);
  await c.locator('input[type="month"]').nth(0).fill(start);
  await c.locator('input[type="month"]').nth(1).fill(end);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const session = await login();
  const key = 'sb-' + new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0] + '-auth-token';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [key, JSON.stringify(session)]);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));

  const snap = { before: dbRead() };
  const { project: p0 } = projectOf(snap.before);
  resetLocalFinance();
  snap.before = dbRead();
  projectOf(snap.before);
  const targetId = p0.id;
  const card = (label) => page.locator(`[aria-label="${label}"]`);
  const REV = '売上増加（参考試算の売上）の財務効果';
  const COST = '追加費用の財務効果';

  async function openProject() {
    await page.goto(APP + '/okr', { timeout: 180000 });
    await page.getByText('企業：' + COMPANY).first().waitFor({ timeout: 180000 });
    await page.getByText(PROJECT_TEXT, { exact: false }).first().click();
    const heading = page.getByRole('heading', { name: '業績への貢献（参考試算）' }).filter({ visible: true }).first();
    const make = page.getByRole('button', { name: 'AIで実行計画書を作る' }).filter({ visible: true }).first();
    await Promise.race([heading.waitFor({ timeout: 180000 }), make.waitFor({ timeout: 180000 })]);
    if (await make.isVisible()) await make.click();
    await heading.waitFor({ timeout: 180000 });
    await sleep(400);
  }


  /* 1. STAGE4で案件を選び、計画書と第5章の参考試算を表示 */
  await openProject();
  {
    const text = await page.evaluate(() => document.body.innerText);
    const ok = text.includes('10社 × 30% × 20百万円 = 60百万円') && text.includes('追加費用：STAGE3の本文');
    record('1', '新STAGE4で案件を選び、第5章の参考試算（売上60・追加費用6）を表示する', ok ? 'PASS' : 'FAIL', ok ? '売上 60百万円（10社×30%×20百万円）' : '参考試算が出ない');
  }

  /* 2. 財務前提を修正（粗利率：AIの仮説 → 利用者の修正 25%） */
  {
    const input = page.locator('input[aria-label="粗利率を修正する"]');
    const details = page.locator('details.plan-impact-edit');
    if ((await details.count()) && !(await details.first().evaluate((d) => d.open))) await details.first().locator('summary').click();
    await input.waitFor({ state: 'visible', timeout: 60000 });
    await input.fill('25');
    await input.press('Tab');
    await sleep(1200);
    const text = await page.evaluate(() => document.body.innerText);
    const ok = text.includes('粗利益（参考試算・粗利率25%）');
    await page.getByRole('toolbar', { name: '草案の保存' }).getByRole('button', { name: '草案として保存' }).click();
    await sleep(2500);
    const saved = planEdits()['impact:grossMarginPct'] === 25;
    record('2', '財務前提（粗利率）を修正し、計画書を保存して参考試算に反映する', ok && saved ? 'PASS' : 'FAIL', ok && saved ? '粗利率 25%（利用者の修正、計画書に保存済み）→ 粗利益 15百万円' : '修正の反映または保存が確認できない（DB: ' + JSON.stringify(planEdits()) + '）');
  }

  /* 3. 財務効果の草案：売上（期間・区分・追加効果・営業利益増分9＝追加費用控除後） */
  const rev = card(REV);
  await fillCard(rev, { unit: 'ANNUAL', start: '2026-12', end: '2027-05' });
  await rev.getByLabel('売上増加（参考試算の売上）の売上の区分').selectOption('PAID_DEVELOPMENT');
  await rev.getByLabel('既存の売上に対する追加効果である').check();
  await rev.getByLabel('売上増加（参考試算の売上）の営業利益の増分').fill('9');
  await rev.getByLabel('売上増加（参考試算の売上）の営業利益増分と追加費用').selectOption('yes');
  await rev.getByRole('button', { name: '草案として保存' }).click();
  await rev.getByText('草案として保存しました。').waitFor({ timeout: 30000 });
  record('3', '売上の草案を保存（期間は計画期間に合わせて利用者が入力、区分は有償開発）', 'PASS', '2026-12〜2027-05、年額、営業利益増分9（追加費用控除後）');

  /* 4. 追加費用：単位・期間を利用者が入力して草案保存。営業利益増分が追加費用控除後のため、確認は保留される */
  const cost = card(COST);
  await fillCard(cost, { unit: 'ANNUAL', start: '2026-12', end: '2027-05' });
  await cost.getByRole('button', { name: '草案として保存' }).click();
  try { await cost.getByText('草案として保存しました。').waitFor({ timeout: 30000 }); } catch (e) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'cost-card.txt'), await cost.innerText()); throw e; }
  await sleep(400);
  {
    const confirmBtn = cost.getByRole('button', { name: 'この内容を財務効果として確認' });
    const disabled = await confirmBtn.isDisabled();
    const text = await cost.innerText();
    const ok = disabled && text.includes('別に確定しません');
    record('4', '追加費用は草案のみ保存され、営業利益増分が追加費用控除後のため確認しない（二重控除の防止）', ok ? 'PASS' : 'FAIL', ok ? '確認は保留（理由：売上増加の営業利益増分に追加費用が含まれている）' : '確認ボタンが押せてしまう');
  }

  /* 5. STAGE6：草案だけでは正式計画に入らない */
  const stage6Text = async () => {
    await page.goto(APP + '/stage6', { timeout: 180000 });
    await page.getByText('経営計画の実現見通し').first().waitFor({ timeout: 180000 });
    await sleep(1200);
    return page.evaluate(() => document.body.innerText);
  };
  {
    const text = await stage6Text();
    const start = text.indexOf('プロジェクト別の財務効果');
    const section = start >= 0 ? text.slice(start, start + 600) : '';
    const noEffect = /2027年度\s+0\.0\s+0\.0/.test(section) && /2028年度\s+0\.0\s+0\.0/.test(section);
    record('5', '未確認（草案）の財務効果は、STAGE6の正式な計画に入らない', noEffect ? 'PASS' : 'FAIL', noEffect ? 'FY2027・FY2028とも 0.0 / 0.0' : section.slice(0, 200));
  }

  /* 6. 売上の確認（保存済みの草案と同じ内容） */
  await openProject();
  {
    const rev2 = card(REV);
    await rev2.getByRole('button', { name: 'この内容を財務効果として確認' }).click();
    try { await rev2.getByText('確認しました。STAGE6の試算に反映されます。').waitFor({ timeout: 30000 }); } catch (e) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'rev-card-after-confirm.txt'), await rev2.innerText()); throw e; }
    record('6', '売上の財務効果を確認し、既存の保存処理（saveStrategyData）で保存する', 'PASS', '確認しました');
  }

  /* 7. 追加費用は確認できないまま（売上の確認後も保留） */
  {
    const cost2 = card(COST);
    const disabled = await cost2.getByRole('button', { name: 'この内容を財務効果として確認' }).isDisabled();
    record('7', '売上を「含む」で確認した後も、追加費用は確定せず、二重控除しない', disabled ? 'PASS' : 'FAIL', disabled ? '追加費用：草案のまま' : '追加費用が確認できてしまう');
  }

  /* 8. DB（保存後）と、STAGE3・他の案件の不変 */
  snap.after = dbRead();
  {
    const diff = stage3Diff(snap.before, snap.after);
    const { project: pAfter } = projectOf(snap.after);
    const fe = pAfter.financeEffect;
    const fes = pAfter.financeEffects || [];
    const ok = fe && fe.confirmed === true && fe.kind === 'REVENUE_UP' && diff.changed.length === 0 && diff.targetImpacts && pAfter.okrsV2?.length === p0.okrsV2?.length;
    record('8', '保存済みのfinanceEffectが実DBに残り、STAGE3のKPI・業績前提・他の案件は変わらない', ok ? 'PASS' : 'FAIL', `revision ${snap.before.revision}→${snap.after.revision}、変化した案件 ${diff.changed.length}件、project_target_impacts ${diff.targetImpacts ? '不変' : '変化'}`);
    snap.afterFinance = { primary: fe, additional: fes };
  }

  /* 9. 再読み込み後も、値と確認状態が残る */
  await openProject();
  {
    const text = await page.evaluate(() => document.body.innerText);
    const confirmedShown = text.includes('確認済み（STAGE6の試算に入ります）');
    const rv = card(REV);
    snap.reloadedRevenueInputs = { unit: await rv.locator('select').first().inputValue(), start: await rv.locator('input[type="month"]').nth(0).inputValue(), end: await rv.locator('input[type="month"]').nth(1).inputValue(), operatingIncomeMJPY: await rv.getByLabel('売上増加（参考試算の売上）の営業利益の増分').inputValue(), opIncomeIncludesAddCost: await rv.getByLabel('売上増加（参考試算の売上）の営業利益増分と追加費用').inputValue(), revenueKind: await rv.getByLabel('売上増加（参考試算の売上）の売上の区分').inputValue() };
    record('9', '再読み込み後も、売上の財務効果は確認済みのまま表示される', confirmedShown ? 'PASS' : 'FAIL', confirmedShown ? '確認済み（入力値: ' + JSON.stringify(snap.reloadedRevenueInputs) + '）' : '確認済みの表示がない');
  }

  /* 10. STAGE6の表示（経路B）と、保存データの照合 */
  {
    const text = await stage6Text();
    const start = text.indexOf('プロジェクト別の財務効果');
    const section = start >= 0 ? text.slice(start, start + 800) : '';
    const rowOf = (y) => {
      const m = section.match(new RegExp(`${y}年度\\s+([+−\\-]?[\\d.]+)\\s+([+−\\-]?[\\d.]+)`));
      return m ? { revenue: m[1], operatingIncome: m[2] } : null;
    };
    snap.stage6 = { 2026: rowOf(2026), 2027: rowOf(2027), 2028: rowOf(2028) };
    const uStart = text.indexOf('年度別の試算結果（計算内訳を表示）');
    snap.unifiedPl = text.slice(uStart, uStart + 1200).split('\n').filter((l) => /^(2027年度|2028年度|2029年度)/.test(l));
    fs.writeFileSync(path.join(outDir, 'stage6-text.txt'), text);
    const ok = snap.stage6[2027] && snap.stage6[2028] && snap.stage6[2027].revenue === '+20.0' && snap.stage6[2028].revenue === '+10.0' && snap.stage6[2027].operatingIncome === '+3.0' && snap.stage6[2028].operatingIncome === '+1.5';
    record('10', 'STAGE6の経路Bが、保存済みの財務効果を計画期間どおりの年度に配分して表示する', ok ? 'PASS' : 'FAIL', JSON.stringify(snap.stage6));
  }

  await ctx.close();
  await browser.close();

  const summary = { total: results.length, pass: results.filter((r) => r.status === 'PASS').length, fail: results.filter((r) => r.status === 'FAIL').length };
  fs.writeFileSync(path.join(outDir, 'real-supabase-finance.json'), JSON.stringify({ summary, results, snapshot: snap, pageErrors }, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.id}  ${r.name}  -- ${r.detail}`);
  if (pageErrors.length) console.log('pageerrors:', pageErrors.slice(0, 3));
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
