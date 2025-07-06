// components/steps/Step4Financials.tsx
"use client";

import { useStrategyStore } from "@/store/strategyStore";

export default function Step4Financials() {
  const {
    revenueRange,
    employeeRange,
    setRevenueRange,
    setEmployeeRange,
  } = useStrategyStore();

  return (
    <div className="space-y-6">
      <div>
        <label className="block font-medium">過去の売上高（範囲）</label>
        <input
          type="text"
          value={revenueRange}
          onChange={(e) => setRevenueRange(e.target.value)}
          placeholder="例：10億〜50億円"
          className="w-full border p-2 rounded"
        />
      </div>
      <div>
        <label className="block font-medium">従業員数（範囲）</label>
        <input
          type="text"
          value={employeeRange}
          onChange={(e) => setEmployeeRange(e.target.value)}
          placeholder="例：100〜300人"
          className="w-full border p-2 rounded"
        />
      </div>
    </div>
  );
}
