'use client';

import { useEffect } from 'react';
import { useUserStore } from '@/store/userStore';
import { useRouter } from 'next/navigation';

export default function Home() {
  const { user } = useUserStore();
  const router = useRouter();

  useEffect(() => {
    if (user?.id) {
      router.push('/strategy'); // ユーザーがセットされた後に遷移
    }
  }, [user?.id]);

  return null;
}
