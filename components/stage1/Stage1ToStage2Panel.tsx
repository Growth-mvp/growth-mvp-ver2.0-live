// /components/stage1/Stage1ToStage2Panel.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
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
  const effectRunCountRef = useRef<number>(0);
  const setBPCallCountRef = useRef<number>(0);
  const prevDepsRef = useRef<{
    businessSegmentsHash: string;
    segmentValueAnalysisHash: string;
    segmentPLHash: string;
  } | null>(null);

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
    // ★ 依存配列の変化をトラッキング
    const currBusinessSegmentsHash = JSON.stringify(businessSegments ?? []).substring(0, 50);
    const currSegmentValueAnalysisHash = JSON.stringify(segmentValueAnalysisRaw ?? {}).substring(0, 50);
    const currSegmentPLHash = JSON.stringify(segmentPL ?? {}).substring(0, 50);

    const currDeps = {
      businessSegmentsHash: currBusinessSegmentsHash,
      segmentValueAnalysisHash: currSegmentValueAnalysisHash,
      segmentPLHash: currSegmentPLHash,
    };

    const depsChanged = !prevDepsRef.current || (
      prevDepsRef.current.businessSegmentsHash !== currDeps.businessSegmentsHash ||
      prevDepsRef.current.segmentValueAnalysisHash !== currDeps.segmentValueAnalysisHash ||
      prevDepsRef.current.segmentPLHash !== currDeps.segmentPLHash
    );

    if (depsChanged) {
      console.log('[Stage1ToStage2Panel] computedBusinessPortfolio useMemo triggered', {
        timestamp: new Date().toISOString(),
        businessSegmentsChanged: !prevDepsRef.current || prevDepsRef.current.businessSegmentsHash !== currDeps.businessSegmentsHash,
        segmentValueAnalysisChanged: !prevDepsRef.current || prevDepsRef.current.segmentValueAnalysisHash !== currDeps.segmentValueAnalysisHash,
        segmentPLChanged: !prevDepsRef.current || prevDepsRef.current.segmentPLHash !== currDeps.segmentPLHash,
        businessSegmentsLen: Array.isArray(businessSegments) ? businessSegments.length : 0,
        segmentValueAnalysisKeys: Object.keys(segmentValueAnalysisRaw ?? {}).length,
        segmentPLKeys: Object.keys(segmentPL ?? {}).length,
      });
      prevDepsRef.current = currDeps;
    }
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
    effectRunCountRef.current++;
    const effectRunCount = effectRunCountRef.current;

    const storeBeforeEffect = useStrategyStore.getState();
    const dirtyBefore = storeBeforeEffect.dirty;
    const prevBusinessPortfolioStr = JSON.stringify(storeBeforeEffect.businessPortfolio ?? null);

    // ★ 調査：useEffect が発火する直接的な原因を特定
    console.log('[STAGE1-DIRTY-TRACE] useEffect dependency trigger reason', {
      timestamp: new Date().toISOString(),
      effectRunCount,
      canProceedToStage2Changed: undefined, // これは比較できない（値が参照ごとに変わるため）
      computedBusinessPortfolioChanged: undefined,
      setBusinessPortfolioChanged: undefined,
      // 代わりに、現在の値を記録
      canProceedToStage2Value: canProceedToStage2,
      computedBPNull: !computedBusinessPortfolio,
      setBPFuncNull: !setBusinessPortfolio,
    });

    console.log('[STAGE1-DIRTY-TRACE] Stage1ToStage2Panel useEffect entered', {
      timestamp: new Date().toISOString(),
      effectRunCount,
      canProceedToStage2,
      hasComputedBP: !!computedBusinessPortfolio,
      hasSetBPFunc: !!setBusinessPortfolio,
      dirtyBefore,
      hasIssues: stage1Issues.length,
      storeBusinessPortfolioLen: prevBusinessPortfolioStr.length,
      storeBusinessPortfolioPreview: prevBusinessPortfolioStr.substring(0, 100),
    });

    if (!canProceedToStage2 || !computedBusinessPortfolio || !setBusinessPortfolio) {
      console.log('[STAGE1-DIRTY-TRACE] useEffect guarded-return', {
        timestamp: new Date().toISOString(),
        effectRunCount,
        reason: !canProceedToStage2 ? 'canProceedToStage2=false' : !computedBusinessPortfolio ? 'no computedBP' : 'no setBusinessPortfolio',
        dirtyAfterGuard: useStrategyStore.getState().dirty,
      });
      return;
    }

    // businessPortfolio をstore に保存
    const bp = computedBusinessPortfolio;
    const unitsLen = Array.isArray(bp.units) ? bp.units.length : 0;
    const computedBPStr = JSON.stringify(bp);
    const isSameContent = prevBusinessPortfolioStr === computedBPStr;

    // ★ 実値 diff 出力
    let valueDiff: Record<string, { before: any; after: any }> = {};
    if (!isSameContent) {
      try {
        const prevBP = prevBusinessPortfolioStr ? JSON.parse(prevBusinessPortfolioStr) : null;
        const nextBP = bp;

        // units の詳細比較
        if (Array.isArray(prevBP?.units) && Array.isArray(nextBP?.units)) {
          if (prevBP.units.length !== nextBP.units.length) {
            valueDiff['units.length'] = {
              before: prevBP.units.length,
              after: nextBP.units.length,
            };
          }
          // 各 unit の内容比較
          for (let i = 0; i < Math.max(prevBP.units.length, nextBP.units.length); i++) {
            const prevUnit = prevBP.units[i];
            const nextUnit = nextBP.units[i];
            if (JSON.stringify(prevUnit) !== JSON.stringify(nextUnit)) {
              valueDiff[`units[${i}]`] = {
                before: prevUnit,
                after: nextUnit,
              };
            }
          }
        }

        // threshold の比較
        if (JSON.stringify(prevBP?.threshold) !== JSON.stringify(nextBP?.threshold)) {
          valueDiff['threshold'] = {
            before: prevBP?.threshold,
            after: nextBP?.threshold,
          };
        }

        // その他のフィールド
        ['unitType', 'periodLabel', 'currency'].forEach((key) => {
          if (prevBP?.[key] !== nextBP?.[key]) {
            valueDiff[key] = {
              before: prevBP?.[key],
              after: nextBP?.[key],
            };
          }
        });
      } catch (e) {
        console.warn('[Stage1ToStage2Panel] failed to compute diff:', e);
      }
    }

    console.log('[Stage1ToStage2Panel] ★ businessPortfolio確定', {
      timestamp: new Date().toISOString(),
      effectRunCount,
      businessPortfolio_type: typeof bp,
      businessPortfolio_shape: {
        unitType: bp.unitType,
        periodLabel: bp.periodLabel,
        currency: bp.currency,
        threshold: bp.threshold,
        units_len: unitsLen,
      },
      units_detail: unitsLen > 0 ? bp.units?.slice(0, 2).map((u: BusinessUnit) => ({
        id: u.id,
        name: u.name,
        growthRate: u.growthRate,
        profitMargin: u.profitMargin,
        revenueShare: u.revenueShare,
      })) : [],
      contentComparison: {
        isSameContent,
        prevLen: prevBusinessPortfolioStr.length,
        computedLen: computedBPStr.length,
      },
      valueDiff: Object.keys(valueDiff).length > 0 ? valueDiff : 'no changes',
    });

    // units が 1件以上あれば保存
    if (unitsLen > 0) {
      const setBPCount = ++setBPCallCountRef.current;

      console.log('[STAGE1-DIRTY-TRACE] before setBusinessPortfolio', {
        timestamp: new Date().toISOString(),
        effectRunCount,
        setBPCallCount: setBPCount,
        dirtyBeforeSet: useStrategyStore.getState().dirty,
        isSameContent,
        units_count: unitsLen,
        stack: new Error().stack?.split('\n').slice(0, 4).join('\n'),
      });

      setBusinessPortfolio(bp);

      const storeAfterSet = useStrategyStore.getState();
      console.log('[STAGE1-DIRTY-TRACE] after setBusinessPortfolio (immediate)', {
        timestamp: new Date().toISOString(),
        effectRunCount,
        setBPCallCount: setBPCount,
        dirtyAfterSet: storeAfterSet.dirty,
        units_count: unitsLen,
        versionAfter: storeAfterSet.version,
      });

      // 100ms 後のチェック
      setTimeout(() => {
        const store100 = useStrategyStore.getState();
        console.log('[STAGE1-DIRTY-TRACE] after setBusinessPortfolio (100ms)', {
          timestamp: new Date().toISOString(),
          effectRunCount,
          setBPCallCount: setBPCount,
          dirty: store100.dirty,
          version: store100.version,
        });
      }, 100);

      console.log('[Stage1ToStage2Panel] ✅ businessPortfolio saved to store', {
        units_count: unitsLen,
        effectRunCount,
        setBPCallCount: setBPCallCountRef.current,
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
          <div className="text-sm text-gray-600 mb-4">
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
          </div>
          <div className="opacity-100">
            <Stage2Bridge disabled={!canProceedToStage2} />
          </div>
        </div>
      </div>
    </div>
  );
}
