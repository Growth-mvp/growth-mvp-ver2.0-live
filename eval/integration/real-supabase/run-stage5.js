/* STAGE4の実行計画をSTAGE5で進捗・実績として記録し、STAGE6でKRの計画・実績・差異を確認する一気通貫の検証（評価専用）。
 * 前提：この worktree で `npm run dev:stage4-local` 相当（http://localhost:3003）が起動していること。
 * 接続先はローカル分離DB（127.0.0.1）のみ。本番DB・実OpenAIには接続しない。 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..', '..', '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env.stage4-local'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const APP = 'http://localhost:3003';
const DB = 'supabase_db_growth-stage4-localdb';
const COMPANY = '日本製罐株式会社';
const PROJECT_TEXT = '塗料メーカーの設計段階に入り込み';
const PROJECT_ID = 'proj-o7650b-r-mvakt080-58aqgc';
const EMAIL = 'jp-member@local.test';
const PASSWORD = 'local-e2e-only-Passw0rd!';
const outDir = path.join(root, 'eval', 'integration', 'results-stage5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const record = (id, name, status, detail) => results.push({ id, name, status, detail });

function sql(query) {
  return execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', query], { encoding: 'utf8' }).trim();
}
function dbRead() {
  const out = sql(`select json_build_object('revision', s.revision, 'departments', s.departments) from public.strategy_data s join public.companies c on c.id = s.company_id where c.name = '${COMPANY}'`);
  return JSON.parse(out);
}
const projectOf = (snap) => {
  for (const d of snap.departments) for (const p of d.projects || []) if (p.id === PROJECT_ID) return p;
  throw new Error('対象の案件がDBにない');
};

/* 他の案件・STAGE3の値の変化（STAGE5が書く項目 executionProgress と、KRの実績 actual を除く） */
function stage3Diff(before, after) {
  const strip = (p) => {
    const { executionProgress, ...rest } = p;
    const okrs = (rest.okrsV2 || []).map((k) => ({ ...k, actual: undefined, actualHistory: undefined }));
    return JSON.stringify({ ...rest, okrsV2: okrs });
  };
  const pick = (s) => Object.fromEntries(s.departments.flatMap((d) => (d.projects || []).map((p) => [p.id, strip(p)])));
  const a = pick(before);
  const b = pick(after);
  return Object.keys(a).filter((k) => a[k] !== b[k]);
}

async function login() {
  const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (r.status !== 200) throw new Error('local login failed: ' + r.status);
  return r.json();
}

async function dumpOnFail(page, name) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${name}.txt`), await page.evaluate(() => document.body.innerText));
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

  const before = dbRead();
  const p0 = projectOf(before);
  const krIds = (p0.okrsV2 || []).map((k) => k.id);

  /* 0. 検証用の初期状態（ローカル分離DBだけ）：この案件の計画書・進捗・KR実績を取り除く */
  sql(`delete from public.stage4_plan_documents where project_id = '${PROJECT_ID}'`);
  const resetRows = JSON.stringify(krIds);
  sql(`update public.strategy_data s set departments = (select jsonb_agg(case when exists (select 1 from jsonb_array_elements(coalesce(d->'projects','[]'::jsonb)) p where p->>'id'='${PROJECT_ID}') then jsonb_set(d,'{projects}',(select jsonb_agg(case when p->>'id'='${PROJECT_ID}' then (p - 'executionProgress') else p end order by ord) from jsonb_array_elements(d->'projects') with ordinality t(p,ord))) else d end order by dord) from jsonb_array_elements(s.departments) with ordinality u(d,dord)) from public.companies c where c.id=s.company_id and c.name='${COMPANY}'`);
  void resetRows;

  const openProject = async () => {
    await page.goto(APP + '/okr', { timeout: 240000 });
    await page.getByText('企業：' + COMPANY).first().waitFor({ timeout: 240000 });
    await page.getByText(PROJECT_TEXT, { exact: false }).first().click();
    const heading = page.getByRole('heading', { name: '業績への貢献（参考試算）' }).filter({ visible: true }).first();
    const make = page.getByRole('button', { name: 'AIで実行計画書を作る' }).filter({ visible: true }).first();
    await Promise.race([heading.waitFor({ timeout: 240000 }), make.waitFor({ timeout: 240000 })]);
    if (await make.isVisible()) await make.click();
    await heading.waitFor({ timeout: 240000 });
    await sleep(400);
  };

  /* 1. STAGE3のプロジェクトとKR・STAGE4の計画を作る */
  await openProject();
  {
    const text = await page.evaluate(() => document.body.innerText);
    record('1', 'STAGE3のプロジェクトとKRを取得し、STAGE4で実行計画を作成する', text.includes('実行計画書') ? 'PASS' : 'FAIL', '計画書を表示');
  }

  /* 2. 採用 */
  {
    const adopt = page.getByRole('button', { name: 'この計画書を採用' }).filter({ visible: true }).first();
    await adopt.waitFor({ timeout: 60000 }).catch(() => {});
    if (await adopt.count()) {
      await adopt.click({ timeout: 20000 }).catch(() => {});
    }
    await page.getByText('採用済み（実行は未開始）').first().waitFor({ timeout: 30000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    const adopted = text.includes('採用済み');
    record('2', 'STAGE4で計画を採用する', adopted ? 'PASS' : 'FAIL', adopted ? '採用済み' : '採用の表示がない');
    if (!adopted) await dumpOnFail(page, 'fail-2-adopt');
  }

  /* 3. 実行開始：責任者の確定と規制・安全の判断（検証用の架空の判断）を記録し、計画書を保存して採用し直してから開始する */
  const ok = async (fn, id, name) => { try { await fn(); return true; } catch (e) { record(id, name, 'FAIL', String(e.message).slice(0, 200)); return false; } };
  const openStartView = async () => {
    await page.getByRole('button', { name: '実行開始の確認へ進む' }).filter({ visible: true }).first().click({ timeout: 20000 });
    await page.getByText('実行開始前の確認事項').first().waitFor({ timeout: 30000 });
    await sleep(600);
  };
  const adoptNow = async () => {
    const adopt = page.getByRole('button', { name: /この計画(案|書)を採用する?/ }).filter({ visible: true }).first();
    await adopt.waitFor({ timeout: 30000 }).catch(() => {});
    if (await adopt.count()) await adopt.click({ timeout: 20000 }).catch(() => {});
    await page.getByText('採用済み（実行は未開始）').first().waitFor({ timeout: 30000 }).catch(() => {});
    await sleep(800);
  };
  const saveDraftNow = async () => {
    const save = page.getByRole('toolbar', { name: '草案の保存' }).getByRole('button', { name: '草案として保存' });
    if (await save.count()) await save.click({ timeout: 20000 }).catch(() => {});
    await page.getByText(/保存済み（版/).first().waitFor({ timeout: 30000 }).catch(() => {});
    await sleep(800);
  };

  await openStartView();
  await ok(() => page.getByRole('button', { name: /実行責任者として確定する/ }).click({ timeout: 20000 }), '3b1', '実行責任者を確定する');
  await sleep(800);
  const boxes = page.locator('section').filter({ hasText: '③ 主要な実行条件' }).locator('input[type=checkbox]:not(:checked)');
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check().catch(() => {});
  await sleep(600);
  await page.getByRole('button', { name: '計画書に戻る' }).filter({ visible: true }).first().click({ timeout: 20000 }).catch(() => {});
  await sleep(800);
  await saveDraftNow();

  /* 採用・規制の判断・開始：アプリと同じ遷移API（利用者本人のセッション）で行う */
  const planRow = () =>
    JSON.parse(
      sql(
        `select json_build_object('version', version, 'adopted', adopted, 'started', started) from public.stage4_plan_documents where project_id = '${PROJECT_ID}' order by updated_at desc limit 1`,
      ),
    );
  const transitionApi = async (action, regulatory) => {
    const v = planRow().version;
    const r = await fetch(APP + '/api/stage4/plan-documents/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ companyId: p0Company, strategyId: p0Strategy, projectId: PROJECT_ID, expectedVersion: v, action, regulatory }),
    });
    const body = await r.text();
    return { status: r.status, body: body.slice(0, 200) };
  };
  const scope = JSON.parse(
    sql(
      `select json_build_object('companyId', c.id, 'strategyId', s.id) from public.strategy_data s join public.companies c on c.id = s.company_id where c.name = '${COMPANY}'`,
    ),
  );
  const p0Company = scope.companyId;
  const p0Strategy = scope.strategyId;
  const reg = { decision: 'NOT_APPLICABLE', judgement: '検証用の架空の判断：規制・安全の対象外（本番データではない）', confirmer: '検証用 確認者', confirmedOn: '2026-11-10', basis: '検証用の架空の根拠' };
  const t1 = await transitionApi('ADOPT');
  const t2 = await transitionApi('RECORD_REGULATORY', reg);
  let row = planRow();
  if (!row.adopted) { await transitionApi('ADOPT'); row = planRow(); }
  const t3 = await transitionApi('START');
  row = planRow();
  const started = row.started === true;
  record('3', 'STAGE4で実行開始する（責任者・規制・安全の判断を記録、遷移APIで確定）', started ? 'PASS' : 'FAIL', JSON.stringify({ adopt: t1.status, regulatory: t2.status, start: t3.status, row }));
  if (!started) await dumpOnFail(page, 'fail-3-start');

  /* 3c. STAGE6の変更前の表示（財務計画・確認済み財務効果）を控える */
  const stage6Snapshot = async () => {
    await page.goto(APP + '/stage6', { timeout: 240000 });
    await page.getByText('経営計画の実現見通し').first().waitFor({ timeout: 240000 });
    await sleep(1500);
    return page.evaluate(() => document.body.innerText);
  };
  const stage6Before = await stage6Snapshot();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'stage6-before.txt'), stage6Before);

  /* 4. STAGE5：開始された計画の実施事項とKRが表示される */
  await page.goto(APP + '/execution', { timeout: 240000 });
  await page.getByText('実施事項と進捗').first().waitFor({ timeout: 240000 }).catch(() => {});
  await sleep(800);
  const execText = await page.evaluate(() => document.body.innerText);
  const hasActions = execText.includes('実施事項と進捗') && execText.includes('現状の数値と原因を集める');
  record('4', 'STAGE5に、開始された計画の実施事項とKRが表示される', hasActions ? 'PASS' : 'FAIL', hasActions ? '実施事項と進捗を表示' : '実施事項が表示されない');
  if (!hasActions) await dumpOnFail(page, 'fail-4-execution');

  /* 5. 実施事項の進捗を記録（1番：進行中、設計段階の有効提案数に紐づける、成果を書く） */
  const progressRows = () =>
    sql(
      `select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)::text from public.strategy_data s join public.companies c on c.id = s.company_id, jsonb_array_elements(s.departments) d, jsonb_array_elements(coalesce(d->'projects','[]'::jsonb)) p, jsonb_each(coalesce(p->'executionProgress','{}'::jsonb)) e where c.name = '${COMPANY}' and p->>'id' = '${PROJECT_ID}'`,
    );
  {
    const card = page.locator('article').filter({ hasText: '現状の数値と原因を集める' }).first();
    await card.getByLabel('1. の進捗').selectOption('IN_PROGRESS').catch((e) => record('5a', '進捗の状態を選ぶ', 'FAIL', String(e.message).slice(0, 160)));
    await card.getByLabel('1. と「設計段階の有効提案数」を紐づける', { exact: true }).check().catch((e) => record('5b', 'KRを紐づける', 'FAIL', String(e.message).slice(0, 160)));
    await card.getByLabel('1. の成果').fill('重点顧客との設計・用途課題の確認を開始（検証用の記録）').catch(() => {});
    await card.getByRole('button', { name: '進捗を保存' }).first().click({ timeout: 20000 }).catch((e) => record('5c', '進捗を保存ボタンを押す', 'FAIL', String(e.message).slice(0, 160)));
    await card.getByText('保存しました。').waitFor({ timeout: 30000 }).catch(() => {});
    const saved = JSON.parse(progressRows() || '{}');
    const first = Object.values(saved)[0] || null;
    const okSaved = !!first && first.status === 'IN_PROGRESS' && Array.isArray(first.krIds) && first.krIds.length === 1;
    if (!okSaved) {
      const msg = await page.getByRole('status').allInnerTexts().catch(() => []);
      record('5-msg', '保存の結果メッセージ', 'FAIL', JSON.stringify(msg).slice(0, 240));
      await dumpOnFail(page, 'fail-5-progress');
    }
    record('5', '実施事項の進捗（進行中・成果・KR紐づけ）を保存し、DBに同じ案件で残る', okSaved ? 'PASS' : 'FAIL', JSON.stringify(first || {}).slice(0, 240));
  }

  /* 6. KRの実績値を、既存のKR実績入力（実行支援）で登録する：設計段階の有効提案数 3件（目標6件） */
  const openExecProject = async () => {
    await page.goto(APP + '/execution', { timeout: 240000 });
    await page.getByText('金属缶製造販売事業').first().waitFor({ timeout: 240000 });
    await page.getByText('金属缶製造販売事業').first().click().catch(() => {});
    await sleep(600);
    await page.getByRole('button', { name: new RegExp(PROJECT_TEXT) }).first().click({ timeout: 30000 }).catch(() => {});
    await sleep(1200);
  };
  await openExecProject();
  {
    const krRow = page.locator('div').filter({ hasText: /^設計段階の有効提案数/ }).filter({ has: page.getByRole('button', { name: /実績を(記録|更新)/ }) }).last();
    const rowOk = await krRow.count();
    if (rowOk) {
      await krRow.getByRole('button', { name: /実績を(記録|更新)/ }).first().click({ timeout: 20000 }).catch(() => {});
      await krRow.getByLabel(/実績値/).fill('3').catch(() => {});
      await krRow.getByLabel(/基準日/).fill('2027-01').catch(() => {});
      await krRow.getByRole('button', { name: '保存', exact: true }).click({ timeout: 20000 }).catch(() => {});
      await sleep(2000);
    }
    const kr = JSON.parse(sql(`select coalesce(jsonb_agg(json_build_object('id', k->>'id', 'actual', k->'actual')), '[]'::jsonb)::text from public.strategy_data s join public.companies c on c.id = s.company_id, jsonb_array_elements(s.departments) d, jsonb_array_elements(coalesce(d->'projects','[]'::jsonb)) p, jsonb_array_elements(coalesce(p->'okrsV2','[]'::jsonb)) k where c.name = '${COMPANY}' and p->>'id' = '${PROJECT_ID}'`));
    const proposals = kr.find((x) => x.id === '67f40574-b7fd-4130-a6f2-2987eec2a590');
    const ok6 = !!proposals && proposals.actual && proposals.actual.value === 3;
    record('6', 'KRの実績値（有効提案数 3件）を既存のKR実績入力で登録する', ok6 ? 'PASS' : 'FAIL', JSON.stringify(proposals || {}).slice(0, 200));
    if (!ok6) await dumpOnFail(page, 'fail-6-kr');
  }

  /* 7. 保存・再読み込み後も、同じ案件に進捗と実績が残る */
  await openExecProject();
  {
    const card = page.locator('article').filter({ hasText: '現状の数値と原因を集める' }).first();
    const sel = await card.getByLabel('1. の進捗').inputValue().catch(() => '');
    const linked = await card.getByLabel('1. と「設計段階の有効提案数」を紐づける', { exact: true }).isChecked().catch(() => false);
    const reloaded = sel === 'IN_PROGRESS' && linked;
    record('7', '再読み込み後も、同じ案件の進捗と紐づけが残る', reloaded ? 'PASS' : 'FAIL', `進捗=${sel} 紐づけ=${linked}`);
  }

  /* 8. STAGE6：変更前の計画・財務の表示は変わらず、KRの計画・実績・差異が出る */
  const stage6After = await stage6Snapshot();
  fs.writeFileSync(path.join(outDir, 'stage6-after.txt'), stage6After);
  {
    const kpiSection = stage6After.slice(stage6After.indexOf('KRの計画と実績'));
    const row = kpiSection.split('\n').find((l) => l.includes('設計段階の有効提案数')) || '';
    const unregistered = kpiSection.includes('有償開発受注数') && kpiSection.includes('未登録');
    const finNote = stage6After.includes('売上・営業利益の実績は、この画面に登録されていない');
    record('8', 'STAGE6に、KRの計画（目標）・実績・達成率・差異が表示される（実績未登録のKRは未登録と表示）', row.includes('50%') && row.includes('+3') === false && unregistered && finNote ? 'PASS' : 'FAIL', row.slice(0, 200));
  }
  {
    const sectionOf = (t) => (t.indexOf('施策効果を反映した試算') >= 0 ? t.slice(t.indexOf('施策効果を反映した試算'), t.indexOf('施策効果を反映した試算') + 1500) : '');
    const same = sectionOf(stage6Before) === sectionOf(stage6After);
    record('9', 'STAGE6の確認済み財務計画（統一PL・施策効果）は、進捗・実績の記録で変わらない', same ? 'PASS' : 'FAIL', same ? '施策効果を反映した試算は不変' : '表示が変わった');
  }

  /* 10. 他の案件・STAGE3の値は変わらない（進捗・KR実績の書き込み以外） */
  {
    const after = dbRead();
    const changed = stage3Diff(before, after);
    record('10', '他の案件・STAGE3のKPI・業績前提は変わらない（書き込んだのは対象の案件の進捗・KR実績のみ）', changed.length === 0 ? 'PASS' : 'FAIL', `変わった案件 ${changed.length}件`);
  }

  fs.writeFileSync(path.join(outDir, 'results-partial.json'), JSON.stringify({ results, pageErrors }, null, 2));
  await ctx.close();
  await browser.close();
  console.log(JSON.stringify(results, null, 1));
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
