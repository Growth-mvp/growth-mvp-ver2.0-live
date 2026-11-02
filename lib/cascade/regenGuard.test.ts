import { assessDepartmentRegen, findLocalStage4Data } from './regenGuard';

type Row = Record<string, any>;

function fakeClient(tables: { okrs?: Row[]; progress_logs?: Row[] }, errors: { okrs?: string; progress_logs?: string } = {}) {
  const calls: Array<{ table: string; filters: any[]; limit?: number }> = [];
  const from = (table: string) => {
    const state: { table: string; filters: any[]; limit?: number } = { table, filters: [] };
    const api: any = {
      select: () => api,
      eq: (k: string, v: any) => {
        state.filters.push(['eq', k, v]);
        return api;
      },
      in: (k: string, v: any[]) => {
        state.filters.push(['in', k, v]);
        return api;
      },
      like: (k: string, v: string) => {
        state.filters.push(['like', k, v]);
        return api;
      },
      limit: (n: number) => {
        state.limit = n;
        return api;
      },
      then: (resolve: any, reject: any) => {
        calls.push({ ...state, filters: [...state.filters] });
        if ((errors as any)[table]) {
          return Promise.resolve({ data: null, error: { message: (errors as any)[table] } }).then(resolve, reject);
        }
        let rows: Row[] = ((tables as any)[table] ?? []) as Row[];
        for (const f of state.filters) {
          if (f[0] === 'eq') rows = rows.filter((r) => r[f[1]] === f[2]);
          if (f[0] === 'in') rows = rows.filter((r) => f[2].includes(r[f[1]]));
          if (f[0] === 'like') {
            const prefix = String(f[2]).replace('%', '');
            rows = rows.filter((r) => typeof r[f[1]] === 'string' && r[f[1]].startsWith(prefix));
          }
        }
        if (state.limit !== undefined) rows = rows.slice(0, state.limit);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return api;
  };
  return { client: { from } as any, calls };
}

const idOf = (p: Row) => String(p.id ?? '');
const log = (projectId: string, body = '本文') => ({
  company_id: 'company-a',
  is_deleted: false,
  progress_text: `__META__:${JSON.stringify({ projectId })}\n${body}`,
});
const okr = (projectId: string) => ({ company_id: 'company-a', is_deleted: false, project_id: projectId });

const PLAIN = { id: 'proj-1', title: '新規顧客開拓', planStatus: 'draft', skillPlans: [], executionHumanInvestments: [] };

describe('既存データの検知（端末内）', () => {
  it('承認済みは検知する', () => {
    const items = findLocalStage4Data([{ ...PLAIN, planStatus: 'approved', approvedAt: '2026-10-01', approvedBy: 'u1' }]);
    expect(items).toHaveLength(1);
    expect(items[0].reasons).toEqual(expect.arrayContaining(['承認状態: 承認済み', '承認の記録あり']));
  });

  it('確認中（review）は検知する', () => {
    expect(findLocalStage4Data([{ ...PLAIN, planStatus: 'review' }])[0].reasons).toContain('承認状態: 確認中');
  });

  it('承認日時だけが残っている場合も検知する', () => {
    expect(findLocalStage4Data([{ ...PLAIN, approvedAt: '2026-10-01' }])).toHaveLength(1);
  });

  it('人的投資・スキル計画が入っていれば件数つきで検知する', () => {
    const items = findLocalStage4Data([
      { ...PLAIN, executionHumanInvestments: [{ id: 'h1' }, { id: 'h2' }], skillPlans: [{ id: 's1' }] },
    ]);
    expect(items[0].reasons).toEqual(['人的投資 2件', 'スキル計画 1件']);
  });

  it('下書きで何も入っていなければ、検知しない（従来どおり再生成できる）', () => {
    expect(findLocalStage4Data([PLAIN])).toEqual([]);
    expect(findLocalStage4Data([{ title: 'x' }])).toEqual([]);
    expect(findLocalStage4Data(undefined as any)).toEqual([]);
  });

  it('未知の承認状態・形式が不明な項目は、安全側に倒して検知する', () => {
    expect(findLocalStage4Data([{ ...PLAIN, planStatus: 'weird' }])[0].reasons[0]).toContain('承認状態が不明');
    expect(findLocalStage4Data([{ ...PLAIN, skillPlans: 'x' }])[0].reasons[0]).toContain('形式が不明');
  });
});

describe('再生成の判定（部門単位）', () => {
  it('会社が不明なら、DB を読まずに中止する', async () => {
    const { client, calls } = fakeClient({});
    const r = await assessDepartmentRegen({ client, companyId: null, departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r.allowed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('データが何も無ければ、従来どおり再生成を許可する', async () => {
    const { client } = fakeClient({ okrs: [], progress_logs: [] });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r).toEqual({ allowed: true });
  });

  it('プロジェクトが無い部門は、DB を読まずに許可する', async () => {
    const { client, calls } = fakeClient({});
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [], projectIdOf: idOf });
    expect(r).toEqual({ allowed: true });
    expect(calls).toHaveLength(0);
  });

  it('編集済み計画（人的投資）があれば、DB を読まずに中止し、対象を示す', async () => {
    const { client, calls } = fakeClient({});
    const r = await assessDepartmentRegen({
      client,
      companyId: 'company-a',
      departmentName: '営業部',
      projects: [{ ...PLAIN, executionHumanInvestments: [{ id: 'h1' }] }],
      projectIdOf: idOf,
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('local');
      expect(r.message).toContain('「新規顧客開拓」');
      expect(r.message).toContain('既存のデータは変更していません');
    }
    expect(calls).toHaveLength(0);
  });

  it('承認済みの計画があれば中止する', async () => {
    const { client } = fakeClient({});
    const r = await assessDepartmentRegen({
      client,
      companyId: 'company-a',
      departmentName: '営業部',
      projects: [{ ...PLAIN, planStatus: 'approved' }],
      projectIdOf: idOf,
    });
    expect(r.allowed).toBe(false);
  });

  it('保存済みOKR（DB）があれば、そのプロジェクトを中止対象にする', async () => {
    const { client } = fakeClient({ okrs: [okr('proj-1')] });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('db');
      expect(r.items[0].reasons).toEqual(['保存済みのOKR 1件']);
    }
  });

  it('同じプロジェクトIDの進捗ログがあれば中止する', async () => {
    const { client } = fakeClient({ progress_logs: [log('proj-1')] });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.items[0].reasons).toEqual(['進捗ログ 1件']);
  });

  it('別のプロジェクトIDの進捗ログは、対象にしない', async () => {
    const { client } = fakeClient({ progress_logs: [log('proj-other')] });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r).toEqual({ allowed: true });
  });

  it('削除済みのOKRは、対象にしない（進捗ログは削除フラグを見ず、削除済みでも中止する）', async () => {
    const okrOnly = await assessDepartmentRegen({
      client: fakeClient({ okrs: [{ ...okr('proj-1'), is_deleted: true }] }).client,
      companyId: 'company-a',
      departmentName: '営業部',
      projects: [PLAIN],
      projectIdOf: idOf,
    });
    expect(okrOnly).toEqual({ allowed: true });
    const logOnly = await assessDepartmentRegen({
      client: fakeClient({ progress_logs: [{ ...log('proj-1'), is_deleted: true }] }).client,
      companyId: 'company-a',
      departmentName: '営業部',
      projects: [PLAIN],
      projectIdOf: idOf,
    });
    expect(logOnly.allowed).toBe(false);
  });

  it('他社のOKR・進捗ログは、対象にしない（会社で絞り込む）', async () => {
    const { client } = fakeClient({
      okrs: [{ ...okr('proj-1'), company_id: 'company-b' }],
      progress_logs: [{ ...log('proj-1'), company_id: 'company-b' }],
    });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r).toEqual({ allowed: true });
  });

  it('複数プロジェクトのうち、データがあるものだけを対象として示す', async () => {
    const projects = [
      { id: 'p1', title: 'A', planStatus: 'draft' },
      { id: 'p2', title: 'B', planStatus: 'draft' },
      { id: 'p3', title: 'C', planStatus: 'draft' },
    ];
    const { client } = fakeClient({ okrs: [okr('p2')] });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects, projectIdOf: idOf });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.items.map((i) => i.projectTitle)).toEqual(['B']);
  });

  it('複数部門は部門ごとに判定し、データのある部門だけを止める', async () => {
    const { client } = fakeClient({ okrs: [okr('p-sales')] });
    const sales = await assessDepartmentRegen({
      client,
      companyId: 'company-a',
      departmentName: '営業部',
      projects: [{ id: 'p-sales', title: '営業施策' }],
      projectIdOf: idOf,
    });
    const dev = await assessDepartmentRegen({
      client,
      companyId: 'company-a',
      departmentName: '開発部',
      projects: [{ id: 'p-dev', title: '開発施策' }],
      projectIdOf: idOf,
    });
    expect(sales.allowed).toBe(false);
    expect(dev).toEqual({ allowed: true });
  });

  it('新しいプロジェクトIDが生成されても、既存のIDで判定するため旧データを見逃さない', async () => {
    // 再生成後の新しいIDは判定に使わない。既存の proj-old-1 の OKR を見て中止する。
    const { client, calls } = fakeClient({ okrs: [okr('proj-old-1')] });
    const r = await assessDepartmentRegen({
      client,
      companyId: 'company-a',
      departmentName: '営業部',
      projects: [{ id: 'proj-old-1', title: '新規顧客開拓' }],
      projectIdOf: idOf,
    });
    expect(r.allowed).toBe(false);
    const okrCall = calls.find((c) => c.table === 'okrs');
    expect(okrCall?.filters).toEqual(expect.arrayContaining([['in', 'project_id', ['proj-old-1']]]));
  });

  it('名称が同じでもIDが違えば関連付けない（名称一致で判定しない）', async () => {
    const { client } = fakeClient({ okrs: [okr('p-other')] });
    const r = await assessDepartmentRegen({
      client,
      companyId: 'company-a',
      departmentName: '営業部',
      projects: [{ id: 'p1', title: '新規顧客開拓' }],
      projectIdOf: idOf,
    });
    expect(r).toEqual({ allowed: true });
  });

  it('DB の読み取りに失敗したら、安全側に倒して中止する', async () => {
    const { client } = fakeClient({}, { okrs: 'permission denied' });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('unknown');
      expect(r.message).toContain('permission denied');
    }
  });

  it('進捗ログの件数が上限に達したら、判定できないとして中止する', async () => {
    const many = Array.from({ length: 5000 }, () => log('proj-x'));
    const { client } = fakeClient({ progress_logs: many });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('unknown');
  });

  it('進捗ログの対象を読めない記録があると、安全側に倒して中止する', async () => {
    const { client } = fakeClient({ progress_logs: [{ company_id: 'company-a', is_deleted: false, progress_text: '__META__:{broken\n本文' }] });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('unknown');
  });
});

describe('進捗ログの取得は is_deleted 列に依存しない', () => {
  type Call = { table: string; filters: Array<[string, string, unknown]> };
  function recording(tables: { okrs?: Row[]; progress_logs?: Row[] }, opts: { missingIsDeleted?: boolean; error?: string } = {}) {
    const calls: Call[] = [];
    const from = (table: string) => {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const api: any = {
        select: () => api,
        eq: (k: string, v: unknown) => (call.filters.push(['eq', k, v]), api),
        in: (k: string, v: unknown[]) => (call.filters.push(['in', k, v]), api),
        like: (k: string, v: unknown) => (call.filters.push(['like', k, v]), api),
        limit: () => api,
        then: (res: any, rej: any) => {
          if (opts.error) return Promise.resolve({ data: null, error: { message: opts.error } }).then(res, rej);
          if (table === 'progress_logs' && opts.missingIsDeleted && call.filters.some((f) => f[1] === 'is_deleted')) {
            return Promise.resolve({ data: null, error: { message: 'column progress_logs.is_deleted does not exist' } }).then(res, rej);
          }
          let rows: Row[] = ((tables as any)[table] ?? []) as Row[];
          for (const f of call.filters) {
            if (f[0] === 'eq') rows = rows.filter((r) => r[f[1]] === f[2]);
            if (f[0] === 'in') rows = rows.filter((r) => (f[2] as unknown[]).includes(r[f[1]]));
            if (f[0] === 'like') {
              const prefix = String(f[2]).replace('%', '');
              rows = rows.filter((r) => typeof r[f[1]] === 'string' && r[f[1]].startsWith(prefix));
            }
          }
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return api;
    };
    return { client: { from } as any, calls };
  }

  it('進捗ログの取得条件に is_deleted を含めない（会社と META の絞り込みのみ）', async () => {
    const { client, calls } = recording({ progress_logs: [] });
    await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    const logCall = calls.find((c) => c.table === 'progress_logs');
    expect(logCall?.filters).toEqual(expect.arrayContaining([['eq', 'company_id', 'company-a']]));
    expect(logCall?.filters.some((f) => f[1] === 'is_deleted')).toBe(false);
  });

  it('列が存在しない環境でも、進捗ログがあれば中止する（列の有無で判定が崩れない）', async () => {
    const { client } = recording({ progress_logs: [log('proj-1')] }, { missingIsDeleted: true });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('db');
  });

  it('列が存在しない環境で、進捗ログが無ければ再生成を許可する', async () => {
    const { client } = recording({ progress_logs: [] }, { missingIsDeleted: true });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r).toEqual({ allowed: true });
  });

  it('進捗ログの読み取りが失敗したら中止する', async () => {
    const { client } = recording({}, { error: 'timeout' });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('unknown');
  });

  it('他社の進捗ログは、同じプロジェクトIDでも対象にしない（会社で絞り込む）', async () => {
    const { client } = recording({ progress_logs: [{ ...log('proj-1'), company_id: 'company-b' }] });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r).toEqual({ allowed: true });
  });

  it('進捗ログが削除済みの記録でも数える（削除フラグを見ないため、保守的に中止する）', async () => {
    const { client } = recording({ progress_logs: [{ ...log('proj-1'), is_deleted: true }] });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r.allowed).toBe(false);
  });

  it('対象を読めない進捗ログ（META の形式が壊れている）があると中止する', async () => {
    const { client } = recording({ progress_logs: [{ company_id: 'company-a', progress_text: '__META__:{"projectId":' }] });
    const r = await assessDepartmentRegen({ client, companyId: 'company-a', departmentName: '営業部', projects: [PLAIN], projectIdOf: idOf });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('unknown');
  });

  it('既存のデータ消失防止（承認・人的投資）は、DB を読む前に従来どおり中止する', async () => {
    const { client, calls } = recording({ progress_logs: [] });
    const r = await assessDepartmentRegen({
      client,
      companyId: 'company-a',
      departmentName: '営業部',
      projects: [{ ...PLAIN, planStatus: 'approved' }],
      projectIdOf: idOf,
    });
    expect(r.allowed).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
