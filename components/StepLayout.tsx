'use client';

import React from 'react';

export interface StepLayoutProps {
  step?: number; // 任意ステップ番号
  totalSteps?: number;
  title: string; // 章のタイトル（例：第1章：この会社は何者か？）
  subtitle?: string; // 任意のサブタイトル
  children: React.ReactNode;
}

export default function StepLayout({
  step,
  totalSteps,
  title,
  subtitle,
  children,
}: StepLayoutProps) {
  const showStepBar = step !== undefined && totalSteps !== undefined;

  return (
    <main className="p-8 bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* ステップインジケーター（任意） */}
        {showStepBar && (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div>ステップ {step} / {totalSteps}</div>
            <div className="flex-1 h-2 bg-gray-200 mx-4 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${(step / totalSteps) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* タイトル */}
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
          {subtitle && <p className="text-gray-600 mt-1">{subtitle}</p>}
        </div>

        {/* 本文 */}
        <div>{children}</div>
      </div>
    </main>
  );
}
