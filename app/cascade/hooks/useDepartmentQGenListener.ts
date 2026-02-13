// /app/cascade/hooks/useDepartmentQGenListener.ts
'use client';

import { useEffect } from 'react';
import { on, emit } from '@/utils/actionBus';
import type { AnswerStep } from '@/components/guide/QuestionStepper';
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';

// 先頭〜型定義付近を差し替え

// ✅ ベース（actionBus が保証する最小ペイロード）
type BusPayloadBase = {
  strategyId: string;
  chapterIndex: number;
  afterStepIndex: number;
};

// ✅ 追加情報は全部オプショナルに
type Payload = BusPayloadBase & {
  chapterTitle?: string; // 変更点: 必須→任意
  stepHint?: number;
  answersSoFar?: Array<{ stepNumber: number; answer: string }>;
  previousAnswer?: string;
  chapterBody?: string;
  context?: any;
};

// （中略）リスナー内で chapterTitle を使う場合はフォールバック
// const title = payload.chapterTitle ?? `Chapter ${payload.chapterIndex + 1}`;

export function useDepartmentQGenListener(onStep: (payload: Payload, step: AnswerStep) => void | Promise<void>) {
  useEffect(() => {
    const off = on('questions:generate:next', async (payload: Payload) => {
      try {
        const json = await authFetchJson<any>('/api/generate-department-question', {
          method: 'POST',
          json: payload,
        });

        const step = json?.step as AnswerStep;
        if (!step?.question) throw new Error('invalid step');

        await onStep?.(payload, step);
        emit('questions:generate:done', {});
      } catch (e: any) {
        const message = e instanceof AuthFetchError ? e.bodyText || e.message : e?.message ?? 'unknown error';
        emit('questions:generate:error', { message });
      }
    });
    return () => off?.();
  }, [onStep]);
}
