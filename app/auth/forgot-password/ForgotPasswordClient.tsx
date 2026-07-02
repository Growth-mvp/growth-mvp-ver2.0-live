'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/utils/supabase/client';

export default function ForgotPasswordClient() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('メールアドレスを入力してください');
      return;
    }

    setLoading(true);

    try {
      const result = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/update-password`,
      });

      if (result.error) {
        console.error('[forgot-password] resetPasswordForEmail error:', result.error);
        // セキュリティ上、登録済みメールかどうかを断定しない
        setSubmitted(true);
        return;
      }

      setSubmitted(true);
      setEmail('');
    } catch (err: any) {
      console.error('[forgot-password] Exception:', err);
      // セキュリティ上、登録済みメールかどうかを断定しない
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
        <div className="mx-auto w-full max-w-md">
          <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
              <p className="text-sm font-medium text-emerald-800">
                パスワード再設定用のメールを送信しました。
              </p>
              <p className="mt-1 text-[13px] text-emerald-700">
                メールをご確認ください。
              </p>
            </div>

            <p className="text-center text-[13px] text-zinc-600 mb-4">
              メールが届かない場合は、以下をご確認ください：
            </p>
            <ul className="text-[13px] text-zinc-600 space-y-2 mb-6 list-disc list-inside">
              <li>登録したメールアドレスが正しいかご確認ください</li>
              <li>迷惑メール フォルダをご確認ください</li>
              <li>メール受信まで数分かかる場合があります</li>
            </ul>

            <div className="text-center">
              <Link
                href="/login"
                className="text-sm font-medium text-[color:var(--accent)] hover:opacity-90 underline"
              >
                サインイン画面に戻る
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
            登録されたメールアドレスを入力してください
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
                メールアドレス
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="w-full rounded-xl border border-zinc-300 bg-white/90 px-3 py-2 text-[14px] outline-none focus:ring-4 focus:ring-zinc-200 disabled:opacity-50"
                autoComplete="email"
                inputMode="email"
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
              {loading ? '送信中…' : 'リンクを送信'}
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
