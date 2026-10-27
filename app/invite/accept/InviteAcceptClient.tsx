// /app/invite/accept/InviteAcceptClient.tsx
'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';

type InviteInfo = {
  email: string;
  companyId: string;
  companyName: string;
  role: string;
  expiresAt: string;
};

function inviteErrorMessage(data: any): string {
  switch (data?.error) {
    case 'invite_expired':
      return '招待の有効期限が切れています';
    case 'invite_already_used':
      return 'この招待は既に使用されています';
    case 'invite_not_found':
      return '招待が見つかりません（無効または削除されている可能性があります）';
    case 'email_mismatch':
      return 'ログイン中のメールアドレスが招待メールと一致しません';
    case 'email_not_confirmed':
      return 'メールアドレスの確認が完了していません。確認メールから手続きしてください';
    case 'unauthorized':
      return 'ログインの有効期限が切れています。再度ログインしてください';
    default:
      return data?.message || 'エラーが発生しました';
  }
}

export default function InviteAcceptClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // token は URL（招待リンク、またはログイン後の redirect_to）からのみ取得する
  const token = useMemo(() => {
    const v = (searchParams?.get('token') ?? '').trim();
    return v.length > 0 ? v : null;
  }, [searchParams]);

  const [msg, setMsg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isEmailMismatch, setIsEmailMismatch] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [loadTimeoutWarning, setLoadTimeoutWarning] = useState(false);

  const loadInviteInfoRef = useRef<string | null>(null);

  /** ログイン済みユーザーとして招待を受諾（Bearer 必須） */
  async function acceptWithSession(accessToken: string) {
    if (!token) return;

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/invites/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data?.error === 'email_mismatch') setIsEmailMismatch(true);
        setError(inviteErrorMessage(data));
        return;
      }

      setMsg('所属の登録が完了しました。まもなくホームへ移動します。');
      setTimeout(() => {
        router.replace('/');
      }, 2000);
    } catch (e: any) {
      console.error('[invite/accept] accept request failed:', e?.message || String(e));
      setError('所属の登録に失敗しました。もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let warnTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      if (!token) {
        setCheckingAuth(false);
        setError('招待トークンがありません。招待リンクをご確認ください。');
        return;
      }

      if (loadInviteInfoRef.current === token) {
        setCheckingAuth(false);
        return;
      }

      warnTimer = setTimeout(() => {
        if (!cancelled) setLoadTimeoutWarning(true);
      }, 10000);

      try {
        const res = await fetch(`/api/invites/info?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (cancelled) return;
        if (warnTimer) clearTimeout(warnTimer);

        let info: InviteInfo | null = null;
        if (res.ok) {
          info = {
            email: data.email,
            companyId: data.companyId,
            companyName: data.companyName,
            role: data.role,
            expiresAt: data.expiresAt,
          };
          loadInviteInfoRef.current = token;
          setInviteInfo(info);
        } else if (data?.error !== 'invite_already_used') {
          // 使用済みでもログイン済みの本人なら受諾（再実行）で結果が返るため、ここでは止めない
          setError(inviteErrorMessage(data));
          setCheckingAuth(false);
          return;
        }

        const { data: sessRes } = await supabase.auth.getSession();
        const session = sessRes?.session;

        if (!session?.access_token) {
          if (!info) setError('この招待は既に使用されています');
          setCheckingAuth(false);
          return;
        }

        const sessionEmail = session.user?.email ?? '';
        setCurrentUserEmail(sessionEmail);

        if (info && sessionEmail.toLowerCase() !== info.email.toLowerCase()) {
          setIsEmailMismatch(true);
          setCheckingAuth(false);
          return;
        }

        setCheckingAuth(false);
        await acceptWithSession(session.access_token);
      } catch (e: any) {
        if (cancelled) return;
        if (warnTimer) clearTimeout(warnTimer);
        console.error('[invite/accept] failed to load invite:', e?.message || String(e));
        setError('招待情報の読み込みに失敗しました。もう一度お試しください。');
        setCheckingAuth(false);
      }
    })();

    return () => {
      cancelled = true;
      if (warnTimer) clearTimeout(warnTimer);
    };
    // token の変化だけで再実行する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut({ scope: 'global' });
      router.replace('/login');
    } catch (e) {
      console.error('Logout failed:', e);
    }
  };

  /** 未ログインの人は、招待 URL を戻り先にしてログイン画面へ。ログイン後に同じ招待で受諾を再開する */
  const goToLogin = () => {
    if (!token) return;
    const returnTo = `/invite/accept?token=${encodeURIComponent(token)}`;
    router.push(`/login?redirect_to=${encodeURIComponent(returnTo)}`);
  };

  const handlePasswordSubmit = async () => {
    if (!inviteInfo || !token) return;

    if (!password.trim()) {
      setError('パスワードを入力してください');
      return;
    }
    if (password.length < 8) {
      setError('パスワードは8文字以上である必要があります');
      return;
    }
    if (password !== passwordConfirm) {
      setError('パスワードが一致しません');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/invites/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, email: inviteInfo.email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(inviteErrorMessage(data));
        return;
      }

      // 既存・新規のどちらでも同じ応答。ログインして招待を確定してもらう
      setPassword('');
      setPasswordConfirm('');
      setMsg('招待を受け付けました。ログインして招待を確定してください。');
    } catch (e: any) {
      console.error('[invite/accept] password submit failed:', e?.message || String(e));
      setError('パスワード設定に失敗しました。もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingAuth) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="flex flex-col items-center justify-center py-12">
          <h1 className="mb-4 text-xl font-bold text-gray-800">招待内容を確認しています...</h1>

          <div className="mb-6 flex justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900"></div>
          </div>

          <p className="text-sm text-gray-600 text-center">
            数秒かかる場合があります。この画面を閉じずにお待ちください。
          </p>

          {loadTimeoutWarning && (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-semibold">時間がかかっています</p>
              <p className="mt-1 text-xs">再読み込みせず、しばらくお待ちください。</p>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-6 text-2xl font-bold">招待を受け入れる</h1>

      {!token && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm">
          ⚠️ 招待トークンがありません。招待リンクをご確認ください。
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm space-y-3">
          <p className="whitespace-pre-wrap">❌ {error}</p>

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
        <div className="mb-4 space-y-3 rounded-lg border border-green-200 bg-green-50 p-3 text-green-800 text-sm">
          <p>✅ {msg}</p>
          {!currentUserEmail && (
            <button
              onClick={goToLogin}
              className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black/90"
            >
              ログインへ進む
            </button>
          )}
        </div>
      )}

      {/* 未ログイン時：招待内容とパスワード設定（新規の方）／ログイン（既存の方） */}
      {inviteInfo && !currentUserEmail && !msg && !submitting && !error && (
        <div className="mb-6 space-y-4">
          <div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
            <p className="text-sm text-gray-600">
              <span className="font-semibold">メールアドレス：</span> {inviteInfo.email}
            </p>
            <p className="text-sm text-gray-600 mt-2">
              <span className="font-semibold">会社：</span> {inviteInfo.companyName}
            </p>
            <p className="text-sm text-gray-600 mt-2">
              <span className="font-semibold">権限：</span> {inviteInfo.role}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-gray-600">
              アカウントをお持ちでない方は、新しいパスワードを設定してください。
            </p>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">新しいパスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8文字以上"
                className="w-full rounded-md border px-3 py-2 text-sm"
                disabled={submitting}
              />
              {password && password.length < 8 && (
                <p className="text-xs text-red-600 mt-1">8文字以上である必要があります</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">パスワード（確認）</label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="パスワードを再入力"
                className="w-full rounded-md border px-3 py-2 text-sm"
                disabled={submitting}
              />
              {password && passwordConfirm && password !== passwordConfirm && (
                <p className="text-xs text-red-600 mt-1">パスワードが一致しません</p>
              )}
            </div>

            <button
              onClick={handlePasswordSubmit}
              disabled={
                submitting ||
                !password ||
                !passwordConfirm ||
                password !== passwordConfirm ||
                password.length < 8
              }
              className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-50"
            >
              {submitting ? '送信中…' : 'パスワードを設定'}
            </button>

            <div className="border-t pt-3 text-center">
              <p className="mb-2 text-xs text-gray-600">既にアカウントをお持ちの方</p>
              <button
                onClick={goToLogin}
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
              >
                ログインして招待を受け入れる
              </button>
            </div>
          </div>
        </div>
      )}

      {submitting && currentUserEmail && (
        <p className="mb-4 text-sm text-gray-600">所属を登録しています…</p>
      )}

      {/* ログイン済みで招待メールと一致しない場合 */}
      {currentUserEmail && inviteInfo && currentUserEmail.toLowerCase() !== inviteInfo.email.toLowerCase() && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm space-y-3">
          <p>
            ログインしているメールアドレス（{currentUserEmail}）が招待メール（{inviteInfo.email}）と一致しません。
          </p>
          <button
            onClick={handleLogout}
            className="w-full rounded bg-red-600 px-3 py-2 text-white text-sm hover:bg-red-700"
          >
            ログアウトして再度ログイン
          </button>
        </div>
      )}
    </main>
  );
}
