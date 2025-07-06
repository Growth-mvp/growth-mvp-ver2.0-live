"use client";

import { useStrategyStore } from "@/store/strategyStore";

export default function Step1BasicInfo() {
  const {
    thought,
    industry,
    revenue,
    employees,
    setThought,
    setIndustry,
    setRevenue,
    setEmployees,
  } = useStrategyStore();

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium">経営者の思い</label>
        <textarea
          value={thought}
          onChange={(e) => setThought(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
          rows={4}
          placeholder="例）日本の製造業を再び強くしたい、など"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">業種</label>
        <input
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
          placeholder="例）製造業、IT、流通 など"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">売上（億円）</label>
        <select
          value={revenue}
          onChange={(e) => setRevenue(Number(e.target.value))}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          <option value={0}>選択してください</option>
          <option value={10}>〜10億円</option>
          <option value={50}>10〜50億円</option>
          <option value={100}>50〜100億円</option>
          <option value={300}>100〜300億円</option>
          <option value={1000}>300〜1000億円</option>
          <option value={1001}>1000億円以上</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium">従業員数</label>
        <select
          value={employees}
          onChange={(e) => setEmployees(Number(e.target.value))}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          <option value={0}>選択してください</option>
          <option value={50}>〜50人</option>
          <option value={100}>50〜100人</option>
          <option value={300}>100〜300人</option>
          <option value={1000}>300〜1000人</option>
          <option value={1001}>1000人以上</option>
        </select>
      </div>
    </div>
  );
}
