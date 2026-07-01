// /app/auth/resend-set-password/page.tsx
'use client';

import { useState } from 'react';
import { supabase } from '@/utils/supabase/client';
import Link from 'next/link';

export default function ResendSetPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!email.trim()) {
      setError('メールアドレスを入力してください。');
      return;
    }

    setLoading(true);

    try {
      const redirectTo = typeof window !== 'undefined' ? window.location.origin : '';

      // Supabase の recovery リンク（パスワードリセット）を使用
      const result = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${redirectTo}/auth/set-password`,
      });

      console.log('[resend-set-password] resetPasswordForEmail result:', result);

      const resetError = result?.error;

      if (resetError) {
        console.error('[resend-set-password] resetPasswordForEmail error:', resetError);
        const errorMessage = typeof resetError === 'object'
          ? (resetError as any).message || JSON.stringify(resetError)
          : String(resetError);
        setError(`リンク送信に失敗しました: ${errorMessage}`);
        return;
      }

      setMessage(`✅ パスワード設定リンクを ${email} に送信しました。メールをご確認ください。`);
      setEmail('');
    } catch (err: any) {
      console.error('[resend-set-password] Exception:', err);
      setError('リンク送信に失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-slate-50/60 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-[28px] font-semibold tracking-tight text-zinc-900">
            パスワード設定リンク再発行
          </div>
          <p className="mt-1 text-[13px] text-zinc-500">
            招待済みでパスワントがまだの方はこちら
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur-md p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {error && (
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700" role="alert">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-[13px] text-green-700">
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-zinc-700">
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
              <p className="mt-1 text-[12px] text-zinc-500">
                招待されたメールアドレスを入力してください
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
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
            既にパスワード設定済みですか？{' '}
            <Link href="/login" className="font-medium text-[color:var(--accent)] hover:opacity-90 underline">
              サインインはこちら
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
