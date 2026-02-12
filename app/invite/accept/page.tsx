// /app/invite/accept/page.tsx
import { Suspense } from 'react';
import InviteAcceptClient from './InviteAcceptClient';

export const dynamic = 'force-dynamic';

export default function InviteAcceptPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6"><p className="text-gray-600">Loading…</p></main>}>
      <InviteAcceptClient />
    </Suspense>
  );
}
