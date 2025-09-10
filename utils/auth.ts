// /utils/auth.ts
import { supabase } from '@/lib/supabaseClient';

const SB_KEYS_PREFIX = ['sb-', 'supabase']; // 念のため広めに

export async function hardSignOut() {
  try {
    // 1) Supabaseサインアウト（サーバ側トークン失効）
    await supabase.auth.signOut({ scope: 'global' });
  } catch {}

  // 2) localStorage の Supabase系キーを全削除
  try {
    if (typeof window !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (SB_KEYS_PREFIX.some(p => k.startsWith(p))) {
          // 後で消すためにキーを控える
        }
      }
      // 反復中に削除すると崩れるので一旦コピー
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) || '');
      keys.forEach(k => {
        if (SB_KEYS_PREFIX.some(p => k.startsWith(p))) localStorage.removeItem(k);
      });
    }
  } catch {}

  // 3) 自前Cookieも全削除
  try {
    if (typeof document !== 'undefined') {
      const names = ['user_id','company_id','user_role','department_id'];
      names.forEach((n) => {
        document.cookie = `${n}=; Path=/; Max-Age=0; SameSite=Lax`;
      });
    }
  } catch {}
}
