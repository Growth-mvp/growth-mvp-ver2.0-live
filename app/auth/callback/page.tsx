// /app/auth/callback/page.tsx
import { Suspense } from 'react';
import CallbackClient from './CallbackClient';

// ✅ Ensure this page is always dynamic (no prerendering)
export const dynamic = 'force-dynamic';

/**
 * ✅ Server Component Wrapper
 * - useSearchParams() は Client Component側（CallbackClient）でのみ使用
 * - Suspense で CallbackClient を包むことでビルド時エラーを防ぐ
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md p-6 text-sm text-gray-600">認証処理中…</div>}>
      <CallbackClient />
    </Suspense>
  );
}
