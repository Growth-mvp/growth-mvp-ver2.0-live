// strategy_data の DELETE 定義（supabase/pending/20261124_*）を、ローカルのPGlite上で検証する。
// 本番のDB・本番の接続設定には触れない。土台は本番の pg_policies（2026-11-24 読み取り専用で確認）と同じ定義を使う。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const applySql = fs.readFileSync(path.join(root, 'supabase/pending/20261124_strategy_data_delete_admin_only.sql'), 'utf8');
const rollbackSql = fs.readFileSync(path.join(root, 'supabase/pending/20261124_strategy_data_delete_admin_only_rollback.sql'), 'utf8');

const IDS = {
  companyA: '00000000-0000-4000-8000-00000000000a',
  companyB: '00000000-0000-4000-8000-00000000000b',
  strategyA: '00000000-0000-4000-8000-0000000000a1',
  strategyB: '00000000-0000-4000-8000-0000000000b1',
  admin: '00000000-0000-4000-8000-0000000000d1',
  manager: '00000000-0000-4000-8000-0000000000d2',
  member: '00000000-0000-4000-8000-0000000000d3',
  outsider: '00000000-0000-4000-8000-0000000000d4',
};

// 本番（2026-11-24 観測）の strategy_delete は role = 'admin'。旧版（schema_remote_20260708.sql）は所属者なら削除可。
const DELETE_PRODUCTION_OBSERVED = `
create policy strategy_delete on strategy_data for delete to authenticated using (
  exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id and m.role = 'admin'));`;
const DELETE_LEGACY = `
create policy strategy_delete on strategy_data for delete to authenticated using (
  exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id));`;

const base = (deletePolicy) => `
create role authenticated nologin;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;

create table company_members (
  company_id uuid not null,
  user_id uuid not null,
  role text not null,
  primary key (company_id, user_id)
);
create table strategy_data (
  id uuid primary key,
  company_id uuid not null,
  story text not null default '',
  updated_at timestamptz not null default now()
);
alter table company_members enable row level security;
alter table strategy_data enable row level security;
grant select, insert, update, delete on all tables in schema public to authenticated;

create policy members_select_self on company_members for select to authenticated using (user_id = auth.uid());
create policy strategy_select on strategy_data for select to authenticated using (
  exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id));
create policy strategy_insert on strategy_data for insert to authenticated with check (
  exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id));
create policy strategy_update on strategy_data for update to authenticated using (
  exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id))
  with check (exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id));
${deletePolicy}

insert into company_members values
  ('${IDS.companyA}', '${IDS.admin}', 'admin'),
  ('${IDS.companyA}', '${IDS.manager}', 'manager'),
  ('${IDS.companyA}', '${IDS.member}', 'member'),
  ('${IDS.companyB}', '${IDS.admin}', 'admin');
insert into strategy_data (id, company_id) values
  ('${IDS.strategyA}', '${IDS.companyA}'),
  ('${IDS.strategyB}', '${IDS.companyB}');
`;

async function run() {
  const results = [];
  const check = (name, actual, expected) => {
    results.push({ name, pass: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  };

  // 利用者の権限で1文を実行し、トランザクションは必ず巻き戻す（検証のデータは変えない）。
  const db = new PGlite();
  async function asUser(db, uid, sql) {
    await db.exec('BEGIN');
    try {
      await db.exec('SET LOCAL ROLE authenticated');
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid]);
      const r = await db.query(sql);
      return { ok: true, rows: r.rows.length };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      await db.exec('ROLLBACK');
    }
  }
  const delOwn = (s) => `delete from strategy_data where id = '${s}' returning id`;
  const updOwn = (s) => `update strategy_data set story = story where id = '${s}' returning id`;
  const insOwn = (c) => `insert into strategy_data (id, company_id) values (gen_random_uuid(), '${c}') returning id`;
  const deleteCount = async () => (await db.query("select count(*)::int as n from pg_policies where tablename = 'strategy_data' and cmd = 'DELETE'")).rows[0].n;
  const deleteQual = async () => (await db.query("select qual from pg_policies where tablename = 'strategy_data' and cmd = 'DELETE'")).rows[0].qual;

  // A) 本番の観測時点（管理者のみ）：SQLを適用しても定義は同じ。切り戻しも同じ定義に戻る。
  await db.exec(base(DELETE_PRODUCTION_OBSERVED));
  check('A 本番観測時点: 社員のDELETEは拒否（0行）', (await asUser(db, IDS.member, delOwn(IDS.strategyA))).rows, 0);
  check('A 本番観測時点: マネージャーのDELETEは拒否（0行）', (await asUser(db, IDS.manager, delOwn(IDS.strategyA))).rows, 0);
  check('A 本番観測時点: 管理者のDELETEは許可（1行）', (await asUser(db, IDS.admin, delOwn(IDS.strategyA))).rows, 1);
  const qualBefore = await deleteQual();
  await db.exec(applySql);
  check('A 適用後: DELETEポリシーは1件', await deleteCount(), 1);
  check('A 適用後: 定義は適用前と同じ（再定義のみ）', (await deleteQual()) === qualBefore, true);
  check('A 適用後: 社員のDELETEは拒否（0行）', (await asUser(db, IDS.member, delOwn(IDS.strategyA))).rows, 0);
  check('A 適用後: 管理者のDELETEは許可（1行）', (await asUser(db, IDS.admin, delOwn(IDS.strategyA))).rows, 1);
  check('A 適用後: 社員の自社UPDATE（保存）は従来どおり（1行）', (await asUser(db, IDS.member, updOwn(IDS.strategyA))).rows, 1);
  check('A 適用後: 社員の自社INSERT（新規）は従来どおり（1行）', (await asUser(db, IDS.member, insOwn(IDS.companyA))).rows, 1);
  check('A 適用後: 社員の他社UPDATEは拒否（0行）', (await asUser(db, IDS.member, updOwn(IDS.strategyB))).rows, 0);
  await db.exec(rollbackSql);
  check('A 切り戻し後: 管理者のみのまま（社員のDELETEは拒否）', (await asUser(db, IDS.member, delOwn(IDS.strategyA))).rows, 0);
  check('A 切り戻し後: DELETEポリシーは1件', await deleteCount(), 1);
  await db.close();

  // B) 旧版（所属者なら削除可）から移行する場合：SQLで社員のDELETEが閉じる。切り戻しは観測時点の定義に戻る。
  const db2 = new PGlite();
  await db2.exec(base(DELETE_LEGACY));
  const asUser2 = (uid, sql) => asUser(db2, uid, sql);
  check('B 旧版: 社員のDELETEは許可（1行）＝閉じる前の状態を再現', (await asUser2(IDS.member, delOwn(IDS.strategyA))).rows, 1);
  await db2.exec(applySql);
  check('B 適用後: 社員のDELETEは拒否（0行）', (await asUser2(IDS.member, delOwn(IDS.strategyA))).rows, 0);
  check('B 適用後: 管理者のDELETEは許可（1行）', (await asUser2(IDS.admin, delOwn(IDS.strategyA))).rows, 1);
  check('B 適用後: 所属のない利用者は削除不可（0行）', (await asUser2(IDS.outsider, delOwn(IDS.strategyA))).rows, 0);
  await db2.close();

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (expected ${JSON.stringify(r.expected)}, actual ${JSON.stringify(r.actual)})`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

run();
