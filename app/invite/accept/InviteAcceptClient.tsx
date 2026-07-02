// /app/invite/accept/InviteAcceptClient.tsx
'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';

type InviteInfo = {
  email: string;
  companyId: string;
  companyName: string;
  role: string;
  expiresAt: string;
};

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
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [settingPassword, setSettingPassword] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  /**
   * ✅ 招待情報を取得（未ログイン状態でも可能）
   */
  const loadInviteInfoRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      console.log('[invite/accept] Initialize: loading invite info');

      if (!token) {
        console.log('[invite/accept] token not ready yet');
        setCheckingAuth(false);
        setError('招待トークンがありません。招待リンクをご確認ください。');
        return;
      }

      // 既にこの token で招待情報を取得済みならスキップ
      if (loadInviteInfoRef.current === token) {
        console.log('[invite/accept] already loaded invite info, skip');
        setCheckingAuth(false);
        return;
      }

      try {
        // 招待情報を取得（未ログイン状態でも OK）
        const res = await fetch(`/api/invites/info?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          let errorMessage = 'エラーが発生しました';

          if (data?.error === 'invite_expired') {
            errorMessage = '招待の有効期限が切れています';
          } else if (data?.error === 'invite_already_used') {
            errorMessage = 'この招待は既に使用されています';
          } else if (data?.error === 'invite_not_found') {
            errorMessage = '招待が見つかりません（無効または削除されている可能性があります）';
          } else {
            errorMessage = data?.message || errorMessage;
          }

          console.error('[invite/accept] Failed to load invite info:', {
            error: data?.error,
            message: data?.message,
            tokenHead: token.slice(0, 8),
          });

          setError(errorMessage);
          setCheckingAuth(false);
          return;
        }

        // 招待情報を保存
        loadInviteInfoRef.current = token;
        const info: InviteInfo = {
          email: data.email,
          companyId: data.companyId,
          companyName: data.companyName,
          role: data.role,
          expiresAt: data.expiresAt,
        };
        setInviteInfo(info);

        console.log('[invite/accept] Loaded invite info:', {
          email: info.email,
          companyName: info.companyName,
          role: info.role,
          tokenHead: token.slice(0, 8),
        });

        // ログイン状態を確認
        const { data: sessRes } = await supabase.auth.getSession();
        const session = sessRes?.session;

        if (session?.user?.email) {
          // ログイン済み
          setCurrentUserEmail(session.user.email);
          console.log('[invite/accept] User is logged in:', {
            email: session.user.email,
          });

          // メールアドレスが一致するか確認
          if (session.user.email.toLowerCase() !== info.email.toLowerCase()) {
            setError(
              `メールアドレスが一致しません。招待は ${info.email} に送信されています。\n` +
              'ログアウトして、招待されたメールアドレスでログインしてください。'
            );
            setCheckingAuth(false);
            return;
          }

          // ログイン済みで email が一致 → そのまま company_members 作成へ
          // ※既存実装の /api/invites/accept を使用
        } else {
          // 未ログイン → パスワード設定フォームを表示
          console.log('[invite/accept] User is not logged in, show password form');
        }

        setCheckingAuth(false);
      } catch (e: any) {
        console.error('[invite/accept] Exception loading invite info:', {
          error: e?.message || String(e),
          tokenHead: token.slice(0, 8),
        });

        setError('招待情報の読み込みに失敗しました。もう一度お試しください。');
        setCheckingAuth(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut({ scope: 'global' });
      router.replace('/login');
    } catch (e) {
      console.error('Logout failed:', e);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!inviteInfo || !token) return;

    // バリデーション
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

    setSettingPassword(true);
    setError('');

    try {
      const res = await fetch('/api/invites/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          password,
          email: inviteInfo.email,
        }),
      });

      const data = await res.json();

      console.log('[invite/accept] Password setup response:', {
        status: res.status,
        ok: res.ok,
        error: data?.error,
        tokenHead: token.slice(0, 8),
      });

      if (!res.ok) {
        let errorMessage = 'エラーが発生しました';

        if (data?.error === 'invite_expired') {
          errorMessage = '招待の有効期限が切れています';
        } else if (data?.error === 'invite_already_used') {
          errorMessage = 'この招待は既に使用されています';
        } else if (data?.error === 'invite_not_found') {
          errorMessage = '招待が見つかりません';
        } else if (data?.error === 'email_mismatch') {
          errorMessage = 'メールアドレスが一致しません';
        } else {
          errorMessage = data?.message || errorMessage;
        }

        setError(errorMessage);
        setSettingPassword(false);
        return;
      }

      // 成功
      setMsg('パスワードを設定しました。ログインしてください。');

      // localStorage をクリア
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem('pendingInviteToken');
        } catch (e) {
          console.warn('[invite/accept] could not clear localStorage:', e);
        }
      }

      // ログイン画面へ遷移
      setTimeout(() => {
        router.replace('/login');
      }, 2000);
    } catch (e: any) {
      console.error('[invite/accept] Exception in password setup:', {
        error: e?.message || String(e),
        tokenHead: token.slice(0, 8),
      });
      setError('パスワード設定に失敗しました。もう一度お試しください。');
      setSettingPassword(false);
    }
  };

  if (checkingAuth) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-600">招待情報を確認中...</p>
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
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-green-800 text-sm">
          ✅ {msg}
        </div>
      )}

      {/* 招待情報を表示（未ログイン時 & パスワード未設定時）*/}
      {inviteInfo && !currentUserEmail && !msg && !settingPassword && !error && (
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

          {/* パスワード設定フォーム */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                新しいパスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8文字以上"
                className="w-full rounded-md border px-3 py-2 text-sm"
                disabled={settingPassword}
              />
              {password && password.length < 8 && (
                <p className="text-xs text-red-600 mt-1">8文字以上である必要があります</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                パスワード（確認）
              </label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="パスワードを再入力"
                className="w-full rounded-md border px-3 py-2 text-sm"
                disabled={settingPassword}
              />
              {password && passwordConfirm && password !== passwordConfirm && (
                <p className="text-xs text-red-600 mt-1">パスワードが一致しません</p>
              )}
            </div>

            <button
              onClick={handlePasswordSubmit}
              disabled={
                settingPassword ||
                !password ||
                !passwordConfirm ||
                password !== passwordConfirm ||
                password.length < 8
              }
              className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-50"
            >
              {settingPassword ? '設定中…' : 'パスワードを設定'}
            </button>
          </div>
        </div>
      )}

      {/* ログイン済みで email が一致しない場合 */}
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
