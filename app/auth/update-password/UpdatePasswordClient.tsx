'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/utils/supabase/client';

export default function UpdatePasswordClient() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [sessionError, setSessionError] = useState('');

  // メールリンク経由のセッションがあるかチェック
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data?.session) {
          // リセットリンクの有効期限が切れている可能性
          setSessionError(
            'パスワードリセットリンクが無効です。もう一度メールをご確認いただくか、パスワード再設定フォームからやり直してください。'
          );
        }
      } catch (err) {
        console.error('[update-password] Session check error:', err);
      }
    };

    checkSession();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // バリデーション
    if (!password.trim() || !confirmPassword.trim()) {
      setError('パスワードを入力してください');
      return;
    }

    if (password.length < 8) {
      setError('パスワードは8文字以上である必要があります');
      return;
    }

    if (password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }

    setLoading(true);

    try {
      // Supabase auth.updateUser で新しいパスワードを設定
      const { error: updateErr } = await supabase.auth.updateUser({
        password,
      });

      if (updateErr) {
        console.error('[update-password] updateUser error:', updateErr);

        // セッションの有効期限切れの場合
        if (updateErr.message?.toLowerCase().includes('session') ||
            updateErr.message?.toLowerCase().includes('expired') ||
            updateErr.status === 401) {
          setError(
            'パスワードリセットリンクが無効です。もう一度「パスワードをお忘れですか？」から再設定してください。'
          );
        } else {
          setError('パスワードの更新に失敗しました。もう一度お試しください。');
        }
        return;
      }

      // 成功
      setSubmitted(true);
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('[update-password] Exception:', err);
      setError('予期しないエラーが発生しました。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  if (sessionError) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
        <div className="mx-auto w-full max-w-md">
          <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center">
              <p className="text-[13px] text-rose-700">
                {sessionError}
              </p>
            </div>

            <div className="text-center space-y-2">
              <Link
                href="/auth/forgot-password"
                className="block text-sm font-medium text-[color:var(--accent)] hover:opacity-90 underline"
              >
                パスワード再設定フォームへ
              </Link>
              <Link
                href="/login"
                className="block text-sm font-medium text-[color:var(--accent)] hover:opacity-90 underline"
              >
                サインイン画面に戻る
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
        <div className="mx-auto w-full max-w-md">
          <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
              <p className="text-sm font-medium text-emerald-800">
                パスワードを再設定しました。
              </p>
              <p className="mt-1 text-[13px] text-emerald-700">
                新しいパスワードでログインしてください。
              </p>
            </div>

            <div className="text-center">
              <Link
                href="/login"
                className="text-sm font-medium text-[color:var(--accent)] hover:opacity-90 underline"
              >
                サインイン画面へ
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-[28px] font-semibold tracking-tight text-zinc-900">パスワード再設定</div>
          <p className="mt-1 text-[13px] text-zinc-500">
            新しいパスワードを入力してください
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {error && (
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-2 block text-[12px] font-medium text-zinc-700">
                新しいパスワード
              </label>
              <input
                type="password"
                placeholder="8文字以上"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="w-full rounded-xl border border-zinc-300 bg-white/90 px-3 py-2 text-[14px] outline-none focus:ring-4 focus:ring-zinc-200 disabled:opacity-50"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-[12px] font-medium text-zinc-700">
                パスワード（確認）
              </label>
              <input
                type="password"
                placeholder="もう一度入力してください"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                className="w-full rounded-xl border border-zinc-300 bg-white/90 px-3 py-2 text-[14px] outline-none focus:ring-4 focus:ring-zinc-200 disabled:opacity-50"
                autoComplete="new-password"
                minLength={8}
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
            >
              {loading ? '更新中…' : 'パスワードを再設定'}
            </button>
          </form>

          <p className="mt-4 text-center text-[13px] text-zinc-600">
            <Link href="/login" className="font-medium text-[color:var(--accent)] hover:opacity-90 underline">
              サインイン画面に戻る
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
