// components/inputs/IndustrySelect.tsx
"use client";

import { useStrategyStore } from '@/store/strategyStore';

const industries = [
  { value: 'manufacturing', label: '製造業（機械・部品・素材）' },
  { value: 'it', label: '情報通信業（SIer・SaaSなど）' },
  { value: 'trading', label: '商社・卸売業（専門商社含む）' },
  { value: 'itSolution', label: 'システム販売・ITソリューション' },
  { value: 'hrService', label: '人材サービス（派遣・紹介・研修）' },
  { value: 'logistics', label: '運輸・物流業（ラストワンマイル含む）' },
  { value: 'construction', label: '建設・設備工事業（ゼネコン・サブコン）' },
  { value: 'retail', label: '小売・流通業（EC含む）' },
  { value: 'education', label: '教育・研修・スクールビジネス' },
  { value: 'healthcare', label: '医療・介護・ヘルスケア' },
];

export default function IndustrySelect() {
  const { industry, setIndustry } = useStrategyStore();

  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold mb-1">業種の選択</label>
      <select
        value={industry}
        onChange={(e) => setIndustry(e.target.value)}
        className="w-full border rounded px-3 py-2 bg-white shadow-sm focus:outline-none"
      >
        <option value="">-- 選択してください --</option>
        {industries.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}
