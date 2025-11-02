// /app/signup-admin/page.tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';

/** （必要なら再利用）コールバックURL作成。本番で使う時はSupabase側に登録必須。 */
function makeCallbackUrl() {
  if (typeof window !== 'undefined') {
    return new URL('/auth/callback', window.location.origin).toString();
  }
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'http://localhost:3000';
  return `${base}/auth/callback`;
}

/** PostgRESTエラーが「列なし(42703)」や does not exist を含むか */
function looksMissingColumn(err: any, col: string) {
  const code = err?.code || err?.error?.code || '';
  const msg = `${err?.message || err?.error?.message || ''} ${err?.details || ''}`.toLowerCase();
  return code === '42703' || msg.includes('does not exist') || msg.includes(col.toLowerCase());
}

export default function SignUpAdminPage() {
  const router = useRouter();

  const setUser = useUserStore((s) => s.setUser);
  const setMembership = useUserStore((s) => s.setMembership);
  const setRole = useUserStore((s) => s.setRole);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  /** 会社作成 + admin 参加（Service Role API 経由） */
  async function provisionCompany(): Promise<{ ok: boolean; companyId?: string }> {
    try {
      const { data: ses } = await supabase.auth.getSession();
      const token = ses?.session?.access_token;
      if (!token) {
        setError('セッションが見つかりません。ログイン状態を確認してください。');
        return { ok: false };
      }
      const res = await fetch('/api/companies/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          companyName: companyName.trim(),
          departmentName: departmentName.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        const code = j?.code ?? j?.error ?? 'unknown_error';
        if (code === 'already_in_company') return { ok: true, companyId: j?.companyId };
        if (code === 'company_name_required') setError('会社名が未入力です。');
        else if (code === 'invalid_token' || code === 'no_token') setError('認証トークンが無効です。ログインし直してください。');
        else setError(`会社作成に失敗しました: ${code}`);
        return { ok: false };
      }
      return { ok: true, companyId: j.companyId as string | undefined };
    } catch (e: any) {
      setError(`会社作成に失敗しました: ${e?.message || e}`);
      return { ok: false };
    }
  }

  /** company_members を“唯一の真実”として Store 同期（列が無いスキーマに自動フォールバック） */
  async function syncMembershipToStore() {
    const q1 = await supabase
      .from('company_members')
      .select('company_id, role, department_id')
      .limit(1)
      .maybeSingle();

    if (!q1.error && q1.data) {
      const row = q1.data as any;
      setMembership({
        companyId: (row.company_id as string) ?? undefined,
        departmentId: (row.department_id as string | null) ?? undefined,
      });
      setRole(((row.role as string) || 'member') as 'admin' | 'manager' | 'member');
      return true;
    }

    // department_id が無いスキーマの場合のフォールバック
    if (q1.error && looksMissingColumn(q1.error, 'department_id')) {
      const q2 = await supabase
        .from('company_members')
        .select('company_id, role')
        .limit(1)
        .maybeSingle();

      if (!q2.error && q2.data) {
        const row = q2.data as any;
        setMembership({
          companyId: (row.company_id as string) ?? undefined,
          departmentId: undefined,
        });
        setRole(((row.role as string) || 'member') as 'admin' | 'manager' | 'member');
        return true;
      }
    }

    return false;
  }

  /** セッションがある前提で会社作成→membership同期→/admin へ */
  async function afterSessionEstablished(userId: string, userEmail: string) {
    const provision = await provisionCompany();
    if (!provision.ok) return;

    // User型は role 必須 → 仮で 'member'、後で company_members の値で上書き
    setUser({ id: userId, email: userEmail, name: '', role: 'member' });

    const ok = await syncMembershipToStore();
    if (!ok) setMsg('会社作成は成功しましたが、所属情報の取得に失敗しました。再読み込みしてください。');

    router.replace('/admin');
  }

  /** サインアップ→（必要なら）即サインイン→セッション確立→afterSessionEstablished */
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setError('');
    setMsg('');

    const eaddr = email.trim().toLowerCase();
    const pass = password.trim();
    const cname = companyName.trim();
    if (!eaddr || !pass || !cname) {
      setError('会社名・メール・パスワードを入力してください。');
      return;
    }
    if (pass.length < 8) {
      setError('パスワードは8文字以上で入力してください。');
      return;
    }

    setLoading(true);
    try {
      // ⚠️ 422（Redirect URL未許可）を避けるため、開発中は emailRedirectTo を渡さない
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: eaddr,
        password: pass,
        // 本番でメール確認を使うなら ↓ を有効化し、SupabaseのRedirect URLsに登録する
        // options: { emailRedirectTo: makeCallbackUrl() },
      });

      // メール確認あり環境（session が付かない）
      if (!signUpErr && data?.user && !data.session) {
        // 開発環境でメール確認OFFなら即ログインできる
        const { data: si, error: signInErr } = await supabase.auth.signInWithPassword({
          email: eaddr,
          password: pass,
        });
        if (!signInErr && si?.user) {
          await afterSessionEstablished(si.user.id, eaddr);
          return;
        }
        // メール確認が必要
        setMsg('確認メールを送信しました。メール内リンクで登録を完了してください。');
        return;
      }

      // メール確認なし環境（即 session 付与）
      if (!signUpErr && data?.session && data.user) {
        await afterSessionEstablished(data.user.id, eaddr);
        return;
      }

      // signUp エラー時：既に登録済み or リダイレクト未許可など
      if (signUpErr) {
        const message = (signUpErr.message || '').toLowerCase();
        const isAlready = signUpErr.status === 422 || message.includes('already registered');
        if (isAlready) {
          // 既登録ならサインインを試行
          const { data: si, error: signInErr } = await supabase.auth.signInWithPassword({
            email: eaddr,
            password: pass,
          });
          if (signInErr || !si?.user) {
            setError('このメールは既に登録済みです。ログインするか、パスワードリセットをご利用ください。');
            return;
          }
          await afterSessionEstablished(si.user.id, eaddr);
          return;
        }
        setError(`サインアップに失敗: ${signUpErr.message}`);
        return;
      }
    } catch (err: any) {
      setError(err?.message || '新規登録に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-xl font-bold">管理者専用 新規会社登録</h1>

      <form onSubmit={onSubmit} className="space-y-3" autoComplete="on">
        <div>
          <label className="block text-sm text-gray-600">会社名</label>
          <input
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="例）GROWTH株式会社"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600">部署名（任意）</label>
          <input
            type="text"
            value={departmentName}
            onChange={(e) => setDepartmentName(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="例）事業開発部"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600">メールアドレス</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600">パスワード</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
            placeholder="8文字以上"
          />
        </div>

        {error && <p className="whitespace-pre-wrap text-sm text-red-600">{error}</p>}
        {msg && <p className="whitespace-pre-wrap text-sm text-green-700">{msg}</p>}

        <button
          type="submit"
          disabled={loading}
          className={`w-full rounded px-4 py-2 font-semibold ${
            loading ? 'bg-gray-300 text-gray-600' : 'bg-black text-white hover:opacity-90'
          }`}
        >
          {loading ? '送信中…' : '会社を作成して登録'}
        </button>
      </form>

      <div className="mt-6 text-sm text-gray-600">
        すでにアカウントをお持ちの方は{' '}
        <Link className="text-blue-600 underline" href="/login">
          ログイン
        </Link>{' '}
        へ。<br />
        パスワードをお忘れの方は{' '}
        <Link className="text-blue-600 underline" href="/reset-password">
          こちら
        </Link>
        。
      </div>
    </main>
  );
}
