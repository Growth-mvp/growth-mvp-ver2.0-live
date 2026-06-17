// /app/auth/set-password/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [authenticated, setAuthenticated] = useState(false);

  // 認証確認
  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user?.id) {
        setAuthenticated(true);
      } else {
        setError('ログインが必要です。招待リンクから再度アクセスしてください。');
        setTimeout(() => {
          router.replace('/login');
        }, 2000);
      }
    })();
  }, [router]);

  const validatePassword = (): boolean => {
    if (!password.trim()) {
      setError('パスワードを入力してください。');
      return false;
    }
    if (password.length < 8) {
      setError('パスワードは8文字以上で設定してください。');
      return false;
    }
    if (password !== passwordConfirm) {
      setError('パスワードと確認用パスワードが一致しません。');
      return false;
    }
    return true;
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!validatePassword()) {
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        console.error('[set-password] updateUser error:', updateError);
        setError(`パスワード設定に失敗しました: ${updateError.message}`);
        return;
      }

      setMessage('✅ パスワードを設定しました。ホームへ遷移します。');

      setTimeout(() => {
        router.replace('/');
      }, 1500);
    } catch (err: any) {
      console.error('[set-password] Exception:', err);
      setError('パスワード設定に失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-600">確認中...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-bold text-slate-950">初回パスワード設定</h1>
        <p className="mb-6 text-sm text-slate-600">
          ログイン時に使用するパスワードを設定してください。
        </p>

        <form onSubmit={handleSetPassword} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              ❌ {error}
            </div>
          )}

          {message && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              {message}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700">
              新しいパスワード
            </label>
            <input
              type="password"
              placeholder="8文字以上"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              8文字以上の英数字記号を含むパスワードをお勧めします。
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700">
              パスワード確認
            </label>
            <input
              type="password"
              placeholder="もう一度入力"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              disabled={loading}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '設定中...' : 'パスワードを設定'}
          </button>
        </form>
      </div>
    </main>
  );
}
