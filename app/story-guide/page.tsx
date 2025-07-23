'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QuestionCard from '@/components/guide/QuestionCard';
import Button from '@/components/ui/button';
import { useUserStore } from '@/store/userStore';
import { useQuestionStore } from '@/store/questionStore';
import { saveStoryAnswers } from '@/utils/supabase';

export default function StoryGuidePage() {
  const {
    step,
    answer,
    currentQuestion,
    questionReason,
    setAnswer,
    nextStep,
    setQuestion,
    reset,
    loading,
    setLoading,
  } = useQuestionStore();

  const { user } = useUserStore();
  const router = useRouter();

  const MAX_STEPS = 4;
  const [answers, setAnswers] = useState<string[]>(Array(MAX_STEPS).fill(''));
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    const fetchQuestion = async () => {
      setLoading(true);
      setFetchError('');

      try {
        const res = await fetch('/api/generate-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: '経営者',
            industry: '製造業',
            revenue: '30億円',
            employees: '100人',
            thought: '社員が誇りを持てる会社にしたい',
            mission: '未来の技術で社会に貢献する',
            vision: 'グローバルで評価される企業に',
            value: '誠実・挑戦・現場主義',
            strength: '技術力と職人の暗黙知',
            weakness: '営業力が弱い',
            opportunity: '海外市場の拡大',
            threat: '価格競争の激化',
          }),
        });

        const json = await res.json();
        const result = json.result ?? '';

        const match = result.match(/問い:\s*(.+?)\n理由:\s*(.+)/s);
        if (match) {
          const [, question, reason] = match;
          setQuestion(question.trim(), reason.trim());
        } else {
          setQuestion('（質問の取得に失敗しました）', '');
          setFetchError('質問の形式が正しくありませんでした。');
        }
      } catch (error) {
        setFetchError('質問の生成中にエラーが発生しました。');
        console.error('❌ 質問取得エラー:', error);
        setQuestion('（質問の取得に失敗しました）', '');
      } finally {
        setLoading(false);
      }
    };

    if (step === 0 && !currentQuestion) {
      reset();
      fetchQuestion();
    }
  }, [step]);

  const handleNext = async () => {
    const updated = [...answers];
    updated[step] = answer;
    setAnswers(updated);

    if (step < MAX_STEPS - 1) {
      nextStep();
    } else {
      if (user?.id) {
        await saveStoryAnswers(user.id, updated);
        router.push('/story');
      } else {
        console.error('❌ ユーザーIDが取得できません');
      }
    }
  };

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-center text-gray-800">経営層向け 対話ガイド</h1>

      <p className="text-gray-600 text-center text-sm">
        以下はAIが生成した戦略ストーリーを深めるための“問い”です。あなたの考えを言語化することで、より実行可能な戦略に近づけていきましょう。
      </p>

      <div className="text-sm text-gray-500 text-right mt-2">
        ステップ {step + 1} / {MAX_STEPS}
      </div>

      {fetchError && (
        <div className="text-red-500 text-sm font-medium">{fetchError}</div>
      )}

      <QuestionCard
        question={currentQuestion}
        reason={questionReason}
        answer={answer}
        loading={loading}
        onAnswerChange={(val) => setAnswer(val)}
        step={step + 1}
        onNext={handleNext}
      />

      <div className="flex justify-end mt-4">
        <Button onClick={handleNext} disabled={!answer || loading}>
          {step === MAX_STEPS - 1 ? '完了 → ストーリー反映' : '次へ'}
        </Button>
      </div>
    </main>
  );
}
