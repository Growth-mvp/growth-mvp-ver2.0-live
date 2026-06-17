// /app/admin/_components/AdminNav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useUserStore } from '@/store/userStore';
import { safeGetSession } from '@/utils/supabase/client';

const items = [
  { href: '/admin/members', label: 'メンバー管理' },
  { href: '/admin/invites', label: '招待' },
  { href: '/admin/data-management', label: 'データ管理' },
  { href: '/admin/org-insights', label: '組織論点ダッシュボード' },
];

export default function AdminNav() {
  const pathname = usePathname();
  const userStore = useUserStore();
  const companyId = userStore.companyId;

  const [unhandledCount, setUnhandledCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);

  useEffect(() => {
    if (!companyId) return;

    const fetchUnhandledCount = async () => {
      setLoadingCount(true);

      try {
        const { ok, data: sessionData } = await safeGetSession();
        if (!ok || !sessionData?.session?.access_token) return;

        const res = await fetch(
          `/api/org-alignment/admin/requests?companyId=${companyId}&status=pending`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${sessionData.session.access_token}`,
            },
          }
        );

        if (!res.ok) return;

        const resData = await res.json();
        setUnhandledCount((resData.requests || []).length);
      } catch (err) {
        console.error('Failed to fetch unhandled count:', err);
      } finally {
        setLoadingCount(false);
      }
    };

    fetchUnhandledCount();
    // 30秒ごとに更新
    const interval = setInterval(fetchUnhandledCount, 30000);

    return () => clearInterval(interval);
  }, [companyId]);

  return (
    <nav className="rounded-lg border bg-white p-2 shadow-sm">
      <ul className="space-y-1">
        {items.map((it) => {
          const active = pathname === it.href;
          const showBadge =
            it.href === '/admin/org-insights' && unhandledCount && unhandledCount > 0;

          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                  active
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span>{it.label}</span>
                {showBadge && (
                  <span className="inline-flex items-center justify-center rounded-full bg-red-500 h-5 w-5 text-xs font-bold text-white">
                    {unhandledCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
