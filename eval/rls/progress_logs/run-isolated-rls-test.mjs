// progress_logs の RLS・権限を、隔離した PostgreSQL（PGlite）に実際のポリシーを適用して検証する（評価専用）。
// 本番DBには接続しない。使い方: node eval/rls/progress_logs/run-isolated-rls-test.mjs
// フェーズ1: 現行ポリシー（修正前の再現）→ フェーズ2: 修正案 → フェーズ3: 修正案＋監査トリガー案
// フェーズ2・3はすべて期待どおりでなければ終了コード1になる。フェーズ1の不一致は脆弱性の再現として表示する。
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const BASE = fs.readFileSync(path.join(here, 'fixtures', 'base-schema.sql'), 'utf8');
const MIGRATION = path.join(repo, 'supabase', 'pending', '20261114_progress_logs_rls_authorization.sql');
const AUDIT = path.join(repo, 'supabase', 'pending', '20261114_progress_logs_audit_trigger.sql');
const LEGACY = path.join(here, 'fixtures', 'legacy-permissive-policy.sql');

const CO_X = '11111111-1111-4111-8111-111111111111';
const CO_Y = '22222222-2222-4222-8222-222222222222';
const ADM = '00000000-0000-4000-8000-0000000000a1'; // X社 admin
const MGR = '00000000-0000-4000-8000-0000000000a2'; // X社 manager
const A = '00000000-0000-4000-8000-0000000000a3'; // X社 member（社員A）
const B = '00000000-0000-4000-8000-0000000000a4'; // X社 member（社員B）
const YU = '00000000-0000-4000-8000-0000000000a5'; // Y社 member のみ
const OKR_X = '00000000-0000-4000-8000-0000000000b1';
const OKR_Y = '00000000-0000-4000-8000-0000000000b2';
const ROW_A = '00000000-0000-4000-8000-0000000000c1';
const ROW_B = '00000000-0000-4000-8000-0000000000c2';
const ROW_ADM_FB = '00000000-0000-4000-8000-0000000000c3';
const ROW_Y = '00000000-0000-4000-8000-0000000000c4';
const META = '__META__:{"companyId":"X","okrId":"b1"}';

const SEED = `
insert into auth.users(id) values ('${ADM}'),('${MGR}'),('${A}'),('${B}'),('${YU}');
insert into public.companies(id, name, created_by) values ('${CO_X}','X社','${ADM}'),('${CO_Y}','Y社','${YU}');
insert into public.company_members(company_id, user_id, role) values
  ('${CO_X}','${ADM}','admin'),('${CO_X}','${MGR}','manager'),('${CO_X}','${A}','member'),('${CO_X}','${B}','member'),('${CO_Y}','${YU}','member');
insert into public.okrs(id, company_id, project_id, objective) values
  ('${OKR_X}','${CO_X}','proj-x','既存顧客の保守契約更新'),('${OKR_Y}','${CO_Y}','proj-y','別社の案件');
insert into public.progress_logs(id, user_id, company_id, okr_id, content, created_at) values
  ('${ROW_A}','${A}','${CO_X}','${OKR_X}','Aの共有投稿', now() - interval '3 hours'),
  ('${ROW_B}','${B}','${CO_X}','${OKR_X}','Bの共有投稿', now() - interval '2 hours'),
  ('${ROW_ADM_FB}','${ADM}','${CO_X}','${OKR_X}','${META}
[FB]
Aさんへの見直し案', now() - interval '1 hour'),
  ('${ROW_Y}','${YU}','${CO_Y}','${OKR_Y}','Y社の共有投稿', now() - interval '30 minutes');
`;

async function freshDb(extraSqlFiles) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(SEED);
  for (const f of extraSqlFiles) await db.exec(fs.readFileSync(f, 'utf8'));
  return db;
}

// 実行者を切り替える。authenticated は auth.uid() を JWT の sub で再現する（Supabase と同じ仕組み）。
async function as(db, who) {
  if (who === 'superuser') return db.exec('reset role;');
  if (who === 'anon') return db.exec('reset role; set role anon;');
  if (who === 'service_role') return db.exec('reset role; set role service_role;');
  return db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${who}', false);`);
}

async function run(db, sql, params = []) {
  try {
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows ?? [], error: null };
  } catch (e) {
    return { ok: false, rows: [], error: `${e.code ?? ''} ${e.message}`.trim() };
  }
}

async function superRow(db, id) {
  await as(db, 'superuser');
  const r = await run(db, 'select content, user_id, company_id, okr_id, created_at from public.progress_logs where id = $1', [id]);
  return r.rows[0] ?? null;
}

// 各シナリオ：granted＝操作が実際に効いたか（書込は1行以上更新/作成/削除、読取は期待する行が見えたか）
const scenarios = [
  ['A-1', '社員A: 自分の記録を作成できる', 'allow', async (db, s) => {
    await as(db, A);
    const r = await run(db, `insert into public.progress_logs(user_id, company_id, okr_id, content) values ($1,$2,$3,'Aの新規投稿') returning id`, [A, CO_X, OKR_X]);
    s.newA = r.rows[0]?.id;
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['A-2', '社員A: 自分の記録を編集できる', 'allow', async (db, s) => {
    await as(db, A);
    const r = await run(db, `update public.progress_logs set content = 'Aの編集後' where id = $1 returning id`, [s.newA]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['A-3', '社員A: 自分の記録を削除できる', 'allow', async (db, s) => {
    await as(db, A);
    const r = await run(db, `delete from public.progress_logs where id = $1 returning id`, [s.newA]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['A-4', '社員A: 同じ会社の社員Bの記録を閲覧できる', 'allow', async (db) => {
    await as(db, A);
    const r = await run(db, `select id from public.progress_logs where id = $1`, [ROW_B]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['A-5', '社員A: 社員Bの記録を編集できない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `update public.progress_logs set content = 'Aが書換' where id = $1 returning id`, [ROW_B]);
    const now = await superRow(db, ROW_B);
    return { granted: (r.ok && r.rows.length > 0) || now.content === 'Aが書換', detail: r.error ?? `更新行数 ${r.rows.length}` };
  }],
  ['A-6', '社員A: 社員Bの記録を削除できない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `delete from public.progress_logs where id = $1 returning id`, [ROW_B]);
    const still = await superRow(db, ROW_B);
    return { granted: (r.ok && r.rows.length > 0) || !still, detail: r.error ?? `削除行数 ${r.rows.length}` };
  }],
  ['A-7', '社員A: 社員Bのuser_idを指定して投稿できない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `insert into public.progress_logs(user_id, company_id, okr_id, content) values ($1,$2,$3,'なりすまし') returning id`, [B, CO_X, OKR_X]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['A-8', '社員A: 自分の記録の投稿者を社員Bに付け替えられない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `update public.progress_logs set user_id = $2 where id = $1 returning id`, [ROW_A, B]);
    const now = await superRow(db, ROW_A);
    return { granted: (r.ok && r.rows.length > 0) || now.user_id === B, detail: r.error ?? `更新行数 ${r.rows.length}` };
  }],
  ['F-1', '管理者: 自分のフィードバックを作成できる', 'allow', async (db, s) => {
    await as(db, ADM);
    const r = await run(db, `insert into public.progress_logs(user_id, company_id, okr_id, content) values ($1,$2,$3,$4) returning id`, [ADM, CO_X, OKR_X, `${META}\n[FB]\n来週は対象を3件に絞りましょう`]);
    s.fb = r.rows[0]?.id;
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['F-2', '管理者: 自分のフィードバックを編集できる', 'allow', async (db, s) => {
    await as(db, ADM);
    const r = await run(db, `update public.progress_logs set content = '[FB]\nさらに修正' where id = $1 returning id`, [s.fb]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['F-3', '管理者: 自分のフィードバックを削除できる', 'allow', async (db, s) => {
    await as(db, ADM);
    const r = await run(db, `delete from public.progress_logs where id = $1 returning id`, [s.fb]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['F-4', 'マネージャー: フィードバックを作成できない', 'deny', async (db) => {
    await as(db, MGR);
    const r = await run(db, `insert into public.progress_logs(user_id, company_id, okr_id, content) values ($1,$2,$3,'[FB]\nマネージャーの指摘') returning id`, [MGR, CO_X, OKR_X]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['F-5', '社員A: フィードバックを作成できない（メタ情報付きでも）', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `insert into public.progress_logs(user_id, company_id, okr_id, content) values ($1,$2,$3,$4) returning id`, [A, CO_X, OKR_X, `${META}\n[FB]\n自作のフィードバック`]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['F-6', '社員A: 自分の共有記録をフィードバックに書き換えられない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `update public.progress_logs set content = '[FB]\n書換' where id = $1 returning id`, [ROW_A]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['F-7', '管理者: 社員Bの記録を編集できない', 'deny', async (db) => {
    await as(db, ADM);
    const r = await run(db, `update public.progress_logs set content = '管理者が書換' where id = $1 returning id`, [ROW_B]);
    return { granted: r.ok && r.rows.length > 0, detail: r.error ?? `更新行数 ${r.rows.length}` };
  }],
  ['F-8', 'マネージャー: 管理者のフィードバックを編集・削除できない', 'deny', async (db) => {
    await as(db, MGR);
    const u = await run(db, `update public.progress_logs set content = 'マネージャーが書換' where id = $1 returning id`, [ROW_ADM_FB]);
    const d = await run(db, `delete from public.progress_logs where id = $1 returning id`, [ROW_ADM_FB]);
    return { granted: (u.ok && u.rows.length > 0) || (d.ok && d.rows.length > 0), detail: u.error ?? d.error ?? `更新 ${u.rows.length} / 削除 ${d.rows.length}` };
  }],
  ['F-9', '社員A: 管理者のフィードバックを削除できない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `delete from public.progress_logs where id = $1 returning id`, [ROW_ADM_FB]);
    const still = await superRow(db, ROW_ADM_FB);
    return { granted: (r.ok && r.rows.length > 0) || !still, detail: r.error ?? `削除行数 ${r.rows.length}` };
  }],
  ['R-1', '社員A: 同じ会社の共有記録（全社共有の一覧）を読める', 'allow', async (db) => {
    await as(db, A);
    const r = await run(db, `select id, content, user_id from public.progress_logs where company_id = $1 and okr_id = $2 order by created_at desc limit 20`, [CO_X, OKR_X]);
    const ids = r.rows.map((x) => x.id);
    return { granted: r.ok && ids.includes(ROW_B) && ids.includes(ROW_ADM_FB), detail: r.error ?? `${r.rows.length}件` };
  }],
  ['R-2', 'Y社の社員: X社の記録を閲覧できない', 'deny', async (db) => {
    await as(db, YU);
    const r = await run(db, `select id from public.progress_logs where company_id = $1`, [CO_X]);
    return { granted: r.ok && r.rows.length > 0, detail: r.error ?? `${r.rows.length}件` };
  }],
  ['R-3', 'Y社の社員: X社の記録を編集・削除できない', 'deny', async (db) => {
    await as(db, YU);
    const u = await run(db, `update public.progress_logs set content = 'Y社が書換' where id = $1 returning id`, [ROW_A]);
    const d = await run(db, `delete from public.progress_logs where id = $1 returning id`, [ROW_A]);
    return { granted: (u.ok && u.rows.length > 0) || (d.ok && d.rows.length > 0), detail: u.error ?? d.error ?? `更新 ${u.rows.length} / 削除 ${d.rows.length}` };
  }],
  ['R-4', 'X社の社員: Y社の会社IDで記録を作成できない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `insert into public.progress_logs(user_id, company_id, okr_id, content) values ($1,$2,$3,'他社への投稿') returning id`, [A, CO_Y, OKR_Y]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['R-5', 'X社の社員: X社の記録に他社のOKRを紐づけて作成できない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `insert into public.progress_logs(user_id, company_id, okr_id, content) values ($1,$2,$3,'他社OKRへの投稿') returning id`, [A, CO_X, OKR_Y]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['R-6', 'X社の社員: 自分の記録を他社に移せない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `update public.progress_logs set company_id = $2 where id = $1 returning id`, [ROW_A, CO_Y]);
    const now = await superRow(db, ROW_A);
    return { granted: (r.ok && r.rows.length > 0) || now.company_id === CO_Y, detail: r.error ?? `更新行数 ${r.rows.length}` };
  }],
  ['R-7', '社員A: 紐づくOKRのない記録を作成できない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `insert into public.progress_logs(user_id, company_id, okr_id, content) values ($1,$2,null,'OKRなし') returning id`, [A, CO_X]);
    return { granted: r.ok && r.rows.length === 1, detail: r.error };
  }],
  ['R-8', '社員A: 記録の作成日時を書き換えられない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `update public.progress_logs set created_at = '2000-01-01T00:00:00Z' where id = $1 returning id`, [ROW_A]);
    const now = await superRow(db, ROW_A);
    return { granted: (r.ok && r.rows.length > 0) || String(now.created_at).startsWith('2000'), detail: r.error ?? `更新行数 ${r.rows.length}` };
  }],
  ['R-9', '社員A: 他社の記録と同じIDで作成して上書きできない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, `insert into public.progress_logs(id, user_id, company_id, okr_id, content) values ($1,$2,$3,$4,'上書き') returning id`, [ROW_Y, A, CO_X, OKR_X]);
    const now = await superRow(db, ROW_Y);
    return { granted: (r.ok && r.rows.length === 1) || now.content === '上書き', detail: r.error ?? '' };
  }],
  ['P-1', 'anon（未ログイン）: 権限判定関数を直接呼べない', 'deny', async (db) => {
    await as(db, 'anon');
    const r = await run(db, 'select rls_private.is_member($1)', [CO_X]);
    return { granted: r.ok, detail: r.error ?? '' };
  }],
  ['P-2', '社員A: 権限判定関数（rls_private）は呼べるが、public には関数を公開していない', 'deny', async (db) => {
    await as(db, A);
    const r = await run(db, "select 1 from information_schema.routines where routine_schema = 'public' and routine_name in ('is_member','is_admin','okr_in_company','is_feedback','progress_logs_guard_identity')");
    return { granted: r.ok && r.rows.length > 0, detail: r.error ?? '' };
  }],
  ['S-1', 'サービス経路（トップ画面の集計・AI相談）: 会社の記録を集計できる', 'allow', async (db) => {
    await as(db, 'service_role');
    const r = await run(db, `select count(*)::int as n from public.progress_logs where company_id = $1`, [CO_X]);
    return { granted: r.ok && r.rows[0].n >= 3, detail: r.error ?? `${r.rows[0]?.n}件` };
  }],
  ['S-2', '権限を失った管理者は、過去のフィードバックを編集できない', 'deny', async (db) => {
    await as(db, 'superuser');
    await run(db, `update public.company_members set role = 'member' where company_id = $1 and user_id = $2`, [CO_X, ADM]);
    await as(db, ADM);
    const r = await run(db, `update public.progress_logs set content = '権限喪失後の書換' where id = $1 returning id`, [ROW_ADM_FB]);
    return { granted: r.ok && r.rows.length > 0, detail: r.error ?? `更新行数 ${r.rows.length}` };
  }],
];

async function runScenarios(db) {
  const s = {};
  const out = [];
  for (const [id, name, expect, fn] of scenarios) {
    let res;
    try {
      res = await fn(db, s);
    } catch (e) {
      res = { granted: false, detail: `例外: ${e.message}` };
    }
    const pass = expect === 'allow' ? res.granted : !res.granted;
    out.push({ id, name, expect, granted: res.granted, pass, detail: res.detail ?? '' });
  }
  return out;
}

function printTable(title, rows) {
  console.log(`\n== ${title}`);
  for (const r of rows) {
    const verdict = r.pass ? 'OK  ' : 'NG  ';
    const want = r.expect === 'allow' ? '許可' : '拒否';
    const got = r.granted ? '実行された' : '拒否された';
    console.log(`${verdict} ${r.id.padEnd(4)} ${r.name}｜期待: ${want}／結果: ${got}${r.pass ? '' : `｜${r.detail}`}`);
  }
  const ng = rows.filter((r) => !r.pass).length;
  console.log(`-- ${rows.length - ng}/${rows.length} 一致${ng ? `（不一致 ${ng}件）` : ''}`);
  return ng;
}

async function auditChecks(db) {
  const out = [];
  const add = (id, name, pass, detail = '') => out.push({ id, name, expect: 'allow', granted: pass, pass, detail });
  await as(db, A);
  const u = await run(db, `update public.progress_logs set content = '監査: 編集後' where id = $1 returning id`, [ROW_A]);
  await as(db, ADM);
  const d = await run(db, `delete from public.progress_logs where id = $1 returning id`, [ROW_ADM_FB]);
  await as(db, 'superuser');
  const logs = await run(db, `select action, target_id, before, after from public.audit_logs order by created_at`);
  const upd = logs.rows.find((r) => r.action === 'PROGRESS_LOG_UPDATE' && r.target_id === ROW_A);
  const del = logs.rows.find((r) => r.action === 'PROGRESS_LOG_DELETE' && r.target_id === ROW_ADM_FB);
  add('M-1', '監査: 社員Aの編集が、編集前の本文つきで監査に残る', !!upd && upd.before?.content === 'Aの共有投稿' && upd.after?.content === '監査: 編集後', u.error ?? `更新行数 ${u.rows.length}`);
  add('M-2', '監査: 管理者の削除が、削除前の本文つきで監査に残る', !!del && String(del.before?.content).includes('Aさんへの見直し案'), d.error ?? `削除行数 ${d.rows.length}`);
  await as(db, A);
  const selfRead = await run(db, `select id from public.audit_logs`);
  add('M-3', '監査: 社員は監査記録を読めない', selfRead.ok && selfRead.rows.length === 0, selfRead.error ?? '');
  await as(db, ADM);
  const adminRead = await run(db, `select id from public.audit_logs where company_id = $1`, [CO_X]);
  add('M-4', '監査: 会社の管理者は自社の監査記録を読める', adminRead.ok && adminRead.rows.length >= 2, adminRead.error ?? `${adminRead.rows.length}件`);
  return out;
}

const phases = [
  { title: 'フェーズ1: 現行ポリシー（修正前。脆弱性の再現）', files: [], strict: false },
  { title: 'フェーズ2: 修正案（supabase/pending/20261114_progress_logs_rls_authorization.sql）', files: [MIGRATION], strict: true },
  { title: 'フェーズ3: 修正案＋監査トリガー案（20261114_progress_logs_audit_trigger.sql）', files: [MIGRATION, AUDIT], strict: true, audit: true },
];

let failed = 0;
for (const ph of phases) {
  const db = await freshDb(ph.files);
  const rows = await runScenarios(db);
  await db.close();
  if (ph.audit) {
    const adb = await freshDb(ph.files);
    rows.push(...(await auditChecks(adb)));
    await adb.close();
  }
  const ng = printTable(ph.title, rows);
  if (ph.strict) failed += ng;
}

// 前提：テスト環境の既存ポリシーの指紋が、本番の確認済みの値と一致する
{
  const db = await freshDb([]);
  const r = await db.query(`select md5(string_agg(concat_ws('|', policyname, permissive, cmd, array_to_string(roles, ','), coalesce(qual, ''), coalesce(with_check, '')), E'\\n' order by policyname)) as fp from pg_policies where tablename = 'progress_logs'`);
  await db.close();
  const fpOk = r.rows[0].fp === '14da1ff746e1ada87be5564254dd8f39';
  console.log('\n== 前提の確認');
  console.log(`${fpOk ? 'OK  ' : 'NG  '} FP-1 テスト環境の既存ポリシーの指紋が本番（2026-11-14 確認）と一致: ${fpOk}`);
  if (!fpOk) failed += 1;
}

// 未知の旧ポリシーがある環境では、修正案は何も変えずに中止する
{
  const db = await freshDb([LEGACY]);
  const before = await db.query(`select policyname, qual from pg_policies where tablename = 'progress_logs' order by policyname`);
  let aborted = false;
  try {
    await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  } catch {
    aborted = true;
    await db.exec('rollback;').catch(() => {});
  }
  const after = await db.query(`select policyname, qual from pg_policies where tablename = 'progress_logs' order by policyname`);
  const ns = await db.query(`select count(*)::int as n from pg_namespace where nspname = 'rls_private'`);
  await db.close();
  const unchanged = JSON.stringify(before.rows) === JSON.stringify(after.rows) && ns.rows[0].n === 0;
  const pass = aborted && unchanged;
  console.log('\n== 未知のポリシーがある環境（中止の確認）');
  console.log(`${pass ? 'OK  ' : 'NG  '} ABORT-1 修正案は中止し、既存ポリシーを変えない: 中止=${aborted}／変化なし=${unchanged}`);
  if (!pass) failed += 1;
}

console.log(failed === 0 ? '\n修正案のフェーズ（2・3）と前提・中止の確認はすべて期待どおりです。' : `\n修正案のフェーズで不一致 ${failed}件。`);
process.exit(failed === 0 ? 0 : 1);
