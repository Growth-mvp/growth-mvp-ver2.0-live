// /app/admin/_components/AdminNav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/admin', label: 'ダッシュボード' },
  { href: '/admin/members', label: 'メンバー管理' },
  { href: '/admin/invites', label: '招待' },
  { href: '/admin/data-management', label: 'データ管理' },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="rounded-lg border bg-white p-2 shadow-sm">
      <ul className="space-y-1">
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
