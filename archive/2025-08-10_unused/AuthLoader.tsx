'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useUserStore } from '@/store/userStore';

export default function AuthLoader() {
  const { setUser } = useUserStore();

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error) {
        console.error('❌ Supabaseユーザー取得失敗:', error.message);
      } else if (user) {
        // ✅ Supabaseの構造から必要な情報だけ抽出・マッピング
        const mappedUser = {
          id: user.id,
          email: user.email || '',
          role: user.user_metadata?.role || 'member', // 任意で設定
          department: user.user_metadata?.department || '',
        };

        setUser(mappedUser);
        console.log('✅ ユーザーセット:', mappedUser);
      } else {
        console.warn('⚠️ ユーザーが未ログインです');
      }
    };

    fetchUser();
  }, []);

  return null;
}
