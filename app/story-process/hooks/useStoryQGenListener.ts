'use client';

import { useEffect, useRef } from 'react';
import { on, emit } from '@/utils/actionBus';
import type { AnswerStep } from '@/components/guide/QuestionStepper';
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';

type BusPayloadBase = {
  strategyId: string;
  chapterIndex: number;
  afterStepIndex: number;
};

type Payload = BusPayloadBase & {
  chapterTitle?: string;
  stepHint?: number;
  answersSoFar?: Array<{ stepNumber: number; answer: string }>;
  previousAnswer?: string;
  chapterBody?: string;
  context?: any;
};

export function useStoryQGenListener(
  onStep: (payload: Payload, step: AnswerStep) => void | Promise<void>
) {
  const inFlight = useRef(false);       // ★ 連打抑止
  const abortRef = useRef<AbortController | null>(null); // ★ 競合時にキャンセル

  useEffect(() => {
    const off = on('questions:generate:next', async (payload: Payload) => {
      if (inFlight.current) return; // 連打無視（必要あればキュー化）
      inFlight.current = true;

      // 新しいリクエストに切替時は古いのを中断
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const json = await authFetchJson<any>('/api/generate-question', {
          method: 'POST',
          json: payload,
          signal: abortRef.current.signal,
        });

        const step = json?.step as AnswerStep;
        if (!step || !step.question) throw new Error('invalid step payload');

        // ★ 状態更新（onStep）完了を待つ
        await onStep?.(payload, step);

        // ★ 状態反映後に done を通知（購読側が保存するならここで）
        emit('questions:generate:done', { chapterIndex: payload.chapterIndex });
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          const message = e instanceof AuthFetchError ? e.bodyText || e.message : e?.message ?? 'unknown error';
          emit('questions:generate:error', { message });
        }
      } finally {
        inFlight.current = false;
      }
    });

    return () => {
      off?.();
      abortRef.current?.abort();
    };
  }, [onStep]);
}
