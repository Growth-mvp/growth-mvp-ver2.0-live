'use client';

import { useEffect, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { supabase } from '@/lib/supabaseClient';

export default function StoryPage() {
  const {
    thought,
    industry,
    revenue,
    employees,
    mission,
    visionStatement,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    story,
    setStory,
    loadLatestFromSupabase,
  } = useStrategyStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sectionTitles = [
    '① 現状の危機や背景（なぜ今、変革が必要なのか）',
    '② 経営者が描く未来の方向性（どこを目指すのか）',
    '③ SWOTに基づいた戦略的な選択（強み×機会などのクロス分析を含む）',
    '④ 社員に求める行動や期待（自分ごととして捉えてもらう）',
  ];

  useEffect(() => {
    const load = async () => {
      await loadLatestFromSupabase();
    };
    load();
  }, []);

  useEffect(() => {
    if ((!story || story.trim() === '') && !loading) {
      generateStory();
    }
  }, [story, loading]);

  const generateStory = async () => {
    if (!thought || !industry || !revenue || !employees) {
      setError('必要な情報（思い・業種・売上・社員数）が入力されていません。戦略入力画面で入力してください。');
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
          industry,
          revenue,
          employees,
          mission,
          visionStatement,
          value,
          strength,
          weakness,
          opportunity,
          threat,
        }),
      });

      const data = await res.json();

      if (data.story) {
        setStory(data.story);

        await supabase.from('strategies').insert([
          {
            strategy: { summary: '' },
            departments: [],
            basic_info: {
              thought,
              industry,
              revenue,
              employees,
              mission,
              visionStatement,
              value,
              strength,
              weakness,
              opportunity,
              threat,
            },
            story: data.story,
          },
        ]);
      } else {
        setError('ストーリー生成に失敗しました（AI応答なし）');
      }
    } catch (err) {
      console.error('❌ ストーリー生成中のエラー:', err);
      setError('ストーリー生成中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  // 🛠 より柔軟な分割（###または①～④で分割）
  const splitStory = story
    ? story.split(/(?=###\s?[①-④]?)/g).map((s) => s.trim()).filter((s) => s !== '')
    : [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">戦略ストーリー</h1>

      {loading && <p className="text-blue-600 mb-4">ストーリーを生成中...</p>}
      {error && <p className="text-red-600 mb-4">{error}</p>}

      {splitStory.length > 0 && (
        <div className="space-y-6">
          {splitStory.map((section, index) => (
            <div key={index} className="bg-white p-5 rounded-xl shadow-md border">
              <h2 className="text-lg font-semibold mb-2 text-gray-800">
                {sectionTitles[index] || `セクション ${index + 1}`}
              </h2>
              <p className="text-sm whitespace-pre-line text-gray-700">{section}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
