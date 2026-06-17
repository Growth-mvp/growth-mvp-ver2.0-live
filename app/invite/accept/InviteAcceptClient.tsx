// /app/invite/accept/InviteAcceptClient.tsx
'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';

export default function InviteAcceptClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setCompanyId, resetMembershipLoading } = useUserStore();

  // ★ token は searchParams から取得、なければ localStorage から復元
  const token = useMemo(() => {
    const t = searchParams?.get('token') ?? '';
    const v = t.trim();
    if (v.length > 0) return v;

    // localStorage から復元（ログイン後に戻ってきた場合）
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('pendingInviteToken');
        if (saved) {
          console.log('[invite/accept] Restored token from localStorage:', saved.slice(0, 8));
          return saved;
        }
      } catch (e) {
        console.warn('[invite/accept] could not read from localStorage:', e);
      }
    }

    return null;
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

      // ★ session と access_token をリトライで取得（callback 完了まで待つ）
      let session = null;
      let retryCount = 0;
      const maxRetries = 3;
      const retryDelays = [200, 300, 500]; // ms

      while (retryCount < maxRetries) {
        const { data: sessRes, error: sessErr } = await supabase.auth.getSession();
        if (cancelled) return;

        if (sessErr) {
          console.warn('[invite/accept] getSession error (retry):', {
            attempt: retryCount + 1,
            error: sessErr.message,
          });
        } else {
          session = sessRes?.session;
        }

        // ✅ access_token があれば成功
        if (session?.access_token && session?.user?.id) {
          console.log('[invite/accept] Got access_token:', {
            userId: session.user.id,
            hasToken: !!session.access_token,
            attempt: retryCount + 1,
          });
          break;
        }

        retryCount++;
        if (retryCount < maxRetries) {
          const delay = retryDelays[retryCount - 1] || 500;
          console.log('[invite/accept] Waiting for callback completion, retry in', delay, 'ms');
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      // 最後の試行後も access_token がない場合
      if (!session?.access_token) {
        console.error('[invite/accept] No access_token after retries:', {
          userId: session?.user?.id || '(not logged in)',
          tokenHead: (token ?? '').slice(0, 8),
          maxRetries,
        });

        // token をlocalStorage に一時保存（ログイン後に拾える）
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('pendingInviteToken', token);
          } catch (e) {
            console.warn('[invite/accept] could not save token to localStorage:', e);
          }
        }

        setError(
          '認証情報が確立されていません。もう一度ログインして、招待リンクを開き直してください。'
        );
        setCheckingAuth(false);

        // ログイン画面へ（token は localStorage に保存済み）
        const redirectUrl = encodeURIComponent(`/invite/accept?token=${encodeURIComponent(token)}`);
        setTimeout(() => {
          router.replace(`/login?next=${redirectUrl}`);
        }, 2000);
        return;
      }

      // ★ ここから「この token は処理対象」としてマーク
      lastProcessedTokenRef.current = token;
      inFlightRef.current = true;

      console.log('[invite/accept] Ready to accept invite with valid session.');

      setCheckingAuth(false);
      setLoading(true);

      const tokenHead = (token ?? '').slice(0, 8);
      const currentUserId = session?.user?.id;

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
          tokenHead: `${tokenHead}...`,
          userId: currentUserId,
        });

        if (!res.ok) {
          let errorMessage = 'エラーが発生しました';
          let mismatch = false;
          const errorCode = data?.error || 'unknown_error';
          const errorDetail = data?.detail || '';

          if (data?.error === 'email_mismatch') {
            errorMessage = data?.detail || 'メールアドレスが一致しません';
            mismatch = true;
          } else if (data?.error === 'invite_expired') {
            errorMessage = '招待の有効期限が切れています';
          } else if (data?.error === 'invite_already_used') {
            errorMessage = 'この招待は既に使用されています';
          } else if (data?.error === 'invite_not_found') {
            errorMessage = '招待が見つかりません（無効または削除されている可能性があります）';
          } else if (data?.error === 'unauthorized') {
            errorMessage = data?.message || 'ログインが必要です';
          } else if (data?.error === 'token_required') {
            errorMessage = '招待トークンが不正です';
          } else {
            errorMessage = data?.message || data?.detail || errorMessage;
          }

          // ★ 詳細ログ：status/message/detail/userId/tokenHead
          console.error('[invite/accept] HTTP Error:', {
            status: res.status,
            error: errorCode,
            message: data?.message || '(no message)',
            detail: errorDetail,
            tokenHead: `${tokenHead}...`,
            userId: currentUserId,
          });

          setError(errorMessage);
          setIsEmailMismatch(mismatch);
          setLoading(false);

          // ★ 401 の場合はログイン画面へ（token 保持）
          if (res.status === 401) {
            console.warn('[invite/accept] Got 401, redirecting to login with token preserved');

            // token を localStorage に保存
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem('pendingInviteToken', token);
              } catch (e) {
                console.warn('[invite/accept] could not save token to localStorage:', e);
              }
            }

            // 2秒後に /login へ遷移（UI に error メッセージを見せる）
            setTimeout(() => {
              const redirectUrl = encodeURIComponent(`/invite/accept?token=${encodeURIComponent(token)}`);
              router.replace(`/login?next=${redirectUrl}`);
            }, 2000);
          }

          // エラー時は inFlight 解除（リロード等で再試行可能にする）
          lastProcessedTokenRef.current = null;
          inFlightRef.current = false;
          return;
        }

        // 成功
        const companyId = data?.companyId as string | undefined;

        console.log('[invite/accept] Success:', {
          companyId,
          tokenHead: `${tokenHead}...`,
          userId: currentUserId,
          role: data?.role,
        });

        // ★ 成功時に localStorage をクリア
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem('pendingInviteToken');
          } catch (e) {
            console.warn('[invite/accept] could not clear localStorage:', e);
          }
        }

        if (companyId) setCompanyId(companyId);
        resetMembershipLoading();

        setMsg('招待を受け入れました。パスワード設定画面に遷移します。');

        setTimeout(() => {
          router.replace('/auth/set-password');
        }, 1200);
      } catch (e: any) {
        console.error('[invite/accept] Exception:', {
          error: e?.message || String(e),
          code: e?.code || 'unknown',
          tokenHead: `${tokenHead}...`,
          userId: currentUserId,
          stack: e?.stack,
        });

        // ★ 例外時は token を保存（リトライ用）
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('pendingInviteToken', token);
          } catch (storageErr) {
            console.warn('[invite/accept] could not save token on exception:', storageErr);
          }
        }

        setError('招待の受け入れに失敗しました。もう一度お試しください。');
        setLoading(false);

        // 例外時も再試行できるよう解除
        lastProcessedTokenRef.current = null;
        inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router, setCompanyId, resetMembershipLoading]);

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
