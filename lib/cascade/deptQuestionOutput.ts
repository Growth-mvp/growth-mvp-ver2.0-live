export type QuestionModelOutput = {
  text: string;
  finishReason: string | null;
  refusal: boolean;
  completionTokens: number | null;
  reasoningTokens: number | null;
};

export type QuestionOutputProblem = 'refused' | 'output_limit' | 'empty' | 'invalid_format';

export const QUESTION_FAILURE_MESSAGE =
  'テーマを作れませんでした。少し時間をおいて、もう一度お試しください。';

/** 応答の本文が使えない理由。使えるなら null。 */
export function questionOutputProblem(
  out: QuestionModelOutput,
  parsed: { question?: unknown; reason?: unknown } | null,
): QuestionOutputProblem | null {
  if (out.refusal) return 'refused';
  const hasText = out.text.trim() !== '';
  if (!hasText) return out.finishReason === 'length' ? 'output_limit' : 'empty';
  const question = typeof parsed?.question === 'string' ? parsed.question.trim() : '';
  const reason = typeof parsed?.reason === 'string' ? parsed.reason.trim() : '';
  if (!question || !reason) return 'invalid_format';
  return null;
}
