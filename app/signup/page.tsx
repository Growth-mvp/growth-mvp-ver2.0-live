// /app/signup/page.tsx  ← 'use client' は付けない（Server Component）
import { Suspense } from 'react';
import SignUpClient from './SignUpClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <SignUpClient />
    </Suspense>
  );
}
