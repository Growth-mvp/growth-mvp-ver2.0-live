// /app/admin/AdminCookieSetter.tsx
'use client';

import { useEffect } from 'react';
import { getBrowserSupabase } from '@/utils/supabase/client';

type CookieOptions = {
  path?: string;
  maxAge?: number;
  httpOnly?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
};

export function AdminCookieSetter({
  name,
  value,
  options,
}: {
  name: string;
  value: string;
  options?: CookieOptions;
}) {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Supabase セッションから JWT トークンを取得
        const supabase = getBrowserSupabase();
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;

        if (!token) {
          console.warn('[AdminCookieSetter] no auth token, skipping');
          return;
        }

        const res = await fetch('/api/_session/set-cookie', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ name, value, options }),
        });

        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          console.error('[AdminCookieSetter] failed', res.status, j);
          return;
        }

        if (!cancelled) {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[AdminCookieSetter] cookie set ok:', name);
          }
        }
      } catch (e) {
        console.error('[AdminCookieSetter] error', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [name, value, JSON.stringify(options ?? {})]);

  return null;
}
