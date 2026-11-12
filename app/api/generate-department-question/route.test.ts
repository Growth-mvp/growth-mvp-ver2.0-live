/* eslint-disable @typescript-eslint/no-explicit-any -- OpenAI 応答のモックは実際の形に近い緩い型で書く */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn(() => ({})) }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(async () => '99999999-9999-4999-8999-999999999999'),
  requireMembership: jest.fn(async () => ({ role: 'admin' })),
}));
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
}));

import { POST } from './route';
import { openai } from '@/lib/openai';
import { AI_MODELS, MODEL_CONFIGURATIONS } from '@/lib/modelConfig';
import { QUESTION_FAILURE_MESSAGE } from '@/lib/cascade/deptQuestionOutput';

const create = openai.chat.completions.create as unknown as jest.Mock;

/* 長さの検査（50〜120字・40〜100字・60〜120字）に収まる、読める文を作る */
const fill = (base: string, n: number) => base.repeat(Math.ceil(n / base.length)).slice(0, n);
const QUESTION = fill('既存顧客の再発注の手間を減らすには、どの業務から見直すべきかを決めてください。', 80);
const REASON = fill('再発注の手間は顧客の継続率に直結するため、今の段階で優先順位を決めておく必要があります。', 70);
const HINT = fill('例えば、書類作成・受注入力・問い合わせ対応のどれに時間がかかっているかを具体的に挙げてください。', 90);

function reqWith(body: unknown) {
  return { json: async () => body, headers: new Headers() } as any;
}

const BODY = { departmentName: '営業部', afterStepIndex: -1, mission: '既存顧客の深耕' };

function completion(content: string, finishReason: string, extra: Record<string, unknown> = {}) {
  return {
    choices: [{ finish_reason: finishReason, message: { content, refusal: null, ...extra } }],
    usage: { completion_tokens: 2000, completion_tokens_details: { reasoning_tokens: 1900 } },
  };
}

describe('POST /api/generate-department-question（6問の1問目）', () => {
  beforeEach(() => create.mockReset());

  it('本文が返ればテーマを返し、モデルと上限は config/models.json から取る', async () => {
    create.mockResolvedValueOnce(completion(JSON.stringify({ question: QUESTION, reason: REASON, hint: HINT }), 'stop'));
    const res = await POST(reqWith(BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.step.question).toBe(QUESTION);
    expect(create).toHaveBeenCalledTimes(1);
    const [params] = create.mock.calls[0];
    expect(params.model).toBe(AI_MODELS.lightweight);
    expect(params.max_completion_tokens).toBe(MODEL_CONFIGURATIONS.deptQuestion.maxCompletionTokens);
  });

  it('上限まで使って本文が空のまま止まったら、上限を2倍にして1回だけ再試行し、それでも空なら理由を返す', async () => {
    create.mockResolvedValue(completion('', 'length'));
    const res = await POST(reqWith(BODY));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].max_completion_tokens).toBe(MODEL_CONFIGURATIONS.deptQuestion.maxCompletionTokens);
    expect(create.mock.calls[1][0].max_completion_tokens).toBe(MODEL_CONFIGURATIONS.deptQuestion.maxCompletionTokens * 2);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json).toEqual({ error: 'question_generation_failed', reason: 'output_limit', message: QUESTION_FAILURE_MESSAGE });
    expect(JSON.stringify(json)).not.toContain('Invalid JSON from model');
    expect(json).not.toHaveProperty('raw');
  });

  it('本文が空で、上限以外で止まった場合は再試行せず、空の理由を返す', async () => {
    create.mockResolvedValueOnce(completion('', 'stop'));
    const res = await POST(reqWith(BODY));
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(502);
    expect((await res.json()).reason).toBe('empty');
  });

  it('モデルが拒否した場合は、拒否の理由を返す', async () => {
    create.mockResolvedValueOnce(completion('', 'stop', { refusal: 'cannot help' }));
    const res = await POST(reqWith(BODY));
    expect(res.status).toBe(502);
    expect((await res.json()).reason).toBe('refused');
  });

  it('本文はあるが JSON として使えない場合は、形式の理由を返し、本文は利用者に出さない', async () => {
    create.mockResolvedValueOnce(completion('これは質問です（JSONではない）', 'stop'));
    const res = await POST(reqWith(BODY));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.reason).toBe('invalid_format');
    expect(JSON.stringify(json)).not.toContain('JSONではない');
  });

  it('OpenAI の呼び出しが失敗したら、内部の文字列を見せず、再試行を促す', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('internal: key=sk-xxx quota'), { status: 401 }));
    const res = await POST(reqWith(BODY));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json).toEqual({ error: 'question_generation_failed', reason: 'openai_error', message: QUESTION_FAILURE_MESSAGE });
    expect(JSON.stringify(json)).not.toContain('sk-xxx');
  });
});
