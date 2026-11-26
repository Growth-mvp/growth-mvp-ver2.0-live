// /components/stage1/FinanceDataPanel.tsx
'use client';

import { useMemo, useState } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { FinanceYearEditorTable } from './FinanceYearEditorTable';

/**
 * 財務データ統合パネル
 * - 資料の取込は AI経営コンサルタントへの添付で行う（候補はSTAGE1の候補欄で確認して反映する）
 * - 全社 PL/BS と事業部別 PL/BS を、手入力で編集できる
 */
export default function FinanceDataPanel({ readOnly, disabled }: { readOnly?: boolean; disabled?: boolean }) {
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
        <div>
          <h3 className="text-lg font-semibold text-zinc-900">全社財務データ</h3>
          <p className="mt-1 text-sm text-zinc-500">
            PL/BSを入力すると、企業価値指標（ROIC等）が自動計算されます。
          </p>
          <p className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            決算書や財務資料をAI経営コンサルタントに添付すると、入力を支援します。直接入力することもできます。
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-zinc-900">操作</span>
            <span>クリック＝選択</span>
            <span>Enter / F2 / ダブルクリック＝編集</span>
            <span>Ctrl+V＝貼り付け</span>
            <span>Ctrl+Z＝戻る</span>
          </div>
        </div>

        <FinanceYearEditorTable mode="company" disabled={disabled} />
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
              disabled={disabled}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-action disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {businessSegments.map((seg) => (
                <option key={seg.id} value={seg.name}>
                  {seg.name}
                </option>
              ))}
            </select>
          </div>

          {initialSegment && <FinanceYearEditorTable mode="segment" segmentName={initialSegment} disabled={disabled} />}
        </section>
      )}
    </div>
  );
}
