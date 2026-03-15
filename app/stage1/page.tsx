// /app/stage1/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { restoreWithAudit } from '@/utils/persist/restoreWithAudit';
import { useAutoSave } from '@/hooks/useAutoSave';
import StrategyGuard from '@/app/StrategyGuard';

import SaveStatusIndicator from '@/components/SaveStatusIndicator';
import CompanyAndBusinessPanel from '@/components/stage1/CompanyAndBusinessPanel';
import FinanceDataPanel from '@/components/stage1/FinanceDataPanel';
import MetricsPanel from '@/components/stage1/MetricsPanel';
import Stage1BenchmarkPanel from '@/components/stage1/Stage1BenchmarkPanel';
import Stage1ToStage2Panel from '@/components/stage1/Stage1ToStage2Panel';
import ListingInfoPanel from '@/components/stage1/ListingInfoPanel';
import WaccPanel from '@/components/stage1/WaccPanel';

type SaveState = 'idle' | 'saving' | 'success' | 'error';
type TabType = 'input' | 'analysis';

/* ===============================
 * SectionCard（折りたたみコンポーネント）
 * =============================== */
function SectionCard({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition rounded-lg"
      >
        <div className="font-semibold text-left">{title}</div>
        <div className="text-gray-600">{isOpen ? '▼' : '▶'}</div>
      </button>
      {isOpen && <div className="p-4">{children}</div>}
    </div>
  );
}

function safeKeysCount(v: unknown): number {
  if (!v || typeof v !== 'object') return 0;
  return Object.keys(v as Record<string, unknown>).length;
}

function stableSerialize(value: unknown): string {
  const seen = new WeakSet();

  const sortValue = (input: unknown): unknown => {
    if (input === null || input === undefined) return input;
    if (typeof input !== 'object') return input;

    if (seen.has(input as object)) return '[Circular]';
    seen.add(input as object);

    if (Array.isArray(input)) {
      return input.map((item) => sortValue(item));
    }

    const obj = input as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = sortValue(obj[key]);
    }
    return result;
  };

  try {
    return JSON.stringify(sortValue(value)) ?? '';
  } catch {
    return '';
  }
}

export default function Stage1Page() {
  // ===== 保存導線（store側の名前揺れを許容） =====
  const saveFn = useStrategyStore((s: StrategyState) =>
    ((s as any).saveToSupabase ||
      (s as any).saveStrategyData ||
      (s as any).saveToServer ||
      (s as any).persistToSupabase) as ((src?: string) => Promise<any>) | undefined
  );

  const strategyId = useStrategyStore((s: StrategyState) => (s as any).strategyId as string | undefined);
  const revision = useStrategyStore((s: StrategyState) => (s as any).revision as number | undefined);

  // ===== 変更検知（オブジェクトを返すselectorを作らない） =====
  const companyName = useStrategyStore((s: StrategyState) => ((s as any).companyName ?? '') as string);
  const industry = useStrategyStore((s: StrategyState) => ((s as any).industry ?? '') as string);

  const businessSegmentsCount = useStrategyStore((s: StrategyState) =>
    Array.isArray((s as any).businessSegments) ? (s as any).businessSegments.length : 0
  );

  const issuesCount = useStrategyStore((s: StrategyState) =>
    Array.isArray((s as any).stage1Issues) ? (s as any).stage1Issues.length : 0
  );

  const financeSummaryCount = useStrategyStore((s: StrategyState) =>
    Array.isArray((s as any).financeSummary) ? (s as any).financeSummary.length : 0
  );

  // ★ 修正：Stage1 上場情報・ベンチマーク・WACC を自動保存の監視対象に追加
  const isListed = useStrategyStore((s: StrategyState) => (s as any).isListed ?? false);
  const ticker = useStrategyStore((s: StrategyState) => ((s as any).ticker ?? '') as string);
  const pbrManual = useStrategyStore((s: StrategyState) => ((s as any).pbrManual ?? '') as string);
  const stage1BenchmarksKey = useStrategyStore((s: StrategyState) => {
    const benchmarks = (s as any).stage1Benchmarks;
    if (!benchmarks || typeof benchmarks !== 'object') return '';
    return stableSerialize(benchmarks);
  });

  // ★ 追加：PL/BS 本体の「内容」変更を検知
  const financePLDataHash = useStrategyStore((s: StrategyState) => {
    try {
      return stableSerialize((s as any).financePL ?? []);
    } catch {
      return '';
    }
  });

  const financeBSDataHash = useStrategyStore((s: StrategyState) => {
    try {
      return stableSerialize((s as any).financeBS ?? []);
    } catch {
      return '';
    }
  });

  // ★ 追加：segmentPL/segmentBS も件数ではなく「内容」変更を検知
  const segmentPLDataHash = useStrategyStore((s: StrategyState) => {
    try {
      return stableSerialize((s as any).segmentPL ?? {});
    } catch {
      return '';
    }
  });

  const segmentBSDataHash = useStrategyStore((s: StrategyState) => {
    try {
      return stableSerialize((s as any).segmentBS ?? {});
    } catch {
      return '';
    }
  });

  // 参考用にキー数も残す（ログ/診断向け）
  const segmentPLKeysCount = useStrategyStore((s: StrategyState) => safeKeysCount((s as any).segmentPL));
  const segmentBSKeysCount = useStrategyStore((s: StrategyState) => safeKeysCount((s as any).segmentBS));

  // ===== 復元関連（TASK 6: STAGE1 統合） =====
  const companyId = useUserStore((s) => (s as any).companyId as string | undefined);
  const didRestoreRef = useRef(false);

  // ★ Stage1 自動保存の有効化
  useAutoSave({
    enabled: !!companyId,
    requireHydrated: true,
    requireSession: true,
    debounceMs: 1200,
    minIntervalMs: 1500,
    mode: 'payload',
  });

  // ★ useAutoSave マウント確認ログ（useEffect で StrictMode 二重ログを回避）
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
      console.log('[Stage1Page] useAutoSave mounted', { companyId, mode: 'payload' });
    }
  }, [companyId]);

  // UI State
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabType>('input');

  const savingRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const lastKeyRef = useRef<string>('');

  const snapshotKey = useMemo(() => {
    return JSON.stringify({
      companyName,
      industry,
      businessSegmentsCount,
      financePLDataHash,
      financeBSDataHash,
      segmentPLKeysCount,
      segmentBSKeysCount,
      segmentPLDataHash,
      segmentBSDataHash,
      financeSummaryCount,
      issuesCount,
      isListed,
      ticker,
      pbrManual,
      stage1BenchmarksKey,
    });
  }, [
    companyName,
    industry,
    businessSegmentsCount,
    financePLDataHash,
    financeBSDataHash,
    segmentPLKeysCount,
    segmentBSKeysCount,
    segmentPLDataHash,
    segmentBSDataHash,
    financeSummaryCount,
    issuesCount,
    isListed,
    ticker,
    pbrManual,
    stage1BenchmarksKey,
  ]);

  const doSave = useCallback(
    async (reason: string) => {
      if (!saveFn) {
        console.warn('[stage1/save] save function not found in store');
        setSaveState('error');
        setSaveMessage('保存関数がstoreに見つかりません（saveToSupabase / saveStrategyData など）');
        return;
      }
      if (savingRef.current) return;

      savingRef.current = true;
      setSaveState('saving');
      setSaveMessage('');

      const isManual = reason === 'manual';

      if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
        const currentState = useStrategyStore.getState();
        const busSegLen = Array.isArray((currentState as any).businessSegments)
          ? (currentState as any).businessSegments.length
          : 0;
        const segPLKeys =
          (currentState as any).segmentPL && typeof (currentState as any).segmentPL === 'object'
            ? Object.keys((currentState as any).segmentPL).length
            : 0;
        const segBSKeys =
          (currentState as any).segmentBS && typeof (currentState as any).segmentBS === 'object'
            ? Object.keys((currentState as any).segmentBS).length
            : 0;
        const finBSLen = Array.isArray((currentState as any).financeBS) ? (currentState as any).financeBS.length : 0;
        const finPLLen = Array.isArray((currentState as any).financePL) ? (currentState as any).financePL.length : 0;

        console.log('[stage1/save] ★ pre-save state check', {
          reason,
          isManual,
          dirty: (currentState as any).dirty,
          businessSegments_len: busSegLen,
          segmentPL_keys: segPLKeys,
          segmentBS_keys: segBSKeys,
          financeBS_len: finBSLen,
          financePL_len: finPLLen,
        });
      }

      console.log('[stage1/save] start', { reason, isManual, strategyId, revision });

      try {
        const res = await (saveFn as any)({ reason: `stage1:${reason}`, force: isManual });
        console.log('[stage1/save] success', res);
        setSaveState('success');
        setSaveMessage('保存しました');
        window.setTimeout(() => {
          setSaveState('idle');
          setSaveMessage('');
        }, 1500);
      } catch (e) {
        console.error('[stage1/save] failed', e);
        setSaveState('error');
        setSaveMessage('保存に失敗しました（consoleのエラーを確認してください）');
      } finally {
        savingRef.current = false;
      }
    },
    [saveFn, strategyId, revision]
  );

  // 自動保存（変更検知→debounce）
  useEffect(() => {
    if (!saveFn) return;

    if (!lastKeyRef.current) {
      lastKeyRef.current = snapshotKey;
      console.log('[stage1/autosave] armed', { strategyId, revision });
      return;
    }

    if (snapshotKey === lastKeyRef.current) return;
    lastKeyRef.current = snapshotKey;

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(() => {
      doSave('autosave');
    }, 1200);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [snapshotKey, saveFn, doSave, strategyId, revision]);

  // ===== 復元初期化（TASK 6: STAGE1 統合） =====
  const restoreStage1Snapshot = useCallback(async (decision: any) => {
    if (decision.sourceUsed === 'snapshot' && decision.snapshotData?.state) {
      const st = decision.snapshotData.state;
      const store = useStrategyStore.getState();

      if (st.companyName && !store.companyName) {
        (store as any).setCompanyName?.(st.companyName);
      }
      if (st.industry && !store.industry) {
        (store as any).setIndustry?.(st.industry);
      }
      if (st.businessSegments && Array.isArray(st.businessSegments)) {
        (store as any).setBusinessSegments?.(st.businessSegments);
      }
      if (st.financePL && Array.isArray(st.financePL)) {
        (store as any).setFinancePL?.(st.financePL);
      }
      if (st.financeBS && Array.isArray(st.financeBS)) {
        (store as any).setFinanceBS?.(st.financeBS);
      }
      if (st.segmentPL && typeof st.segmentPL === 'object') {
        (store as any).setSegmentPL?.(st.segmentPL);
      }
      if (st.segmentBS && typeof st.segmentBS === 'object') {
        (store as any).setSegmentBS?.(st.segmentBS);
      }
      if (st.stage1Issues && Array.isArray(st.stage1Issues)) {
        (store as any).setStage1Issues?.(st.stage1Issues);
      }
      if (st.financeSummary && Array.isArray(st.financeSummary)) {
        (store as any).setFinanceSummary?.(st.financeSummary);
      }

      console.log(
        `[audit][restore:done] decisionId=${decision.decisionId} sourceUsed=snapshot stage=stage1 strategyId=${st.id}`,
      );
    } else if (decision.sourceUsed === 'db' || decision.sourceUsed === 'store') {
      console.log(
        `[audit][restore:done] decisionId=${decision.decisionId} sourceUsed=${decision.sourceUsed} stage=stage1 strategyId=${decision.strategyId}`,
      );
    } else {
      console.log(`[audit][restore:done] decisionId=${decision.decisionId} sourceUsed=${decision.sourceUsed} stage=stage1`);
    }
  }, []);

  useEffect(() => {
    if (didRestoreRef.current) return;
    if (!companyId) {
      console.log('[stage1/restore] deferring: companyId not ready');
      return;
    }

    didRestoreRef.current = true;

    (async () => {
      try {
        const decision = await restoreWithAudit('stage1', companyId, { allowSnapshot: true });
        console.log('[stage1/restore] decision received', {
          decisionId: decision.decisionId,
          sourceUsed: decision.sourceUsed,
          reason: decision.reason,
        });

        const store = useStrategyStore.getState();
        if (decision.strategyId && decision.strategyId !== (store as any).id) {
          (store as any).setStrategyId?.(decision.strategyId);
        }
        if (decision.revision != null && decision.revision !== (store as any).revision) {
          (store as any).setRevision?.(decision.revision);
        }

        await restoreStage1Snapshot(decision);
      } catch (err) {
        console.error('[stage1/restore] error', err);
      }
    })();
  }, [companyId, restoreStage1Snapshot]);

  const saveBtnLabel =
    saveState === 'saving' ? '保存中…' : saveState === 'success' ? '保存済' : '保存';

  const saveBtnClass =
    saveState === 'saving'
      ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
      : saveState === 'success'
        ? 'bg-green-600 text-white'
        : saveState === 'error'
          ? 'bg-red-600 text-white'
          : 'bg-blue-600 text-white hover:bg-blue-700';

  return (
    <StrategyGuard mode="edit">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">STAGE1｜企業価値分析</h1>
            <p className="text-sm text-gray-600 mt-2">
              財務情報から企業価値の現状を整理し、経営戦略の論点を明確にします。
            </p>

            {saveMessage && (
              <div className={`text-xs mt-2 ${saveState === 'error' ? 'text-red-600' : 'text-green-700'}`}>
                {saveMessage}
              </div>
            )}
          </div>

          <div className="shrink-0 flex flex-col items-end gap-3">
            <SaveStatusIndicator />
            {!saveFn && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                storeに保存関数が見つかりません。strategyStore.ts に saveToSupabase / saveStrategyData
                等があるか確認してください。
              </div>
            )}
          </div>
        </header>

        {/* ========== タブUI ========== */}
        <div className="border-b">
          <div className="flex gap-4">
            {['input', 'analysis'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as TabType)}
                className={`px-4 py-3 font-semibold text-sm border-b-2 transition ${
                  activeTab === tab
                    ? 'text-blue-600 border-blue-600'
                    : 'text-gray-600 border-transparent hover:text-gray-700'
                }`}
              >
                {tab === 'input' ? '入力' : '分析・論点'}
              </button>
            ))}
          </div>
        </div>

        {/* ========== タブ内容：入力 ========== */}
        {activeTab === 'input' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
              <div className="font-semibold mb-1">入力画面でやること</div>
              <div className="text-xs leading-relaxed">
                1. 企業情報・事業内容の入力
                <br />
                2. 会社全体、事業別のBS/PLの入力
                <br />
                3. 上場情報・ベンチマーク・WACC（任意）の入力
              </div>
            </div>

            <SectionCard title="① 企業情報・事業内容" defaultOpen={false}>
              <CompanyAndBusinessPanel />
            </SectionCard>

            <SectionCard title="② 財務データ（読込・手入力）" defaultOpen={false}>
              <FinanceDataPanel />
            </SectionCard>

            <SectionCard title="③ 上場情報・外部ベンチマーク・WACC（任意）" defaultOpen={false}>
              <div className="space-y-6">
                <ListingInfoPanel />
                <div className="border-t border-gray-200 pt-4">
                  <Stage1BenchmarkPanel />
                </div>
                <div className="border-t border-gray-200 pt-4">
                  <WaccPanel />
                </div>
              </div>
            </SectionCard>
          </div>
        )}

        {/* ========== タブ内容：分析・論点 ========== */}
        {activeTab === 'analysis' && (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-900">
              <div className="font-semibold mb-1">分析・論点でやること</div>
              <div className="text-xs leading-relaxed">
                1. 「財務指標」で計算結果を確認
                <br />
                2. 「論点整理」で経営課題・機会を議論し、「STAGE2へ」進む
              </div>
            </div>

            <SectionCard title="① 財務指標" defaultOpen={false}>
              <MetricsPanel />
            </SectionCard>

            <SectionCard title="② 論点整理 + STAGE2へ" defaultOpen={false}>
              <Stage1ToStage2Panel />
            </SectionCard>
          </div>
        )}
      </div>
    </StrategyGuard>
  );
}