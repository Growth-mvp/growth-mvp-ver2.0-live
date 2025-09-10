// /components/MembershipBootstrap.tsx
'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useUserStore } from '@/store/userStore';
import { getMembership } from '@/utils/supabase'; // getMembership(userId: string) を想定

type Role = 'admin' | 'manager' | 'member';
type MembershipResult = {
  companyId?: string | null;
  departmentId?: string | null;
  role?: Role | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function MembershipBootstrap() {
  const {
    user,
    companyId,
    hydrated, // Zustand rehydrate 完了フラグ
    setUser,
    setMembership,
    setMembershipLoaded,
  } = useUserStore();

  // 多重実行防止（HMR含む）
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;

    // rehydrate 完了前は動かさない
    if (!hydrated) return;

    // すでに実行中ならスキップ
    if (inFlight.current) return;
    inFlight.current = true;

    (async () => {
      try {
        // 既に store に companyId が入っていれば何もしない
        if (companyId) return;

        // 1) セッション取得（未ログインのときは loaded を立てて終了）
        const { data: userRes, error: uerr } = await supabase.auth.getUser();
        if (!alive) return;

        if (uerr) {
          // AuthSessionMissingError 等：未ログイン扱いとして静かに抜ける
          setMembershipLoaded(true);
          return;
        }

        const authed = userRes?.user ?? null;
        if (!authed) {
          setMembershipLoaded(true);
          return;
        }

        // store に user が未設定なら最小プロフィールを埋める
        if (!user?.id) {
          setUser({
            id: authed.id,
            email: authed.email ?? '',
            role: 'member', // 初期値。membership 同期時に上書きされる
            name: '',
            department: '',
          });
        }

        // 2) 現在の membership を確認
        const before = (await getMembership(authed.id)) as MembershipResult | null;
        if (!alive) return;

        if (before?.companyId) {
          setMembership({
            companyId: before.companyId ?? null,
            departmentId: before.departmentId ?? null,
            role: ((before.role ?? 'member') as Role) ?? 'member',
          });
          setMembershipLoaded(true);
          return;
        }

        // 3) 0件なら /api/companies/provision を Bearer 付きで呼ぶ
        const { data: sessRes } = await supabase.auth.getSession();
        const token = sessRes?.session?.access_token;

        try {
          await fetch('/api/companies/provision', {
            method: 'POST',
            credentials: 'same-origin', // Cookie も送る（保険）
            headers: {
              'content-type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            // body: JSON.stringify({ companyName: '初期名' }), // 任意
          });
        } catch {
          // ネットワーク失敗 → 後段のリトライに任せる
        }
        if (!alive) return;

        // 4) 整合性遅延を考慮して membership をリトライ付きで再取得
        const MAX_TRY = 3;
        let after: MembershipResult | null = null;
        for (let i = 0; i < MAX_TRY; i++) {
          after = (await getMembership(authed.id)) as MembershipResult | null;
          if (!alive) return;
          if (after?.companyId) break;
          await sleep([200, 500, 1000][i] ?? 1000);
        }

        if (after?.companyId) {
          setMembership({
            companyId: after.companyId ?? null,
            departmentId: after.departmentId ?? null,
            role: ((after.role ?? 'member') as Role) ?? 'member',
          });
        }
      } finally {
        if (alive) setMembershipLoaded(true);
        inFlight.current = false;
      }
    })();

    // auth 状態の変化に追従（サインアウト時は loaded を立てて UI を安定）
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!alive) return;
      if (!session?.user) {
        setMembershipLoaded(true);
      }
    });

    return () => {
      alive = false;
      try {
        sub?.subscription?.unsubscribe();
      } catch {}
      inFlight.current = false;
    };
  }, [hydrated, user?.id, companyId, setUser, setMembership, setMembershipLoaded]);

  return null;
}
