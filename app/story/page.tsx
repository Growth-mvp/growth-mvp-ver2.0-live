'use client';

import { useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

export default function StoryPage() {
  const {
    visionStatement,
    industry,
    revenue,
    employees,
    strength,
    weakness,
    opportunity,
    threat,
    csvFinanceData,
    setStory,
    story,
  } = useStrategyStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateStory = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/generate-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vision: visionStatement,
          industry,
          revenue,
          employees,
          strength,
          weakness,
          opportunity,
          threat,
          csvFinanceData, // ★ここを追加
        }),
      });

      const data = await response.json();

      if (response.ok && data.story) {
        setStory(data.story);
      } else {
        setError('ストーリー生成に失敗しました');
      }
    } catch (e) {
      setError('エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">戦略ストーリー生成</h1>

      <button
        onClick={generateStory}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded mb-4"
        disabled={loading}
      >
        {loading ? '生成中...' : 'ストーリーを生成'}
      </button>

      {error && <p className="text-red-500">{error}</p>}

      {story && (
        <div className="bg-white p-4 rounded shadow border">
          <h2 className="text-lg font-semibold mb-2">生成されたストーリー</h2>
          <pre className="whitespace-pre-wrap text-sm text-gray-800">{story}</pre>
        </div>
      )}
    </div>
  );
}
