'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QuestionCard from '@/components/guide/QuestionCard';
import Button from '@/components/ui/button';
import { useUserStore } from '@/store/userStore';
import { useQuestionStore } from '@/store/questionStore';
import { useStrategyStore } from '@/store/strategyStore';
import {
  saveStoryAnswers,
  saveStoryAnswers2,
  loadStoryAnswers,
  loadStoryAnswers2,
} from '@/utils/supabase';

export default function StoryGuidePage() {
  const router = useRouter();

  const {
    step,
    answer,
    currentQuestion,
    questionReason,
    setAnswer,
    nextStep,
    setQuestion,
    setStep,
    loading,
    setLoading,
  } = useQuestionStore();

  const {
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
    setAnswersToStrategyStore,
  } = useStrategyStore();

  const { user } = useUserStore();

  const MAX_STEPS = 4;

  const [answers, setAnswers] = useState<{
    answers: string[];
    questions: string[];
    reasons: string[];
  }>({
    answers: Array(MAX_STEPS).fill(''),
    questions: Array(MAX_STEPS).fill(''),
    reasons: Array(MAX_STEPS).fill(''),
  });

  const [hasLoadedAnswers, setHasLoadedAnswers] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const role =
    user?.role === 'admin'
      ? '経営者'
      : user?.role === 'manager'
      ? '部門責任者'
      : '現場担当者';

  useEffect(() => {
    if (user === null) {
      router.push('/login');
    }
  }, [user, router]);

  const fetchQuestion = async (step: number) => {
    setLoading(true);
    setFetchError('');
    try {
      const res = await fetch('/api/generate-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step,
          role,
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
      console.error('❌ 質問取得エラー:', error);
      setQuestion('（質問の取得に失敗しました）', '');
      setFetchError('質問の生成中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadAnswersFromSupabase = async () => {
      if (!user?.id) return;

      const loadedAnswers = await loadStoryAnswers(user.id);
      const loadedAnswers2 = await loadStoryAnswers2(user.id);

      if (loadedAnswers) {
        setAnswers(loadedAnswers);
        setAnswersToStrategyStore({
          answers: loadedAnswers.answers,
          questions: loadedAnswers.questions,
          reasons: loadedAnswers.reasons,
          answers2: loadedAnswers2 || [],
        });

        const nextStepIndex = loadedAnswers.answers.findIndex((a) => a === '');
        setStep(nextStepIndex === -1 ? MAX_STEPS - 1 : nextStepIndex);
      } else {
        const empty = {
          answers: Array(MAX_STEPS).fill(''),
          questions: Array(MAX_STEPS).fill(''),
          reasons: Array(MAX_STEPS).fill(''),
        };
        setAnswers(empty);
        setStep(0);
      }
      setHasLoadedAnswers(true);
    };

    if (user?.id && !hasLoadedAnswers) {
      loadAnswersFromSupabase();
    }
  }, [user?.id, hasLoadedAnswers, setAnswersToStrategyStore, setStep]);

  useEffect(() => {
    if (!hasLoadedAnswers) return;

    const currentAnswer = answers.answers[step] || '';
    const currentQ = answers.questions[step] || '';
    const currentR = answers.reasons[step] || '';

    setAnswer(currentAnswer);

    if (currentQ && currentR) {
      setQuestion(currentQ, currentR);
    } else {
      fetchQuestion(step);
    }
  }, [step, hasLoadedAnswers]);

  const handleNext = async () => {
    const updated = {
      answers: [...answers.answers],
      questions: [...answers.questions],
      reasons: [...answers.reasons],
    };

    updated.answers[step] = answer;
    updated.questions[step] = currentQuestion || '';
    updated.reasons[step] = questionReason || '';

    setAnswers(updated);

    if (step < MAX_STEPS - 1) {
      nextStep();
    } else {
      if (user?.id) {
        const saveError = await saveStoryAnswers(
          user.id,
          updated.answers,
          updated.questions,
          updated.reasons
        );
        const saveError2 = await saveStoryAnswers2(
          user.id,
          updated.questions.map(
            (q, i) => `Q: ${q}\n理由: ${updated.reasons[i] || ''}`
          )
        );

        if (!saveError && !saveError2) {
          setAnswersToStrategyStore({
            answers: updated.answers,
            questions: updated.questions,
            reasons: updated.reasons,
            answers2: updated.questions.map(
              (q, i) => `Q: ${q}\n理由: ${updated.reasons[i] || ''}`
            ),
          });
          router.push('/story?generate=1');
        } else {
          console.error('❌ Supabase保存に失敗:', saveError || saveError2);
        }
      } else {
        console.error('❌ ユーザーIDが取得できません');
      }
    }
  };

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-center text-gray-800">
        経営層向け 対話ガイド
      </h1>
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
        onGenerateQuestion={() => fetchQuestion(step)}
      />

      <div className="flex justify-end mt-4">
        <Button onClick={handleNext} disabled={!answer || loading}>
          {step === MAX_STEPS - 1 ? '完了 → ストーリー反映' : '次へ'}
        </Button>
      </div>
    </main>
  );
}
