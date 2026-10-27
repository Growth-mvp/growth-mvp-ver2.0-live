import 'server-only';

import type { SupabaseClient, User } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const TIME_BUDGET_MS = 5000;

export class AuthUserLookupError extends Error {}

/**
 * メールでAuthユーザーを探す（件数・時間に上限あり）。
 * 上限超過や取得失敗は例外にする。「見つからない」と誤判定すると二重アカウントの原因になるため。
 */
export async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const target = email.trim().toLowerCase();
  const startedAt = Date.now();

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      throw new AuthUserLookupError('time_budget_exceeded');
    }

    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) {
      throw new AuthUserLookupError(error.message);
    }

    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? '').trim().toLowerCase() === target);
    if (hit) return hit;

    if (users.length < PAGE_SIZE) return null;
  }

  throw new AuthUserLookupError('page_limit_exceeded');
}
