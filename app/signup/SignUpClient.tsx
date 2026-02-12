// /app/signup/SignUpClient.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';

function makeCallbackUrl(path = '/auth/callback') {
  if (typeof window !== 'undefined') {
    return new URL(path, window.location.origin).toString();
  }
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'http://localhost:3000';
  return `${base}${path}`;
}

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

function logPostgrestError(label: string, error: any) {
  console.error(label, error);
  console.error(label + ' (fields)', {
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    code: error?.code,
    status: error?.status,
  });
  try {
    console.error(label + ' (json)', JSON.stringify(error));
  } catch {}
}

export default function SignUpClient() {
  const router = useRouter();
  const search = useSearchParams();
  const { setUser } = useUserStore();

  const rawCompany = search?.get('company') ?? null;

  // 警告：?company パラメータは非推奨（アプリ招待トークン方式に移行）
  useEffect(() => {
    if (rawCompany) {
      console.warn(
        '[signup] Deprecated: ?company parameter detected. ' +
          'Use /invite/accept?token=... instead for app-based invitations.'
      );
    }
  }, [rawCompany]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [error, setError] = useState<string>('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setMsg('');
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('メールアドレスとパスワードを入力してください');
      return;
    }

    setLoading(true);
    try {
      const emailRedirectTo = makeCallbackUrl('/auth/callback');

      const { data, error: signErr } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: password.trim(),
        options: { emailRedirectTo },
      });

      if (signErr) {
        const status = (signErr as any).status;
        const message = (signErr as any).message || '';
        if (status === 422 || /already registered/i.test(message)) {
          const { error: resendErr } = await supabase.auth.resend({
            type: 'signup',
            email: email.trim().toLowerCase(),
            options: { emailRedirectTo },
          });
          if (resendErr) {
            setError('このメールは既に登録されています。ログインまたはパスワード再設定をお試しください。');
          } else {
            setMsg('このメールは既に登録済みです。確認メールを再送しました。メール内リンクから続行してください。');
          }
          return;
        }
        setError(`サインアップに失敗: ${signErr.message}`);
        return;
      }

      // 確認メールが必要な場合
      if (data?.user && !data.session) {
        setMsg('確認メールを送信しました。メール内リンクから登録を完了してください。');
        return;
      }

      // セッションが即座に付与された場合（開発環境など）
      if (data?.session && data.user) {
        setUser({
          id: data.user.id,
          email: data.user.email ?? '',
          role: 'member',
          name: '',
          departmentId: undefined,
        });

        // 招待経由でない通常のサインアップは /auth/welcome へ
        // 招待経由の場合は /invite/accept?token=... で処理される
        router.replace('/auth/welcome');
        return;
      }

      setMsg('サインアップ要求を受け付けました。メールをご確認ください。');
    } catch (err: any) {
      setError(err?.message || '新規登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-xl font-bold">新規登録</h1>

      <form onSubmit={onSubmit} className="space-y-3" autoComplete="on">
        <div>
          <label className="block text-sm text-gray-600">メールアドレス</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600">パスワード</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="6文字以上"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-green-700">{msg}</p>}

        <button
          type="submit"
          disabled={loading}
          className={`w-full rounded px-4 py-2 font-semibold ${
            loading
              ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
              : 'bg-black text-white hover:opacity-90'
          }`}
        >
          {loading ? '送信中…' : '登録'}
        </button>

        <div className="mt-3 text-sm text-gray-600">
          <p className="mb-2">招待リンクから登録する場合は、招待メール内のリンクをクリックしてください。</p>
          <p>すでにアカウントをお持ちの場合は <a href="/login" className="text-blue-600 underline">ログイン</a> してください。</p>
        </div>
      </form>
    </main>
  );
}
