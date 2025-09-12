// /app/signup/SignUpClient.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useUserStore } from '@/store/userStore';

/** 起動中のポートを自動で拾いつつ SSR でも安全にコールバックURL生成 */
function makeCallbackUrl(path = '/auth/callback') {
  if (typeof window !== 'undefined') {
    return new URL(path, window.location.origin).toString();
  }
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'http://localhost:3000';
  return `${base}${path}`;
}

export default function SignUpClient() {
  const router = useRouter();
  const search = useSearchParams();
  const { setUser, setCompanyId } = useUserStore();

  // 招待リンク (?company=...) の取得（必須）
  const joinCompanyId: string | null = search?.get('company') ?? null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [error, setError] = useState<string>('');

  /** セッションが存在する＝メールリンク等でログイン完了後の自動参加処理 */
  useEffect(() => {
    (async () => {
      if (!joinCompanyId) return;

      const { data: userRes } = await supabase.auth.getUser();
      const authed = userRes?.user;
      if (!authed) return;

      const { error } = await supabase
        .from('company_members')
        .upsert(
          [
            {
              company_id: joinCompanyId,
              user_id: authed.id,
              role: 'member',
              department_id: null,
            },
          ],
          { onConflict: 'company_id,user_id' }
        );

      if (error) {
        console.error('company_members upsert error:', error);
        setError('会社への参加処理に失敗しました');
      } else {
        setCompanyId(joinCompanyId ?? undefined);
        router.replace('/'); // トップへ
      }
    })();
  }, [joinCompanyId, router, setCompanyId]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setMsg('');
    setError('');

    if (!joinCompanyId) {
      setError('⚠️ 招待リンク（?company=...）が必要です。管理者にご依頼ください。');
      return;
    }
    if (!email.trim() || !password.trim()) {
      setError('必要項目を入力してください');
      return;
    }

    setLoading(true);
    try {
      const emailRedirectTo = makeCallbackUrl('/auth/callback');

      // 新規アカウント作成（メール確認が前提）
      const { data, error: signErr } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: password.trim(),
        options: { emailRedirectTo },
      });

      if (signErr) {
        // 既登録（422）→ 確認メール再送
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

      // 通常は「確認メールを送信」状態（セッションなし）
      if (data?.user && !data.session) {
        setMsg('確認メールを送信しました。メール内リンクから登録を完了してください。');
        return;
      }

      // 稀にその場でセッションが付与されるケース
      if (data?.session && data.user) {
        setUser({
          id: data.user.id,
          email: data.user.email ?? '',
          role: 'member',
          name: '',
          departmentId: undefined,
        });

        const { error: upErr } = await supabase
          .from('company_members')
          .upsert(
            [
              {
                company_id: joinCompanyId,
                user_id: data.user.id,
                role: 'member',
                department_id: null,
              },
            ],
            { onConflict: 'company_id,user_id' }
          );
        if (!upErr) setCompanyId(joinCompanyId ?? undefined);

        router.replace('/');
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
      <h1 className="mb-4 text-xl font-bold">新規登録（招待専用）</h1>

      {!joinCompanyId && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 text-sm">
          ⚠️ このページは招待リンク専用です。管理者からの招待URL（?company=...）でアクセスしてください。
        </div>
      )}

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
          disabled={loading || !joinCompanyId}
          className={`w-full rounded px-4 py-2 font-semibold ${
            loading || !joinCompanyId
              ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
              : 'bg-black text-white hover:opacity-90'
          }`}
        >
          {loading ? '送信中…' : '登録'}
        </button>

        <div className="mt-3 text-sm text-gray-600">
          すでに招待メールを受け取っている方は、メール内のリンクから続行してください。
          もし「すでに登録済み」エラーが出た場合は、この画面で確認メールの再送手続きを行います。
        </div>
      </form>
    </main>
  );
}
