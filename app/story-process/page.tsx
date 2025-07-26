'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import Button from '@/components/ui/button';

type DeepQuestion = {
  chapter: string;
  question: string;
  reason: string;
  answer: string;
};

export default function StoryProcessPage() {
  const router = useRouter();
  const { user } = useUserStore();

  const {
    story,
    answers2,
    setAnswers2,
    industry,
    revenue,
    employees,
    thought,
    mission,
    vision,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    answers,
    setStory,
    setStrategySummary,
    setNotification,
  } = useStrategyStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showInfo, setShowInfo] = useState(false);

  // ストーリーの章分割（■区切り）
  const storyParts = story?.split('■') || [];

  // 掘り下げ質問を章ごとにグループ化
  const groupedAnswers: Record<string, DeepQuestion[]> = answers2.reduce((acc, cur) => {
    if (!acc[cur.chapter]) acc[cur.chapter] = [];
    acc[cur.chapter].push(cur);
    return acc;
  }, {} as Record<string, DeepQuestion[]>);

  const handleGenerateQuestions = async () => {
    if (!story || story.length < 10) {
      setError('⚠️ ストーリーが未生成です');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story }),
      });

      const data = await res.json();

      if (!res.ok || !data.questions) {
        throw new Error(data.error || '質問の生成に失敗しました');
      }

      setAnswers2(data.questions as DeepQuestion[]);
      setNotification('✅ 掘り下げ質問を生成しました');
    } catch (err: any) {
      console.error('❌ 質問生成エラー:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateFinalStory = async () => {
    if (!user) {
      setError('⚠️ ログインが必要です');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/generate-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry,
          revenue,
          employees,
          thought,
          mission,
          vision,
          value,
          strength,
          weakness,
          opportunity,
          threat,
          answers,
          answers2,
        }),
      });

      const result = await response.json();

      if (response.ok && result.story) {
        setStory(result.story);
        setStrategySummary(result.summary);
        setNotification('✅ 最終ストーリーを生成しました');
      } else {
        setError(result.error || 'ストーリー生成に失敗しました');
      }
    } catch (err) {
      console.error(err);
      setError('ストーリー生成中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) router.push('/login');
  }, [user]);

  return (
    <main className="p-6 min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <h1 className="text-2xl font-bold text-center mb-6">📖 ストーリー生成プロセス</h1>

      {/* 章別ストーリー表示 */}
      {story && storyParts.length > 1 ? (
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-2">📝 ストーリーたたき台</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {storyParts.slice(1).map((section, index) => (
              <div key={index} className="p-4 bg-white border rounded shadow-sm">
                <h3 className="text-sm text-gray-500 mb-1">第{index + 1}章</h3>
                <p className="text-gray-800 whitespace-pre-wrap text-sm">{section.trim()}</p>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-red-600 text-sm mb-6">※ ストーリーが未生成です。先にたたき台を生成してください。</p>
      )}

      {/* 掘り下げ質問生成 */}
      {answers2.length === 0 && (
        <div className="mb-8">
          <Button onClick={handleGenerateQuestions} disabled={loading}>
            {loading ? '生成中...' : '掘り下げ質問を生成'}
          </Button>
          {error && <p className="text-red-600 mt-2">{error}</p>}
        </div>
      )}

      {/* 掘り下げ質問の章別表示 */}
      {answers2.length > 0 && (
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-3">🧠 掘り下げ質問と回答</h2>
          {Object.entries(groupedAnswers).map(([chapter, items], idx) => (
            <div key={chapter} className="mb-6">
              <h3 className="text-gray-600 font-bold mb-2">
                {chapter}（第{idx + 1}章）
              </h3>
              <div className="space-y-4">
                {items.map((item, index) => (
                  <div key={index} className="p-4 bg-white border rounded shadow-sm">
                    <p className="text-sm text-gray-500">Q{index + 1}：{item.question}</p>
                    <p className="text-xs text-gray-400 mb-1">理由：{item.reason}</p>
                    <textarea
                      className="w-full p-2 border rounded text-sm"
                      rows={3}
                      placeholder="あなたの回答を入力..."
                      value={item.answer}
                      onChange={(e) => {
                        const updated = [...answers2];
                        updated.find((q) => q.question === item.question)!.answer = e.target.value;
                        setAnswers2(updated);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 最終ストーリー生成 */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-2">🎬 最終ストーリー生成</h2>
        <Button onClick={handleGenerateFinalStory} disabled={loading}>
          {loading ? '生成中...' : 'ストーリーを完成させる'}
        </Button>
        {error && <p className="text-red-600 mt-2">{error}</p>}
      </section>

      {/* 経営情報トグル */}
      <section>
        <button
          className="text-sm text-blue-600 underline mb-2"
          onClick={() => setShowInfo(!showInfo)}
        >
          {showInfo ? '▲ 経営情報を隠す' : '▼ 経営情報を表示'}
        </button>
        {showInfo && (
          <div className="p-4 bg-white border rounded shadow text-sm">
            <ul className="list-disc pl-5 text-gray-700 space-y-1">
              <li>業種: {industry}</li>
              <li>売上: {revenue}</li>
              <li>従業員数: {employees}</li>
              <li>思い: {thought}</li>
              <li>MVV: {mission} / {vision} / {value}</li>
              <li>SWOT: S={strength} / W={weakness} / O={opportunity} / T={threat}</li>
            </ul>
          </div>
        )}
      </section>

      {/* カスケードへ遷移 */}
      <div className="text-center mt-10">
        <Button onClick={() => router.push('/cascade')} className="bg-blue-600 text-white hover:bg-blue-700">
          👉 戦略カスケードへ進む
        </Button>
      </div>
    </main>
  );
}
