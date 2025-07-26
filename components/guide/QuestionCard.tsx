'use client';

import React from 'react';

type QuestionCardProps = {
  step: number;
  question: string;
  reason?: string;
  answer: string;
  loading?: boolean;
  onGenerateQuestion?: () => void;
  onAnswerChange: (val: string) => void;
  onNext: () => void;
};

export default function QuestionCard({
  step,
  question,
  reason,
  answer,
  loading = false,
  onGenerateQuestion,
  onAnswerChange,
  onNext,
}: QuestionCardProps) {
  if (loading) {
    return (
      <div className="p-4 text-gray-500 border rounded-md bg-white shadow">
        質問を生成中です...
      </div>
    );
  }

  return (
    <div className="border rounded-xl p-6 shadow-md bg-white space-y-4">
      <div className="text-sm text-gray-500 font-semibold">Step {step}</div>

      <div className="text-lg font-bold text-blue-800">
        🧠 問い：{question}
      </div>

      {reason && (
        <div className="text-sm text-gray-600 italic">
          理由：{reason}
        </div>
      )}

      <textarea
        className="w-full h-32 p-3 border rounded-md resize-none text-sm text-gray-800"
        value={answer}
        onChange={(e) => onAnswerChange(e.target.value)}
        placeholder="あなたの考えを自由に記入してください"
      />

      <div className="flex justify-between items-center mt-2">
        {onGenerateQuestion && (
          <button
            onClick={onGenerateQuestion}
            className="text-sm text-blue-500 hover:underline"
          >
            ↻ 質問を再生成する
          </button>
        )}

        <button
          onClick={onNext}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded disabled:opacity-50"
          disabled={!answer.trim()}
        >
          {step === 4 ? '完了 → ストーリー反映' : '次の質問へ'}
        </button>
      </div>
    </div>
  );
}
