// /app/admin/layout.tsx
import 'server-only';
export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import AdminNav from './_components/AdminNav';

/**
 * 管理画面レイアウト（サーバー専用）
 * - サーバーでのユーザー検証は supabase.auth.getUser() を使用（認証サーバー問い合わせで正当性保証）
 * - company_members で admin ロールを確認（RLSにより自分の行のみ可視）
 * - Next.js 15 の cookies() をそのままアダプタ経由で渡す（set/remove は no-op でOK）
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  );

  // ✅ 認証サーバーに問い合わせて“検証済みユーザー”を取得（getSession は使わない）
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (userErr || !user) {
    redirect('/login');
  }

  // ✅ メンバーシップ確認（自分の行にだけマッチさせる）
  const { data: membership, error: memErr } = await supabase
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (memErr || !membership) {
    redirect('/login'); // プロビジョニング未実施など
  }
  if (membership.role !== 'admin') {
    redirect('/403');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <h1 className="text-lg font-semibold">管理コンソール</h1>
          <div className="text-xs text-gray-500">
            company_id: <code>{membership.company_id}</code>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-6 md:grid-cols-[220px_1fr]">
        <aside>
          <AdminNav />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
