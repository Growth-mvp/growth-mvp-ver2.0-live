// /app/stage1/page.tsx
'use client';

import CompanyScopePanel from '@/components/stage1/CompanyScopePanel';
import FinanceInputPanel from '@/components/stage1/FinanceInputPanel';
import MetricsPanel from '@/components/stage1/MetricsPanel';
import IssueBlockPanel from '@/components/stage1/IssueBlockPanel';
import Stage2Bridge from '@/components/stage1/Stage2Bridge';

export default function Stage1Page() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-12">
      <header>
        <h1 className="text-2xl font-bold">STAGE1｜企業価値分析</h1>
        <p className="text-sm text-gray-600 mt-2">
          財務事実から企業価値の現状を整理し、経営戦略の論点を明確にします。
        </p>
      </header>

      <CompanyScopePanel />
      <FinanceInputPanel />
      <MetricsPanel />
      <IssueBlockPanel />
      <Stage2Bridge />
    </div>
  );
}
