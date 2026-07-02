'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { supabase } from '@/utils/supabase/client';

export default function PasswordChangePage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('すべての項目を入力してください。');
      return;
    }

    if (newPassword.length < 8) {
      setError('新しいパスワードは8文字以上で入力してください。');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('新しいパスワードが一致していません。');
      return;
    }

    if (currentPassword === newPassword) {
      setError('現在とは異なるパスワードを設定してください。');
      return;
    }

    setLoading(true);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user?.email) {
        setError('ログイン状態を確認できません。再ログインしてください。');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userData.user.email,
        password: currentPassword,
      });

      if (signInError) {
        setError('現在のパスワードが正しくありません。');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setError(updateError.message || 'パスワード変更に失敗しました。');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('パスワードを変更しました。次回ログイン時から新しいパスワードを使用してください。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white px-4 py-12">
      <div className="mx-auto max-w-lg">
        {/* Breadcrumb / Context Label */}
        <div className="mb-6">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
            アカウント設定
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h1 className="text-xl font-semibold text-slate-900 mb-2">パスワード変更</h1>
            <p className="text-sm text-slate-600 mb-6">
              セキュリティのため、現在のパスワードで確認してから新しいパスワードを設定します。
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  現在のパスワード
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  autoComplete="current-password"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  新しいパスワード
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  新しいパスワード確認
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {message && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? '変更中...' : 'パスワードを変更する'}
              </button>
            </form>

            <div className="mt-6 border-t border-slate-200 pt-4">
              <Link href="/" className="text-xs text-slate-500 hover:text-slate-700 transition-colors">
                ← 戻る
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
