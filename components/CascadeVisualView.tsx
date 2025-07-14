// components/CascadeVisualView.tsx
'use client';

import { useStrategyStore } from '@/store/strategyStore';

export default function CascadeVisualView() {
  const { strategySummary, editableCascadeResult } = useStrategyStore();

  return (
    <div className="p-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-blue-800">🚩 経営戦略の要約</h2>
        <p className="mt-2 text-gray-700 bg-blue-50 p-4 rounded shadow">
          {strategySummary || '戦略要約がここに表示されます'}
        </p>
      </div>

      <div className="grid gap-6">
        {editableCascadeResult.map((dept, i) => (
          <div key={i} className="bg-blue-100 rounded-xl p-4 shadow border-l-8 border-blue-400">
            <h3 className="text-xl font-bold text-blue-800 mb-2">🏢 {dept.name}</h3>
            <p className="text-sm text-gray-700">{dept.strategy}</p>

            {dept.projects.map((proj, j) => (
              <div key={j} className="bg-green-100 mt-3 ml-4 rounded-lg p-3 shadow border-l-4 border-green-400">
                <h4 className="font-semibold text-green-800">📌 {proj.name}</h4>
                <p className="text-sm text-gray-700">{proj.description}</p>

                {proj.okrs.map((okr, k) => (
                  <div key={k} className="bg-yellow-50 mt-2 ml-4 p-2 rounded shadow border border-yellow-300">
                    <p className="font-medium text-yellow-800">🎯 {okr.objective}</p>
                    <ul className="list-disc pl-5 text-sm text-gray-700">
                      {okr.keyResults.map((kr, l) => (
                        <li key={l}>✅ {kr}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}