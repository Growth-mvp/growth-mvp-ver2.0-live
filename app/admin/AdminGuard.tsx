// /app/admin/AdminGuard.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';

/**
 * ★ 修正：Client Component での管理画面アクセスチェック
 * - layoutClient が refresh_token_not_found を検出して強制ログアウトするため
 *   ここでは最小限のチェックのみ実施（user が存在し、role が admin であるか）
 * - 認証失敗時は router.replace() でリダイレクト（Server redirect ではなく Client redirect）
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        // 1) セッション確認
        const { data: sres, error: serr } = await supabase.auth.getSession();
        if (serr || !sres?.session?.user?.id) {
          console.warn('[AdminGuard] not logged in');
          router.replace('/login');
          return;
        }

        const userId = sres.session.user.id;

        // 2) admin ロール確認
        const { data: membership, error: memErr } = await supabase
          .from('company_members')
          .select('company_id, role')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();

        if (memErr || !membership || membership.role !== 'admin') {
          console.warn('[AdminGuard] not admin or no membership', { memErr, membership });
          router.replace(membership ? '/403' : '/auth/welcome');
          return;
        }

        // ✅ Allowed
        setAllowed(true);
      } catch (e) {
        console.error('[AdminGuard] check failed:', e);
        router.replace('/login');
      } finally {
        setChecking(false);
      }
    };

    checkAccess();
  }, [router]);

  if (checking) {
    return <div className="grid min-h-dvh place-items-center text-sm text-gray-500">読み込み中…</div>;
  }

  if (!allowed) {
    return null;
  }

  return <>{children}</>;
}
