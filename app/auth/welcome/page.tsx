// /app/auth/welcome/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useUserStore } from '@/store/userStore';

/**
 * 目的：
 * - ログイン済みだが company_members に行が無いユーザーをここに誘導
 * - 会社作成 or 招待リンク/管理者による追加 へナビする中継画面
 * - セッション未確定なら /login へ戻す
 */

type Role = 'admin' | 'manager' | 'member';

export default function AuthWelcomePage() {
  const router = useRouter();

  const setUser = useUserStore((s) => s.setUser);
  const setRole = useUserStore((s) => s.setRole);
  const setMembership = useUserStore((s) => s.setMembership);

  const [msg, setMsg] = useState('ログイン状態を確認しています…');
  const [loading, setLoading] = useState(true);
  const [companyMissing, setCompanyMissing] = useState<boolean | null>(null);

  const inFlight = useRef(false);

  useEffect(() => {
    if (inFlight.current) return;
    inFlight.current = true;

    const ac = new AbortController();
    const { signal } = ac;

    (async () => {
      try {
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
          departmentId: undefined, // 型の将来変更に備えて明示
        });

        // 2) 所属確認（RLSエラーも未所属扱いに統一）
        const { data, error } = await supabase
          .from('company_members')
          .select('company_id, role')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        if (signal.aborted) return;

        if (error || !data) {
          // 行なし or 読めない → 未所属
          setCompanyMissing(true);
          setRole('member');
          setMembership({ companyId: undefined, departmentId: undefined });
          setMsg('所属が見つかりません。会社の作成または参加が必要です。');
          return;
        }

        // 行あり：通常画面へ
        const role = (data.role as Role) ?? 'member';
        setCompanyMissing(false);
        setRole(role);
        setMembership({ companyId: data.company_id ?? undefined, departmentId: undefined });
        setMsg('所属を確認しました。ホームへ移動します…');
        router.replace('/');
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [router, setMembership, setRole, setUser]);

  if (loading) {
    return (
      <div className="mx-auto max-w-xl p-8 text-sm text-gray-600">
        {msg}
      </div>
    );
  }

  // 未所属時の案内UI
  if (companyMissing) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold mb-4">ようこそ</h1>
        <p className="text-gray-600 mb-6">
          現在、このアカウントはまだ会社に所属していません。
          以下のいずれかの方法で開始してください。
        </p>

        <div className="space-y-4">
          <button
            onClick={() => router.push('/admin')}
            className="inline-flex items-center rounded-lg border px-4 py-2 text-sm shadow-sm hover:bg-gray-50"
          >
            ① 新しく会社を作成する（管理者向け）
          </button>

          <button
            onClick={() => router.push('/login')}
            className="ml-3 inline-flex items-center rounded-lg border px-4 py-2 text-sm shadow-sm hover:bg-gray-50"
          >
            ② 招待メールを確認して再ログイン（参加）
          </button>

          <div className="text-xs text-gray-500 pt-4 leading-relaxed">
            ・既に管理者によりあなたのメールが追加済みの場合、ログインし直すと所属が反映されます。<br />
            ・管理者は「/admin」で会社作成・メンバー追加ができます。<br />
            ・RLS設定の不備で所属が読めない場合は、管理者にご連絡ください。
          </div>
        </div>
      </div>
    );
  }

  // ここに来ることはほぼ無い（直後に / へ遷移）
  return (
    <div className="mx-auto max-w-xl p-8 text-sm text-gray-600">
      {msg}
    </div>
  );
}
