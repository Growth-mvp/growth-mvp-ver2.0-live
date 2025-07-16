'use client';

import { useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';

export default function Step2SWOT() {
  const {
    strength,
    weakness,
    opportunity,
    threat,
    industry,
    revenue,
    employees,
    businessContent,
    setStrength,
    setWeakness,
    setOpportunity,
    setThreat,
  } = useStrategyStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerateOT = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-ot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry, revenue, employees, businessContent }),
      });
      const data = await res.json();
      if (data.result) {
        const matchOpportunity = data.result.match(/■ Opportunity（機会）([\s\S]*?)■ Threat/);
        const matchThreat = data.result.match(/■ Threat（脅威）([\s\S]*)/);

        if (matchOpportunity) setOpportunity(matchOpportunity[1].trim());
        if (matchThreat) setThreat(matchThreat[1].trim());
      } else {
        setError('O/Tの取得に失敗しました');
      }
    } catch (err) {
      console.error('O/T自動生成エラー:', err);
      setError('O/Tの取得に失敗しました');
    }
    setLoading(false);
  };

  return (
    <StepLayout step={2} totalSteps={5} title="SWOT分析">
      <div className="mb-4">
        <button
          onClick={handleGenerateOT}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '生成中...' : '機会・脅威を自動生成'}
        </button>
        {error && <p className="text-red-500 mt-2 text-sm">{error}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 強み */}
        <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded shadow-sm">
          <label className="block text-sm font-semibold text-green-700 mb-1">Strength（強み）</label>
          <textarea
            className="w-full border px-3 py-2 rounded text-sm"
            rows={5}
            value={strength}
            onChange={(e) => setStrength(e.target.value)}
            placeholder="例：高度な技術力、顧客との信頼関係、ブランド力"
          />
        </div>

        {/* 弱み */}
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded shadow-sm">
          <label className="block text-sm font-semibold text-red-700 mb-1">Weakness（弱み）</label>
          <textarea
            className="w-full border px-3 py-2 rounded text-sm"
            rows={5}
            value={weakness}
            onChange={(e) => setWeakness(e.target.value)}
            placeholder="例：人材不足、情報発信力の弱さ、古い設備"
          />
        </div>

        {/* 機会 */}
        <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded shadow-sm">
          <label className="block text-sm font-semibold text-blue-700 mb-1">Opportunity（機会）</label>
          <textarea
            className="w-full border px-3 py-2 rounded text-sm"
            rows={5}
            value={opportunity}
            onChange={(e) => setOpportunity(e.target.value)}
            placeholder="例：市場拡大、規制緩和、技術革新"
          />
        </div>

        {/* 脅威 */}
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded shadow-sm">
          <label className="block text-sm font-semibold text-yellow-700 mb-1">Threat（脅威）</label>
          <textarea
            className="w-full border px-3 py-2 rounded text-sm"
            rows={5}
            value={threat}
            onChange={(e) => setThreat(e.target.value)}
            placeholder="例：価格競争の激化、景気悪化、海外勢の参入"
          />
        </div>
      </div>
    </StepLayout>
  );
}
