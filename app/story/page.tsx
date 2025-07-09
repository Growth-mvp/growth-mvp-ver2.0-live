'use client';

import { useEffect, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

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
    csvFinanceData,
    story,
    setStory,
  } = useStrategyStore();

  const [storyLocal, setStoryLocal] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Zustandに保存済のstoryをローカル表示に反映
  useEffect(() => {
    setStoryLocal(story);
  }, [story]);

  const generateStory = async () => {
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/generate-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vision,
          industry,
          revenue,
          employees,
          strength,
          weakness,
          opportunity,
          threat,
          csvFinanceData,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setStory(data.story || '');
        setStoryLocal(data.story || '');
      } else {
        setError(data.error || 'エラーが発生しました。');
      }
    } catch (err) {
      console.error('❌ 通信エラー:', err);
      setError('ストーリー生成中に通信エラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">📖 戦略ストーリー生成</h1>

      <button
        onClick={generateStory}
        disabled={loading}
        className="mb-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        {loading ? '生成中...' : 'ストーリーを生成'}
      </button>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {storyLocal && (
        <>
          <div className="bg-white p-4 rounded shadow whitespace-pre-wrap border border-gray-200">
            {storyLocal}
          </div>

          <div className="mt-4">
            <a
              href="/cascade"
              className="inline-block px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              次へ → カスケード生成
            </a>
          </div>
        </>
      )}
    </div>
  );
}
