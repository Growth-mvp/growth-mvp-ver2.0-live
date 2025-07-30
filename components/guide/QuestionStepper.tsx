'use client';

import React, { useEffect, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import Button from '@/components/ui/button';
import { AnimatePresence, motion } from 'framer-motion';
import { AnswerStep } from '@/types/strategy';

interface QuestionStepperProps {
  questions: AnswerStep[];
  chapterTitle: string;
  chapterBody: string;
  chapterIndex: number;
  onUpdateAnswer: (chapterIdx: number, stepIdx: number, answer: string) => void | Promise<void>;
  onComplete?: () => void;
}

export default function QuestionStepper({
  questions,
  chapterTitle,
  chapterBody,
  chapterIndex,
  onUpdateAnswer,
  onComplete,
}: QuestionStepperProps) {
  const [steps, setSteps] = useState<AnswerStep[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [touched, setTouched] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);

  const current = steps[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === steps.length - 1;
  const hasUnansweredStep = steps.some((step) => step.answer.trim() === '');
  const maxSteps = 3;

  useEffect(() => {
    if (questions.length > 0) {
      setSteps(questions);
      setStarted(true);
    }
  }, [questions]);

  const generateNextQuestion = async (previousAnswer: string) => {
    if (steps.length >= maxSteps) return;
    setGenerating(true);
    setError('');

    try {
      const res = await fetch('/api/generate-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterTitle,
          chapterBody,
          stepNumber: steps.length + 1,
          previousAnswer,
        }),
      });

      const data = await res.json();

      if (res.ok && data?.step) {
        const newStep = data.step;
        const newSteps = [...steps, newStep];
        setSteps(newSteps);
        setCurrentIndex(newSteps.length - 1);
        await onUpdateAnswer(chapterIndex, newSteps.length - 1, newStep.answer || '');
      } else {
        setError(data?.error || 'サーバーエラーが発生しました');
        console.error('❌ 質問生成エラー:', data?.error);
      }
    } catch (err) {
      console.error('❌ 通信エラー:', err);
      setError('通信エラーが発生しました');
    } finally {
      setGenerating(false);
    }
  };

  const handleStart = async () => {
    setStarted(true);
    await generateNextQuestion('');
  };

  const handleNext = async () => {
    setTouched(true);
    if (!current?.answer.trim()) return;

    setDirection(1);

    if (!isLast) {
      setCurrentIndex((prev) => prev + 1);
    } else if (steps.length < maxSteps) {
      await generateNextQuestion(current.answer);
    }
  };

  const handlePrev = () => {
    setDirection(-1);
    if (!isFirst) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleAnswerChange = async (value: string) => {
    setTouched(true);
    const updatedSteps = [...steps];
    updatedSteps[currentIndex] = {
      ...updatedSteps[currentIndex],
      answer: value,
    };
    setSteps(updatedSteps);

    try {
      await onUpdateAnswer(chapterIndex, currentIndex, value);
    } catch (err) {
      console.error('❌ 回答保存失敗:', err);
      setError('回答の保存に失敗しました');
    }
  };

  if (!started) {
    return (
      <div className="border rounded-xl shadow-md p-6 bg-white mb-8 text-center">
        <h3 className="text-lg font-bold text-indigo-700 mb-4">{chapterTitle}</h3>
        <p className="text-gray-600 mb-6">この章について、最初の質問を生成しましょう。</p>
        <Button onClick={handleStart}>💬 最初の質問を生成する</Button>
      </div>
    );
  }

  return (
    <div className="border rounded-xl shadow-md p-6 bg-white mb-8">
      <h3 className="text-lg font-bold mb-4 text-indigo-700">
        {chapterTitle}（{currentIndex + 1} / {steps.length}）
      </h3>

      <div className="relative h-[260px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentIndex}
            initial={{ x: direction === 1 ? 150 : -150, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction === 1 ? -150 : 150, opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="absolute w-full top-0"
          >
            <div className="mb-4">
              <p className="font-semibold text-gray-800">問い：</p>
              <p className="text-gray-900 mb-2">{current?.question}</p>
              <p className="text-sm text-gray-500">※{current?.reason}</p>
            </div>

            <Textarea
              placeholder="あなたの考えを書いてください..."
              value={current?.answer || ''}
              onChange={(e) => handleAnswerChange(e.target.value)}
              className={`min-h-[120px] ${touched && !current?.answer.trim() ? 'border-red-500' : ''}`}
            />
            {touched && !current?.answer.trim() && (
              <p className="text-sm text-red-600 mt-1">※ 回答を入力してください</p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {error && <p className="text-sm text-red-500 mt-2">⚠️ {error}</p>}

      <div className="flex justify-between mt-6">
        <Button onClick={handlePrev} disabled={isFirst} variant="secondary">
          ← 前へ
        </Button>

        {generating ? (
          <Button disabled>生成中...</Button>
        ) : (
          <Button onClick={handleNext} disabled={!current?.answer.trim()}>
            {isLast ? 'さらに深掘り →' : '次へ →'}
          </Button>
        )}
      </div>

      {!generating && steps.length >= maxSteps && !hasUnansweredStep && onComplete && (
        <div className="mt-6 text-center">
          <Button onClick={onComplete}>✅ この章は完了 → 次へ</Button>
        </div>
      )}
    </div>
  );
}
