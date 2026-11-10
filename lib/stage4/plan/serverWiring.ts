import 'server-only';

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

import { getOpenAIModelParamsForProcess } from '@/lib/modelConfig';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { buildStateFromDbRow } from '@/utils/supabase/strategy';

import { createMockModel } from './mockGenerate';
import { createPlanApi } from './planApi';
import { createSupabasePlanGateway } from './planGatewaySupabase';
import type { ModelReply } from './planGenerate';
import type { RawPlanInput, RawPlanStrategy } from './source';

/* テーブルが無いことを示すPostgreSQL（42P01）とPostgREST（PGRST205）のコード */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

const bearerOf = (req: Request): string | null => {
  const auth = req.headers.get('authorization') || '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
};

/* 利用者のトークンで読み書きするクライアント。行単位の権限は、データベース側の規則で強制される */
function userScopedClient(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  const token = bearerOf(req) ?? '';
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* 実AIの呼び出し口。モデルの設定は既存の設定機構（config/models.json の stage4PlanDraft）を使う */
async function openAiCall(prompt: string): Promise<ModelReply> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const params = getOpenAIModelParamsForProcess('stage4PlanDraft');
  const res = await openai.chat.completions.create({
    ...params,
    messages: [{ role: 'user', content: prompt }],
  });
  const choice = res.choices[0];
  return {
    text: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
    model: res.model ?? null,
    usage: res.usage ?? null,
  };
}

export const stage4PlanApi = createPlanApi({
  verifyUser: (req) => getAuthUserIdFromBearer(getSupabaseAdmin(), req),
  gatewayFor: (req) => createSupabasePlanGateway(userScopedClient(req)),
  enabled: process.env.STAGE4_PLAN_API_ENABLED === 'true',
  storeAvailable: async (req) => {
    const { error } = await userScopedClient(req).from('stage4_plan_documents').select('id').limit(0);
    return !error || !MISSING_TABLE_CODES.has(error.code ?? '');
  },
  generation: {
    now: () => new Date().toISOString(),
    currentYm: () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    },
    mapStrategy: (row) => ({ ...buildStateFromDbRow(row), id: row.id, company_id: row.company_id }) as unknown as RawPlanStrategy,
    modelFor: async (raw: RawPlanInput) =>
      process.env.STAGE4_PLAN_MODEL_MOCK === 'true' && process.env.NODE_ENV !== 'production'
        ? createMockModel(raw)
        : openAiCall,
  },
});
