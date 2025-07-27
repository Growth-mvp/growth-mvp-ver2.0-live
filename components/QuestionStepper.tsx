'use client';

import React, { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import Button from '@/components/ui/button';
import { AnimatePresence, motion } from 'framer-motion';

// ✅ 統一された AnswerStep 型に対応
export interface AnswerStep {
  question: string;
  reason: string;
  answer: string;
}

interface QuestionStepperProps {
  questions: AnswerStep[];
  chapterTitle: string;
  onUpdateAnswer: (index: number, answer: string) => void;
  onComplete?: () => void;
}

export default function QuestionStepper({
  questions,
  chapterTitle,
  onUpdateAnswer,
  onComplete,
}: QuestionStepperProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!questions || questions.length === 0) {
    return (
      <div className="border rounded-xl shadow-md p-6 bg-white mb-8">
        <p className="text-gray-500">この章には質問がありません。</p>
      </div>
    );
  }

  const current = questions[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === questions.length - 1;
  const isComplete = questions.every((q) => q.answer.trim() !== '');

  const handleNext = () => {
    if (!isLast) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      if (isComplete && onComplete) onComplete();
    }
  };

  const handlePrev = () => {
    if (!isFirst) setCurrentIndex((prev) => prev - 1);
  };

  return (
    <div className="border rounded-xl shadow-md p-6 bg-white mb-8">
      <h3 className="text-lg font-bold mb-4 text-indigo-700">
        {chapterTitle}（{currentIndex + 1} / {questions.length}）
      </h3>

      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -100, opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="mb-4">
            <p className="font-semibold text-gray-800">問い：</p>
            <p className="text-gray-900 mb-2">{current.question}</p>
            <p className="text-sm text-gray-500">※{current.reason}</p>
          </div>

          <div className="mb-4">
            <Textarea
              placeholder="あなたの考えを書いてください..."
              value={current.answer}
              onChange={(e) => onUpdateAnswer(currentIndex, e.target.value)}
              className="min-h-[120px]"
            />
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex justify-between">
        <Button onClick={handlePrev} disabled={isFirst} variant="secondary">
          ← 前へ
        </Button>
        <Button onClick={handleNext}>
          {isLast ? '完了 →' : '次へ →'}
        </Button>
      </div>

      {isComplete && (
        <div className="mt-6 text-center text-green-600 font-semibold">
          ✅ この章の質問はすべて回答済みです。
        </div>
      )}
    </div>
  );
}
