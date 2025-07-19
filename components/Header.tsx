'use client';

import { useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import { useEffect, useState } from 'react';

export default function Header() {
  const router = useRouter();
  const { user, clearUser } = useUserStore();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleLogout = () => {
    // Cookie削除（有効期限を過去に）
    document.cookie = 'user_id=; path=/; max-age=0';
    document.cookie = 'user_role=; path=/; max-age=0';

    // Zustandからユーザ情報削除
    clearUser();

    // ログインページへ
    router.push('/login');
  };

  return (
    <header className="bg-gray-100 p-4 flex justify-between items-center">
      <h1 className="text-xl font-bold">GROWTH プラットフォーム</h1>

      {isClient && user?.id && (
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {user.email}（{user.role}）
          </span>
          <button
            onClick={handleLogout}
            className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
          >
            ログアウト
          </button>
        </div>
      )}
    </header>
  );
}
