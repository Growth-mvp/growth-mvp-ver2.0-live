// /app/admin/page.tsx
import 'server-only';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type StrategyRow = {
  id: string;
  company_name: string | null;
  industry: string | null;
  employees: number | string | null;
  updated_at: string | null;
};

export default async function AdminPage() {
  const cookieStore = await cookies();
  const hdrs = await headers();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // ⚠️ App Router Server Component ではレンダー中に cookie set 不可
          // Supabase が内部的に cookie を set しようとする場合、
          // Route Handler にログインして処理を委譲する
          // ここではダミー（何もしない）にして、エラーを防ぐ
          // 実際の cookie 設定が必要な場合は、Client Component (AdminCookieSetter) で行う
        },
        remove(name: string, options: CookieOptions) {
          // ⚠️ 同上の理由で何もしない
        },
      },
      global: { headers: Object.fromEntries(hdrs) },
    }
  );

  // ✅ セッション存在確認ではなく、本人検証されたユーザー取得を使用
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const userId = userRes?.user?.id ?? null;
  if (userErr || !userId) redirect('/login');

  // 自分の membership（role=admin を確認）
  const { data: membership, error: mErr } = await supabase
    .from('company_members')
    .select('company_id, role, department_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (mErr || !membership) redirect('/login');
  if (membership.role !== 'admin') redirect('/403');

  const companyId = membership.company_id;
  if (!companyId) redirect('/login');

  // strategy_data 取得
  const { data: strategies, error } = await supabase
    .from('strategy_data')
    .select('id, company_name, industry, employees, updated_at')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false });

  // UI
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">📊 戦略データ管理画面</h1>

      <div className="rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-100 text-sm text-gray-700">
            <tr>
              <th className="p-3">会社名</th>
              <th className="p-3">業種</th>
              <th className="p-3">従業員数</th>
              <th className="p-3">最終更新</th>
              <th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {!strategies || strategies.length === 0 ? (
              <tr>
                <td className="p-4 text-sm text-gray-500" colSpan={5}>
                  {error ? 'データの取得に失敗しました。' : 'データがありません。'}
                </td>
              </tr>
            ) : (
              (strategies as StrategyRow[]).map((s) => (
                <tr key={s.id} className="border-t text-sm">
                  <td className="p-3">{s.company_name || '-'}</td>
                  <td className="p-3">{s.industry || '-'}</td>
                  <td className="p-3">{s.employees ?? '-'}</td>
                  <td className="p-3">
                    {s.updated_at ? new Date(s.updated_at).toLocaleString() : '-'}
                  </td>
                  <td className="p-3">
                    <Link href={`/admin/edit/${s.id}`} className="text-blue-600 hover:underline">
                      ✏️ 編集
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-sm text-gray-500">
        <Link href="/admin/members" className="underline">
          👥 メンバー管理へ
        </Link>
      </div>
    </div>
  );
}
