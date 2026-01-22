// /app/stage1/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

import CompanyScopePanel from '@/components/stage1/CompanyScopePanel';
import BusinessSegmentsPanel from '@/components/stage1/BusinessSegmentsPanel';
import DocumentImportPanel from '@/components/stage1/DocumentImportPanel';
import FinanceInputPanel from '@/components/stage1/FinanceInputPanel';
import MetricsPanel from '@/components/stage1/MetricsPanel';
import IssueBlockPanel from '@/components/stage1/IssueBlockPanel';
import Stage2Bridge from '@/components/stage1/Stage2Bridge';

type SaveState = 'idle' | 'saving' | 'success' | 'error';

function safeKeysCount(v: unknown): number {
  if (!v || typeof v !== 'object') return 0;
  return Object.keys(v as Record<string, unknown>).length;
}

export default function Stage1Page() {
  // ===== 保存導線（store側の名前揺れを許容） =====
  const saveFn = useStrategyStore((s) =>
    ((s as any).saveToSupabase ||
      (s as any).saveStrategyData ||
      (s as any).saveToServer ||
      (s as any).persistToSupabase) as ((src?: string) => Promise<any>) | undefined
  );

  const strategyId = useStrategyStore((s) => (s as any).strategyId as string | undefined);
  const revision = useStrategyStore((s) => (s as any).revision as number | undefined);

  // ===== 変更検知（オブジェクトを返すselectorを作らない） =====
  const companyName = useStrategyStore((s) => ((s as any).companyName ?? '') as string);
  const industry = useStrategyStore((s) => ((s as any).industry ?? '') as string);

  const businessSegmentsCount = useStrategyStore((s) =>
    Array.isArray((s as any).businessSegments) ? (s as any).businessSegments.length : 0
  );

  const financePLCount = useStrategyStore((s) =>
    Array.isArray((s as any).financePL) ? (s as any).financePL.length : 0
  );
  const financeBSCount = useStrategyStore((s) =>
    Array.isArray((s as any).financeBS) ? (s as any).financeBS.length : 0
  );

  // segmentPL/segmentBS は object の可能性が高いので「キー数」で差分検知
  const segmentPLKeysCount = useStrategyStore((s) => safeKeysCount((s as any).segmentPL));
  const segmentBSKeysCount = useStrategyStore((s) => safeKeysCount((s as any).segmentBS));

  const issuesCount = useStrategyStore((s) =>
    Array.isArray((s as any).stage1Issues) ? (s as any).stage1Issues.length : 0
  );

  // （必要なら）financeSummaryの有無も差分検知
  const financeSummaryCount = useStrategyStore((s) =>
    Array.isArray((s as any).financeSummary) ? (s as any).financeSummary.length : 0
  );

  // 開発用：ダミーデータ投入（存在する場合のみ）
  const loadStage1DummyData = useStrategyStore((s) => (s as any).loadStage1DummyData as (() => void) | undefined);
  const [dummyLoaded, setDummyLoaded] = useState(false);

  // UI State
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = useState<string>('');

  const savingRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const lastKeyRef = useRef<string>('');

  // ★ segmentPL/segmentBS のデータ値も含める（データ内容変更を検知するため）
  const segmentPLDataHash = useStrategyStore((s) => {
    if (!s.segmentPL || typeof s.segmentPL !== 'object') return '';
    try {
      // 簡易ハッシュ：セグメント数 + 各セグメントの行数
      const hash = Object.entries((s as any).segmentPL)
        .map(([k, v]: [string, any]) => `${k}:${Array.isArray(v) ? v.length : 0}`)
        .join('|');
      return hash;
    } catch {
      return '';
    }
  });

  const segmentBSDataHash = useStrategyStore((s) => {
    if (!s.segmentBS || typeof s.segmentBS !== 'object') return '';
    try {
      const hash = Object.entries((s as any).segmentBS)
        .map(([k, v]: [string, any]) => `${k}:${Array.isArray(v) ? v.length : 0}`)
        .join('|');
      return hash;
    } catch {
      return '';
    }
  });

  const snapshotKey = useMemo(() => {
    // ここは「プリミティブ＋件数＋セグメントデータハッシュ」で生成（安定）
    return JSON.stringify({
      companyName,
      industry,
      businessSegmentsCount,
      financePLCount,
      financeBSCount,
      segmentPLKeysCount,
      segmentBSKeysCount,
      segmentPLDataHash,  // ★ データ値変更を検知
      segmentBSDataHash,  // ★ データ値変更を検知
      financeSummaryCount,
      issuesCount,
    });
  }, [
    companyName,
    industry,
    businessSegmentsCount,
    financePLCount,
    financeBSCount,
    segmentPLKeysCount,
    segmentBSKeysCount,
    segmentPLDataHash,
    segmentBSDataHash,
    financeSummaryCount,
    issuesCount,
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

      // ★ dirty判定前ログ（デバッグ用）
      if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
        const currentState = useStrategyStore.getState();
        const busSegLen = Array.isArray((currentState as any).businessSegments) ? (currentState as any).businessSegments.length : 0;
        const segPLKeys = (currentState as any).segmentPL && typeof (currentState as any).segmentPL === 'object'
          ? Object.keys((currentState as any).segmentPL).length : 0;
        const segBSKeys = (currentState as any).segmentBS && typeof (currentState as any).segmentBS === 'object'
          ? Object.keys((currentState as any).segmentBS).length : 0;
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
        // ★ manual 保存は force: true で dirty/hydrating をスキップ
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

    // 初回は基準キーをセットしてスキップ
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

  const handleLoadDummy = useCallback(() => {
    if (!loadStage1DummyData) return;
    loadStage1DummyData();
    setDummyLoaded(true);
    setTimeout(() => setDummyLoaded(false), 2000);
  }, [loadStage1DummyData]);

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
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">STAGE1｜企業価値分析</h1>
          <p className="text-sm text-gray-600 mt-2">
            財務事実から企業価値の現状を整理し、経営戦略の論点を明確にします。
          </p>

          <div className="text-xs text-gray-400 mt-2">
            {strategyId ? `strategyId: ${strategyId}` : 'strategyId: —'}
            {revision != null ? ` / rev: ${revision}` : ''}
          </div>

          {saveMessage && (
            <div className={`text-xs mt-2 ${saveState === 'error' ? 'text-red-600' : 'text-green-700'}`}>
              {saveMessage}
            </div>
          )}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => doSave('manual')}
              disabled={saveState === 'saving' || !saveFn}
              className={`px-3 py-2 text-sm rounded transition ${saveBtnClass}`}
              title={!saveFn ? 'storeに保存関数がありません' : ''}
            >
              {saveBtnLabel}
            </button>

            <button
              onClick={handleLoadDummy}
              className={`px-3 py-2 text-sm rounded border transition ${
                dummyLoaded
                  ? 'bg-green-100 border-green-400 text-green-700'
                  : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
              }`}
              disabled={!loadStage1DummyData}
              title={!loadStage1DummyData ? 'loadStage1DummyData が store にありません' : ''}
            >
              {dummyLoaded ? '✓ 読込完了' : 'ダミーデータ読込'}
            </button>
          </div>

          {!saveFn && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              storeに保存関数が見つかりません。strategyStore.ts に saveToSupabase / saveStrategyData 等があるか確認してください。
            </div>
          )}
        </div>
      </header>

      <CompanyScopePanel />
      <BusinessSegmentsPanel />
      <DocumentImportPanel />
      <FinanceInputPanel />
      <MetricsPanel />
      <IssueBlockPanel />
      <Stage2Bridge />
    </div>
  );
}
