// /app/StrategyGuard.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';

/**
 * ★ Strategy Page Guard
 * - mode='view': Member can view but not edit. Only requires login + company
 * - mode='edit': Only admin/manager can access (members get /403)
 * - Redirects non-authorized users to /403 or /auth/welcome
 * - Used by: /stage1-6, /cascade, /okr, /execution, /story-process
 */
export default function StrategyGuard({
  children,
  mode = 'view',
}: {
  children: React.ReactNode;
  mode?: 'view' | 'edit';
}) {
  const router = useRouter();
  const hydrated = useUserStore((s) => s.hydrated);
  const isLoggedIn = useUserStore((s) => !!s.user?.id);
  const membershipLoaded = useUserStore((s) => s.membershipLoaded);
  const companyId = useUserStore((s) => s.companyId);
  const isAdmin = useUserStore((s) => s.isAdmin);
  const isManager = useUserStore((s) => s.isManager);
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const canEdit = isAdmin || isManager;

  useEffect(() => {
    // Wait for store hydration
    if (!hydrated) return;

    // Not logged in → /login
    if (!isLoggedIn) {
      console.log('[StrategyGuard] not logged in, redirecting to /login');
      router.replace('/login');
      return;
    }

    // Wait for membership verification
    if (!membershipLoaded) return;

    // No company ID (not member of any company) → /auth/welcome
    if (!companyId) {
      console.log('[StrategyGuard] no company assigned, redirecting to /auth/welcome');
      router.replace('/auth/welcome');
      return;
    }

    // For edit mode: require admin or manager
    if (mode === 'edit' && !canEdit) {
      console.warn('[StrategyGuard] user is member (not admin/manager), redirecting to /403');
      router.replace('/403');
      return;
    }

    // ✅ Allowed
    setAllowed(true);
    setChecking(false);
  }, [hydrated, isLoggedIn, membershipLoaded, companyId, mode, canEdit, router]);

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
