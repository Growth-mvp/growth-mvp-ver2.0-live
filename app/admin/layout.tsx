// /app/admin/layout.tsx
'use client';

import AdminNav from './_components/AdminNav';
import AdminGuard from '@/app/admin/AdminGuard';

/**
 * 管理画面レイアウト
 * - 権限判定は AdminGuard（Client Component）に委譲
 * - layoutはシンプルにUI構造のみ
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50">
        <header className="border-b bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <h1 className="text-lg font-semibold">管理コンソール</h1>
          </div>
        </header>
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-6 md:grid-cols-[220px_1fr]">
          <aside>
            <AdminNav />
          </aside>
          <main>{children}</main>
        </div>
      </div>
    </AdminGuard>
  );
}
