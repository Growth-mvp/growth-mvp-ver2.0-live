import { buildExecutionPromptBlock, findExecutionTarget, loadExecutionScope, parseExecutionInput } from './executionScope';

const CO = '11111111-1111-4111-8111-111111111111';
const CO_OTHER = '22222222-2222-4222-8222-222222222222';
const ST = '33333333-3333-4333-8333-333333333333';

const DEPARTMENTS = [
  {
    id: 'dept-sales',
    name: '営業部',
    projects: [
      {
        id: 'proj-renewal',
        title: '既存顧客の保守契約更新',
        okrsV2: [{ id: 'kr-1', label: '保守契約の継続率', target: 95, unit: '%', actual: { value: 90, asOf: '2026-10' } }],
      },
    ],
  },
  { id: 'dept-plan', name: '企画部', projects: [{ id: 'proj-other', title: '別の案件', okrsV2: [] }] },
];

function fakeAdmin(opts: { departments?: unknown; logs?: unknown[]; planStarted?: boolean; planThrows?: boolean } = {}) {
  const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const make = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return b;
      },
      in: (k: string, v: unknown) => {
        filters[k] = v;
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle: async () => {
        queries.push({ table, filters: { ...filters } });
        if (table === 'strategy_data') return { data: { departments: opts.departments ?? DEPARTMENTS }, error: null };
        if (table === 'stage4_plan_documents') {
          if (opts.planThrows) throw new Error('boom');
          return { data: opts.planStarted ? { ai_draft: {}, user_edits: {}, start_info: { at: '2026-11-11T09:00:00Z', version: 4 } } : null, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        queries.push({ table, filters: { ...filters } });
        if (table === 'okrs') resolve({ data: [{ id: 'okr-1' }], error: null });
        else if (table === 'progress_logs') resolve({ data: opts.logs ?? [], error: null });
        else resolve({ data: [], error: null });
      },
    };
    return b;
  };
  return { queries, from: make };
}

describe('相談の対象（右側AIへ渡す文脈）の検証', () => {
  it('会社・戦略が依頼と一致しない場合は拒否する（別の会社の対象を混ぜない）', () => {
    const r = parseExecutionInput(
      { companyId: CO_OTHER, strategyId: ST, departmentId: 'dept-sales', projectId: 'proj-renewal' },
      { companyId: CO, strategyId: ST },
    );
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('必要な項目がない、または形式が不正なら400', () => {
    expect(parseExecutionInput({ companyId: CO }, { companyId: CO, strategyId: ST })).toMatchObject({ ok: false, status: 400 });
    expect(parseExecutionInput('x', { companyId: CO, strategyId: ST })).toMatchObject({ ok: false, status: 400 });
  });

  it('プロジェクトが戦略に存在しなければ拒否する', () => {
    const r = findExecutionTarget(DEPARTMENTS, { departmentId: 'dept-sales', projectId: 'proj-missing' });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('部門が一致しないプロジェクトは拒否する（部門と案件の取り違えを防ぐ）', () => {
    const r = findExecutionTarget(DEPARTMENTS, { departmentId: 'dept-plan', projectId: 'proj-renewal' });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it('同じプロジェクトIDが複数ある場合は、どの対象か特定できないため拒否する', () => {
    const dup = [
      { id: 'a', name: 'A', projects: [{ id: 'same', title: 'x', okrsV2: [] }] },
      { id: 'b', name: 'B', projects: [{ id: 'same', title: 'y', okrsV2: [] }] },
    ];
    expect(findExecutionTarget(dup, { departmentId: 'a', projectId: 'same' })).toMatchObject({ ok: false });
  });

  it('正しい対象は、部門名とプロジェクト名を返す', () => {
    const r = findExecutionTarget(DEPARTMENTS, { departmentId: 'dept-sales', projectId: 'proj-renewal' });
    expect(r).toMatchObject({ ok: true, departmentName: '営業部', projectTitle: '既存顧客の保守契約更新' });
  });
});

describe('対象プロジェクトの文脈の読み込み', () => {
  const input = { companyId: CO, strategyId: ST, departmentId: 'dept-sales', projectId: 'proj-renewal' };

  it('対象の案件のKR・共有された投稿だけを含み、他の案件・投稿者の識別子は含まない', async () => {
    const admin = fakeAdmin({
      logs: [
        { content: '__META__:{"companyId":"x"}\n継続率の改善案を準備中', created_at: '2026-11-10T00:00:00Z' },
        { content: '[FB]\n方針は良い', created_at: '2026-11-11T00:00:00Z' },
      ],
    });
    const r = await loadExecutionScope(admin, input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.promptBlock).toContain('プロジェクト：既存顧客の保守契約更新');
    expect(r.promptBlock).toContain('保守契約の継続率：目標 95%／実績 90（2026-10）');
    expect(r.promptBlock).toContain('継続率の改善案を準備中');
    expect(r.promptBlock).toContain('（フィードバック）：方針は良い');
    expect(r.promptBlock).not.toContain('__META__');
    expect(r.promptBlock).not.toContain('別の案件');
    expect(r.promptBlock).not.toContain('user_id');
  });

  it('社内の投稿の読み取りは会社IDで絞る（他社の投稿を読まない）', async () => {
    const admin = fakeAdmin();
    await loadExecutionScope(admin, input);
    const logQuery = admin.queries.find((q) => q.table === 'progress_logs');
    expect(logQuery?.filters.company_id).toBe(CO);
    const okrQuery = admin.queries.find((q) => q.table === 'okrs');
    expect(okrQuery?.filters).toMatchObject({ company_id: CO, project_id: 'proj-renewal' });
  });

  it('STAGE4で開始していない案件は、計画を未開始と書く', async () => {
    const r = await loadExecutionScope(fakeAdmin({ planStarted: false }), input);
    expect(r.ok && r.promptBlock).toContain('実行計画：未開始');
  });

  it('計画の読み込みに失敗しても、対象の情報だけで続ける（計画を推測しない）', async () => {
    const r = await loadExecutionScope(fakeAdmin({ planThrows: true }), input);
    expect(r.ok && r.promptBlock).toContain('実行計画：未開始');
  });

  it('戦略に対象がなければ、読み込みを拒否する', async () => {
    const r = await loadExecutionScope(fakeAdmin({ departments: [] }), input);
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});

describe('プロンプトの長さの上限', () => {
  it('長い本文・多数の項目は上限で切り、全文を送らない', () => {
    const long = 'あ'.repeat(1000);
    const block = buildExecutionPromptBlock({
      departmentName: '営業部',
      projectTitle: 'P',
      objective: '',
      krs: Array.from({ length: 30 }, () => ({ label: 'k', target: '1', actual: '未確認' })),
      plan: null,
      posts: [{ at: '2026-11-10', text: long, isFeedback: false }],
    });
    expect(block.split('\n').filter((l) => l.startsWith('・k')).length).toBeLessThanOrEqual(10);
    expect(block).not.toContain(long);
  });
});
