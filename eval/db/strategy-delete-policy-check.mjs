// strategy_data の DELETE 制限（supabase/pending/20261124_*）を、ローカルのPGlite上で検証する。
// 本番のDB・本番の接続設定には触れない。土台は本番の定義（schema_remote_20260708.sql の strategy_* ポリシー）と同じ。
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

const base = `
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

-- 本番（schema_remote_20260708.sql）の company_members の参照ポリシー（所属判定に必要）
create policy members_select_self on company_members for select to authenticated using (user_id = auth.uid());

-- 本番（schema_remote_20260708.sql）の strategy_* ポリシー
create policy strategy_select on strategy_data for select to authenticated using (
  exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id));
create policy strategy_insert on strategy_data for insert to authenticated with check (
  exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id));
create policy strategy_update on strategy_data for update to authenticated using (
  exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id))
  with check (exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id));
create policy strategy_delete on strategy_data for delete to authenticated using (
  exists (select 1 from company_members m where m.user_id = auth.uid() and m.company_id = strategy_data.company_id));

insert into company_members values
  ('${IDS.companyA}', '${IDS.admin}', 'admin'),
  ('${IDS.companyA}', '${IDS.manager}', 'manager'),
  ('${IDS.companyA}', '${IDS.member}', 'member'),
  ('${IDS.companyB}', '${IDS.admin}', 'admin');
insert into strategy_data (id, company_id) values
  ('${IDS.strategyA}', '${IDS.companyA}'),
  ('${IDS.strategyB}', '${IDS.companyB}');
`;

const db = new PGlite();
await db.exec(base);

// 利用者の権限で1文を実行し、トランザクションは必ず巻き戻す（検証のデータは変えない）。
async function asUser(uid, sql) {
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

const delOwn = (strategy) => `delete from strategy_data where id = '${strategy}' returning id`;
const updOwn = (strategy) => `update strategy_data set story = story where id = '${strategy}' returning id`;
const insOwn = (company) => `insert into strategy_data (id, company_id) values (gen_random_uuid(), '${company}') returning id`;

const results = [];
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected });
};

// 1) 修正前：一般社員が自社の戦略を削除できる（問題の再現）
check('修正前: 社員の自社DELETE', (await asUser(IDS.member, delOwn(IDS.strategyA))).rows, 1);

// 2) 修正適用（既存のDELETEポリシーを置き換える）
await db.exec(applySql);
const deleteCount = await db.query("select count(*)::int as n from pg_policies where tablename = 'strategy_data' and cmd = 'DELETE'");
check('適用後: DELETEポリシーは1件だけ', deleteCount.rows[0].n, 1);

check('適用後: 社員のDELETEは拒否（0行）', (await asUser(IDS.member, delOwn(IDS.strategyA))).rows, 0);
check('適用後: マネージャーのDELETEは拒否（0行）', (await asUser(IDS.manager, delOwn(IDS.strategyA))).rows, 0);
check('適用後: 管理者のDELETEは許可（1行）', (await asUser(IDS.admin, delOwn(IDS.strategyA))).rows, 1);
check('適用後: 所属のない利用者は削除不可（0行）', (await asUser(IDS.outsider, delOwn(IDS.strategyA))).rows, 0);
check('適用後: 他社（B）の所属がないマネージャーは他社の行を削除できない（0行）', (await asUser(IDS.manager, delOwn(IDS.strategyB))).rows, 0);

// 3) 残存（方針どおり変えない）：社員の保存（UPDATE）・新規作成（INSERT）は従来どおり
check('適用後: 社員の自社UPDATE（保存）は従来どおり（1行）', (await asUser(IDS.member, updOwn(IDS.strategyA))).rows, 1);
check('適用後: 社員の自社INSERT（新規）は従来どおり（1行）', (await asUser(IDS.member, insOwn(IDS.companyA))).rows, 1);
check('適用後: 社員の他社UPDATEは拒否（0行）', (await asUser(IDS.member, updOwn(IDS.strategyB))).rows, 0);

// 4) 切り戻し
await db.exec(rollbackSql);
check('切り戻し後: 社員のDELETEが従来どおり戻る（1行）', (await asUser(IDS.member, delOwn(IDS.strategyA))).rows, 1);

await db.close();

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (expected ${JSON.stringify(r.expected)}, actual ${JSON.stringify(r.actual)})`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
