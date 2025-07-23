'use client';

import { useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import { LogOut } from 'lucide-react';

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
      className="w-full flex items-center gap-2 px-4 py-2 mt-2 text-sm bg-gray-800 text-gray-300 hover:bg-red-600 hover:text-white rounded-md transition focus:outline-none focus:ring-2 focus:ring-red-500"
    >
      <LogOut size={16} />
      ログアウト
    </button>
  );
}
