// /components/AuthGuards.tsx
'use client';

import { useEffect } from 'react';
import { attachAuthGuards } from '@/lib/supabaseClient';

/**
 * ブラウザ起動時/フォーカス復帰時に getSession() を軽くプローブ。
 * 失敗（＝無効なRefresh Token 等）なら安全に local signout → /login へ。
 * - attachAuthGuards() は多重起動ガード付きだが、HMR対策として返り値のデタッチを確実に呼ぶ。
 */
export default function AuthGuards() {
  useEffect(() => {
    let detach: void | (() => void);
    try {
      detach = attachAuthGuards(); // 返り値は未定義の可能性があるので型は void | fn
    } catch {
      // ここで失敗しても UI を止めない
    }
    return () => {
      try {
        if (typeof detach === 'function') detach();
      } catch {
        /* noop */
      }
    };
  }, []);

  return null;
}
