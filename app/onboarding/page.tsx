'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getMembership, createCompanyAndJoin, joinCompany } from '@/utils/supabase/membership';
import { useUserStore } from '@/store/userStore';

export default function OnboardingPage() {
  const router = useRouter();
  const { user, setMembership, hydrated } = useUserStore();

  const [loading, setLoading] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [joinCompanyId, setJoinCompanyId] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 既に所属があればホームへ
  useEffect(() => {
    if (!hydrated || !user?.id) return;
    let mounted = true;
    (async () => {
      const m = await getMembership(user.id);
      if (!mounted) return;
      if (m.companyId) {
        setMembership(m);
        router.replace('/');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [hydrated, user?.id, router, setMembership]);

  /** 会社を新規作成（自分は Admin） */
  const handleCreateCompany = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const m = await createCompanyAndJoin({
        userId: user.id,
        companyName: companyName.trim() || undefined,
      });
      if (!m.companyId) {
        setError('会社の作成に失敗しました。権限/RLS設定をご確認ください。');
        return;
      }
      setMembership(m);
      router.replace('/');
    } catch (e: any) {
      setError(e?.message || '不明なエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [user?.id, companyName, setMembership, router]);

  /** 既存会社に参加（Member） */
  const handleJoinCompany = useCallback(async () => {
    if (!user?.id) return;
    if (!joinCompanyId.trim()) {
      setError('参加する会社IDを入力してください');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const m = await joinCompany({
        userId: user.id,
        companyId: joinCompanyId.trim(),
        role: 'member',
      });
      if (!m.companyId) {
        setError('会社への参加に失敗しました。IDや権限をご確認ください。');
        return;
      }
      setMembership(m);
      router.replace('/');
    } catch (e: any) {
      setError(e?.message || '不明なエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [user?.id, joinCompanyId, setMembership, router]);

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold mb-4">所属設定（オンボーディング）</h1>
      <p className="text-sm text-gray-600 mb-6">
        会社を新規作成するか、既存の会社に参加してください。
        <br />
        ※ 閲覧は全員OK、編集は役割に応じて制御されます。
      </p>

      {/* 会社作成 */}
      <section className="rounded-2xl border p-4 mb-6">
        <h2 className="font-medium mb-3">① 会社を新規作成（あなたは Admin）</h2>
        <label className="block text-sm text-gray-700 mb-2">会社名（任意）</label>
        <input
          className="w-full rounded-lg border px-3 py-2 mb-3"
          placeholder="例）センターボード株式会社"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          disabled={loading}
        />
        <button
          onClick={handleCreateCompany}
          disabled={loading}
          className="rounded-xl px-4 py-2 border shadow-sm hover:shadow transition disabled:opacity-50"
        >
          {loading ? '作成中…' : '会社を作成して参加（Admin）'}
        </button>
      </section>

      {/* 会社参加 */}
      <section className="rounded-2xl border p-4 mb-6">
        <h2 className="font-medium mb-3">② 既存の会社に参加（Member）</h2>
        <label className="block text-sm text-gray-700 mb-2">会社ID</label>
        <input
          className="w-full rounded-lg border px-3 py-2 mb-3"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={joinCompanyId}
          onChange={(e) => setJoinCompanyId(e.target.value)}
          disabled={loading}
        />
        <button
          onClick={handleJoinCompany}
          disabled={loading}
          className="rounded-xl px-4 py-2 border shadow-sm hover:shadow transition disabled:opacity-50"
        >
          {loading ? '参加中…' : 'この会社に参加する'}
        </button>
      </section>

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </main>
  );
}
