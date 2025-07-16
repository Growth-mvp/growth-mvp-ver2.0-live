'use client';

import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';

export default function Step1BasicInfo() {
  const {
    companyName,
    foundationYear,
    location,
    industry,
    revenue,
    employees,
    businessContent,
    customerSegment,
    thought,
    setCompanyName,
    setFoundationYear,
    setLocation,
    setIndustry,
    setRevenue,
    setEmployees,
    setBusinessContent,
    setCustomerSegment,
    setThought,
  } = useStrategyStore();

  const industries = [
    { value: '', label: '-- 選択してください --' },
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

  return (
    <StepLayout step={1} totalSteps={5} title="基本情報の入力">
      <div className="space-y-8">
        <div className="p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded">
          <label className="block text-lg font-semibold text-gray-800 mb-2">経営者の思い</label>
          <textarea
            value={thought}
            onChange={(e) => setThought(e.target.value)}
            className="w-full border rounded px-3 py-2"
            rows={3}
            placeholder="例：社員が誇れる会社にしたい。日本の製造業の未来を創りたい。"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">会社名</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="例：株式会社○○"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">設立年</label>
            <input
              type="text"
              value={foundationYear}
              onChange={(e) => setFoundationYear(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="例：2005"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">所在地</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="例：東京都港区"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">業種</label>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full border rounded px-3 py-2 bg-white"
            >
              {industries.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">売上（億円）</label>
            <input
              type="text"
              value={revenue}
              onChange={(e) => setRevenue(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="例：50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">従業員数（人）</label>
            <input
              type="text"
              value={employees}
              onChange={(e) => setEmployees(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="例：200"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">主な事業内容</label>
            <textarea
              value={businessContent}
              onChange={(e) => setBusinessContent(e.target.value)}
              className="w-full border rounded px-3 py-2"
              rows={2}
              placeholder="例：自動車部品の設計・製造・販売"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">主要な顧客層</label>
            <textarea
              value={customerSegment}
              onChange={(e) => setCustomerSegment(e.target.value)}
              className="w-full border rounded px-3 py-2"
              rows={2}
              placeholder="例：国内外の完成車メーカー、部品メーカー"
            />
          </div>
        </div>
      </div>
    </StepLayout>
  );
}
