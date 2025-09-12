// /app/login/page.tsx  ← Server Component（'use client' を付けない）
import { Suspense } from 'react';
import LoginClient from './LoginClient';

// Server 側の設定はここで宣言
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <LoginClient />
    </Suspense>
  );
}
