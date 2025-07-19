'use client';

import { useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';

export default function LogoutButton() {
  const router = useRouter();
  const { clearUser } = useUserStore();

  const handleLogout = () => {
    // クッキーから user_id を削除
    document.cookie = 'user_id=; Max-Age=0; path=/';
    clearUser();
    router.push('/login');
  };

  return (
    <button
      onClick={handleLogout}
      className="w-full text-left text-gray-400 hover:text-white hover:underline transition"
    >
      ログアウト
    </button>
  );
}
