// /app/auth/mfa/enroll/page.tsx
import { Suspense } from 'react';
import EnrollClient from './EnrollClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <EnrollClient />
    </Suspense>
  );
}
