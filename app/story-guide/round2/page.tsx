'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuestionStore } from '@/store/questionStore';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { saveStoryAnswers2 } from '@/utils/supabase';
import QuestionCard from '@/components/guide/QuestionCard';

export default function StoryGuideRound2Page() {
  const router = useRouter();
  const { questions2, answers2, setAnswers2 } = useQuestionStore();
  const [localAnswers, setLocalAnswers] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { user } = useUserStore();

  // 初期表示時にanswers2または空配列をセット
  useEffect(() => {
    if (answers2.length > 0) {
      setLocalAnswers(answers2);
    } else {
      setLocalAnswers(Array(questions2.length).fill(''));
    }
  }, [questions2, answers2]);

  // 回答更新
  const handleAnswerChange = (index: number, value: string) => {
    const updated = [...localAnswers];
    updated[index] = value;
    setLocalAnswers(updated);
  };

  // 保存処理
  const handleSave = async () => {
    if (!user?.id) {
      setError('ユーザー情報が取得できませんでした');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await saveStoryAnswers2(user.id, localAnswers);
      setAnswers2(localAnswers);
      router.push('/story');
    } catch (err) {
      console.error('❌ 回答保存エラー:', err);
      setError('保存に失敗しました。再度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  // 質問単体ごとの次の処理（任意）
  const handleNext = (index: number) => {
    console.log(`Step ${index + 1} のNextがクリックされました`);
    // 必要に応じて処理を追加
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">🔍 第2ラウンド：さらに深掘りしてみましょう</h1>

      {questions2.length === 0 ? (
        <p className="text-gray-600">質問が見つかりません。前のステップを完了してください。</p>
      ) : (
        <div className="space-y-6">
          {questions2.map((q, i) => (
            <QuestionCard
              key={i}
              question={q}
              answer={localAnswers[i] || ''}
              onAnswerChange={(val) => handleAnswerChange(i, val)}
              step={i + 1}
              onNext={() => handleNext(i)}
            />
          ))}
        </div>
      )}

      {error && <p className="text-red-500 mt-4 text-sm">{error}</p>}

      <div className="mt-8 text-center">
        <button
          onClick={handleSave}
          disabled={saving || questions2.length === 0}
          className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '✅ 回答を保存してストーリー生成へ進む'}
        </button>
      </div>
    </div>
  );
}
