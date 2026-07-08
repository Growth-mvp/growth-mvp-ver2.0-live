// /components/LogoutButton.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { supabase, clearDisplayCookies } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';

/* ---------------- helpers ---------------- */

/**
 * GROWTH SHIFT関連の localStorage/sessionStorage キーをすべて削除
 * 対象: strategy-store, company-context, stage-*, org-alignment-*, admin-* など
 */
function purgeGrowthShiftLocalStorage() {
  try {
    if (typeof window === 'undefined') return;

    // 削除対象のプレフィックス・キー一覧
    const targetPatterns = [
      /^strategy-store/i,
      /^company-context/i,
      /^stage-/i,
      /^org-alignment/i,
      /^admin-/i,
      /^growth-/i,
      /^growth::/i,
      /^department-/i,
      /^okr-/i,
      /^project-/i,
    ];

    // localStorage のクリア
    const localKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) || '');
    localKeys.forEach((k) => {
      if (targetPatterns.some((pattern) => pattern.test(k))) {
        localStorage.removeItem(k);
      }
    });

    // sessionStorage のクリア
    const sessionKeys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i) || '');
    sessionKeys.forEach((k) => {
      if (targetPatterns.some((pattern) => pattern.test(k))) {
        sessionStorage.removeItem(k);
      }
    });
  } catch {}
}

function purgeSupabaseLocalStorage() {
  try {
    if (typeof window === 'undefined') return;
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) || '');
    keys.forEach((k) => {
      if (/^(sb-|supabase)/i.test(k)) localStorage.removeItem(k);
    });
  } catch {}
}

function purgeCustomCookies() {
  try {
    if (typeof document === 'undefined') return;
    ['user_id', 'company_id', 'user_role', 'department_id'].forEach((n) => {
      document.cookie = `${n}=; Path=/; Max-Age=0; SameSite=Lax`;
    });
  } catch {}
}

// 指定時間で打ち切る
async function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout:${ms}`)), ms)),
  ]);
}

/* ---------------- component ---------------- */

export default function LogoutButton() {
  const router = useRouter();

  const clearUser = useUserStore((s) => s.clearUser);
  const setCompanyId = useUserStore((s) => s.setCompanyId);
  const s = useStrategyStore() as any;

  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  const hardCleanup = () => {
    try {
      // GROWTH SHIFT関連のすべてのキーを削除
      purgeGrowthShiftLocalStorage();
      purgeSupabaseLocalStorage();
      clearDisplayCookies?.();
      purgeCustomCookies();
    } catch {}
    try {
      clearUser?.();
      setCompanyId?.(null);
    } catch {}
    try {
      if (typeof s?.clearAllData === 'function') s.clearAllData();
      else if (typeof s?.reset === 'function') s.reset();
    } catch {}
  };

  const navigateSafely = () => {
    // 多段保険：SPA → replace → 最終的にハードリダイレクト
    try { router.replace('/login'); } catch {}
    setTimeout(() => { try { router.replace('/login'); } catch {} }, 150);
    setTimeout(() => { if (typeof window !== 'undefined') window.location.replace('/login'); }, 500);
    setTimeout(() => { if (typeof window !== 'undefined') window.location.assign('/login'); }, 1500);
  };

  const handleLogout = async () => {
    if (busy) return;
    setBusy(true);

    // 1) まずUI側を即時クリーン（ハングしても戻れる）
    hardCleanup();

    try {
      // 2) signOut をタイムアウト付きで試行（global → local の順）
      try {
        await raceWithTimeout(supabase.auth.signOut({ scope: 'global' as any }), 3000);
      } catch {
        try {
          await raceWithTimeout(supabase.auth.signOut({ scope: 'local' as any }), 2000);
        } catch {
          // 失敗してもローカルは既に掃除済みなので前に進む
        }
      }
    } finally {
      // 3) 必ず遷移（どのみち再ログインで正しい状態に復旧）
      navigateSafely();

      // 4) busy解除（アンマウント後の setState を避ける）
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      className="w-full flex h-9 items-center justify-center rounded-full text-sm font-medium bg-white text-slate-600 border border-gray-200 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
      title={busy ? 'ログアウト中…' : 'ログアウト'}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      aria-live="polite"
    >
      {busy ? 'ログアウト中…' : 'ログアウト'}
    </button>
  );
}
