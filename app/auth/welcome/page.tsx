'use client';

// /app/auth/welcome/page.tsx
import { Suspense, useEffect, useRef, useState, useMemo } from 'react';
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
  const [actionError, setActionError] = useState('');
  const [companyMissing, setCompanyMissing] = useState(false);

  // StrictMode 二重実行抑止（チェック処理のみ）
  const inFlight = useRef(false);

  // ★ 招待token（URLから取得、またはlocalStorageから復元）
  const token = useMemo(() => {
    const urlToken = (searchParams?.get('token') || '').trim();
    if (urlToken) return urlToken;

    // localStorage から復元
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('pendingInviteToken');
        if (saved) {
          console.log('[auth/welcome] Restored token from localStorage');
          return saved;
        }
      } catch (e) {
        console.warn('[auth/welcome] could not read from localStorage:', e);
      }
    }

    return null;
  }, [searchParams]);

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
      // ★修正：通常導線では未所属ユーザーを /login に戻す
      setRole('member');
      setMembership({ companyId: undefined, departmentId: undefined });
      setMsg('このアカウントはまだ会社に所属していません。管理者から届いた招待メールのリンクからアクセスしてください。');
      setCompanyMissing(false); // 見た目は未所属でなく、通常メッセージ表示状態へ
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

    // 招待トークンがあれば、すぐに /invite/accept へ遷移
    // これは Supabase の標準メール経由で /auth/welcome に来た場合のリダイレクト
    if (token) {
      console.log('[auth/welcome] Token detected, redirecting to /invite/accept');
      router.replace(`/invite/accept?token=${encodeURIComponent(token)}`);
      return;
    }

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
  }, [token, router]);



  if (loading) {
    return <div className="mx-auto max-w-xl p-8 text-sm text-gray-600">{msg}</div>;
  }


  return <div className="mx-auto max-w-xl p-8 text-sm text-gray-600">{msg}</div>;
}