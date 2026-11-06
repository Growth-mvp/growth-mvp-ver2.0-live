import { buildStage5ProgressBlock } from './stage5Progress';
import { buildStage6PlanBlock } from './stage6Plan';
import { classifyStage6Text, TRUNCATION_MARK } from './referenceStatus';
import { readStoredFinancePlan } from '@/utils/stage6/financePlanSnapshot';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';

jest.mock('@/utils/stage6/financePlanSnapshot', () => {
  const actual = jest.requireActual('@/utils/stage6/financePlanSnapshot');
  return { ...actual, readStoredFinancePlan: jest.fn(actual.readStoredFinancePlan) };
});
jest.mock('@/utils/stage6/financePlanPipeline', () => {
  const actual = jest.requireActual('@/utils/stage6/financePlanPipeline');
  return { ...actual, computeStage6FinancePlan: jest.fn(actual.computeStage6FinancePlan) };
});

const COMPANY = 'company-a';

const plan = (over: Record<string, unknown> = {}) =>
  buildStage6PlanBlock({
    csvFinanceData: {},
    companyId: COMPANY,
    financePL: [],
    financeBS: [],
    departments: [],
    currentYear: 2026,
    simulationResults: [],
    ...over,
  });

describe('STAGE5 の省略注記は参照状態の判定と一致する（回帰2）', () => {
  it('上限を超えると省略注記を出し、判定関数がそれを検出する', () => {
    const longTitle = 'あ'.repeat(160);
    const departments = [
      {
        id: 'd1',
        name: '営業部',
        projects: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, title: `${longTitle}${i}` })),
      },
    ];
    const okrs = Array.from({ length: 12 }, (_, i) => ({
      id: `o${i}`,
      department_id: 'd1',
      project_id: `p${i}`,
    }));
    const text = buildStage5ProgressBlock({
      departments,
      okrs,
      companyLogs: [],
      companyLogsFailed: false,
      now: new Date('2026-11-06T00:00:00Z'),
    });
    expect(text).toContain(TRUNCATION_MARK);
    expect(text.length).toBeLessThan(1700);
  });

  it('省略がない通常の出力は省略として検出されない', () => {
    const text = buildStage5ProgressBlock({
      departments: [{ id: 'd1', name: '営業部', projects: [{ id: 'p1', title: '新規' }] }],
      okrs: [{ id: 'o1', department_id: 'd1', project_id: 'p1' }],
      companyLogs: [],
      companyLogsFailed: false,
      now: new Date('2026-11-06T00:00:00Z'),
    });
    expect(classifyStage6Text(text).truncated).toBe(false);
    expect(text).not.toContain(TRUNCATION_MARK);
  });

  it('取得失敗時は省略と誤認されない本文を返す', () => {
    const text = buildStage5ProgressBlock({
      departments: [],
      okrs: [],
      companyLogs: [],
      companyLogsFailed: true,
      now: new Date('2026-11-06T00:00:00Z'),
    });
    expect(text).toContain('取得できませんでした');
    expect(text).not.toContain(TRUNCATION_MARK);
  });
});

describe('STAGE6 の注記は参照状態の判定と一致する（回帰2）', () => {
  it('上限を超える保存済みシミュレーションは省略として検出される', () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      title: `${'い'.repeat(900)}${i}`,
      created_at: '2025-01-01T00:00:00Z',
      payload: {},
    }));
    const text = plan({ simulationResults: rows });
    expect(classifyStage6Text(text).truncated).toBe(true);
  });

  it('前提が無いと確認できる保存データは未保存として区別される', () => {
    const text = plan({ csvFinanceData: { financeBS: [] } });
    expect(classifyStage6Text(text).storeNone).toBe(true);
    expect(classifyStage6Text(text).storeUnknown).toBe(false);
    expect(classifyStage6Text(text).computeFailed).toBe(false);
  });

  it('保存データが空の場合は未保存と断定せず、確認できない（状態不明）として区別される', () => {
    const text = plan({ csvFinanceData: {} });
    expect(classifyStage6Text(text).storeNone).toBe(false);
    expect(classifyStage6Text(text).storeUnknown).toBe(true);
  });

  it('同一会社の保存前提を読めない場合は読取失敗として区別される', () => {
    const text = plan({ csvFinanceData: { financePlanAssumptions: { companyId: COMPANY, invalid: true } } });
    expect(text).toContain('保存済みの資金計画を読めませんでした');
    expect(classifyStage6Text(text).storeFailed).toBe(true);
  });

  it('別会社の保存前提は、読取失敗（別会社）として区別される', () => {
    const text = plan({ csvFinanceData: { financePlanAssumptions: { companyId: 'other-company' } } });
    expect(classifyStage6Text(text).storeFailed).toBe(true);
    expect(classifyStage6Text(text).storeNone).toBe(false);
  });
});

describe('STAGE6 の内部計算失敗は注記として検出される（回帰2）', () => {
  it('計算関数が例外を投げると、計算失敗の注記になり、判定関数がそれを検出する', () => {
    (readStoredFinancePlan as jest.Mock).mockReturnValueOnce({
      kind: 'OK',
      savedAt: '2026-01-01T00:00:00Z',
      domain: {
        assumptions: { targetYear: null, targetRevenueYen: null, targetOperatingIncomeYen: null, minCashYen: null },
      },
    });
    (computeStage6FinancePlan as jest.Mock).mockImplementationOnce(() => {
      throw new Error('simulated compute failure');
    });
    const text = plan({ csvFinanceData: { financePlanAssumptions: {} } });
    expect(text).toContain('入力データの整合を確認できませんでした');
    expect(classifyStage6Text(text).computeFailed).toBe(true);
  });
});
