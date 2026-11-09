/* 実アプリのレイアウト確認用のSupabase代替（評価専用）。ログイン済みの架空セッションを返し、通信はしない。 */
import { MOCK_COMPANY_ID } from './shell-userStore';

const user = { id: 'u-mock', email: 'mock@example.invalid' };
const session = { access_token: 'mock-token', token_type: 'bearer', user, expires_at: 4102444800 };
const sub = { unsubscribe() {} };

function queryResult(table: string): unknown[] {
  if (table === 'company_members') {
    return [{ company_id: MOCK_COMPANY_ID, role: 'admin', user_id: user.id, created_at: '2026-01-01T00:00:00.000Z' }];
  }
  return [];
}

function makeQuery(table: string): any {
  const result = () => ({ data: queryResult(table), error: null, status: 200 });
  const q: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result()).then(res, rej);
        if (prop === 'single' || prop === 'maybeSingle') {
          return async () => ({ data: queryResult(table)[0] ?? null, error: null, status: 200 });
        }
        return (..._a: unknown[]) => q;
      },
    },
  );
  return q;
}

export const supabase: any = {
  auth: {
    onAuthStateChange: (_cb: unknown) => ({ data: { subscription: sub } }),
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    signOut: async () => ({ error: null }),
  },
  from: (table: string) => makeQuery(table),
  rpc: async (..._a: unknown[]) => ({ data: null, error: null }),
  channel: (..._a: unknown[]) => {
    const ch: any = { on: () => ch, subscribe: () => ch };
    return ch;
  },
  removeChannel: (..._a: unknown[]) => {},
};

export async function safeGetSession(): Promise<{ data: { session: typeof session }; error: null }> {
  return { data: { session }, error: null };
}
export function getCompanyIdFromCookie(): string {
  return MOCK_COMPANY_ID;
}
export function setCompanyIdCookie(_id?: unknown): void {}
export function clearCompanyIdCookie(): void {}
export function isValidUUID(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0;
}
export function clearDisplayCookies(): void {}
export function createClient(): any {
  return supabase;
}
