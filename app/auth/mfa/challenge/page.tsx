// /app/auth/mfa/challenge/page.tsx
import { Suspense } from 'react';
import ChallengeClient from './ChallengeClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <ChallengeClient />
    </Suspense>
  );
}
