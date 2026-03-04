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
    // ✅ 修正D：companyId チェックを削除（サーバで確定する設計のため）

    setBusy(true);
    try {
      const { data: ses } = await supabase.auth.getSession();
      const token = ses?.session?.access_token;

      if (!token) {
        setNote('セッションが見つかりません。ログインし直してください。');
        setBusy(false);
        return;
      }

      // 新しい /api/admin/members/invite エンドポイントを呼び出す（メール送信）
      const res = await fetch('/api/admin/members/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: e,
          role,
          // companyId は server が Bearer token から決定する
        }),
      });

      const j: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        const emsg =
          j?.error === 'admin_only'
            ? '権限がありません（管理者としてログインしてください）'
            : j?.error === 'email_send_failed'
            ? 'メール送信に失敗しました。メールアドレスをご確認ください。'
            : j?.detail || j?.error || `招待に失敗しました（${res.status}）`;
        setNote(`招待に失敗しました: ${emsg}`);
        return;
      }

      if (j.ok) {
        // メール送信済み - リンク表示は不要
        setInviteLink('');
        setNote(`✉️ ${e} に招待メールを送信しました。\n受信者はメール内のリンクからパスワード設定できます。`);
        setEmail('');
        // ✅ 修正E：departmentId は削除
        return;
      }

      setNote('処理は完了しました（応答を解釈できませんでした）。');
    } catch (e) {
      console.error(e);
      setNote('エラーが発生しました。ネットワーク状態をご確認ください。');
    } finally {
      setBusy(false);
    }
  }, [email, role, validEmail]); // ✅ 修正D：companyId 不要（サーバで確定）

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">招待</h1>
      </header>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        {/* ✅ 修正E：見出しを「メール招待」に統一 */}
        <h2 className="mb-3 text-sm font-semibold text-gray-700">メール招待</h2>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
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

          <button
            onClick={onInvite}
            disabled={busy || !validEmail}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-black/90 disabled:opacity-50"
          >
            {/* ✅ 修正E：ボタン文言を「招待メール送信」に統一 */}
            {busy ? '送信中…' : '招待メール送信'}
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
        ※ 招待メールが送信されます。受信者はメール内のリンクからパスワード設定とアカウント作成を行えます。招待は7日間有効です。
      </p>
    </div>
  );
}
