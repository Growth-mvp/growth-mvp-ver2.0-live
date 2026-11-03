/* 実回答品質評価の比較条件。
 * 条件A・B は同じモデル・設定・経営相談用の基本指示（振る舞い規範・基礎ガイド・禁則）を使い、
 * 違いは「自社データの有無」に限定する。 */
import agentPrompt from '@/lib/agentPrompt';
import { PRODUCTION_GROWTH_SHIFT_FOUNDATION, PRODUCTION_TABOO } from './productionText';

export const EVAL_MODEL = 'gpt-5.6-luna';
export const EVAL_REASONING_EFFORT = 'low';
export const EVAL_MAX_COMPLETION_TOKENS = 6000;
export const INTENT_MODEL = 'gpt-4o-mini';

const COMPANY_HEADER_START = '【会社の前提】';
const BEHAVIOR_START = '【振る舞い規範】';

/**
 * 条件Aの基本指示。本番の agentPrompt から、会社情報の見出し（【会社の前提】〜）だけを取り除く。
 * 振る舞い規範・STAGE1のデータの扱い・外部情報の扱いは、条件Bと同じ文面を使う。
 */
export function buildConditionASystem(): string {
  const full = agentPrompt({} as any, [], []);
  const start = full.indexOf(COMPANY_HEADER_START);
  const end = full.indexOf(BEHAVIOR_START);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('条件Aの基本指示を切り出せません（本番の agentPrompt の構造が変わった可能性）');
  }
  const base = full.slice(0, start) + full.slice(end);
  return `${base}\n${PRODUCTION_GROWTH_SHIFT_FOUNDATION}\n${PRODUCTION_TABOO}`;
}

export type EvalPayload = {
  condition: 'A' | 'B';
  model: string;
  reasoning_effort: string;
  max_completion_tokens: number;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
};

export function buildConditionAPayload(question: string): EvalPayload {
  return {
    condition: 'A',
    model: EVAL_MODEL,
    reasoning_effort: EVAL_REASONING_EFFORT,
    max_completion_tokens: EVAL_MAX_COMPLETION_TOKENS,
    messages: [
      { role: 'system', content: buildConditionASystem() },
      { role: 'user', content: question },
    ],
  };
}

/** 文字数からの概算（日本語混じりの目安）。実測は実行時の usage で確認する。 */
export const APPROX_CHARS_PER_TOKEN = 1.5;

export function approxTokens(chars: number): number {
  return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
}
