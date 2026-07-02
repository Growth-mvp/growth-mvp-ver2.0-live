// /app/auth/forgot-password/page.tsx
import { Suspense } from 'react';
import ForgotPasswordClient from './ForgotPasswordClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <ForgotPasswordClient />
    </Suspense>
  );
}
