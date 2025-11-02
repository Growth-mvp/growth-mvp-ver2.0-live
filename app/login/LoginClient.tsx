// app/login/LoginClient.tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';
import { resolveCompanyId } from '@/utils/company';
import { joinCompany } from '@/utils/supabase/membership';
import { isValidUUID, setCompanyIdCookie } from '@/utils/supabase/client';

export default function LoginClient() {
  const router = useRouter();
  const search = useSearchParams();

  const { setUser, setMembership, setCompanyId } = useUserStore();

  const joinCompanyId = (search?.get('company') || '').trim() || null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleLogin = async () => {
    setErrorMessage('');
    if (!email || !password) {
      setErrorMessage('メールアドレスとパスワードを入力してください');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data?.user) throw new Error(error?.message || 'ログインに失敗しました');

      const userId = data.user.id;
      const userEmail = data.user.email ?? '';
      const name =
        (data.user.user_metadata?.name as string | undefined) ??
        (data.user.user_metadata?.full_name as string | undefined) ??
        '';

      setUser({ id: userId, email: userEmail, name, role: 'member' });

      let cid: string | null = null;
      if (joinCompanyId && isValidUUID(joinCompanyId)) {
        try {
          const joined = await joinCompany({ userId, companyId: joinCompanyId, role: 'member' });
          cid = joined.companyId ?? null;
          if (cid) setCompanyIdCookie(cid);
        } catch (e) {
          console.warn('joinCompany failed:', e);
        }
      }

      if (!cid) cid = await resolveCompanyId();

      let departmentId: string | null = null;
      let role: 'admin' | 'manager' | 'member' | null = null;
      try {
        const { data: membershipRow } = await supabase
          .from('company_members')
          .select('company_id, department_id, role')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();

        if (membershipRow) {
          cid = (membershipRow as any).company_id ?? cid ?? null;
          departmentId = (membershipRow as any).department_id ?? null;
          role = (membershipRow as any).role ?? null;
        }
      } catch { /* noop */ }

      setMembership({ companyId: cid ?? null, departmentId: departmentId ?? null, role });
      setCompanyId(cid ?? null);
      router.replace('/');
    } catch (e: any) {
      setErrorMessage('ログイン失敗: ' + (e?.message || '不明なエラー'));
    } finally {
      setLoading(false);
    }
  };

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    if (!loading) void handleLogin();
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-[28px] font-semibold tracking-tight text-zinc-900">サインイン</div>
          <p className="mt-1 text-[13px] text-zinc-500">アカウントにログインしてください</p>
        </div>

        {joinCompanyId && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
            招待リンクからのログインです。ログイン後に会社
            （ID: <code className="font-mono">{joinCompanyId}</code>）へ参加します。
          </div>
        )}

        <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {errorMessage && (
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700" role="alert">
              {errorMessage}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4" autoComplete="on">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-zinc-700">メールアドレス</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-zinc-300 bg-white/90 px-3 py-2 text-[14px] outline-none focus:ring-4 focus:ring-zinc-200"
                autoComplete="email"
                inputMode="email"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-medium text-zinc-700">パスワード</label>
              <input
                type="password"
                placeholder="6文字以上"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-zinc-300 bg-white/90 px-3 py-2 text-[14px] outline-none focus:ring-4 focus:ring-zinc-200"
                autoComplete="current-password"
                minLength={6}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className={`mt-2 w-full rounded-full h-11 px-5 text-[14px] font-semibold transition ${
                loading
                  ? 'bg-zinc-200 text-zinc-500 cursor-not-allowed'
                  : 'bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:opacity-90 active:opacity-85'
              }`}
              title="Enterキーでも送信できます"
            >
              {loading ? 'ログイン中…' : 'ログイン'}
            </button>
          </form>

          <p className="mt-4 text-center text-[13px] text-zinc-600">
            アカウントをお持ちでないですか？{' '}
            <a href="/signup" className="font-medium text-[color:var(--accent)] hover:opacity-90 underline">
              新規登録はこちら
            </a>
          </p>
        </div>

        <p className="mt-4 text-center text-[11px] text-zinc-500">
          Enter で送信・Shift+Enter で改行に対応しています
        </p>
      </div>
    </main>
  );
}
