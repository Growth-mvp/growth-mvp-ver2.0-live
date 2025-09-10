// /components/StepLayout.tsx
'use client';

import React from 'react';

export interface StepLayoutProps {
  step?: number;       // 互換維持のため残す（描画には使わない）
  totalSteps?: number; // 同上
  title?: string;      // 互換維持のため optional に（描画しない）
  subtitle?: string;   // 同上
  children: React.ReactNode;
}

export default function StepLayout({
  // 受け取るが描画しない（タイトル二重回避）
  // step,
  // totalSteps,
  // title,
  // subtitle,
  children,
}: StepLayoutProps) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-6 dark:from-zinc-950 dark:to-zinc-900">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* 本文（ガラスカード） */}
        <section className="rounded-2xl border border-black/10 bg-white/70 p-4 shadow-sm backdrop-blur md:p-6 dark:bg-white/5 dark:border-white/10">
          {children}
        </section>
      </div>
    </main>
  );
}
