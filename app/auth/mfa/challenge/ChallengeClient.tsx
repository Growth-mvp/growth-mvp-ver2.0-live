'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { safeInternalPath } from '@/lib/safeRedirect';
import { getVerifiedFactorId, verifyChallenge, type MfaClient, type MfaErrorCode } from '@/lib/auth/mfaClient';
import { clearInviteCookie } from '@/lib/auth/inviteCookieClient';

type Phase = 'checking' | 'ready' | 'no_factor' | 'error';

const ERROR_TEXT: Record<MfaErrorCode, string> = {
  invalid_format: '6桁の数字を入力してください',
  invalid_code: '認証コードが正しくありません。認証アプリの最新のコードを入力してください',
  rate_limited: '試行回数が多すぎます。しばらく待ってから再度お試しください',
  already_enrolled: '2段階認証は登録済みです',
  needs_aal2: '追加認証が必要です。コードを入力してください',
  unknown: '認証に失敗しました。もう一度お試しください',
};

export default function ChallengeClient() {
  const router = useRouter();
  const search = useSearchParams();
  const destination = safeInternalPath(search?.get('redirect_to')) ?? '/';

  const [phase, setPhase] = useState<Phase>('checking');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!sess?.session) {
        router.replace('/login');
        return;
      }

      const { data, error: levelErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;
      if (levelErr || !data) {
        setPhase('error');
        return;
      }
      // 既に aal2、または追加認証が不要なら、そのまま遷移する
      if (data.currentLevel === 'aal2' || data.nextLevel !== 'aal2') {
        router.replace(destination);
        return;
      }

      const factor = await getVerifiedFactorId(supabase.auth.mfa as unknown as MfaClient);
      if (cancelled) return;
      if (!factor.ok) {
        setPhase('error');
        return;
      }
      if (!factor.data) {
        setPhase('no_factor');
        return;
      }
      setFactorId(factor.data);
      setPhase('ready');
    })().catch(() => {
      if (!cancelled) setPhase('error');
    });

    return () => {
      cancelled = true;
    };
  }, [destination, router, attempt]);

  const retry = () => {
    setPhase('checking');
    setAttempt((n) => n + 1);
  };

  const submit = async () => {
    if (!factorId || busy) return;
    setBusy(true);
    setError('');

    const result = await verifyChallenge(supabase.auth.mfa as unknown as MfaClient, factorId, code);
    setBusy(false);

    if (!result.ok) {
      setError(ERROR_TEXT[result.code]);
      setCode('');
      return;
    }
    router.replace(destination);
  };

  const logout = async () => {
    await clearInviteCookie();
    await supabase.auth.signOut({ scope: 'global' });
    router.replace('/login');
  };

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-bold">2段階認証</h1>

      {phase === 'checking' && <p className="text-sm text-gray-600">確認しています…</p>}

      {phase === 'error' && (
        <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>認証の状態を確認できませんでした。もう一度お試しください。</p>
          <button onClick={retry} className="w-full rounded bg-gray-900 px-3 py-2 text-white">
            再試行する
          </button>
          <button onClick={logout} className="w-full rounded border border-red-300 px-3 py-2 text-red-700">
            ログアウト
          </button>
        </div>
      )}

      {phase === 'no_factor' && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>2段階認証の登録が確認できません。</p>
          <Link href="/auth/mfa/enroll" className="block text-center underline">
            2段階認証の登録へ
          </Link>
          <button onClick={logout} className="w-full rounded bg-gray-900 px-3 py-2 text-white">
            ログアウト
          </button>
        </div>
      )}

      {phase === 'ready' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">認証アプリに表示されている6桁のコードを入力してください。</p>

          {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{error}</p>}

          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            className="w-full rounded-md border px-3 py-2 text-center text-lg tracking-widest"
            placeholder="123456"
            disabled={busy}
          />

          <button
            onClick={submit}
            disabled={busy || code.length !== 6}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? '確認中…' : '確認する'}
          </button>

          <button onClick={logout} className="w-full text-sm text-gray-600 underline">
            ログアウト
          </button>
        </div>
      )}
    </main>
  );
}
