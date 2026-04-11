// /app/StrategyGuard.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUserStore } from '@/store/userStore';

/**
 * ★ Strategy Page Guard
 * - Both view & edit modes: require login + company membership
 * - mode='edit': additionally require admin/manager role (members get /403)
 * - Redirects non-authorized users to /login, /auth/welcome, or /403
 * - Used by: /stage1-6, /cascade, /okr, /execution, /story-process
 *
 * Note: /auth/welcome, /invite/accept, /auth/callback should NOT use this guard to avoid redirect loops
 */
export default function StrategyGuard({
  children,
  mode = 'view',
}: {
  children: React.ReactNode;
  mode?: 'view' | 'edit';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useUserStore((s) => s.hydrated);
  const isLoggedIn = useUserStore((s) => !!s.user?.id);
  const membershipLoaded = useUserStore((s) => s.membershipLoaded);
  const companyId = useUserStore((s) => s.companyId);
  const isAdmin = useUserStore((s) => s.isAdmin);
  const isManager = useUserStore((s) => s.isManager);
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const canEdit = isAdmin || isManager;
  const role = isAdmin ? 'admin' : isManager ? 'manager' : 'member';

  // ★ Guard 除外パス（招待受諾、callback、welcome）
  const isExemptPath = pathname?.startsWith('/invite/accept') ||
                       pathname?.startsWith('/auth/callback') ||
                       pathname?.startsWith('/auth/welcome');

  useEffect(() => {
    // ★ 診断ログ
    console.log('[StrategyGuard]', {
      pathname,
      mode,
      role: isLoggedIn ? role : 'not_logged_in',
      companyId,
      membershipLoaded,
      hydrated,
    });

    // Guard 除外パスはスキップ
    if (isExemptPath) {
      console.log('[StrategyGuard] exempt path, skipping guard:', pathname);
      setAllowed(true);
      setChecking(false);
      return;
    }

    // Wait for store hydration
    if (!hydrated) return;

    // Not logged in → /login
    if (!isLoggedIn) {
      console.log('[StrategyGuard] not logged in, redirecting to /login');
      setChecking(false);
      router.replace('/login');
      return;
    }

    // Wait for membership verification
    if (!membershipLoaded) return;

    // Both view & edit require company membership
    if (!companyId) {
      console.log('[StrategyGuard] no company membership, redirecting to /auth/welcome');
      setChecking(false);
      router.replace('/auth/welcome');
      return;
    }

    // For edit mode: require admin or manager
    if (mode === 'edit' && !canEdit) {
      console.warn('[StrategyGuard] redirecting to /403', {
        pathname,
        mode,
        role,
      });
      setChecking(false);
      router.replace('/403');
      return;
    }

    // ✅ Allowed
    setAllowed(true);
    setChecking(false);
  }, [hydrated, isLoggedIn, membershipLoaded, companyId, mode, canEdit, router, isExemptPath, pathname, role]);

  if (checking) {
    return <div className="grid min-h-dvh place-items-center text-sm text-gray-500">読み込み中…</div>;
  }

  if (!allowed) {
    return null;
  }

  return (
    <>
      {!canEdit && (
        <div className="sticky top-0 z-50 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
          閲覧モード（編集は管理者/マネージャーのみ）
        </div>
      )}
      {children}
    </>
  );
}
