/* 再生成ガードの実用性（モック・読み取り専用）。実 DB・実 API には接続しない。
 * 利用の流れ（初回生成 → /okr で閲覧 → 承認 → 再生成）を、ガードの判定で追う。 */
import { assessDepartmentRegen, findLocalStage4Data } from '@/lib/cascade/regenGuard';

type Row = Record<string, any>;

function fakeClient(tables: { okrs?: Row[]; progress_logs?: Row[] }, error?: string) {
  const from = (table: string) => {
    const st: any = { table, filters: [] as any[] };
    const api: any = {
      select: () => api,
      eq: (k: string, v: any) => (st.filters.push(['eq', k, v]), api),
      in: (k: string, v: any[]) => (st.filters.push(['in', k, v]), api),
      like: () => api,
      limit: () => api,
      then: (res: any, rej: any) => {
        if (error) return Promise.resolve({ data: null, error: { message: error } }).then(res, rej);
        let rows: Row[] = ((tables as any)[table] ?? []) as Row[];
        for (const f of st.filters) {
          if (f[0] === 'eq') rows = rows.filter((r) => r[f[1]] === f[2]);
          if (f[0] === 'in') rows = rows.filter((r) => f[2].includes(r[f[1]]));
        }
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { from } as any;
}

const CO = 'company-a';
const idOf = (p: Row) => String(p.id);
const dbOkr = (projectId: string) => ({ company_id: CO, project_id: projectId, is_deleted: false });
const dbLog = (projectId: string) => ({
  company_id: CO,
  is_deleted: false,
  progress_text: `__META__:${JSON.stringify({ projectId })}\n本文`,
});

/** 初回生成直後のプロジェクト（AI の下書き、閲覧・保存なし） */
const draftFresh = (id: string, title: string) => ({ id, title, planStatus: 'draft' });

async function regen(dept: string, projects: Row[], db: { okrs?: Row[]; progress_logs?: Row[] } = {}, err?: string) {
  return assessDepartmentRegen({
    client: fakeClient(db, err),
    companyId: CO,
    departmentName: dept,
    projects,
    projectIdOf: idOf,
  });
}

describe('A. 初回生成の直後', () => {
  it('まだ部門が無い（初めてのたたき台）は、ガードに止められない', async () => {
    expect(await regen('営業部', [])).toEqual({ allowed: true });
  });

  it('初回のたたき台で作られたプロジェクトは、閲覧・保存前なら保存済みOKRが無く、再生成できる', async () => {
    // STAGE3 の生成は okrs 表へ書かない（確認済み）。OKR は /okr の操作で保存される。
    expect(await regen('営業部', [draftFresh('p1', '新規顧客開拓'), draftFresh('p2', '既存顧客深耕')])).toEqual({ allowed: true });
  });
});

describe('B. /okr を開いた後（閲覧だけで保存される）', () => {
  it('プロジェクトを選ぶだけで主要OKRが保存されるため、閲覧だけでも再生成は止まる', async () => {
    // /okr のプロジェクト選択で ensureMainOkrIsDbBacked が呼ばれ、okrs へ insert される（確認済み）
    const r = await regen('営業部', [draftFresh('p1', '新規顧客開拓')], { okrs: [dbOkr('p1')] });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('db');
      expect(r.items[0].reasons).toEqual(['保存済みのOKR 1件']);
    }
  });

  it('閲覧で保存されたOKRは、利用者が編集したものかは区別できない（AI の原案のままでも止まる）', async () => {
    const r = await regen('営業部', [draftFresh('p1', '新規顧客開拓')], { okrs: [dbOkr('p1')] });
    expect(r.allowed).toBe(false);
  });
});

describe('C. 下書き と 承認済み の違い', () => {
  it('下書き（DBにOKRなし、人的投資なし）は再生成できる', async () => {
    expect(await regen('営業部', [draftFresh('p1', 'A')])).toEqual({ allowed: true });
  });

  it('承認済みは、DBのOKRが無くても必ず止まる（承認の記録が残っている）', async () => {
    const r = await regen('営業部', [{ id: 'p1', title: 'A', planStatus: 'approved', approvedAt: '2026-10-01', approvedBy: 'u1' }]);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('local');
  });

  it('差戻しで下書きに戻しても、承認日時が残っているため止まり続ける（解除の操作が無い）', async () => {
    // updatePlanStatus は approved 以外への変更で approvedAt を消さない（確認済み）
    const r = await regen('営業部', [{ id: 'p1', title: 'A', planStatus: 'draft', approvedAt: '2026-10-01', approvedBy: 'u1' }]);
    expect(r.allowed).toBe(false);
  });

  it('下書きでも人的投資を1件入れると止まる（作業の途中の入力も保護される）', async () => {
    const r = await regen('営業部', [{ id: 'p1', title: 'A', planStatus: 'draft', executionHumanInvestments: [{ id: 'h1' }] }]);
    expect(r.allowed).toBe(false);
  });
});

describe('D. 進捗ログ', () => {
  it('進捗ログが1件でもあると、OKR が無くても止まり、消えることは無い', async () => {
    const r = await regen('営業部', [draftFresh('p1', 'A')], { progress_logs: [dbLog('p1')] });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.items[0].reasons).toEqual(['進捗ログ 1件']);
  });
});

describe('E. 部門の範囲', () => {
  it('2部門のうち一方だけ止まり、もう一方は再生成できる', async () => {
    const db = { okrs: [dbOkr('sales-1')] };
    expect((await regen('営業部', [draftFresh('sales-1', '営業施策')], db)).allowed).toBe(false);
    expect(await regen('開発部', [draftFresh('dev-1', '開発施策')], db)).toEqual({ allowed: true });
  });

  it('1部門の中で、データのあるプロジェクトだけが対象として示される（残りは通常どおり判定）', async () => {
    const projects = [draftFresh('p1', 'A'), draftFresh('p2', 'B'), draftFresh('p3', 'C')];
    const r = await regen('営業部', projects, { okrs: [dbOkr('p2')] });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.items.map((i) => i.projectTitle)).toEqual(['B']);
  });
});

describe('F. 安全側の動作', () => {
  it('DB の読み取りに失敗すると止まる（判定できない時は更新しない）', async () => {
    const r = await regen('営業部', [draftFresh('p1', 'A')], {}, 'network error');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('unknown');
  });
});

describe('G. 通常操作の制限の集計（想定の利用シナリオ）', () => {
  it('シナリオごとの判定を一覧にする', async () => {
    const scenarios: Array<{ name: string; allowed: boolean; run: () => Promise<any> }> = [
      { name: '初回生成直後（閲覧なし）', allowed: true, run: () => regen('営業部', [draftFresh('p1', 'A')]) },
      { name: '/okr で閲覧済み（OKR保存）', allowed: false, run: () => regen('営業部', [draftFresh('p1', 'A')], { okrs: [dbOkr('p1')] }) },
      { name: '承認済み', allowed: false, run: () => regen('営業部', [{ id: 'p1', title: 'A', planStatus: 'approved', approvedAt: 'x' }]) },
      { name: '差戻し後（承認日時が残る）', allowed: false, run: () => regen('営業部', [{ id: 'p1', title: 'A', planStatus: 'draft', approvedAt: 'x' }]) },
      { name: '進捗ログあり', allowed: false, run: () => regen('営業部', [draftFresh('p1', 'A')], { progress_logs: [dbLog('p1')] }) },
    ];
    const results: string[] = [];
    for (const s of scenarios) {
      const r = await s.run();
      expect(r.allowed).toBe(s.allowed);
      results.push(`${s.name}: ${r.allowed ? '再生成可' : '止まる'}`);
    }
    expect(results).toHaveLength(5);
  });

  it('端末内の判定は、承認・人的投資・スキル計画だけを見る（OKR・進捗ログは見ない）', () => {
    expect(findLocalStage4Data([{ id: 'p1', title: 'A', planStatus: 'draft', okrs: [{ id: 'o1' }] }])).toEqual([]);
  });
});
