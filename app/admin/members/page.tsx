// /app/admin/members/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/utils/supabase/client';
import {
  listCompanyMembers,
  updateMemberRole,
  removeMember,
  addMemberByUserId,
  type MemberListItem,
} from '@/utils/supabase/membership'; // ✅ 必要なものだけ
import { useUserStore, type Role } from '@/store/userStore';
import { useAccess } from '@/utils/access';

/** 表示用：email/name を付加 */
type MemberRow = MemberListItem & {
  email?: string | null;
  name?: string | null;
};

/** ✅ ローカル実装：メールアドレスから user_id を取得（public.users を参照） */
async function findUserIdByEmailLocal(email: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  try {
    const { data, error } = await supabase
      .from('users') // ※ プロジェクトの公開ユーザテーブル（RLSで読める想定）
      .select('id')
      .eq('email', e)
      .maybeSingle();

    if (error) {
      console.warn('[findUserIdByEmailLocal] RLS/権限で取得不可の可能性:', error);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error('[findUserIdByEmailLocal] failed:', err);
    return null;
  }
}

export default function AdminMembersPage() {
  const { user, companyId, membershipLoaded, hydrated } = useUserStore();
  const { isAdmin } = useAccess(); // ★ canAdminCompany → isAdmin に統一

  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<string>('');

  // 招待/追加フォーム
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('member');
  const [newDept, setNewDept] = useState<string>(''); // departmentId 任意
  const [inviteLink, setInviteLink] = useState<string>('');

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
      const members = await listCompanyMembers(); // company_id はサーバ側で解決される想定
      let out: MemberRow[] = members;

      const ids = members.map((m) => m.userId).filter(Boolean) as string[];
      if (ids.length > 0) {
        // public.users 想定。RLSで空でも落とさず続行
        const { data, error } = await supabase
          .from('users')
          .select('id,email,name')
          .in('id', ids);

        if (!error && Array.isArray(data) && data.length > 0) {
          const map = new Map<string, { email?: string | null; name?: string | null }>();
          data.forEach((u: any) => {
            map.set(String(u.id), { email: u.email ?? null, name: u.name ?? null });
          });
          out = members.map((m) => ({
            ...m,
            email: map.get(m.userId)?.email ?? null,
            name: map.get(m.userId)?.name ?? null,
          }));
        }
      }

      setRows(out);
    } catch (e) {
      console.error(e);
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

  const onInviteOrAdd = async () => {
    setInviteLink('');
    const email = newEmail.trim().toLowerCase();
    if (!email) {
      setNote('メールアドレスを入力してください。');
      return;
    }
    setNote('処理中…');

    // 1) 既存ユーザーなら即追加（ローカル実装に切り替え）
    try {
      const uid = await findUserIdByEmailLocal(email);
      if (uid) {
        const r = await addMemberByUserId(uid, newRole, newDept || null);
        if (r.ok) {
          setNote('✅ 既存ユーザーを追加しました。');
          setNewEmail('');
          setNewDept('');
          await fetchRows();
          return;
        }
        // 失敗しても招待へフォールバック
      }
    } catch (e) {
      console.warn('findUserIdByEmailLocal / addMemberByUserId でフォールバックします', e);
    }

    // 2) 新規ユーザー：API 経由で招待
    try {
      const { data: ses } = await supabase.auth.getSession();
      const token = ses?.session?.access_token;
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          email,
          role: newRole,
          departmentId: newDept || null,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setNote(`招待に失敗しました: ${j?.error || 'unknown error'}`);
        return;
      }
      if (j.added) {
        setNote('✅ 既存ユーザーを追加しました。');
        setNewEmail('');
        setNewDept('');
        await fetchRows();
      } else if (j.invited) {
        setNote('✉️ 招待メールを送信しました。相手が参加すると一覧に表示されます。');
        setNewEmail('');
        setNewDept('');
      } else if (j.inviteLink) {
        setInviteLink(String(j.inviteLink));
        setNote('✂️ サインアップリンクを生成しました。手動で共有してください。');
      } else {
        setNote('処理は完了しました。');
      }
    } catch (e) {
      console.error(e);
      setNote('招待処理でエラーが発生しました。');
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
        {companyId && <InviteChip companyId={companyId} />}
      </header>

      {/* 追加/招待フォーム */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">メンバー追加 / 招待</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            type="email"
            placeholder="email@example.com"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <select
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as Role)}
          >
            <option value="member">member</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>
          <input
            type="text"
            placeholder="departmentId（任意）"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
          />
          <button
            onClick={onInviteOrAdd}
            className="rounded-md bg-gray-900 text-white px-4 py-2 text-sm hover:bg-black/90"
          >
            追加 / 招待
          </button>
        </div>
        {inviteLink && (
          <div className="text-xs text-gray-700">
            招待リンク：{' '}
            <a className="underline break-all" href={inviteLink} target="_blank" rel="noreferrer">
              {inviteLink}
            </a>
          </div>
        )}
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

/** 招待リンク（会社ID固定の手動参加口） */
function InviteChip({ companyId }: { companyId: string }) {
  // welcome ページは使わず、/signup に company クエリで合流
  const url = `/signup?company=${encodeURIComponent(companyId)}`;
  return (
    <a
      href={url}
      className="no-underline inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[12px] text-gray-800 shadow-sm hover:bg-gray-50"
      title="このURLを共有すると、同じ会社のメンバーとして参加できます"
    >
      招待リンクを開く
      <span className="text-gray-400">({companyId.slice(0, 8)}…)</span>
    </a>
  );
}
