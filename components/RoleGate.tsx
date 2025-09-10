'use client';

import { useEffect, useState } from 'react';
import { useUserStore } from '@/store/userStore';
import type { Role } from '@/store/userStore';

type Props = {
  minRole?: Role; // 'member' | 'manager' | 'admin'
  fallback?: React.ReactNode; // 読み込み中の置き換えUI
  children: React.ReactNode;
};

const rank: Record<Role, number> = {
  member: 0,
  manager: 1,
  admin: 2,
};

export default function RoleGate({ minRole = 'member', fallback = null, children }: Props) {
  const [domHydrated, setDomHydrated] = useState(false);

  // ストアの現在値（membership オブジェクトではなく、分解済みの値を直接使う）
  const hydrated = useUserStore((s) => s.hydrated);
  const membershipLoaded = useUserStore((s) => s.membershipLoaded);
  const role = useUserStore((s) => s.role);

  useEffect(() => setDomHydrated(true), []);

  // 1) SSR→CSR のハイドレーション完了 & 2) ストア再水和完了 & 3) membership 読み込み完了
  if (!domHydrated || !hydrated || !membershipLoaded) {
    return <>{fallback}</>;
  }

  const currentLevel = role ? rank[role] : -1;
  const required = rank[minRole];

  if (currentLevel >= required) {
    return <>{children}</>;
  }
  return null;
}
