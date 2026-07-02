// /app/auth/update-password/page.tsx
import { Suspense } from 'react';
import UpdatePasswordClient from './UpdatePasswordClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <UpdatePasswordClient />
    </Suspense>
  );
}
