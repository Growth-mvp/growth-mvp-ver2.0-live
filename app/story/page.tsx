// ✅ 修正ファイル: app/story/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { useStrategyStore } from '../../store/strategyStore';

export default function StoryPage() {
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
    strategySummary,
    setStory,
    setStrategySummary,
  } = useStrategyStore();

  const [localStory, setLocalStory] = useState('');
  const [localSummary, setLocalSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ✅ 初期表示時にZustandの内容を反映
  useEffect(() => {
    if (story) setLocalStory(story);
    if (strategySummary) setLocalSummary(strategySummary);
  }, [story, strategySummary]);

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
        }),
      });

      const data = await res.json();

      // 🎯 Zustandに保存 & ローカルステートにも反映
      setStory(data.story);
      setStrategySummary(data.summary);
      setLocalStory(data.story);
      setLocalSummary(data.summary);
    } catch (err) {
      console.error('❌ ストーリー生成失敗:', err);
      setError('生成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">戦略ストーリー生成</h1>
      <button
        onClick={generateStory}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        {loading ? '生成中...' : 'ストーリー生成'}
      </button>

      {error && <p className="text-red-500 mt-2">{error}</p>}

      <div className="mt-6">
        <h2 className="text-xl font-semibold mb-2">戦略ストーリー</h2>
        <pre className="bg-gray-100 p-4 rounded whitespace-pre-wrap">{localStory}</pre>
      </div>

      <div className="mt-6">
        <h2 className="text-xl font-semibold mb-2">要約</h2>
        <pre className="bg-gray-100 p-4 rounded whitespace-pre-wrap">{localSummary}</pre>
      </div>
    </div>
  );
}
