'use client';

import { useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import { supabase } from '@/lib/supabaseClient';

export default function LogoutButton() {
  const router = useRouter();
  const { setUser } = useUserStore();

  const handleLogout = async () => {
    await supabase.auth.signOut(); // セッション削除
    document.cookie = 'user_id=; path=/; max-age=0'; // クッキー削除
    setUser(null); // Zustandリセット
    router.push('/login'); // ログイン画面へ遷移
  };

  return (
    <button
      onClick={handleLogout}
      className="text-sm text-red-500 hover:underline mt-6"
    >
      ログアウト
    </button>
  );
}
