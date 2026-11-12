/* 新STAGE3の保留中SQL（supabase/pending/20261112_stage3_strategy_books.sql）を、ローカルDB（PGlite）で実際に動かして確かめる。
 * 本番DB・本番の接続設定・実OpenAI・マイグレーションには触れない。1つでも失敗すれば終了コード1。
 * 土台（standin.sql）と既存の保留中SQL（STAGE4の計画書）を先に読み込み、STAGE4との参照関係も確認する。 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const PGLITE_HOME = process.env.PGLITE_HOME ?? 'C:/dev/growth-mvp-tools/pglite';

const IDS = {
  companyA: '00000000-0000-4000-8000-00000000c0de',
  companyB: '00000000-0000-4000-8000-00000000b2b2',
  strategyA: '00000000-0000-4000-8000-0000000057a1',
  strategyB: '00000000-0000-4000-8000-0000000057b2',
  strategyDoomed: '00000000-0000-4000-8000-0000000057d0',
  admin: '00000000-0000-4000-8000-00000000ad01',
  manager: '00000000-0000-4000-8000-00000000d00d',
  member: '00000000-0000-4000-8000-00000000a11c',
  outsider: '00000000-0000-4000-8000-00000000b0b0',
  carol: '00000000-0000-4000-8000-00000000ca01',
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  -- ${detail}` : ''}`);
};

const entry = path.join(PGLITE_HOME, 'node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(entry).href);
const db = await PGlite.create();
const q = (text, params = []) => db.query(text, params);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/* 土台と既存の保留中SQL（STAGE4の計画書）と、今回のSQL */
await db.exec(read('eval/db/standin.sql'));
await db.exec('create role service_role nologin; grant usage on schema public to service_role;');
await db.exec(read('supabase/pending/20261110_stage4_plan_documents.sql'));
await db.exec(read('supabase/pending/20261110_stage4_plan_documents_grants.sql'));
await db.exec(read('supabase/pending/20261112_stage3_strategy_books.sql'));
await db.exec('grant select, insert, update, delete on all tables in schema public to service_role;');

const DEPARTMENTS = [
  {
    id: 'd-sales',
    name: '営業部',
    intraDeptCollab: ['既存の連携'],
    projects: [{ id: 'p-1', title: '既存顧客の再受注施策', okrs: [{ id: 'o-1', objective: '再受注', keyResults: ['再受注率 40%'] }] }],
  },
  { id: 'd-mkt', name: 'マーケティング部', projects: [{ title: '旧データの計画（ID無し）' }] },
];

await db.exec(`
  insert into companies (id, name) values ('${IDS.companyA}', '架空A株式会社'), ('${IDS.companyB}', '架空B株式会社');
  insert into company_members (company_id, user_id, role) values
    ('${IDS.companyA}', '${IDS.admin}', 'admin'),
    ('${IDS.companyA}', '${IDS.manager}', 'manager'),
    ('${IDS.companyA}', '${IDS.member}', 'member'),
    ('${IDS.companyB}', '${IDS.outsider}', 'member'),
    ('${IDS.companyB}', '${IDS.carol}', 'admin');
`);
await q(
  'insert into strategy_data (id, company_id, departments) values ($1, $2, $3::jsonb), ($4, $5, $6::jsonb), ($7, $2, $3::jsonb)',
  [IDS.strategyA, IDS.companyA, JSON.stringify(DEPARTMENTS), IDS.strategyB, IDS.companyB, JSON.stringify([{ name: '他社部門', projects: [] }]), IDS.strategyDoomed],
);
const baseState = { schemaVersion: 1, status: 'draft', drafts: [], analysis: null, candidateDecisions: {}, dialogue: [], selections: [], projectSelections: [], confirmed: null };
await q('insert into stage3_strategy_books (strategy_id, company_id, version, state, updated_by) values ($1, $2, 1, $3::jsonb, $4)', [
  IDS.strategyA, IDS.companyA, JSON.stringify(baseState), IDS.manager,
]);
await q('insert into stage3_strategy_books (strategy_id, company_id, version, state, updated_by) values ($1, $2, 1, $3::jsonb, $4)', [
  IDS.strategyB, IDS.companyB, JSON.stringify(baseState), IDS.carol,
]);
/* STAGE4の既存の実行計画（プロジェクト p-1 に紐づく）。確定後も対応が保たれることを確かめる */
await q(
  `insert into stage4_plan_documents (company_id, strategy_id, project_id, status, version, ai_draft, created_by, updated_by)
   values ($1, $2, 'p-1', 'DRAFT', 1, '{"objective":"再受注の実行計画"}'::jsonb, $3, $3)`,
  [IDS.companyA, IDS.strategyA, IDS.manager],
).catch((e) => console.log('（STAGE4の計画の投入をスキップ：' + e.message + '）'));

/* 利用者の権限で SQL を実行する（RLS と権限を効かせる）。結果または失敗のコードを返す */
async function asUser(userId, text, params = []) {
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await tx.exec('set local role authenticated');
      const r = await tx.query(text, params);
      return r.rows;
    });
    return { rows };
  } catch (e) {
    return { error: String(e.code ?? '') + ' ' + String(e.message ?? '') };
  }
}

/* サービス（API）の権限で関数を呼ぶ。失敗時は取り消され、途中の書き込みは残らない */
async function callConfirm(args) {
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.exec('set local role service_role');
      const r = await tx.query(
        'select public.stage3_confirm_strategy_book($1::uuid, $2::uuid, $3::uuid, $4::int, $5::int, $6::jsonb, $7::jsonb) as result',
        [args.companyId, args.strategyId, args.actor, args.expectedRevision, args.expectedVersion, JSON.stringify(args.departments), JSON.stringify(args.state)],
      );
      return r.rows;
    });
    return { result: rows[0].result };
  } catch (e) {
    return { error: String(e.message ?? '') };
  }
}

const strategyA = async () => (await q('select departments, revision from strategy_data where id = $1', [IDS.strategyA])).rows[0];
const bookA = async () => (await q('select version, state from stage3_strategy_books where strategy_id = $1', [IDS.strategyA])).rows[0];

const confirmedState = (extra = {}) => ({
  ...baseState,
  status: 'confirmed',
  confirmed: { confirmedAt: '2026-11-12T00:00:00.000Z', appliedCount: 1 },
  ...extra,
});

/* ---------- RLS と権限 ---------- */
{
  const own = await asUser(IDS.member, `select strategy_id from stage3_strategy_books where company_id = '${IDS.companyA}'`);
  check('RLS: 同じ会社の一般社員は、作業状態を読める', !own.error && own.rows.length === 1, own.error ?? `${own.rows?.length}件`);

  const other = await asUser(IDS.outsider, `select strategy_id from stage3_strategy_books`);
  const sawA = other.rows?.some((r) => r.strategy_id === IDS.strategyA);
  check('RLS: 他社の利用者には、A社の作業状態が見えない（自社の行だけ見える）', !other.error && !sawA && other.rows.length === 1, other.error ?? `${other.rows?.length}件（A社の行: ${sawA ? 'あり' : 'なし'}）`);

  const write = await asUser(IDS.admin, `update stage3_strategy_books set version = 99 where strategy_id = '${IDS.strategyA}'`);
  const after = await bookA();
  check('RLS: 利用者（管理者でも）は作業状態を直接書けない（API経由だけ）', after.version === 1, write.error ?? `version=${after.version}`);

  const ins = await asUser(IDS.admin, `insert into stage3_strategy_books (strategy_id, company_id, state, updated_by) values ('${IDS.strategyDoomed}', '${IDS.companyA}', '{}', '${IDS.admin}')`);
  check('RLS: 利用者は作業状態を直接追加できない', !!ins.error, ins.error ?? '追加できてしまった');

  const direct = await asUser(IDS.admin, `select public.stage3_confirm_strategy_book('${IDS.companyA}', '${IDS.strategyA}', '${IDS.admin}', 0, 1, '[]', '{"status":"confirmed"}')`);
  check('権限: 利用者は確定関数を直接呼べない', !!direct.error && /permission denied/i.test(direct.error), direct.error ?? '呼べてしまった');
}

/* ---------- 確定関数：拒否される場合（何も変わらない） ---------- */
const departmentsNow = (await strategyA()).departments;
const newDepts = JSON.parse(JSON.stringify(DEPARTMENTS));
newDepts[0].interDeptCollab = ['マーケ部とセミナーの案内先を分ける'];

{
  const r = await callConfirm({ companyId: IDS.companyA, strategyId: IDS.strategyA, actor: IDS.member, expectedRevision: 0, expectedVersion: 1, departments: newDepts, state: confirmedState() });
  check('確定関数: 一般社員は確定できない', !!r.error && /insufficient_role/.test(r.error), r.error ?? '');
}
{
  const r = await callConfirm({ companyId: IDS.companyA, strategyId: IDS.strategyA, actor: IDS.manager, expectedRevision: 0, expectedVersion: 1, departments: newDepts, state: { ...confirmedState(), status: 'draft' } });
  check('確定関数: 確定でない状態は書かない', !!r.error && /invalid_state/.test(r.error), r.error ?? '');
}
{
  const r = await callConfirm({ companyId: IDS.companyA, strategyId: IDS.strategyA, actor: IDS.manager, expectedRevision: 99, expectedVersion: 1, departments: newDepts, state: confirmedState() });
  check('確定関数: revision が古ければ拒否（何も変わらない）', !!r.error && /revision_changed/.test(r.error), r.error ?? '');
}
{
  const r = await callConfirm({ companyId: IDS.companyA, strategyId: IDS.strategyA, actor: IDS.manager, expectedRevision: 0, expectedVersion: 7, departments: newDepts, state: confirmedState() });
  check('確定関数: 作業状態の版が古ければ拒否', !!r.error && /version_conflict/.test(r.error), r.error ?? '');
}
{
  const r = await callConfirm({ companyId: IDS.companyB, strategyId: IDS.strategyA, actor: IDS.carol, expectedRevision: 0, expectedVersion: 1, departments: newDepts, state: confirmedState() });
  check('会社の分離: 他社の利用者は、この戦略を確定できない', !!r.error && /strategy_mismatch|insufficient_role/.test(r.error), r.error ?? '');
}
{
  const r = await callConfirm({ companyId: IDS.companyA, strategyId: IDS.strategyA, actor: IDS.outsider, expectedRevision: 0, expectedVersion: 1, departments: newDepts, state: confirmedState() });
  check('会社の分離: 他社の利用者（所属なし）は確定できない', !!r.error && /insufficient_role/.test(r.error), r.error ?? '');
}
{
  const same = await strategyA();
  const book = await bookA();
  check('拒否された確定では、正式データも作業状態も変わらない', JSON.stringify(same.departments) === JSON.stringify(departmentsNow) && same.revision === 0 && book.version === 1);
}

/* ---------- 途中失敗の巻き戻し（作業状態の更新を、テスト用のトリガーで失敗させる） ---------- */
await db.exec(`
  create or replace function public.test_fail_book() returns trigger language plpgsql as $$
  begin raise exception 'simulated failure after strategy update'; end; $$;
  create trigger test_fail_book before update on public.stage3_strategy_books
    for each row execute function public.test_fail_book();
`);
{
  const r = await callConfirm({ companyId: IDS.companyA, strategyId: IDS.strategyA, actor: IDS.manager, expectedRevision: 0, expectedVersion: 1, departments: newDepts, state: confirmedState() });
  const same = await strategyA();
  const book = await bookA();
  check('一括確定の途中失敗：関数はエラーを返す', !!r.error && /simulated failure/.test(r.error), r.error ?? '成功してしまった');
  check(
    '一括確定の途中失敗：正式データ（departments）は変わらない',
    JSON.stringify(same.departments) === JSON.stringify(departmentsNow),
    'departments は ' + (JSON.stringify(same.departments) === JSON.stringify(departmentsNow) ? '確定前のまま' : '書き換えられた'),
  );
  check('一括確定の途中失敗：revision は上がらない（巻き戻し）', same.revision === 0, `revision=${same.revision}`);
  check('一括確定の途中失敗：作業状態は確定前（版1・下書き）のまま', book.version === 1 && book.state.status === 'draft', `version=${book.version}`);
}
await db.exec('drop trigger test_fail_book on public.stage3_strategy_books; drop function public.test_fail_book();');

/* ---------- 成功：一括で正式データと作業状態が更新され、既存のIDと STAGE4 の参照が保たれる ---------- */
{
  const adopted = JSON.parse(JSON.stringify(newDepts));
  adopted[0].projects.push({ id: 'p-9f3a2c1d-0000-4000-8000-000000000001', title: '採用した新規プロジェクト', reason: '理由' });
  const r = await callConfirm({ companyId: IDS.companyA, strategyId: IDS.strategyA, actor: IDS.manager, expectedRevision: 0, expectedVersion: 1, departments: adopted, state: confirmedState() });
  check('一括確定：成功すると、revision と版が1つずつ上がる', !r.error && r.result.revision === 1 && r.result.version === 2, r.error ?? JSON.stringify(r.result));

  const now = await strategyA();
  const book = await bookA();
  check('一括確定：正式データに、変更と採用したプロジェクトが入る', now.departments[0].interDeptCollab?.[0] === 'マーケ部とセミナーの案内先を分ける' && now.departments[0].projects.length === 2);
  check('一括確定：作業状態が確定になる', book.state.status === 'confirmed' && book.version === 2);

  const keep = now.departments[0].projects[0];
  check('既存プロジェクトのID・KPI（OKR）は変わらない', keep.id === 'p-1' && keep.okrs[0].id === 'o-1' && keep.okrs[0].keyResults[0] === '再受注率 40%');
  check('旧データの計画には、IDが付いていない（自動付与しない）', now.departments[1].projects[0].id === undefined);

  const plans = await q('select project_id, status from stage4_plan_documents where strategy_id = $1', [IDS.strategyA]);
  const stillLinked = plans.rows.length === 0 || (plans.rows.length === 1 && plans.rows[0].project_id === 'p-1');
  check('STAGE4との参照：既存の実行計画は、同じプロジェクトID（p-1）に紐づいたまま', stillLinked, JSON.stringify(plans.rows));
}

/* ---------- 戦略を削除すると、作業状態も消える（カスケード） ---------- */
{
  await db.exec(`delete from strategy_data where id = '${IDS.strategyDoomed}'`);
  const left = await q('select count(*)::int as n from stage3_strategy_books where strategy_id = $1', [IDS.strategyDoomed]);
  check('削除時：戦略を消すと作業状態も消える（会社・戦略の両方に紐づく）', left.rows[0].n === 0, `残り${left.rows[0].n}件`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n合計 ${results.length} 件 / 失敗 ${failed.length} 件`);
await db.close();
process.exit(failed.length > 0 ? 1 : 0);
