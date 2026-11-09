/* 保留中のSQL（supabase/pending）を、ローカルDB（PGlite）で実際に動かして確かめる。
 * 本番DB・本番の接続設定・実OpenAI・マイグレーションには触れない。結果は表で出し、1つでも失敗すれば終了コード1。 */
import { createTestEnv, IDS, type TestEnv } from './testEnv';
import { PgliteGateway, type Db } from './pgliteGateway';
import {
  assignProjectIdentity,
  createPlan,
  loadPlan,
  readStrategyProjects,
  updatePlan,
  type ServiceContext,
} from '@/lib/stage4/plan/planService';

type Row = Record<string, unknown>;
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
}

/* 利用者の権限で SQL を実行する（RLS を効かせる）。失敗時はエラーコードを返す */
async function asUser(db: Db, userId: string, text: string, params: unknown[] = []): Promise<{ rows: Row[] } | { error: string; message: string }> {
  try {
    return await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await tx.exec('set local role authenticated');
      const { rows } = await tx.query<Row>(text, params);
      return { rows };
    });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { error: String(err.code ?? ''), message: String(err.message ?? '') };
  }
}

const ctxOf = (db: Db, userId: string): ServiceContext => ({ userId, gateway: new PgliteGateway(db, userId) });
const PLAN_KEY = { companyId: IDS.companyA, strategyId: IDS.strategyA, projectId: 'fict-proj-renewal' };

async function main() {
  const env: TestEnv = await createTestEnv();
  const db = env.db;

  /* 1. テーブルと一意制約 */
  const table = await env.sql("select to_regclass('public.stage4_plan_documents') is not null as ok");
  check('テーブルが作成される', table[0].ok === true);

  const first = await createPlan(ctxOf(db, IDS.alice), PLAN_KEY, { aiDraft: { note: 'AI草案' }, userEdits: { 'action:1:title': '初版' }, adopted: false });
  check('新規作成：社員が草案を作成できる（版1）', first.status === 'SAVED' && first.record.version === 1);
  const dup = await createPlan(ctxOf(db, IDS.alice), PLAN_KEY, { aiDraft: { note: 'AI草案' }, userEdits: {}, adopted: false });
  check('一意制約：同じ企業・戦略・プロジェクトの二重作成は競合として返す', dup.status === 'CONFLICT');
  const rawDup = await env.sql(
    "select count(*)::int as n from stage4_plan_documents where company_id = $1 and strategy_id = $2 and project_id = $3",
    [IDS.companyA, IDS.strategyA, PLAN_KEY.projectId]
  );
  check('一意制約：同じキーの行は1件だけ', rawDup[0].n === 1);

  /* 2. RLSによる企業間の分離 */
  const carolRead = await asUser(db, IDS.carol, 'select count(*)::int as n from stage4_plan_documents where company_id = $1', [IDS.companyA]);
  check('RLS：他社の社員は、他社の計画を1件も見られない', 'rows' in carolRead && carolRead.rows[0].n === 0);
  const carolLoad = await loadPlan(ctxOf(db, IDS.carol), PLAN_KEY);
  check('他社の計画へのアクセス：読み込みは拒否される（DENIED）', carolLoad.status === 'DENIED');
  const carolWrite = await createPlan(ctxOf(db, IDS.carol), PLAN_KEY, { aiDraft: {}, userEdits: {}, adopted: false });
  check('他社の計画へのアクセス：作成は拒否される（DENIED）', carolWrite.status === 'DENIED');
  const carolRaw = await asUser(db, IDS.carol, 'insert into stage4_plan_documents (company_id, strategy_id, project_id, ai_draft, created_by, updated_by) values ($1,$2,$3,$4::jsonb,$5,$5) returning id', [IDS.companyA, IDS.strategyA, 'fict-proj-renewal', '{}', IDS.carol]);
  check('RLS：他社の会社のIDで直接書き込むと、データベースが拒否する', 'error' in carolRaw && carolRaw.error === '42501', 'error' in carolRaw ? carolRaw.error : 'no error');

  /* 3. 社員による閲覧・更新 */
  const bobLoad = await loadPlan(ctxOf(db, IDS.bob), PLAN_KEY);
  check('社員による閲覧：同じ会社の別の社員が、草案を読める', bobLoad.status === 'FOUND' && bobLoad.record.version === 1);
  const bobUpdate = await updatePlan(ctxOf(db, IDS.bob), PLAN_KEY, 1, { userEdits: { 'action:1:title': 'bobの修正' }, adopted: false });
  check('社員による更新：別の社員が、版1から版2へ更新できる', bobUpdate.status === 'SAVED' && bobUpdate.record.version === 2);

  /* 4. 版番号による競合の検出 */
  const stale = await updatePlan(ctxOf(db, IDS.alice), PLAN_KEY, 1, { userEdits: { 'action:1:title': 'aliceの修正' }, adopted: false });
  check('競合：古い版番号での更新は競合として拒否し、最新の内容を返す', stale.status === 'CONFLICT' && stale.current.version === 2 && (stale.current.userEdits as Row)['action:1:title'] === 'bobの修正');
  const rawStale = await asUser(db, IDS.alice, 'update stage4_plan_documents set version = 3, updated_by = $4 where company_id=$1 and strategy_id=$2 and project_id=$3 and version = 1 returning id', [IDS.companyA, IDS.strategyA, PLAN_KEY.projectId, IDS.alice]);
  check('競合：データベース側でも、版番号が合わない更新は0件になる', 'rows' in rawStale && rawStale.rows.length === 0);

  /* 5. 不正な紐づけの拒否（トリガー） */
  const badProject = await asUser(db, IDS.alice, 'insert into stage4_plan_documents (company_id, strategy_id, project_id, ai_draft, created_by, updated_by) values ($1,$2,$3,$4::jsonb,$5,$5)', [IDS.companyA, IDS.strategyA, 'no-such-project', '{}', IDS.alice]);
  check('不正な紐づけ：戦略にないプロジェクトへの作成を拒否する', 'error' in badProject && badProject.error === '42501', 'error' in badProject ? badProject.error : 'no error');
  const crossCompany = await asUser(db, IDS.carol, 'insert into stage4_plan_documents (company_id, strategy_id, project_id, ai_draft, created_by, updated_by) values ($1,$2,$3,$4::jsonb,$5,$5)', [IDS.companyB, IDS.strategyA, 'fict-proj-renewal', '{}', IDS.carol]);
  check('不正な紐づけ：他社の戦略への紐づけを、トリガーが拒否する（所属の確認をすり抜けない）', 'error' in crossCompany && crossCompany.error === '42501', 'error' in crossCompany ? crossCompany.error : 'no error');

  /* 6. 更新の整合性（トリガー） */
  const changeDraft = await asUser(db, IDS.alice, "update stage4_plan_documents set ai_draft = '{\"x\":1}'::jsonb, updated_by = auth.uid() where project_id = 'fict-proj-renewal' returning id");
  check('整合性：AI草案は作成後に変えられない', 'error' in changeDraft && changeDraft.error === '42501', 'error' in changeDraft ? changeDraft.error : 'no error');
  const skipVersion = await asUser(db, IDS.alice, "update stage4_plan_documents set version = version + 2, updated_by = auth.uid() where project_id = 'fict-proj-renewal' returning id");
  check('整合性：版番号は1つずつしか進まない', 'error' in skipVersion && skipVersion.error === '40001', 'error' in skipVersion ? skipVersion.error : 'no error');

  /* 7. 削除の権限 */
  const memberDelete = await asUser(db, IDS.alice, 'delete from stage4_plan_documents where project_id = $1 returning id', ['fict-proj-renewal']);
  check('削除権限：member は削除できない（0件）', 'rows' in memberDelete && memberDelete.rows.length === 0);
  const managerDelete = await asUser(db, IDS.manager, 'delete from stage4_plan_documents where project_id = $1 returning id', ['fict-proj-renewal']);
  check('削除権限：manager は削除できる（1件）', 'rows' in managerDelete && managerDelete.rows.length === 1);

  /* 8. プロジェクトの番号の付与（IDのないプロジェクト） */
  const before = await env.strategyRow(IDS.strategyA);
  const depts = JSON.parse(JSON.stringify(before.departments)) as Array<{ projects: Array<Record<string, unknown>> }>;
  delete depts[1].projects[0].id;
  delete depts[0].projects[1].id;
  await env.setStrategyA(depts);
  const withoutId = await env.strategyRow(IDS.strategyA);
  const kpiOf = (d: unknown) => JSON.stringify((d as Array<{ projects: Array<{ okrsV2?: unknown }> }>).map((x) => x.projects.map((p) => p.okrsV2 ?? null)));
  const kpiBefore = kpiOf(withoutId.departments);

  const view = await readStrategyProjects(ctxOf(db, IDS.alice), IDS.companyA, IDS.strategyA);
  const target = view.status === 'FOUND' ? view.projects.find((p) => p.departmentIndex === 1 && p.projectIndex === 0) : undefined;
  check('番号付与：読み取りで、番号のないプロジェクトと戦略の版番号が見える', view.status === 'FOUND' && !!target && target.projectId === null);
  const newId = '00000000-0000-4000-8000-0000000001d1';
  const assigned = await assignProjectIdentity(ctxOf(db, IDS.alice), {
    companyId: IDS.companyA, strategyId: IDS.strategyA, departmentIndex: 1, projectIndex: 0,
    expectedTitle: '点検工程の標準化', expectedRevision: view.status === 'FOUND' ? view.revision : -1, newId,
  });
  check('番号付与：版番号が一致すれば、番号が付き、版番号は1だけ進む', assigned.status === 'ASSIGNED' && assigned.projectId === newId && assigned.revision === withoutId.revision + 1);

  const after = await env.strategyRow(IDS.strategyA);
  const expected = JSON.parse(JSON.stringify(withoutId.departments)) as Array<{ projects: Array<Record<string, unknown>> }>;
  expected[1].projects[0].id = newId;
  const canon = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.keys(val).sort().reduce<Record<string, unknown>>((o, kk) => ((o[kk] = (val as Record<string, unknown>)[kk]), o), {}) : val));
  check('番号付与：戦略の他の内容は変わらない（対象の番号の1項目だけが変わる）', canon(after.departments) === canon(expected));
  const kpiAfter = kpiOf(after.departments);
  check('番号付与：STAGE3のKPI（okrsV2）は変わらない', kpiBefore === kpiAfter);

  const again = await assignProjectIdentity(ctxOf(db, IDS.bob), {
    companyId: IDS.companyA, strategyId: IDS.strategyA, departmentIndex: 1, projectIndex: 0,
    expectedTitle: '点検工程の標準化', expectedRevision: after.revision, newId: '00000000-0000-4000-8000-0000000001d2',
  });
  check('番号付与：既に番号がある場合は、書き換えずにそのIDを返す（再読み込み後も同じ）', again.status === 'ASSIGNED' && again.alreadyAssigned === true && again.projectId === newId);
  const afterAgain = await env.strategyRow(IDS.strategyA);
  check('番号付与：既にある番号の再確認では、版番号は変わらない', afterAgain.revision === after.revision);

  const stalePatch = await assignProjectIdentity(ctxOf(db, IDS.bob), {
    companyId: IDS.companyA, strategyId: IDS.strategyA, departmentIndex: 0, projectIndex: 0,
    expectedTitle: '既存顧客の保守契約更新', expectedRevision: before.revision, newId: '00000000-0000-4000-8000-0000000001d3',
  });
  check('同時変更：古い版番号での付与は、REVISION_CHANGED として拒否する', stalePatch.status === 'REVISION_CHANGED');

  const wrongTitle = await assignProjectIdentity(ctxOf(db, IDS.alice), {
    companyId: IDS.companyA, strategyId: IDS.strategyA, departmentIndex: 0, projectIndex: 1,
    expectedTitle: '名前が違う案件', expectedRevision: afterAgain.revision, newId: '00000000-0000-4000-8000-0000000001d4',
  });
  check('番号付与：画面で見ていた名前と違う場合は付けない（TITLE_CHANGED）', wrongTitle.status === 'TITLE_CHANGED');

  const dupId = await assignProjectIdentity(ctxOf(db, IDS.alice), {
    companyId: IDS.companyA, strategyId: IDS.strategyA, departmentIndex: 0, projectIndex: 1,
    expectedTitle: '新規顧客開拓', expectedRevision: afterAgain.revision, newId: 'fict-proj-renewal',
  });
  check('番号付与：同じ番号が既に別のプロジェクトにある場合は付けない（ID_IN_USE）', dupId.status === 'ID_IN_USE');

  const outsider = await assignProjectIdentity(ctxOf(db, IDS.carol), {
    companyId: IDS.companyA, strategyId: IDS.strategyA, departmentIndex: 0, projectIndex: 1,
    expectedTitle: '新規顧客開拓', expectedRevision: afterAgain.revision, newId: '00000000-0000-4000-8000-0000000001d5',
  });
  check('番号付与：他社の社員は付けられない（DENIED）', outsider.status === 'DENIED');

  const directUpdate = await asUser(db, IDS.alice, "update strategy_data set departments = departments where id = $1 returning id", [IDS.strategyA]);
  check('戦略の一般の更新：member は戦略を直接書き換えられない（番号付与の関数を通す必要がある）', 'rows' in directUpdate && directUpdate.rows.length === 0);

  /* 9. 番号の付与の後の保存 */
  const newKey = { companyId: IDS.companyA, strategyId: IDS.strategyA, projectId: newId };
  const saved = await createPlan(ctxOf(db, IDS.alice), newKey, { aiDraft: { note: '番号付与の後の草案' }, userEdits: { 'action:1:title': '番号の後' }, adopted: false });
  check('番号付与の後：その番号で草案を保存できる（版1）', saved.status === 'SAVED' && saved.record.version === 1);
  const reloaded = await loadPlan(ctxOf(db, IDS.manager), newKey);
  check('再読み込み：番号の付いた草案を、別の社員（マネージャー）が読める', reloaded.status === 'FOUND');

  /* 10. 権限の付与：別の会社の番号の付与も拒否 */
  const crossAssign = await assignProjectIdentity(ctxOf(db, IDS.carol), {
    companyId: IDS.companyB, strategyId: IDS.strategyA, departmentIndex: 0, projectIndex: 0,
    expectedTitle: '既存顧客の保守契約更新', expectedRevision: 0, newId: '00000000-0000-4000-8000-0000000001d6',
  });
  check('番号付与：別の会社のIDを指定しても、戦略の所属が一致しないため付けない', crossAssign.status === 'NOT_FOUND');

  await env.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ total: results.length, pass: results.length - failed.length }));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
