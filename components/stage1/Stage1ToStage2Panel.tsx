// /components/stage1/Stage1ToStage2Panel.tsx
'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import type { BusinessPortfolio, ValueAnalysis, FinancePLRow, BusinessSegment } from '@/types/strategy';
import { buildBusinessPortfolio } from '@/lib/stage1/businessPortfolio';
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
  const computedBusinessPortfolio = useMemo<BusinessPortfolio | null>(
    () => buildBusinessPortfolio({ segments: businessSegments, segmentValueAnalysis: segmentValueAnalysisRaw, segmentPL }),
    [businessSegments, segmentValueAnalysisRaw, segmentPL],
  );

  /**
   * ★ STAGE2 遷移時に businessPortfolio を確定して store に保存
   */
  useEffect(() => {
    if (!canProceedToStage2 || !computedBusinessPortfolio || !setBusinessPortfolio) return;

    const bp = computedBusinessPortfolio;
    const unitsLen = Array.isArray(bp.units) ? bp.units.length : 0;

    // ★ 修正：JSON.stringify の key 順序による誤判定を防ぐ
    // フィールドごとに意味的な比較を行う
    const current = useStrategyStore.getState().businessPortfolio;
    const isSameContent =
      current?.periodLabel === bp.periodLabel &&
      current?.currency === bp.currency &&
      current?.unitType === bp.unitType &&
      JSON.stringify(current?.threshold) === JSON.stringify(bp.threshold) &&
      JSON.stringify(current?.units) === JSON.stringify(bp.units);

    // units が 1件以上あれば保存
    if (unitsLen > 0) {
      // ★ 修正：内容が同一の場合はセッターを呼ばない
      if (isSameContent) {
        return;
      }

      setBusinessPortfolio(bp);
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
          <div className="text-sm text-gray-600 mb-4">
            {canProceedToStage2 ? (
              <>
                <span className="text-success font-medium">✓ 論点が {stage1Issues.length} 件選択されています。</span>
                <br />
                下記ボタンで STAGE2（経営戦略策定）へ進みます。
                {computedBusinessPortfolio && Array.isArray(computedBusinessPortfolio.units) && computedBusinessPortfolio.units.length > 0 && (
                  <div className="text-xs text-success mt-2">
                    事業ポートフォリオも確定しました（{computedBusinessPortfolio.units.length}件）。
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="text-caution font-medium">⚠ 論点が未選択です。</span>
                <br />
                上記で論点を選択してから、下記ボタンを有効にしてください。
              </>
            )}
          </div>
          <div className="opacity-100">
            <Stage2Bridge disabled={!canProceedToStage2} />
          </div>
        </div>
      </div>
    </div>
  );
}
