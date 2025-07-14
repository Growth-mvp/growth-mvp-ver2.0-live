'use client';

import { useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';

export default function Step5Confirm() {
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
    strength,
    weakness,
    opportunity,
    threat,
    mission,
    vision,
    value,
    setStory,
    setNotification,
  } = useStrategyStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerateStory = async () => {
    setLoading(true);
    setError('');
    setNotification('');

    try {
      const response = await fetch('/api/generate-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry,
          revenue,
          employees,
          vision,
          strength,
          weakness,
          opportunity,
          threat,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.story) {
        throw new Error(data.error || 'ストーリー生成に失敗しました');
      }

      setStory(data.story);
      setNotification('✅ 戦略ストーリーを生成しました（詳細は後のステップで確認できます）');
    } catch (err: any) {
      console.error('❌ 生成エラー:', err);
      setError(err.message);
      setNotification('❌ ストーリー生成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <StepLayout step={5} totalSteps={5} title="入力内容の最終確認">
      <div className="space-y-4 text-sm text-gray-800">
        <p><strong>会社名：</strong>{companyName}</p>
        <p><strong>設立年：</strong>{foundationYear}</p>
        <p><strong>所在地：</strong>{location}</p>
        <p><strong>業種：</strong>{industry}</p>
        <p><strong>売上：</strong>{revenue} 億円</p>
        <p><strong>従業員数：</strong>{employees} 人</p>
        <p><strong>主な事業内容：</strong>{businessContent}</p>
        <p><strong>主要な顧客層：</strong>{customerSegment}</p>
        <p><strong>経営者の思い：</strong>{thought}</p>
        <p><strong>SWOT：</strong></p>
        <ul className="ml-4 list-disc">
          <li><strong>S:</strong> {strength}</li>
          <li><strong>W:</strong> {weakness}</li>
          <li><strong>O:</strong> {opportunity}</li>
          <li><strong>T:</strong> {threat}</li>
        </ul>
        <p><strong>Mission:</strong> {mission}</p>
        <p><strong>Vision:</strong> {vision}</p>
        <p><strong>Value:</strong> {value}</p>

        {/* ボタンと通知のみ表示 */}
        <div className="mt-6">
          <button
            onClick={handleGenerateStory}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '生成中...' : '戦略ストーリーを生成'}
          </button>
        </div>

        {error && <p className="text-red-600 mt-2">❌ {error}</p>}
      </div>
    </StepLayout>
  );
}
