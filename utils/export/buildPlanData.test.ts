/**
 * Phase 1 単位テスト：北極星目標と施策効果の分離
 *
 * prompt.txt 作業6 の検証項目：
 * - STAGE2売上目標がある場合
 * - STAGE2売上目標がない場合
 * - STAGE4施策効果488Mのみがある場合
 * - STAGE2目標とSTAGE4効果が異なる場合
 * - 財務PLのゼロ・赤字・未入力
 * - 金額単位未確定
 */

import { buildPlanData, type PlanData } from './buildPlanData';
import type { StrategyData } from '@/types/strategy';

// ★ テストケース1: STAGE2売上目標がある場合
describe('buildPlanData - STAGE2売上目標がある場合', () => {
  it('should use STAGE2 company target as primary revenue goal', () => {
    const state: any = {
      companyName: '株式会社テスト1',
      companyTargets: [
        {
          id: 'target-1',
          label: '売上高',
          base: 1500,
          unit: '万円',
          dueYear: 2025,
          reason: '市場戦略',
        },
      ],
      departments: [],
    };

    const planData = buildPlanData(state, 'bank');

    // STAGE2目標が正式目標として保持される
    expect(planData.stage56.companyTargetRevenue).toBe('1500万円（2025年）');
    // 推奨表示も同じ
    expect(planData.stage56.northStarRevenue).toBe('1500万円（2025年）');
    // STAGE4効果なし
    expect(planData.stage56.projectImpactSum).toBeUndefined();
  });
});

// ★ テストケース2: STAGE2売上目標がない場合
describe('buildPlanData - STAGE2売上目標がない場合', () => {
  it('should mark revenue goal as unset when no STAGE2 target', () => {
    const state: any = {
      companyName: '株式会社テスト2',
      companyTargets: [], // 目標なし
      departments: [],
    };

    const planData = buildPlanData(state, 'bank');

    expect(planData.stage56.companyTargetRevenue).toBeUndefined();
    // 推奨表示も「未設定」
    expect(planData.stage56.northStarRevenue).toContain('未設定');
  });
});

// ★ テストケース3: STAGE4施策効果488Mのみがある場合（最重要テスト）
describe('buildPlanData - STAGE4施策効果のみの場合', () => {
  it('should NOT use STAGE4 impacts as primary revenue goal', () => {
    const state: any = {
      companyName: '丹青社',
      companyTargets: [], // STAGE2目標なし
      departments: [
        {
          name: 'Sales',
          projects: [
            { title: '施策1', impactRevenueMJPY: 120 },
            { title: '施策2', impactRevenueMJPY: 90 },
            { title: '施策3', impactRevenueMJPY: 10 },
            { title: '施策4', impactRevenueMJPY: 250 },
            { title: '施策5', impactRevenueMJPY: 18 },
          ],
        },
      ],
    };

    const planData = buildPlanData(state, 'bank');

    // ★ 重要: STAGE4の施策効果合計488Mは参考値
    expect(planData.stage56.projectImpactSum).toContain('¥488M');
    expect(planData.stage56.projectImpactSum).toContain('重複未検証');

    // ★ 重要: 北極星目標は「未設定」（488Mではない）
    expect(planData.stage56.northStarRevenue).toContain('未設定');
    expect(planData.stage56.northStarRevenue).not.toContain('488');
  });
});

// ★ テストケース4: STAGE2目標とSTAGE4効果が異なる場合
describe('buildPlanData - STAGE2とSTAGE4が異なる場合', () => {
  it('should distinguish between STAGE2 target and STAGE4 impacts', () => {
    const state: any = {
      companyName: '株式会社テスト4',
      companyTargets: [
        {
          id: 'target-1',
          label: '売上高',
          base: 2000,
          unit: '万円',
          dueYear: 2025,
          reason: 'グローバル展開',
        },
      ],
      departments: [
        {
          name: 'Operations',
          projects: [
            { title: '施策A', impactRevenueMJPY: 100 },
            { title: '施策B', impactRevenueMJPY: 200 },
          ],
        },
      ],
    };

    const planData = buildPlanData(state, 'bank');

    // STAGE2目標: 2000万円
    expect(planData.stage56.companyTargetRevenue).toContain('2000万円');
    // STAGE4効果合計: 300万円（参考値）
    expect(planData.stage56.projectImpactSum).toContain('¥300M');

    // ★ 両者は完全に分離
    expect(planData.stage56.companyTargetRevenue).not.toEqual(
      planData.stage56.projectImpactSum
    );

    // 推奨表示はSTAGE2を優先
    expect(planData.stage56.northStarRevenue).toBe('2000万円（2025年）');
  });
});

// ★ テストケース5: 財務PLのゼロ・赤字・未入力
describe('buildPlanData - 財務データの値の扱い', () => {
  it('should correctly handle zero and negative values', () => {
    const state: any = {
      companyName: '株式会社テスト5',
      financePL: [
        { year: 2024, revenue: 1000, operatingIncome: 100 },
        { year: 2023, revenue: 0, operatingIncome: -50 }, // ゼロと赤字
        { year: 2022, revenue: 800 }, // operatingIncomeなし（未入力）
      ],
      departments: [],
    };

    const planData = buildPlanData(state, 'bank');

    // historicalFinances が抽出されているか
    expect(planData.stage1.historicalFinances).toBeDefined();
    expect(planData.stage1.historicalFinances?.length).toBe(3);

    // ゼロ値と未定義を区別
    const y2023 = planData.stage1.historicalFinances?.find((f: any) => f.year === 2023);
    expect(y2023?.revenue).toBe(0); // ゼロ値を保持
    expect(y2023?.operatingIncome).toBe(-50); // 赤字を保持
    expect(y2023?.warning).toContain('保存単位が確定されていません');

    const y2022 = planData.stage1.historicalFinances?.find((f: any) => f.year === 2022);
    expect(y2022?.operatingIncome).toBeUndefined(); // 未入力は undefined
  });
});

// ★ テストケース6: 金額単位未確定の警告
describe('buildPlanData - 単位未確定の警告', () => {
  it('should mark unit as uncertain with warning', () => {
    const state: any = {
      companyName: '株式会社テスト6',
      financePL: [
        { year: 2024, revenue: 500, operatingIncome: 50 },
      ],
      departments: [],
    };

    const planData = buildPlanData(state, 'bank');

    const finance = planData.stage1.historicalFinances?.[0];
    // ★ 単位は「未確認」と明示
    expect(finance?.unit).toBe('未確認');
    // ★ 警告メッセージが含まれる
    expect(finance?.warning).toContain('⚠️');
    expect(finance?.warning).toContain('参考情報');
  });
});

// ★ テストケース7: finance_summary の形式（Phase 2以降対象）
describe('buildPlanData - finance_summary の取得', () => {
  it('should safely handle missing finance_summary', () => {
    const state: any = {
      companyName: '株式会社テスト7',
      financeSummary: undefined,
      departments: [],
    };

    const planData = buildPlanData(state, 'bank');

    // financeSummary がなくてもエラーにならない
    expect(planData.stage56.projectionStatus).toBe('incomplete');
  });
});

// ★ テストケース8: 銀行・株主・社員向けの出力
describe('buildPlanData - audience別出力', () => {
  const baseState: any = {
    companyName: 'テスト企業',
    companyTargets: [
      { id: 't1', label: '売上高', base: 1000, unit: '万円', dueYear: 2025 },
    ],
    departments: [],
  };

  it('should work with bank audience', () => {
    const planData = buildPlanData(baseState, 'bank');
    expect(planData.audience).toBe('bank');
    expect(planData.stage56.companyTargetRevenue).toBeDefined();
  });

  it('should work with shareholder audience', () => {
    const planData = buildPlanData(baseState, 'shareholder');
    expect(planData.audience).toBe('shareholder');
    expect(planData.stage56.companyTargetRevenue).toBeDefined();
  });

  it('should work with employee audience', () => {
    const planData = buildPlanData(baseState, 'employee');
    expect(planData.audience).toBe('employee');
    expect(planData.stage56.companyTargetRevenue).toBeDefined();
  });
});

// ★ テストケース9: 会社IDとstrategyIDの保持
describe('buildPlanData - 会社別分離の維持', () => {
  it('should preserve company and strategy IDs', () => {
    const state: any = {
      companyName: 'テスト企業',
      companyId: 'company-123',
      strategyId: 'strategy-456',
      departments: [],
    };

    const planData = buildPlanData(state, 'bank', {
      companyId: 'company-123',
      strategyId: 'strategy-456',
    });

    expect(planData.companyId).toBe('company-123');
    expect(planData.strategyId).toBe('strategy-456');
  });
});

// ★ テストケース10: 既存の認証・会社別分離ロジックの確認
describe('buildPlanData - データ完全性', () => {
  it('should not expose sensitive data', () => {
    const state: any = {
      companyName: '秘密企業',
      companyId: 'secret-id',
      companyTargets: [
        { id: 't1', label: '売上高', base: 5000, unit: '万円' },
      ],
      departments: [],
    };

    const planData = buildPlanData(state, 'bank');

    // companyIdはoptions経由でのみ設定（directには含まれない）
    // （つまり、direct state から漏れない）
    expect(planData.companyId).toBeUndefined(); // options で設定されていないため
  });
});
