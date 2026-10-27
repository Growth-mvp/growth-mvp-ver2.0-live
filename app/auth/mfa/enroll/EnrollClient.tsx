'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import {
  confirmEnrollment,
  discardPendingEnrollment,
  getEnrollmentStatus,
  startEnrollment,
  unenrollFactor,
  type EnrollmentStatus,
  type MfaClient,
  type MfaErrorCode,
} from '@/lib/auth/mfaClient';

const ERROR_TEXT: Record<MfaErrorCode, string> = {
  invalid_format: '6桁の数字を入力してください',
  invalid_code: '認証コードが正しくありません。認証アプリの最新のコードを入力してください',
  rate_limited: '試行回数が多すぎます。しばらく待ってから再度お試しください',
  already_enrolled: '2段階認証は登録済みです',
  needs_aal2: '解除するには、先に追加認証を済ませてから操作してください',
  unknown: '処理に失敗しました。もう一度お試しください',
};

type Pending = { factorId: string; qrCode: string; secret: string };

export default function EnrollClient() {
  const router = useRouter();
  const api = supabase.auth.mfa as unknown as MfaClient;

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<EnrollmentStatus | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const reload = async () => {
    const res = await getEnrollmentStatus(api);
    if (!res.ok) {
      setError(ERROR_TEXT[res.code]);
      setStatus(null);
      return;
    }
    setStatus(res.data);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!sess?.session) {
        router.replace('/login');
        return;
      }
      await reload();
      if (!cancelled) setLoading(false);
    })().catch(() => {
      if (!cancelled) {
        setError('状態を確認できませんでした。再読み込みしてください');
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // 初回のみ実行する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const start = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    const res = await startEnrollment(api);
    setBusy(false);

    if (!res.ok) {
      if (res.code === 'already_enrolled') {
        await reload();
        return;
      }
      setError(ERROR_TEXT[res.code]);
      return;
    }
    setPending({ factorId: res.data.factorId, qrCode: res.data.qrCode, secret: res.data.secret });
    setCode('');
  };

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError('');

    const res = await confirmEnrollment(api, pending.factorId, code);
    setBusy(false);

    if (!res.ok) {
      setError(ERROR_TEXT[res.code]);
      setCode('');
      return;
    }
    setPending(null);
    setCode('');
    setMessage('2段階認証の登録が完了しました');
    await reload();
  };

  const unenroll = async () => {
    if (status?.kind !== 'enrolled' || busy) return;
    if (!window.confirm('2段階認証を解除しますか？')) return;
    setBusy(true);
    setError('');
    setMessage('');
    const res = await unenrollFactor(api, status.factorId);
    setBusy(false);
    if (!res.ok) {
      setError(ERROR_TEXT[res.code]);
      return;
    }
    setMessage('2段階認証を解除しました');
    await reload();
  };

  const cancel = async () => {
    setBusy(true);
    setError('');
    const res = await discardPendingEnrollment(api);
    setBusy(false);
    setPending(null);
    setCode('');
    if (!res.ok) {
      setError(ERROR_TEXT[res.code]);
      return;
    }
    await reload();
  };

  return (
    <main className="mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-2xl font-bold">2段階認証の登録</h1>

      {loading && <p className="text-sm text-gray-600">読み込んでいます…</p>}

      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      {message && <p className="rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800">{message}</p>}

      {!loading && status?.kind === 'enrolled' && !pending && (
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <p>2段階認証は登録済みです。</p>
          <button onClick={unenroll} disabled={busy} className="mt-3 w-full rounded border border-red-300 px-3 py-2 text-red-700 disabled:opacity-50">
            2段階認証を解除する
          </button>
          <Link href="/" className="mt-3 inline-block underline">
            ホームへ戻る
          </Link>
        </div>
      )}

      {!loading && status?.kind !== 'enrolled' && !pending && (
        <div className="space-y-3">
          {status?.kind === 'pending' && (
            <p className="text-sm text-amber-800">未完了の登録があります。続けるか、破棄して登録し直してください。</p>
          )}
          <button
            onClick={start}
            disabled={busy}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {status?.kind === 'pending' ? '登録を再開する' : '登録を開始する'}
          </button>
          {status?.kind === 'pending' && (
            <button onClick={cancel} disabled={busy} className="w-full text-sm text-gray-600 underline">
              未完了の登録を破棄する
            </button>
          )}
        </div>
      )}

      {pending && (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            認証アプリ（Google Authenticator、Microsoft Authenticator など）でQRコードを読み取ってください。
          </p>
          {/* QR コードはサーバーが返した SVG のデータ。ログには出さない */}
          <img src={pending.qrCode} alt="2段階認証のQRコード" className="mx-auto h-48 w-48" />
          <details className="text-sm text-gray-700">
            <summary className="cursor-pointer">QRコードを読み取れない場合</summary>
            <p className="mt-2">次のキーを認証アプリに手入力してください。</p>
            <p className="mt-1 break-all rounded bg-slate-100 p-2 font-mono text-xs">{pending.secret}</p>
          </details>

          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full rounded-md border px-3 py-2 text-center text-lg tracking-widest"
            placeholder="123456"
            disabled={busy}
          />

          <button
            onClick={confirm}
            disabled={busy || code.length !== 6}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? '確認中…' : '登録を確定する'}
          </button>
          <button onClick={cancel} disabled={busy} className="w-full text-sm text-gray-600 underline">
            キャンセル
          </button>
        </div>
      )}
    </main>
  );
}
