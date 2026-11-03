/* 評価の費用・呼び出し回数の上限。実 API 呼び出しの直前に必ず確認する。 */

export const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

export const BUDGET_USD = 1;
export const MAX_ANSWER_CALLS = 14;
export const MAX_INTENT_CALLS = 7;
export const MAX_TOTAL_CALLS = MAX_ANSWER_CALLS + MAX_INTENT_CALLS;
/** 自動再試行は行わない（SDK 既定の再試行を無効化する） */
export const SDK_MAX_RETRIES = 0;
/** 意図判定は本番が max_tokens を指定していないため、モデルの既定上限で見積もる（gpt-4o-mini は 16,384） */
export const INTENT_OUTPUT_CAP_TOKENS = 16384;
export const ANSWER_OUTPUT_CAP_TOKENS = 6000;

export type Usage = { prompt_tokens: number; completion_tokens: number };

export function costUsd(model: string, usage: Usage): number {
  const p = PRICES_USD_PER_MTOK[model];
  if (!p) throw new Error(`単価が未登録のモデル: ${model}`);
  return (usage.prompt_tokens * p.input + usage.completion_tokens * p.output) / 1_000_000;
}

export type CallRecord = {
  seq: number;
  tag: string;
  model: string;
  usage: Usage | null;
  costUsd: number;
  error: string | null;
};

export class EvalBudgetExceeded extends Error {}

export class EvalCallGuard {
  private calls = 0;
  private spent = 0;
  private tag = 'untagged';
  readonly records: CallRecord[] = [];

  constructor(
    private readonly limits = {
      budgetUsd: BUDGET_USD,
      maxTotalCalls: MAX_TOTAL_CALLS,
      maxIntentCalls: MAX_INTENT_CALLS,
      maxAnswerCalls: MAX_ANSWER_CALLS,
    }
  ) {}

  setTag(tag: string): void {
    this.tag = tag;
  }

  get callCount(): number {
    return this.calls;
  }

  get spentUsd(): number {
    return this.spent;
  }

  /** 1回の呼び出しの最悪ケースの費用（出力は上限まで使うと仮定） */
  worstCaseUsd(model: string, estInputTokens: number, maxOutputTokens: number): number {
    return costUsd(model, { prompt_tokens: estInputTokens, completion_tokens: maxOutputTokens });
  }

  /** 送信の直前に呼ぶ。上限を超えるなら送らずに例外にする。 */
  beforeCall(model: string, estInputTokens: number, maxOutputTokens: number): void {
    const isIntent = model === 'gpt-4o-mini';
    const intentCount = this.records.filter((r) => r.model === 'gpt-4o-mini').length;
    const answerCount = this.records.length - intentCount;
    if (this.calls + 1 > this.limits.maxTotalCalls) {
      throw new EvalBudgetExceeded(`呼び出し回数の上限（${this.limits.maxTotalCalls}）を超えます`);
    }
    if (isIntent && intentCount + 1 > this.limits.maxIntentCalls) {
      throw new EvalBudgetExceeded(`意図判定の上限（${this.limits.maxIntentCalls}）を超えます`);
    }
    if (!isIntent && answerCount + 1 > this.limits.maxAnswerCalls) {
      throw new EvalBudgetExceeded(`回答の上限（${this.limits.maxAnswerCalls}）を超えます`);
    }
    const worst = this.worstCaseUsd(model, estInputTokens, maxOutputTokens);
    if (this.spent + worst > this.limits.budgetUsd) {
      throw new EvalBudgetExceeded(
        `予算上限（$${this.limits.budgetUsd}）を超える恐れがあるため送信しません（現在 $${this.spent.toFixed(6)}、次の最悪ケース $${worst.toFixed(6)}）`
      );
    }
    this.calls += 1;
  }

  afterCall(model: string, usage: Usage | null, error: string | null = null): void {
    const cost = usage ? costUsd(model, usage) : 0;
    this.spent += cost;
    this.records.push({
      seq: this.records.length + 1,
      tag: this.tag,
      model,
      usage,
      costUsd: cost,
      error,
    });
  }

  /** 送信関数を包む。再試行はせず、失敗も1回として数える。 */
  wrap<P extends { model: string; messages: Array<{ content: unknown }>; max_completion_tokens?: number }, R extends { usage?: Usage | null }>(
    raw: (params: P) => Promise<R>
  ): (params: P) => Promise<R> {
    return async (params: P) => {
      const est = Math.ceil(
        params.messages.reduce((n, m) => n + String(m.content ?? '').length, 0) / 1.5
      );
      const cap = params.max_completion_tokens ?? INTENT_OUTPUT_CAP_TOKENS;
      this.beforeCall(params.model, est, cap);
      try {
        const res = await raw(params);
        this.afterCall(params.model, res.usage ?? null);
        return res;
      } catch (e) {
        this.afterCall(params.model, null, e instanceof Error ? e.message : String(e));
        throw e;
      }
    };
  }

  /** 計画の最悪ケース（実行前の見積もり）。 */
  static plannedWorstCaseUsd(estAnswerInputTokens: number, estIntentInputTokens: number): number {
    const answers = costUsd('gpt-5.6-luna', {
      prompt_tokens: estAnswerInputTokens,
      completion_tokens: MAX_ANSWER_CALLS * ANSWER_OUTPUT_CAP_TOKENS,
    });
    const intents = costUsd('gpt-4o-mini', {
      prompt_tokens: estIntentInputTokens,
      completion_tokens: MAX_INTENT_CALLS * INTENT_OUTPUT_CAP_TOKENS,
    });
    return answers + intents;
  }
}
