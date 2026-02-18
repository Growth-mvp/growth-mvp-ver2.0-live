// /components/stage1/FinanceDataPanel.tsx
'use client';

import { useState, useMemo } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import DocumentImportPanel from './DocumentImportPanel';
import FinanceInputPanel from './FinanceInputPanel';
import { FinanceYearEditorTable } from './FinanceYearEditorTable';

type FinanceDataMode = 'import' | 'manual';

/**
 * ③ 財務データ統合パネル
 * - タブで「読込み」（DocumentImportPanel）と「手入力」（FinanceInputPanel）を切り替え
 * - 全社 PL/BS と事業部別 PL/BS を編集可能
 */
export default function FinanceDataPanel() {
  const [mode, setMode] = useState<FinanceDataMode>('import');
  const [selectedSegmentName, setSelectedSegmentName] = useState<string | null>(null);

  const businessSegments = useStrategyStore((s) => s.businessSegments ?? []);

  // 事業部が定義されているか
  const hasSegments = businessSegments.length > 0;

  // 最初の事業部を初期選択
  const initialSegment = useMemo(() => {
    if (businessSegments.length > 0 && !selectedSegmentName) {
      return businessSegments[0].name;
    }
    return selectedSegmentName || null;
  }, [businessSegments, selectedSegmentName]);

  return (
    <div className="space-y-6">
      {/* 全社データ入力 */}
      <div>
        <h3 className="text-lg font-semibold mb-3">全社財務データ</h3>

        {/* タブ切り替え */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('import')}
            className={`px-4 py-2 rounded text-sm font-medium transition ${
              mode === 'import'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            ファイルから読込み
          </button>
          <button
            onClick={() => setMode('manual')}
            className={`px-4 py-2 rounded text-sm font-medium transition ${
              mode === 'manual'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            手入力
          </button>
        </div>

        {/* パネルの切り替え */}
        {mode === 'import' && <DocumentImportPanel />}
        {mode === 'manual' && <FinanceInputPanel />}

        {/* 常に表示：全社財務データテーブル */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <FinanceYearEditorTable mode="company" />
        </div>
      </div>

      {/* 事業部別データ入力 */}
      {hasSegments && (
        <div className="border-t border-gray-200 pt-6">
          <h3 className="text-lg font-semibold mb-3">事業部別財務データ（任意）</h3>
          <p className="text-sm text-gray-600 mb-4">
            事業部ごとに PL/BS を入力できます。入力することで、セグメント別の分析が可能になります。
          </p>

          {/* 事業部選択 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">事業部を選択</label>
            <select
              value={initialSegment || ''}
              onChange={(e) => setSelectedSegmentName(e.target.value)}
              className="border rounded px-3 py-2 text-sm w-full"
            >
              {businessSegments.map((seg) => (
                <option key={seg.id} value={seg.name}>
                  {seg.name}
                </option>
              ))}
            </select>
          </div>

          {/* 事業部別エディタ */}
          {initialSegment && (
            <FinanceYearEditorTable mode="segment" segmentName={initialSegment} />
          )}
        </div>
      )}
    </div>
  );
}
