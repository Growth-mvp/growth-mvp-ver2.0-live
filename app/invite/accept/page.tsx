// /app/invite/accept/page.tsx
'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';

export default function InviteAcceptPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setCompanyId } = useUserStore();

  // token は searchParams の安定化タイミングがあるので memo で正規化して扱う
  const token = useMemo(() => {
    const t = searchParams?.get('token') ?? '';
    const v = t.trim();
    return v.length > 0 ? v : null;
  }, [searchParams]);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isEmailMismatch, setIsEmailMismatch] = useState(false);

  /**
   * ✅ StrictMode 対策（安全版）
   * - token が確定してから処理する
   * - token 単位で「1回だけ」実行する
   * - inFlight で多重 POST を防止
   */
  const lastProcessedTokenRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      console.log('[invite/accept] Initialize: checking auth and session');

      // token がまだ取れてない間は何もしない（←ここ重要：ref を立てない）
      if (!token) {
        console.log('[invite/accept] token not ready yet');
        setCheckingAuth(false);
        setError('招待トークンがありません。招待リンクをご確認ください。');
        return;
      }

      // 既にこの token を処理済みならスキップ（StrictMode / 戻る進む等）
      if (lastProcessedTokenRef.current === token) {
        console.log('[invite/accept] already processed token, skip');
        setCheckingAuth(false);
        return;
      }

      // API 呼び出し中の二重実行防止
      if (inFlightRef.current) {
        console.log('[invite/accept] inFlight, skip');
        return;
      }

      // セッションを確認
      const { data: sessRes, error: sessErr } = await supabase.auth.getSession();
      if (cancelled) return;

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
            : `/invite/accept?token=${encodeURIComponent(token)}`
        );
        router.replace(`/login?redirectTo=${redirectUrl}`);
        return;
      }

      // ここから「この token は処理対象」としてマーク
      lastProcessedTokenRef.current = token;
      inFlightRef.current = true;

      console.log('[invite/accept] Logged in. Attempting to accept invite.');

      setCheckingAuth(false);
      setLoading(true);

      try {
        const res = await fetch('/api/invites/accept', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ token }),
        });

        const data = await res.json().catch(() => ({} as any));
        console.log('[invite/accept] API response:', {
          status: res.status,
          ok: res.ok,
          error: (data as any)?.error,
        });

        if (!res.ok) {
          let errorMessage = 'エラーが発生しました';
          let mismatch = false;

          if (data?.error === 'email_mismatch') {
            errorMessage = data?.detail || 'メールアドレスが一致しません';
            mismatch = true;
          } else if (data?.error === 'invite_expired') {
            errorMessage = '招待の有効期限が切れています';
          } else if (data?.error === 'invite_already_used') {
            errorMessage = 'この招待は既に使用されています';
          } else if (data?.error === 'invite_not_found') {
            errorMessage = '招待が見つかりません（無効または削除されている可能性があります）';
          } else {
            errorMessage = data?.detail || errorMessage;
          }

          console.error('[invite/accept] Error:', data?.error, errorMessage);
          setError(errorMessage);
          setIsEmailMismatch(mismatch);
          setLoading(false);

          // エラー時は inFlight 解除（リロード等で再試行可能にする）
          inFlightRef.current = false;
          // ただし token は processed 扱いなので、再試行したいなら lastProcessed を外す
          // → UX上「もう一度試す」ボタンを付けるならそこで外す。現状はページ再訪でOK。
          return;
        }

        // 成功
        const companyId = data?.companyId as string | undefined;
        if (companyId) setCompanyId(companyId);

        setMsg('招待を受け入れました。ホーム画面に遷移します。');

        setTimeout(() => {
          router.replace('/');
        }, 1200);
      } catch (e: any) {
        console.error('[invite/accept] fetch error:', e);
        setError('招待の受け入れに失敗しました。もう一度お試しください。');
        setLoading(false);

        // 例外時も再試行できるよう解除
        inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router, setCompanyId]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut({ scope: 'global' });
      router.replace('/login');
    } catch (e) {
      console.error('Logout failed:', e);
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
        <div className="mt-6 text-sm text-gray-600">招待リンクから登録します。しばらくお待ちください。</div>
      )}
    </main>
  );
}
