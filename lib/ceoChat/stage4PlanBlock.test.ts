import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import type { RawPlanStrategy } from '@/lib/stage4/plan/source';
import { buildDocModel } from '@/lib/stage4/planView/documentModel';
import { buildStage4PlanBlock, loadStage4PlanRows, type Stage4PlanRow } from './stage4PlanBlock';

const PROJECT = 'fict-proj-renewal';
let bundle: Record<string, unknown>;

beforeAll(async () => {
  const r = await generateMockExecutionPlan({
    strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as RawPlanStrategy,
    membershipCompanyId: 'fict-co-a',
    requestedStrategyId: 'fict-strategy-a',
    requestedProjectId: PROJECT,
    currentYm: '2026-11',
    companyName: '架空',
    createdAt: '2026-11-10T00:00:00.000Z',
  });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  bundle = r.bundle;
});

const DEPARTMENTS = [
  { id: 'dept-sales', name: '営業部', projects: [{ id: PROJECT, title: '既存顧客の保守契約更新' }] },
];

const row = (over: Partial<Stage4PlanRow> = {}): Stage4PlanRow => ({
  project_id: PROJECT,
  ai_draft: bundle,
  user_edits: {},
  started: false,
  adopted: true,
  ...over,
});

describe('STAGE4の実行計画（AI経営コンサルタントの参照）', () => {
  it('保存された利用者の編集を、AI原案より優先して出す', () => {
    const kpi = buildDocModel(bundle, {}).goals.kpis[0];
    expect(kpi.targetKey).not.toBeNull();
    const edited = row({ user_edits: { [kpi.targetKey!]: '3社' } });
    const text = buildStage4PlanBlock({ rows: [edited], departments: DEPARTMENTS, question: '' });
    expect(text).toContain(`KPI：${kpi.label}`);
    expect(text).toContain('目標 3社');
    expect(text).not.toContain(`目標 ${kpi.target}`);
  });

  it('画面上の未保存の編集を含まないと明記し、STAGE3の確定版と作業版を区別する', () => {
    const text = buildStage4PlanBlock({ rows: [row()], departments: DEPARTMENTS, question: '' });
    expect(text).toContain('保存済みの内容だけを参照する。画面上の未保存の編集は含まない');
    expect(text).toContain('STAGE3の作業版（未確定の変更）は含まない');
  });

  it('開始の状態と中止の状態を区別する', () => {
    expect(buildStage4PlanBlock({ rows: [row({ started: true })], departments: DEPARTMENTS, question: '' })).toContain('状態：実行開始済み');
    expect(buildStage4PlanBlock({ rows: [row({ adopted: true })], departments: DEPARTMENTS, question: '' })).toContain('状態：採用済み（実行開始前）');
    const stopped = [{ id: 'dept-sales', name: '営業部', projects: [{ id: PROJECT, title: '既存顧客の保守契約更新', lifecycle: { status: 'STOPPED', stoppedAt: '2026-11-01T00:00:00Z' } }] }];
    expect(buildStage4PlanBlock({ rows: [row({ started: true })], departments: stopped, question: '' })).toContain('状態：中止');
  });

  it('STAGE3に無い施策の計画書は出さず、計画書が未作成の施策は件数で示す', () => {
    const departments = [
      { id: 'dept-sales', name: '営業部', projects: [{ id: PROJECT, title: '既存顧客の保守契約更新' }, { id: 'proj-new', title: '新規の施策' }] },
      { id: 'dept-x', name: '別部門', projects: [{ id: 'dup', title: 'A' }, { id: 'dup', title: 'B' }] },
    ];
    const text = buildStage4PlanBlock({
      rows: [row(), row({ project_id: 'not-in-strategy' })],
      departments,
      question: '',
    });
    expect(text).toContain('既存顧客の保守契約更新');
    expect(text).not.toContain('not-in-strategy');
    expect(text).toContain('STAGE4の計画書が未作成の施策：1件');
  });

  it('計画書の取得に失敗したときは、計画書がないと断定しない', () => {
    const text = buildStage4PlanBlock({ rows: null, departments: DEPARTMENTS, question: '' });
    expect(text).toContain('計画書は今回確認できませんでした');
    expect(text).not.toContain('保存された計画書はありません');
  });

  it('会社と戦略で絞って読み、失敗時は null を返す', async () => {
    const calls: Array<{ table: string; eq: Array<[string, unknown]> }> = [];
    const admin = {
      from: (table: string) => {
        const call = { table, eq: [] as Array<[string, unknown]> };
        calls.push(call);
        const b: any = {
          select: () => b,
          eq: (k: string, v: unknown) => {
            call.eq.push([k, v]);
            return b;
          },
          then: (resolve: (v: unknown) => void) => resolve({ data: [row()], error: null }),
        };
        return b;
      },
    };
    const rows = await loadStage4PlanRows(admin, 'co-1', 'st-1');
    expect(rows).toHaveLength(1);
    expect(calls[0].table).toBe('stage4_plan_documents');
    expect(calls[0].eq).toEqual([
      ['company_id', 'co-1'],
      ['strategy_id', 'st-1'],
    ]);

    const failing = {
      from: () => {
        const b: any = {
          select: () => b,
          eq: () => b,
          then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'x' } }),
        };
        return b;
      },
    };
    expect(await loadStage4PlanRows(failing, 'co-1', 'st-1')).toBeNull();
  });
});
