export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type PromptMeta = {
  stage?: 'basic_info' | 'story' | 'cascade' | 'generic' | 'manual';
  gaps?: Record<string, boolean>;
  departmentIndex?: number | null;
};

export type CoachHint = {
  id: string;
  title: string;
  message: string;
  ctaLabel?: string;
  ctaIntent?: 'scroll#mvv' | 'open:swot-examples' | 'navigate:/cascade' | 'copy:share-text';
  severity?: 'info' | 'warn' | 'success';
};

export type DeptHint = {
  deptIndex: number;
  deptName: string;
  hints: CoachHint[];
  nextAction?: string;
  okrDraft?: { objective: string; keyResults: string[] };
};

export interface AskCeoAgentResponse {
  content: string;
  detectedFields?: Record<string, string | boolean>;
  usedStrategy?: boolean;
  step?: number;
  nextStep?: 'mvv' | 'swot' | 'story' | 'cascade' | 'okr';
  hints?: CoachHint[];
  swotExamples?: { S: string[]; W: string[]; O: string[]; T: string[] } | null;
  deptHints?: DeptHint[];              // ← ★ 追加
  error?: string;
}

export async function askCeoAgent({
  messages,
  userId,
  strategyId,
  step,
  meta,
}: {
  messages: ChatMessage[];
  userId: string;
  strategyId?: string | null;
  step?: number;
  meta?: PromptMeta;
}): Promise<AskCeoAgentResponse> {
  try {
    const openAIMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const safeStrategyId =
      typeof strategyId === 'string' && strategyId.trim() !== '' ? strategyId : undefined;

    const payload: any = { messages: openAIMessages, userId, strategyId: safeStrategyId };
    if (typeof step === 'number' && Number.isFinite(step)) payload.step = step;
    if (meta) payload.meta = meta;

    const res = await fetch('/api/ask-ceo-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        content: 'サーバーでエラーが発生しました。時間をおいて再試行してください。',
        error: `status=${res.status}`,
      };
    }

    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      const m = /"content"\s*:\s*"([^"]*)"/.exec(text);
      return {
        content: m?.[1] ?? '応答の解析に失敗しました。時間をおいて再試行してください。',
        error: 'non-json-response',
      };
    }

    if (data && typeof data.content === 'string') {
      return {
        content: data.content,
        usedStrategy: !!data.usedStrategy,
        detectedFields: data.detectedFields ?? {},
        nextStep: data.nextStep ?? undefined,
        hints: Array.isArray(data.hints) ? data.hints : undefined,
        swotExamples: data.swotExamples ?? null,
        deptHints: Array.isArray(data.deptHints) ? data.deptHints : undefined, // ← ★
        step: typeof data.step === 'number' ? data.step : undefined,
        error: data.error,
      };
    }
    if (data?.reply?.content) {
      return { content: data.reply.content, usedStrategy: true };
    }
    return {
      content: '回答の取得に失敗しました。時間をおいて再試行してください。',
      error: 'invalid-response',
    };
  } catch {
    return {
      content: '通信エラーが発生しました。ネットワークをご確認のうえ再試行してください。',
      error: 'network',
    };
  }
}
