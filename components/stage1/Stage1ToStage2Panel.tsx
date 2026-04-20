// /components/stage1/Stage1ToStage2Panel.tsx
'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import type { BusinessPortfolio, BusinessUnit, ValueAnalysis, FinancePLRow, BusinessSegment } from '@/types/strategy';
import IssueBlockPanel from './IssueBlockPanel';
import Stage2Bridge from './Stage2Bridge';

/**
 * ② 論点整理 + STAGE2へ 統合パネル
 * - IssueBlockPanel で論点選択
 * - 下部に Stage2Bridge（論点未選択なら disabled）
 * ★ STAGE1 終了時に businessPortfolio を確定・保存（MetricsPanel の分析結果から構築）
 */
export default function Stage1ToStage2Panel({ readOnly, disabled }: { readOnly?: boolean; disabled?: boolean }) {
  const stage1Issues = useStrategyStore((s: StrategyState) => s.stage1Issues ?? []);
  const setBusinessPortfolio = useStrategyStore((s: StrategyState) => (s as any).setBusinessPortfolio as ((p: BusinessPortfolio) => void) | undefined);

  // MetricsPanel から businessPortfolio 構築に必要なデータ取得
  const segmentValueAnalysisRaw = useStrategyStore((s: StrategyState) => (s as any).segmentValueAnalysis as Record<string, ValueAnalysis> | undefined);
  const segmentPL = useStrategyStore((s: StrategyState) => ((s as any).segmentPL ?? {}) as Record<string, FinancePLRow[]>);
  const businessSegments = useStrategyStore((s: StrategyState) => (((s as any).businessSegments ?? []) as BusinessSegment[]));

  // 論点が未選択の場合、遷移ボタン disabled
  const hasIssues = stage1Issues.length > 0;
  // disabled か問題がなければ Stage2 へ遷移可能
  const canProceedToStage2 = !disabled && hasIssues;

  /**
   * ★ businessPortfolio 構築：segmentValueAnalysis から BusinessUnit 配列を生成
   * - 各セグメント（事業部）を growthRate / profitMargin / revenueShare で表現
   * - units が存在すれば businessPortfolio として store に保存
   */
  const computedBusinessPortfolio = useMemo<BusinessPortfolio | null>(() => {
    const segmentNames = businessSegments?.map((s: any) => s?.name).filter(Boolean) ?? [];
    if (segmentNames.length === 0) return null;

    const units: BusinessUnit[] = [];

    for (const name of segmentNames) {
      const va = segmentValueAnalysisRaw?.[name];
      const rows = segmentPL?.[name];

      // 成長率（CAGR）と利益率を取得
      const growthRate = typeof (va as any)?.revenueCagrPct === 'number' ? (va as any).revenueCagrPct : 0;
      const profitMargin = typeof (va as any)?.operatingMarginPctLatest === 'number' ? (va as any).operatingMarginPctLatest : 0;

      // 最新年の売上を取得（revenueShare の基準値として使用）
      let latestRevenue = 0;
      if (Array.isArray(rows) && rows.length > 0) {
        const lastRow = rows[rows.length - 1];
        latestRevenue = typeof (lastRow as any)?.revenue === 'number' ? (lastRow as any).revenue : 0;
      }

      const unit: BusinessUnit = {
        id: name || `unit-${units.length}`,
        name: name || `Unit ${units.length + 1}`,
        growthRate,
        profitMargin,
        revenueShare: latestRevenue > 0 ? 100 / segmentNames.length : 0, // 均等配分（簡易）
      };
      units.push(unit);
    }

    // units が 1件以上あれば businessPortfolio を返す
    if (units.length > 0) {
      const portfolio: BusinessPortfolio = {
        unitType: 'business',
        periodLabel: 'FY2025',
        currency: 'JPY',
        threshold: {
          growthBaseline: 0,
          profitBaseline: 0,
        },
        units,
      };
      return portfolio;
    }

    return null;
  }, [businessSegments, segmentValueAnalysisRaw, segmentPL]);

  /**
   * ★ STAGE2 遷移時に businessPortfolio を確定して store に保存
   */
  useEffect(() => {
    if (!canProceedToStage2 || !computedBusinessPortfolio || !setBusinessPortfolio) return;

    // businessPortfolio をstore に保存
    const bp = computedBusinessPortfolio;
    const unitsLen = Array.isArray(bp.units) ? bp.units.length : 0;

    console.log('[Stage1ToStage2Panel] ★ businessPortfolio確定', {
      timestamp: new Date().toISOString(),
      businessPortfolio_type: typeof bp,
      businessPortfolio_shape: {
        unitType: bp.unitType,
        periodLabel: bp.periodLabel,
        currency: bp.currency,
        threshold: bp.threshold,
        units_len: unitsLen,
      },
      units_detail: unitsLen > 0 ? bp.units?.slice(0, 2).map((u) => ({
        id: u.id,
        name: u.name,
        growthRate: u.growthRate,
        profitMargin: u.profitMargin,
        revenueShare: u.revenueShare,
      })) : [],
    });

    // units が 1件以上あれば保存
    if (unitsLen > 0) {
      setBusinessPortfolio(bp);
      console.log('[Stage1ToStage2Panel] ✅ businessPortfolio saved to store', {
        units_count: unitsLen,
      });
    } else {
      console.warn('[Stage1ToStage2Panel] ⚠️ businessPortfolio units empty, skipped save');
    }
  }, [canProceedToStage2, computedBusinessPortfolio, setBusinessPortfolio]);

  return (
    <div className="space-y-6">
      {/* 論点整理パネル */}
      <div>
        <h3 className="text-lg font-semibold mb-4">論点整理</h3>
        <IssueBlockPanel disabled={disabled} />
      </div>

      {/* 分割線 */}
      <div className="border-t border-gray-200 pt-6">
        {/* STAGE2へ遷移 */}
        <div>
          <h3 className="text-lg font-semibold mb-4">次のフェーズへ</h3>
          <p className="text-sm text-gray-600 mb-4">
            {canProceedToStage2 ? (
              <>
                <span className="text-green-700 font-medium">✓ 論点が {stage1Issues.length} 件選択されています。</span>
                <br />
                下記ボタンで STAGE2（経営戦略策定）へ進みます。
                {computedBusinessPortfolio && Array.isArray(computedBusinessPortfolio.units) && computedBusinessPortfolio.units.length > 0 && (
                  <div className="text-xs text-green-600 mt-2">
                    事業ポートフォリオも確定しました（{computedBusinessPortfolio.units.length}件）。
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="text-amber-700 font-medium">⚠ 論点が未選択です。</span>
                <br />
                上記で論点を選択してから、下記ボタンを有効にしてください。
              </>
            )}
          </p>
          <div className="opacity-100">
            <Stage2Bridge disabled={!canProceedToStage2} />
          </div>
        </div>
      </div>
    </div>
  );
}
