// /app/auth/set-password/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';

export default function SetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
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
        setEmail(sessionData.session.user.email || '');
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

      console.log('[set-password] Password set successfully, linking company membership');

      // パスワード設定後、company_members を紐づける
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      const userEmail = sessionData?.session?.user?.email || email;

      if (userId && userEmail && sessionData?.session?.access_token) {
        try {
          const linkRes = await fetch('/api/auth/link-invited-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${sessionData.session.access_token}`,
            },
            body: JSON.stringify({ email: userEmail }),
          });

          if (!linkRes.ok) {
            console.warn('[set-password] Failed to link company membership:', await linkRes.json());
            // リンク失敗でもパスワード設定は成功したので続行
          } else {
            console.log('[set-password] Company membership linked successfully');
          }
        } catch (linkErr) {
          console.error('[set-password] Error linking membership:', linkErr);
          // リンク失敗でもパスワード設定は成功したので続行
        }
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
          招待されたメールアドレスでアカウントを有効化します。ログイン時に使用するパスワードを設定してください。
        </p>

        <form onSubmit={handleSetPassword} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700">
              メールアドレス
            </label>
            <div className="mt-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {email || 'メールアドレスを確認中...'}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              招待されたメールアドレスです
            </p>
          </div>
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
            {loading ? '設定中...' : 'パスワードを設定して開始'}
          </button>
        </form>
      </div>
    </main>
  );
}
