'use client';

import dynamicImport from 'next/dynamic';

const InviteAcceptClient = dynamicImport(() => import('./InviteAcceptClient'), {
  ssr: false,
  loading: () => (
    <main className="mx-auto max-w-md p-6">
      <p className="text-gray-600">Loading…</p>
    </main>
  ),
});

export default function AcceptInviteWrapper() {
  return <InviteAcceptClient />;
}
