// /components/AccessGate.tsx
'use client';

import React from 'react';
import { useAccess } from '@/utils/access';

export default function AccessGate({ children }: { children: React.ReactNode }) {
  const { loading } = useAccess();

  if (loading) {
    // 初期化完了まで 404 にせずローディングだけ出す
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-gray-500">
        初期化中…
      </div>
    );
  }

  return <>{children}</>;
}
