'use client';

// /app/auth/welcome/page.tsx
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';

export const dynamic = 'force-dynamic';

type Role = 'admin' | 'manager' | 'member';

function isValidUUID(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * ✅ 重要：
 * - このファイル自体は Client Component（'use client'）
 * - ただし useSearchParams を使う “内側” を Suspense で包む必要があるため、
 *   外側ラッパー（Suspense）と内側本体（useSearchParams使用）を同一ファイルに共存させる
 */

export default function AuthWelcomePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl p-8 text-sm text-gray-600">読み込み中…</div>}>
      <WelcomeInner />
    </Suspense>
  );
}

function WelcomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setUser = useUserStore((s) => s.setUser);
  const setRole = useUserStore((s) => s.setRole);
  const setMembership = useUserStore((s) => s.setMembership);

  const [msg, setMsg] = useState('ログイン状態を確認しています…');
  const [loading, setLoading] = useState(true);
  const [companyMissing, setCompanyMissing] = useState<boolean | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string>('');
  const [onboardingCode, setOnboardingCode] = useState('');

  // “再チェック”用
  const [checkNonce, setCheckNonce] = useState(0);

  // StrictMode 二重実行抑止（チェック処理のみ）
  const inFlight = useRef(false);

  // 招待token（もしURLに token が付いているなら /invite/accept へ誘導できる）
  const token = (searchParams?.get('token') || '').trim() || null;

  const runCheck = async (signal: AbortSignal) => {
    setActionError('');
    setMsg('ログイン状態を確認しています…');
    setLoading(true);

    // 1) セッション確認
    const { data: sres, error: sErr } = await supabase.auth.getSession();
    if (signal.aborted) return;

    if (sErr) {
      setMsg('セッション確認に失敗しました。ログイン画面へ移動します…');
      router.replace('/login');
      return;
    }

    const session = sres?.session ?? null;
    const user = session?.user ?? null;

    if (!user) {
      setMsg('未ログインのためログイン画面へ移動します…');
      router.replace('/login');
      return;
    }

    // store 更新（最低限）
    setUser({
      id: user.id,
      email: user.email ?? '',
      name: '',
      role: 'member',
      departmentId: undefined,
    });

    // 2) 所属確認（RLSエラーも未所属扱いに統一）
    const { data, error } = await supabase
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (signal.aborted) return;

    if (error || !data || !data.company_id) {
      // 行なし or 読めない → 未所属
      setCompanyMissing(true);
      setRole('member');
      setMembership({ companyId: undefined, departmentId: undefined });
      setMsg('所属が見つかりません。会社の作成または参加が必要です。');
      setLoading(false);
      return;
    }

    // 行あり：通常画面へ
    const role = (data.role as Role) ?? 'member';
    setCompanyMissing(false);
    setRole(role);
    setMembership({ companyId: data.company_id ?? undefined, departmentId: undefined });
    setMsg('所属を確認しました。ホームへ移動します…');
    setLoading(false);

    router.replace('/');
  };

  useEffect(() => {
    if (inFlight.current) return;
    inFlight.current = true;

    const ac = new AbortController();
    const { signal } = ac;

    runCheck(signal).finally(() => {
      if (!signal.aborted) {
        inFlight.current = false;
      }
    });

    return () => {
      ac.abort();
      inFlight.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkNonce]);

  const handleRecheck = () => {
    setCheckNonce((x) => x + 1);
  };

  const handleLogoutToLogin = async () => {
    setActionError('');
    setActionLoading(true);
    try {
      // セッション残骸対策：一旦グローバルでログアウト
      await supabase.auth.signOut({ scope: 'global' });
    } catch (e) {
      // ignore
    } finally {
      setActionLoading(false);
      router.replace('/login');
    }
  };

  const handleAcceptInvite = async () => {
    if (!token) {
      setActionError('招待トークンが見つかりません。管理者からの招待リンクを開いてください。');
      return;
    }
    router.replace(`/invite/accept?token=${encodeURIComponent(token)}`);
  };

  const handleCreateCompany = async () => {
    setActionError('');
    setActionLoading(true);

    try {
      const { data: sres, error: sErr } = await supabase.auth.getSession();
      if (sErr) {
        setActionError('セッション確認に失敗しました。ログインし直してください。');
        return;
      }
      const session = sres?.session;
      if (!session?.access_token || !session?.user?.id) {
        setActionError('未ログインです。ログインし直してください。');
        router.replace('/login');
        return;
      }

      // ★重要：provision を "createモード" で実行（未所属でも会社作成を許可）
      const res = await fetch('/api/companies/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          'x-growth-provision-mode': 'create',
        },
        body: JSON.stringify({
          allowCreateCompany: true,
          onboardingCode: onboardingCode.trim(),
        }),
      });

      const j = await res.json().catch(() => ({} as any));

      if (!res.ok || !j?.ok) {
        const code = j?.code || j?.error || 'unknown';
        const detail = j?.message || j?.detail || '';
        setActionError(`会社作成に失敗しました（${code}） ${detail}`.trim());
        return;
      }

      const companyId = typeof j.companyId === 'string' && isValidUUID(j.companyId) ? j.companyId : null;

      // store を最小更新（cookieはprovision側のSet-Cookieで付く想定）
      setRole('admin');
      setMembership({ companyId: companyId ?? undefined, departmentId: undefined });

      setMsg('会社を作成しました。管理者画面へ移動します…');
      setCompanyMissing(false);

      router.replace('/admin');
    } catch (e: any) {
      setActionError(e?.message || '会社作成に失敗しました。もう一度お試しください。');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-xl p-8 text-sm text-gray-600">{msg}</div>;
  }

  if (companyMissing) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold mb-4">ようこそ</h1>
        <p className="text-gray-600 mb-6">
          現在、このアカウントはまだ会社に所属していません。以下のいずれかの方法で開始してください。
        </p>

        {actionError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 text-sm">
            ❌ {actionError}
          </div>
        )}

        <div className="mb-6 p-4 rounded-lg border border-blue-200 bg-blue-50">
          <label className="block text-sm font-semibold text-gray-700 mb-2">導入コード</label>
          <input
            type="text"
            value={onboardingCode}
            onChange={(e) => setOnboardingCode(e.target.value)}
            placeholder="管理者から提供されたコードを入力してください"
            className="w-full rounded border px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-600 mt-2">
            会社を新規作成するには、管理者から提供された導入コードが必要です。
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleCreateCompany}
            disabled={actionLoading || onboardingCode.trim().length === 0}
            className={`inline-flex items-center rounded-lg border px-4 py-2 text-sm shadow-sm hover:bg-gray-50 ${
              actionLoading || onboardingCode.trim().length === 0 ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            ① 新しく会社を作成する（管理者向け）
          </button>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleLogoutToLogin}
              disabled={actionLoading}
              className={`inline-flex items-center rounded-lg border px-4 py-2 text-sm shadow-sm hover:bg-gray-50 ${
                actionLoading ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            >
              ② 招待メールを確認して再ログイン（参加）
            </button>

            <button
              onClick={() => setCheckNonce((x) => x + 1)}
              disabled={actionLoading}
              className={`inline-flex items-center rounded-lg border px-4 py-2 text-sm shadow-sm hover:bg-gray-50 ${
                actionLoading ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            >
              所属を再チェック
            </button>

            {token && (
              <button
                onClick={handleAcceptInvite}
                disabled={actionLoading}
                className={`inline-flex items-center rounded-lg border px-4 py-2 text-sm shadow-sm hover:bg-gray-50 ${
                  actionLoading ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                招待トークンで参加する
              </button>
            )}
          </div>

          <div className="text-xs text-gray-500 pt-4 leading-relaxed">
            ・既に管理者によりあなたのメールが追加済みの場合、ログインし直すと所属が反映されます。<br />
            ・管理者は「/admin」で会社作成・メンバー追加ができます。<br />
            ・RLS設定の不備で所属が読めない場合は、管理者にご連絡ください。<br />
            ・招待リンクを持っている場合は、そのリンク（/invite/accept?token=...）を開くのが最短です。
          </div>
        </div>
      </div>
    );
  }

  return <div className="mx-auto max-w-xl p-8 text-sm text-gray-600">{msg}</div>;
}