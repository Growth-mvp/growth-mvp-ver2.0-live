/* 保留中のSQL（supabase/pending）を、ローカルDB（PGlite）で実際に動かして確かめる。
 * 本番DB・本番の接続設定・実OpenAI・マイグレーションには触れない。結果は表で出し、1つでも失敗すれば終了コード1。 */
import { IDS, createTestEnv, mapStrategyRow, type TestEnv } from './testEnv';
import { PgliteGateway, type Db } from './pgliteGateway';
import { createMockModel } from '@/lib/stage4/plan/mockGenerate';
import { generatePlanDraft, type GenerateDeps } from '@/lib/stage4/plan/planGenerate';
import { assignProjectIdentity, loadPlan, readStrategyProjects, saveEdits, type ServiceContext } from '@/lib/stage4/plan/planService';
import { transitionPlan } from '@/lib/stage4/plan/planTransitions';
import { startedPlanView } from '@/lib/stage5/startedPlans';

type Row = Record<string, unknown>;
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const NOW = '2026-11-09T09:00:00.000Z';
const ALICE = IDS.alice;
const BOB = IDS.bob;
const CAROL = IDS.carol;
const MANAGER = IDS.manager;
const CO = IDS.companyA;
const ST = IDS.strategyA;
const RENEWAL = 'fict-proj-renewal';
const INSPECTION = 'fict-proj-inspection';
const PILOT = 'fict-proj-clinic-pilot';

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
}

/* 利用者の権限で SQL を実行する（RLS を効かせる）。失敗時はエラーコードを返す */
async function asUser(db: Db, userId: string, text: string, params: unknown[] = []): Promise<{ rows: Row[] } | { error: string }> {
  try {
    return await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await tx.exec('set local role authenticated');
      const { rows } = await tx.query<Row>(text, params);
      return { rows };
    });
  } catch (e) {
    return { error: String((e as { code?: string }).code ?? '') };
  }
}

const ctxOf = (db: Db, userId: string): ServiceContext => ({ userId, gateway: new PgliteGateway(db, userId) });
const KEY = (projectId: string) => ({ companyId: CO, strategyId: ST, projectId });

async function main() {
  const env: TestEnv = await createTestEnv();
  const db = env.db;
  const okrsOf = async () => {
    const rows = (await env.strategyRow(ST)).departments as Array<{ projects: Array<{ id?: string; okrsV2?: unknown }> }>;
    return JSON.stringify(rows.flatMap((d) => d.projects.map((p) => p.okrsV2 ?? null)));
  };
  const okrsBefore = await okrsOf();

  let modelCalls = 0;
  const genDeps: GenerateDeps = {
    now: () => NOW,
    currentYm: () => '2026-11',
    mapStrategy: mapStrategyRow,
    modelFor: async (raw) => {
      const mock = createMockModel(raw);
      return async (prompt) => {
        modelCalls += 1;
        return mock(prompt);
      };
    },
  };
  const gen = (userId: string, projectId: string) =>
    generatePlanDraft(ctxOf(db, userId), { companyId: CO, strategyId: ST, projectId, companyName: '架空' }, genDeps);
  const payloadsOf = async (action: string): Promise<Array<Record<string, any>>> =>
    (
      await env.sql(
        'select e.payload from stage4_plan_document_events e join stage4_plan_documents d on d.id = e.document_id where d.project_id = $1 and e.action = $2 order by e.created_at, e.id',
        [RENEWAL, action]
      )
    ).map((r) => r.payload as Record<string, any>);

  /* ---- 1. 表と制約 ---- */
  const tables = await env.sql(
    "select to_regclass('public.stage4_plan_documents') is not null as docs, to_regclass('public.stage4_plan_document_events') is not null as events"
  );
  check('表：草案の表と、操作履歴の表が作られる', tables[0].docs === true && tables[0].events === true);
  const badStatus = await env
    .sql("insert into stage4_plan_documents (company_id, strategy_id, project_id, status, created_by, updated_by) values ($1,$2,'fict-proj-renewal','BOGUS',$3,$3)", [CO, ST, ALICE])
    .then(
      () => 'accepted',
      (e) => String((e as { code?: string }).code ?? e)
    );
  check('制約：未知の状態は保存できない（23514）', badStatus === '23514', badStatus);

  /* ---- 2. AI生成（サーバーの経路）：二重生成の防止と、別のプロジェクトへの混入の防止 ---- */
  const first = await gen(ALICE, RENEWAL);
  check('生成：利用者がプロジェクトを選んで草案を作る（DRAFT・版1）', first.status === 'CREATED' && first.record.status === 'DRAFT' && first.record.version === 1, first.status);
  check('生成：草案にはAIの出力と計画の内容が入る', first.status === 'CREATED' && typeof first.record.aiDraft.rawOutput === 'string' && first.record.aiDraft.generatedBy === 'SERVER');
  check('生成：モデルの呼び出しは1回だけ', modelCalls === 1, `calls=${modelCalls}`);

  const again = await gen(ALICE, RENEWAL);
  check('二重生成：草案がある間は、同じプロジェクトを再生成しない（EXISTS）', again.status === 'EXISTS' && modelCalls === 1, `calls=${modelCalls}`);
  const otherMember = await gen(BOB, RENEWAL);
  check('二重生成：同じ会社の別の社員でも、再生成しない（既存の草案を返す）', otherMember.status === 'EXISTS' && modelCalls === 1);
  const denied = await gen(CAROL, RENEWAL);
  check('他社：別の会社の社員は、生成もできない（DENIED）・モデルを呼ばない', denied.status === 'DENIED' && modelCalls === 1);
  const missing = await gen(ALICE, 'no-such-project');
  check('照合：戦略にないプロジェクトは生成しない（NOT_FOUND）', missing.status === 'NOT_FOUND' && modelCalls === 1);
  const second = await gen(ALICE, INSPECTION);
  check('混入防止：別のプロジェクトは別の草案になり、最初の草案は変わらない', second.status === 'CREATED' && modelCalls === 2);
  const renewalRows = await env.sql('select project_id, version, status from stage4_plan_documents where company_id = $1 and strategy_id = $2 order by project_id', [CO, ST]);
  check('混入防止：草案の行はプロジェクトごとに1つずつ', renewalRows.length === 2 && renewalRows.every((r) => r.status === 'DRAFT' && r.version === 1), JSON.stringify(renewalRows));

  /* 生成中の状態：他の人が生成中なら、二重に呼ばない */
  const claimer = new PgliteGateway(db, ALICE);
  const claimed = await claimer.claimGeneration(KEY(PILOT), ALICE);
  check('生成の権利：最初の人が権利を取れる', claimed.ok && claimed.value.claimed === true);
  const inProgress = await gen(BOB, PILOT);
  check('二重生成：生成中の計画は、別の社員が開始しても、モデルを呼ばない（IN_PROGRESS）', inProgress.status === 'IN_PROGRESS' && modelCalls === 2);
  const midEdit = await saveEdits(ctxOf(db, BOB), KEY(PILOT), 1, { x: 'y' });
  check('生成中：生成中の計画は、修正の保存を受け付けない（NOT_READY）', midEdit.status === 'NOT_READY', midEdit.status);
  await claimer.failGeneration(KEY(PILOT), ALICE);
  const retried = await gen(BOB, PILOT);
  check('生成の再試行：失敗した生成は、もう一度作れる', retried.status === 'CREATED' && modelCalls === 3, retried.status);

  /* 生成の失敗：草案のある計画では、失敗の試行は起きない（利用者の修正を守る） */
  env.failNextModelCall();
  const noRetry = await gen(ALICE, PILOT);
  check('生成：草案がある計画は、再生成を試みない（EXISTS）', noRetry.status === 'EXISTS' && modelCalls === 3);

  /* ---- 3. 読み込み・修正の保存・版番号による競合 ---- */
  const loaded = await loadPlan(ctxOf(db, BOB), KEY(RENEWAL));
  check('読み込み：同じ会社の別の社員が、草案と操作の履歴を読める', loaded.status === 'FOUND' && loaded.record.events !== undefined && loaded.record.events.length >= 2);
  const saved = await saveEdits(ctxOf(db, BOB), KEY(RENEWAL), 1, { 'action:1:title': 'bobの修正：集め方を決める' });
  check('修正の保存：版1から版2へ（社員B）', saved.status === 'SAVED' && saved.record.version === 2, saved.status);
  const stale = await saveEdits(ctxOf(db, ALICE), KEY(RENEWAL), 1, { 'action:1:title': 'aliceの修正' });
  check('競合：古い版からの保存は CONFLICT（最新の内容を返す）', stale.status === 'CONFLICT' && stale.current.version === 2);
  const badDraft = await asUser(db, ALICE, "update stage4_plan_documents set ai_draft = '{\"x\":1}'::jsonb, updated_by = auth.uid() where project_id = $1", [RENEWAL]);
  check('AI草案：作った後は、利用者も変えられない（42501）', 'error' in badDraft && badDraft.error === '42501');
  const skip = await asUser(db, ALICE, 'update stage4_plan_documents set version = version + 2, updated_by = auth.uid() where project_id = $1', [RENEWAL]);
  check('版番号：1つずつしか進まない（40001）', 'error' in skip && skip.error === '40001');
  const reopen = await asUser(db, ALICE, "update stage4_plan_documents set status = 'GENERATING', updated_by = auth.uid() where project_id = $1", [RENEWAL]);
  check('状態：草案からは生成中に戻せない（42501）', 'error' in reopen && reopen.error === '42501');

  /* ---- 4. 採用：記録・同時変更・編集による解除 ---- */
  const adopt1 = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), 2, 'ADOPT', { now: NOW });
  check(
    '採用：利用者が草案を採用すると、採用者・日時・対象の版が残る',
    adopt1.status === 'OK' && adopt1.record.adoption?.byUserId === ALICE && adopt1.record.adoption?.version === 2,
    adopt1.status === 'BLOCKED' ? adopt1.blockers.join(' / ') : adopt1.status
  );
  const adopt2 = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), 3, 'ADOPT', { now: NOW });
  check('採用：既に採用済みなら、何も変えない（二重に採用しても記録は1つ）', adopt2.status === 'OK' && adopt2.record.adoption?.version === 2);
  const adoptEvents = await env.sql(
    "select e.action from stage4_plan_document_events e join stage4_plan_documents d on d.id = e.document_id where d.project_id = $1 and e.action = 'ADOPTED'",
    [RENEWAL]
  );
  check('操作履歴：採用が記録される（ADOPTED）', adoptEvents.length === 1);
  const adoptRow = await env.sql('select adopted, adoption from stage4_plan_documents where project_id = $1', [RENEWAL]);
  check('採用の状態：草案の行に採用の記録が残る', adoptRow[0].adopted === true && adoptRow[0].adoption !== null);
  check('採用は、AI提案KPIの確定ではない：STAGE3のKPI（okrsV2）は変わらない', (await okrsOf()) === okrsBefore);

  const bobEdit = await saveEdits(ctxOf(db, BOB), KEY(RENEWAL), 3, { 'action:1:title': 'bobの修正：採用後の変更' });
  check('採用後の変更：別の社員が採用後に修正すると、採用は自動で解除される', bobEdit.status === 'SAVED' && bobEdit.record.adoption === null && bobEdit.record.adopted === false, bobEdit.status);
  const resetEvents = await env.sql(
    "select e.action from stage4_plan_document_events e join stage4_plan_documents d on d.id = e.document_id where d.project_id = $1 and e.action = 'ADOPTION_RESET'",
    [RENEWAL]
  );
  check('操作履歴：採用の解除が記録される（ADOPTION_RESET）', resetEvents.length === 1);
  const staleAdopt = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), 2, 'ADOPT', { now: NOW });
  check('採用の競合：古い画面からの採用は CONFLICT（採用後に変わった内容は採用しない）', staleAdopt.status === 'CONFLICT' && staleAdopt.current.version === 4, staleAdopt.status);

  /* ---- 5. 実行条件・規制・開始 ---- */
  const reAdoptBefore = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), 4, 'ADOPT', { now: NOW });
  check('採用（再）：最新の版で採用し直せる', reAdoptBefore.status === 'OK' && reAdoptBefore.record.adoption?.version === 4, reAdoptBefore.status);
  const noStart = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), 5, 'START', { now: NOW });
  check(
    '開始：実行責任者と実行前の確認が未完了なら、開始できない（BLOCKED）',
    noStart.status === 'BLOCKED' && noStart.blockers.length > 0,
    noStart.status === 'BLOCKED' ? noStart.blockers.join(' / ') : noStart.status
  );
  const invalidReg = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), 5, 'RECORD_REGULATORY', {
    regulatory: { decision: 'NOT_APPLICABLE', judgement: '', basis: '', confirmer: '', confirmedOn: '' },
    now: NOW,
  });
  check('規制・安全：判断・根拠・確認者・確認日がなければ記録できない（INVALID）', invalidReg.status === 'INVALID');
  const uncertain = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), 5, 'RECORD_REGULATORY', {
    regulatory: { decision: 'UNCONFIRMED', judgement: '', basis: '', confirmer: '', confirmedOn: '' },
    now: NOW,
  });
  check('規制・安全：未確認のままでも記録できるが、開始はできない', uncertain.status === 'OK');
  const confirmedReg = {
    decision: 'NOT_APPLICABLE',
    judgement: '医療機器の製造販売には当たらず、既存の運用の範囲で足りる',
    basis: '社内の薬機法の該当性チェック表（2026年11月）',
    confirmer: '法務 山田',
    confirmedOn: '2026-11-08',
  };
  const regVersion = uncertain.status === 'OK' ? uncertain.record.version : 5;
  const reg = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), regVersion, 'RECORD_REGULATORY', { regulatory: confirmedReg, now: NOW });
  check('規制・安全：判断・根拠・確認者・確認日を記録する', reg.status === 'OK' && reg.record.regulatory?.confirmer === '法務 山田', reg.status);

  const withResponsible = await saveEdits(ctxOf(db, ALICE), KEY(RENEWAL), reg.status === 'OK' ? reg.record.version : 6, {
    'action:1:title': 'bobの修正：採用後の変更',
    responsible: '鈴木一郎（仮）',
    'task:verify-1': true,
  });
  check('実行条件：実行責任者と実行前の確認を、利用者の編集として保存する', withResponsible.status === 'SAVED', withResponsible.status);
  const regAfterEdit = await env.sql('select regulatory from stage4_plan_documents where project_id = $1', [RENEWAL]);
  check('規制・安全：編集すると判断の記録は解除され、修正版として改めて記録が必要になる', Object.keys(regAfterEdit[0].regulatory as object).length === 0);
  const reRecord = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), withResponsible.status === 'SAVED' ? withResponsible.record.version : 0, 'RECORD_REGULATORY', {
    regulatory: confirmedReg,
    now: NOW,
  });
  check('規制・安全：修正版の判断を改めて記録する', reRecord.status === 'OK', reRecord.status);
  const reAdopt = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), reRecord.status === 'OK' ? reRecord.record.version : 0, 'ADOPT', { now: NOW });
  check('採用（条件の後）：条件を満たした版を採用する', reAdopt.status === 'OK', reAdopt.status === 'BLOCKED' ? reAdopt.blockers.join(' / ') : reAdopt.status);
  const startVersion = reAdopt.status === 'OK' ? reAdopt.record.version : 0;
  const started = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), startVersion, 'START', { now: NOW });
  check(
    '実行開始：採用済み・条件確認済み・規制の記録ありで開始できる（開始者・日時・版が残る）',
    started.status === 'OK' && started.record.startInfo?.byUserId === ALICE && started.record.startInfo?.version === startVersion,
    started.status === 'BLOCKED' ? started.blockers.join(' / ') : started.status
  );
  const startEvents = await env.sql(
    "select e.action from stage4_plan_document_events e join stage4_plan_documents d on d.id = e.document_id where d.project_id = $1 and e.action = 'STARTED'",
    [RENEWAL]
  );
  check('操作履歴：開始が記録される（STARTED）', startEvents.length === 1);

  const unadopt = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), started.status === 'OK' ? started.record.version : 0, 'UNADOPT', { now: NOW });
  check('採用の取り消し：採用と開始は解除される（記録は履歴に残す）', unadopt.status === 'OK' && unadopt.record.adoption === null && unadopt.record.startInfo === null, unadopt.status);
  const readopt = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), unadopt.status === 'OK' ? unadopt.record.version : 0, 'ADOPT', { now: NOW });
  check('採用し直し：取り消した後も、同じ内容を採用し直せる', readopt.status === 'OK', readopt.status);
  const restarted = await transitionPlan(ctxOf(db, ALICE), KEY(RENEWAL), readopt.status === 'OK' ? readopt.record.version : 0, 'START', { now: NOW });
  check('再開始：採用し直した版を、規制の判断つきで開始する', restarted.status === 'OK', restarted.status === 'BLOCKED' ? restarted.blockers.join(' / ') : restarted.status);

  /* ---- 5a. STAGE5 からの読み取り（実行開始済みの計画だけ、プロジェクトIDで照合・読み取りのみ） ---- */
  const s5Strategy = await env.strategyRow(ST);
  const s5Depts = s5Strategy.departments as Array<{ name: string; projects: Array<{ id?: string; title: string }> }>;
  const s5Project = s5Depts.flatMap((d) => d.projects.map((p) => ({ dept: d.name, p }))).find((x) => x.p.id === RENEWAL);
  const s5Before = await loadPlan(ctxOf(db, ALICE), KEY(RENEWAL));
  const s5Rows = await env.sql('select count(*)::int as n from stage4_plan_document_events');
  const s5View =
    s5Before.status === 'FOUND' && s5Project
      ? startedPlanView({ expected: KEY(RENEWAL), departmentName: s5Project.dept, projectTitle: s5Project.p.title, record: s5Before.record })
      : null;
  check(
    'STAGE5参照：実行開始した計画を、プロジェクトIDで対応づけて読み取れる（目的・実施事項・KPIあり）',
    restarted.status === 'OK' &&
      s5View !== null &&
      s5View.actions.length > 0 &&
      s5View.kpis.length > 0 &&
      s5View.startedVersion === restarted.record.startInfo?.version,
    s5View ? `actions=${s5View.actions.length}` : 'null'
  );
  check(
    'STAGE5参照：別のプロジェクト（同じ記録を渡しても）には表示されない',
    s5Before.status === 'FOUND' && startedPlanView({ expected: KEY(INSPECTION), departmentName: '', projectTitle: '', record: s5Before.record }) === null
  );
  check('STAGE5参照：他社の社員には計画が読めない（DENIED）', (await loadPlan(ctxOf(db, CAROL), KEY(RENEWAL))).status === 'DENIED');
  const s5After = await loadPlan(ctxOf(db, ALICE), KEY(RENEWAL));
  const s5RowsAfter = await env.sql('select count(*)::int as n from stage4_plan_document_events');
  check(
    'STAGE5参照：読み取りで計画の版・履歴は変わらない（書き込みなし）',
    s5After.status === 'FOUND' && s5Before.status === 'FOUND' && s5After.record.version === s5Before.record.version && s5Rows[0].n === s5RowsAfter[0].n
  );

  const bobAfterStart = await saveEdits(ctxOf(db, BOB), KEY(RENEWAL), restarted.status === 'OK' ? restarted.record.version : 0, { 'action:1:title': '開始後の変更' });
  check('開始後の変更：修正すると、採用と開始は解除される', bobAfterStart.status === 'SAVED' && bobAfterStart.record.startInfo === null && bobAfterStart.record.adoption === null);
  const startResetEvents = await env.sql(
    "select e.action from stage4_plan_document_events e join stage4_plan_documents d on d.id = e.document_id where d.project_id = $1 and e.action = 'START_RESET'",
    [RENEWAL]
  );
  check('操作履歴：開始の解除が記録される（START_RESET）', startResetEvents.length === 1);

  /* ---- 5b. 履歴：解除・取り消しの前の記録が残る（消えない） ---- */
  const adoptedLog = await payloadsOf('ADOPTED');
  check(
    '採用の履歴：採用のたびに、採用版・採用者・採用時の内容が残る（4回）',
    adoptedLog.length === 4 && adoptedLog[0].adoptedVersion === 2 && adoptedLog[0].by === ALICE && adoptedLog[3].edits?.responsible === '鈴木一郎（仮）',
    adoptedLog.map((p) => p.adoptedVersion).join(',')
  );
  const adoptionResets = await payloadsOf('ADOPTION_RESET');
  check(
    '解除の履歴：編集で解除された採用は、採用者・日時・版・採用時の内容つきで残る',
    adoptionResets.map((p) => p.adoption?.version).join(',') === '2,4,12' &&
      adoptionResets[0].adoption?.by === ALICE &&
      typeof adoptionResets[0].adoption?.at === 'string' &&
      adoptionResets[0].adoption?.edits !== undefined,
    adoptionResets.map((p) => p.adoption?.version).join(',')
  );
  const adoptionCancelled = await payloadsOf('ADOPTION_CANCELLED');
  check(
    '取り消しの履歴：採用の取り消しで、取り消された採用者・版・内容が残る',
    adoptionCancelled.length === 1 && adoptionCancelled[0].adoption?.by === ALICE && adoptionCancelled[0].adoption?.version === 9 && adoptionCancelled[0].adoption?.edits?.responsible === '鈴木一郎（仮）'
  );
  const startedLog = await payloadsOf('STARTED');
  check(
    '開始の履歴：開始のたびに、開始版・開始者が残る（2回）',
    startedLog.map((p) => p.startedVersion).join(',') === '10,13' && startedLog[0].by === ALICE,
    startedLog.map((p) => p.startedVersion).join(',')
  );
  const startCancelled = await payloadsOf('START_CANCELLED');
  check(
    '取り消しの履歴：開始の取り消しで、開始者・日時・版が残る',
    startCancelled.length === 1 && startCancelled[0].start?.by === ALICE && startCancelled[0].start?.version === 10 && typeof startCancelled[0].start?.at === 'string'
  );
  const startResets = await payloadsOf('START_RESET');
  check('開始の履歴：編集で解除された開始も、開始者・版が残る', startResets.length === 1 && startResets[0].start?.by === ALICE && startResets[0].start?.version === 13);
  const regulatoryResets = await payloadsOf('REGULATORY_RESET');
  check(
    '規制の履歴：編集で解除された判断は、確認者・確認日つきで残る',
    regulatoryResets.length === 2 && regulatoryResets[0].regulatory?.confirmer === '法務 山田' && regulatoryResets[0].regulatory?.confirmedOn === '2026-11-08'
  );

  /* ---- 6. 権限・追記専用の履歴・他社 ---- */
  const carolLoad = await loadPlan(ctxOf(db, CAROL), KEY(RENEWAL));
  check('他社：別の会社の社員は、草案を読めない（DENIED）', carolLoad.status === 'DENIED');
  const carolAdopt = await transitionPlan(ctxOf(db, CAROL), KEY(RENEWAL), 6, 'ADOPT', { now: NOW });
  check('他社：別の会社の社員は、採用できない（DENIED）', carolAdopt.status === 'DENIED');
  const carolEvents = await asUser(db, CAROL, 'select id from stage4_plan_document_events where company_id = $1', [CO]);
  check('他社：別の会社の社員は、操作の履歴を1件も読めない', 'rows' in carolEvents && carolEvents.rows.length === 0);
  const eventUpdate = await asUser(db, ALICE, "update stage4_plan_document_events set action = 'SAVED' returning id");
  check('履歴の改ざん：利用者は操作の履歴を書き換えられない（0件）', 'rows' in eventUpdate && eventUpdate.rows.length === 0);
  const eventDelete = await asUser(db, MANAGER, 'delete from stage4_plan_document_events returning id');
  check('履歴の削除：管理者でも履歴を削除できない（0件）', 'rows' in eventDelete && eventDelete.rows.length === 0);
  const memberDelete = await asUser(db, ALICE, 'delete from stage4_plan_documents where project_id = $1 returning id', [RENEWAL]);
  check('削除権限：member は草案を削除できない（0件）', 'rows' in memberDelete && memberDelete.rows.length === 0);
  const crossRow = await asUser(
    db,
    CAROL,
    "insert into stage4_plan_documents (company_id, strategy_id, project_id, status, ai_draft, created_by, updated_by) values ($1,$2,$3,'GENERATING','{}'::jsonb,$4,$4)",
    [IDS.companyB, ST, RENEWAL, CAROL]
  );
  check('他社の紐づけ：別の会社の戦略への生成の行は作れない（42501）', 'error' in crossRow && crossRow.error === '42501');

  /* ---- 7. 生成の履歴 ---- */
  const hist = await env.sql(
    "select e.action from stage4_plan_document_events e join stage4_plan_documents d on d.id = e.document_id where d.project_id = $1 order by e.created_at, e.id",
    [PILOT]
  );
  const actions = hist.map((h) => h.action as string);
  check(
    '操作履歴：生成の開始・失敗・再試行・完了が残る',
    actions.includes('GENERATION_STARTED') && actions.includes('GENERATION_FAILED') && actions.includes('GENERATION_RETRIED') && actions.includes('GENERATED'),
    actions.join(' → ')
  );

  /* ---- 8. 番号付与：旧い保存経路が番号を消さないか（モック） ---- */
  const before = await env.strategyRow(ST);
  const depts = JSON.parse(JSON.stringify(before.departments)) as Array<{ projects: Array<Record<string, unknown>> }>;
  delete depts[1].projects[0].id;
  await env.setStrategyA(depts);
  const withoutId = await env.strategyRow(ST);
  const view = await readStrategyProjects(ctxOf(db, ALICE), CO, ST);
  const idNew = '00000000-0000-4000-8000-0000000001e1';
  const assigned = await assignProjectIdentity(ctxOf(db, ALICE), {
    companyId: CO,
    strategyId: ST,
    departmentIndex: 1,
    projectIndex: 0,
    expectedTitle: '点検工程の標準化',
    expectedRevision: view.status === 'FOUND' ? view.revision : -1,
    newId: idNew,
  });
  check('番号付与：IDのないプロジェクトに番号を付ける', assigned.status === 'ASSIGNED' && assigned.projectId === idNew);
  const afterAssign = await env.strategyRow(ST);
  const legacy = await env.sql('update strategy_data set departments = $2::jsonb where id = $1 and revision = $3 returning id', [
    ST,
    JSON.stringify(withoutId.departments),
    withoutId.revision,
  ]);
  check('旧い保存経路：番号の付与より前の版で、番号のない内容を書き戻すと拒否される（版番号が合わない）', legacy.length === 0);
  const afterLegacy = await env.strategyRow(ST);
  const keptId = (afterLegacy.departments as Array<{ projects: Array<{ id?: string }> }>)[1].projects[0].id;
  check('旧い保存経路：番号は消えない', keptId === idNew && afterLegacy.revision === afterAssign.revision);
  const idPlan = await gen(ALICE, idNew);
  check('番号の後：その番号のプロジェクトは、生成の照合で見つかる（NOT_FOUND ではない）', idPlan.status !== 'NOT_FOUND', idPlan.status);

  const sameRecord = (a: Awaited<ReturnType<typeof loadPlan>>, b: Awaited<ReturnType<typeof loadPlan>>) =>
    a.status === 'FOUND' && b.status === 'FOUND' && a.record.version === b.record.version && JSON.stringify(a.record.aiDraft) === JSON.stringify(b.record.aiDraft);
  const renewalBefore = await loadPlan(ctxOf(db, ALICE), KEY(RENEWAL));
  const idBefore = await loadPlan(ctxOf(db, ALICE), KEY(idNew));
  const original = JSON.parse(JSON.stringify(afterLegacy.departments)) as Array<{ projects: Array<Record<string, unknown>> }>;
  const moved = JSON.parse(JSON.stringify(original)) as Array<{ projects: Array<Record<string, unknown>> }>;
  [moved[1].projects[0], moved[1].projects[1]] = [moved[1].projects[1], moved[1].projects[0]];
  moved[1].projects[1].title = '点検工程の標準化（改称）';
  await env.setStrategyA(moved);
  const renewalAfter = await loadPlan(ctxOf(db, ALICE), KEY(RENEWAL));
  const idAfter = await loadPlan(ctxOf(db, ALICE), KEY(idNew));
  check('並び替え・名称変更：計画書は番号で結び付き、取り違えない（内容・版が変わらない）', sameRecord(renewalBefore, renewalAfter) && sameRecord(idBefore, idAfter));
  const regenAfterMove = await gen(ALICE, idNew);
  check('名称変更後：同じ番号のプロジェクトは、同じ計画書に照合される（EXISTS）', regenAfterMove.status === 'EXISTS', regenAfterMove.status);
  await env.setStrategyA(original);

  check('STAGE3のKPI（okrsV2）は、この検証の全体で変わらない', (await okrsOf()) === okrsBefore);

  /* ---- 9. 後片付け：管理者の削除（履歴は草案に従属して消える） ---- */
  const managerDelete = await asUser(db, MANAGER, 'delete from stage4_plan_documents where project_id = $1 returning id', [RENEWAL]);
  check('削除権限：manager は草案を削除できる（1件）', 'rows' in managerDelete && managerDelete.rows.length === 1);

  await env.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ total: results.length, pass: results.length - failed.length }));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
