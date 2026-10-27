'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { decideMfaGate } from '@/lib/auth/mfaGate';

/**
 * 登録済みで aal1 のセッションを追加認証の画面へ、管理者で未登録のセッションを登録画面へ誘導する（描画はしない）。
 * 認証関連の画面（/auth/…、/login、/invite/… など）では動かさない（skip で指定する）。
 * 強制はサーバーの MFA ガードが行う。ここは画面の誘導のみ。
 */
export default function MfaGate({ skip, pathname }: { skip: boolean; pathname: string }) {
  const router = useRouter();

  useEffect(() => {
    if (skip) return;

    let cancelled = false;
    const toChallenge = () => {
      const here = `${pathname}${window.location.search}`;
      router.replace(`/auth/mfa/challenge?redirect_to=${encodeURIComponent(here)}`);
    };

    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled || !sess?.session) return;

        const { data: factors } = await supabase.auth.mfa.listFactors();
        if (cancelled) return;
        const enrolled = !!factors?.totp?.some((f) => f.status === 'verified');
        if (factors && !enrolled) {
          const { data: adminRows } = await supabase
            .from('company_members')
            .select('company_id')
            .eq('user_id', sess.session.user.id)
            .eq('role', 'admin')
            .limit(1);
          if (cancelled) return;
          if (adminRows && adminRows.length > 0) router.replace('/auth/mfa/enroll?required=1');
          return;
        }

        const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;

        const state = !error && data ? { currentLevel: data.currentLevel, nextLevel: data.nextLevel } : null;
        if (decideMfaGate({ hasSession: true, state, error: !!error }) === 'challenge') {
          toChallenge();
        }
      } catch {
        if (!cancelled) toChallenge();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [skip, pathname, router]);

  return null;
}
