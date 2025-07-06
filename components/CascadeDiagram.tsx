'use client'

import { useStrategyStore } from '@/store/strategyStore'

export default function CascadeDiagram() {
  const { vision, departments } = useStrategyStore()

  return (
    <div className="space-y-8">
      {/* 経営戦略 */}
      <div className="bg-blue-100 border-l-4 border-blue-500 p-4 rounded shadow">
        <h2 className="text-xl font-semibold text-blue-800">経営戦略（想い）</h2>
        <p className="text-gray-800 mt-2 whitespace-pre-wrap">{vision}</p>
      </div>

      {/* 部門戦略とプロジェクト */}
      {departments.map((dept) => (
        <div key={dept.id} className="bg-white border p-4 rounded shadow space-y-2">
          <h3 className="text-lg font-bold text-gray-800">部門：{dept.name}</h3>
          <p className="text-sm text-gray-700">部門目標：{dept.goal}</p>

          <div className="ml-4 space-y-1">
            {dept.projects.map((proj) => (
              <div key={proj.id} className="bg-gray-100 p-2 rounded">
                <p className="font-medium text-gray-900">📌 {proj.title}</p>
                <p className="text-sm text-gray-600">{proj.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
