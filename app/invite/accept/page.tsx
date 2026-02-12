// /app/invite/accept/page.tsx
'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';

export default function InviteAcceptPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setCompanyId } = useUserStore();

  const token = searchParams?.get('token') ?? null;

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isEmailMismatch, setIsEmailMismatch] = useState(false);

  // React StrictMode による二重実行を防止
  const initDoneRef = useRef(false);

  useEffect(() => {
    // 既に実行済みなら何もしない
    if (initDoneRef.current) return;
    initDoneRef.current = true;

    (async () => {
      console.log('[invite/accept] Initialize: checking auth and session');

      // トークンが無ければエラー
      if (!token) {
        console.warn('[invite/accept] No token provided');
        setError('招待トークンがありません。招待リンクをご確認ください。');
        setCheckingAuth(false);
        return;
      }

      // セッションを確認
      const { data: sessRes, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) {
        console.error('[invite/accept] getSession error:', sessErr);
        setError('セッションの確認に失敗しました。');
        setCheckingAuth(false);
        return;
      }

      const session = sessRes?.session;

      // 未ログインの場合 → ログイン画面へ（redirectTo を保持）
      if (!session?.access_token || !session?.user?.id) {
        console.log('[invite/accept] Not logged in. Redirecting to login.');
        const redirectUrl = encodeURIComponent(
          typeof window !== 'undefined'
            ? `${window.location.origin}/invite/accept?token=${encodeURIComponent(token)}`
            : ''
        );
        router.replace(`/login?redirectTo=${redirectUrl}`);
        return;
      }

      console.log('[invite/accept] Logged in. Attempting to accept invite.');

      // ログイン済み → accept を試行
      setCheckingAuth(false);
      await acceptInvite(session.access_token, token);
    })();
  }, [token, router]);

  const acceptInvite = async (accessToken: string, inviteToken: string) => {
    console.log('[invite/accept] acceptInvite called with token:', inviteToken?.substring(0, 10) + '...');
    setLoading(true);
    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ token: inviteToken }),
      });

      const data = await res.json();
      console.log('[invite/accept] API response:', { status: res.status, ok: res.ok, error: data.error });

      if (!res.ok) {
        let errorMessage = 'エラーが発生しました';
        let isEmailMismatchError = false;

        if (data.error === 'email_mismatch') {
          errorMessage = data.detail || 'メールアドレスが一致しません';
          isEmailMismatchError = true;
        } else if (data.error === 'invite_expired') {
          errorMessage = '招待の有効期限が切れています';
        } else if (data.error === 'invite_already_used') {
          errorMessage = 'この招待は既に使用されています';
        } else if (data.error === 'invite_not_found') {
          errorMessage = '招待が見つかりません（無効または削除されている可能性があります）';
        } else {
          errorMessage = data.detail || errorMessage;
        }

        console.error('[invite/accept] Error:', data.error, errorMessage);
        setError(errorMessage);
        setIsEmailMismatch(isEmailMismatchError);
        setLoading(false);
        return;
      }

      // 成功
      console.log('[invite/accept] Success! Invite accepted.');
      const { companyId, role } = data;
      setCompanyId(companyId);
      setMsg('招待を受け入れました。ホーム画面に遷移します。');

      // 少し待ってからリダイレクト
      setTimeout(() => {
        router.replace('/');
      }, 1500);
    } catch (e: any) {
      console.error('[invite/accept] fetch error:', e);
      setError('招待の受け入れに失敗しました。もう一度お試しください。');
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-600">認証を確認中...</p>
        </div>
      </main>
    );
  }

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut({ scope: 'global' });
      router.replace('/login');
    } catch (e) {
      console.error('Logout failed:', e);
    }
  };

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-xl font-bold">招待を受け入れる</h1>

      {!token && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm">
          ⚠️ 招待トークンがありません。招待リンクをご確認ください。
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm space-y-3">
          <p>❌ {error}</p>

          {isEmailMismatch && (
            <div className="border-t border-red-200 pt-3 space-y-2">
              <p className="font-semibold text-red-900">対応方法：</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>以下のボタンでログアウト</li>
                <li>招待されたメールアドレスでログイン</li>
                <li>招待リンクを再度開く</li>
              </ol>
              <button
                onClick={handleLogout}
                className="mt-3 w-full rounded bg-red-600 px-3 py-2 text-white text-sm hover:bg-red-700"
              >
                ログアウト
              </button>
            </div>
          )}
        </div>
      )}

      {msg && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-green-800 text-sm">
          ✅ {msg}
        </div>
      )}

      {loading && (
        <div className="mt-4 text-center">
          <p className="text-sm text-gray-600">処理中...</p>
        </div>
      )}

      {!loading && !error && !msg && (
        <div className="mt-6 text-sm text-gray-600">
          招待リンクから登録します。しばらくお待ちください。
        </div>
      )}
    </main>
  );
}
