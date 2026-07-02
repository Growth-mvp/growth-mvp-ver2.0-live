// app/login/LoginClient.tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
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
  const redirectTo = (search?.get('redirect_to') || '').trim() || null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const getLoginErrorMessage = (error: any): string => {
    if (!error) return 'ログインに失敗しました。もう一度お試しください。';

    const message = (error?.message || '').toLowerCase();

    // Supabase 標準エラーメッセージをマッピング
    if (message.includes('invalid login credentials') || message.includes('invalid')) {
      return 'メールアドレスまたはパスワードが正しくありません。';
    }
    if (message.includes('email not confirmed')) {
      return 'このメールアドレスはまだ確認されていません。確認メールをご確認ください。';
    }
    if (message.includes('too many requests')) {
      return 'ログイン試行回数が多すぎます。しばらく後にお試しください。';
    }
    if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
      return 'ネットワーク接続を確認してください。';
    }

    // デフォルト
    return 'ログインに失敗しました。もう一度お試しください。';
  };

  const handleLogin = async () => {
    setErrorMessage('');
    if (!email || !password) {
      setErrorMessage('メールアドレスとパスワードを入力してください');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data?.user) throw new Error(error?.message || 'login_failed');

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

      // リダイレクト先を決定：パラメータ > メンバーシップ > デフォルト
      let destination = '/';
      if (redirectTo && redirectTo.startsWith('/')) {
        destination = redirectTo;
      }
      router.replace(destination);
    } catch (e: any) {
      setErrorMessage(getLoginErrorMessage(e));
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
          <div className="mb-4 flex justify-center">
            <img
              src="/GROWTH SHIFT.png"
              alt="GROWTH SHIFT"
              className="h-auto w-[180px] object-contain"
            />
          </div>
          <div className="text-[24px] font-semibold tracking-tight text-zinc-900">サインイン</div>
          <p className="mt-2 text-[13px] text-zinc-500">GROWTH SHIFTにログインしてください</p>
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
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-[12px] font-medium text-zinc-700">パスワード</label>
                <a href="/auth/forgot-password" className="text-[12px] text-zinc-600 hover:text-zinc-900 underline">
                  お忘れですか？
                </a>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="6文字以上"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    // Mac/Windows の日本語IME入力中は送信しない
                    if (e.nativeEvent.isComposing) return;
                    if ((e.nativeEvent as any).keyCode === 229) return;

                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  className="w-full rounded-xl border border-zinc-300 bg-white/90 px-3 py-2 pr-10 text-[14px] outline-none focus:ring-4 focus:ring-zinc-200"
                  autoComplete="current-password"
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
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

          <div className="mt-4 space-y-2">
            <p className="text-center text-[13px] text-zinc-600">
              アカウントをお持ちでない方は、{' '}
              <span className="text-zinc-500">管理者からの招待メールをご確認ください</span>
            </p>
            <p className="text-center text-[13px] text-zinc-600">
              招待メールのリンクが切れた方は{' '}
              <a href="/auth/resend-set-password" className="font-medium text-[color:var(--accent)] hover:opacity-90 underline">
                こちら
              </a>
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-zinc-500">
          Enter で送信・Shift+Enter で改行に対応しています
        </p>

        <div className="mt-6 flex justify-center gap-4 text-[11px] text-zinc-500">
          <a href="/terms" className="hover:text-zinc-700 underline">利用規約</a>
          <span>|</span>
          <a href="/privacy" className="hover:text-zinc-700 underline">プライバシーポリシー</a>
          <span>|</span>
          <a href="/contact" className="hover:text-zinc-700 underline">お問い合わせ</a>
        </div>
      </div>
    </main>
  );
}
