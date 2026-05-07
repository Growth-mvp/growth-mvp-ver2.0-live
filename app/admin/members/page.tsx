// /app/admin/members/page.tsx
// ★ IMPORTANT: Invite form is intentionally removed. Use /admin/invites instead.
// If you need to add email/role input here, consider if it should go to /admin/invites instead.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/utils/supabase/client';
import {
  updateMemberRole,
  removeMember,
  type MemberListItem,
} from '@/utils/supabase/membership'; // ✅ 必要なものだけ
import { useUserStore, type Role } from '@/store/userStore';
import { useAccess } from '@/utils/access';

/** 表示用：email/name を付加 */
type MemberRow = MemberListItem & {
  email?: string | null;
  name?: string | null;
};

export default function AdminMembersPage() {
  const { user, companyId, membershipLoaded, hydrated } = useUserStore();
  const { isAdmin } = useAccess(); // ★ canAdminCompany → isAdmin に統一

  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<string>('');

  const ready = hydrated && membershipLoaded;

  const guardMsg = useMemo(() => {
    if (!ready) return '判定中…';
    if (!user?.id) return 'ログインが必要です。';
    if (!companyId) return '会社所属が未設定です。';
    if (!isAdmin) return '管理者のみアクセスできます。';
    return '';
  }, [ready, user?.id, companyId, isAdmin]);

  const fetchRows = async () => {
    setLoading(true);
    setNote('');
    try {
      // Get Bearer token
      const { data: sesRes } = await supabase.auth.getSession();
      const token = sesRes?.session?.access_token;

      if (!token) {
        setNote('セッション確認に失敗しました。ログインし直してください。');
        return;
      }

      // ★ API側で email を取得（Service Role で auth.users から）
      const res = await fetch('/api/admin/members', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error('[admin/members] fetch failed:', data);
        setNote(`メンバー一覧の取得に失敗しました: ${data?.error || 'unknown error'}`);
        return;
      }

      const data = await res.json();
      // ★ APIレスポンスに email が含まれている（service role で取得済み）
      const members = (data?.members || []) as MemberRow[];
      setRows(members);
    } catch (e) {
      console.error('[admin/members] error:', e);
      setNote('メンバー一覧の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  // 権限が通ったら取得（companyId 変化にも追従）
  useEffect(() => {
    if (ready && companyId && isAdmin) {
      fetchRows();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, companyId, isAdmin]);

  const isLastAdmin = (targetUserId: string) => {
    const adminCount = rows.filter((r) => r.role === 'admin').length;
    const targetIsAdmin = rows.find((r) => r.userId === targetUserId)?.role === 'admin';
    return adminCount === 1 && targetIsAdmin;
  };

  const onChangeRole = async (targetUserId: string, next: Role) => {
    // 最後の管理者は降格不可
    if (next !== 'admin' && isLastAdmin(targetUserId)) {
      setNote('⚠️ 最後の管理者を降格できません。先に別ユーザーを管理者にしてください。');
      return;
    }
    setWorking((w) => ({ ...w, [targetUserId]: true }));
    setNote('');
    try {
      const res = await updateMemberRole(targetUserId, next);
      if (!res.ok) throw res.error;
      setRows((prev) => prev.map((r) => (r.userId === targetUserId ? { ...r, role: next } : r)));
      setNote('✅ ロールを更新しました。');
    } catch (e) {
      console.error(e);
      setNote('ロール更新に失敗しました。権限/RLSをご確認ください。');
    } finally {
      setWorking((w) => ({ ...w, [targetUserId]: false }));
    }
  };

  const onRemove = async (targetUserId: string) => {
    if (!user?.id) return;
    if (targetUserId === user.id) {
      setNote('自分自身は削除できません。');
      return;
    }
    if (isLastAdmin(targetUserId)) {
      setNote('⚠️ 最後の管理者は削除できません。');
      return;
    }
    const ok = confirm('このメンバーを会社から削除します。よろしいですか？');
    if (!ok) return;

    setWorking((w) => ({ ...w, [targetUserId]: true }));
    setNote('');
    try {
      const res = await removeMember(targetUserId);
      if (!res.ok) throw res.error;
      setRows((prev) => prev.filter((r) => r.userId !== targetUserId));
      setNote('🗑 メンバーを削除しました。');
    } catch (e) {
      console.error(e);
      setNote('削除に失敗しました。RLS/権限設定をご確認ください。');
    } finally {
      setWorking((w) => ({ ...w, [targetUserId]: false }));
    }
  };


  if (guardMsg) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">管理者専用：メンバー管理</h1>
        <p className="text-sm text-gray-600">{guardMsg}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">管理者専用：メンバー管理</h1>
      </header>

      {/* 招待フォームは /admin/invites に統一 */}
      <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          新規ユーザーを招待する場合は「
          <a href="/admin/invites" className="font-semibold underline hover:text-blue-700">
            招待管理ページ
          </a>
          」をご利用ください。
        </p>
      </section>

      {note && (
        <div
          role="alert"
          className={`text-sm rounded-md border px-3 py-2 ${
            note.includes('✅') || note.includes('✉️')
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {note}
        </div>
      )}

      {/* 一覧 */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>ユーザー</Th>
              <Th>user_id</Th>
              <Th>部門</Th>
              <Th>ロール</Th>
              <Th className="text-right">操作</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500">
                  読み込み中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500">
                  メンバーがいません。
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const disabled = !!working[r.userId];
                const isSelf = user!.id === r.userId;
                const lockDemote = isSelf && isLastAdmin(r.userId);

                return (
                  <tr key={r.userId} className="border-t border-gray-100">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.email || r.name || '(メール非公開)'}</div>
                      {r.email && r.name && <div className="text-xs text-gray-500">{r.name}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      <code className="text-xs">{r.userId}</code>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{r.departmentId ?? '-'}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={r.role as Role} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <RoleSelect
                          value={r.role as Role}
                          onChange={(v) => onChangeRole(r.userId, v)}
                          disabled={disabled || (lockDemote && r.role === 'admin')}
                          title={lockDemote && r.role === 'admin' ? '最後の管理者は降格できません' : undefined}
                        />
                        <button
                          onClick={() => onRemove(r.userId)}
                          disabled={disabled || isSelf || isLastAdmin(r.userId)}
                          title={
                            isSelf
                              ? '自分自身は削除できません'
                              : isLastAdmin(r.userId)
                              ? '最後の管理者は削除できません'
                              : undefined
                          }
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- 小物 ---------- */
function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-4 py-2 text-left text-[12px] font-semibold text-gray-600 ${className}`}>
      {children}
    </th>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const cls =
    role === 'admin'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : role === 'manager'
      ? 'bg-amber-50 text-amber-800 border-amber-200'
      : 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {role}
    </span>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled,
  title,
}: {
  value: Role;
  onChange: (v: Role) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <select
      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as Role)}
      disabled={disabled}
      title={title}
    >
      <option value="member">member</option>
      <option value="manager">manager</option>
      <option value="admin">admin</option>
    </select>
  );
}

