'use client';

import { useState, useEffect } from 'react';
import { useStrategyStore } from '../../store/strategyStore';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Sparkles,
  Brain,
  Target,
} from 'lucide-react';

export default function StoryPage() {
  const router = useRouter();

  const {
    vision,
    industry,
    revenue,
    employees,
    strength,
    weakness,
    opportunity,
    threat,
    thought,
    story,
    setStory,
    setStrategySummary,
    mission,
    value,
    csvFinanceData,
  } = useStrategyStore();

  const [localStory, setLocalStory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (story) setLocalStory(story);
  }, [story]);

  const generateStory = async () => {
    if (!vision || !strength || !weakness || !opportunity || !threat || !thought) {
      setError('必要な情報（思い・ビジョン・SWOT）が不足しています。');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/generate-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thought,
          vision,
          industry,
          revenue,
          employees,
          strength,
          weakness,
          opportunity,
          threat,
          mission,
          value,
          csvFinanceData,
        }),
      });

      const data = await res.json();

      setStory(data.story);
      setStrategySummary(data.summary);
      setLocalStory(data.story);
    } catch (err) {
      console.error('❌ ストーリー生成失敗:', err);
      setError('生成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const parts = localStory.split('■');

  return (
    <div className="p-6 min-h-screen bg-gradient-to-b from-white to-blue-50">
      <h1 className="text-2xl font-bold mb-4 text-gray-800">戦略ストーリー生成</h1>

      <button
        onClick={generateStory}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
      >
        {loading ? '生成中...' : 'ストーリー生成'}
      </button>

      {error && <p className="text-red-500 mt-4">{error}</p>}

      {/* ストーリー4章表示 */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ① 現状の危機 */}
        <div className="bg-white shadow-md rounded-lg p-4 border-l-4 border-red-400">
          <div className="flex items-center mb-2 text-red-500 font-semibold">
            <AlertTriangle className="w-5 h-5 mr-2" />
            現状の危機や背景
          </div>
          <p className="text-gray-700 whitespace-pre-wrap">{parts[1]?.trim()}</p>
        </div>

        {/* ② 方向性 */}
        <div className="bg-white shadow-md rounded-lg p-4 border-l-4 border-blue-400">
          <div className="flex items-center mb-2 text-blue-500 font-semibold">
            <Sparkles className="w-5 h-5 mr-2" />
            目指す方向性
          </div>
          <p className="text-gray-700 whitespace-pre-wrap">{parts[2]?.trim()}</p>
        </div>

        {/* ③ SWOT戦略 */}
        <div className="bg-white shadow-md rounded-lg p-4 border-l-4 border-purple-500">
          <div className="flex items-center mb-2 text-purple-600 font-semibold">
            <Brain className="w-5 h-5 mr-2" />
            SWOTに基づく戦略
          </div>
          <p className="text-gray-700 whitespace-pre-wrap">{parts[3]?.trim()}</p>
        </div>

        {/* ④ 社員への期待 */}
        <div className="bg-white shadow-md rounded-lg p-4 border-l-4 border-green-500 md:col-span-2">
          <div className="flex items-center mb-2 text-green-600 font-semibold">
            <Target className="w-5 h-5 mr-2" />
            社員に求める行動や期待
          </div>
          <p className="text-gray-700 whitespace-pre-wrap">{parts[4]?.trim()}</p>
        </div>
      </div>

      {/* カスケードへの遷移ボタン */}
      <div className="mt-12 flex justify-center">
        <button
          onClick={() => router.push('/cascade')}
          className="bg-green-600 text-white px-6 py-3 text-lg rounded-md shadow hover:bg-green-700 transition"
        >
          戦略カスケードを生成する →
        </button>
      </div>
    </div>
  );
}
