// components/StepLayout.tsx
'use client';

import React from 'react';

export interface StepLayoutProps {
  step: number;
  totalSteps: number;
  title: string;
  nextButtonLabel?: string; // ← ✅ これを追加
  children: React.ReactNode;
}

export default function StepLayout({ step, totalSteps, title, children }: StepLayoutProps) {
  return (
    <div className="space-y-6">
      {/* ステップインジケーター */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <div>ステップ {step} / {totalSteps}</div>
        <div className="flex-1 h-2 bg-gray-200 mx-4 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* タイトル */}
      <h2 className="text-2xl font-bold text-gray-800">{title}</h2>

      {/* 内容 */}
      <div>{children}</div>
    </div>
  );
}
