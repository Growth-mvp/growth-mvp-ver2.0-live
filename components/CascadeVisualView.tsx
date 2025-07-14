'use client';

import { useStrategyStore } from '@/store/strategyStore';

export default function CascadeVisualView() {
  const { strategySummary, editableCascadeResult } = useStrategyStore();

  return (
    <div className="p-6 bg-white min-h-screen">
      {/* 経営戦略の要約 */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-gray-800 border-b pb-1 mb-4">経営戦略の要約</h2>
        <div className="bg-gray-50 p-4 rounded border text-gray-700 shadow-sm text-sm whitespace-pre-wrap">
          {strategySummary || '戦略要約がここに表示されます'}
        </div>
      </section>

      {/* 部門・プロジェクト・OKR 階層 */}
      <section className="space-y-6">
        {editableCascadeResult.map((dept, i) => (
          <div key={i} className="border-l-4 border-blue-500 pl-4">
            <h3 className="text-lg font-semibold text-blue-800 mb-1">{dept.name}</h3>
            <p className="text-sm text-gray-700 mb-3 whitespace-pre-wrap">{dept.strategy}</p>

            {dept.projects.map((proj, j) => (
              <div key={j} className="ml-4 pl-4 border-l-2 border-gray-300 mb-4">
                <h4 className="text-base font-medium text-gray-800">{proj.name}</h4>
                <p className="text-sm text-gray-600 mb-2 whitespace-pre-wrap">{proj.description}</p>

                {proj.okrs.map((okr, k) => (
                  <div key={k} className="ml-4 pl-4 border-l border-gray-200 mb-3">
                    <p className="text-sm font-medium text-gray-700 mb-1">Objective: {okr.objective}</p>
                    <ul className="list-disc text-sm text-gray-600 pl-5 space-y-1">
                      {okr.keyResults.map((kr, l) => (
                        <li key={l}>{kr}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
