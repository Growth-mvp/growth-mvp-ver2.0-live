import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

import { createPlanApi } from './planApi';
import { createSupabasePlanGateway } from './planGatewaySupabase';

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

export const stage4PlanApi = createPlanApi({
  verifyUser: (req) => getAuthUserIdFromBearer(getSupabaseAdmin(), req),
  gatewayFor: (req) => createSupabasePlanGateway(userScopedClient(req)),
});
