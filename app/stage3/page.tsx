// /app/stage3/page.tsx
// STAGE3の正式ルート（/cascade への互換リダイレクト）
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import StrategyGuard from '@/app/StrategyGuard';

export default function Stage3Page() {
  const router = useRouter();

  useEffect(() => {
    // /cascade にリダイレクト（既存実装を再利用）
    router.replace('/cascade');
  }, [router]);

  return (
    <StrategyGuard mode="view">
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
          <p className="text-sm text-gray-600">STAGE3を読み込んでいます...</p>
        </div>
      </div>
    </StrategyGuard>
  );
}
