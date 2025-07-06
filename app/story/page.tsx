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

  // Supabaseから復元
  useEffect(() => {
    const load = async () => {
      await loadLatestFromSupabase();
    };
    load();
  }, []);

  // ストーリーが未生成なら自動生成
  useEffect(() => {
    if (!story && !loading) {
      generateStory();
    }
  }, [story, loading]); // ← 依存にloadingを追加

  const generateStory = async () => {
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

        const { error } = await supabase.from('strategies').insert([
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

        if (error) {
          console.error('❌ Supabase保存エラー:', {
            code: error.code,
            message: error.message,
            details: error.details,
          });
        }
      } else {
        setError('ストーリー生成に失敗しました。');
      }
    } catch (err) {
      console.error('❌ ストーリー生成中エラー:', err);
      setError('ストーリー生成中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  // ストーリーの分割表示処理
  const splitStory =
    story?.split(/###\s*\d?\s?[①-④]?[\s\S]*?(?=###|$)/).filter((s) => s.trim() !== '') || [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">戦略ストーリー生成</h1>

      {loading ? (
        <p className="text-blue-600 mb-4">ストーリーを生成中...</p>
      ) : error ? (
        <p className="text-red-600 mb-4">{error}</p>
      ) : splitStory.length > 0 ? (
        <div className="space-y-6">
          {splitStory.map((section, index) => (
            <div key={index} className="bg-white p-4 rounded-xl shadow">
              <h2 className="text-lg font-semibold mb-2">
                {sectionTitles[index] || `セクション ${index + 1}`}
              </h2>
              <p className="text-sm whitespace-pre-line text-gray-800">{section}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500">ストーリーがまだありません。</p>
      )}
    </div>
  );
}
