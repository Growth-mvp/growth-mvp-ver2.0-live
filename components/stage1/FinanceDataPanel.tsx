// /components/stage1/FinanceDataPanel.tsx
'use client';

import { useMemo, useState } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import DocumentImportPanel from './DocumentImportPanel';
import { FinanceYearEditorTable } from './FinanceYearEditorTable';

type FinanceDataMode = 'import' | 'manual';

/**
 * 財務データ統合パネル
 * - 「読込み（DocumentImportPanel）」と「手入力（FinanceYearEditorTable）」を切り替え
 * - 全社 PL/BS と事業部別 PL/BS を編集可能
 */
export default function FinanceDataPanel() {
  const [mode, setMode] = useState<FinanceDataMode>('import');
  const [selectedSegmentName, setSelectedSegmentName] = useState<string | null>(null);

  const businessSegments = useStrategyStore((s: StrategyState) => s.businessSegments ?? []);
  const hasSegments = businessSegments.length > 0;

  const initialSegment = useMemo(() => {
    if (businessSegments.length > 0 && !selectedSegmentName) return businessSegments[0].name;
    return selectedSegmentName || null;
  }, [businessSegments, selectedSegmentName]);

  return (
    <div className="space-y-8">
      {/* 全社データ入力 */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">全社財務データ</h3>
            <p className="mt-1 text-sm text-zinc-500">
              PL/BSを入力すると、企業価値指標（ROIC等）が自動計算されます。
            </p>
          </div>

          {/* タブ */}
          <div className="inline-flex rounded-full border border-zinc-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setMode('import')}
              className={
                'px-4 py-2 text-sm font-semibold rounded-full transition ' +
                (mode === 'import'
                  ? 'bg-zinc-900 text-white shadow'
                  : 'text-zinc-700 hover:bg-zinc-100')
              }
            >
              ファイルから読込み
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={
                'px-4 py-2 text-sm font-semibold rounded-full transition ' +
                (mode === 'manual'
                  ? 'bg-zinc-900 text-white shadow'
                  : 'text-zinc-700 hover:bg-zinc-100')
              }
            >
              手入力
            </button>
          </div>
        </div>

        {/* パネル */}
        {mode === 'import' ? (
          <DocumentImportPanel />
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-semibold text-zinc-900">操作</span>
              <span>クリック＝選択</span>
              <span>Enter / F2 / ダブルクリック＝編集</span>
              <span>Ctrl+V＝貼り付け</span>
              <span>Ctrl+Z＝戻る</span>
            </div>
          </div>
        )}

        {/* 常に表示：全社財務データ（編集UI一本化） */}
        <FinanceYearEditorTable mode="company" />
      </section>

      {/* 事業部別データ入力 */}
      {hasSegments && (
        <section className="space-y-4 border-t border-zinc-200 pt-8">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">事業部別財務データ（任意）</h3>
            <p className="mt-1 text-sm text-zinc-500">
              事業部ごとに PL/BS を入力できます。入力するとセグメント別の分析が可能になります。
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[240px_1fr] sm:items-center">
            <label className="text-sm font-semibold text-zinc-700">事業部を選択</label>
            <select
              value={initialSegment || ''}
              onChange={(e) => setSelectedSegmentName(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {businessSegments.map((seg) => (
                <option key={seg.id} value={seg.name}>
                  {seg.name}
                </option>
              ))}
            </select>
          </div>

          {initialSegment && <FinanceYearEditorTable mode="segment" segmentName={initialSegment} />}
        </section>
      )}
    </div>
  );
}
