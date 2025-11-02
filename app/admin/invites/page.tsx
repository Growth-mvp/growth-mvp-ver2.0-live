// /app/admin/invites/page.tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';

type Role = 'admin' | 'manager' | 'member';

export default function AdminInvitesPage() {
  const companyId = useUserStore((s) => s.companyId);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [departmentId, setDepartmentId] = useState('');
  const [note, setNote] = useState<string>('');
  const [inviteLink, setInviteLink] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const validEmail = useMemo(() => {
    const e = email.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }, [email]);

  const copyLink = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setNote('📋 招待リンクをコピーしました。');
    } catch {
      setNote('コピーに失敗しました。リンクを手動で選択してください。');
    }
  }, [inviteLink]);

  const onInvite = useCallback(async () => {
    setNote('');
    setInviteLink('');

    const e = email.trim().toLowerCase();
    if (!e) {
      setNote('メールアドレスを入力してください。');
      return;
    }
    if (!validEmail) {
      setNote('メールアドレスの形式が正しくありません。');
      return;
    }
    if (!companyId) {
      setNote('会社IDが未設定です。先に会社を作成するか選択してください。');
      return;
    }

    setBusy(true);
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
          email: e,
          role,
          companyId,                          // 会社に即追加
          departmentId: departmentId || null, // 任意
        }),
      });

      const j: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        const emsg =
          j?.error ||
          j?.message ||
          (res.status === 401
            ? '権限がありません（ログインし直してください）'
            : `招待に失敗しました（${res.status}）`);
        setNote(`招待に失敗しました: ${emsg}`);
        return;
      }

      if (j.added === true || j.addedToCompany === true) {
        setNote('✅ 既存ユーザーを会社に追加しました。');
        setEmail('');
        setDepartmentId('');
        return;
      }

      if (j.invited === true) {
        setNote('✉️ 招待メールを送信しました。');
        setEmail('');
        setDepartmentId('');
        if (j.warning) setNote((p: string) => `${p}\n⚠️ ${String(j.warning)}`);
        return;
      }

      if (typeof j.inviteLink === 'string' && j.inviteLink.length > 0) {
        setInviteLink(j.inviteLink);
        setNote('✂️ メール送信不可のため、サインアップリンクを生成しました。手動で共有してください。');
        return;
      }

      if (j.ok) {
        setNote('処理は完了しました。');
        if (j.warning) setNote((p: string) => `${p}\n⚠️ ${String(j.warning)}`);
        return;
      }

      setNote('処理は完了しました（応答を解釈できませんでした）。');
    } catch (e) {
      console.error(e);
      setNote('エラーが発生しました。ネットワーク状態をご確認ください。');
    } finally {
      setBusy(false);
    }
  }, [companyId, departmentId, email, role, validEmail]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">招待</h1>
      </header>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">メール招待 / リンク生成</h2>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <input
            type="email"
            placeholder="email@example.com"
            className="rounded-md border px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) onInvite();
            }}
          />

          <select
            className="rounded-md border px-3 py-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="member">member</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>

          <input
            type="text"
            placeholder="departmentId（任意）"
            className="rounded-md border px-3 py-2 text-sm"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) onInvite();
            }}
          />

          <button
            onClick={onInvite}
            disabled={busy || !validEmail || !companyId}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-black/90 disabled:opacity-50"
          >
            {busy ? '送信中…' : '送信 / 生成'}
          </button>

          <div className="flex items-center text-xs text-gray-500 md:justify-end">
            {companyId ? `companyId: ${companyId}` : 'companyId 未設定'}
          </div>
        </div>

        {!!inviteLink && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-700">
            <span>招待リンク：</span>
            <a className="break-all underline" href={inviteLink} target="_blank" rel="noreferrer">
              {inviteLink}
            </a>
            <button onClick={copyLink} className="rounded border px-2 py-1 hover:bg-gray-50" type="button">
              コピー
            </button>
          </div>
        )}

        {!!note && (
          <div
            role="alert"
            className={`mt-3 whitespace-pre-wrap rounded-md border px-3 py-2 text-sm ${
              note.includes('✅') || note.includes('✉️')
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            {note}
          </div>
        )}
      </section>

      <p className="text-xs text-gray-500">
        ※ 既存ユーザーは会社へ即時追加、新規ユーザーは招待メール送信（失敗時はリンク生成）で登録します。
      </p>
    </div>
  );
}
