// app/cascade/page.tsx
'use client';

import { useStrategyStore } from '@/store/strategyStore';
import StrategyBlock from '@/components/StrategyBlock';
import DepartmentBlock from '@/components/DepartmentBlock';

export default function CascadePage() {
  const { editableCascadeResult, strategySummary } = useStrategyStore();

  return (
    <main className="p-6 min-h-screen bg-gradient-to-b from-blue-50 to-blue-100">
      <h1 className="text-2xl font-bold text-center mb-6 text-gray-800">ピラミッド構造ビュー</h1>

      <div className="flex justify-center mb-10">
        <StrategyBlock summary={strategySummary} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mb-8 px-4">
        {editableCascadeResult.map((dept, idx) => (
          <DepartmentBlock key={idx} department={dept} />
        ))}
      </div>
    </main>
  );
}
