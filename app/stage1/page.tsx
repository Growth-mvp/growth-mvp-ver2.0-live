// /app/stage1/page.tsx
'use client';

import { useCallback, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import CompanyScopePanel from '@/components/stage1/CompanyScopePanel';
import BusinessSegmentsPanel from '@/components/stage1/BusinessSegmentsPanel';
import DocumentImportPanel from '@/components/stage1/DocumentImportPanel';
import FinanceInputPanel from '@/components/stage1/FinanceInputPanel';
import MetricsPanel from '@/components/stage1/MetricsPanel';
import IssueBlockPanel from '@/components/stage1/IssueBlockPanel';
import Stage2Bridge from '@/components/stage1/Stage2Bridge';

export default function Stage1Page() {
  const loadStage1DummyData = useStrategyStore((s) => s.loadStage1DummyData);
  const [dummyLoaded, setDummyLoaded] = useState(false);

  const handleLoadDummy = useCallback(() => {
    loadStage1DummyData();
    setDummyLoaded(true);
    setTimeout(() => setDummyLoaded(false), 2000);
  }, [loadStage1DummyData]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">STAGE1｜企業価値分析</h1>
          <p className="text-sm text-gray-600 mt-2">
            財務事実から企業価値の現状を整理し、経営戦略の論点を明確にします。
          </p>
        </div>

        {/* 開発用：ダミーデータ投入ボタン */}
        <button
          onClick={handleLoadDummy}
          className={`shrink-0 px-3 py-1.5 text-xs rounded border transition ${
            dummyLoaded
              ? 'bg-green-100 border-green-400 text-green-700'
              : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {dummyLoaded ? '✓ 読込完了' : 'ダミーデータ読込'}
        </button>
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
